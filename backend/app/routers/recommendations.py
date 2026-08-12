"""
routers/recommendations.py — POST /recommendations.

The main workflow endpoint. Accepts a context + optional keywords, returns
the top-K items with scores and natural-language explanations.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query, status

from ..core.config import get_settings
from ..model_loader import get_singleton, ArtifactLoader
from ..models_db import User
from ..schemas.recommendation import (
    ProfileRecommendationResponseOut,
    RecommendationRequestIn,
    RecommendationResponseOut,
)
from ..services.recommendation_service import (
    _best_profile_key,
    generate_profile_recommendations,
    generate_recommendations,
)
from ._user_key import get_current_user_dep


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
    user: Optional[User] = Depends(get_current_user_dep),
    loader: ArtifactLoader = Depends(get_singleton),
) -> RecommendationResponseOut:
    settings = get_settings()
    if user is not None:
        profile_key, _ = _best_profile_key(loader, user)
        payload = payload.model_copy(update={"user_key": profile_key})
    return generate_recommendations(
        loader,
        payload,
        settings=settings,
        user_id=int(user.id) if user is not None else None,
    )


@router.get(
    "/recommendations/profile",
    response_model=ProfileRecommendationResponseOut,
    status_code=status.HTTP_200_OK,
    summary="Generate profile-only recommendations",
    description=(
        "Return top items inferred from the authenticated user's past behavior "
        "(likes / high ratings / imported legacy CF history), before the user "
        "selects a context. Requires `Authorization: Bearer <jwt>`."
    ),
)
def get_profile_recommendations(
    top_k: int = Query(10, ge=1, le=50),
    user: Optional[User] = Depends(get_current_user_dep),
    loader: ArtifactLoader = Depends(get_singleton),
) -> ProfileRecommendationResponseOut:
    if user is None:
        from ..core.exceptions import AuthError

        raise AuthError("Authentication required", extra={"code": "unauthorized"})
    settings = get_settings()
    return generate_profile_recommendations(loader, user, top_k=top_k, settings=settings)
