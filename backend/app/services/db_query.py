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
  the DB id space (``items.id``) happen inside the helpers via
  ``Item.artifact_item_id``.

Two id spaces
-------------
``items`` carries two identifiers and mixing them up silently yields empty
results rather than an error:

* ``items.id`` — the DB primary key (1..N). Relational tables
  (``likes``, ``ratings``, ``legacy_interactions``, ...) reference this.
* ``items.artifact_item_id`` — ``stable_id("item", name)`` from the offline
  pipeline. Artifacts, the CF index, and every API response use this.

Use ``artifact_id_to_db_id`` / ``db_id_to_artifact_id`` to cross between them.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
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
    legacy rating (rating >= min_rating). Returned in **DB id space**
    (``items.id`` — the importer wrote the rows with that key).

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
    {item_id: {count, avg_rating}} across all legacy interactions, keyed by
    **DB id** (``items.id``) because that is what ``legacy_interactions``
    references. Callers holding an artifact id must translate first via
    ``artifact_id_to_db_id`` — see the legacy-stats router.

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


# --- Live engagement (likes + saves + positive ratings) -------------------


# Positivity threshold for ratings: a 1-3 star rating is NOT counted as
# engagement, only likes / saves / 4-5 star ratings count. Mirrors the
# ``POSITIVE_THRESHOLD`` constant used by the CF cold-start fallback and
# ``live_user_positive_items`` further down this file.
def _engagement_positive_rating_clause():
    """SQLAlchemy predicate for ``Rating.rating >= POSITIVE_THRESHOLD``.

    Imports live at call time because ``POSITIVE_THRESHOLD`` is module-level
    and we don't want to re-import it from this function's own docstring.
    """
    from ..core.config import get_settings

    return Rating.rating >= get_settings().positive_threshold


def live_item_engagement(
    item_ids: Optional[Iterable[int]] = None,
    window_days: Optional[int] = None,
) -> Dict[int, Dict[str, int]]:
    """
    Engagement counts per artifact item, summed across:

    * ``likes``            — every row counts as 1 engagement.
    * ``saved_items``      — every row counts as 1 engagement.
    * ``ratings`` where rating >= POSITIVE_THRESHOLD (default 4)
      — every such row counts as 1 engagement (low ratings reflect
      dissatisfaction and are not counted, on purpose).

    ``item_ids`` is an optional filter; when supplied we restrict the
    underlying SQL to the matching ``items.artifact_item_id`` set so the
    query is bounded for batch callers (homepage top-N cards).

    ``window_days`` optionally limits counts to recent actions. Likes and
    saves use ``created_at``; ratings use ``updated_at`` so an edited rating
    can contribute to the current weekly/monthly popularity list.

    Returns ``{}`` when the DB is disabled. Keyed by artifact id so callers
    can pass ids straight through.

    Output schema per item:

    * ``like_count``     — int
    * ``save_count``     — int
    * ``rating_count``   — int (positive 4-5 star ratings only)
    * ``engagement_score`` — int = sum of the three counts

    Items with zero engagement are *not* in the returned dict — callers
    should treat absence as zero. This matches the existing
    ``live_item_stats`` pattern.
    """
    if not is_db_enabled():
        return {}
    with session_scope() as session:
        if session is None:
            return {}
        return _live_item_engagement(session, item_ids, window_days)


