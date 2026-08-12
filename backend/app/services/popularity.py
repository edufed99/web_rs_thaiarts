"""
services/popularity.py — Multi-signal, time-decayed, Bayesian-smoothed
popularity score (ADR-002 §4).

Replaces the hardcoded ``engagement_score = like + save + rating`` in
``db_query._live_item_engagement`` with a score that:

* is normalised on the **whole catalog** (not the filtered result)
  so two screens agree on the same item, and the score is cacheable;
* smooths raw ratings with a Bayesian prior (5★×1 must not beat
  4.8★×100);
* time-decays contributing events with a half-life (a "popular now"
  signal, not a "popular since launch" one);
* is composed of factor sub-scores whose weights are admin-tunable
  through the ``popularity_weights`` table.

The score is **browse-only**: it never enters
``/recommendations`` ranking (ADR-001 §5 invariant). Popularity
informing recommendations is a feedback loop and would make the
filter-promote-popular-and-popular-thrives trap worse.

Concurrency
-----------
The cache is module-level (``_CACHE``) and the service is stateless
apart from it. ``set_weights`` invalidates entries whose ``weights_id``
matches the row it deactivated; new keys insert unconditionally. There
is no Lock — the cost of a stale read for one request window is much
lower than the cost of a global lock, and the recompute is cheap
(``~30 ms`` on the production corpus).
"""
from __future__ import annotations

import json
import logging
import math
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from ..models_db import (
    InteractionLog,
    Item,
    PopularityWeight,
    Rating,
    RecommendationRequest,
    RecommendationResult,
)
from .db_query import live_item_engagement

logger = logging.getLogger("recsys.popularity")


# --- Public surface ---------------------------------------------------------

# Public so tests can assert exactly which factors the active weights
# cover; also useful when a future metric endpoint wants to report
# coverage (how much of the formula is being used right now).
KNOWN_FACTORS = ("saved", "rating", "like", "view", "ctr", "recency")

# Default weight set per ADR-002 §4.4 (Phase B — view/CTR are not
# applied yet because their source data only appears ~30 days after
# Phase A is live). Used by ``set_weights`` when ``weights_dict`` is
# None and by tests.
DEFAULT_PHASE_B_WEIGHTS: Dict[str, float] = {
    "saved": 0.30,
    "rating": 0.35,
    "like": 0.25,
    "recency": 0.10,
}

# Public so tests can assert the validation tolerance.
WEIGHT_SUM_TOLERANCE = 1e-3

# Per ADR-002 §4.1 — the normalisation population is the whole
# catalog, even when callers ask for a subset. Decoupling the two is
# what makes the score comparable across calls.
_NORMALISATION_POPULATION = "all"


# --- Weights CRUD ------------------------------------------------------------


class WeightsValidationError(ValueError):
    """Raised by ``set_weights`` when the proposed weights are invalid.

    A custom subclass so the router can map it to a 400 with a specific
    code, and so tests can pin the distinction from other ValueError
    sources.
    """


def _validate_weights(weights_dict: Dict[str, float]) -> None:
    if not isinstance(weights_dict, dict) or not weights_dict:
        raise WeightsValidationError(
            "weights must be a non-empty dict mapping factor name to weight."
        )
    for name in weights_dict:
        if name not in KNOWN_FACTORS:
            raise WeightsValidationError(
                f"unknown factor '{name}'. Known: {list(KNOWN_FACTORS)}"
            )
        value = weights_dict[name]
        if not isinstance(value, (int, float)):
            raise WeightsValidationError(
                f"weight for '{name}' must be numeric, got {type(value).__name__}."
            )
        if not 0.0 <= float(value) <= 1.0:
            raise WeightsValidationError(
                f"weight for '{name}' must be in [0, 1], got {value}."
            )
    total = sum(float(v) for v in weights_dict.values())
    if abs(total - 1.0) > WEIGHT_SUM_TOLERANCE:
        raise WeightsValidationError(
            f"weights must sum to 1.0 ± {WEIGHT_SUM_TOLERANCE}, got {total:.6f}."
        )


def active_weights(session: Session) -> Optional[PopularityWeight]:
    """The single row with ``is_active=True``, or ``None`` if unset.

    In practice the migration seeds one and ``set_weights`` always
    deactivates the previous active before inserting the new, so this
    should only be ``None`` for a freshly-migrated DB whose seed
    somehow failed.
    """
    return (
        session.query(PopularityWeight)
        .filter(PopularityWeight.is_active.is_(True))
        .order_by(PopularityWeight.updated_at.desc())
        .first()
    )


