import "dotenv/config";
import { config, validateConfig } from "./config/env";
import { logger } from "./config/logger";

function main() {
  const mode = process.argv[2];
  if (mode !== "web" && mode !== "worker") {
    logger.error({ mode }, "Usage: node dist/index.js <web|worker>");
    process.exit(1);
  }

  try {
    validateConfig();
  } catch (err) {
    logger.error({ err: String(err) }, "Invalid config");
    process.exit(1);
  }

  logger.info(
    {
      mode,
      hasTelegramToken: !!config.telegram.botToken,
      hasRedisUrl: !!config.redis.url,
      llmProvider: config.llm.provider,
      llmModel: config.llm.model,
    },
    "Starting"
  );

  if (mode === "web") {
    import("./bot/webhook").then(({ startWeb }) => startWeb());
  } else {
    import("./queue/worker").then(({ startWorker }) => startWorker());
  }
}

main();
