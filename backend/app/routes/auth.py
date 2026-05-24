import hmac
import logging

from flask import Blueprint, current_app, jsonify, request
from flask.typing import ResponseReturnValue

from ..utils.auth import is_auth_configured, issue_token

logger = logging.getLogger(__name__)
auth_bp = Blueprint("auth", __name__)


@auth_bp.post("/login")
def login() -> ResponseReturnValue:
    if not is_auth_configured():
        return jsonify({"error": "auth not configured on server"}), 503

    payload = request.get_json(silent=True) or {}
    username = str(payload.get("username", ""))
    password = str(payload.get("password", ""))

    expected_user = current_app.config["UI_USERNAME"]
    expected_pass = current_app.config["UI_PASSWORD"]

    # constant-time сравнение, чтобы по времени ответа нельзя было перебирать символы
    user_ok = hmac.compare_digest(username, expected_user)
    pass_ok = hmac.compare_digest(password, expected_pass)
    if not (user_ok and pass_ok):
        logger.info("failed login attempt for username=%r", username)
        return jsonify({"error": "invalid credentials"}), 401

    return jsonify(
        {
            "token": issue_token(username),
            "ttl_seconds": current_app.config["AUTH_TOKEN_TTL_SECONDS"],
        }
    ), 200
