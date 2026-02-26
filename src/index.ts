import "dotenv/config";
import { config, validateConfig } from "./config/env";
import { logger } from "./config/logger";

function main() {
  const mode = process.argv[2];
  if (mode !== "web" && mode !== "worker") {
    logger.error({ message: "Usage: node dist/index.js <web|worker>", mode });
    process.exit(1);
  }

  try {
    validateConfig();
  } catch (err) {
    logger.error({ message: "Invalid config", err: String(err) });
    process.exit(1);
  }

  logger.info({
    message: "Starting",
    mode,
    hasTelegramToken: !!config.telegram.botToken,
    hasRedisUrl: !!config.redis.url,
    llmProvider: config.llm.provider,
    llmModel: config.llm.model,
  });

  if (mode === "web") {
    import("./bot/webhook").then(({ startWeb }) => startWeb());
  } else {
    import("./queue/worker").then(({ startWorker }) => startWorker());
  }
}

main();