def _live_item_engagement(
    session: Session,
    item_ids: Optional[Iterable[int]] = None,
    window_days: Optional[int] = None,
) -> Dict[int, Dict[str, int]]:
    """Internal implementation; takes a session so tests can drive SQLite.

    Three small COUNT GROUP BY queries (one per source table) merged into
    one dict keyed by ``artifact_item_id``. With catalog size ~116 this is
    cheaper than a single CTE JOIN and keeps the SQL understandable.
    """
    from ..models_db import SavedItem  # local import to keep module header tidy

    artifact_filter = list(item_ids) if item_ids is not None else None
    since: Optional[datetime] = None
    if window_days is not None:
        since = datetime.now(timezone.utc) - timedelta(days=max(1, int(window_days)))

    # Source tables (likes, saved_items, ratings) reference ``items.id``
    # (DB id) — translate artifact → db ids when filtering so the WHERE
    # clause hits real rows. Skip translation when no filter is supplied
    # (we'll aggregate everything).
    db_filter: Optional[List[int]] = None
    if artifact_filter:
        a_to_d = {
            int(aid): int(did)
            for aid, did in session.execute(
                select(Item.artifact_item_id, Item.id).where(
                    Item.artifact_item_id.in_(artifact_filter)
                )
            ).all()
        }
        db_filter = [a_to_d[a] for a in artifact_filter if a in a_to_d]

    d_to_a: Dict[int, int] = {}
    if db_filter:
        d_to_a = {
            int(did): int(aid)
            for aid, did in session.execute(
                select(Item.artifact_item_id, Item.id).where(Item.id.in_(db_filter))
            ).all()
        }
    else:
        # Full-catalog pass — build the map once.
        d_to_a = {
            int(did): int(aid)
            for aid, did in session.execute(
                select(Item.artifact_item_id, Item.id)
            ).all()
        }

    # --- Likes per artifact_item_id ---
    stmt_likes = select(Like.item_id, func.count(Like.id)).group_by(Like.item_id)
    if db_filter:
        stmt_likes = stmt_likes.where(Like.item_id.in_(db_filter))
    if since is not None:
        stmt_likes = stmt_likes.where(Like.created_at >= since)
    like_counts: Dict[int, int] = {}
    for db_id, count in session.execute(stmt_likes).all():
        aid = d_to_a.get(int(db_id))
        if aid is not None:
            like_counts[aid] = int(count)

    # --- Saves per artifact_item_id ---
    stmt_saves = select(SavedItem.item_id, func.count(SavedItem.id)).group_by(
        SavedItem.item_id
    )
    if db_filter:
        stmt_saves = stmt_saves.where(SavedItem.item_id.in_(db_filter))
    if since is not None:
        stmt_saves = stmt_saves.where(SavedItem.created_at >= since)
    save_counts: Dict[int, int] = {}
    for db_id, count in session.execute(stmt_saves).all():
        aid = d_to_a.get(int(db_id))
        if aid is not None:
            save_counts[aid] = int(count)

    # --- Positive ratings per artifact_item_id ---
    stmt_ratings = (
        select(Rating.item_id, func.count(Rating.id))
        .where(_engagement_positive_rating_clause())
        .group_by(Rating.item_id)
    )
    if db_filter:
        stmt_ratings = stmt_ratings.where(Rating.item_id.in_(db_filter))
    if since is not None:
        stmt_ratings = stmt_ratings.where(Rating.updated_at >= since)
    rating_counts: Dict[int, int] = {}
    for db_id, count in session.execute(stmt_ratings).all():
        aid = d_to_a.get(int(db_id))
        if aid is not None:
            rating_counts[aid] = int(count)

    # --- Merge ---
    all_ids = set(like_counts) | set(save_counts) | set(rating_counts)
    out: Dict[int, Dict[str, int]] = {}
    for aid in all_ids:
        like_n = like_counts.get(aid, 0)
        save_n = save_counts.get(aid, 0)
        rate_n = rating_counts.get(aid, 0)
        out[int(aid)] = {
            "like_count": like_n,
            "save_count": save_n,
            "rating_count": rate_n,
            "engagement_score": like_n + save_n + rate_n,
        }
    return out


def live_item_ctr(
    window_days: int = 30,
    item_ids: Optional[Iterable[int]] = None,
) -> Dict[int, Dict[str, object]]:
    """Per-item impressions, views and click-through rate over a time window.

    This is the "Selected" signal of ADR-002 §3.2. The domain has no booking
    flow, so instead of inventing one we measure whether users who were
    *shown* an item chose to open it:

    * ``impressions`` — rows in ``recommendation_results`` whose parent
      ``recommendation_requests.created_at`` falls inside the window.
    * ``views`` — all ``interaction_logs`` rows with
      ``action_type='item_view'`` in the window (deduped at write time, see
      ADR-002 §3.1). This is the raw View signal.
    * ``attributed_views`` — the subset of those views carrying a
      ``recommendation_request_id``, i.e. views a recommendation actually
      caused.
    * ``ctr`` — ``attributed_views / impressions``, or ``None`` below the
      impression floor.

    CTR deliberately uses **attributed** views, not all views: a user who
    finds an item by browsing did not click through from a recommendation,
    so counting that view would inflate the rate (and could push it above
    1.0, since browse traffic is unbounded by impressions).

    CTR is a **rate**, so an item is not rewarded merely for being shown
    often — which also keeps the popularity feedback loop in check.

    ``ctr`` is ``None`` (not ``0.0``) when ``impressions`` is under
    ``RECSYS_CTR_IMPRESSION_FLOOR``: with a handful of impressions the ratio
    is noise, and a single lucky click would otherwise top the ranking.
    Callers must exclude ``None`` from the weighted sum rather than
    substituting zero, which would wrongly penalise new items.

    Returns ``{}`` when the DB is disabled. Keyed by **artifact id**. Items
    with neither impressions nor views are absent; callers should treat
    absence as zero (matches ``live_item_engagement``).
    """
    if not is_db_enabled():
        return {}
    with session_scope() as session:
        if session is None:
            return {}
        return _live_item_ctr(session, window_days, item_ids)


