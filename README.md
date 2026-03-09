# TGB3 — контекст проекта и документация

Этот файл сохраняет полный контекст проекта для продолжения работы в новом чате.

---

## 1. Что это за проект

**Telegram-бот для инвестиционного приложения.** Пользователь пересылает или отправляет боту сообщения (новости, аналитику, посты из каналов). Бот прогоняет текст через выбранную LLM и возвращает **стандартизированный объект "инвестидея"**: название, автор, аналитик, базовый актив, целевая цена, направление (лонг/шорт), горизонт в днях, драйверы роста, источник. Формат ответа задаётся промптом в `prompts/format_prompt.md`.

**Деплой:** Railway (один сервис TGB3 + опционально Postgres). Все секреты и настройки — через Variables в Railway.

---

## 2. Архитектура (как работает сейчас)

- **Один процесс**, без Redis, без отдельного воркера, без библиотеки GrammY.
- **HTTP-сервер** (Node.js `http`): слушает `PORT` (Railway подставляет, часто 3000 или 8080).
- **Эндпоинты:**
  - `GET /health` — проверка живости, возвращает `{"ok":true}`.
  - `POST /telegram/webhook` — сюда Telegram присылает обновления (сообщения, пересланные посты). Тело — JSON (Telegram Update).
- **Обработка одного сообщения (всё в одном запросе):**
  1. Парсим update, достаём `message` (text или caption).
  2. Нормализуем текст, собираем метаданные (канал, post_id, автор и т.д.) в объект для промпта.
  3. Загружаем промпт: из переменной `FORMAT_PROMPT` или из файла `prompts/format_prompt.md`. Подставляем `{{INPUT_TEXT}}` и `{{SOURCE_META}}`.
  4. Вызываем LLM (OpenRouter / OpenAI / Anthropic — выбор через `LLM_PROVIDER`).
  5. Отправляем ответ пользователю в Telegram через `fetch` к `api.telegram.org` (разбиваем на части по 4096 символов при необходимости).
  6. Если задан `DATABASE_URL`, пишем запись в Postgres: таблица `extractions` (chat_id, message_id, raw_output, extracted_data JSONB, source_meta, created_at). Таблица создаётся при первом обращении к БД (`CREATE TABLE IF NOT EXISTS`).
- **Telegram API:** не используем GrammY — только `fetch` к `https://api.telegram.org/bot<TOKEN>/sendMessage` и `setWebhook`. Код в `src/telegram.ts`.

---

## 3. Структура репозитория и ключевые файлы

```
TGB3/
├── src/
│   ├── index.ts           # Точка входа: HTTP, handleUpdate + handleCallbackQuery (кнопка)
│   ├── config/
│   │   ├── env.ts         # Переменные окружения + config.sheets (GOOGLE_SHEET_ID, credentials)
│   │   └── logger.ts      # Winston, JSON-логи
│   ├── bot/
│   │   ├── extract.ts     # Извлечение text/caption, sourceMeta, forwardPostId (для ссылки)
│   │   └── parse-ideya.ts # Парсер ответа бота → поля для таблицы (Название 1–3, Драйвер 1–5, Ссылка и т.д.)
│   ├── telegram.ts       # sendMessage (с опцией replyMarkup — кнопка под первым чанком), answerCallbackQuery, setWebhook
│   ├── sheets.ts          # appendIdeyaRow(): запись строки в Google Таблицу по заголовкам (googleapis)
│   ├── prompts/loader.ts
│   ├── llm/               # client + providers (openai, anthropic, openrouter)
│   └── db/
│       └── index.ts       # extractions (в т.ч. bot_message_id), saveExtraction(), getExtractionByBotMessage()
├── prompts/format_prompt.md   # Три названия, драйверы, формат вывода
├── docs/plan-sheets-export.md # План и инструкция по настройке Google (испанский UI)
├── package.json           # googleapis в зависимостях
├── .env.example
└── ...
```

---

## 4. Промпт и метаданные

