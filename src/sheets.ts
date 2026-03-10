import { google } from "googleapis";
import { config } from "./config/env";
import { logger } from "./config/logger";
import type { IdeyaFields } from "./bot/parse-ideya";

let sheetsClient: ReturnType<typeof google.sheets> | null = null;

function getSheetsClient(): ReturnType<typeof google.sheets> | null {
  if (sheetsClient) return sheetsClient;
  const credentialsJson = config.sheets.credentialsJson?.trim();
  const sheetId = config.sheets.sheetId?.trim();
  if (!credentialsJson || !sheetId) return null;
  try {
    const credentials = JSON.parse(credentialsJson) as { client_email?: string; private_key?: string };
    if (!credentials.client_email || !credentials.private_key) {
      logger.warn({ message: "Sheets: invalid credentials JSON (missing client_email or private_key)" });
      return null;
    }
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    sheetsClient = google.sheets({ version: "v4", auth });
    return sheetsClient;
  } catch (err) {
    logger.warn({ message: "Sheets: failed to init client", err: String(err) });
    return null;
  }
}

/**
 * Добавляет одну строку в таблицу. Первая строка листа — заголовки; значения подставляются по названию столбца.
 * Добавляет поле "Дата" с текущей датой (ISO), если такой столбец есть.
 */
export async function appendIdeyaRow(fields: IdeyaFields): Promise<boolean> {
  const sheetId = config.sheets.sheetId?.trim();
  if (!sheetId) {
    logger.info({ message: "Sheets: GOOGLE_SHEET_ID not set, skip append" });
    return false;
  }
  const client = getSheetsClient();
  if (!client) return false;

  const sheetName = "Sheet1";
  try {
    const headerRes = await client.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${sheetName}!1:1`,
    });
    const headerRow = headerRes.data.values?.[0];
    if (!headerRow || headerRow.length === 0) {
      logger.warn({ message: "Sheets: no header row found" });
      return false;
    }

    const formatDDMMYYYY = (d: Date) =>
      `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
    const dateStr =
      (fields["Дата"] && String(fields["Дата"]).trim()) || formatDDMMYYYY(new Date());
    const row = headerRow.map((header: string) => {
      const key = String(header).trim();
      if (key === "Дата") return dateStr;
      return fields[key] ?? "";
    });

    await client.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${sheetName}!A:A`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [row] },
    });
    logger.info({ message: "Sheets: row appended", spreadsheetId: sheetId });
    return true;
  } catch (err: unknown) {
    const errObj = err as { message?: string; response?: { status?: number; data?: unknown } };
    logger.error({
      message: "Sheets: append failed",
      err: String(err),
      errMessage: errObj?.message,
      status: errObj?.response?.status,
      responseData: errObj?.response?.data,
      spreadsheetId: sheetId,
    });
    return false;
  }
}
