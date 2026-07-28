"""Schemas for /health and /metrics endpoints."""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class HealthOut(BaseModel):
    """GET /health response."""

    status: str = Field(..., description="Either 'ok' or 'degraded'.")
    version: str = Field(..., description="Backend app version.")
    artifacts_loaded_at: Optional[str] = Field(
        default=None,
        description="ISO-8601 timestamp when artifacts were loaded. Null if not loaded.",
    )
    item_count: int = Field(default=0, ge=0, description="Number of items in artifacts.")
    context_count: int = Field(default=0, ge=0)
    embedding_dim: int = Field(default=0, ge=0)


class MetricsOut(BaseModel):
    """GET /metrics response — high-level corpus stats."""

    item_count: int = Field(..., ge=0)
    context_count: int = Field(..., ge=0)
    keyword_count: int = Field(..., ge=0)
    positive_user_count: int = Field(..., ge=0)
    unique_item_user_edges: int = Field(..., ge=0)
    embedding_dim: int = Field(..., ge=0)
    artifacts_loaded_at: str = Field(..., description="ISO-8601 timestamp.")
    config_hash: str = Field(..., description="Short hash of the pipeline config used.")