/**
 * Configuration from environment variables.
 * Only what's needed for single-process bot (no Redis).
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

export const config = {
  app: {
    port: optionalNum("PORT", 3000),
    logLevel: optionalStr("LOG_LEVEL", "info") as "debug" | "info" | "warn" | "error",
    setWebhookOnStart: getEnv("SET_WEBHOOK") === "true" || getEnv("SET_WEBHOOK") === "1",
  },

  telegram: {
    botToken: requireEnv("TELEGRAM_BOT_TOKEN"),
    sendDelayMs: optionalNum("TELEGRAM_SEND_DELAY_MS", 300),
  },

  llm: {
    provider: requireEnv("LLM_PROVIDER"),
    model: requireEnv("LLM_MODEL"),
    temperature: optionalNum("LLM_TEMPERATURE", 70) / 100,
    maxOutputTokens: optionalNum("LLM_MAX_OUTPUT_TOKENS", 4096),
    timeoutMs: optionalNum("LLM_TIMEOUT_MS", 60000),
  },

  providers: {
    openai: { apiKey: getEnv("OPENAI_API_KEY") },
    anthropic: { apiKey: getEnv("ANTHROPIC_API_KEY") },
  },

  prompts: {
    formatPromptEnv: getEnv("FORMAT_PROMPT"),
    maxInputLength: optionalNum("MAX_INPUT_LENGTH", 50000),
  },

  database: {
    url: getEnv("DATABASE_URL"),
  },
};

export const SUPPORTED_LLM_PROVIDERS = ["openai", "anthropic"] as const;
export type LLMProviderName = (typeof SUPPORTED_LLM_PROVIDERS)[number];

const PROVIDER_API_KEYS: Record<LLMProviderName, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

export function validateConfig(): void {
  const provider = config.llm.provider.toLowerCase() as LLMProviderName;
  if (!SUPPORTED_LLM_PROVIDERS.includes(provider)) {
    throw new Error(
      `Unsupported LLM_PROVIDER: ${config.llm.provider}. Supported: ${SUPPORTED_LLM_PROVIDERS.join(", ")}.`
    );
  }
  const keyValue = config.providers[provider]?.apiKey;
  if (!keyValue || keyValue.trim() === "") {
    throw new Error(`${PROVIDER_API_KEYS[provider]} is required when LLM_PROVIDER=${provider}`);
  }
}
