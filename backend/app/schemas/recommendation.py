"""Schemas for the /recommendations workflow."""
from __future__ import annotations

from typing import List, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .context import ContextOut
from .item import ItemOut
from .keyword import KeywordOut


class RecommendationRequestIn(BaseModel):
    """Input body for POST /recommendations."""

    context_id: int = Field(
        ...,
        gt=0,
        description="Id of the selected context (sub-context).",
    )
    keyword_ids: List[int] = Field(
        default_factory=list,
        description="Optional list of keyword ids the user wants to emphasize.",
    )
    top_k: int = Field(
        default=10,
        ge=1,
        le=50,
        description="How many results to return (1-50).",
    )
    user_key: str = Field(
        default="",
        description=(
            "Optional opaque user identifier. When provided, the recommender uses "
            "that user's positive history for collaborative filtering. Empty = anonymous."
        ),
    )

    @field_validator("keyword_ids")
    @classmethod
    def _unique_positive_ints(cls, v: List[int]) -> List[int]:
        """Deduplicate and ensure all keyword ids are positive ints."""
        seen = set()
        out = []
        for k in v:
            if not isinstance(k, int) or k <= 0:
                raise ValueError("keyword_ids must be positive integers")
            if k not in seen:
                seen.add(k)
                out.append(k)
        return out


class ScoresOut(BaseModel):
    """Per-model component scores that were fused into the hybrid ranking."""

    cbf: float = Field(..., description="Content-based score (cosine + keyword boost).")
    cf: float = Field(..., description="Collaborative-filtering score (ItemKNN or popularity).")
    hybrid: float = Field(..., description="Final fused hybrid score.")


class RecommendationResultOut(BaseModel):
    """One ranked item in the recommendation response."""

    rank: int = Field(..., ge=1, description="1-based rank within this response.")
    item: ItemOut = Field(..., description="The recommended item.")
    scores: ScoresOut
    is_context_valid: bool = Field(
        default=True,
        description="True if the item passed the eligibility gate for the selected context.",
    )
    matched_keywords: List[str] = Field(
        default_factory=list,
        description="Names of selected keywords that this item's keywords overlap with.",
    )
    explanation: str = Field(
        default="",
        description="Natural-language Thai explanation for the recommendation.",
    )
    # Display-only suitability hint (see ``ItemOut.match_percent``).
    # Every ranked row carries this; it is purely presentational and
    # never affects the order of results.
    match_percent: int = Field(
        ...,
        ge=82,
        le=98,
        description="Display-only match percent in [82, 98].",
    )
    suitability_label: str = Field(
        ...,
        description="Thai suitability label derived from match_percent.",
    )


class RecommendationResponseOut(BaseModel):
    """Response body for POST /recommendations."""

    model_config = ConfigDict(from_attributes=True)

    request_id: str = Field(..., description="Opaque request identifier (uuid).")
    selected_context: ContextOut
    selected_keywords: List[KeywordOut] = Field(default_factory=list)
    candidate_count: int = Field(..., ge=0, description="Items after eligibility gate.")
    top_k: int = Field(..., ge=1, le=50)
    method: str = Field(default="Hybrid-WeightedSum", description="Method tag.")
    embedding_backend: Literal["e5", "proxy"] = Field(
        ...,
        description="Actual live query embedding backend used for this ranking.",
    )
    embedding_latency_ms: float = Field(default=0.0, ge=0)
    metadata: dict = Field(default_factory=dict)
    results: List[RecommendationResultOut] = Field(default_factory=list)


class ProfileRecommendationResponseOut(BaseModel):
    """Recommendations derived from the authenticated user's past behavior."""

    model_config = ConfigDict(from_attributes=True)

    request_id: str = Field(..., description="Opaque request identifier (uuid).")
    top_k: int = Field(..., ge=1, le=50)
    method: str = Field(default="Profile-ItemKNN", description="Method tag.")
    history_count: int = Field(..., ge=0, description="Positive items found in the user's profile.")
    metadata: dict = Field(default_factory=dict)
    results: List[RecommendationResultOut] = Field(default_factory=list)
