import fs from "fs";
import path from "path";
import { config } from "../config/env";

export async function loadFormatPrompt(): Promise<string> {
  if (config.prompts.formatPromptEnv && config.prompts.formatPromptEnv.trim() !== "") {
    return config.prompts.formatPromptEnv.trim();
  }
  const filePath = path.join(process.cwd(), "prompts", "format_prompt.md");
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return content.trim();
  } catch {
    return "Перепиши и структурируй следующий текст. Сохрани ключевые факты и цифры.\n\n{{INPUT_TEXT}}";
  }
}
