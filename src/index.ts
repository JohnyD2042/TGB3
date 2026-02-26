import "dotenv/config";
import { config, validateConfig } from "./config/env";
import { logger } from "./config/logger";

function main() {
  const arg = process.argv[2];
  const mode = arg === "worker" ? "worker" : "web";
  if (arg && arg !== "web" && arg !== "worker") {
    logger.error({ message: "Usage: node dist/index.js [web|worker], default is web", mode: arg });
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
