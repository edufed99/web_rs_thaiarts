"""
services/cbf_service.py — Port of recommender/cbf.py.

Content-based scoring using precomputed E5 embeddings. The original project
loads ``intfloat/multilingual-e5-large-instruct`` on every cold start; here
the embeddings are computed once by the pipeline and loaded from
``artifacts/models/item_embeddings.npz``.
"""
from __future__ import annotations

from typing import Dict, Iterable, List, Optional

import numpy as np

from ..core.config import Settings
from ..model_loader import ArtifactLoader
from .embedding import encode_query


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
    settings = settings or Settings()
    candidates = list(candidate_items)
    if not candidates:
        return {}

    keyword_list = [k for k in selected_keyword_names if k]
    query_text = build_query_text(keyword_list, context_name)
    if not query_text.strip():
        return {int(item["item_id"]): 0.0 for item in candidates}

    candidate_ids = [int(item["item_id"]) for item in candidates]
    query_vec = _encode_query_vector(loader, query_text, settings)
    if query_vec is None:
        query_vec = _proxy_query_vector(loader, candidate_ids, keyword_list, context_name)
    if query_vec is None:
        return {iid: 0.0 for iid in candidate_ids}

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

    return scores


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
    if not settings.e5_enabled or expected_dim != 1024:
        return None
    try:
        vec = encode_query(query_text)
    except Exception:  # noqa: BLE001 - keep recommender available offline
        return None
    if vec.ndim != 1 or int(vec.shape[0]) != expected_dim:
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
