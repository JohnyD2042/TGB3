import { Worker } from "bullmq";
import IORedis from "ioredis";
import { Bot } from "grammy";
import { config } from "../config/env";
import { logger } from "../config/logger";
import type { JobPayload } from "./queue";
import { getLLMClient } from "../llm/client";
import { loadFormatPrompt } from "../prompts/loader";

const connection = new IORedis(config.redis.url, { maxRetriesPerRequest: null });

export async function startWorker(): Promise<void> {
  const worker = new Worker<JobPayload>(
    config.queue.name,
    async (job) => {
      const { chatId, inputText, sourceMeta } = job.data;
      const llm = getLLMClient();
      const formatPrompt = await loadFormatPrompt();
      const systemPrompt = "Ты — помощник по структурированию и анализу входящих телеграм-сообщений. Строго следуй инструкциям ниже. Не добавляй фактов от себя.";
      const sourceMetaStr = sourceMeta ? JSON.stringify(sourceMeta) : "";
      const userMessage = formatPrompt
        .replace(/\{\{INPUT_TEXT\}\}/g, inputText)
        .replace(/\{\{SOURCE_META\}\}/g, sourceMetaStr);
      const output = await llm.generate(systemPrompt, userMessage, {
        temperature: config.llm.temperature,
        maxTokens: config.llm.maxOutputTokens,
        timeoutMs: config.llm.timeoutMs,
      });
      const telegramBot = new Bot(config.telegram.botToken);
      const maxChunk = 4096;
      for (let i = 0; i < output.length; i += maxChunk) {
        const chunk = output.slice(i, i + maxChunk);
        await telegramBot.api.sendMessage(chatId, chunk);
        if (i + maxChunk < output.length) {
          await new Promise((r) => setTimeout(r, config.telegram.sendDelayMs));
        }
      }
    },
    {
      connection,
      concurrency: config.queue.workerConcurrency,
    }
  );

  worker.on("completed", (job) => {
    logger.info("Job completed", { jobId: job.id });
  });
  worker.on("failed", (job, err) => {
    logger.error("Job failed", { jobId: job?.id, err: String(err) });
  });

  logger.info("Worker started", { concurrency: config.queue.workerConcurrency });
}
