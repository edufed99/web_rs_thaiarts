"""
services/db_query.py — Read-side queries that bridge the static ArtifactLoader
with the live Postgres DB.

When the DB is enabled, these helpers overlay fresh data on top of the
precomputed CF index. When the DB is disabled (RECSYS_DB_ENABLED=0), they
return empty results so the system still works on artifacts alone.

Conventions
-----------
* Public ``fn()`` returns ``{}`` / ``set()`` / ``[]`` when the DB is disabled.
* Private ``_fn(session, ...)`` does the actual query and takes a ``Session``
  as first arg so tests can drive it with a SQLite in-memory engine.
* All public outputs are in **artifact-id space** (the id space used by
  artifacts, the API surface, and the live-action tables). Translations to
  the legacy Django id space happen inside the helpers via
  ``Item.artifact_item_id``.
"""
from __future__ import annotations

from typing import Dict, Iterable, List, Optional, Set

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import is_db_enabled, session_scope
from ..models_db import Item, LegacyInteraction, Like, Rating, SavedItem
from ..schemas.item import UserState


# --- Live legacy positive interactions -------------------------------------

POSITIVE_THRESHOLD = 4


def live_positive_users_per_item(min_rating: int = POSITIVE_THRESHOLD) -> Dict[int, Set[str]]:
    """
    {item_id: set(legacy_user_id)} for items with at least one positive
    legacy rating (rating >= min_rating). Returned in **legacy Django id
    space** (the importer wrote them with the original ``items.id``).

    This helper is preserved for backwards compatibility. New code should
    prefer ``live_positive_users_per_item_artifact()`` which translates to
    artifact-id space and is what the CF service actually consumes.

    Returns ``{}`` when DB is disabled.
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


def live_positive_users_per_item_artifact(
    min_rating: int = POSITIVE_THRESHOLD,
) -> Dict[int, Set[str]]:
    """
    Same shape as ``live_positive_users_per_item`` but keyed by the
    artifact id (``items.artifact_item_id``). Use this when feeding the CF
    index, which lives in artifact-id space.

    Returns ``{}`` when DB is disabled.
    """
    if not is_db_enabled():
        return {}
    with session_scope() as session:
        if session is None:
            return {}
        return _live_positive_users_per_item_artifact(session, min_rating)


def _live_positive_users_per_item_artifact(
    session: Session, min_rating: int
) -> Dict[int, Set[str]]:
    stmt = (
        select(
            Item.artifact_item_id,
            LegacyInteraction.legacy_user_id,
        )
        .join(LegacyInteraction, LegacyInteraction.item_id == Item.id)
        .where(LegacyInteraction.rating >= min_rating)
    )
    rows = session.execute(stmt).all()
    out: Dict[int, Set[str]] = {}
    for aid, user_id in rows:
        if aid is None:
            continue
        out.setdefault(int(aid), set()).add(f"legacy:{user_id}")
    return out


def live_item_stats() -> Dict[int, Dict[str, float]]:
    """
    {item_id: {count, avg_rating}} across all legacy interactions in
    **Django id space** (the legacy stats endpoint surfaces per-Django-id
    counts). Surfaced via /api/items/{id}/legacy-stats for the dashboard.

    Returns ``{}`` when DB is disabled.
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


# --- Per-user live state ----------------------------------------------------

def live_user_positive_items(
    user_key: str, min_rating: int = POSITIVE_THRESHOLD
) -> Set[int]:
    """Set of artifact_item_ids the user has positively interacted with.

    Sources: ``likes`` rows + ``ratings`` rows with rating >= min_rating.
    Returns an empty set when DB is disabled or the user has no history.
    """
    if not is_db_enabled() or not user_key:
        return set()
    with session_scope() as session:
        if session is None:
            return set()
        return _live_user_positive_items(session, user_key, min_rating)


def _live_user_positive_items(
    session: Session, user_key: str, min_rating: int
) -> Set[int]:
    out: Set[int] = set()

    # 1. likes
    for (aid,) in session.execute(
        select(Item.artifact_item_id)
        .join(Like, Like.item_id == Item.id)
        .where(Like.user_key == user_key)
    ).all():
        if aid is not None:
            out.add(int(aid))

    # 2. ratings >= min_rating
    for (aid,) in session.execute(
        select(Item.artifact_item_id)
        .join(Rating, Rating.item_id == Item.id)
        .where(Rating.user_key == user_key, Rating.rating >= min_rating)
    ).all():
        if aid is not None:
            out.add(int(aid))

    return out


