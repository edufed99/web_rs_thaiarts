"""
services/cf_service.py — Port of recommender/cf_itemknn.py.

Collaborative filtering using a precomputed ItemKNN index. Items the user
already positively interacted with get a score of zero. Users with no
history receive an all-zero CF vector so the hybrid ranking reduces to CBF.

Live evidence
-------------
When Postgres is enabled, two sources of live evidence are merged on top
of the static artifact:

1. **Legacy interactions** (``legacy_interactions``) — joined through
   ``items.artifact_item_id`` so the keys land in artifact-id space.
2. **User actions** (``likes`` / ``ratings``) — surfaced for the current
   ``user_key`` so a fresh ``anon:<uuid>`` user gets real ItemKNN results
   on their first request (instead of falling through to popularity).

Both legacy users (``legacy:<id>``) and live users (``anon:<uuid>``)
coexist in the same item_users / rating_weight maps.
"""
from __future__ import annotations

from collections import defaultdict
from math import sqrt
from typing import Dict, List, Optional, Set

from ..core.config import Settings
from ..model_loader import ArtifactLoader
from .db_query import (
    live_positive_users_per_item_artifact,
    live_user_positive_items,
)


def score_items_by_itemknn(
    loader: ArtifactLoader,
    user_key: Optional[str],
    candidate_items: List[Dict],
    settings: Optional[Settings] = None,
) -> Dict[int, float]:
    """
    Returns {item_id: cf_score} for every candidate.

    If the user has positive history in the artifact's CF index **or** in
    the live DB, compute cosine-based ItemKNN scores (with shrinkage) and
    take the top-K neighbours. Otherwise, return zero for every candidate;
    z-score calibration then contributes no CF signal (CBF-only cold start).
    """
    settings = settings or Settings()
    candidate_ids: Set[int] = {int(item["item_id"]) for item in candidate_items}
    if not candidate_ids:
        return {}

    user_history = _get_user_history(loader, user_key)
    if not user_history:
        return {cid: 0.0 for cid in candidate_ids}

    item_users, rating_weight = _merged_cf_index(loader)
    scores: Dict[int, float] = {}
    for cid in candidate_ids:
        if cid in user_history:
            scores[cid] = 0.0
            continue
        sims: List[float] = []
        for hid in user_history:
            sim = _cosine(item_users, cid, hid, settings.itemknn_shrink)
            if sim > 0:
                rw = rating_weight.get(f"{user_key}::{hid}", 1.0)
                sims.append(sim * rw)
        sims.sort(reverse=True)
        top = sims[: settings.itemknn_k]
        scores[cid] = (sum(top) / len(top)) if top else 0.0
    return scores


def _merged_cf_index(loader: ArtifactLoader):
    """
    Return ``(item_users, rating_weight)`` — the static artifact index
    enriched with live legacy positive evidence (in artifact-id space).

    Note: ``legacy_interactions`` rows are joined through
    ``items.artifact_item_id`` so their ``legacy:<id>`` user keys land in
    the same id space as the static artifact (which uses the pipeline's
    ``stable_id("item", name)`` ids).
    """
    item_users: Dict[int, Set[str]] = {
        int(k): set(v) for k, v in loader.cf_item_users.items()
    }
    rating_weight: Dict[str, float] = dict(loader.cf_rating_weight)

    live = live_positive_users_per_item_artifact()
    if not live:
        return item_users, rating_weight

    for item_id, users in live.items():
        existing = item_users.setdefault(int(item_id), set())
        for u in users:
            existing.add(u)
            rating_weight.setdefault(f"{u}::{int(item_id)}", 1.0)
    return item_users, rating_weight


def _cosine(
    item_users: Dict[int, List[str]],
    item_a: int,
    item_b: int,
    shrink: float,
) -> float:
    users_a = set(item_users.get(item_a, []))
    users_b = set(item_users.get(item_b, []))
    if not users_a or not users_b:
        return 0.0
    shared = len(users_a & users_b)
    if shared == 0:
        return 0.0
    return shared / ((sqrt(len(users_a)) * sqrt(len(users_b))) + shrink)


def _get_user_history(loader: ArtifactLoader, user_key: Optional[str]) -> Set[int]:
    """Union of the user's static CF history (artifact index) and live DB
    history (``likes`` + ``ratings`` >= threshold). Both live in artifact-id
    space, so the union is safe.
    """
    if not user_key:
        return set()
    static = set(loader.cf_user_item.get(user_key, []))
    live = live_user_positive_items(user_key)
    return static | live


def user_rating_weight(loader: ArtifactLoader, user_key: str, item_id: int) -> float:
    return loader.user_rating_weight(user_key, item_id)


# --- Rating weight helpers --------------------------------------------------

# Match pipelines/train_or_generate_artifacts.normalize_rating so the live
# merge uses the same weight scheme as the static CF index.
_RATING_FLOOR_DEFAULT = 0.01
_RATING_MIN = 1
_RATING_MAX = 5


def normalize_rating(raw_rating: int, rating_floor: float = _RATING_FLOOR_DEFAULT) -> float:
    """Map a 1..5 raw rating into [rating_floor, 1.0] linearly.

    Mirrors ``pipelines/train_or_generate_artifacts.normalize_rating`` —
    keep the two in sync.
    """
    rating_range = _RATING_MAX - _RATING_MIN
    return rating_floor + (1.0 - rating_floor) * (raw_rating - _RATING_MIN) / rating_range
