"""
schemas/dashboard.py — Pydantic v2 response models for ``GET /metrics/dashboard``.

The dashboard mockup at ``imageRS/dashboard.png`` is composed of 14
sections. Each section gets its own typed model so the frontend can
type-check field access without leaning on ``dict``. All fields are
populated even in zero-state so the frontend can render placeholders
without special-casing missing data.
"""
from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Top-level response
# ---------------------------------------------------------------------------


class DashboardOut(BaseModel):
    """One round-trip payload for the admin dashboard page."""

    range_days: int = Field(30, description="Window size in days (e.g. 7, 30, 90).")
    generated_at: str = Field("", description="ISO 8601 UTC timestamp of when the payload was built.")
    source: str = Field("disabled", description="'postgres' or 'disabled' — whether the DB layer is live.")

    kpis: KpiStripOut
    trend_30d: TrendOut
    user_growth: UserGrowthOut
    usage_heatmap: HeatmapOut
    popular_categories: CategoryListOut
    popular_subcontexts: SubContextListOut
    top_search_terms: TopSearchListOut
    rating_distribution: RatingDistributionOut
    model_quality: ModelQualityOut
    quality_trend_30d: TrendOut
    algorithm_kpis: AlgorithmKpiOut
    top_keywords: KeywordListOut
    page_quality: PageQualityOut
    recent_activity: RecentActivityListOut


# ---------------------------------------------------------------------------
# Section models
# ---------------------------------------------------------------------------


class KpiTile(BaseModel):
    label: str
    value: str = Field("", description="Pre-formatted display value (number, pct, or short text).")
    raw_value: float = 0.0
    delta_pct: Optional[float] = Field(None, description="Percent change vs the previous period (None = no comparison).")
    tone: str = Field("neutral", description="neutral | positive | warning | danger")
    hint: str = ""


class KpiStripOut(BaseModel):
    members: KpiTile
    performances: KpiTile
    indices: KpiTile
    points: KpiTile
    active_users: KpiTile
    sessions: KpiTile


class TrendBucket(BaseModel):
    label: str
    sessions: int = 0
    searches: int = 0
    ratings: int = 0


class TrendOut(BaseModel):
    labels: List[str] = Field(default_factory=list)
    sessions: List[int] = Field(default_factory=list)
    searches: List[int] = Field(default_factory=list)
    ratings: List[int] = Field(default_factory=list)
    ndcg10: List[float] = Field(default_factory=list, description="Filled only by quality_trend_30d; empty for the activity trend.")
    hr10: List[float] = Field(default_factory=list)
    mrr10: List[float] = Field(default_factory=list)


class UserGrowthBucket(BaseModel):
    label: str
    new_users: int = 0
    active_users: int = 0


class UserGrowthOut(BaseModel):
    labels: List[str] = Field(default_factory=list)
    new_users: List[int] = Field(default_factory=list)
    active_users: List[int] = Field(default_factory=list)


class HeatmapCell(BaseModel):
    weekday: int = Field(..., description="0=Mon … 6=Sun")
    hour: int = Field(..., ge=0, le=23)
    count: int = 0


class HeatmapOut(BaseModel):
    weekday_labels: List[str] = Field(default_factory=list, description="['จ.', 'อ.', ...]")
    hour_labels: List[str] = Field(default_factory=list, description="['00', '04', ...] or hourly labels")
    matrix: List[List[int]] = Field(default_factory=list, description="matrix[weekday][hour] = count; shape (7, 24)")
    max_value: int = 0


class CategoryItem(BaseModel):
    name: str
    count: int
    pct: float = Field(0.0, description="Percentage of the total (0-100).")


class CategoryListOut(BaseModel):
    items: List[CategoryItem] = Field(default_factory=list)
    total_items: int = 0


class SubContextItem(BaseModel):
    name: str
    count: int
    pct: float = 0.0


class SubContextListOut(BaseModel):
    items: List[SubContextItem] = Field(default_factory=list)
    total_requests: int = 0


class TopSearchRow(BaseModel):
    rank: int
    term: str
    searches: int = 0
    views: int = 0
    ratings: int = 0
    likes: int = 0
    score: float = Field(0.0, description="Weighted score = searches*0.5 + views*0.3 + ratings*0.15 + likes*0.05.")


class TopSearchListOut(BaseModel):
    items: List[TopSearchRow] = Field(default_factory=list)


class RatingDistributionBucket(BaseModel):
    star: int = Field(..., ge=1, le=5)
    count: int = 0
    pct: float = 0.0


class RatingDistributionOut(BaseModel):
    buckets: List[RatingDistributionBucket] = Field(default_factory=list)
    average: float = 0.0
    total: int = 0


class ModelQualityOut(BaseModel):
    """Five quality tiles for the dashboard. ``source`` indicates provenance.

    * ``'online'`` — latest recompute from live telemetry
    * ``'offline'`` — latest holdout run from the pipeline
    * ``'unavailable'`` — no evaluation_runs rows yet
    """

    ndcg10: float = 0.0
    hr10: float = 0.0
    mrr10: float = 0.0
    coverage: float = 0.0
    violation_rate: float = 0.0
    source: str = "unavailable"
    ran_at: str = ""
    test_user_count: int = 0
    test_interaction_count: int = 0


class AlgorithmKpiOut(BaseModel):
    """Funnel + click-through summary for the recommendation funnel tile."""

    search_total: int = 0
    search_to_detail_total: int = 0
    search_to_detail_pct: float = 0.0
    items_shown_total: int = 0
    ctr_pct: float = Field(0.0, description="Item-view rate per recommendation shown.")
    delta_pct: Optional[float] = None


class KeywordRow(BaseModel):
    rank: int
    term: str
    count: int = 0


class KeywordListOut(BaseModel):
    items: List[KeywordRow] = Field(default_factory=list)


class PageQualityMetric(BaseModel):
    name: str
    value: float = Field(0.0, description="Percentage (0-100).")
    target: float = 90.0
    tone: str = Field("success", description="success | warning | danger")


class PageQualityOut(BaseModel):
    metrics: List[PageQualityMetric] = Field(default_factory=list)
    open_issues: int = 0


class RecentActivityRow(BaseModel):
    log_id: int
    time: str = ""
    action: str
    target: str
    user: str
    type: str = Field("", description="action_type category: like, save, rate, view, search, etc.")


class RecentActivityListOut(BaseModel):
    items: List[RecentActivityRow] = Field(default_factory=list)


# Forward references — referenced inside DashboardOut but defined after
# the KpiStripOut block above. ``model_rebuild`` is required for Pydantic
# v2 to resolve forward references on nested models.
DashboardOut.model_rebuild()
