"""Pure artifact-backed scoring for the Private Model Service contract.

This module intentionally imports neither database nor application-enrichment
code. Every live input arrives in :class:`InferenceRequest` in immutable
artifact-item ID space.
"""
from __future__ import annotations

from math import sqrt

from ..core.config import Settings, settings_with_artifact_config
from ..core.exceptions import InvalidInferenceRequestError
from ..model_loader import ArtifactLoader
from ..schemas.inference import (
    InferenceRequest,
    InferenceResponse,
    InferenceScores,
    RankedCandidate,
)
from .cbf_service import score_items_by_content_with_runtime
from .hybrid_service import apply_negative_penalty, weighted_sum


def score_inference(
    loader: ArtifactLoader,
    request: InferenceRequest,
    settings: Settings,
) -> InferenceResponse:
    """Score exactly the supplied Eligible Candidate Set."""
    effective = settings_with_artifact_config(settings, loader.best_model_config)
    known_ids = set(loader.item_ids)
    referenced_ids = set(request.eligible_candidate_ids)
    referenced_ids.update(
        row.artifact_item_id for row in request.personalization.positive_history
    )
    referenced_ids.update(
        row.artifact_item_id for row in request.personalization.negative_ratings
    )
    unknown_ids = sorted(referenced_ids - known_ids)
    if unknown_ids:
        raise InvalidInferenceRequestError(
            "Inference input references artifact item identifiers absent from the loaded release.",
            extra={"unknown_artifact_item_ids": unknown_ids},
        )

    candidates = [
        dict(loader.item_row(item_id))
        for item_id in request.eligible_candidate_ids
    ]
    personalization = request.personalization
    cbf = score_items_by_content_with_runtime(
        loader,
        candidates,
        personalization.keyword_names,
        context_name=personalization.context_name or None,
        settings=effective,
    ).scores
    cf = _score_itemknn_from_live_history(loader, request, effective)
    final = weighted_sum(cbf, cf, settings=effective)
    final = apply_negative_penalty(
        final,
        {row.artifact_item_id: row.rating for row in personalization.negative_ratings},
        strength=effective.negative_penalty_alpha,
        positive_threshold=effective.positive_threshold,
    )

    ordered_ids = sorted(
        request.eligible_candidate_ids,
        key=lambda item_id: (
            -float(final.get(item_id, 0.0)),
            -float(cbf.get(item_id, 0.0)),
            int(item_id),
        ),
    )[: request.top_k]
    return InferenceResponse(
        ranked_candidates=[
            RankedCandidate(
                artifact_item_id=item_id,
                scores=InferenceScores(
                    cbf=float(cbf.get(item_id, 0.0)),
                    cf=float(cf.get(item_id, 0.0)),
                    final=float(final.get(item_id, 0.0)),
                ),
            )
            for item_id in ordered_ids
        ]
    )


def _score_itemknn_from_live_history(
    loader: ArtifactLoader,
    request: InferenceRequest,
    settings: Settings,
) -> dict[int, float]:
    """ItemKNN using request-supplied history and the static artifact index."""
    candidates = set(request.eligible_candidate_ids)
    history_weights = {
        row.artifact_item_id: row.rating_weight
        for row in request.personalization.positive_history
    }
    if not history_weights:
        return {item_id: 0.0 for item_id in candidates}

    item_users = loader.cf_item_users
    scores: dict[int, float] = {}
    for candidate_id in candidates:
        if candidate_id in history_weights:
            scores[candidate_id] = 0.0
            continue
        similarities = [
            _cosine(item_users, candidate_id, history_id, settings.itemknn_shrink)
            * rating_weight
            for history_id, rating_weight in history_weights.items()
        ]
        positive = sorted((score for score in similarities if score > 0.0), reverse=True)
        neighbours = positive[: settings.itemknn_k]
        scores[candidate_id] = sum(neighbours) / len(neighbours) if neighbours else 0.0
    return scores


def _cosine(
    item_users: dict[int, list[str]], item_a: int, item_b: int, shrink: float
) -> float:
    users_a = set(item_users.get(item_a, []))
    users_b = set(item_users.get(item_b, []))
    if not users_a or not users_b:
        return 0.0
    shared = len(users_a & users_b)
    if not shared:
        return 0.0
    return shared / ((sqrt(len(users_a)) * sqrt(len(users_b))) + float(shrink))