def list_weights(session: Session) -> List[PopularityWeight]:
    return (
        session.query(PopularityWeight)
        .order_by(PopularityWeight.updated_at.desc())
        .all()
    )


def set_weights(
    session: Session,
    *,
    weights_dict: Optional[Dict[str, float]] = None,
    half_life_days: int = 14,
    bayes_m: int = 3,
    updated_by: str = "",
) -> PopularityWeight:
    """Validate, deactivate the previous active row, insert the new one.

    Validation rules (raise ``WeightsValidationError``):

    * ``weights_dict`` must be a non-empty dict, factors from
      ``KNOWN_FACTORS``, values in ``[0, 1]``, sum to 1.0 ± tolerance.
    * ``half_life_days`` ≥ 0 (0 disables time decay).
    * ``bayes_m`` ≥ 0 (0 disables Bayesian smoothing).

    Returns the newly-inserted row. Callers must commit the session
    themselves so the test fixture can roll back.
    """
    if weights_dict is None:
        weights_dict = dict(DEFAULT_PHASE_B_WEIGHTS)
    _validate_weights(weights_dict)
    if half_life_days < 0:
        raise WeightsValidationError(f"half_life_days must be ≥ 0, got {half_life_days}.")
    if bayes_m < 0:
        raise WeightsValidationError(f"bayes_m must be ≥ 0, got {bayes_m}.")

    # Single-row invariant. Done in the same transaction as the insert
    # so a crash between deactivation and insert can't leave two active
    # rows.
    session.query(PopularityWeight).filter(
        PopularityWeight.is_active.is_(True)
    ).update({PopularityWeight.is_active: False})

    new_row = PopularityWeight(
        weights_json=json.dumps(weights_dict, ensure_ascii=False),
        half_life_days=int(half_life_days),
        bayes_m=int(bayes_m),
        is_active=True,
        updated_by=str(updated_by)[:150],
    )
    session.add(new_row)
    session.flush()  # populate ``id`` and ``updated_at`` for the cache key
    reset_popularity_cache()
    return new_row


# --- Cache -------------------------------------------------------------------

# Keyed on (window_days, weights_id) — different window or weights
# invalidates. Bumped on ``set_weights``; bumped on reset by tests.
_CACHE: Dict[tuple, Dict[int, dict]] = {}


def reset_popularity_cache() -> None:
    """Drop the in-memory cache. Test helper + invoked by ``set_weights``."""
    _CACHE.clear()


# --- Sub-score aggregation ---------------------------------------------------

# Action types whose ``interaction_logs`` rows contribute to the
# net-positive count per item. ``unlike`` and ``unsave`` are netted
# against the positives (a like→unlike→like sequence collapses to +1).
_DECAYED_POSITIVE_ACTIONS = ("like", "save", "rate")
_DECAYED_NEGATIVE_ACTIONS = ("unlike", "unsave")


def _decayed_net_events(
    session: Session,
    since: datetime,
    half_life_days: int,
) -> Dict[int, float]:
    """Per-item sum of ``exp(-λ · age_days)`` for net positive events.

    ``λ = ln(2) / half_life_days`` so a 14-day half-life halves the
    weight every 14 days. Reads from ``interaction_logs`` because the
    state tables (``likes``, ``saved_items``, ``ratings``) hold only
    current state with no time dimension (``unlike`` deletes the row
    — see ``services.actions._unlike``).
    """
    if half_life_days <= 0:
        # No decay — every positive event in the window counts as 1,
        # every negative as -1. This is what ``m=0`` historically meant
        # before the per-factor half-life existed.
        pos = dict(
            session.execute(
                select(InteractionLog.item_id, func.count(InteractionLog.id))
                .where(
                    InteractionLog.action_type.in_(_DECAYED_POSITIVE_ACTIONS),
                    InteractionLog.created_at >= since,
                    InteractionLog.item_id.is_not(None),
                )
                .group_by(InteractionLog.item_id)
            ).all()
        )
        neg = dict(
            session.execute(
                select(InteractionLog.item_id, func.count(InteractionLog.id))
                .where(
                    InteractionLog.action_type.in_(_DECAYED_NEGATIVE_ACTIONS),
                    InteractionLog.created_at >= since,
                    InteractionLog.item_id.is_not(None),
                )
                .group_by(InteractionLog.item_id)
            ).all()
        )
        out: Dict[int, float] = {}
        for db_id, count in pos.items():
            out[int(db_id)] = float(count)
        for db_id, count in neg.items():
            out[int(db_id)] = out.get(int(db_id), 0.0) - float(count)
        return out

    lam = math.log(2.0) / float(half_life_days)
    now = datetime.now(timezone.utc)
    out = {}
    # Per-row computation: with the corpus's ~10k rows over 30 days this
    # is still cheap; if it grows past 1M the SQL approach can be
    # replaced with a date-bucket GROUP BY without changing the API.
    rows = session.execute(
        select(
            InteractionLog.item_id,
            InteractionLog.action_type,
            InteractionLog.created_at,
        ).where(
            InteractionLog.action_type.in_(
                _DECAYED_POSITIVE_ACTIONS + _DECAYED_NEGATIVE_ACTIONS
            ),
            InteractionLog.created_at >= since,
            InteractionLog.item_id.is_not(None),
        )
    ).all()
    for db_id, action_type, created_at in rows:
        # ``created_at`` is tz-aware UTC in Postgres; the in-memory test
        # SQLite occasionally returns naive datetimes — normalise.
        if created_at is None:
            continue
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        age_days = max(0.0, (now - created_at).total_seconds() / 86400.0)
        sign = 1.0 if action_type in _DECAYED_POSITIVE_ACTIONS else -1.0
        out[int(db_id)] = out.get(int(db_id), 0.0) + sign * math.exp(-lam * age_days)
    return out


