import "dotenv/config";
import crypto from "crypto";
import http from "http";
import { config, validateConfig } from "./config/env";
import { logger } from "./config/logger";
import { extractMessage } from "./bot/extract";
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
  if (!msg || (!msg.text && !msg.caption)) return;

  const extracted = extractMessage(msg);
  if (!extracted) return;

  const { chatId, messageId, userId, text: inputText, sourceMeta } = extracted;
  const systemPrompt = "Ты — помощник по структурированию и анализу сообщений. Строго следуй инструкциям. Не добавляй фактов от себя.";
  const formatPrompt = await loadFormatPrompt();
  const sourceMetaStr = sourceMeta ? JSON.stringify(sourceMeta) : "";
  const userMessage = formatPrompt
    .replace(/\{\{INPUT_TEXT\}\}/g, inputText)
    .replace(/\{\{SOURCE_META\}\}/g, sourceMetaStr);

  const llm = getLLMClient();
  const output = await llm.generate(systemPrompt, userMessage, {
    temperature: config.llm.temperature,
    maxTokens: config.llm.maxOutputTokens,
    timeoutMs: config.llm.timeoutMs,
  });

  const replyText = output.trim() || "Нет ответа.";
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
    const domain = process.env.RAILWAY_PUBLIC_DOMAIN;
    if (config.app.setWebhookOnStart && domain) {
      await setWebhook(`https://${domain}/telegram/webhook`);
    }
  });
}

main();
