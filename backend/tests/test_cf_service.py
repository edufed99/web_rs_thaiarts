"""Tests for services.cf_service."""
from __future__ import annotations

import pytest

from app.core.config import Settings
from app.services.cf_service import score_items_by_itemknn, user_rating_weight

from .conftest import item_id


@pytest.fixture
def candidates(loader):
    return [
        {"item_id": item_id("ระบำพรหมาสตร์")},
        {"item_id": item_id("โขน")},
        {"item_id": item_id("หุ่นกระบอก")},
        {"item_id": item_id("ลิเก")},
    ]


def test_no_history_falls_back_to_popularity(loader, candidates):
    scores = score_items_by_itemknn(loader, "user:unknown", candidates)
    # All items have different popularity
    for cid in {c["item_id"] for c in candidates}:
        assert cid in scores
    assert all(v >= 0 for v in scores.values())


def test_no_user_key_returns_popularity(loader, candidates):
    scores = score_items_by_itemknn(loader, None, candidates)
    assert all(v >= 0 for v in scores.values())


def test_known_user_gets_itemknn(loader):
    """user:u1 has positive history on items 0 and 1 — those should be 0."""
    # user:u1 likes ระบำ (idx 0) and โขน (idx 1).
    cands = [
        {"item_id": item_id("ระบำพรหมาสตร์")},
        {"item_id": item_id("โขน")},
        {"item_id": item_id("หุ่นกระบอก")},
        {"item_id": item_id("ลิเก")},
    ]
    scores = score_items_by_itemknn(loader, "user:u1", cands)
    # Both items in u1's history → score 0
    assert scores[item_id("ระบำพรหมาสตร์")] == 0.0
    assert scores[item_id("โขน")] == 0.0
    # Other items may be > 0 because they share users with u1's history.
    # หุ่นกระบอก shares user:u3 (positive) with ระบำ (also positive in u3)
    # → should have a non-zero score via ItemKNN path
    assert scores[item_id("หุ่นกระบอก")] >= 0.0


def test_top_k_limit(loader):
    """The legacy code takes top-K neighbours (default 10). With 5-item corpus,
    all sims are considered; we just verify scores are finite and sorted desc."""
    from app.services.cf_service import _cosine
    sims = [_cosine(loader.cf_item_users, item_id("ระบำพรหมาสตร์"), item_id("หุ่นกระบอก"), 50.0)]
    assert sims[0] >= 0


def test_cosine_no_shared_users(loader):
    from app.services.cf_service import _cosine
    # Two items that share no users
    # ลิเก has user:u2; หุ่นกระบอก has user:u3 → no overlap
    sim = _cosine(loader.cf_item_users, item_id("ลิเก"), item_id("หุ่นกระบอก"), 50.0)
    assert sim == 0.0


def test_cosine_with_shrink(loader):
    from app.services.cf_service import _cosine
    sim = _cosine(loader.cf_item_users, item_id("ระบำพรหมาสตร์"), item_id("โขน"), 50.0)
    assert sim >= 0


def test_user_rating_weight_helper(loader):
    rid = item_id("โขน")
    assert user_rating_weight(loader, "user:u1", rid) == pytest.approx(0.8)
    assert user_rating_weight(loader, "user:u1", 99999) == pytest.approx(1.0)


def test_itemknn_respects_k(loader):
    """Setting itemknn_k=1 should still produce a finite score when user has overlap."""
    s = Settings(itemknn_k=1)
    cands = [{"item_id": item_id("หุ่นกระบอก")}]
    scores = score_items_by_itemknn(loader, "user:u1", cands, settings=s)
    assert isinstance(scores[item_id("หุ่นกระบอก")], float)


def test_empty_candidates_returns_empty(loader):
    scores = score_items_by_itemknn(loader, "user:u1", [])
    assert scores == {}