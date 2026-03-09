import { config } from "../config/env";

/** Minimal message shape from Telegram update.message. */
export interface MessageLike {
  text?: string;
  caption?: string;
  chat: { id: number };
  message_id: number;
  from?: { id: number };
  forward_origin?: unknown;
  forward_date?: number;
}

export interface ExtractedMessage {
  text: string;
  chatId: number;
  messageId: number;
  userId: number;
  sourceMeta?: SourceMeta;
}

export interface SourceMeta {
  forwardFromChat?: { title?: string; username?: string; id?: number };
  /** Id of the message in the original channel (for t.me/channel/post_id link). */
  forwardPostId?: number;
  forwardDate?: number;
  forwardSignature?: string;
}

/**
 * Get raw text from message: message.text or message.caption.
 * Returns null if no text/caption (e.g. media without caption, service message).
 */
export function getRawText(message: MessageLike): string | null {
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
export function extractMessage(message: MessageLike): ExtractedMessage | null {
  const raw = getRawText(message);
  if (raw === null || raw === "") return null;

  const text = normalizeText(raw);
  if (text === "") return null;

  const chatId = message.chat.id;
  const messageId = message.message_id;
  const userId = message.from?.id ?? 0;

  const origin = message.forward_origin as {
    type?: string;
    chat?: { title?: string; username?: string; id?: number };
    author_signature?: string;
    message_id?: number;
  } | undefined;
  const originChannel = origin?.type === "channel" ? origin : null;
  const sourceMeta: SourceMeta | undefined = origin
    ? {
        forwardFromChat: originChannel?.chat
          ? {
              title: originChannel.chat.title,
              username: originChannel.chat.username,
              id: originChannel.chat.id,
            }
          : undefined,
        forwardPostId: originChannel?.message_id,
        forwardDate: message.forward_date,
        forwardSignature: originChannel?.author_signature,
      }
    : undefined;

  return { text, chatId, messageId, userId, sourceMeta };
}
