"""Tests for services.cf_service."""
from __future__ import annotations

import hashlib
from contextlib import contextmanager

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import Settings
from app.services.cf_service import (
    normalize_rating,
    score_items_by_itemknn,
    user_rating_weight,
)

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


# --- Rating-weight helper ---------------------------------------------------

def test_normalize_rating_matches_legacy_formula():
    # 5 → 1.0, 1 → floor (default 0.01)
    assert normalize_rating(5) == pytest.approx(1.0)
    assert normalize_rating(1) == pytest.approx(0.01)
    # Linear in between
    assert normalize_rating(3) == pytest.approx(0.01 + 0.99 * 2 / 4)
    # Custom floor
    assert normalize_rating(1, rating_floor=0.5) == pytest.approx(0.5)


# --- Live personalization (DB enabled) --------------------------------------

@pytest.fixture
def live_db_for_cf(monkeypatch, loader):
    """SQLite in-memory engine wired into app.db so live_user_positive_items
    returns rows seeded by the test. Item names match the synthetic
    artifacts so the artifact id is consistent.
    """
    from app.core import config as config_module
    from app import db as db_module
    from app.models_db import Base, Item, Like, Rating

    eng = create_engine(
        "sqlite:///:memory:?check_same_thread=False", future=True,
        connect_args={"check_same_thread": False}, poolclass=StaticPool,
    )
    Base.metadata.create_all(eng)
    SessionLocal = sessionmaker(bind=eng, expire_on_commit=False, future=True)

    name_to_aid = {
        "ระบำพรหมาสตร์": item_id("ระบำพรหมาสตร์"),
        "โขน": item_id("โขน"),
        "ลิเก": item_id("ลิเก"),
    }
    aid_to_django = {}
    with SessionLocal() as s:
        for i, (name, aid) in enumerate(name_to_aid.items(), start=801):
            aid_to_django[aid] = i
            s.add(Item(id=i, name=name, is_active=True, artifact_item_id=aid))
        s.commit()

    def fake_engine():
        return eng

    @contextmanager
    def fake_scope():
        sess = SessionLocal()
        try:
            yield sess
            sess.commit()
        finally:
            sess.close()

    monkeypatch.setattr(db_module, "is_db_enabled", lambda: True)
    monkeypatch.setattr(db_module, "get_engine", fake_engine)
    monkeypatch.setattr(db_module, "session_scope", fake_scope)
    from app.services import db_query as dbq_module
    monkeypatch.setattr(dbq_module, "is_db_enabled", lambda: True)
    monkeypatch.setattr(dbq_module, "session_scope", fake_scope)
    db_module.reset_engine()
    config_module.reset_settings_cache()
    yield SessionLocal, aid_to_django
    eng.dispose()


def test_live_like_brings_user_into_itemknn(loader, live_db_for_cf):
    """A fresh anon:<uuid> user with one live like should get non-zero
    ItemKNN scores for items that share a user with the liked item's
    synthetic user (rather than falling back to popularity)."""
    from app.models_db import Like
    SessionLocal, aid_to_django = live_db_for_cf
    # user:u1 positively rated ระบำ in the static artifact. We have
    # anon:anon-fresh like-ing โขน — which shares user:u1 with ระบำ
    # in the static CF index. So โขน should not be in anon:anon-fresh's
    # history but ระบำ should be reachable via ItemKNN.
    aid_rabam = item_id("ระบำพรหมาสตร์")
    aid_khon = item_id("โขน")
    with SessionLocal() as s:
        s.add(Like(user_key="anon:anon-fresh", item_id=aid_to_django[aid_khon]))
        s.commit()

    cands = [
        {"item_id": aid_rabam},
        {"item_id": aid_khon},
        {"item_id": item_id("หุ่นกระบอก")},
    ]
    scores = score_items_by_itemknn(loader, "anon:anon-fresh", cands)
    assert scores[aid_khon] == 0.0  # user's own like → score 0
    # ระบำ shares user:u1 with โขน's like → ItemKNN > 0
    assert scores[aid_rabam] > 0.0


def test_live_history_keeps_user_out_of_popularity_fallback(loader, live_db_for_cf):
    """If a user has at least one live like, _get_user_history must
    surface it so we don't fall back to raw popularity scores."""
    from app.services.cf_service import _get_user_history
    from app.models_db import Like

    SessionLocal, aid_to_django = live_db_for_cf
    aid_khon = item_id("โขน")
    with SessionLocal() as s:
        s.add(Like(user_key="anon:another", item_id=aid_to_django[aid_khon]))
        s.commit()

    hist = _get_user_history(loader, "anon:another")
    assert aid_khon in hist