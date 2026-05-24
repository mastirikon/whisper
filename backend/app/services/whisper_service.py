import logging
from pathlib import Path
from typing import Any

from faster_whisper import BatchedInferencePipeline, WhisperModel

logger = logging.getLogger(__name__)

# openai-whisper использовал имя "turbo"; faster-whisper тянет ту же модель под именем large-v3-turbo
_MODEL_ALIASES = {
    "turbo": "large-v3-turbo",
}

_model_cache: dict[tuple[str, str, str], WhisperModel] = {}


def _resolve_model_name(name: str) -> str:
    return _MODEL_ALIASES.get(name, name)


def _get_model(name: str, device: str, compute_type: str, cache_dir: str | None) -> WhisperModel:
    resolved = _resolve_model_name(name)
    key = (resolved, device, compute_type)
    if key not in _model_cache:
        logger.info("loading whisper model: %s (device=%s, compute_type=%s)", resolved, device, compute_type)
        _model_cache[key] = WhisperModel(
            resolved,
            device=device,
            compute_type=compute_type,
            download_root=cache_dir,
        )
    return _model_cache[key]


def warmup(name: str, device: str, compute_type: str, cache_dir: str | None) -> None:
    """Загрузить модель в память при старте, чтобы первый юзерский запрос не ждал."""
    _get_model(name, device, compute_type, cache_dir)


def speech_to_text(
    file_path: str | Path,
    model: str = "turbo",
    device: str = "cpu",
    compute_type: str = "int8",
    cache_dir: str | None = None,
    beam_size: int = 1,
    vad: bool = True,
    batch_size: int = 8,
) -> dict[str, Any]:
    whisper_model = _get_model(model, device, compute_type, cache_dir)

    logger.info(
        "transcribing %s (beam_size=%d, vad=%s, batched=%s)",
        file_path, beam_size, vad, vad,
    )

    # BatchedInferencePipeline требует VAD (он внутри сам режет аудио по VAD-сегментам и обрабатывает их батчами).
    # Без VAD батчинг невозможен → fallback на обычный transcribe.
    if vad:
        pipeline = BatchedInferencePipeline(model=whisper_model)
        segments, info = pipeline.transcribe(
            str(file_path),
            beam_size=beam_size,
            batch_size=batch_size,
        )
    else:
        segments, info = whisper_model.transcribe(
            str(file_path),
            beam_size=beam_size,
            vad_filter=False,
        )

    text = "".join(seg.text for seg in segments).strip()
    return {
        "text": text,
        "language": info.language,
        "language_probability": info.language_probability,
        "duration": info.duration,
    }
