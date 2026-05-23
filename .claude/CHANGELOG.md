# Changelog сессии 2026-05-24

Подробный лог всех изменений, сделанных Claude'ом в этой сессии. Начальная точка — `Initial commit 176ce3d` (плоский `app/main.py`, `config.py`, `Dockerfile`, `run.sh` в корне; папка `upload/` для загрузок).

## 1. Структура проекта переделана под app factory

Старое:
```
app/main.py        # вся логика в одном файле
app/__init__.py    # пустой
app/modules/whisper/service.py
config.py          # в корне
requirements.txt   # в корне
Dockerfile         # в корне
run.sh             # flask --app app.main:app run
upload/            # папка для временных файлов
```

Новое:
```
backend/
├── app/
│   ├── __init__.py            # create_app() — app factory
│   ├── config.py              # читает env, без UPLOAD_FOLDER
│   ├── routes/
│   │   ├── __init__.py        # register_routes(app)
│   │   ├── health.py          # GET /health
│   │   └── transcribe.py      # POST /transcribe (на tempfile)
│   ├── services/
│   │   ├── __init__.py
│   │   └── whisper_service.py # whisper.load_model + _model_cache
│   └── utils/
│       ├── __init__.py
│       └── logging_config.py
├── wsgi.py                    # точка входа для gunicorn → app
├── requirements.txt
├── Dockerfile
└── .dockerignore
frontend/
├── index.html                 # drag&drop UI
├── styles.css                 # тёмная тема, violet/cyan
├── app.js                     # fetch /api/transcribe
├── nginx.conf                 # / → static; /api/ → backend:5000
├── Dockerfile
└── .dockerignore
docs/learning/
└── 01-tempfile-vs-upload-folder.md
.claude/
├── CLAUDE.md                  # карта проекта + правила для Claude'a
└── CHANGELOG.md               # этот файл
docker-compose.yml             # backend + frontend, frontend в proxy_network
.env.example
.gitignore                     # переработан
README.md                      # деплой-инструкция под Lenovo + NPM
```

Удалены: `config.py`, `Dockerfile`, `run.sh`, `requirements.txt`, `app/`, `upload/`, `__pycache__/` из корня.

## 2. Backend — что изменилось

### App factory + Blueprint'ы
- `app/__init__.py` теперь экспортирует `create_app(config_class)` — стандартный Flask-паттерн.
- Роуты разделены на blueprint'ы (`health_bp`, `transcribe_bp`) и регистрируются через `register_routes(app)`.
- Глобальный `@app.errorhandler(Exception)` остался — отдаёт `{"error": "internal"}, 500`.

### Конфиг через env
- `Config.SECRET_KEY` → `os.environ["SECRET_KEY"]` (раньше хардкод).
- Добавлен `MAX_CONTENT_LENGTH` (по умолчанию 100 МБ).
- Добавлен `WHISPER_MODEL` (по умолчанию `turbo`).
- Добавлен `WHISPER_CACHE` (для volume).
- **Удалён `UPLOAD_FOLDER`** — больше не нужен (см. пункт 3).
- Три класса: `Config` / `DevelopmentConfig` / `ProductionConfig`. Выбор по `FLASK_ENV` в `wsgi.py`.

### `transcribe` переведён на `tempfile`
Было:
```python
dir_path: Path = current_app.config["UPLOAD_FOLDER"]
dir_path.mkdir(parents=True, exist_ok=True)
file_path = dir_path / safe_name
file.save(file_path)
try:
    result = whisper.speech_to_text(file_path)
    return {"text": result.get("text")}, 200
except Exception:
    ...
finally:
    file_path.unlink(missing_ok=True)
```
Стало:
```python
with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as tmp:
    file.save(tmp.name)
    try:
        result = speech_to_text(tmp.name, ...)
        return jsonify({"text": result.get("text", "")}), 200
    except Exception:
        logger.exception("transcription failed")
        return jsonify({"error": "transcription failed"}), 500
```
Параллельный учебный конспект — `docs/learning/01-tempfile-vs-upload-folder.md`.

### `whisper_service` теперь кэширует модель
- Раньше `whisper.load_model(model)` вызывался **на каждый запрос** → каждый запрос тянул ~6 ГБ с диска в RAM.
- Теперь `_model_cache: dict[str, Any]` — первый запрос грузит, дальше переиспользует.

### Логирование
- Единая настройка в `app/utils/logging_config.py`.
- `setup_logging(app)` вызывается из `create_app`.
- Из роутов убраны `print(...)` — теперь только `logger.info/exception`.

### requirements.txt
- Убран неиспользуемый `pydantic`.
- `gunicorn` оставлен (теперь реально используется).
- Версии: Flask 3.1.3, gunicorn 23.0.0, openai-whisper 20250625.

### wsgi.py
- Новая точка входа для gunicorn: `from app import create_app; app = create_app(...)`.
- Выбор конфига по `FLASK_ENV` (по умолчанию production).
- `if __name__ == "__main__":` для локального запуска без gunicorn.

## 3. Frontend — новый

Полноценный UI на vanilla JS/HTML/CSS:
- Drag & drop загрузка с подсветкой dropzone.
- Валидация расширения и размера на клиенте.
- Прогресс-индикатор во время транскрипции.
- Результат в textarea с кнопками «Скопировать» и «Скачать .txt».
- Тёмная тема, glassmorphism, акценты violet/cyan, респонсив до 520px.
- Запросы идут на `/api/transcribe` (префикс снимает nginx).

