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
| `LLM_PROVIDER`      | `openai`          | буквально `openai` или `anthropic` |
| `LLM_MODEL`         | `gpt-4o-mini`     | название модели |
| `OPENAI_API_KEY`    | `sk-...`         | platform.openai.com → API keys |

Если используешь Anthropic: `LLM_PROVIDER=anthropic`, `LLM_MODEL=claude-3-5-sonnet-20241022`, переменная `ANTHROPIC_API_KEY`.

**По желанию:** `SET_WEBHOOK=true` (один раз, чтобы бот сам прописал webhook по домену Railway), `LOG_LEVEL=info`, `FORMAT_PROMPT` (текст промпта вместо файла).

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
