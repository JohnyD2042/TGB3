import { config } from "./config/env";
import { logger } from "./config/logger";

const TELEGRAM_API = "https://api.telegram.org";
const MAX_MESSAGE_LENGTH = 4096;

export interface SendMessageOptions {
  /** Inline-кнопка под последним сообщением (например "Отправить в таблицу"). */
  replyMarkup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
}

/**
 * Отправляет сообщение в чат. Если передан replyMarkup, он добавляется только к последнему чанку.
 * Возвращает message_id последнего отправленного сообщения.
 */
export async function sendMessage(
  chatId: number,
  text: string,
  options?: SendMessageOptions
): Promise<number> {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += MAX_MESSAGE_LENGTH) {
    chunks.push(text.slice(i, i + MAX_MESSAGE_LENGTH));
  }
  if (chunks.length === 0) return 0;

  const url = `${TELEGRAM_API}/bot${config.telegram.botToken}/sendMessage`;
  let lastMessageId = 0;
  let messageIdWithButton = 0;
  const numChunks = chunks.length;
  const hasReplyMarkup = !!(options?.replyMarkup && numChunks > 0);

  for (let i = 0; i < chunks.length; i++) {
    const isFirst = i === 0;
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text: chunks[i],
    };
    if (isFirst && options?.replyMarkup) {
      payload.reply_markup = options.replyMarkup;
    }
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const bodyText = await res.text();
    if (!res.ok) {
      logger.error({
        message: "Telegram sendMessage failed",
        status: res.status,
        chunkIndex: i,
        isFirstChunk: isFirst,
        hadReplyMarkup: isFirst && !!options?.replyMarkup,
        body: bodyText.slice(0, 500),
      });
      throw new Error(`Telegram API ${res.status}: ${bodyText}`);
    }
    try {
      const data = JSON.parse(bodyText) as { ok?: boolean; result?: { message_id?: number } };
      const mid = data.result?.message_id;
      if (mid) {
        lastMessageId = mid;
        if (isFirst && hasReplyMarkup) messageIdWithButton = mid;
      }
      if (isFirst && hasReplyMarkup) {
        logger.info({
          message: "Sent message with inline button",
          chatId,
          messageIdWithButton,
          lastMessageId,
          numChunks,
          telegramResultMessageId: mid,
        });
      }
    } catch {
      // ignore parse error
    }
    if (i < chunks.length - 1) {
      await new Promise((r) => setTimeout(r, config.telegram.sendDelayMs));
    }
  }
  return messageIdWithButton || lastMessageId;
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  const url = `${TELEGRAM_API}/bot${config.telegram.botToken}/answerCallbackQuery`;
  const body: Record<string, unknown> = { callback_query_id: callbackQueryId };
  if (text) body.text = text;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    logger.warn({ message: "answerCallbackQuery failed", err: errText });
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
