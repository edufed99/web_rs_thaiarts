"""Artifact-only item similarity for the Private Model Service."""
from __future__ import annotations

import math
from typing import Any

from ..core.exceptions import InvalidInferenceRequestError
from ..model_loader import ArtifactLoader
from ..schemas.inference import (
    SimilarityCandidate,
    SimilarityRequest,
    SimilarityResponse,
)


def rank_similar_items(
    loader: ArtifactLoader,
    request: SimilarityRequest,
) -> SimilarityResponse:
    """Rank only supplied candidates using the established artifact scorer.

    The artifact release is a point-in-time snapshot. Items added to the live
    catalogue after the release was built are ignored rather than causing the
    whole request to fail, so item-to-item similarity degrades gracefully when
    artifacts lag behind the catalogue.
    """
    if request.reference_artifact_item_id not in set(loader.item_ids):
        raise InvalidInferenceRequestError(
            "Similarity reference item is absent from the loaded artifact release.",
            extra={"reference_artifact_item_id": request.reference_artifact_item_id},
        )
    if request.reference_artifact_item_id in request.candidate_artifact_item_ids:
        raise InvalidInferenceRequestError(
            "The similarity reference must not also be a candidate.",
            extra={"reference_artifact_item_id": request.reference_artifact_item_id},
        )

    known_candidates = [
        candidate_id
        for candidate_id in request.candidate_artifact_item_ids
        if candidate_id in set(loader.item_ids)
    ]
    if not known_candidates:
        return SimilarityResponse(ranked_candidates=[])

    reference = dict(loader.item_row(request.reference_artifact_item_id))
    scored = [
        (
            artifact_similarity_score(
                loader,
                reference,
                dict(loader.item_row(candidate_id)),
            ),
            str(loader.item_row(candidate_id).get("name") or ""),
            candidate_id,
        )
        for candidate_id in known_candidates
    ]
    scored.sort(key=lambda row: (-row[0], row[1], row[2]))
    return SimilarityResponse(
        ranked_candidates=[
            SimilarityCandidate(artifact_item_id=item_id, score=float(score))
            for score, _name, item_id in scored[: request.limit]
        ]
    )


def artifact_similarity_score(
    loader: ArtifactLoader,
    reference: dict[str, Any],
    candidate: dict[str, Any],
) -> float:
    """Established 70/15/10/5 embedding/keyword/context/category blend."""
    ref_id = _artifact_id(reference)
    candidate_id = _artifact_id(candidate)
    embedding_score = 0.0
    try:
        ref_embedding = loader.embedding_for(ref_id)
        candidate_embedding = loader.embedding_for(candidate_id)
        if ref_embedding is not None and candidate_embedding is not None:
            dot = float(
                sum(float(a) * float(b) for a, b in zip(ref_embedding, candidate_embedding))
            )
            ref_norm = math.sqrt(sum(float(value) ** 2 for value in ref_embedding))
            candidate_norm = math.sqrt(
                sum(float(value) ** 2 for value in candidate_embedding)
            )
            if ref_norm and candidate_norm:
                cosine = dot / (ref_norm * candidate_norm)
                embedding_score = max(0.0, min(1.0, (cosine + 1.0) / 2.0))
    except (KeyError, TypeError, ValueError):
        embedding_score = 0.0

    keyword_score = _jaccard(
        reference.get("keyword_names"), candidate.get("keyword_names")
    )
    context_score = _jaccard(
        reference.get("context_names"), candidate.get("context_names")
    )
    category_score = float(
        bool(reference.get("category_group"))
        and str(reference.get("category_group"))
        == str(candidate.get("category_group"))
    )
    return (
        0.70 * embedding_score
        + 0.15 * keyword_score
        + 0.10 * context_score
        + 0.05 * category_score
    )


def _artifact_id(row: dict[str, Any]) -> int:
    return int(row.get("item_id") or row.get("artifact_item_id"))


def _jaccard(left: Any, right: Any) -> float:
    left_values = {str(value) for value in (left or []) if value}
    right_values = {str(value) for value in (right or []) if value}
    union = left_values | right_values
    return len(left_values & right_values) / len(union) if union else 0.0
