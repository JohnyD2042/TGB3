import { config } from "../config/env";
import type { LLMProviderName } from "../config/env";
import { createOpenAIClient } from "./providers/openai";
import { createAnthropicClient } from "./providers/anthropic";

export interface LLMSettings {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface LLMClient {
  generate(systemPrompt: string, userMessage: string, settings?: LLMSettings): Promise<string>;
}

/**
 * Returns the LLM client for the provider set in LLM_PROVIDER.
 * Lets you switch provider (openai, anthropic, …) via env without code changes.
 */
export function getLLMClient(): LLMClient {
  const provider = config.llm.provider.toLowerCase() as LLMProviderName;
  switch (provider) {
    case "openai":
      return createOpenAIClient();
    case "anthropic":
      return createAnthropicClient();
    default:
      throw new Error(`Unsupported LLM_PROVIDER: ${config.llm.provider}. Supported: openai, anthropic.`);
  }
}
