/**
 * Configuration from environment variables.
 * Never log raw tokens or API keys.
 */

function getEnv(key: string): string | undefined {
  return process.env[key];
}

function requireEnv(key: string): string {
  const v = getEnv(key);
  if (v === undefined || v === "") {
    throw new Error(`Missing required env: ${key}`);
  }
  return v;
}

function optionalNum(key: string, def: number): number {
  const v = getEnv(key);
  if (v === undefined || v === "") return def;
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return def;
  return n;
}

function optionalStr(key: string, def: string): string {
  const v = getEnv(key);
  return v === undefined || v === "" ? def : v;
}

export type PrefilterMode = "off" | "keywords" | "light";

export const config = {
  app: {
    env: optionalStr("APP_ENV", "development"),
    port: optionalNum("PORT", 3000),
    logLevel: optionalStr("LOG_LEVEL", "info") as "debug" | "info" | "warn" | "error",
    setWebhookOnStart: getEnv("SET_WEBHOOK") === "true" || getEnv("SET_WEBHOOK") === "1",
  },

  telegram: {
    botToken: requireEnv("TELEGRAM_BOT_TOKEN"),
    sendRetries: optionalNum("TELEGRAM_SEND_RETRIES", 5),
    sendDelayMs: optionalNum("TELEGRAM_SEND_DELAY_MS", 300),
  },

  redis: {
    url: requireEnv("REDIS_URL"),
  },

  llm: {
    provider: requireEnv("LLM_PROVIDER"),
    model: requireEnv("LLM_MODEL"),
    temperature: optionalNum("LLM_TEMPERATURE", 70) / 100,
    maxOutputTokens: optionalNum("LLM_MAX_OUTPUT_TOKENS", 4096),
    timeoutMs: optionalNum("LLM_TIMEOUT_MS", 60000),
    retries: optionalNum("LLM_RETRIES", 3),
  },

  /** API keys per provider — only the one for LLM_PROVIDER is required at runtime. */
  providers: {
    openai: { apiKey: getEnv("OPENAI_API_KEY") },
    anthropic: { apiKey: getEnv("ANTHROPIC_API_KEY") },
  },

  queue: {
    name: optionalStr("QUEUE_NAME", "telegram-process"),
    workerConcurrency: optionalNum("WORKER_CONCURRENCY", 2),
    maxRetries: optionalNum("MAX_RETRIES", 3),
  },

  prefilter: {
    mode: optionalStr("PREFILTER_MODE", "off") as PrefilterMode,
    keywords: parseKeywords(getEnv("PREFILTER_KEYWORDS")),
    minTextLength: optionalNum("MIN_TEXT_LENGTH", 10),
  },

  dedup: {
    ttlSeconds: optionalNum("DEDUP_TTL_SECONDS", 300),
  },

  prompts: {
    formatPromptEnv: getEnv("FORMAT_PROMPT"),
    maxInputLength: optionalNum("MAX_INPUT_LENGTH", 50000),
  },
};

function parseKeywords(value: string | undefined): string[] {
  if (!value || value.trim() === "") return [];
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed) as unknown;
      return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
}

export const SUPPORTED_LLM_PROVIDERS = ["openai", "anthropic"] as const;
export type LLMProviderName = (typeof SUPPORTED_LLM_PROVIDERS)[number];

const PROVIDER_API_KEYS: Record<LLMProviderName, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

/** Validate config at startup; throws if provider is unknown or its API key is missing. */
export function validateConfig(): void {
  const provider = config.llm.provider.toLowerCase() as LLMProviderName;
  if (!SUPPORTED_LLM_PROVIDERS.includes(provider)) {
    throw new Error(
      `Unsupported LLM_PROVIDER: ${config.llm.provider}. Supported: ${SUPPORTED_LLM_PROVIDERS.join(", ")}.`
    );
  }
  const keyEnv = PROVIDER_API_KEYS[provider];
  const keyValue = config.providers[provider]?.apiKey;
  if (!keyValue || keyValue.trim() === "") {
    throw new Error(`${keyEnv} is required when LLM_PROVIDER=${provider}`);
  }
}