def _bayesian_ratings(
    session: Session,
    bayes_m: int,
) -> Dict[int, tuple]:
    """Per-item ``(WR, R, v)`` where ``WR`` is the Bayesian mean.

    ``C`` (catalog-wide mean) is computed once and applied to every
    item, matching the IMDb-WR formulation. ``v`` is included so the
    endpoint can show confidence, not just the smoothed score.
    """
    if bayes_m <= 0:
        # Disabled — return raw mean instead. Per ADR-002 §4.2 this is
        # a legitimate "I trust the sample size" override, not a bug.
        rows = session.execute(
            select(
                Rating.item_id,
                func.avg(Rating.rating),
                func.count(Rating.id),
            ).group_by(Rating.item_id)
        ).all()
        catalog_mean = 0.0
        if rows:
            n = sum(int(c) for _, _, c in rows)
            catalog_mean = (
                sum(float(avg) * int(c) for _, avg, c in rows) / n if n else 0.0
            )
        return {
            int(db_id): (float(avg) if avg is not None else catalog_mean, float(avg or 0.0), int(c))
            for db_id, avg, c in rows
        }

    rows = session.execute(
        select(
            Rating.item_id,
            func.avg(Rating.rating),
            func.count(Rating.id),
        ).group_by(Rating.item_id)
    ).all()
    n_total = sum(int(c) for _, _, c in rows)
    if n_total == 0:
        return {}
    catalog_mean = sum(
        float(avg) * int(c) for _, avg, c in rows if avg is not None
    ) / n_total
    out: Dict[int, tuple] = {}
    for db_id, avg, c in rows:
        R = float(avg) if avg is not None else catalog_mean
        v = int(c)
        wr = (v * R + float(bayes_m) * catalog_mean) / (v + float(bayes_m))
        out[int(db_id)] = (wr, R, v)
    return out


def _get_positive_threshold() -> int:
    """``settings.positive_threshold`` without leaking the import loop."""
    from ..core.config import get_settings

    return int(get_settings().positive_threshold)


def _recency_age_days(
    session: Session,
    since: datetime,
) -> Dict[int, float]:
    """Days since the item's most recent contributing event in the window.

    Items with no events in the window are absent — the caller treats
    absence as ``None`` and excludes the recency factor.
    """
    rows = session.execute(
        select(
            InteractionLog.item_id,
            func.max(InteractionLog.created_at),
        )
        .where(
            InteractionLog.created_at >= since,
            InteractionLog.item_id.is_not(None),
        )
        .group_by(InteractionLog.item_id)
    ).all()
    now = datetime.now(timezone.utc)
    out: Dict[int, float] = {}
    for db_id, last_at in rows:
        if last_at is None:
            continue
        if last_at.tzinfo is None:
            last_at = last_at.replace(tzinfo=timezone.utc)
        out[int(db_id)] = max(0.0, (now - last_at).total_seconds() / 86400.0)
    return out


# --- Normalisation -----------------------------------------------------------


