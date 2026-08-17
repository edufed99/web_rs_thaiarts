"""Typed payload for the admin data-analysis workspace."""
from __future__ import annotations

from typing import List, Literal

from pydantic import BaseModel, Field

from .dashboard import DashboardOut


class FunnelStep(BaseModel):
    key: str
    label: str
    count: int = 0
    rate_from_previous: float = 0.0
    conversion_from_start: float = 0.0


class ActionBreakdownRow(BaseModel):
    action: str
    label: str
    count: int = 0
    pct: float = 0.0


class KeywordPairRow(BaseModel):
    left: str
    right: str
    count: int = 0


class AudienceSegment(BaseModel):
    key: str
    label: str
    count: int = 0
    pct: float = 0.0
    definition: str = ""


class BehaviorAnalyticsOut(BaseModel):
    funnel: List[FunnelStep] = Field(default_factory=list)
    actions: List[ActionBreakdownRow] = Field(default_factory=list)
    keyword_pairs: List[KeywordPairRow] = Field(default_factory=list)
    audience_segments: List[AudienceSegment] = Field(default_factory=list)
    active_users: int = 0
    returning_users: int = 0
    engaged_users: int = 0
    engagement_rate: float = 0.0


class InsightCard(BaseModel):
    id: str
    title: str
    summary: str
    evidence: List[str] = Field(default_factory=list)
    recommendation: str
    confidence: float = Field(0.0, ge=0.0, le=1.0)
    tone: Literal["positive", "neutral", "warning", "danger"] = "neutral"


class AIInsightsOut(BaseModel):
    engine: Literal["rules", "gemini"] = "rules"
    generated_at: str = ""
    cached: bool = False
    cache_ttl_seconds: int = 600
    privacy_notice: str = (
        "วิเคราะห์จากข้อมูลรวมเท่านั้น ไม่มีชื่อ อีเมล รหัสผู้ใช้ หรือประวัติรายบุคคล"
    )
    items: List[InsightCard] = Field(default_factory=list)


class AnalyticsOut(BaseModel):
    range_days: int
    generated_at: str
    source: str
    trends: DashboardOut
    behavior: BehaviorAnalyticsOut
    ai_insights: AIInsightsOut