- **Главный промпт** — в `prompts/format_prompt.md`. Описывает роль (редактор инвестиционного приложения), вход ({{INPUT_TEXT}}, {{SOURCE_META}}), глобальные правила, подсказки по извлечению полей и **строгий формат вывода**: Название, Автор идеи, Аналитик(и), Базовый актив, Целевая цена, Направление (лонг/шорт), Горизонт (дней), Драйверы роста, Источник.
- **Подстановки в коде:** `{{INPUT_TEXT}}` — текст сообщения; `{{SOURCE_META}}` — JSON с полями: `channel_title`, `channel_username`, `post_id`, `forward_from`, `author_signature`, `message_date`. Эти поля формируются в `index.ts` из `sourceMeta` (extract) и `messageId`.
- Переопределить промпт без правки файла: в Railway задать переменную **FORMAT_PROMPT** (весь текст промпта). Тогда файл не читается.

---

## 5. LLM-провайдеры

- **openrouter** (рекомендуется): ключ с openrouter.ai. Переменные: `LLM_PROVIDER=openrouter`, `OPENROUTER_API_KEY=sk-or-v1-...`, `LLM_MODEL=openai/gpt-4o-mini` (или другая модель с openrouter.ai).
- **openai**: напрямую api.openai.com. `LLM_PROVIDER=openai`, `OPENAI_API_KEY=sk-...`, `LLM_MODEL=gpt-4o-mini`.
- **anthropic**: напрямую. `LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY=...`, `LLM_MODEL=claude-3-5-sonnet-20241022`.

Валидация при старте: проверяется только выбранный провайдер и наличие его ключа.

---

## 6. База данных (Postgres)

- **Опционально:** если `DATABASE_URL` не задан, приложение работает без БД; **для кнопки «Отправить в таблицу» БД обязательна** (по bot_message_id ищем запись при нажатии).
- Таблица `extractions`: id, chat_id, message_id, **bot_message_id** (id сообщения бота с кнопкой), user_id, input_text_hash, raw_output, extracted_data JSONB, source_meta JSONB, created_at. При первом запуске: `ALTER TABLE ... ADD COLUMN IF NOT EXISTS bot_message_id`.
- После ответа с идеей: `saveExtraction({ ..., botMessageId: sentMessageId })` — сохраняем id сообщения, под которым висит кнопка. При нажатии кнопки: `getExtractionByBotMessage(chatId, botMessageId)` по callback_query.message — находим raw_output, парсим, отправляем строку в Sheets.

---

## 7. Railway: деплой и переменные

- **Сборка:** Nixpacks, `npm install` → `npm run build` (tsc) → `npm start`.
- **Публичный домен:** в настройках сервиса TGB3 (Networking) должен быть сгенерирован домен, например `tgb3-production.up.railway.app`. Иначе Telegram не сможет доставить webhook.
- **Webhook:** Telegram должен знать URL бота. Варианты:
  - Автоматически при старте: задать `SET_WEBHOOK=true`. Код берёт домен из `PUBLIC_URL` (без протокола и слэша) или `RAILWAY_PUBLIC_DOMAIN` и вызывает `setWebhook(https://<domain>/telegram/webhook)`. Если Railway не подставляет домен, вручную задать `PUBLIC_URL=https://tgb3-production.up.railway.app`.
  - Вручную один раз: открыть в браузере `https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://tgb3-production.up.railway.app/telegram/webhook`.
- **Проверка webhook:** `https://api.telegram.org/bot<TOKEN>/getWebhookInfo` — в `result.url` должен быть твой URL или пустая строка до настройки.

**Обязательные переменные в Railway (TGB3):**  
`TELEGRAM_BOT_TOKEN`, `LLM_PROVIDER`, `LLM_MODEL`, и ключ выбранного провайдера (`OPENROUTER_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`).

**Опционально:** `DATABASE_URL`, `SET_WEBHOOK`, `PUBLIC_URL`, `LOG_LEVEL`, `FORMAT_PROMPT`, **`GOOGLE_SHEET_ID`**, **`GOOGLE_SHEETS_CREDENTIALS_JSON`** (для кнопки «Отправить в таблицу» → запись в Google Таблицу).

---

## 8. Кнопка «Отправить в таблицу» и Google Sheets

