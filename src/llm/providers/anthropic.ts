import Anthropic from "@anthropic-ai/sdk";
import { config } from "../../config/env";
import type { LLMClient, LLMSettings } from "../client";

function getApiKey(): string {
  const key = config.providers.anthropic?.apiKey;
  if (!key?.trim()) throw new Error("ANTHROPIC_API_KEY is required for LLM_PROVIDER=anthropic");
  return key;
}

export function createAnthropicClient(): LLMClient {
  const apiKey = getApiKey();
  const client = new Anthropic({ apiKey });

  return {
    async generate(systemPrompt: string, userMessage: string, settings?: LLMSettings): Promise<string> {
      const temperature = settings?.temperature ?? config.llm.temperature;
      const maxTokens = settings?.maxTokens ?? config.llm.maxOutputTokens;
      const timeoutMs = settings?.timeoutMs ?? config.llm.timeoutMs;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const message = await client.messages.create(
          {
            model: config.llm.model,
            max_tokens: maxTokens,
            system: systemPrompt,
            messages: [{ role: "user", content: userMessage }],
            temperature,
          },
          { signal: controller.signal }
        );
        const block = message.content.find((b) => b.type === "text");
        return block && block.type === "text" ? block.text : "";
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
