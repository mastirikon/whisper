import os
from pathlib import Path


def _env_bool(name: str, default: bool = False) -> bool:
    return os.environ.get(name, "1" if default else "0").lower() in ("1", "true", "yes", "on")


class Config:
    SECRET_KEY: str = os.environ.get("SECRET_KEY", "dev-secret-change-me")
    DEBUG: bool = _env_bool("FLASK_DEBUG", False)
    CSRF_ENABLED: bool = True

    ALLOWED_EXTS: tuple[str, ...] = (".m4a", ".mp3", ".wav", ".ogg", ".flac")
    MAX_CONTENT_LENGTH: int = int(os.environ.get("MAX_CONTENT_LENGTH", 100 * 1024 * 1024))

    UI_USERNAME: str = os.environ.get("UI_USERNAME", "")
    UI_PASSWORD: str = os.environ.get("UI_PASSWORD", "")
    # 30 дней по умолчанию — закрыли модалку, пользуемся месяц без повторного логина
    AUTH_TOKEN_TTL_SECONDS: int = int(os.environ.get("AUTH_TOKEN_TTL_SECONDS", 60 * 60 * 24 * 30))

    WHISPER_MODEL: str = os.environ.get("WHISPER_MODEL", "turbo")
    WHISPER_CACHE: Path = Path(os.environ.get("WHISPER_CACHE", str(Path.home() / ".cache" / "whisper")))
    WHISPER_DEVICE: str = os.environ.get("WHISPER_DEVICE", "cpu")
    WHISPER_COMPUTE_TYPE: str = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")


class DevelopmentConfig(Config):
    DEBUG = True


class ProductionConfig(Config):
    DEBUG = False
