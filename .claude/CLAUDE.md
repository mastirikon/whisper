# speech-to-text

## ВАЖНО для Claude

**В начале каждой сессии и перед нетривиальными изменениями проверяй каталог `.claude/` в корне проекта.** Там лежат заметки по архитектуре, договорённости и подсказки, которые могут изменить подход к задаче.

Также проверяй `docs/learning/` — там хранятся учебные конспекты по уже разобранным темам. Если приходишь объяснять что-то, что уже разобрано в уроке, опирайся на конспект, а не объясняй с нуля заново.

И **обязательно** обращайся к общему auto-memory (`/Users/anton/.claude/projects/-Users-anton/memory/`) — в частности к `project_homelab_network.md` и `project_wireguard_keenetic.md`. Там реальный контекст домашней инфры пользователя (Lenovo, NPM, домен, WG, SSH-порт и т.п.).

## Что это за проект

Сервис распознавания речи: Flask + OpenAI Whisper в backend'е, nginx со статикой во фронте.

Пользователь — Node.js dev, изучает Flask и Python. Объяснения на русском, с параллелями к Express/Node. Обычно код пишет сам, но в рефакторинговых/инфраструктурных задачах может явно попросить «сделай сам».

## Прод-таргет

- Сервер: **Lenovo ThinkCentre**, Ubuntu 24.04, `192.168.1.34`. SSH: `ssh ubuntu-home` (= `anton@192.168.1.34 -p 2294`).
- Деплой через NPM (`https://npm.home.node34.pro`) на поддомен **`https://whisper.home.node34.pro`** (Let's Encrypt автоматом).
- Compose-файл лежит на сервере в `~/speech-to-text/`. Заливка с Mac через `rsync ./ ubuntu-home:~/speech-to-text/`.
- Сервисы подключены к external docker-сети **`proxy_network`** — там уже сидят NPM, fin-note, tasker. Никаких публичных портов наружу.

## Архитектура

```
.
├── backend/                       # Flask + gunicorn
│   ├── app/
│   │   ├── __init__.py            # create_app() app factory
│   │   ├── config.py              # Config через env (SECRET_KEY, WHISPER_MODEL, …)
│   │   ├── routes/                # Blueprint'ы
│   │   │   ├── __init__.py        # register_routes(app)
│   │   │   ├── health.py          # GET /health
│   │   │   └── transcribe.py      # POST /transcribe (использует tempfile)
│   │   ├── services/
│   │   │   └── whisper_service.py # ленивая загрузка модели + кэш _model_cache
│   │   └── utils/
│   │       └── logging_config.py
│   ├── wsgi.py                    # entrypoint для gunicorn → app
│   ├── requirements.txt           # Flask, gunicorn, openai-whisper
│   ├── Dockerfile                 # python:3.12-slim + ffmpeg + non-root
│   └── .dockerignore
├── frontend/                      # статика + nginx
│   ├── index.html                 # drag&drop UI
│   ├── styles.css                 # тёмная тема, violet/cyan акценты
│   ├── app.js                     # fetch /api/transcribe
│   ├── nginx.conf                 # / → static; /api/ → backend:5000
│   ├── Dockerfile                 # nginx:1.27-alpine
│   └── .dockerignore
├── docs/learning/                 # учебные конспекты для пользователя
│   └── 01-tempfile-vs-upload-folder.md
├── docker-compose.yml             # backend + frontend, frontend в proxy_network
├── .env.example
├── .gitignore
└── README.md
```

## Сетевая раскладка

```
[NPM на Lenovo, proxy_network]
        │
        │ proxy_pass http://speech-to-text-frontend:80
        ▼
[frontend (nginx)]  ── app-net ──>  [backend (gunicorn)]
        ▲                                    │
   /api/ → backend:5000                volume: whisper-cache
   / → /usr/share/nginx/html
```

- `backend` сидит **только** в `app-net` — наружу не виден, доступен только из `frontend`.
- `frontend` сидит и в `app-net` (для проксирования на backend), и в `proxy_network` (для NPM).
- Никаких `ports:` — наружу всё только через NPM по HTTPS.

## Эндпоинты

- `GET /health` → `{"status": "ok"}`.
- `POST /transcribe` — multipart с полем `audio`. Использует `tempfile.NamedTemporaryFile`. `whisper.load_model` кэшируется в памяти.
- Со стороны фронта оба за префиксом `/api/`.

## NPM Advanced для Proxy Host (важно!)

В NPM по умолчанию лимит `client_max_body_size 1m` и read timeout ~60s — это убьёт загрузку крупных аудио и долгие транскрипции. В Proxy Host → Advanced обязательно:

```nginx
client_max_body_size 100M;
proxy_connect_timeout 60s;
proxy_send_timeout    600s;
proxy_read_timeout    600s;
proxy_request_buffering off;
```

## Уже принятые решения

- Папку `upload/` не используем — заменено на `tempfile.NamedTemporaryFile` в `with`-блоке. Подробности в `docs/learning/01-tempfile-vs-upload-folder.md`. `UPLOAD_FOLDER` из `config.py` удалён.
- App factory (`create_app`) + Blueprint'ы — вместо плоского `app/main.py`.
- gunicorn вместо dev-сервера Flask. 1 worker + 4 threads, timeout 600s.
- python:3.12-slim вместо Alpine — у Whisper тяжёлые ML-зависимости, на Alpine собирается часами.
- Whisper-модель кэшируется в памяти процесса (`_model_cache`) — первый запрос грузит, дальше переиспользует.
- Frontend nginx сам проксирует `/api/` на backend (а не NPM) — так NPM работает с одним upstream'ом, как у fin-note/tasker.

## Стиль работы

- Объясняй на русском, с параллелями к Node.js/Express где уместно.
- Сначала теория и разбор паттерна, потом — если попросит — код.
- В обычном режиме код пишет пользователь сам (teaching mode). В рефакторинге/инфре, если пользователь явно говорит «поправь сам всё», — делать самому.
- Когда тема может пригодиться повторно — фиксируй в `docs/learning/` нумерованным конспектом.

## Чего пока нет (если будут нужны — обсуждать)

- Тестов (`backend/tests/` пуст).
- Аутентификации (стоит ли добавить Authelia когда она приедет на лева — открытый вопрос).
- Стриминга прогресса транскрипции (Whisper-API такой не даёт легко).
- HTTPS — его делает NPM, в нашем nginx-фронте только HTTP.
