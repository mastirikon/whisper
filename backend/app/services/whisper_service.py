import logging
from pathlib import Path
from typing import Any

import whisper

logger = logging.getLogger(__name__)

_model_cache: dict[str, Any] = {}


def _get_model(name: str):
    if name not in _model_cache:
        logger.info("loading whisper model: %s", name)
        _model_cache[name] = whisper.load_model(name)
    return _model_cache[name]


def speech_to_text(file_path: str | Path, model: str = "turbo") -> dict[str, Any]:
    logger.info("transcribing %s with model %s", file_path, model)
    whisper_model = _get_model(model)
    return whisper_model.transcribe(str(file_path))
