"""Schema for Item resources."""
from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field

from .context import ContextOut
from .keyword import KeywordOut


class UserState(BaseModel):
    """Per-user interaction state attached to each item in responses."""

    liked: bool = Field(default=False, description="Whether the user liked this item.")
    saved: bool = Field(default=False, description="Whether the user saved this item.")
    rating: int = Field(default=0, ge=0, le=5, description="User rating (0 = none).")


class ItemOut(BaseModel):
    """One catalog item with its keywords, contexts, and per-user state."""

    model_config = ConfigDict(from_attributes=True)

    id: int = Field(..., description="Stable item id.")
    name: str = Field(..., description="Display name in Thai.")
    description: str = Field(default="", description="Long-form description.")
    category_group: str = Field(default="", description="High-level category (e.g. 'ระบำ').")
    performance_type: str = Field(default="", description="Type of performance.")
    performers_count: Optional[int] = Field(default=None, description="Number of performers.")
    duration_minutes: Optional[int] = Field(default=None, description="Duration in minutes.")
    price_text: str = Field(default="", description="Price display string.")
    image_url: str = Field(default="", description="Optional cover image URL.")
    video_url: str = Field(default="", description="Optional video URL.")
    keywords: List[KeywordOut] = Field(default_factory=list)
    contexts: List[ContextOut] = Field(default_factory=list)
    user_state: UserState = Field(default_factory=UserState)
    # Display-only suitability hint, populated when an item is returned in
    # a context that requires it (e.g. ``GET /items?context=`` or
    # ``POST /recommendations``).  Mirrors the legacy
    # ``catalog.views.catalog_match_percent`` heuristic and is **never**
    # used to influence the recommendation ranking itself.
    match_percent: Optional[int] = Field(
        default=None,
        ge=82,
        le=98,
        description="Display-only match percent in [82, 98]. Set when the item is served in a ranked context.",
    )
    suitability_label: Optional[str] = Field(
        default=None,
        description=("Thai suitability label — 'เหมาะมาก' / 'เหมาะสม' / 'เหมาะใช้ได้'. Set together with match_percent."),
    )


class ItemListOut(BaseModel):
    items: List[ItemOut] = Field(..., description="Paginated list of items.")
    total: int = Field(..., ge=0, description="Total active items matching the query.")


class EngagementOut(BaseModel):
    """Per-item engagement counters summed across the live action tables.

    Combines ``likes`` + ``saved_items`` + positive (rating >= 4) ``ratings``
    so the homepage "popular" ranking reflects *all the ways users engage
    with an item*, not just historical legacy ratings. ``engagement_score``
    is the plain sum of those three counts — useful as a primary sort key.
    """

    item_id: int = Field(..., description="Artifact item id (matches ``ItemOut.id``).")
    like_count: int = Field(..., ge=0)
    save_count: int = Field(..., ge=0)
    rating_count: int = Field(..., ge=0, description="Count of ratings >= positive_threshold (default 4).")
    engagement_score: int = Field(..., ge=0, description="like_count + save_count + rating_count.")


class EngagementListOut(BaseModel):
    engagements: List[EngagementOut] = Field(..., description="One row per requested item, in caller order.")
    source: str = Field("postgres", description="'postgres' or 'disabled'.")