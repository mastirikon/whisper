from flask import Flask

from .health import health_bp
from .transcribe import transcribe_bp


def register_routes(app: Flask) -> None:
    app.register_blueprint(health_bp)
    app.register_blueprint(transcribe_bp)
