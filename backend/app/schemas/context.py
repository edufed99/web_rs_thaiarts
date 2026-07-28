"""Schema for Context resources."""
from __future__ import annotations

from typing import List

from pydantic import BaseModel, ConfigDict, Field


class ContextOut(BaseModel):
    """A context (sub-context) selectable by users when asking for recommendations."""

    model_config = ConfigDict(from_attributes=True)

    id: int = Field(..., description="Stable context id (matches catalog Context table).")
    name: str = Field(..., description="Display name in Thai, e.g. 'งานบวช'.")
    group: str = Field(..., description="Main-context group this sub-context belongs to.")
    description: str = Field(default="", description="Long-form description of the context.")
    active_item_count: int = Field(
        ...,
        ge=0,
        description="Number of active items belonging to this context.",
    )


class ContextListOut(BaseModel):
    contexts: List[ContextOut] = Field(..., description="All filterable sub-contexts.")