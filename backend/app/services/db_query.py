"""
services/db_query.py — Read-side queries that bridge the static ArtifactLoader
with the live Postgres DB.

When the DB is enabled, these helpers overlay fresh data on top of the
precomputed CF index. When the DB is disabled (RECSYS_DB_ENABLED=0), they
return empty results so the system still works on artifacts alone.
"""
from __future__ import annotations

from typing import Dict, List, Set

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import is_db_enabled, session_scope
from ..models_db import LegacyInteraction


# --- Live legacy positive interactions -------------------------------------

POSITIVE_THRESHOLD = 4


def live_positive_users_per_item(min_rating: int = POSITIVE_THRESHOLD) -> Dict[int, Set[str]]:
    """
    Returns {item_id: set(legacy_user_id)} for items with at least one positive
    rating (rating >= min_rating). Used to enrich the static CF index with
    freshly imported data.

    Returns {} when DB is disabled.
    """
    if not is_db_enabled():
        return {}
    with session_scope() as session:
        if session is None:
            return {}
        return _live_positive_users_per_item(session, min_rating)


def _live_positive_users_per_item(session: Session, min_rating: int) -> Dict[int, Set[str]]:
    stmt = select(
        LegacyInteraction.item_id,
        LegacyInteraction.legacy_user_id,
    ).where(LegacyInteraction.rating >= min_rating)
    rows = session.execute(stmt).all()
    out: Dict[int, Set[str]] = {}
    for item_id, user_id in rows:
        out.setdefault(int(item_id), set()).add(f"legacy:{user_id}")
    return out


def live_item_stats() -> Dict[int, Dict[str, float]]:
    """
    Returns {item_id: {count, avg_rating}} across all legacy interactions.
    Surfaced via /api/items/{id}/legacy-stats for the dashboard.
    """
    if not is_db_enabled():
        return {}
    with session_scope() as session:
        if session is None:
            return {}
        return _live_item_stats(session)


def _live_item_stats(session: Session) -> Dict[int, Dict[str, float]]:
    stmt = select(
        LegacyInteraction.item_id,
        func.count(LegacyInteraction.id),
        func.avg(LegacyInteraction.rating),
    ).group_by(LegacyInteraction.item_id)
    rows = session.execute(stmt).all()
    out: Dict[int, Dict[str, float]] = {}
    for item_id, count, avg in rows:
        out[int(item_id)] = {
            "count": float(count),
            "avg_rating": float(avg) if avg is not None else 0.0,
        }
    return out