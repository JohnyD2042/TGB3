import { Queue } from "bullmq";
import IORedis from "ioredis";
import { config } from "../config/env";

let queue: Queue | null = null;

export interface JobPayload {
  chatId: number;
  messageId: number;
  userId: number;
  inputText: string;
  sourceMeta?: Record<string, unknown>;
}

function getConnection() {
  return new IORedis(config.redis.url, { maxRetriesPerRequest: null });
}

export function getQueue(): Queue<JobPayload> {
  if (!queue) {
    const connection = getConnection();
    queue = new Queue<JobPayload>(config.queue.name, {
      connection,
      defaultJobOptions: {
        removeOnComplete: { count: 500 },
        attempts: config.queue.maxRetries,
        backoff: { type: "exponential", delay: 1000 },
      },
    });
  }
  return queue;
}

export async function addJob(payload: JobPayload): Promise<string> {
  const q = getQueue();
  const job = await q.add("process", payload);
  return job.id ?? "";
}
