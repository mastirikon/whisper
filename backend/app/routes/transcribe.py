import logging
import os
import tempfile

from flask import Blueprint, current_app, jsonify, request
from flask.typing import ResponseReturnValue

from ..services.whisper_service import speech_to_text
from ..utils.auth import require_auth

logger = logging.getLogger(__name__)
transcribe_bp = Blueprint("transcribe", __name__)


def _parse_bool(raw: str | None, default: bool) -> bool:
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _parse_beam_size(raw: str | None, default: int, allowed: tuple[int, ...]) -> int | None:
    """Возвращает валидный beam_size либо None, если значение вне whitelist."""
    if raw is None or raw == "":
        return default
    try:
        value = int(raw)
    except ValueError:
        return None
    if value not in allowed:
        return None
    return value


@transcribe_bp.post("/transcribe")
@require_auth
def transcribe() -> ResponseReturnValue:
    file = request.files.get("audio")
    if file is None or not file.filename:
        return jsonify({"error": "audio file required"}), 400

    allowed_exts: tuple[str, ...] = current_app.config["ALLOWED_EXTS"]
    filename = file.filename.lower()
    if not filename.endswith(allowed_exts):
        return jsonify({"error": f"allowed: {allowed_exts}"}), 415

    beam_size = _parse_beam_size(
        request.form.get("beam_size"),
        default=current_app.config["WHISPER_DEFAULT_BEAM_SIZE"],
        allowed=current_app.config["WHISPER_ALLOWED_BEAM_SIZES"],
    )
    if beam_size is None:
        allowed = current_app.config["WHISPER_ALLOWED_BEAM_SIZES"]
        return jsonify({"error": f"beam_size must be one of {allowed}"}), 400

    vad = _parse_bool(request.form.get("vad"), default=current_app.config["WHISPER_DEFAULT_VAD"])

    suffix = os.path.splitext(filename)[1]

    # tempfile.NamedTemporaryFile сам кладёт в системный /tmp и удаляет файл при выходе из with.
    # Подробнее: docs/learning/01-tempfile-vs-upload-folder.md
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as tmp:
        file.save(tmp.name)
        logger.info("saved temp file %s (%d bytes)", tmp.name, os.path.getsize(tmp.name))
        try:
            result = speech_to_text(
                tmp.name,
                model=current_app.config["WHISPER_MODEL"],
                device=current_app.config["WHISPER_DEVICE"],
                compute_type=current_app.config["WHISPER_COMPUTE_TYPE"],
                cache_dir=str(current_app.config["WHISPER_CACHE"]),
                beam_size=beam_size,
                vad=vad,
                batch_size=current_app.config["WHISPER_BATCH_SIZE"],
            )
            return jsonify({"text": result.get("text", "")}), 200
        except Exception:
            logger.exception("transcription failed")
            return jsonify({"error": "transcription failed"}), 500
