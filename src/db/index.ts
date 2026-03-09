import { Pool } from "pg";
import { config } from "../config/env";
import { logger } from "../config/logger";

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const url = config.database.url;
    if (!url || url.trim() === "") {
      throw new Error("DATABASE_URL is required for database operations");
    }
    pool = new Pool({ connectionString: url, max: 5 });
  }
  return pool;
}

// Индекс по bot_message_id не включаем сюда: таблица могла быть создана раньше без этой колонки.
// Сначала добавляем колонку (ALTER ниже), потом создаём индекс.
const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS extractions (
  id SERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  message_id BIGINT NOT NULL,
  bot_message_id BIGINT,
  user_id BIGINT,
  input_text_hash VARCHAR(64),
  raw_output TEXT,
  extracted_data JSONB DEFAULT '{}',
  source_meta JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_extractions_chat_id ON extractions(chat_id);
CREATE INDEX IF NOT EXISTS idx_extractions_created_at ON extractions(created_at);
`;

let initialized = false;

export async function initDb(): Promise<void> {
  if (!config.database.url?.trim()) return;
  try {
    const p = getPool();
    await p.query(CREATE_TABLE);
    await p.query(`ALTER TABLE extractions ADD COLUMN IF NOT EXISTS bot_message_id BIGINT`);
    await p.query(
      `CREATE INDEX IF NOT EXISTS idx_extractions_bot_message ON extractions(chat_id, bot_message_id)`
    ).catch(() => {});
    initialized = true;
    logger.info({ message: "Database initialized" });
  } catch (err) {
    logger.warn({ message: "Database init failed", err: String(err) });
  }
}

/** Structured key-value from the post (numbers, params) — for Google Sheets export later. */
export type ExtractedData = Record<string, string | number | boolean | null>;

export interface SaveExtractionParams {
  chatId: number;
  messageId: number;
  botMessageId?: number;
  userId?: number;
  inputTextHash?: string;
  rawOutput: string;
  extractedData?: ExtractedData;
  sourceMeta?: Record<string, unknown>;
}

export interface ExtractionRow {
  id: number;
  raw_output: string;
}

export async function saveExtraction(params: SaveExtractionParams): Promise<void> {
  if (!config.database.url?.trim()) return;
  if (!initialized) await initDb();
  try {
    const p = getPool();
    await p.query(
      `INSERT INTO extractions (chat_id, message_id, bot_message_id, user_id, input_text_hash, raw_output, extracted_data, source_meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        params.chatId,
        params.messageId,
        params.botMessageId ?? null,
        params.userId ?? null,
        params.inputTextHash ?? null,
        params.rawOutput,
        JSON.stringify(params.extractedData ?? {}),
        params.sourceMeta ? JSON.stringify(params.sourceMeta) : null,
      ]
    );
  } catch (err) {
    logger.error({ message: "Failed to save extraction", err: String(err), chatId: params.chatId });
  }
}

export async function getExtractionByBotMessage(
  chatId: number,
  botMessageId: number
): Promise<ExtractionRow | null> {
  if (!config.database.url?.trim()) return null;
  if (!initialized) await initDb();
  try {
    const p = getPool();
    const res = await p.query<ExtractionRow>(
      `SELECT id, raw_output FROM extractions WHERE chat_id = $1 AND bot_message_id = $2 LIMIT 1`,
      [chatId, botMessageId]
    );
    return res.rows[0] ?? null;
  } catch (err) {
    logger.error({ message: "Failed to get extraction by bot message", err: String(err), chatId, botMessageId });
    return null;
  }
}
