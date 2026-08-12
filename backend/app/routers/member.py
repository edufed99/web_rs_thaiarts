"""
routers/member.py — Per-user summary + history endpoints used by the
member_user mockup (sidebar interest bars, "ดูล่าสุด" tile, history table).

Auth model mirrors the rest of the app: ``Authorization: Bearer <jwt>``
resolves to ``user:<id>``; otherwise the request must carry
``anon:<uuid>`` in the body / query string. Missing key → 401, like the
actions router.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, File, Query, UploadFile

from ..core.config import get_settings
from ..core.exceptions import AuthError, DbDisabledError
from ..models_db import User
from ..schemas.member import (
    HistoryListOut,
    LikedItemsOut,
    MemberDashboardOut,
    MemberProfileOut,
    MemberProfileUpdate,
    RatedItemsOut,
    RatingSummaryOut,
    RecentViewsOut,
    SavedItemsOut,
    UserSummaryOut,
)
from ..services.member_query import (
    live_user_history,
    live_user_liked_ids,
    live_user_rated_items,
    live_user_rating_summary,
    live_user_recent_views,
    live_user_saved_ids,
    live_user_summary,
)
from ..services import storage, user_query
from ._user_key import get_current_user_dep


router = APIRouter(prefix="/me", tags=["member"])


def _require_user(user: Optional[User]) -> User:
    if user is None:
        raise AuthError("Authentication required", extra={"code": "unauthorized"})
    return user


def _profile_out(user: User) -> MemberProfileOut:
    payload = user_query.get_member_profile(int(user.id))
    if payload is None:
        raise DbDisabledError("Member profile is unavailable")
    return MemberProfileOut.model_validate(payload)


@router.get("/profile", response_model=MemberProfileOut, summary="Current member profile")
def get_member_profile(
    user: Optional[User] = Depends(get_current_user_dep),
) -> MemberProfileOut:
    return _profile_out(_require_user(user))


@router.patch("/profile", response_model=MemberProfileOut, summary="Update own member profile")
def patch_member_profile(
    payload: MemberProfileUpdate,
    user: Optional[User] = Depends(get_current_user_dep),
) -> MemberProfileOut:
    current = _require_user(user)
    updated = user_query.update_member_profile(
        int(current.id),
        display_name=payload.display_name,
        avatar_url=payload.avatar_url,
        bio=payload.bio,
    )
    if updated is None:
        raise DbDisabledError("Member profile is unavailable")
    return MemberProfileOut.model_validate(updated)


@router.post("/profile/avatar", response_model=MemberProfileOut, summary="Upload own profile image")
def upload_member_avatar(
    file: UploadFile = File(...),
    user: Optional[User] = Depends(get_current_user_dep),
) -> MemberProfileOut:
    current = _require_user(user)
    settings = get_settings()
    previous = _profile_out(current).avatar_url
    _filename, public_url, _size, _mime = storage.save_upload(
        file,
        settings.upload_dir / "profiles",
        prefix=f"user-{int(current.id)}",
        max_bytes=settings.max_upload_bytes,
        allowed_mime=settings.allowed_upload_mime,
        public_subdir="profiles",
    )
    updated = user_query.update_member_profile(int(current.id), avatar_url=public_url)
    if updated is None:
        storage.delete_upload(public_url, settings.upload_dir)
        raise DbDisabledError("Member profile is unavailable")
    if previous and previous != public_url:
        storage.delete_upload(previous, settings.upload_dir)
    return MemberProfileOut.model_validate(updated)


@router.delete("/profile/avatar", response_model=MemberProfileOut, summary="Remove own profile image")
def delete_member_avatar(
    user: Optional[User] = Depends(get_current_user_dep),
) -> MemberProfileOut:
    current = _require_user(user)
    previous = _profile_out(current).avatar_url
    updated = user_query.update_member_profile(int(current.id), avatar_url="")
    if updated is None:
        raise DbDisabledError("Member profile is unavailable")
    if previous:
        storage.delete_upload(previous, get_settings().upload_dir)
    return MemberProfileOut.model_validate(updated)


@router.get("/dashboard", response_model=MemberDashboardOut, summary="Member dashboard aggregate")
def get_member_dashboard(
    user: Optional[User] = Depends(get_current_user_dep),
) -> MemberDashboardOut:
    current = _require_user(user)
    key = f"user:{int(current.id)}"
    return MemberDashboardOut(
        profile=_profile_out(current),
        summary=live_user_summary(key),
        recent_activity=live_user_history(key, limit=10),
        recent_views=live_user_recent_views(key, days=30, limit=4),
    )


def _resolve_user_key(
    user: Optional[User],
    user_key_query: Optional[str],
) -> str:
    """Translate (User, anon_key) to the canonical ``user_key`` string.

    Mirrors ``_user_key.resolve_user_key`` but accepts the anon key as a
    query parameter (the member summary endpoints are GETs, not POSTs,
    so there's no JSON body to read it from).
    """
    if user is not None:
        return f"user:{int(user.id)}"
    if user_key_query and user_key_query.startswith("anon:"):
        return user_key_query
    raise AuthError(
        "Missing user_key (anonymous requires 'anon:<uuid>').",
        extra={"code": "missing_user_key"},
    )


@router.get(
    "/summary",
    response_model=UserSummaryOut,
    summary="User summary (sidebar stats + interest bars)",
    description=(
        "Returns the per-user activity counts (liked / saved / rated / "
        "recent views) and the top 4 category-bucket interest percentages "
        "for the member_user sidebar. Returns ``source='disabled'`` with "
        "all zeros when the DB layer is off."
    ),
)
def get_me_summary(
    user_key: Optional[str] = Query(
        default=None,
        description="Opaque 'anon:<uuid>' key. Ignored when a JWT is present.",
    ),
    user: Optional[User] = Depends(get_current_user_dep),
) -> UserSummaryOut:
    key = _resolve_user_key(user, user_key)
    return live_user_summary(key)


@router.get(
    "/history",
    response_model=HistoryListOut,
    summary="User action history (interaction_logs)",
    description=(
        "Returns the user's recent like / save / rate actions joined with "
        "item names, ordered newest first. Used by the "
        "ประวัติการรับชมและให้คะแนน table in the mockup."
    ),
)
def get_me_history(
    limit: int = Query(default=20, ge=1, le=200),
    user_key: Optional[str] = Query(default=None),
    user: Optional[User] = Depends(get_current_user_dep),
) -> HistoryListOut:
    key = _resolve_user_key(user, user_key)
    return live_user_history(key, limit=limit)


@router.get(
    "/saved",
    response_model=SavedItemsOut,
    summary="User's saved item ids (artifact id space)",
)
def get_me_saved(
    user_key: Optional[str] = Query(default=None),
    user: Optional[User] = Depends(get_current_user_dep),
) -> SavedItemsOut:
    key = _resolve_user_key(user, user_key)
    return live_user_saved_ids(key)


@router.get(
    "/liked",
    response_model=LikedItemsOut,
    summary="User's liked item ids (artifact id space)",
)
def get_me_liked(
    user_key: Optional[str] = Query(default=None),
    user: Optional[User] = Depends(get_current_user_dep),
) -> LikedItemsOut:
    key = _resolve_user_key(user, user_key)
    return live_user_liked_ids(key)


@router.get(
    "/rated",
    response_model=RatedItemsOut,
    summary="User's rated items + current rating",
)
def get_me_rated(
    user_key: Optional[str] = Query(default=None),
    user: Optional[User] = Depends(get_current_user_dep),
) -> RatedItemsOut:
    key = _resolve_user_key(user, user_key)
    return live_user_rated_items(key)


@router.get("/rating-summary", response_model=RatingSummaryOut, summary="Current rating distribution")
def get_me_rating_summary(
    user_key: Optional[str] = Query(default=None),
    user: Optional[User] = Depends(get_current_user_dep),
) -> RatingSummaryOut:
    key = _resolve_user_key(user, user_key)
    return live_user_rating_summary(key)


@router.get(
    "/recent-views",
    response_model=RecentViewsOut,
    summary="Unique recently viewed items",
)
def get_me_recent_views(
    days: int = Query(default=30, ge=1, le=365),
    limit: int = Query(default=20, ge=1, le=200),
    user_key: Optional[str] = Query(default=None),
    user: Optional[User] = Depends(get_current_user_dep),
) -> RecentViewsOut:
    key = _resolve_user_key(user, user_key)
    return live_user_recent_views(key, days=days, limit=limit)
