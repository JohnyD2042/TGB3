import OpenAI from "openai";
import { config } from "../../config/env";
import type { LLMClient, LLMSettings } from "../client";

function getApiKey(): string {
  const key = config.providers.openai?.apiKey;
  if (!key?.trim()) throw new Error("OPENAI_API_KEY is required for LLM_PROVIDER=openai");
  return key;
}

export function createOpenAIClient(): LLMClient {
  const apiKey = getApiKey();
  const client = new OpenAI({ apiKey });

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
