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


class ItemListOut(BaseModel):
    items: List[ItemOut] = Field(..., description="Paginated list of items.")
    total: int = Field(..., ge=0, description="Total active items matching the query.")