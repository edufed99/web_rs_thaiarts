"""
services/embedding.py — Lazy-loaded E5 embedder for the admin ingest slice.

The recommender historically reads precomputed embeddings from
``artifacts/models/item_embeddings.npz`` (see ``model_loader.ArtifactLoader``).
The admin slice needs to **embed a new item at runtime** so the loader can
append it; we use the same model + the same text-formatting as the offline
pipeline (``pipelines/train_or_generate_artifacts.build_item_text``) so the
new vector lives in the same embedding space as the existing ones.

The model is ~2.5 GB and is downloaded on first ingest. To avoid paying
that cost during tests, ``settings.e5_enabled=False`` short-circuits the
loader and ``encode_text`` raises ``RuntimeError``. Tests monkeypatch
``_ensure_model`` instead.

Locking
-------
``_model`` is module-level state protected by ``_lock`` (double-checked).
Concurrent ``encode_text`` calls share the model after first load.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from typing import Dict, List, Optional

import numpy as np

from ..core.config import get_settings


logger = logging.getLogger("recsys.embedding")

_model: Optional[object] = None  # sentence_transformers.SentenceTransformer
_lock = threading.Lock()
_runtime: Dict[str, object] = {
    "status": "not_loaded",
    "model": "",
    "device": "cpu",
    "loaded_at": None,
    "load_latency_ms": None,
    "last_inference_latency_ms": None,
    "last_error": None,
}


# --- Model lifecycle --------------------------------------------------------


def _ensure_model():
    """Return the lazily-loaded SentenceTransformer; download on first call.

    Honours ``settings.e5_local_path`` if set so operators can preload a
    HF-cache snapshot; otherwise the library will download the snapshot
    named by ``settings.e5_model_name``.
    """
    global _model
    settings = get_settings()
    if not settings.e5_enabled:
        raise RuntimeError(
            "E5 embedding is disabled (RECSYS_E5_ENABLED=0). "
            "Set RECSYS_E5_ENABLED=1 or preload a model."
        )
    if _model is not None:
        return _model
    with _lock:
        if _model is not None:
            return _model
        # Imported lazily so test envs without sentence-transformers don't fail
        # at import time.
        from sentence_transformers import SentenceTransformer  # type: ignore

        name = settings.e5_model_name
        cache_folder = str(settings.e5_local_path) if settings.e5_local_path else None
        logger.info("loading E5 model %s (cache=%s)", name, cache_folder)
        started = time.perf_counter()
        _runtime.update({"status": "loading", "model": name, "last_error": None})
        try:
            model = SentenceTransformer(
                name,
                device="cpu",
                cache_folder=cache_folder,
                trust_remote_code=True,
            )
            if hasattr(model, "max_seq_length"):
                model.max_seq_length = min(model.max_seq_length, settings.e5_max_length)
            _model = model
            latency = round((time.perf_counter() - started) * 1000, 3)
            _runtime.update({
                "status": "ready",
                "loaded_at": datetime.now(timezone.utc).isoformat(),
                "load_latency_ms": latency,
            })
            logger.info("E5 model ready in %.3f ms", latency)
            return _model
        except Exception as exc:
            _runtime.update({
                "status": "error",
                "load_latency_ms": round((time.perf_counter() - started) * 1000, 3),
                "last_error": str(exc),
            })
            logger.exception("E5 model failed to load: %s", exc)
            raise


def reset_model_cache() -> None:
    """Drop the loaded model. Test helper."""
    global _model
    with _lock:
        _model = None
        _runtime.update({
            "status": "not_loaded",
            "model": "",
            "loaded_at": None,
            "load_latency_ms": None,
            "last_inference_latency_ms": None,
            "last_error": None,
        })


def preload_model() -> Dict[str, object]:
    """Load E5 and run one warm-up query; returns safe runtime telemetry."""
    _ensure_model()
    encode_query("ศิลปะการแสดงไทย")
    return runtime_status()


def runtime_status() -> Dict[str, object]:
    """Return a copy of model telemetry suitable for health/API responses."""
    return dict(_runtime)


# --- Text construction (must match pipeline) -------------------------------


def build_item_text(item: Dict, kw_names: List[str], ctx_names: List[str]) -> str:
    """Mirror ``pipelines.train_or_generate_artifacts.build_item_text``.

    Must produce byte-identical strings for the same inputs so the new
    vector is in the same embedding space as the artifact corpus.  The
    keyword/context arguments remain for API compatibility but are
    deliberately excluded: the paper defines item text as name + description.
    """
    parts = [item.get("name", ""), item.get("description", "")]
    return " ".join(p for p in parts if p).strip()


# --- Public encode API ------------------------------------------------------


def encode_text(text: str) -> np.ndarray:
    """Embed a single text string. Returns a 1-D float32 vector.

    The prefix convention mirrors ``old code/4.recommendation/cbf.py``:
    E5-instruct passages use raw text, non-instruct E5 passages use
    ``passage: ``.
    """
    if not isinstance(text, str) or not text.strip():
        raise ValueError("encode_text requires a non-empty str")
    settings = get_settings()
    model = _ensure_model()
    vec = _encode(model, f"{_passage_prefix(settings.e5_model_name)}{text.strip()}")
    return vec.astype(np.float32)


def encode_query(text: str) -> np.ndarray:
    """Embed a query string using the same E5 query prefix as the experiment."""
    if not isinstance(text, str) or not text.strip():
        raise ValueError("encode_query requires a non-empty str")
    settings = get_settings()
    model = _ensure_model()
    vec = _encode(model, f"{_query_prefix(settings.e5_model_name)}{text.strip()}")
    return vec.astype(np.float32)


def _encode(model: object, text: str) -> np.ndarray:
    started = time.perf_counter()
    try:
        vec = model.encode(
            [text],
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        )[0]
        _runtime.update({
            "status": "ready",
            "last_inference_latency_ms": round((time.perf_counter() - started) * 1000, 3),
            "last_error": None,
        })
        return np.asarray(vec)
    except Exception as exc:
        _runtime.update({
            "status": "error",
            "last_inference_latency_ms": round((time.perf_counter() - started) * 1000, 3),
            "last_error": str(exc),
        })
        raise


def encode_item_text(
    item: Dict,
    kw_names: Optional[List[str]] = None,
    ctx_names: Optional[List[str]] = None,
) -> np.ndarray:
    """Embed an item dict into the artifact space.

    The text builder must match ``pipelines/train_or_generate_artifacts.build_item_text``.
    """
    text = build_item_text(item, list(kw_names or []), list(ctx_names or []))
    return encode_text(text)


def _query_prefix(model_name: str) -> str:
    name = str(model_name or "").lower()
    if "e5" in name and "instruct" in name:
        return (
            "Instruct: Given a Thai performing arts query, "
            "retrieve relevant items.\nQuery: "
        )
    if "e5" in name:
        return "query: "
    return ""


def _passage_prefix(model_name: str) -> str:
    name = str(model_name or "").lower()
    if "e5" in name and "instruct" not in name:
        return "passage: "
    return ""
