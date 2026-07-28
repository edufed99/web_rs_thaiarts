"""
routers/recommendations.py — POST /recommendations.

The main workflow endpoint. Accepts a context + optional keywords, returns
the top-K items with scores and natural-language explanations.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, status

from ..core.config import get_settings
from ..model_loader import get_singleton, ArtifactLoader
from ..schemas.recommendation import (
    RecommendationRequestIn,
    RecommendationResponseOut,
)
from ..services.recommendation_service import generate_recommendations


router = APIRouter(tags=["recommendations"])


@router.post(
    "/recommendations",
    response_model=RecommendationResponseOut,
    status_code=status.HTTP_200_OK,
    summary="Generate top-K recommendations",
    description=(
        "Run the eligibility gate + content-based scoring + collaborative "
        "filtering + hybrid fusion pipeline and return the top-K items with "
        "natural-language Thai explanations.\n\n"
        "**Request body** fields:\n"
        "- `context_id` (int, required): selected sub-context id\n"
        "- `keyword_ids` (list[int], optional): keyword ids to emphasize\n"
        "- `top_k` (int 1-50, default 10): how many results to return\n"
        "- `user_key` (str, optional): opaque user id for personalization\n\n"
        "**Errors:**\n"
        "- `404 context_not_found` if the context id is unknown\n"
        "- `422 validation_error` on bad input\n"
        "- `503 artifacts_not_loaded` if artifacts are missing"
    ),
)
def post_recommendations(
    payload: RecommendationRequestIn,
    loader: ArtifactLoader = Depends(get_singleton),
) -> RecommendationResponseOut:
    settings = get_settings()
    return generate_recommendations(loader, payload, settings=settings)