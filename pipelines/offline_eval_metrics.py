"""offline_eval_metrics.py — Pure-math helpers for offline evaluation.

Imported by both ``run_offline_evaluation.py`` (the pipeline script) and
``backend/tests/test_evaluation.py`` (the unit tests). Lives under
``pipelines/`` so the script and tests share one source of truth for
the metric formulas.

No DB, no FastAPI, no loader — only stdlib + math. Functions return
plain dicts so the test fixtures stay trivial.
"""
from __future__ import annotations

import math
import random
from collections import defaultdict
from typing import Dict, List, Set, Tuple


def log2(x: float) -> float:
    return math.log(x, 2)


def compute_metrics(
    predictions_by_user: Dict[str, List[int]],
    positives_by_user: Dict[str, set],
) -> Dict[str, float]:
    """nDCG@10 / HR@10 / MRR@10 across users.

    ``predictions_by_user[user]`` is the ordered top-K list.
    ``positives_by_user[user]`` is the set of held-out positives.
    """
    ndcg_sum = hr_sum = mrr_sum = 0.0
    n_users = 0
    for user, topk in predictions_by_user.items():
        if not topk:
            continue
        n_users += 1
        positives = positives_by_user.get(user, set())
        dcg = 0.0
        hits = 0
        rr = 0.0
        for idx, it in enumerate(topk, start=1):
            if it in positives:
                dcg += 1.0 / log2(idx + 1)
                hits += 1
                if rr == 0.0:
                    rr = 1.0 / idx
        ideal_hits = min(len(positives), len(topk))
        idcg = sum(1.0 / log2(i + 1) for i in range(1, ideal_hits + 1))
        ndcg = (dcg / idcg) if idcg > 0 else 0.0
        ndcg_sum += ndcg
        hr_sum += 1.0 if hits > 0 else 0.0
        mrr_sum += rr

    n = max(n_users, 1)
    return {
        "ndcg10": round(ndcg_sum / n, 4),
        "hr10": round(hr_sum / n, 4),
        "mrr10": round(mrr_sum / n, 4),
        "evaluated_users": n_users,
    }


def compute_coverage(predictions_by_user: Dict[str, List[int]], total_items: int) -> float:
    if total_items <= 0:
        return 0.0
    surfaced = set()
    for topk in predictions_by_user.values():
        surfaced.update(topk)
    return round(len(surfaced) / total_items, 4)


def compute_violation_rate(
    predictions_by_user: Dict[str, List[int]],
    context_valid_by_user: Dict[str, List[bool]],
) -> float:
    total = 0
    bad = 0
    for user, topk in predictions_by_user.items():
        valid_flags = context_valid_by_user.get(user, [])
        for idx, _ in enumerate(topk):
            total += 1
            if idx < len(valid_flags) and not valid_flags[idx]:
                bad += 1
    return round(bad / total, 4) if total else 0.0


def holdout_per_user(
    rows: List[Tuple[str, int, int]],
    holdout_pct: float,
    min_ratings: int,
    seed: int,
) -> Tuple[Dict[str, List[int]], Dict[str, set]]:
    """Split per-user positives into train / test deterministically."""
    by_user: Dict[str, List[int]] = defaultdict(list)
    for user_key, item_db_id, _rating in rows:
        by_user[user_key].append(int(item_db_id))

    train: Dict[str, List[int]] = {}
    test: Dict[str, set] = {}
    for user_key, items in by_user.items():
        if len(items) < min_ratings:
            continue
        local_rng = random.Random((hash(user_key) ^ seed) & 0xFFFFFFFF)
        shuffled = list(items)
        local_rng.shuffle(shuffled)
        n_test = max(1, int(round(len(shuffled) * holdout_pct / 100.0)))
        test_items = shuffled[:n_test]
        train_items = shuffled[n_test:]
        if not train_items:
            continue
        train[user_key] = train_items
        test[user_key] = set(test_items)
    return train, test
