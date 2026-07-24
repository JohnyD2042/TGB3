import "dotenv/config";
import * as crypto from "crypto";
import http from "http";
import { config, validateConfig } from "./config/env";
import { resolvePublicOrigin, resolveWebhookUrl } from "./config/public-url";
import { logger } from "./config/logger";
import { extractMessage, type MessageLike } from "./bot/extract";
import { parseIdeyaBlock } from "./bot/parse-ideya";
import { loadFormatPrompt } from "./prompts/loader";
import { getLLMClient } from "./llm/client";
import { sendMessage, answerCallbackQuery, ensureWebhook, getWebhookInfo } from "./telegram";
import { initDb, saveExtraction, getExtractionByBotMessage, type ExtractedData } from "./db";
import { appendIdeyaRow } from "./sheets";
import { extractHttpUrl, isPrimarilyUrlMessage, isTelegramUrl } from "./web/url";
import { fetchPageText } from "./web/fetch-page";

const NO_INVESTMENT_IDEA_MARKER = "NO_INVESTMENT_IDEA";
const NO_INVESTMENT_IDEA_REPLY = "Кажется, там нет инвестидеи";

/** Сегодня по Москве (ГГГГ-ММ-ДД) — для расчёта горизонта в промпте. */
function todayDateMoscowISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function formatDDMMYYYY(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

function llmErrorReply(err: unknown): string {
  const s = String(err).toLowerCase();
  if (
    s.includes("402") ||
    s.includes("insufficient") ||
    s.includes("credit") ||
    s.includes("balance") ||
    s.includes("billing") ||
    s.includes("payment required")
  ) {
    return "Закончились кредиты на OpenRouter. Пополните баланс на openrouter.ai (Credits), затем отправьте сообщение снова.";
  }
  return "Сейчас не удалось обработать сообщение (ошибка нейросети). Попробуйте через минуту.";
}

function tryParseExtractedData(text: string): ExtractedData | null {
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: ExtractedData = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof k === "string" && (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean")) {
          out[k] = v;
        }
      }
      return Object.keys(out).length > 0 ? out : null;
    }
  } catch {
    // ignore
  }
  return null;
}

function isNoInvestmentIdea(output: string): boolean {
  const t = output.trim();
  return t === NO_INVESTMENT_IDEA_MARKER || t.startsWith(NO_INVESTMENT_IDEA_MARKER + "\n");
}

type ProcessIdeyaParams = {
  chatId: number;
  messageId: number;
  userId: number;
  inputText: string;
  promptMeta: Record<string, unknown>;
  /** Force Источник: to this URL when set. */
  sourceLink: string | null;
  /** Дата для строки Дата: (ДД.ММ.ГГГГ) или null → "—" */
  postDateStr: string | null;
  /** Extra fields saved with extraction */
  saveSourceMeta?: Record<string, unknown>;
};

async function processIdeyaAndReply(params: ProcessIdeyaParams): Promise<void> {
  const { chatId, messageId, userId, inputText, promptMeta, sourceLink, postDateStr, saveSourceMeta } = params;
  const systemPrompt =
    "Ты — редактор инвестиционного приложения. Строго следуй инструкциям в промпте. Не выдумывай факты.";
  const formatPrompt = await loadFormatPrompt();
  const userMessage = formatPrompt
    .replace(/\{\{INPUT_TEXT\}\}/g, inputText)
    .replace(/\{\{SOURCE_META\}\}/g, JSON.stringify(promptMeta));

  const llm = getLLMClient();
  let output: string;
  try {
    output = await llm.generate(systemPrompt, userMessage, {
      temperature: config.llm.temperature,
      maxTokens: config.llm.maxOutputTokens,
      timeoutMs: config.llm.timeoutMs,
    });
  } catch (err) {
    logger.error({ message: "LLM generate failed", err: String(err), chatId });
    await sendMessage(chatId, llmErrorReply(err));
    return;
  }

  if (config.app.logLevel === "debug") {
    logger.debug({
      message: "Prompt and LLM output",
      promptSource: config.prompts.formatPromptEnv ? "env" : "file",
      promptLength: userMessage.length,
      promptPreview: userMessage.slice(0, 1200),
      llmOutput: output,
    });
  }

  if (isNoInvestmentIdea(output)) {
    await sendMessage(chatId, NO_INVESTMENT_IDEA_REPLY);
    return;
  }

  let replyText = output.trim() || "Нет ответа.";
  if (sourceLink) {
    replyText = replyText.replace(/^Источник:\s*.*$/m, `Источник: ${sourceLink}`);
  } else {
    replyText = replyText.replace(/^Источник:\s*.*$/m, "Источник: —");
  }
  if (replyText.match(/^Дата:\s/m)) {
    replyText = replyText.replace(/^Дата:\s*.*$/m, postDateStr ? `Дата: ${postDateStr}` : "Дата: —");
  } else {
    replyText = replyText.trimEnd() + "\nДата: " + (postDateStr ?? "—");
  }

  const sentMessageId = await sendMessage(chatId, replyText, {
    replyMarkup: {
      inline_keyboard: [[{ text: "Отправить в таблицу", callback_data: "send_sheet" }]],
    },
  });

  logger.info({
    message: "Saving extraction with bot_message_id",
    chatId,
    sentMessageId,
    willSaveBotMessageId: sentMessageId || undefined,
  });

  const inputTextHash = crypto.createHash("sha256").update(inputText).digest("hex");
  const extractedData = tryParseExtractedData(output) ?? undefined;
  await saveExtraction({
    chatId,
    messageId,
    botMessageId: sentMessageId || undefined,
    userId,
    inputTextHash,
    rawOutput: replyText,
    extractedData,
    sourceMeta: saveSourceMeta,
  });
}

