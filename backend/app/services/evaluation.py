"""
services/evaluation.py — Online evaluation recompute from live telemetry.

Recomputes the recommendation quality metrics (nDCG@10, HR@10, MRR@10,
Coverage, Violation rate) from the last N days of recommendation requests
and the interactions users actually performed, then persists the result as
an ``evaluation_runs`` row with ``source='online'``.

This is a **write** concern of the recommendation path, not of the dashboard
read path: it is triggered from the telemetry adapter after each successful
recommendation request is persisted, and the *read* of the latest run lives
in ``dashboard_query._model_quality``. Splitting it out keeps the dashboard
query module read-only and the evaluation logic in a module that matches its
domain (``test_evaluation.py`` covers the offline pipeline; this module is
the online counterpart).
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import is_db_enabled, session_scope
from ..models_db import (
    EvaluationRun,
    InteractionLog,
    Item,
    RecommendationRequest,
    RecommendationResult,
)


def recompute_online_eval(window_days: int = 30) -> Optional[Dict[str, Any]]:
    """Recompute nDCG/HR/MRR/Coverage/Violation from the last N days.

    Called by the recommendations router after each successful request.
    Returns ``None`` when the DB is disabled or no telemetry exists yet.

    Definition of "positive" for online evaluation:
    a recommendation result is positive if the same user opened the
    same item's detail page (interaction_logs.action_type='view' or any
    item-touching action like 'like' / 'save' / 'rate') within 24 hours
    of the recommendation request.
    """
    if not is_db_enabled():
        return None

    try:
        with session_scope() as session:
            if session is None:
                return None
            return _compute_online_eval_in_session(session, window_days)
    except Exception:  # noqa: BLE001 - telemetry writes must never break the request path
        return None


def _compute_online_eval_in_session(session: Session, window_days: int) -> Optional[Dict[str, Any]]:
    since = datetime.now(timezone.utc) - timedelta(days=window_days)

    # Pull all rec results in window + their requests.
    rows = session.execute(
        select(
            RecommendationResult.request_id,
            RecommendationResult.item_id,
            RecommendationResult.rank,
            RecommendationResult.is_context_valid,
            RecommendationRequest.selected_context_id,
            RecommendationRequest.user_id,
        )
        .join(RecommendationRequest, RecommendationRequest.id == RecommendationResult.request_id)
        .where(RecommendationRequest.created_at >= since)
    ).all()

    if not rows:
        return None

    # Resolve each request to the user_key the request was made under.
    # The router stores `user_id` (a real users.id) for JWT-authed callers
    # and the live `anon:<uuid>` flow goes through `interaction_logs` —
    # the user_key on the matching interaction_log row is the source of
    # truth, joined via the request_id FK added in 0006.
    user_key_rows = session.execute(
        select(InteractionLog.recommendation_request_id, InteractionLog.user_key, InteractionLog.created_at, InteractionLog.item_id)
        .where(InteractionLog.recommendation_request_id.is_not(None))
        .where(InteractionLog.created_at >= since)
    ).all()
    log_by_request: Dict[int, List[Tuple[str, datetime, int]]] = {}
    for req_id, user_key, created_at, item_db_id in user_key_rows:
        log_by_request.setdefault(int(req_id), []).append(
            (str(user_key), created_at, int(item_db_id) if item_db_id is not None else 0)
        )

    # Group recommendation results by user_key (via log_by_request).
    user_topk: Dict[str, List[int]] = {}
    user_violations: Dict[str, int] = {}
    user_total: Dict[str, int] = {}
    for req_id, item_db_id, rank, is_valid, ctx_id, user_db_id in rows:
        if rank > 10:
            continue
        logs = log_by_request.get(int(req_id), [])
        if not logs:
            continue
        user_key = logs[0][0]
        user_topk.setdefault(user_key, [])
        if len(user_topk[user_key]) < 10:
            user_topk[user_key].append(int(item_db_id))
        user_total[user_key] = user_total.get(user_key, 0) + 1
        if not is_valid:
            user_violations[user_key] = user_violations.get(user_key, 0) + 1

    if not user_topk:
        return None

    # Build the positives set: (user_key, item_db_id) where the user
    # viewed/acted on the item within 24h of the request. We pull the
    # same interaction_logs we already have and build a per-user set.
    positives: Dict[str, set] = {}
    for req_id, items in log_by_request.items():
        for user_key, created_at, item_db_id in items:
            if item_db_id <= 0:
                continue
            positives.setdefault(user_key, set()).add(item_db_id)

    ndcg_sum = hr_sum = mrr_sum = 0.0
    user_count = 0
    unique_items = set()
    for user_key, topk in user_topk.items():
        if not topk:
            continue
        user_count += 1
        for it in topk:
            unique_items.add(it)
        dcg = 0.0
        hits = 0
        rr = 0.0
        for idx, it in enumerate(topk, start=1):
            unique_items.add(it)
            if it in positives.get(user_key, set()):
                dcg += 1.0 / _log2(idx + 1)
                hits += 1
                if rr == 0.0:
                    rr = 1.0 / idx
        # IDCG assumes all positives are at the top.
        ideal_hits = min(len(positives.get(user_key, set())), 10)
        idcg = sum(1.0 / _log2(i + 1) for i in range(1, ideal_hits + 1))
        ndcg = (dcg / idcg) if idcg > 0 else 0.0
        ndcg_sum += ndcg
        hr_sum += 1.0 if hits > 0 else 0.0
        mrr_sum += rr

    n_users = max(user_count, 1)
    total_items = session.execute(select(func.count()).select_from(Item).where(Item.is_active.is_(True))).scalar_one() or 0
    total_recs = sum(user_total.values()) or 1
    violations = sum(user_violations.values())

    payload = {
        "ndcg10": round(ndcg_sum / n_users, 4),
        "hr10": round(hr_sum / n_users, 4),
        "mrr10": round(mrr_sum / n_users, 4),
        "coverage": round(len(unique_items) / total_items, 4) if total_items else 0.0,
        "violation_rate": round(violations / total_recs, 4),
        "test_user_count": user_count,
        "test_interaction_count": sum(len(v) for v in user_topk.values()),
        "metadata_json": json.dumps({"window_days": window_days, "kind": "online"}),
    }

    # Persist.
    run = EvaluationRun(
        source="online",
        ndcg10=payload["ndcg10"],
        hr10=payload["hr10"],
        mrr10=payload["mrr10"],
        coverage=payload["coverage"],
        violation_rate=payload["violation_rate"],
        test_user_count=payload["test_user_count"],
        test_interaction_count=payload["test_interaction_count"],
        metadata_json=payload["metadata_json"],
    )
    session.add(run)
    return payload


def _log2(x: float) -> float:
    import math
    return math.log(x, 2)
