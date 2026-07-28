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
