"""Schema for Keyword resources."""
from __future__ import annotations

from typing import List

from pydantic import BaseModel, ConfigDict, Field


class KeywordOut(BaseModel):
    """A keyword used for content-based matching and taxonomy navigation."""

    model_config = ConfigDict(from_attributes=True)

    id: int = Field(..., description="Stable keyword id.")
    name: str = Field(..., description="Display name in Thai.")
    taxonomy_path: str = Field(
        default="",
        description="Path through the taxonomy tree (empty if uncategorized).",
    )


class KeywordListOut(BaseModel):
    keywords: List[KeywordOut] = Field(..., description="All keywords (filtered by query).")