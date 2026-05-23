from flask import Blueprint, jsonify
from flask.typing import ResponseReturnValue

health_bp = Blueprint("health", __name__)


@health_bp.get("/health")
def health() -> ResponseReturnValue:
    return jsonify({"status": "ok"}), 200
