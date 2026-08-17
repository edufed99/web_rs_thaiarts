"""
services/member_query.py — Per-user summary + history queries used by the
member_user mockup pages (sidebar interest bars, "ดูล่าสุด", activity
counts, history table).

All public functions return ``source='disabled'`` (or empty payloads) when
the DB layer is off so the frontend can render a neutral placeholder
without trying to make 5 separate requests.

Performance
-----------
Each helper opens exactly one DB session and batches the per-item name
lookup in a single ``IN`` query, so calling them from a single render
path is cheap (typically < 30 ms with the live corpus).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Dict, List, Tuple

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.config import get_settings
from ..db import is_db_enabled, session_scope
from ..models_db import InteractionLog, Item, Like, Rating, SavedItem
from ..schemas.member import (
    HistoryEntryOut,
    HistoryListOut,
    InterestBucket,
    LikedItemsOut,
    RatedItemOut,
    RatedItemsOut,
    RatingBucketOut,
    RatingSummaryOut,
    RecentViewOut,
    RecentViewsOut,
    SavedItemsOut,
    UserSummaryOut,
)


# Action verbs surfaced in the user-facing activity table. ``item_view``
# (ADR-002 §3.1) is intentionally absent — see the filter in
# ``live_user_history``.
HISTORY_ACTIONS = frozenset({"like", "unlike", "save", "unsave", "rate"})


def _empty_summary(user_key: str) -> UserSummaryOut:
    return UserSummaryOut(
        user_key=user_key,
        liked_count=0,
        saved_count=0,
        rated_count=0,
        recent_view_count=0,
        interests=[],
        has_activity=False,
        source="disabled",
    )


def live_user_summary(user_key: str) -> UserSummaryOut:
    """Top-level summary for the member_user sidebar.

    Returns ``source='disabled'`` + zeros when the DB is off so the
    frontend can render placeholders without an extra round-trip.
    """
    if not is_db_enabled() or not user_key:
        return _empty_summary(user_key)

    with session_scope() as session:
        if session is None:
            return _empty_summary(user_key)

        liked = _count(session, Like, user_key)
        saved = _count(session, SavedItem, user_key)
        rated = _count(session, Rating, user_key)
        recent = _recent_view_count(session, user_key)
        bucket_counts = _bucket_counts(session, user_key)

    interests = _build_interests(bucket_counts)
    return UserSummaryOut(
        user_key=user_key,
        liked_count=liked,
        saved_count=saved,
        rated_count=rated,
        recent_view_count=recent,
        interests=interests,
        has_activity=bool(liked or saved or rated or recent),
        source="postgres",
    )


def live_user_history(user_key: str, limit: int = 50) -> HistoryListOut:
    """Return the user's recent ``interaction_logs`` joined with item names.

    Combines ``like`` / ``save`` / ``rate`` / ``view`` / ``click`` into a
    single timestamp-ordered table that the frontend renders in the
    "ประวัติการรับชมและให้คะแนน" mockup section. Each entry is one row.
    """
    if not is_db_enabled() or not user_key:
        return HistoryListOut(items=[], total=0)

    with session_scope() as session:
        if session is None:
            return HistoryListOut(items=[], total=0)

        rows = (
            session.execute(
                select(
                    InteractionLog.id,
                    InteractionLog.item_id,
                    InteractionLog.action_type,
                    InteractionLog.metadata_json,
                    InteractionLog.created_at,
                    Item.artifact_item_id,
                    Item.name,
                )
                .join(Item, Item.id == InteractionLog.item_id, isouter=True)
                .where(
                    InteractionLog.user_key == user_key,
                    InteractionLog.action_type.in_(tuple(HISTORY_ACTIONS)),
                )
                .order_by(InteractionLog.created_at.desc())
                .limit(max(1, min(int(limit), 200)))
            )
            .all()
        )

    entries: List[HistoryEntryOut] = []
    for log_id, item_db_id, action_type, metadata_json, created_at, artifact_id, item_name in rows:
        # ``item_view`` rows exist as of ADR-002 §3.1 but are deliberately
        # excluded: a page open is not a history-worthy action and views are
        # far more frequent than the rest, so including them would flood the
        # "ประวัติความสนใจ" tab.
        if action_type not in HISTORY_ACTIONS:
            continue
        rating: int | None = None
        if action_type == "rate" and metadata_json:
            try:
                import json

                meta = json.loads(metadata_json)
                rating = int(meta.get("rating")) if isinstance(meta, dict) else None
            except (ValueError, TypeError):
                rating = None
        entries.append(
            HistoryEntryOut(
                log_id=int(log_id),
                item_id=int(artifact_id) if artifact_id is not None else int(item_db_id or 0),
                item_name=str(item_name) if item_name else "(รายการที่ถูกลบ)",
                context_name="",
                action_type=str(action_type),
                rating=rating,
                created_at=_isoformat(created_at),
            )
        )

    return HistoryListOut(items=entries, total=len(entries))


def live_user_saved_ids(user_key: str) -> SavedItemsOut:
    if not is_db_enabled() or not user_key:
        return SavedItemsOut(items=[], total=0)
    with session_scope() as session:
        if session is None:
            return SavedItemsOut(items=[], total=0)
        ids = _aids_for_table(session, SavedItem, user_key)
    return SavedItemsOut(items=ids, total=len(ids))


def live_user_liked_ids(user_key: str) -> LikedItemsOut:
    if not is_db_enabled() or not user_key:
        return LikedItemsOut(items=[], total=0)
    with session_scope() as session:
        if session is None:
            return LikedItemsOut(items=[], total=0)
        ids = _aids_for_table(session, Like, user_key)
    return LikedItemsOut(items=ids, total=len(ids))


def live_user_rated_items(user_key: str) -> RatedItemsOut:
    if not is_db_enabled() or not user_key:
        return RatedItemsOut(items=[], total=0)
    with session_scope() as session:
        if session is None:
            return RatedItemsOut(items=[], total=0)
        rows = session.execute(
            select(Item.artifact_item_id, Rating.rating, Rating.updated_at)
            .join(Rating, Rating.item_id == Item.id)
            .where(Rating.user_key == user_key)
            .order_by(Rating.updated_at.desc())
        ).all()
    items = [
        RatedItemOut(
            item_id=int(aid),
            rating=int(rating),
            updated_at=_isoformat(updated_at),
        )
        for aid, rating, updated_at in rows
        if aid is not None and 1 <= int(rating) <= 5
    ]
    return RatedItemsOut(items=items, total=len(items))


def live_user_rating_summary(user_key: str) -> RatingSummaryOut:
    """Return the current user's real 1..5-star distribution."""
    empty = RatingSummaryOut(
        average=0.0,
        total=0,
        distribution=[RatingBucketOut(stars=stars, count=0) for stars in range(5, 0, -1)],
    )
    if not is_db_enabled() or not user_key:
        return empty
    with session_scope() as session:
        if session is None:
            return empty
        rows = session.execute(
            select(Rating.rating, func.count(Rating.id))
            .where(Rating.user_key == user_key)
            .group_by(Rating.rating)
        ).all()
    counts = {int(stars): int(count) for stars, count in rows if 1 <= int(stars) <= 5}
    total = sum(counts.values())
    average = sum(stars * count for stars, count in counts.items()) / total if total else 0.0
    return RatingSummaryOut(
        average=round(average, 2),
        total=total,
        distribution=[RatingBucketOut(stars=stars, count=counts.get(stars, 0)) for stars in range(5, 0, -1)],
    )


