/**
 * Парсит текст ответа бота (блок инвестидеи) в объект полей для строки таблицы.
 * Формат: "Ключ: значение" по строкам; блок "Драйверы роста:" — список строк с "- ".
 */

export type IdeyaFields = Record<string, string>;

const FIELD_KEYS = [
  "Название 1",
  "Название 2",
  "Название 3",
  "Автор идеи",
  "Аналитик(и)",
  "Базовый актив",
  "Целевая цена",
  "Стоп-лосс",
  "Направление (лонг/шорт)",
  "Горизонт (дней)",
  "Драйверы роста",
  "Источник",
] as const;

/** Сопоставление ключа из текста с ключом для таблицы (заголовок столбца). */
const KEY_TO_COLUMN: Record<string, string> = {
  "Название 1": "Название 1",
  "Название 2": "Название 2",
  "Название 3": "Название 3",
  "Автор идеи": "Автор идеи",
  "Аналитик(и)": "Аналитик(и)",
  "Базовый актив": "Базовый актив",
  "Целевая цена": "Целевая цена",
  "Стоп-лосс": "Стоп-лосс",
  "Направление (лонг/шорт)": "Направление",
  "Горизонт (дней)": "Горизонт (дней)",
  "Источник": "Ссылка",
  "Дата": "Дата",
};

/** Строка списка драйвера: дефис/тире/буллет + пробелы + текст. LLM может выводить – или — вместо -. */
function parseDriverLine(line: string): string | null {
  const m = line.match(/^\s*[-–—•]\s+(.+)$/s);
  return m ? m[1].trim() : null;
}

/**
 * Парсит блок инвестидеи в объект полей для Google Sheets.
 * Драйверы роста разбиваются на Драйвер 1 … Драйвер 5.
 */
export function parseIdeyaBlock(text: string): IdeyaFields {
  const out: IdeyaFields = {};
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  let i = 0;
  const drivers: string[] = [];

  while (i < lines.length) {
    const line = lines[i];
    if (!line) {
      i++;
      continue;
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) {
      const driverText = parseDriverLine(line);
      if (driverText !== null) drivers.push(driverText);
      i++;
      continue;
    }

    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();

    if (key === "Драйверы роста") {
      i++;
      while (i < lines.length) {
        if (!lines[i]) {
          i++;
          continue;
        }
        const driverText = parseDriverLine(lines[i]);
        if (driverText !== null) {
          drivers.push(driverText);
          i++;
        } else {
          break;
        }
      }
      continue;
    }

    const colKey = KEY_TO_COLUMN[key] ?? key;
    if (value) out[colKey] = value;
    i++;
  }

  for (let d = 1; d <= 5; d++) {
    const col = `Драйвер ${d}`;
    out[col] = drivers[d - 1] ?? "";
  }

  return out;
}
