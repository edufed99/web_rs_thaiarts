"""Tests for the offline evaluation math (nDCG@10, HR@10, MRR@10,
Coverage, Violation) and the holdout splitter.

These tests run as pure functions — no DB, no FastAPI, no live loader.
The full pipeline integration is covered by the manual
``run_offline_evaluation.py`` script and the dashboard's model-quality
tile test.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Make ``pipelines/`` importable so the tests can share the metric
# helpers with the pipeline script.
_REPO_ROOT = Path(__file__).resolve().parents[2]
_PIPELINES = _REPO_ROOT / "pipelines"
if str(_PIPELINES) not in sys.path:
    sys.path.insert(0, str(_PIPELINES))

from offline_eval_metrics import (  # noqa: E402  (after sys.path tweak)
    compute_coverage,
    compute_metrics,
    compute_violation_rate,
    holdout_per_user,
)


# ---------------------------------------------------------------------------
# compute_metrics
# ---------------------------------------------------------------------------


def test_compute_metrics_perfect_predictions():
    """All predictions are positives → nDCG=1, HR=1, MRR=1."""
    predictions = {"u1": [1, 2, 3, 4, 5], "u2": [6, 7, 8, 9, 10]}
    positives = {"u1": {1, 2, 3, 4, 5}, "u2": {6, 7, 8, 9, 10}}
    m = compute_metrics(predictions, positives)
    assert m["ndcg10"] == pytest.approx(1.0, abs=1e-3)
    assert m["hr10"] == pytest.approx(1.0, abs=1e-3)
    assert m["mrr10"] == pytest.approx(1.0, abs=1e-3)
    assert m["evaluated_users"] == 2


def test_compute_metrics_zero_predictions():
    """No predictions → all zeros, evaluated_users=0."""
    m = compute_metrics({}, {})
    assert m["ndcg10"] == 0.0
    assert m["hr10"] == 0.0
    assert m["mrr10"] == 0.0
    assert m["evaluated_users"] == 0


def test_compute_metrics_no_hits():
    """Predictions miss every positive → HR=0, MRR=0, nDCG=0."""
    predictions = {"u1": [1, 2, 3]}
    positives = {"u1": {99, 100}}
    m = compute_metrics(predictions, positives)
    assert m["hr10"] == 0.0
    assert m["mrr10"] == 0.0
    assert m["ndcg10"] == 0.0


def test_compute_metrics_first_position_hit():
    """Hit at rank 1 → MRR=1.0, HR=1.0."""
    predictions = {"u1": [1, 2, 3]}
    positives = {"u1": {1}}
    m = compute_metrics(predictions, positives)
    assert m["mrr10"] == pytest.approx(1.0, abs=1e-3)
    assert m["hr10"] == 1.0
    assert m["ndcg10"] > 0.0


def test_compute_metrics_second_position_hit():
    """Hit at rank 2 → MRR=0.5 (the first positive is at position 2)."""
    predictions = {"u1": [99, 1, 2, 3]}
    positives = {"u1": {1}}
    m = compute_metrics(predictions, positives)
    assert m["mrr10"] == pytest.approx(0.5, abs=1e-3)
    assert m["hr10"] == 1.0


def test_compute_metrics_mixed_users():
    """Two users, one perfect one zero → averages land in the middle."""
    predictions = {
        "u1": [1, 2, 3, 4, 5],
        "u2": [1, 2, 3, 4, 5],
    }
    positives = {"u1": {1, 2, 3, 4, 5}, "u2": set()}
    m = compute_metrics(predictions, positives)
    assert m["hr10"] == pytest.approx(0.5, abs=1e-3)
    assert m["evaluated_users"] == 2


# ---------------------------------------------------------------------------
# compute_coverage
# ---------------------------------------------------------------------------


def test_compute_coverage_full():
    """All items surfaced → coverage=1.0."""
    predictions = {"u1": [1, 2, 3], "u2": [4, 5, 6]}
    assert compute_coverage(predictions, total_items=6) == 1.0


def test_compute_coverage_partial():
    """Half the catalog → coverage=0.5."""
    predictions = {"u1": [1, 2, 3]}
    assert compute_coverage(predictions, total_items=6) == pytest.approx(0.5)


def test_compute_coverage_empty():
    """No predictions → coverage=0.0."""
    assert compute_coverage({}, total_items=10) == 0.0


def test_compute_coverage_zero_total():
    """Defensive: total_items=0 → 0.0 (no division by zero)."""
    assert compute_coverage({"u1": [1]}, total_items=0) == 0.0


# ---------------------------------------------------------------------------
# compute_violation_rate
# ---------------------------------------------------------------------------


def test_compute_violation_rate_all_valid():
    """No violations → rate=0.0."""
    predictions = {"u1": [1, 2, 3]}
    flags = {"u1": [True, True, True]}
    assert compute_violation_rate(predictions, flags) == 0.0


def test_compute_violation_rate_all_invalid():
    """All rows invalid → rate=1.0."""
    predictions = {"u1": [1, 2, 3]}
    flags = {"u1": [False, False, False]}
    assert compute_violation_rate(predictions, flags) == 1.0


def test_compute_violation_rate_half():
    """Two of four rows invalid → 0.5."""
    predictions = {"u1": [1, 2, 3, 4]}
    flags = {"u1": [True, False, True, False]}
    assert compute_violation_rate(predictions, flags) == 0.5


def test_compute_violation_rate_no_predictions():
    """No predictions → rate=0.0 (no division by zero)."""
    assert compute_violation_rate({}, {}) == 0.0


# ---------------------------------------------------------------------------
# holdout_per_user
# ---------------------------------------------------------------------------


def test_holdout_per_user_basic_split():
    """A 10-item user with 20% holdout → 8 train, 2 test."""
    # 10 unique users, each with 10 items → 8 train + 2 test per user.
    rows = []
    for u in range(10):
        for i in range(10):
            rows.append((f"user:u{u}", u * 100 + i, 5))
    train, test = holdout_per_user(rows, holdout_pct=20.0, min_ratings=5, seed=42)
    assert "user:u0" in train
    assert "user:u0" in test
    assert len(train["user:u0"]) + len(test["user:u0"]) == 10
    assert len(test["user:u0"]) == 2  # 20% of 10 = 2


def test_holdout_per_user_min_ratings_filter():
    """A user with 3 items and min_ratings=5 is dropped from the test set."""
    rows = [
        ("user:small", 1, 5),
        ("user:small", 2, 5),
        ("user:small", 3, 5),
        ("user:big", 1, 5),
        ("user:big", 2, 5),
        ("user:big", 3, 5),
        ("user:big", 4, 5),
        ("user:big", 5, 5),
        ("user:big", 6, 5),
    ]
    train, test = holdout_per_user(rows, holdout_pct=20.0, min_ratings=5, seed=42)
    assert "user:small" not in train
    assert "user:big" in train
    assert "user:big" in test


def test_holdout_per_user_deterministic():
    """Same seed → same train/test split (reproducibility)."""
    rows = [(f"user:u{i}", i, 5) for i in range(20)]
    a, b = holdout_per_user(rows, holdout_pct=20.0, min_ratings=5, seed=123)
    c, d = holdout_per_user(rows, holdout_pct=20.0, min_ratings=5, seed=123)
    assert a == c
    assert b == d


def test_holdout_per_user_different_seeds_differ():
    """Different seeds → different train/test split."""
    rows = []
    for u in range(5):
        for i in range(20):
            rows.append((f"user:u{u}", u * 100 + i, 5))
    a, b = holdout_per_user(rows, holdout_pct=20.0, min_ratings=5, seed=1)
    c, d = holdout_per_user(rows, holdout_pct=20.0, min_ratings=5, seed=2)
    # At least one of train or test should differ.
    assert (a != c) or (b != d)