def live_user_recent_views(
    user_key: str,
    *,
    days: int = 30,
    limit: int = 20,
) -> RecentViewsOut:
    """Return unique recently opened items, newest latest-view first."""
    safe_days = max(1, min(int(days), 365))
    safe_limit = max(1, min(int(limit), 200))
    if not is_db_enabled() or not user_key:
        return RecentViewsOut(items=[], total=0, window_days=safe_days)
    since = datetime.now(timezone.utc) - timedelta(days=safe_days)
    with session_scope() as session:
        if session is None:
            return RecentViewsOut(items=[], total=0, window_days=safe_days)
        latest = func.max(InteractionLog.created_at).label("viewed_at")
        base_filters = (
            InteractionLog.user_key == user_key,
            InteractionLog.action_type == "item_view",
            InteractionLog.created_at >= since,
            Item.artifact_item_id.is_not(None),
        )
        total = session.execute(
            select(func.count(func.distinct(InteractionLog.item_id)))
            .select_from(InteractionLog)
            .join(Item, Item.id == InteractionLog.item_id)
            .where(*base_filters)
        ).scalar_one_or_none()
        rows = session.execute(
            select(Item.artifact_item_id, Item.name, latest)
            .join(InteractionLog, InteractionLog.item_id == Item.id)
            .where(*base_filters)
            .group_by(Item.artifact_item_id, Item.name)
            .order_by(latest.desc())
            .limit(safe_limit)
        ).all()
    return RecentViewsOut(
        items=[
            RecentViewOut(
                item_id=int(item_id),
                item_name=str(item_name or ""),
                viewed_at=_isoformat(viewed_at),
            )
            for item_id, item_name, viewed_at in rows
        ],
        total=int(total or 0),
        window_days=safe_days,
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _count(session: Session, model, user_key: str) -> int:
    return int(
        session.execute(
            select(func.count()).select_from(model).where(model.user_key == user_key)
        ).scalar_one()
    )


def _aids_for_table(session: Session, model, user_key: str) -> List[int]:
    """Return artifact_item_ids for rows in ``model`` for ``user_key``.

    Joins through ``items`` so the returned ids are in artifact-id space
    (what the frontend understands), not the DB ``items.id``.
    """
    rows = session.execute(
        select(Item.artifact_item_id)
        .join(model, model.item_id == Item.id)
        .where(model.user_key == user_key)
        .order_by(model.created_at.desc())
    ).all()
    return [int(aid) for aid, in rows if aid is not None]


def _recent_view_count(session: Session, user_key: str, days: int = 30) -> int:
    """Count distinct items the user actually viewed in the last ``days`` days.

    Exact as of ADR-002 §3.1: ``item_view`` rows are real events now, so this
    no longer has to approximate "ดูล่าสุด" by counting any interaction.
    Views are deduped per 30-minute window at write time, but a user may
    genuinely revisit an item across days, so we count *distinct items*.
    """
    since = datetime.now(timezone.utc) - timedelta(days=days)
    total = session.execute(
        select(func.count(func.distinct(InteractionLog.item_id))).where(
            InteractionLog.user_key == user_key,
            InteractionLog.action_type == "item_view",
            InteractionLog.created_at >= since,
        )
    ).scalar_one_or_none()
    return int(total or 0)


def _bucket_counts(session: Session, user_key: str) -> Dict[str, int]:
    """Build positive-interest weights from current state, not event logs.

    A current like or save contributes one point. Ratings at the configured
    positive threshold contribute one point, while five stars contribute two.
    Unlike/unsave events and low ratings therefore cannot inflate interests.
    """
    out: Dict[str, int] = {}

    def add(category: object, weight: int) -> None:
        key = str(category) if category else "อื่นๆ"
        out[key] = out.get(key, 0) + int(weight)

    for category, in session.execute(
        select(Item.category_group)
        .join(Like, Like.item_id == Item.id)
        .where(Like.user_key == user_key)
    ).all():
        add(category, 1)

    for category, in session.execute(
        select(Item.category_group)
        .join(SavedItem, SavedItem.item_id == Item.id)
        .where(SavedItem.user_key == user_key)
    ).all():
        add(category, 1)

    positive_threshold = int(get_settings().positive_threshold)
    for category, rating in session.execute(
        select(Item.category_group, Rating.rating)
        .join(Rating, Rating.item_id == Item.id)
        .where(Rating.user_key == user_key, Rating.rating >= positive_threshold)
    ).all():
        add(category, 2 if int(rating) >= 5 else 1)
    return out


def _build_interests(bucket_counts: Dict[str, int]) -> List[InterestBucket]:
    """Map real positive activity to at most four category buckets."""
    if not bucket_counts:
        return []

    # Sort categories by count desc, then by label for stability.
    ordered = sorted(bucket_counts.items(), key=lambda kv: (-kv[1], kv[0]))
    total = sum(c for _, c in ordered) or 1
    buckets: List[InterestBucket] = []
    for idx, (label, count) in enumerate(ordered[:4]):
        percent = round(int(count) * 100 / total)
        buckets.append(
            InterestBucket(
                name=label,
                percent=max(1, min(100, int(percent))),
                is_top=(idx == 0),
            )
        )

    return buckets


def _isoformat(value: datetime | None) -> str:
    if value is None:
        return ""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()
