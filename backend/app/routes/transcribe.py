import logging
import os
import tempfile

from flask import Blueprint, current_app, jsonify, request
from flask.typing import ResponseReturnValue

from ..services.whisper_service import speech_to_text

logger = logging.getLogger(__name__)
transcribe_bp = Blueprint("transcribe", __name__)


@transcribe_bp.post("/transcribe")
def transcribe() -> ResponseReturnValue:
    file = request.files.get("audio")
    if file is None or not file.filename:
        return jsonify({"error": "audio file required"}), 400

    allowed_exts: tuple[str, ...] = current_app.config["ALLOWED_EXTS"]
    filename = file.filename.lower()
    if not filename.endswith(allowed_exts):
        return jsonify({"error": f"allowed: {allowed_exts}"}), 415

    suffix = os.path.splitext(filename)[1]

    # tempfile.NamedTemporaryFile сам кладёт в системный /tmp и удаляет файл при выходе из with.
    # delete=False нужен, чтобы whisper мог открыть файл по пути на Windows; на Linux/macOS не критично.
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
            )
            return jsonify({"text": result.get("text", "")}), 200
        except Exception:
            logger.exception("transcription failed")
            return jsonify({"error": "transcription failed"}), 500
