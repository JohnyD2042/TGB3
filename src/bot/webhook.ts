import http from "http";
import { Bot } from "grammy";
import { config } from "../config/env";
import { logger } from "../config/logger";
import { extractMessage } from "./extract";
import { addJob } from "../queue/queue";

const bot = new Bot(config.telegram.botToken);

bot.on("message", async (ctx) => {
  const extracted = extractMessage(ctx.message);
  if (!extracted) {
    return;
  }
  try {
    await addJob({
      chatId: extracted.chatId,
      messageId: extracted.messageId,
      userId: extracted.userId,
      inputText: extracted.text,
      sourceMeta: extracted.sourceMeta as Record<string, unknown> | undefined,
    });
  } catch (err) {
    logger.error("Failed to enqueue message", { err: String(err), chatId: extracted.chatId });
    await ctx.reply("Ошибка постановки в очередь. Попробуйте позже.").catch(() => {});
  }
});

async function handleUpdate(update: unknown): Promise<void> {
  await bot.handleUpdate(update as Parameters<Parameters<typeof bot.handleUpdate>[0]>[0]);
}

export async function startWeb(): Promise<void> {
  const port = config.app.port;

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
        res.writeHead(200);
        res.end();
      } catch (err) {
        logger.error("Webhook error", { err: String(err) });
        res.writeHead(500);
        res.end();
      }
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(port, () => {
    logger.info("Web server listening", { port });
  });

  if (config.app.setWebhookOnStart && process.env.RAILWAY_STATIC_URL) {
    const url = `${process.env.RAILWAY_STATIC_URL}/telegram/webhook`;
    await bot.api.setWebhook(url).then(
      () => logger.info("Webhook set", { url }),
      (err) => logger.warn("Webhook set failed", { err: String(err) })
    );
  }
}