- Под каждым ответом бота с идеей показывается **Inline-кнопка «Отправить в таблицу»** (кнопка привязана к **первому** сообщению при разбиении на чанки, чтобы была видна сразу).
- При нажатии: в webhook приходит `callback_query`; по `chat_id` и `message_id` сообщения с кнопкой ищем запись в `extractions` → парсим `raw_output` через `parseIdeyaBlock()` → вызываем `appendIdeyaRow()` → ответ пользователю: «Добавлено в таблицу» или «Запись не найдена» / «Таблица не настроена».
- **Парсер** (`src/bot/parse-ideya.ts`): из текста вида «Название 1: …», «Автор идеи: …», блок «Драйверы роста» (строки с «- ») собирает объект полей. Драйверы → Драйвер 1 … Драйвер 5, «Источник» → «Ссылка». Для таблицы заголовки: Название 1–3, Автор идеи, Аналитик(и), Базовый актив, Целевая цена, Стоп-лосс, Направление, Горизонт (дней), Драйвер 1–5, Ссылка, Дата (порядок столбцов в таблице любой — подстановка по названию заголовка).
- **Google Sheets:** `src/sheets.ts`, пакет `googleapis`. Читается первая строка листа как заголовки, строка данных подставляется по ним, добавляется колонка «Дата». Переменные: `GOOGLE_SHEET_ID`, `GOOGLE_SHEETS_CREDENTIALS_JSON` (JSON ключа сервисного аккаунта). Инструкция по настройке Google (в т.ч. испанский UI): `docs/plan-sheets-export.md`.

**Текущая проблема (для продолжения в новом чате):** при нажатии кнопки пользователь видит **«Запись не найдена»** — т.е. `getExtractionByBotMessage(chatId, botMessageId)` возвращает null. Добавлено логирование в Railway: при сохранении — «Saving extraction with bot_message_id» (sentMessageId, willSaveBotMessageId); при нажатии — «Callback: looking up extraction» (chatId, botMessageId); при отсутствии записи — «Callback: extraction not found». Вероятная причина: `sentMessageId` приходит 0 (не извлекаем message_id из ответа Telegram) и в БД сохраняется `bot_message_id = NULL`. Нужно по логам проверить значения и при необходимости поправить разбор ответа в `src/telegram.ts` (возврат message_id с первого чанка с кнопкой).

---

## 9. Что уже сделано и что решено

- Один процесс, fetch к Telegram API, без GrammY/Redis/BullMQ.
- Postgres: таблица `extractions` с `bot_message_id` для привязки кнопки к записи.
- Ссылка на пост: из `forward_origin.message_id` берётся id поста в канале; подстановка готовой ссылки в строку «Источник» (или «—» при отсутствии данных).
- Промпт: три варианта названия (деловой, Коммерсантъ, кликбейт), драйверы, стоп-лосс и т.д. в `prompts/format_prompt.md`.
- Кнопка «Отправить в таблицу»: отправка с replyMarkup под первым чанком, сохранение bot_message_id, обработка callback_query, парсер ответа, запись в Google Sheets по заголовкам. **В работе:** исправление «Запись не найдена» (см. п. 8).

---

## 10. Быстрый старт для нового чата

- Репозиторий: TGB3, Node.js + TypeScript, один HTTP-сервер, webhook для Telegram.
- Промпт: `prompts/format_prompt.md`, плейсхолдеры `{{INPUT_TEXT}}`, `{{SOURCE_META}}`. Три названия, драйверы 1–5, Ссылка.
- LLM: OpenRouter / OpenAI / Anthropic через `LLM_PROVIDER`.
- Деплой: Railway, переменные (в т.ч. `DATABASE_URL`, `GOOGLE_SHEET_ID`, `GOOGLE_SHEETS_CREDENTIALS_JSON` для кнопки).
- **Кнопка «Отправить в таблицу»:** под ответом бота; при нажатии — поиск по (chat_id, bot_message_id) в `extractions`, парсинг, append в Google Таблицу. Сейчас при нажатии показывается «Запись не найдена» — см. раздел 8 (логи, вероятно sentMessageId = 0).

Все решения и текущий статус — в этом README и в коде по путям выше.
