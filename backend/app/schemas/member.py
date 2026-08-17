"""Schemas for the per-user summary endpoints used by the member_user mockup.

These power the left sidebar (interest bars + activity counts) and the
"ประวัติการรับชมและให้คะแนน" table on ``/profile`` / ``/items``. They are
read-only mirrors of the live action tables (``likes``, ``saved_items``,
``ratings``) + ``interaction_logs`` (for the history table).
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..models_db import User, UserProfile
from ..services.identity import parse_account_state


class InterestBucket(BaseModel):
    """One category context bucket shown as a horizontal bar in the sidebar.

    Mirrors the four buckets in the member_user mockup
    ("ความสนใจของฉัน" -> งานบวช / เบญจาคเลข / ภูมิพลัง / ช่วงเวลา).
    Each bucket carries its name, percentage (0..100), and whether it is
    currently the user's top bucket.
    """

    name: str = Field(..., description="Category label shown to the user.")
    percent: int = Field(..., ge=0, le=100, description="0..100 percent share.")
    is_top: bool = Field(default=False, description="True for the top bucket.")


class UserSummaryOut(BaseModel):
    """Top-level response for ``GET /me/summary``."""

    user_key: str = Field(..., description="Resolved user key (anon: or user:N).")
    liked_count: int = Field(..., ge=0)
    saved_count: int = Field(..., ge=0)
    rated_count: int = Field(..., ge=0)
    # Recent views = distinct items the user opened in the last 30 days.
    # Used by the "ดูล่าสุด" stat tile in the mockup.
    recent_view_count: int = Field(..., ge=0)
    # Top 4 interest buckets, ordered by percent desc. Empty list when the
    # user has no likes / saves / ratings yet (frontend renders a fallback).
    interests: List[InterestBucket] = Field(default_factory=list)
    # When the user has 0 likes / 0 saves / 0 ratings / 0 views the frontend
    # needs to show "ยังไม่มีข้อมูล" placeholders without making 5 extra
    # requests; ``has_activity`` is the single boolean that drives that.
    has_activity: bool = Field(default=False)
    source: str = Field(
        default="postgres",
        description="'postgres' when live data is served, 'disabled' when DB is off.",
    )


class HistoryEntryOut(BaseModel):
    """One row in the "ประวัติการรับชมและให้คะแนน" table.

    Combines ``interaction_logs`` (when the action happened) with the
    resolved item name + context name + rating (when applicable). Keeps
    the frontend's render path to one round-trip.
    """

    log_id: int = Field(..., description="interaction_logs.id (stable for key).")
    item_id: int = Field(..., description="Artifact item id.")
    item_name: str = Field(..., description="Item name.")
    context_name: str = Field(default="", description="Context (sub-context) label.")
    action_type: str = Field(..., description="'like' / 'save' / 'rate' / 'view' etc.")
    rating: Optional[int] = Field(default=None, ge=0, le=5)
    created_at: str = Field(..., description="ISO-8601 timestamp.")


class HistoryListOut(BaseModel):
    items: List[HistoryEntryOut] = Field(default_factory=list)
    total: int = Field(..., ge=0)


class SavedItemsOut(BaseModel):
    items: List[int] = Field(
        default_factory=list,
        description="Artifact item ids the user has saved.",
    )
    total: int = Field(..., ge=0)


class LikedItemsOut(BaseModel):
    items: List[int] = Field(
        default_factory=list,
        description="Artifact item ids the user has liked.",
    )
    total: int = Field(..., ge=0)


class RatedItemsOut(BaseModel):
    """Liked + saved + rated items merged with the current rating."""

    items: List["RatedItemOut"] = Field(default_factory=list)
    total: int = Field(..., ge=0)


class RatedItemOut(BaseModel):
    item_id: int = Field(...)
    rating: int = Field(..., ge=1, le=5)
    updated_at: str = Field(..., description="ISO-8601 timestamp of the latest rating update.")


class RatingBucketOut(BaseModel):
    stars: int = Field(..., ge=1, le=5)
    count: int = Field(..., ge=0)


class RatingSummaryOut(BaseModel):
    average: float = Field(default=0.0, ge=0, le=5)
    total: int = Field(default=0, ge=0)
    distribution: List[RatingBucketOut] = Field(default_factory=list)


class RecentViewOut(BaseModel):
    item_id: int = Field(..., description="Artifact item id.")
    item_name: str = Field(...)
    viewed_at: str = Field(..., description="ISO-8601 latest-view timestamp.")


class RecentViewsOut(BaseModel):
    items: List[RecentViewOut] = Field(default_factory=list)
    total: int = Field(..., ge=0)
    window_days: int = Field(default=30, ge=1)


class MemberProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: Optional[str] = Field(default=None, max_length=120)
    avatar_url: Optional[str] = Field(default=None, max_length=1000)
    bio: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("display_name", "avatar_url", "bio")
    @classmethod
    def _trim(cls, value: Optional[str]) -> Optional[str]:
        return value.strip() if isinstance(value, str) else value


class MemberProfileOut(BaseModel):
    user_id: int
    username: str
    email: str = ""
    display_name: str = ""
    avatar_url: str = ""
    bio: str = ""
    role: Literal["user", "super_admin"] = "user"
    requires_password_reset: bool = False
    legacy_account: bool = False
    created_at: Optional[datetime] = None
    last_login_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class MemberDashboardOut(BaseModel):
    profile: MemberProfileOut
    summary: UserSummaryOut
    recent_activity: HistoryListOut
    recent_views: RecentViewsOut


RatedItemsOut.model_rebuild()


def _profile_payload(user: User, profile: UserProfile) -> dict:
    """Return the canonical member profile representation with clean names."""
    role = "super_admin" if bool(user.is_admin) else "user"
    state = parse_account_state(user.display_name or "", fallback=str(user.username))
    return {
        "user_id": int(user.id),
        "username": str(user.username),
        "email": str(user.email or ""),
        "display_name": state.display_name,
        "avatar_url": str(profile.avatar_url or ""),
        "bio": str(profile.bio or ""),
        "role": role,
        "requires_password_reset": state.requires_password_reset,
        "legacy_account": state.legacy_account,
        "created_at": user.created_at,
        "last_login_at": user.last_login_at,
        "updated_at": profile.updated_at,
    }
