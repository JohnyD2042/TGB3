import "dotenv/config";
import * as crypto from "crypto";
import http from "http";
import { config, validateConfig } from "./config/env";
import { logger } from "./config/logger";
import { extractMessage, type MessageLike } from "./bot/extract";
import { loadFormatPrompt } from "./prompts/loader";
import { getLLMClient } from "./llm/client";
import { sendMessage, setWebhook } from "./telegram";
import { initDb, saveExtraction, type ExtractedData } from "./db";

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

async function handleUpdate(update: unknown): Promise<void> {
  const u = update as { message?: { text?: string; caption?: string; chat?: { id: number }; message_id?: number; from?: { id: number }; forward_origin?: unknown; forward_date?: number } };
  const msg = u?.message;
  if (!msg || (!msg.text && !msg.caption) || !msg.chat) return;

  const extracted = extractMessage(msg as MessageLike);
  if (!extracted) return;

  const { chatId, messageId, userId, text: inputText, sourceMeta } = extracted;

  // Лог для отладки ссылки на пост (видно в Railway): что прислал Telegram и что извлекли
  logger.info({
    message: "Link debug: raw forward_origin and extracted",
    rawForwardOrigin: (msg as { forward_origin?: unknown }).forward_origin,
    extractedChannelUsername: sourceMeta?.forwardFromChat?.username,
    extractedForwardPostId: sourceMeta?.forwardPostId,
    messageIdInBotChat: messageId,
  });
  const systemPrompt = "Ты — редактор инвестиционного приложения. Строго следуй инструкциям в промпте. Не выдумывай факты.";
  const formatPrompt = await loadFormatPrompt();
  const postIdForLink = sourceMeta?.forwardPostId ?? messageId;
  const promptMeta: Record<string, unknown> = {
    channel_title: sourceMeta?.forwardFromChat?.title ?? null,
    channel_username: sourceMeta?.forwardFromChat?.username ?? null,
    post_id: postIdForLink,
    forward_from: sourceMeta?.forwardFromChat?.title ?? sourceMeta?.forwardFromChat?.username ?? null,
    author_signature: sourceMeta?.forwardSignature ?? null,
    message_date: sourceMeta?.forwardDate ?? null,
  };
  const sourceMetaStr = JSON.stringify(promptMeta);
  const channelUsername = sourceMeta?.forwardFromChat?.username;
  const channelId = sourceMeta?.forwardFromChat?.id;
  const builtLink =
    typeof channelUsername === "string" && channelUsername
      ? `https://t.me/${channelUsername}/${postIdForLink}`
      : typeof channelId === "number" && sourceMeta?.forwardPostId != null
        ? `https://t.me/c/${String(channelId).replace(/^-100/, "")}/${postIdForLink}`
        : null;

  logger.info({
    message: "Link debug: built link",
    builtLink,
    postIdForLink,
    hasChannelUsername: !!channelUsername,
  });

  // #region agent log
  fetch("http://127.0.0.1:7417/ingest/0625aa43-057e-41ca-8274-dd127b9d9f0d", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "7b0ab1" },
    body: JSON.stringify({
      sessionId: "7b0ab1",
      location: "index.ts:handleUpdate",
      message: "promptMeta and built link for source",
      data: {
        hypothesisId: "B",
        promptMetaPostId: promptMeta.post_id,
        promptMetaChannelUsername: promptMeta.channel_username,
        builtLink,
        usedForwardPostId: sourceMeta?.forwardPostId != null,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  const userMessage = formatPrompt
    .replace(/\{\{INPUT_TEXT\}\}/g, inputText)
    .replace(/\{\{SOURCE_META\}\}/g, sourceMetaStr);

  const llm = getLLMClient();
  const output = await llm.generate(systemPrompt, userMessage, {
    temperature: config.llm.temperature,
    maxTokens: config.llm.maxOutputTokens,
    timeoutMs: config.llm.timeoutMs,
  });

  // Проверка промпта: при LOG_LEVEL=debug в логах видно, что ушло в LLM и что вернулось
  if (config.app.logLevel === "debug") {
    logger.debug({
      message: "Prompt and LLM output (to verify title rules)",
      promptSource: config.prompts.formatPromptEnv ? "env" : "file",
      promptLength: userMessage.length,
      promptPreview: userMessage.slice(0, 1200),
      llmOutput: output,
    });
  }

  let replyText = output.trim() || "Нет ответа.";
  // Всегда подменяем строку «Источник:»: либо нашей ссылкой на канал, либо «—», чтобы не показывать некорректную ссылку (например на чат с ботом)
  if (builtLink) {
    replyText = replyText.replace(/^Источник:\s*.*$/m, `Источник: ${builtLink}`);
  } else {
    replyText = replyText.replace(/^Источник:\s*.*$/m, "Источник: —");
  }
  // #region agent log
  const sourceLine = output.split("\n").find((l) => l.includes("Источник:"));
  fetch("http://127.0.0.1:7417/ingest/0625aa43-057e-41ca-8274-dd127b9d9f0d", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "7b0ab1" },
    body: JSON.stringify({
      sessionId: "7b0ab1",
      location: "index.ts:handleUpdate",
      message: "LLM output line for Источник (link)",
      data: { hypothesisId: "C", sourceLine, sourceLineLength: sourceLine?.length, builtLinkReplaced: !!builtLink },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  await sendMessage(chatId, replyText);

  const inputTextHash = crypto.createHash("sha256").update(inputText).digest("hex");
  const extractedData = tryParseExtractedData(output) ?? undefined;
  await saveExtraction({
    chatId,
    messageId,
    userId,
    inputTextHash,
    rawOutput: replyText,
    extractedData,
    sourceMeta: sourceMeta as Record<string, unknown> | undefined,
  });
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
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "POST" && req.url === "/telegram/webhook") {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
      }
      try {
        const update = JSON.parse(body) as unknown;
        await handleUpdate(update);
      } catch (err) {
        logger.error({ message: "Webhook error", err: String(err) });
      }
      res.writeHead(200);
      res.end();
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(config.app.port, async () => {
    logger.info({ message: "Listening", port: config.app.port });
    const domain =
      process.env.PUBLIC_URL?.replace(/^https?:\/\//, "").replace(/\/$/, "") ||
      process.env.RAILWAY_PUBLIC_DOMAIN;
    if (config.app.setWebhookOnStart && domain) {
      const webhookUrl = `https://${domain}/telegram/webhook`;
      await setWebhook(webhookUrl);
    }
  });
}

main();
