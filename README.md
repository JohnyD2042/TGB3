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
│   ├── index.ts           # Точка входа: HTTP-сервер, POST /telegram/webhook → handleUpdate
│   ├── config/
│   │   ├── env.ts         # Все переменные окружения, validateConfig()
│   │   └── logger.ts      # Winston, JSON-логи
│   ├── bot/
│   │   └── extract.ts     # Извлечение text/caption, нормализация, MessageLike, sourceMeta
│   ├── telegram.ts       # sendMessage (fetch), setWebhook
│   ├── prompts/
│   │   └── loader.ts      # Загрузка промпта: FORMAT_PROMPT env или prompts/format_prompt.md
│   ├── llm/
│   │   ├── client.ts      # getLLMClient() по LLM_PROVIDER (openai | anthropic | openrouter)
│   │   └── providers/
│   │       ├── openai.ts
│   │       ├── anthropic.ts
│   │       └── openrouter.ts   # OpenAI-совместимый клиент, baseURL openrouter.ai
│   └── db/
│       └── index.ts       # initDb(), saveExtraction(), таблица extractions
├── prompts/
│   └── format_prompt.md   # Основной промпт "инвестидея" (редактировать здесь или через FORMAT_PROMPT)
├── package.json
├── tsconfig.json
├── railway.json           # startCommand: npm start
├── nixpacks.toml          # Фазы сборки для Railway
└── .env.example            # Список имён переменных для Railway
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

- **Опционально:** если `DATABASE_URL` не задан, приложение работает без БД (saveExtraction и initDb ничего не делают).
- При наличии `DATABASE_URL`: при старте вызывается `initDb()` — создаётся таблица `extractions` (id, chat_id, message_id, user_id, input_text_hash, raw_output, extracted_data JSONB, source_meta JSONB, created_at). После каждого ответа пользователю вызывается `saveExtraction()` — сохраняется сырой ответ и при наличии JSON в ответе LLM — разобранные данные в `extracted_data`. Это задел под выгрузку в Google Sheets.

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

**Опционально:** `DATABASE_URL` (из сервиса Postgres), `SET_WEBHOOK`, `PUBLIC_URL`, `LOG_LEVEL`, `FORMAT_PROMPT`.

---

## 8. Что уже сделано и что решено

- Убраны Redis, BullMQ, воркер, GrammY — оставлен один процесс и fetch к Telegram API для простоты и стабильного деплоя.
- Postgres добавлен опционально; таблица `extractions` — под будущий экспорт в Google Sheets.
- Промпт инвестидеи встроен в `prompts/format_prompt.md`; метаданные для промпта формируются в коде (channel_title, channel_username, post_id и т.д.).
- Добавлен провайдер OpenRouter (ключ openrouter.ai не подходит для api.openai.com — поэтому сделан отдельный провайдер).
- Исправлены типы (MessageLike, msg.chat guard), логгер (winston — первый аргумент строка), сборка под Railway (crypto import, @types в dependencies, nixpacks.toml).

---

## 9. Что можно делать дальше

- **Экспорт в Google Sheets:** читать из таблицы `extractions` (raw_output и/или extracted_data) и записывать строки в Google Таблицу (API или сервисный аккаунт).
- **Парсинг структурированных полей:** если промпт будет возвращать стабильный формат или JSON в конце — парсить в `extracted_data` и использовать для колонок в Sheets.
- Правка промпта: редактировать `prompts/format_prompt.md` в репозитории или переменную `FORMAT_PROMPT` в Railway.

---

## 10. Быстрый старт для нового чата

- Репозиторий: TGB3, Node.js + TypeScript, один HTTP-сервер, webhook для Telegram.
- Промпт: `prompts/format_prompt.md`, плейсхолдеры `{{INPUT_TEXT}}`, `{{SOURCE_META}}`.
- LLM: OpenRouter (по умолчанию) или OpenAI/Anthropic через `LLM_PROVIDER` и соответствующий ключ.
- Деплой: Railway, сервис TGB3, домен в Networking, webhook выставить вручную или через `SET_WEBHOOK=true` и `PUBLIC_URL`/`RAILWAY_PUBLIC_DOMAIN`.
- БД: Postgres по желанию, `extractions` для сырых ответов и структурированных данных под Google Sheets.

Все перечисленные решения и логика отражены в этом README и в коде по путям выше.