## 4. Dockerfile под Linux

### `backend/Dockerfile`
Старое: `python:3.14.3-alpine` + `apt-get install ffmpeg` (несовместимо — `apt-get` нет в Alpine), `CMD ["python", "main.py"]` (точка входа не существовала).

Новое:
- База `python:3.12-slim` (Alpine плохо работает с ML-зависимостями).
- `apt-get install -y --no-install-recommends ffmpeg curl`.
- Non-root user `appuser` (uid 1000).
- `pip install -r requirements.txt` отдельным слоем (кэш).
- `HEALTHCHECK` на `/health`.
- `CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "1", "--threads", "4", "--timeout", "600", "wsgi:app"]`.
- `ENV UPLOAD_FOLDER=/tmp/uploads WHISPER_CACHE=/home/appuser/.cache/whisper`.

### `frontend/Dockerfile`
- `nginx:1.27-alpine`.
- Копирует `index.html`, `styles.css`, `app.js` + `nginx.conf`.
- `HEALTHCHECK` curl'ом на `/`.

### `frontend/nginx.conf`
- `/` → статика с fallback на `index.html`.
- `/api/` → `proxy_pass http://backend:5000/`.
- `client_max_body_size 100M`, `proxy_*_timeout 600s` — критично для долгих транскрипций.
- `gzip` на css/js/svg.

## 5. docker-compose.yml — финальная версия (под Lenovo)

Переписан **дважды**:
- сначала с `ports: 8080:80` на хост (универсальный вариант);
- потом, после изучения карты инфры пользователя (Lenovo + NPM), — на external network `proxy_network`.

Текущая версия:
- `backend` только в `app-net`, наружу не торчит.
- `frontend` в `app-net` (для backend) и в `proxy_network` (для NPM).
- Volume `whisper-cache` для моделей (~6 ГБ для turbo).
- `proxy_network` помечена как `external: true` — это та же сеть, в которой уже сидят fin-note, tasker, NPM.

## 6. Деплой план

В `README.md` записаны точные шаги:
1. `rsync ./ ubuntu-home:~/speech-to-text/` с Mac (исключая `.venv`, `.git`, `assets`, `env`, `.env`).
2. На сервере: `cp .env.example .env`, генерация `SECRET_KEY`, `docker compose up -d --build`.
3. В NPM (`https://npm.home.node34.pro`) — Proxy Host `whisper.home.node34.pro` → `speech-to-text-frontend:80`, Let's Encrypt, **обязательно** Advanced:
   ```
   client_max_body_size 100M;
   proxy_connect_timeout 60s;
   proxy_send_timeout    600s;
   proxy_read_timeout    600s;
   proxy_request_buffering off;
   ```

## 7. Документация

- `README.md` — деплой инструкция, эндпоинты, env-переменные.
- `.claude/CLAUDE.md` — карта проекта + правила для Claude'a в будущих сессиях.
- `docs/learning/01-tempfile-vs-upload-folder.md` — учебный конспект про tempfile и контекстные менеджеры (с Node-параллелями).

## 8. Auto-memory обновлена

В общей памяти пользователя (`/Users/anton/.claude/projects/-Users-anton/memory/project_homelab_network.md`) добавлен новый сервис `whisper.home.node34.pro` в список Proxy-hosted сервисов на Lenovo (рядом с Immich, fin-note, tasker, NPM admin).

В памяти проекта (`/Users/anton/.claude/projects/-Users-anton-DEV-myProjects-speech-to-text/memory/`) добавлен файл `infra_nginx_proxy_manager.md` — общий паттерн работы с NPM при деплое (поскольку у пользователя это типовая инфра).

## После переименования папки в `whisper`

Что точно нужно поправить:

1. **Имя пути в auto-memory**: после переименования папки путь к memory изменится. Текущая память лежит в:
   `/Users/anton/.claude/projects/-Users-anton-DEV-myProjects-speech-to-text/memory/`
   После переименования Claude будет искать в:
   `/Users/anton/.claude/projects/-Users-anton-DEV-myProjects-whisper/memory/`
   Содержимое нужно вручную перенести:
   ```bash
   mv ~/.claude/projects/-Users-anton-DEV-myProjects-speech-to-text \
      ~/.claude/projects/-Users-anton-DEV-myProjects-whisper
   ```

2. **README.md**: упоминание `~/speech-to-text/` в шагах деплоя — поменять на `~/whisper/`.

3. **`.gitignore`**: упоминание `upload/` (legacy, можно оставить как safety net).

Что **можно** поправить (но не обязательно — это про container_names и compose project):

4. **`container_name`** в `docker-compose.yml`: сейчас `speech-to-text-backend` / `speech-to-text-frontend`. Если переименуешь:
   - В compose поменять `container_name:` на `whisper-backend` / `whisper-frontend`.
   - В NPM Proxy Host `Forward Hostname` → `whisper-frontend`.
   - В `.claude/CLAUDE.md` упоминания контейнеров поправить.
   - В общей auto-memory `project_homelab_network.md` поменять имя контейнера в записи про `whisper.home.node34.pro`.

5. **`image:`** в compose: сейчас `speech-to-text-backend` / `speech-to-text-frontend`. Если переименуешь — также `whisper-backend` / `whisper-frontend`.

Если хочешь — могу сделать всё это одним заходом, когда переедешь.
