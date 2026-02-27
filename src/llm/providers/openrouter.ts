import OpenAI from "openai";
import { config } from "../../config/env";
import type { LLMClient, LLMSettings } from "../client";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

function getApiKey(): string {
  const key = config.providers.openrouter?.apiKey;
  if (!key?.trim()) throw new Error("OPENROUTER_API_KEY is required for LLM_PROVIDER=openrouter");
  return key;
}

export function createOpenRouterClient(): LLMClient {
  const apiKey = getApiKey();
  const client = new OpenAI({ apiKey, baseURL: OPENROUTER_BASE });

  return {
    async generate(systemPrompt: string, userMessage: string, settings?: LLMSettings): Promise<string> {
      const temperature = settings?.temperature ?? config.llm.temperature;
      const maxTokens = settings?.maxTokens ?? config.llm.maxOutputTokens;
      const timeoutMs = settings?.timeoutMs ?? config.llm.timeoutMs;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await client.chat.completions.create(
          {
            model: config.llm.model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userMessage },
            ],
            temperature,
            max_tokens: maxTokens,
          },
          { signal: controller.signal }
        );
        const content = response.choices[0]?.message?.content;
        return typeof content === "string" ? content : "";
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
