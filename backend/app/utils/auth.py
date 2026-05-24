from functools import wraps
from typing import Optional

from flask import current_app, jsonify, request
from flask.typing import ResponseReturnValue
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt="ui-auth")


def issue_token(username: str) -> str:
    return _serializer().dumps(username)


def verify_token(token: str, max_age_seconds: int) -> Optional[str]:
    try:
        return _serializer().loads(token, max_age=max_age_seconds)
    except (BadSignature, SignatureExpired):
        return None


def is_auth_configured() -> bool:
    return bool(current_app.config.get("UI_USERNAME") and current_app.config.get("UI_PASSWORD"))


def require_auth(view):
    @wraps(view)
    def wrapped(*args, **kwargs) -> ResponseReturnValue:
        if not is_auth_configured():
            return jsonify({"error": "auth not configured on server"}), 503

        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            return jsonify({"error": "auth required"}), 401

        token = header[len("Bearer "):]
        username = verify_token(token, current_app.config["AUTH_TOKEN_TTL_SECONDS"])
        if username is None:
            return jsonify({"error": "invalid or expired token"}), 401

        return view(*args, **kwargs)

    return wrapped
