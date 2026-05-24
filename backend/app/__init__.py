from flask import Flask

from .config import Config
from .routes import register_routes
from .services.whisper_service import warmup as warmup_whisper
from .utils.logging_config import setup_logging


def create_app(config_class: type[Config] = Config) -> Flask:
    app = Flask(__name__)
    app.config.from_object(config_class)

    setup_logging(app)
    register_routes(app)

    @app.errorhandler(Exception)
    def handle_unexpected(e):
        app.logger.exception("unhandled error")
        return {"error": "internal"}, 500

    if app.config.get("WHISPER_WARMUP"):
        try:
            app.logger.info("whisper warmup: loading model into memory")
            warmup_whisper(
                name=app.config["WHISPER_MODEL"],
                device=app.config["WHISPER_DEVICE"],
                compute_type=app.config["WHISPER_COMPUTE_TYPE"],
                cache_dir=str(app.config["WHISPER_CACHE"]),
            )
            app.logger.info("whisper warmup: done")
        except Exception:
            # Не валим приложение — без warmup'а просто первый запрос будет медленнее
            app.logger.exception("whisper warmup failed, continuing without it")

    return app