async function handleUpdate(update: unknown): Promise<void> {
  const u = update as {
    message?: {
      text?: string;
      caption?: string;
      chat?: { id: number };
      message_id?: number;
      from?: { id: number };
      forward_origin?: unknown;
      forward_date?: number;
    };
  };
  const msg = u?.message;
  if (!msg || (!msg.text && !msg.caption) || !msg.chat) return;

  const extracted = extractMessage(msg as MessageLike);
  if (!extracted) return;

  const { chatId, messageId, userId, text: rawText, sourceMeta } = extracted;
  const isForward = !!sourceMeta || msg.forward_origin != null;

  // New mode: plain message that is mainly an external http(s) link → fetch page + same LLM format
  const url = extractHttpUrl(rawText);
  if (!isForward && url && isPrimarilyUrlMessage(rawText) && !isTelegramUrl(url)) {
    logger.info({ message: "Web link mode", chatId, url });
    await sendMessage(chatId, "Читаю страницу…");
    const page = await fetchPageText(url);
    if (!page.ok) {
      const hint =
        page.reason === "blocked"
          ? "Сайт не отдаёт текст ботам (защита от автоматического чтения). Скопируйте текст идеи со страницы и пришлите боту сообщением — или перешлите пост из Telegram."
          : "Не удалось прочитать страницу по ссылке. Проверьте адрес или пришлите текст идеи сообщением.";
      await sendMessage(chatId, hint);
      return;
    }

    await processIdeyaAndReply({
      chatId,
      messageId,
      userId,
      inputText: page.text,
      promptMeta: {
        source_type: "web",
        page_url: url,
        page_title: page.title,
        today_date: todayDateMoscowISO(),
      },
      sourceLink: url,
      postDateStr: formatDDMMYYYY(new Date()),
      saveSourceMeta: {
        source_type: "web",
        page_url: url,
        page_title: page.title,
        fetch_method: page.method,
      },
    });
    return;
  }

  if (!isForward && url && isPrimarilyUrlMessage(rawText) && isTelegramUrl(url)) {
    await sendMessage(
      chatId,
      "Ссылки t.me лучше обрабатывать пересылкой поста боту. Перешлите сообщение из канала — или пришлите внешнюю ссылку на статью в интернете."
    );
    return;
  }

  // Existing Telegram / plain-text mode
  const postIdForLink = sourceMeta?.forwardPostId ?? messageId;
  const channelUsername = sourceMeta?.forwardFromChat?.username;
  const channelId = sourceMeta?.forwardFromChat?.id;
  const builtLink =
    typeof channelUsername === "string" && channelUsername
      ? `https://t.me/${channelUsername}/${postIdForLink}`
      : typeof channelId === "number" && sourceMeta?.forwardPostId != null
        ? `https://t.me/c/${String(channelId).replace(/^-100/, "")}/${postIdForLink}`
        : null;

  await processIdeyaAndReply({
    chatId,
    messageId,
    userId,
    inputText: rawText,
    promptMeta: {
      source_type: "telegram",
      channel_title: sourceMeta?.forwardFromChat?.title ?? null,
      channel_username: sourceMeta?.forwardFromChat?.username ?? null,
      post_id: postIdForLink,
      forward_from: sourceMeta?.forwardFromChat?.title ?? sourceMeta?.forwardFromChat?.username ?? null,
      author_signature: sourceMeta?.forwardSignature ?? null,
      message_date: sourceMeta?.forwardDate ?? null,
      today_date: todayDateMoscowISO(),
    },
    sourceLink: builtLink,
    postDateStr:
      sourceMeta?.forwardDate != null ? formatDDMMYYYY(new Date(sourceMeta.forwardDate * 1000)) : null,
    saveSourceMeta: sourceMeta as Record<string, unknown> | undefined,
  });
}