def live_user_negative_ratings(
    user_key: str, max_rating: int = POSITIVE_THRESHOLD
) -> Dict[int, int]:
    """{artifact_item_id: raw_rating} for items the user rated < max_rating.

    Drives ``hybrid_service.apply_negative_penalty``. Empty dict when DB
    is disabled or the user has no negative ratings.
    """
    if not is_db_enabled() or not user_key:
        return {}
    with session_scope() as session:
        if session is None:
            return {}
        return _live_user_negative_ratings(session, user_key, max_rating)


def _live_user_negative_ratings(
    session: Session, user_key: str, max_rating: int
) -> Dict[int, int]:
    out: Dict[int, int] = {}
    for aid, rating in session.execute(
        select(Item.artifact_item_id, Rating.rating)
        .join(Rating, Rating.item_id == Item.id)
        .where(Rating.user_key == user_key, Rating.rating < max_rating)
    ).all():
        if aid is not None:
            out[int(aid)] = int(rating)
    return out


def live_user_state_for_items(
    user_key: str, artifact_item_ids: Iterable[int]
) -> Dict[int, UserState]:
    """Bulk lookup: for each artifact_item_id, return {liked, saved, rating}.

    Empty dict when DB is disabled. Result is keyed by artifact_item_id; items
    with no interaction get a ``UserState()`` default.
    """
    if not is_db_enabled() or not user_key:
        return {}
    artifact_ids = [int(a) for a in artifact_item_ids]
    if not artifact_ids:
        return {}

    with session_scope() as session:
        if session is None:
            return {}
        return _live_user_state_for_items(session, user_key, artifact_ids)


def _live_user_state_for_items(
    session: Session, user_key: str, artifact_ids: List[int]
) -> Dict[int, UserState]:
    # Resolve the (django id, artifact id) tuples for the requested items.
    id_rows = session.execute(
        select(Item.id, Item.artifact_item_id).where(
            Item.artifact_item_id.in_(artifact_ids)
        )
    ).all()
    django_ids = [int(r[0]) for r in id_rows]
    aid_to_django = {int(aid): int(did) for did, aid in id_rows}
    if not django_ids:
        return {}

    out: Dict[int, UserState] = {
        aid: UserState() for aid in aid_to_django.keys()
    }

    # 1. likes
    for did in session.execute(
        select(Like.item_id).where(
            Like.user_key == user_key, Like.item_id.in_(django_ids)
        )
    ).scalars():
        # reverse-lookup artifact id
        for aid, d in aid_to_django.items():
            if d == int(did):
                out[aid].liked = True
                break

    # 2. saves
    for did in session.execute(
        select(SavedItem.item_id).where(
            SavedItem.user_key == user_key, SavedItem.item_id.in_(django_ids)
        )
    ).scalars():
        for aid, d in aid_to_django.items():
            if d == int(did):
                out[aid].saved = True
                break

    # 3. ratings
    for did, rating in session.execute(
        select(Rating.item_id, Rating.rating).where(
            Rating.user_key == user_key, Rating.item_id.in_(django_ids)
        )
    ).all():
        for aid, d in aid_to_django.items():
            if d == int(did):
                out[aid].rating = int(rating)
                break

    return out


# --- Translation helpers ---------------------------------------------------

def django_id_to_artifact_id(django_id: int) -> Optional[int]:
    """Translate a legacy Django items.id to its artifact counterpart.

    Returns None if the DB is disabled or the item has no artifact id
    (e.g. items imported from a future source whose name was never
    registered with the pipeline).
    """
    if not is_db_enabled():
        return None
    with session_scope() as session:
        if session is None:
            return None
        row = session.execute(
            select(Item.artifact_item_id).where(Item.id == int(django_id))
        ).first()
        if row is None or row[0] is None:
            return None
        return int(row[0])


def artifact_id_to_django_id(artifact_id: int) -> Optional[int]:
    """Reverse translation. None if DB is disabled or no such item."""
    if not is_db_enabled():
        return None
    with session_scope() as session:
        if session is None:
            return None
        row = session.execute(
            select(Item.id).where(Item.artifact_item_id == int(artifact_id))
        ).first()
        if row is None:
            return None
        return int(row[0])
