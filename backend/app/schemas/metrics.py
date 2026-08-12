"""Schemas for /health and /metrics endpoints."""
from __future__ import annotations

from typing import Dict, List, Optional

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
    research_mode: bool = False
    embedding_backend: str = Field(default="not_loaded")
    e5_model: str = Field(default="")
    e5_load_latency_ms: Optional[float] = Field(default=None, ge=0)
    e5_last_inference_latency_ms: Optional[float] = Field(default=None, ge=0)
    e5_error: Optional[str] = None


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


class RequestTrendBucket(BaseModel):
    """One month-bucket in the dashboard trend chart."""

    year: int = Field(..., ge=1970, le=2100)
    month: int = Field(..., ge=1, le=12, description="1-based calendar month.")
    label: str = Field(..., description="Short Thai month label, e.g. 'ส.ค.'")
    request_count: int = Field(..., ge=0, description="Recommendations requested.")
    shown_count: int = Field(
        ...,
        ge=0,
        description="Items actually shown (sum of result rows in those requests).",
    )


class RequestTrendOut(BaseModel):
    """GET /metrics/requests response — dashboard trend chart."""

    months: int = Field(..., ge=1, le=36, description="Window size (last N months).")
    total_requests: int = Field(..., ge=0)
    total_shown: int = Field(..., ge=0)
    source: str = Field(
        ...,
        description="'postgres' when DB is reachable, 'disabled' otherwise.",
    )
    buckets: List[RequestTrendBucket] = Field(
        default_factory=list,
        description="Oldest first; length == months.",
    )


class ModelConfigOut(BaseModel):
    """GET /metrics/config response — chosen experiment config the
    backend currently serves. Mirrors ``artifacts/outputs/best_model_config.json``.
    Falls back to env-var defaults when the manifest is absent."""

    cbf_model: str = Field(default="", description="CBF encoder model id.")
    cf_model: str = Field(default="", description="CF model class.")
    hybrid_method: str = Field(default="", description="Hybrid combiner method.")
    hybrid_alpha: Optional[float] = Field(
        default=None,
        description="CBF weight in the WeightedSum combiner. CF weight = 1 - alpha.",
    )
    candidate_strategy: str = Field(default="", description="Eligibility filter name.")
    embedding_dim: Optional[int] = Field(
        default=None,
        description="Embedding dimensionality served by the loader.",
    )
    itemknn_k: Optional[int] = Field(
        default=None,
        description="ItemKNN top-K neighbour count.",
    )
    itemknn_shrink: Optional[float] = Field(
        default=None,
        description="Cosine shrinkage constant.",
    )
    cbf_keyword_boost: Optional[float] = Field(
        default=None,
        description="Additive boost on keyword match in CBF scoring.",
    )
    positive_threshold: Optional[int] = Field(
        default=None,
        description="Min rating to count as a positive CF signal.",
    )
    extra: Dict[str, object] = Field(
        default_factory=dict,
        description="Other keys from best_model_config.json surfaced as-is.",
    )


class ReproducibilityCount(BaseModel):
    expected: int = Field(..., ge=0)
    actual: int = Field(..., ge=0)
    delta: int
    matches: bool


class ReproducibilityOut(BaseModel):
    """Paper baseline compared with the currently loaded artifact corpus."""

    status: str = Field(..., description="'match' or 'drift_detected'.")
    baseline_source: str
    keyword_count_source: str = Field(description="'postgres' or 'artifacts'.")
    item_count: ReproducibilityCount
    keyword_count: ReproducibilityCount
    taxonomy_path_count: ReproducibilityCount
    artifact_config_hash: str = ""
    artifact_build_timestamp: str = ""
