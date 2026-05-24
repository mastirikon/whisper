from flask import Flask

from .auth import auth_bp
from .health import health_bp
from .transcribe import transcribe_bp


def register_routes(app: Flask) -> None:
    app.register_blueprint(health_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(transcribe_bp)
