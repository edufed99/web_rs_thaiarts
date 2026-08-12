"""Pydantic v2 response models for ``GET /metrics/popularity`` (ADR-002).

The popularity score is browse-only, so the response shape is
deliberately small — the front end renders the existing top-N
"ชุดการแสดงยอดนิยม" cards and only needs ``total`` (sort key),
``sub_scores`` (debug) and ``engagement_score`` (back-compat with the
homepage tile that already exists).
"""
from __future__ import annotations

from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class PopularityRowOut(BaseModel):
    """One ranked item in the popularity response."""

    item_id: int = Field(..., description="Artifact item id (stable_id).")
    name: str = Field(..., description="Item display name, joined from the artifact loader.")
    total: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description=(
            "Final weighted score in [0, 1]. Renormalised to 1.0 when a "
            "factor is missing (e.g. CTR below the impression floor) so the "
            "achievable maximum stays constant."
        ),
    )
    sub_scores: Dict[str, Optional[float]] = Field(
        ...,
        description=(
            "Per-factor normalised sub-score in [0, 1] or None when the "
            "factor is uncomputable (insufficient data, outside window, "
            "below floor). Factors: saved, rating, like, view, ctr, recency."
        ),
    )
    engagement_score: int = Field(
        ...,
        ge=0,
        description=(
            "Legacy value (likes + saves + positive ratings). Kept so the "
            "admin dashboard's existing 'ยอดนิยม' tile keeps working "
            "unchanged while the new score rolls out."
        ),
    )
    weights_applied: List[str] = Field(
        default_factory=list,
        description=(
            "Factor names whose sub-score was available and above zero in "
            "the active weights. Use this to see which factors the total "
            "actually combined, not just which ones the weights file lists."
        ),
    )
    rating_confidence: int = Field(
        0,
        ge=0,
        description=(
            "Number of distinct ratings behind the Bayesian WR (i.e. ``v`` "
            "in the IMDb formula). Low v ⇒ the WR is close to ``C`` and "
            "should be treated with low confidence."
        ),
    )


class PopularityOut(BaseModel):
    """One round-trip response for the popularity ranking."""

    range_days: int = Field(30, description="Window size in days (7 / 30 / 90 / 365).")
    weights_id: int = Field(..., description="The PopularityWeight row that produced this score.")
    source: str = Field(
        "live",
        description=(
            "'live' = computed from the active weights row. "
            "'unavailable' = no active weights row (e.g. migration failed). "
            "Future: 'cache' once the recompute moves to a schedule."
        ),
    )
    rows: List[PopularityRowOut] = Field(
        default_factory=list,
        description="Top-N items by ``total`` desc, length ≤ ``limit``.",
    )


class PopularityWeightsOut(BaseModel):
    """The currently active weights (for the admin editor)."""

    id: int
    weights: Dict[str, float]
    half_life_days: int = Field(..., ge=0)
    bayes_m: int = Field(..., ge=0)
    updated_at: str = Field("", description="ISO 8601 UTC timestamp.")
    updated_by: str = ""


class PopularityWeightsUpdateIn(BaseModel):
    """Body for PUT /metrics/popularity/weights."""

    weights: Dict[str, float] = Field(..., description="Factor name → weight in [0, 1], sum 1.0 ± 1e-3.")
    half_life_days: int = Field(14, ge=0)
    bayes_m: int = Field(3, ge=0)
    updated_by: str = Field("", max_length=150)
