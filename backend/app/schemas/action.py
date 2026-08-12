"""Schemas for the live user-action endpoints."""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from .item import ItemOut


class ActionRequestIn(BaseModel):
    """Body for POST/DELETE /actions/{like|save} and PUT /actions/rating."""

    user_key: str = Field(
        ...,
        min_length=1,
        max_length=150,
        description="Opaque user id (e.g. 'anon:<uuid>').",
    )
    item_id: int = Field(..., gt=0, description="Artifact item id (stable_id).")
    request_id: Optional[str] = Field(
        default=None,
        description="Optional RecommendationResponseOut.request_id — included in the interaction log.",
    )
    context_id: Optional[int] = Field(
        default=None, gt=0, description="Optional context id for the interaction log."
    )
    # Only used by PUT /actions/rating.
    rating: Optional[int] = Field(
        default=None,
        ge=1,
        le=5,
        description="1..5 rating. Required for PUT /actions/rating, ignored otherwise.",
    )


class ItemActionOut(BaseModel):
    """Response for every /actions/* endpoint."""

    model_config = ConfigDict(from_attributes=True)

    item: ItemOut = Field(..., description="Item with populated user_state.")
    action: str = Field(..., description="Resulting action name ('liked' | 'unliked' | 'saved' | 'unsaved' | 'rated').")
    rating: Optional[int] = Field(
        default=None, ge=0, le=5, description="Current rating (present only for 'rated')."
    )
    metadata: dict = Field(default_factory=dict, description="Action-specific metadata echoed back to the client.")


class ViewRequestIn(BaseModel):
    """Body for POST /actions/view (ADR-002 §3.1).

    Deliberately narrower than ``ActionRequestIn``: a view has no rating and
    no undo, and it is fired on every detail-page open, so the payload stays
    minimal.
    """

    user_key: str = Field(
        ...,
        min_length=1,
        max_length=150,
        description="Opaque user id (e.g. 'anon:<uuid>').",
    )
    item_id: int = Field(..., gt=0, description="Artifact item id (stable_id).")
    request_id: Optional[str] = Field(
        default=None,
        description=(
            "Optional RecommendationResponseOut.request_id. When it is a "
            "persisted recommendation id, the view is attributed to that "
            "recommendation so click-through rate can be computed."
        ),
    )
    context_id: Optional[int] = Field(
        default=None, gt=0, description="Optional context id for the interaction log."
    )


class ItemViewOut(BaseModel):
    """Response for POST /actions/view.

    Does not echo the full item: the caller is the detail page, which already
    has it. Returning only the outcome keeps this high-frequency endpoint
    cheap (no artifact row lookup, no user-state query).
    """

    action: str = Field("viewed", description="Always 'viewed'.")
    item_id: int = Field(..., description="Artifact item id that was logged.")
    deduped: bool = Field(
        ...,
        description=(
            "True when a view for this (user, item) already existed inside "
            "the dedupe window, so no new row was written."
        ),
    )
