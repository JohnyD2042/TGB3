import { config } from "./config/env";
import { logger } from "./config/logger";

const TELEGRAM_API = "https://api.telegram.org";
const MAX_MESSAGE_LENGTH = 4096;

export async function sendMessage(chatId: number, text: string): Promise<void> {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += MAX_MESSAGE_LENGTH) {
    chunks.push(text.slice(i, i + MAX_MESSAGE_LENGTH));
  }
  if (chunks.length === 0) return;

  const url = `${TELEGRAM_API}/bot${config.telegram.botToken}/sendMessage`;
  for (let i = 0; i < chunks.length; i++) {
    const body = JSON.stringify({ chat_id: chatId, text: chunks[i] });
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Telegram API ${res.status}: ${errText}`);
    }
    if (i < chunks.length - 1) {
      await new Promise((r) => setTimeout(r, config.telegram.sendDelayMs));
    }
  }
}

export async function setWebhook(webhookUrl: string): Promise<void> {
  const url = `${TELEGRAM_API}/bot${config.telegram.botToken}/setWebhook`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: webhookUrl }),
  });
  if (!res.ok) {
    const errText = await res.text();
    logger.warn({ message: "setWebhook failed", err: errText });
    return;
  }
  logger.info({ message: "Webhook set", url: webhookUrl });
}
