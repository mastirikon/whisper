import logging
from pathlib import Path
from typing import Any

from faster_whisper import WhisperModel

logger = logging.getLogger(__name__)

# openai-whisper использовал имя "turbo"; faster-whisper тянет ту же модель под именем large-v3-turbo
_MODEL_ALIASES = {
    "turbo": "large-v3-turbo",
}

_model_cache: dict[tuple[str, str, str], WhisperModel] = {}


def _resolve_model_name(name: str) -> str:
    return _MODEL_ALIASES.get(name, name)


def _get_model(name: str, device: str, compute_type: str, cache_dir: str | None) -> WhisperModel:
    key = (name, device, compute_type)
    if key not in _model_cache:
        logger.info("loading whisper model: %s (device=%s, compute_type=%s)", name, device, compute_type)
        _model_cache[key] = WhisperModel(
            name,
            device=device,
            compute_type=compute_type,
            download_root=cache_dir,
        )
    return _model_cache[key]


def speech_to_text(
    file_path: str | Path,
    model: str = "turbo",
    device: str = "cpu",
    compute_type: str = "int8",
    cache_dir: str | None = None,
) -> dict[str, Any]:
    resolved = _resolve_model_name(model)
    logger.info("transcribing %s with model %s", file_path, resolved)
    whisper_model = _get_model(resolved, device, compute_type, cache_dir)
    segments, info = whisper_model.transcribe(str(file_path))
    # segments — ленивый генератор; материализуем и склеиваем
    parts = [seg.text for seg in segments]
    text = "".join(parts).strip()
    return {
        "text": text,
        "language": info.language,
        "language_probability": info.language_probability,
        "duration": info.duration,
    }
