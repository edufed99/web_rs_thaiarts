"""
services/cf_service.py — Port of recommender/cf_itemknn.py.

Collaborative filtering using a precomputed ItemKNN index. Items the user
already positively interacted with get a score of zero. Users with no
history fall back to popularity scores (item → number of positive users).

When Postgres is enabled, this service overlays live positive evidence from
the ``legacy_interactions`` table onto the static artifact, so newly imported
ratings are reflected without re-running the pipeline.
"""
from __future__ import annotations

from collections import defaultdict
from math import sqrt
from typing import Dict, List, Optional, Set

from ..core.config import Settings
from ..model_loader import ArtifactLoader
from .db_query import live_positive_users_per_item


def score_items_by_itemknn(
    loader: ArtifactLoader,
    user_key: Optional[str],
    candidate_items: List[Dict],
    settings: Optional[Settings] = None,
) -> Dict[int, float]:
    """
    Returns {item_id: cf_score} for every candidate.

    If the user has positive history in the artifact's CF index, compute
    cosine-based ItemKNN scores (with shrinkage) and take the top-K
    neighbours. Otherwise, fall back to popularity (= number of positive
    users per item). Positive users from the live DB are merged in if enabled.
    """
    settings = settings or Settings()
    candidate_ids: Set[int] = {int(item["item_id"]) for item in candidate_items}
    if not candidate_ids:
        return {}

    user_history = _get_user_history(loader, user_key)
    if not user_history:
        return _popularity_scores(loader, candidate_ids, candidate_ids)

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
    Return (item_users, rating_weight) — the static artifact index possibly
    enriched with live legacy interactions from Postgres.
    """
    item_users: Dict[int, Set[str]] = {
        int(k): set(v) for k, v in loader.cf_item_users.items()
    }
    rating_weight: Dict[str, float] = dict(loader.cf_rating_weight)

    live = live_positive_users_per_item()
    if not live:
        return item_users, rating_weight

    # Merge live users (legacy:<id>) into the static item_users map.
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
    if not user_key:
        return set()
    return set(loader.cf_user_item.get(user_key, []))


def _popularity_scores(loader: ArtifactLoader, candidate_ids: Set[int], _unused=None) -> Dict[int, float]:
    item_users, _ = _merged_cf_index(loader)
    return {cid: float(len(item_users.get(cid, []))) for cid in candidate_ids}


def user_rating_weight(loader: ArtifactLoader, user_key: str, item_id: int) -> float:
    return loader.user_rating_weight(user_key, item_id)