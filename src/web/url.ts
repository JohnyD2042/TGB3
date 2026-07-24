const URL_RE = /https?:\/\/[^\s<>"')\]]+/i;

/** First http(s) URL in text, trailing punctuation stripped. */
export function extractHttpUrl(text: string): string | null {
  const m = text.match(URL_RE);
  if (!m) return null;
  let url = m[0].replace(/[.,;:!?)]+$/g, "");
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** True if message is mainly a link (optional short note), not a full post. */
export function isPrimarilyUrlMessage(text: string): boolean {
  const url = extractHttpUrl(text);
  if (!url) return false;
  const rest = text.replace(url, "").replace(/\s+/g, " ").trim();
  return rest.length <= 40;
}

export function isTelegramUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "t.me" || host === "telegram.me" || host.endsWith(".t.me");
  } catch {
    return false;
  }
}