async function handleCallbackQuery(callbackQuery: {
  id: string;
  message?: { chat?: { id: number }; message_id?: number };
}): Promise<void> {
  const chatId = callbackQuery.message?.chat?.id;
  const botMessageId = callbackQuery.message?.message_id;
  if (chatId == null || botMessageId == null) return;
  if (callbackQuery.id === undefined) return;

  logger.info({
    message: "Callback: looking up extraction",
    chatId,
    botMessageId,
  });

  const extraction = await getExtractionByBotMessage(chatId, botMessageId);
  if (!extraction) {
    logger.warn({
      message: "Callback: extraction not found",
      chatId,
      botMessageId,
    });
    await answerCallbackQuery(callbackQuery.id, "Запись не найдена.");
    return;
  }

  const fields = parseIdeyaBlock(extraction.raw_output);
  const appended = await appendIdeyaRow(fields);
  await answerCallbackQuery(
    callbackQuery.id,
    appended ? "Добавлено в таблицу" : "Таблица не настроена или ошибка записи"
  );
}

async function main() {
  try {
    validateConfig();
  } catch (err) {
    logger.error({ message: "Invalid config", err: String(err) });
    process.exit(1);
  }

  logger.info({
    message: "Starting",
    hasTelegramToken: !!config.telegram.botToken,
    llmProvider: config.llm.provider,
    llmModel: config.llm.model,
    hasDatabase: !!config.database.url,
  });

  await initDb();

  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && (req.url === "/health" || req.url === "/health?webhook=1")) {
      const includeWebhook = req.url.includes("webhook=1");
      const body: Record<string, unknown> = { ok: true };
      if (includeWebhook) {
        const info = await getWebhookInfo();
        body.webhook = info
          ? {
              url: info.url || null,
              pending_update_count: info.pending_update_count,
              last_error_message: info.last_error_message ?? null,
              last_error_date: info.last_error_date ?? null,
            }
          : null;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
      return;
    }

    if (req.method === "POST" && req.url === "/telegram/webhook") {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
      }
      try {
        const update = JSON.parse(body) as {
          message?: { chat?: { id: number }; text?: string; caption?: string };
          callback_query?: { id: string; message?: { chat?: { id: number }; message_id?: number } };
        };
        if (update.callback_query) {
          await handleCallbackQuery(update.callback_query);
        } else {
          await handleUpdate(update);
        }
      } catch (err) {
        logger.error({ message: "Webhook error", err: String(err) });
        const chatId = (() => {
          try {
            const u = JSON.parse(body) as { message?: { chat?: { id: number } } };
            return u.message?.chat?.id;
          } catch {
            return undefined;
          }
        })();
        if (chatId != null) {
          try {
            await sendMessage(
              chatId,
              "Не удалось обработать сообщение. Попробуйте ещё раз или проверьте логи сервера."
            );
          } catch {
            // ignore secondary failure
          }
        }
      }
      res.writeHead(200);
      res.end();
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(config.app.port, async () => {
    logger.info({
      message: "Listening",
      port: config.app.port,
      publicOrigin: resolvePublicOrigin(),
    });

    const webhookUrl = resolveWebhookUrl();
    if (config.app.autoRegisterWebhook && webhookUrl) {
      await ensureWebhook(webhookUrl);
    } else if (config.app.autoRegisterWebhook && !webhookUrl) {
      logger.warn({
        message:
          "Не удалось определить публичный URL для webhook. В Railway включите Public Networking или задайте PUBLIC_URL.",
      });
    }

    const info = await getWebhookInfo();
    if (info) {
      logger.info({
        message: "Telegram webhook status",
        url: info.url || "(not set)",
        expectedUrl: webhookUrl,
        pendingUpdateCount: info.pending_update_count,
        lastErrorMessage: info.last_error_message ?? null,
      });
    }
  });
}

main();
