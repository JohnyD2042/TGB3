import winston from "winston";
import { config } from "./env";

const { combine, timestamp, json } = winston.format;

export const logger = winston.createLogger({
  level: config.app.logLevel,
  format: combine(
    timestamp(),
    json()
  ),
  defaultMeta: { service: "tgb3" },
  transports: [new winston.transports.Console()],
});

/** Add request/job context to a child logger (do not log raw message text in production). */
export function childLogger(meta: { jobId?: string; chatIdHash?: string; requestId?: string }) {
  return logger.child(meta);
}