def _live_item_ctr(
    session: Session,
    window_days: int = 30,
    item_ids: Optional[Iterable[int]] = None,
) -> Dict[int, Dict[str, object]]:
    """Internal impl; takes a session so tests can drive SQLite.

    Two GROUP BY queries (impressions, views) merged in Python, mirroring
    the ``_live_item_engagement`` shape. Both source tables key on
    ``items.id``, so results are translated to artifact-id space on the way
    out.
    """
    from datetime import datetime, timedelta, timezone

    from ..core.config import get_settings
    from ..models_db import InteractionLog, RecommendationRequest, RecommendationResult

    floor = max(0, int(get_settings().ctr_impression_floor))
    since = datetime.now(timezone.utc) - timedelta(days=max(1, int(window_days)))

    artifact_filter = list(item_ids) if item_ids is not None else None
    db_filter: Optional[List[int]] = None
    if artifact_filter:
        a_to_d = {
            int(aid): int(did)
            for aid, did in session.execute(
                select(Item.artifact_item_id, Item.id).where(
                    Item.artifact_item_id.in_(artifact_filter)
                )
            ).all()
        }
        db_filter = [a_to_d[a] for a in artifact_filter if a in a_to_d]
        # An explicit filter that matches nothing must yield nothing, rather
        # than silently falling through to a full-catalog scan below.
        if not db_filter:
            return {}

    d_to_a: Dict[int, int] = {
        int(did): int(aid)
        for aid, did in session.execute(
            select(Item.artifact_item_id, Item.id)
        ).all()
        if aid is not None
    }

    # --- Impressions: results joined to their request for the timestamp ---
    stmt_imp = (
        select(RecommendationResult.item_id, func.count(RecommendationResult.id))
        .join(
            RecommendationRequest,
            RecommendationRequest.id == RecommendationResult.request_id,
        )
        .where(RecommendationRequest.created_at >= since)
        .group_by(RecommendationResult.item_id)
    )
    if db_filter:
        stmt_imp = stmt_imp.where(RecommendationResult.item_id.in_(db_filter))
    impressions: Dict[int, int] = {}
    for db_id, count in session.execute(stmt_imp).all():
        aid = d_to_a.get(int(db_id))
        if aid is not None:
            impressions[aid] = int(count)

    # --- Views (all item_view rows in the window) ---
    stmt_views = (
        select(InteractionLog.item_id, func.count(InteractionLog.id))
        .where(
            InteractionLog.action_type == "item_view",
            InteractionLog.created_at >= since,
            InteractionLog.item_id.is_not(None),
        )
        .group_by(InteractionLog.item_id)
    )
    if db_filter:
        stmt_views = stmt_views.where(InteractionLog.item_id.in_(db_filter))
    views: Dict[int, int] = {}
    for db_id, count in session.execute(stmt_views).all():
        aid = d_to_a.get(int(db_id))
        if aid is not None:
            views[aid] = int(count)

    # --- Attributed views: the CTR numerator (see docstring) ---
    stmt_attr = stmt_views.where(
        InteractionLog.recommendation_request_id.is_not(None)
    )
    attributed: Dict[int, int] = {}
    for db_id, count in session.execute(stmt_attr).all():
        aid = d_to_a.get(int(db_id))
        if aid is not None:
            attributed[aid] = int(count)

    out: Dict[int, Dict[str, object]] = {}
    for aid in set(impressions) | set(views):
        imp = impressions.get(aid, 0)
        vw = views.get(aid, 0)
        attr = attributed.get(aid, 0)
        out[int(aid)] = {
            "impressions": imp,
            "views": vw,
            "attributed_views": attr,
            "ctr": (attr / imp) if imp >= floor and imp > 0 else None,
        }
    return out


def artifact_ids_to_db_ids_with_fallback(
    artifact_ids: Iterable[int], session: Session
) -> Dict[int, int]:
    """Local helper for the engagement path that takes a session that's
    already open so we don't open two sessions per call. Public callers
    should prefer ``artifact_ids_to_db_ids`` instead.
    """
    rows = session.execute(
        select(Item.artifact_item_id, Item.id).where(
            Item.artifact_item_id.in_(list(artifact_ids))
        )
    ).all()
    return {int(aid): int(did) for aid, did in rows if aid is not None}