def _log_minmax(values: Dict[int, float]) -> Dict[int, float]:
    """``log1p`` then min-max into [0, 1] over the given dict's values.

    ADR-002 §4.1: log first so a single breakout item doesn't compress
    the rest to ~0. Returns a copy of the dict with the same keys.
    Degenerate input (all values equal) yields 0.5 for every item, so
    the factor still contributes but doesn't dominate.
    """
    if not values:
        return {}
    log_vals = {k: math.log1p(max(0.0, float(v))) for k, v in values.items()}
    lo = min(log_vals.values())
    hi = max(log_vals.values())
    if hi <= lo:
        return {k: 0.5 for k in log_vals}
    return {k: (v - lo) / (hi - lo) for k, v in log_vals.items()}


def _recency_normalise(ages: Dict[int, float], half_life_days: int) -> Dict[int, float]:
    """Age in days → [0, 1] via exponential decay from the half-life.

    ``1.0`` if the event is *now*, decaying to ~0.5 at half-life,
    ~0.25 at two half-lives. With ``half_life_days == 0`` we map age
    straight to ``1 / (1 + age)`` as a monotonic fallback.
    """
    if half_life_days <= 0:
        return {k: 1.0 / (1.0 + float(v)) for k, v in ages.items()}
    lam = math.log(2.0) / float(half_life_days)
    return {k: float(math.exp(-lam * float(v))) for k, v in ages.items()}


# --- Main entry point --------------------------------------------------------


