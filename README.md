# TGB3 — Telegram-бот для анализа сообщений

Один процесс: принимает сообщения по webhook, прогоняет через LLM, отправляет ответ. Без Redis, без отдельного воркера, без GrammY — только Node.js и fetch к Telegram API.

## Переменные в Railway

В Railway переменные задаются вручную. Чтобы не искать названия по коду:

1. Открой проект в Railway → свой сервис (блок с приложением).
2. Вкладка **Variables** (или **Settings** → **Variables**).
3. Нажми **+ New Variable** / **Add Variable** и добавляй по одной. Имена — ниже (значения вводишь сам).

**Обязательные (без них бот не запустится):**

| Имя переменной      | Пример значения   | Где взять |
|---------------------|-------------------|-----------|
| `TELEGRAM_BOT_TOKEN`| (длинная строка)  | @BotFather в Telegram → /newbot |
| `LLM_PROVIDER`      | `openrouter` или `openai` | `openrouter` / `openai` / `anthropic` |
| `LLM_MODEL`         | `openai/gpt-4o-mini`      | ID модели (для OpenRouter: openai/gpt-4o-mini, anthropic/claude-3.5-sonnet и т.д.) |
| `OPENROUTER_API_KEY`| `sk-or-v1-...`            | ключ с openrouter.ai (если LLM_PROVIDER=openrouter) |
| `OPENAI_API_KEY`    | `sk-...`                  | если используешь openai напрямую |

Если используешь Anthropic напрямую: `LLM_PROVIDER=anthropic`, `LLM_MODEL=claude-3-5-sonnet-20241022`, переменная `ANTHROPIC_API_KEY`.

**Для сохранения в БД и выгрузки в Google Sheets:** добавь Postgres в Railway (Database → Postgres), скопируй `DATABASE_URL` в переменные сервиса с ботом. Тогда каждое обработанное сообщение пишется в таблицу `extractions` (сырой ответ и извлечённые параметры в JSON). Дальше можно настроить экспорт в Google Sheets.

**По желанию:** `SET_WEBHOOK=true`, `LOG_LEVEL=info`, `FORMAT_PROMPT`.

## Промпт

По умолчанию используется файл `prompts/format_prompt.md` в репозитории. Можно переопределить переменной `FORMAT_PROMPT` в Railway. В промпте можно использовать `{{INPUT_TEXT}}` и `{{SOURCE_META}}`.

## Локально

```bash
npm install
npm run build
# Задай переменные в .env (TELEGRAM_BOT_TOKEN, LLM_PROVIDER, LLM_MODEL, OPENAI_API_KEY)
npm start
```

После деплоя в Railway у сервиса появится домен. Webhook для Telegram: `https://ТВОЙ-ДОМЕН.up.railway.app/telegram/webhook`. Либо включи `SET_WEBHOOK=true` и задай домен через Railway (он подставит `RAILWAY_PUBLIC_DOMAIN`).
