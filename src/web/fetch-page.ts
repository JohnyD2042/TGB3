import { logger } from "../config/logger";
import { config } from "../config/env";
import { htmlToText, extractTitle } from "./html-to-text";

export type FetchPageResult =
  | { ok: true; text: string; title: string | null; method: "direct" | "jina" }
  | { ok: false; reason: "blocked" | "empty" | "error"; detail?: string };

const MIN_USEFUL_CHARS = 280;
const FETCH_TIMEOUT_MS = 25000;

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
};

function looksLikeBlockPage(text: string): boolean {
  const t = text.toLowerCase();
  if (t.includes("forbidden") && text.length < 800) return true;
  if (t.includes("access denied") && text.length < 1500) return true;
  if (t.includes("captcha") && text.length < 2000) return true;
  if (t.includes("just a moment") && t.includes("cloudflare")) return true;
  return false;
}

function truncate(text: string): string {
  const max = config.prompts.maxInputLength;
  return text.length > max ? text.slice(0, max) : text;
}

async function fetchWithTimeout(url: string, headers: Record<string, string>): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { method: "GET", headers, redirect: "follow", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchDirect(url: string): Promise<FetchPageResult> {
  try {
    const res = await fetchWithTimeout(url, BROWSER_HEADERS);
    if (res.status === 403 || res.status === 401 || res.status === 429) {
      return { ok: false, reason: "blocked", detail: `HTTP ${res.status}` };
    }
    if (!res.ok) {
      return { ok: false, reason: "error", detail: `HTTP ${res.status}` };
    }
    const ctype = (res.headers.get("content-type") || "").toLowerCase();
    const body = await res.text();
    if (ctype.includes("json") || ctype.includes("pdf") || ctype.includes("image")) {
      return { ok: false, reason: "empty", detail: `unsupported content-type: ${ctype}` };
    }
    const title = extractTitle(body);
    const text = htmlToText(body);
    if (looksLikeBlockPage(text) || looksLikeBlockPage(body)) {
      return { ok: false, reason: "blocked", detail: "waf/forbidden page" };
    }
    if (text.length < MIN_USEFUL_CHARS) {
      return { ok: false, reason: "empty", detail: `too short (${text.length})` };
    }
    return { ok: true, text: truncate(text), title, method: "direct" };
  } catch (err) {
    return { ok: false, reason: "error", detail: String(err) };
  }
}

/** Jina Reader: markdown extraction; helps with some JS-heavy pages. */
async function fetchViaJina(url: string): Promise<FetchPageResult> {
  try {
    const jinaUrl = `https://r.jina.ai/${url}`;
    const res = await fetchWithTimeout(jinaUrl, {
      Accept: "text/markdown",
      "User-Agent": BROWSER_HEADERS["User-Agent"],
    });
    if (!res.ok) {
      return { ok: false, reason: "error", detail: `jina HTTP ${res.status}` };
    }
    const text = (await res.text()).trim();
    if (text.length < MIN_USEFUL_CHARS || looksLikeBlockPage(text)) {
      // tracker / empty shell
      if (text.toLowerCase().includes("tacker") || text.length < MIN_USEFUL_CHARS) {
        return { ok: false, reason: "blocked", detail: "jina got empty/blocked shell" };
      }
      return { ok: false, reason: "empty", detail: `jina too short (${text.length})` };
    }
    const titleMatch = text.match(/^Title:\s*(.+)$/m);
    return {
      ok: true,
      text: truncate(text),
      title: titleMatch?.[1]?.trim() || null,
      method: "jina",
    };
  } catch (err) {
    return { ok: false, reason: "error", detail: String(err) };
  }
}

/**
 * Load page text for LLM. Tries direct HTML first, then Jina Reader fallback.
 * Site WAFs (e.g. some bank sites) may still block — caller should message the user.
 */
export async function fetchPageText(url: string): Promise<FetchPageResult> {
  const direct = await fetchDirect(url);
  if (direct.ok) {
    logger.info({ message: "Page fetched", url, method: "direct", chars: direct.text.length });
    return direct;
  }
  logger.warn({ message: "Direct fetch failed, trying Jina", url, reason: direct.reason, detail: direct.detail });

  const jina = await fetchViaJina(url);
  if (jina.ok) {
    logger.info({ message: "Page fetched", url, method: "jina", chars: jina.text.length });
    return jina;
  }
  logger.warn({ message: "Page fetch failed", url, direct, jina });
  return jina.reason === "blocked" || direct.reason === "blocked"
    ? { ok: false, reason: "blocked", detail: jina.detail || direct.detail }
    : { ok: false, reason: jina.reason !== "error" ? jina.reason : direct.reason, detail: jina.detail || direct.detail };
}