def compute_popularity_scores(
    session: Session,
    *,
    window_days: int = 30,
    artifact_ids: Optional[Iterable[int]] = None,
    weights: Optional[PopularityWeight] = None,
) -> Dict[int, dict]:
    """Compute sub-scores + total for every artifact id with activity.

    The output dict is keyed by **artifact id** (the id the API uses).
    Items with no contributing activity are absent — callers should
    treat absence as zero (matches the contract of
    ``live_item_engagement``).

    Output shape per item:

    * ``sub_scores`` — ``{saved, rating, like, view, ctr, recency}``
      where each value is the normalised sub-score in [0, 1] or
      ``None`` when the factor is not computable.
    * ``total`` — the weighted sum, renormalised to [0, 1] when
      any factor is ``None`` (so ``total`` is always 0..1).
    * ``engagement_score`` — the legacy value (likes + saves + positive
      ratings) kept for the admin dashboard's existing tile.
    * ``weights_applied`` — the factor names that actually
      contributed (after dropping None factors); the renormalisation
      is over this set, not the original weights dict.
    * ``weights_id`` — the id of the ``PopularityWeight`` row that
      scored this item (always the same across one call).

    When ``weights`` is None the function reads the active row from
    the same session. A 0-row or stale active row is treated as
    "unavailable" and returns ``{}``.
    """
    if weights is None:
        weights = active_weights(session)
    if weights is None:
        return {}

    cache_key = (int(window_days), int(weights.id))
    if cache_key in _CACHE:
        cached = _CACHE[cache_key]
        if artifact_ids is not None:
            wanted = set(int(a) for a in artifact_ids)
            return {aid: row for aid, row in cached.items() if aid in wanted}
        return cached

    weights_dict = weights.weights()
    if not weights_dict:
        logger.warning("popularity weights row %d has empty weights_json", weights.id)
        return {}

    # Translate the artifact filter into DB ids (filter) and back at the
    # end. The normalisation population stays the whole catalog
    # (ADR-002 §4.1) so we cannot short-circuit aggregation.
    artifact_filter = (
        set(int(a) for a in artifact_ids) if artifact_ids is not None else None
    )

    # 1. Raw counts -----------------------------------------------
    since = datetime.now(timezone.utc) - timedelta(days=max(1, int(window_days)))

    # DB-id → artifact-id map for the whole catalog (full population).
    artifact_to_db = dict(
        session.execute(select(Item.artifact_item_id, Item.id)).all()
    )
    db_to_artifact = {int(v): int(k) for k, v in artifact_to_db.items() if v is not None}
    if not db_to_artifact:
        return {}

    # 1a. Engagement-style counts (Phase A aggregation).
    engagement = live_item_engagement()  # keyed by artifact id
    like_raw: Dict[int, float] = {aid: float(v.get("like_count", 0)) for aid, v in engagement.items()}
    saved_raw: Dict[int, float] = {aid: float(v.get("save_count", 0)) for aid, v in engagement.items()}

    # 1b. Time-decayed net positive events per item (DB-id space;
    # translate to artifact-id space).
    decayed_db = _decayed_net_events(session, since, weights.half_life_days)
    like_decayed = {
        db_to_artifact[k]: max(0.0, v) for k, v in decayed_db.items() if k in db_to_artifact
    }

    # 1c. Bayesian WR (DB-id space → artifact-id).
    rating_db = _bayesian_ratings(session, weights.bayes_m)
    rating_raw: Dict[int, float] = {
        db_to_artifact[db_id]: float(WR) for db_id, (WR, _R, _v) in rating_db.items()
        if db_id in db_to_artifact
    }
    rating_confidence: Dict[int, int] = {
        db_to_artifact[db_id]: int(v) for db_id, (_WR, _R, v) in rating_db.items()
        if db_id in db_to_artifact
    }

    # 1d. Recency: days since last event (catalog-wide).
    recency_ages_db = _recency_age_days(session, since)
    recency_ages: Dict[int, float] = {
        db_to_artifact[db_id]: age for db_id, age in recency_ages_db.items()
        if db_id in db_to_artifact
    }

    # CTR — Phase A primitive. Reads the same ctr_impression_floor and
    # window. Pass the catalog-wide population so the floor check is
    # uniform regardless of the caller's filter.
    from .db_query import live_item_ctr  # local import to avoid circulars

    ctr_payload = live_item_ctr(window_days=int(window_days))
    ctr_raw: Dict[int, float] = {
        aid: float(row["ctr"])
        for aid, row in ctr_payload.items()
        if row.get("ctr") is not None
    }
    view_raw: Dict[int, float] = {
        aid: float(row.get("views", 0)) for aid, row in ctr_payload.items()
    }

    # Positive-rating count per item for the legacy engagement score.
    # Mirrors ``live_item_engagement``'s "rating >= positive_threshold"
    # rule. Done as a single GROUP BY (not by joining per-item) so the
    # engagement total is just the sum of three already-known
    # per-artifact counts.
    pos_threshold = max(1, int(_get_positive_threshold()))
    pos_rating_counts_db: Dict[int, int] = dict(
        session.execute(
            select(Rating.item_id, func.count(Rating.id))
            .where(Rating.rating >= pos_threshold)
            .group_by(Rating.item_id)
        ).all()
    )
    pos_rating_counts: Dict[int, int] = {
        db_to_artifact[db_id]: int(c)
        for db_id, c in pos_rating_counts_db.items()
        if db_id in db_to_artifact
    }

    # 2. Normalise. log1p+minmax for counts; identity for rates/ages.
    like_norm = _log_minmax(like_decayed or like_raw)
    saved_norm = _log_minmax(saved_raw)
    rating_norm = _log_minmax(rating_raw) if rating_raw else {}
    view_norm = _log_minmax(view_raw)
    ctr_norm = dict(ctr_raw)  # already [0, 1]
    recency_norm = _recency_normalise(recency_ages, weights.half_life_days)

    # 3. Union of contributing items, then renormalised weighted sum.
    all_ids = set(like_norm) | set(saved_norm) | set(rating_norm) | set(
        view_norm
    ) | set(ctr_norm) | set(recency_norm)

    applied_factors = {f for f, w in weights_dict.items() if float(w) > 0.0}
    if artifact_filter is not None:
        all_ids &= artifact_filter

    out: Dict[int, dict] = {}
    for aid in all_ids:
        sub = {
            "saved": saved_norm.get(aid),
            "rating": rating_norm.get(aid),
            "like": like_norm.get(aid),
            "view": view_norm.get(aid),
            "ctr": ctr_norm.get(aid),
            "recency": recency_norm.get(aid),
        }
        # Renormalise over the factors that actually have a value.
        active = {f: float(weights_dict[f]) for f in applied_factors if sub.get(f) is not None}
        if not active:
            total = 0.0
        else:
            scale = sum(active.values())
            total = sum(
                (float(sub[f]) * (w / scale)) for f, w in active.items()
            )
        out[int(aid)] = {
            "sub_scores": sub,
            "total": float(max(0.0, min(1.0, total))),
            "engagement_score": int(
                like_raw.get(aid, 0.0)
                + saved_raw.get(aid, 0.0)
                + pos_rating_counts.get(aid, 0)
            ),
            "weights_applied": list(active.keys()),
            "weights_id": int(weights.id),
            "rating_confidence": rating_confidence.get(aid, 0),
        }

    _CACHE[cache_key] = out
    return out