# --- Per-user live state ----------------------------------------------------

def live_user_positive_items(
    user_key: str, min_rating: int = POSITIVE_THRESHOLD
) -> Set[int]:
    """Set of artifact_item_ids the user has positively interacted with.

    Sources: current ``likes`` + ``saved_items`` rows and ``ratings`` rows
    with rating >= min_rating.
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

    # 2. saved items
    for (aid,) in session.execute(
        select(Item.artifact_item_id)
        .join(SavedItem, SavedItem.item_id == Item.id)
        .where(SavedItem.user_key == user_key)
    ).all():
        if aid is not None:
            out.add(int(aid))

    # 3. ratings >= min_rating
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


def live_item_media_for_items(
    artifact_item_ids: Iterable[int],
) -> Dict[int, Dict[str, str]]:
    """Return DB-managed image/video URLs keyed by artifact item id.

    Recommendation candidates come from ``catalog.parquet``, while media is
    uploaded and updated in PostgreSQL.  This batched lookup lets recommendation
    responses overlay the current database media without issuing one query per
    card.  Empty when the DB layer is disabled or unavailable.
    """
    if not is_db_enabled():
        return {}
    artifact_ids = list(dict.fromkeys(int(value) for value in artifact_item_ids))
    if not artifact_ids:
        return {}
    with session_scope() as session:
        if session is None:
            return {}
        rows = session.execute(
            select(Item.artifact_item_id, Item.image_url, Item.video_url).where(
                Item.artifact_item_id.in_(artifact_ids)
            )
        ).all()
    return {
        int(artifact_id): {
            "image_url": str(image_url or ""),
            "video_url": str(video_url or ""),
        }
        for artifact_id, image_url, video_url in rows
        if artifact_id is not None
    }


def _live_user_state_for_items(
    session: Session, user_key: str, artifact_ids: List[int]
) -> Dict[int, UserState]:
    # Resolve the (db id, artifact id) tuples for the requested items.
    id_rows = session.execute(
        select(Item.id, Item.artifact_item_id).where(
            Item.artifact_item_id.in_(artifact_ids)
        )
    ).all()
    db_ids = [int(r[0]) for r in id_rows]
    aid_to_db = {int(aid): int(did) for did, aid in id_rows}
    if not db_ids:
        return {}

    out: Dict[int, UserState] = {
        aid: UserState() for aid in aid_to_db.keys()
    }

    # 1. likes
    for did in session.execute(
        select(Like.item_id).where(
            Like.user_key == user_key, Like.item_id.in_(db_ids)
        )
    ).scalars():
        # reverse-lookup artifact id
        for aid, d in aid_to_db.items():
            if d == int(did):
                out[aid].liked = True
                break

    # 2. saves
    for did in session.execute(
        select(SavedItem.item_id).where(
            SavedItem.user_key == user_key, SavedItem.item_id.in_(db_ids)
        )
    ).scalars():
        for aid, d in aid_to_db.items():
            if d == int(did):
                out[aid].saved = True
                break

    # 3. ratings
    for did, rating in session.execute(
        select(Rating.item_id, Rating.rating).where(
            Rating.user_key == user_key, Rating.item_id.in_(db_ids)
        )
    ).all():
        for aid, d in aid_to_db.items():
            if d == int(did):
                out[aid].rating = int(rating)
                break

    return out


# --- Translation helpers ---------------------------------------------------

def db_id_to_artifact_id(db_id: int) -> Optional[int]:
    """Translate a DB ``items.id`` to its artifact counterpart.

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
            select(Item.artifact_item_id).where(Item.id == int(db_id))
        ).first()
        if row is None or row[0] is None:
            return None
        return int(row[0])


def artifact_id_to_db_id(artifact_id: int) -> Optional[int]:
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


def artifact_ids_to_db_ids(artifact_ids: Iterable[int]) -> Dict[int, int]:
    """Bulk form of ``artifact_id_to_db_id``: {artifact_id: db_id}.

    One query for the whole batch — calling the single-id helper in a loop
    opens a session per id. Artifact ids with no matching row are simply
    absent from the result.
    """
    if not is_db_enabled():
        return {}
    ids = [int(a) for a in artifact_ids]
    if not ids:
        return {}
    with session_scope() as session:
        if session is None:
            return {}
        rows = session.execute(
            select(Item.artifact_item_id, Item.id).where(
                Item.artifact_item_id.in_(ids)
            )
        ).all()
        return {int(aid): int(did) for aid, did in rows if aid is not None}
