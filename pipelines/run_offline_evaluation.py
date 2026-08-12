"""
run_offline_evaluation.py — Offline recommender quality run.

Reads ``legacy_interactions`` from the live Postgres, performs an
80/20 holdout per user (configurable), predicts top-10 for every
test user with the live recommender (same code path the API uses),
and writes a single ``evaluation_runs`` row with source='offline'.

This is the seed value for the dashboard's model-quality tiles.
Re-running the script is idempotent — each invocation appends one
row, and the dashboard always reads the most recent offline run.

Usage
-----
    # from the repo root:
    python pipelines/run_offline_evaluation.py \\
        --holdout-pct 20 \\
        --min-ratings 5 \\
        --top-k 10 \\
        --seed 42

CLI flags
---------
--holdout-pct      Percent of positives held out per user (default 20).
--min-ratings      Minimum positive ratings per user to qualify for
                   evaluation (default 5).
--top-k            K for the predicted top-K (default 10, max 50).
--seed             RNG seed for the deterministic holdout (default 42).
--artifact-dir     Override the artifact directory (default uses
                   ``RECSYS_ARTIFACT_DIR`` or the repo default).
--output-json      Optional path to also dump the metrics as JSON for
                   pipeline auditing. Default:
                   ``artifacts/outputs/eval/last_offline.json``.
--quiet            Suppress per-user progress.

Output
------
* One INSERT into ``evaluation_runs`` (source='offline').
* Optional JSON dump for offline auditing.
* A summary table printed to stdout (always).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Make ``backend/`` importable so we can reuse the in-process services
# and DB session factory. The script is intended to be invoked from the
# repo root (``python pipelines/run_offline_evaluation.py``) so the
# default ``sys.path[0]`` is the repo root and ``backend.app`` is
# reachable via the relative path below.
_REPO_ROOT = Path(__file__).resolve().parents[1]
_BACKEND = _REPO_ROOT / "backend"
for _p in (str(_REPO_ROOT), str(_BACKEND)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from offline_eval_metrics import (  # noqa: E402  (after sys.path tweak)
    compute_coverage,
    compute_metrics,
    compute_violation_rate,
    holdout_per_user,
)
from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.db import is_db_enabled, session_scope  # noqa: E402
from app.model_loader import ArtifactLoader  # noqa: E402
from app.models_db import (  # noqa: E402
    EvaluationRun,
    Item,
    LegacyInteraction,
)
from app.schemas.recommendation import RecommendationRequestIn  # noqa: E402
from app.services.recommendation_service import generate_recommendations  # noqa: E402


# ---------------------------------------------------------------------------
# Prediction
# ---------------------------------------------------------------------------


def predict_topk(
    loader: ArtifactLoader,
    train: Dict[str, List[int]],
    test_users: List[str],
    top_k: int,
) -> Tuple[Dict[str, List[int]], Dict[str, List[bool]]]:
    """Use the live recommender to predict top-K for each test user.

    The CF index is loaded once at process start and is not mutated
    here — the train items are "known" via the artifact but the
    recommender scores purely on the artifact's CF/embedding data. We
    do **not** modify the loader in this script.

    Returns ``(predictions, context_valid_flags)``.
    """
    predictions: Dict[str, List[int]] = {}
    context_valid: Dict[str, List[bool]] = {}
    # Pre-build a quick lookup from artifact item_id → valid contexts.
    item_to_contexts: Dict[int, set] = {}
    for _, row in loader.items.iterrows():
        iid = int(row.get("item_id"))
        ctxs = set(row.get("context_names") or [])
        item_to_contexts[iid] = ctxs

    for user_key in test_users:
        # Find a context this user has any training data for. If the
        # user has zero context-tagged training rows we still pick a
        # context (round-robin over known contexts) so the recommender
        # has a gate to evaluate.
        ctx_id = _pick_context_for_user(loader, user_key, train.get(user_key, []))
        req = RecommendationRequestIn(
            context_id=int(ctx_id),
            keyword_ids=[],
            top_k=int(top_k),
            user_key=str(user_key),
        )
        try:
            response = generate_recommendations(loader, req)
        except Exception as exc:  # noqa: BLE001
            print(f"  ! predict failed for {user_key}: {exc}", file=sys.stderr)
            continue
        ranked = [int(r.item.id) for r in response.results if getattr(r, "item", None) is not None]
        predictions[user_key] = ranked
        ctx_name = response.selected_context.name if response.selected_context else ""
        context_valid[user_key] = [
            ctx_name in item_to_contexts.get(int(r.item.id), set()) for r in response.results if getattr(r, "item", None) is not None
        ]
    return predictions, context_valid


def _pick_context_for_user(loader: ArtifactLoader, user_key: str, train_items: List[int]) -> int:
    """Pick a context the user has any history in. Falls back to a
    stable context (the first in the loader's id map) so the recommender
    still has a gate to apply.
    """
    id_to_name = {int(cid): str(name) for cid, name in zip(loader.context_ids, loader.context_names)} \
        if hasattr(loader, "context_names") else {}
    # Build item → contexts map.
    item_to_contexts: Dict[int, List[str]] = {}
    for _, row in loader.items.iterrows():
        item_to_contexts[int(row.get("item_id"))] = list(row.get("context_names") or [])
    candidate_names: List[str] = []
    seen: set = set()
    for iid in train_items:
        for cname in item_to_contexts.get(iid, []):
            if cname and cname not in seen:
                candidate_names.append(cname)
                seen.add(cname)
    if not candidate_names:
        # Fall back to the first context the loader knows about.
        if id_to_name:
            return next(iter(id_to_name.keys()))
        return 0
    # Map the first matching name back to its artifact id.
    name_to_id = {v: k for k, v in id_to_name.items()}
    return int(name_to_id.get(candidate_names[0], next(iter(name_to_id.keys()), 0)))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    args = _parse_args()
    settings = get_settings()
    if not is_db_enabled():
        print("ERROR: RECSYS_DB_ENABLED=0 — offline evaluation needs the live DB to read legacy_interactions.", file=sys.stderr)
        return 2

    artifact_dir = Path(args.artifact_dir or settings.artifact_dir)
    print(f"[offline-eval] loading artifacts from {artifact_dir} ...")
    loader = ArtifactLoader()
    loader.load(artifact_dir)

    print(f"[offline-eval] reading legacy_interactions (rating >= {settings.positive_threshold}) ...")
    with session_scope() as session:
        if session is None:
            print("ERROR: DB session unavailable.", file=sys.stderr)
            return 2
        rows = session.execute(
            select(LegacyInteraction.legacy_user_id, LegacyInteraction.item_id, LegacyInteraction.rating)
            .where(LegacyInteraction.rating >= int(settings.positive_threshold))
        ).all()

    legacy_rows: List[Tuple[str, int, int]] = [
        (f"user:{str(uid)}", int(iid), int(rating)) for uid, iid, rating in rows
    ]
    print(f"[offline-eval] {len(legacy_rows)} positive interactions from {len(set(r[0] for r in legacy_rows))} users")

    train, test = holdout_per_user(legacy_rows, args.holdout_pct, args.min_ratings, args.seed)
    print(f"[offline-eval] {len(train)} users qualify (>= {args.min_ratings} positives after holdout)")

    if not train:
        print("ERROR: no test users after holdout — lower --min-ratings.", file=sys.stderr)
        return 3

    test_users = list(train.keys())
    if not args.quiet:
        print(f"[offline-eval] predicting top-{args.top_k} for {len(test_users)} users ...")
    predictions, context_valid = predict_topk(loader, train, test_users, args.top_k)

    metrics = compute_metrics(predictions, test)
    total_items = int(
        sum(1 for _, row in loader.items.iterrows() if bool(row.get("is_active", True)))
    )
    coverage = compute_coverage(predictions, total_items)
    violation = compute_violation_rate(predictions, context_valid)

    ndcg10 = metrics["ndcg10"]
    hr10 = metrics["hr10"]
    mrr10 = metrics["mrr10"]
    test_user_count = int(metrics["evaluated_users"])
    test_interaction_count = sum(len(v) for v in test.values())

    metadata = {
        "kind": "offline",
        "holdout_pct": args.holdout_pct,
        "min_ratings": args.min_ratings,
        "top_k": args.top_k,
        "seed": args.seed,
        "total_items": total_items,
        "hybrid_alpha": float(settings.hybrid_alpha),
        "positive_threshold": int(settings.positive_threshold),
        "itemknn_k": int(settings.itemknn_k),
        "itemknn_shrink": float(settings.itemknn_shrink),
    }

    print()
    print("=" * 60)
    print(f"  nDCG@10        = {ndcg10:.4f}")
    print(f"  HR@10          = {hr10:.4f}")
    print(f"  MRR@10         = {mrr10:.4f}")
    print(f"  Coverage       = {coverage:.4f}  ({int(coverage * total_items)}/{total_items} items)")
    print(f"  Violation rate = {violation:.4f}")
    print(f"  Test users     = {test_user_count}")
    print(f"  Test items     = {test_interaction_count}")
    print("=" * 60)

    if args.output_json:
        out_path = Path(args.output_json)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(
            json.dumps(
                {
                    "ran_at": datetime.now(timezone.utc).isoformat(),
                    "ndcg10": ndcg10,
                    "hr10": hr10,
                    "mrr10": mrr10,
                    "coverage": coverage,
                    "violation_rate": violation,
                    "test_user_count": test_user_count,
                    "test_interaction_count": test_interaction_count,
                    "metadata": metadata,
                },
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        print(f"[offline-eval] wrote {out_path}")

    with session_scope() as session:
        if session is not None:
            run = EvaluationRun(
                source="offline",
                ndcg10=ndcg10,
                hr10=hr10,
                mrr10=mrr10,
                coverage=coverage,
                violation_rate=violation,
                test_user_count=test_user_count,
                test_interaction_count=test_interaction_count,
                metadata_json=json.dumps(metadata, ensure_ascii=False),
            )
            session.add(run)
            print(f"[offline-eval] inserted evaluation_runs row id={run.id}")
        else:
            print("[offline-eval] DB session unavailable — skipping DB write.", file=sys.stderr)

    return 0


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--holdout-pct", type=float, default=20.0, help="Percent of positives held out per user (default 20).")
    p.add_argument("--min-ratings", type=int, default=5, help="Minimum positive ratings per user (default 5).")
    p.add_argument("--top-k", type=int, default=10, help="Top-K for prediction (default 10, max 50).")
    p.add_argument("--seed", type=int, default=42, help="RNG seed for holdout (default 42).")
    p.add_argument("--artifact-dir", type=str, default="", help="Override artifact directory.")
    p.add_argument("--output-json", type=str, default=str(Path("artifacts") / "outputs" / "eval" / "last_offline.json"), help="JSON dump path (default artifacts/outputs/eval/last_offline.json).")
    p.add_argument("--quiet", action="store_true", help="Suppress per-user progress.")
    return p.parse_args()


if __name__ == "__main__":
    raise SystemExit(main())
