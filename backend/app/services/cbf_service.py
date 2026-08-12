"""
services/cbf_service.py — Port of recommender/cbf.py.

Content-based scoring using precomputed E5 embeddings. The original project
loads ``intfloat/multilingual-e5-large-instruct`` on every cold start; here
the embeddings are computed once by the pipeline and loaded from
``artifacts/models/item_embeddings.npz``.
"""
from __future__ import annotations

from dataclasses import dataclass
import time
from typing import Dict, Iterable, List, Literal, Optional

import numpy as np

from ..core.config import Settings
from ..core.exceptions import EmbeddingBackendUnavailableError
from ..model_loader import ArtifactLoader
from .embedding import encode_query


@dataclass(frozen=True)
class ContentScoreOutcome:
    scores: Dict[int, float]
    embedding_backend: Literal["e5", "proxy"]
    embedding_latency_ms: float


def build_query_text(keyword_names: Iterable[str], context_name: Optional[str] = None) -> str:
    parts = []
    if context_name:
        parts.append(context_name)
    parts.extend(k for k in keyword_names if k)
    return " ".join(parts).strip()


def score_items_by_content(
    loader: ArtifactLoader,
    candidate_items: List[Dict],
    selected_keyword_names: Iterable[str],
    context_name: Optional[str] = None,
    settings: Optional[Settings] = None,
) -> Dict[int, float]:
    """
    Returns {item_id: cbf_score} for every candidate.

    The score is the cosine similarity between the query embedding and each
    item's precomputed embedding, plus a small additive boost when any
    selected keyword matches the item's keywords.
    """
    return score_items_by_content_with_runtime(
        loader,
        candidate_items,
        selected_keyword_names,
        context_name=context_name,
        settings=settings,
    ).scores


def score_items_by_content_with_runtime(
    loader: ArtifactLoader,
    candidate_items: List[Dict],
    selected_keyword_names: Iterable[str],
    context_name: Optional[str] = None,
    settings: Optional[Settings] = None,
) -> ContentScoreOutcome:
    """Score candidates and disclose whether real E5 or proxy was used."""
    settings = settings or Settings()
    candidates = list(candidate_items)
    if not candidates:
        backend = "e5" if settings.research_mode else "proxy"
        return ContentScoreOutcome({}, backend, 0.0)

    keyword_list = [k for k in selected_keyword_names if k]
    query_text = build_query_text(keyword_list, context_name)
    if not query_text.strip():
        backend = "e5" if settings.research_mode else "proxy"
        return ContentScoreOutcome(
            {int(item["item_id"]): 0.0 for item in candidates}, backend, 0.0
        )

    candidate_ids = [int(item["item_id"]) for item in candidates]
    started = time.perf_counter()
    query_vec = _encode_query_vector(loader, query_text, settings)
    backend: Literal["e5", "proxy"] = "e5" if query_vec is not None else "proxy"
    if query_vec is None:
        query_vec = _proxy_query_vector(loader, candidate_ids, keyword_list, context_name)
    if query_vec is None:
        return ContentScoreOutcome(
            {iid: 0.0 for iid in candidate_ids},
            backend,
            round((time.perf_counter() - started) * 1000, 3),
        )

    scores: Dict[int, float] = {}
    boost = float(settings.cbf_keyword_boost)
    keyword_set = set(keyword_list)

    for item in candidates:
        iid = int(item["item_id"])
        emb = loader.embedding_for(iid)
        if emb is None:
            scores[iid] = 0.0
            continue
        cosine = float(np.dot(emb, query_vec))
        hit = bool(keyword_set.intersection(item.get("keyword_names") or []))
        scores[iid] = cosine + (boost if hit else 0.0)

    return ContentScoreOutcome(
        scores,
        backend,
        round((time.perf_counter() - started) * 1000, 3),
    )


def _encode_query_vector(
    loader: ArtifactLoader,
    query_text: str,
    settings: Settings,
) -> Optional[np.ndarray]:
    """Encode the live query with E5 when the artifact space supports it.

    Unit-test and demo artifacts use tiny synthetic vectors, so they cannot be
    compared with a 1024-D E5 query. In those cases, or if the model is not
    available at runtime, callers fall back to the deterministic proxy vector.
    """
    expected_dim = int(loader.embeddings.shape[1])
    if expected_dim != 1024:
        if settings.research_mode:
            raise EmbeddingBackendUnavailableError(
                f"Research mode requires 1024-D E5 artifacts; loaded dimension is {expected_dim}.",
                extra={"expected_embedding_dim": 1024, "actual_embedding_dim": expected_dim},
            )
        return None
    if not settings.e5_enabled:
        if settings.research_mode:
            raise EmbeddingBackendUnavailableError(
                "Research mode requires E5 but RECSYS_E5_ENABLED=0."
            )
        return None
    try:
        vec = encode_query(query_text)
    except Exception as exc:
        if settings.research_mode:
            raise EmbeddingBackendUnavailableError(
                "E5 inference failed in research mode; proxy fallback is disabled.",
                extra={"reason": str(exc)},
            ) from exc
        return None
    if vec.ndim != 1 or int(vec.shape[0]) != expected_dim:
        if settings.research_mode:
            raise EmbeddingBackendUnavailableError(
                "E5 returned an incompatible query embedding.",
                extra={"expected_embedding_dim": expected_dim, "actual_shape": list(vec.shape)},
            )
        return None
    return vec.astype(np.float32, copy=False)


def _proxy_query_vector(
    loader: ArtifactLoader,
    candidate_ids: List[int],
    keyword_list: List[str],
    context_name: Optional[str],
) -> Optional[np.ndarray]:
    """
    Without a live sentence-transformer model we cannot encode the raw query
    text. We approximate the query vector as the L2-normalized mean of the
    candidate embeddings weighted by keyword overlap (simple, deterministic,
    and good enough for testing).
    """
    vecs = []
    weights = []
    keyword_set = set(keyword_list)
    for iid in candidate_ids:
        emb = loader.embedding_for(iid)
        if emb is None:
            continue
        vecs.append(emb)
        # Items matching more keywords get higher weight in the query proxy.
        weight = 1.0
        if keyword_set:
            row = loader.item_row(iid)
            if row is not None and keyword_set.intersection(row.get("keyword_names") or []):
                weight = 2.0
        weights.append(weight)
    if not vecs:
        return None
    mat = np.stack(vecs)
    w = np.asarray(weights, dtype=np.float32).reshape(-1, 1)
    q = (mat * w).sum(axis=0)
    norm = float(np.linalg.norm(q))
    if norm == 0:
        return q
    return (q / norm).astype(np.float32)
