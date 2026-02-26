import type { Message } from "grammy/types";
import { config } from "../config/env";

export interface ExtractedMessage {
  text: string;
  chatId: number;
  messageId: number;
  userId: number;
  sourceMeta?: SourceMeta;
}

export interface SourceMeta {
  forwardFromChat?: { title?: string; username?: string };
  forwardDate?: number;
  forwardSignature?: string;
}

/**
 * Get raw text from message: message.text or message.caption.
 * Returns null if no text/caption (e.g. media without caption, service message).
 */
export function getRawText(message: Message): string | null {
  const raw = message.text ?? message.caption ?? null;
  return typeof raw === "string" ? raw : null;
}

/**
 * Normalize: trim, collapse multiple spaces, preserve newlines.
 * Enforce max length from config (trim to MAX_INPUT_LENGTH).
 */
export function normalizeText(text: string): string {
  let s = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ")
    .trim();
  const maxLen = config.prompts.maxInputLength;
  if (s.length > maxLen) {
    s = s.slice(0, maxLen);
  }
  return s.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+/g, " ").trim();
}

/**
 * Extract and normalize text from message. Returns null if no text to process.
 */
export function extractMessage(message: Message): ExtractedMessage | null {
  const raw = getRawText(message);
  if (raw === null || raw === "") return null;

  const text = normalizeText(raw);
  if (text === "") return null;

  const chatId = message.chat.id;
  const messageId = message.message_id;
  const userId = message.from?.id ?? 0;

  const sourceMeta: SourceMeta | undefined = message.forward_origin
    ? {
        forwardFromChat:
          message.forward_origin.type === "channel"
            ? {
                title: message.forward_origin.chat_title,
                username: message.forward_origin.chat?.username,
              }
            : message.forward_origin.type === "hidden_user"
              ? undefined
              : undefined,
        forwardDate:
          message.forward_date ?? message.forward_origin["forward_date"],
        forwardSignature:
          message.forward_origin.type === "channel"
            ? message.forward_origin.author_signature
            : undefined,
      }
    : undefined;

  return { text, chatId, messageId, userId, sourceMeta };
}
