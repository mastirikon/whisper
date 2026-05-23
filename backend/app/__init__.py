from flask import Flask

from .config import Config
from .routes import register_routes
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

    return app
