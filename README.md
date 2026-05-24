# whisper

Сервис распознавания речи на Flask + OpenAI Whisper. Раздаётся одним `docker compose up`:

- **backend** — Flask + gunicorn, эндпоинт `POST /transcribe`;
- **frontend** — nginx со статикой и прокси `/api/*` → backend.

Прод-цель: домашний сервер Lenovo (`192.168.1.34`), за **NGINX Proxy Manager**, на поддомене `https://whisper.home.node34.pro`.

## Структура

```
.
├── backend/                 # Flask-приложение
│   ├── app/
│   │   ├── __init__.py      # create_app()
│   │   ├── config.py
│   │   ├── routes/          # blueprints: health, transcribe
│   │   ├── services/        # whisper_service
│   │   └── utils/
│   ├── wsgi.py              # точка входа для gunicorn
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/                # статика + nginx
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── nginx.conf
│   └── Dockerfile
├── docs/learning/           # учебные конспекты
├── docker-compose.yml
└── .env.example
```

## Деплой на Lenovo

### 1. Скопировать проект на сервер (с Mac)

```bash
rsync -avz --progress \
  --exclude '.venv' --exclude '.git' --exclude '__pycache__' \
  --exclude 'assets' --exclude 'env' --exclude '.DS_Store' \
  --exclude '.env' \
  ./ ubuntu-home:~/whisper/
```

(`ubuntu-home` — твой SSH-алиас на `anton@192.168.1.34 -p 2294`.)

### 2. На сервере подготовить `.env`

```bash
ssh ubuntu-home
cd ~/whisper
cp .env.example .env
docker run --rm python:3.12-slim python -c "import secrets; print(secrets.token_urlsafe(48))"
# подставить вывод в .env как SECRET_KEY
nano .env
```

### 3. Поднять стек

```bash
docker compose up -d --build
docker compose logs -f
```

Сборка занимает несколько минут (тянется `openai-whisper`). Первая транскрипция дополнительно скачает модель `turbo` (~6 ГБ) в volume `whisper-cache`.

### 4. Добавить Proxy Host в NPM

Зайди в `https://npm.home.node34.pro` (нужен LAN или WG), `Hosts → Proxy Hosts → Add Proxy Host`:

**Details:**
- Domain Names: `whisper.home.node34.pro`
- Scheme: `http`
- Forward Hostname / IP: `whisper-frontend` (имя контейнера)
- Forward Port: `80`
- Block Common Exploits: ✓
- Websockets Support: ✓

**SSL:**
- SSL Certificate: `Request a new SSL Certificate`
- Force SSL: ✓
- HTTP/2 Support: ✓
- Email: твой
- I Agree: ✓

**Advanced** (важно! без этого сломаются крупные загрузки и долгие транскрипции):

```nginx
client_max_body_size 100M;
proxy_connect_timeout 60s;
proxy_send_timeout    600s;
proxy_read_timeout    600s;
proxy_request_buffering off;
```

NPM должен быть в той же docker-сети `proxy_network` (он уже там — там у тебя уже сидят fin-note/tasker).

### 5. Проверить

- `https://whisper.home.node34.pro` — UI с drag&drop.
- `https://whisper.home.node34.pro/api/health` → `{"status": "ok"}`.

## Обновление кода

Локально → rsync (шаг 1) → на сервере `docker compose up -d --build`.

## Эндпоинты

| Метод | URL (со стороны фронта) | Auth | URL внутри docker-сети |
| --- | --- | --- | --- |
| `GET` | `/api/health` | — | `http://backend:5000/health` |
| `POST` | `/api/login` | — | `http://backend:5000/login` |
| `POST` | `/api/transcribe` | `Bearer <token>` | `http://backend:5000/transcribe` |

`POST /api/login` принимает `{"username", "password"}` и возвращает `{"token", "ttl_seconds"}`. Дальше токен прикладывается заголовком `Authorization: Bearer <token>` к `/api/transcribe`. На фронте всё это автоматизировано: модалка логина при первом заходе, токен в `localStorage`, выход через кнопку «Выйти».

## Переменные окружения

| Имя | По умолчанию | Описание |
| --- | --- | --- |
| `SECRET_KEY` | обязательная | подпись auth-токенов (HMAC через `itsdangerous`) |
| `UI_USERNAME` | обязательная | логин для входа в UI и API |
| `UI_PASSWORD` | обязательная | пароль |
| `AUTH_TOKEN_TTL_SECONDS` | `2592000` (30 дней) | срок жизни токена |
| `WHISPER_MODEL` | `turbo` | `tiny`/`base`/`small`/`medium`/`large-v3`/`turbo` |
| `WHISPER_COMPUTE_TYPE` | `int8` | `int8`/`int8_float16`/`float16`/`float32` |
| `WHISPER_DEVICE` | `cpu` | `cpu`/`cuda`/`auto` |
| `MAX_CONTENT_LENGTH` | `104857600` (100 МБ) | лимит размера загружаемого файла |

## Локальная разработка (на Mac)

Если хочется погонять без сервера — добавь в `frontend` сервис `ports: ["8080:80"]` и убери `proxy_network` (или закомментируй блок), потом `docker compose up --build`. Открой http://localhost:8080.

## Учебные материалы

- `docs/learning/01-tempfile-vs-upload-folder.md` — почему `tempfile` лучше папки `upload/`.
