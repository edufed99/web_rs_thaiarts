"""Tests for ``db_query.live_item_ctr`` — impressions / views / CTR.

This is the "Selected" signal of ADR-002 §3.2: since the domain has no
booking flow, deliberate choice is measured as *click-through from a
recommendation* rather than as a literal booking event.

Follows the SQLite-in-memory + monkeypatch pattern of ``test_engagement.py``
so the real ORM and real SQL run, just against an in-memory engine.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

INMEM_URL = "sqlite:///:memory:"

# db_id -> artifact_id for the synthetic corpus.
ITEMS = {601: 900_601, 602: 900_602, 603: 900_603}


def _fake_settings(floor: int = 20):
    return SimpleNamespace(positive_threshold=4, ctr_impression_floor=floor)


@pytest.fixture
def ctr_db(monkeypatch):
    """Yield ``(SessionLocal, seed)`` with the live db layer monkeypatched.

    ``seed(db_id, impressions=..., views=..., attributed=..., age_days=0)``
    writes the rows for one item. ``attributed`` views carry a
    ``recommendation_request_id``; plain ``views`` do not (they stand for
    browse traffic).
    """
    from app import db as db_module
    from app.core import config as config_module
    from app.models_db import (
        Base,
        InteractionLog,
        Item,
        RecommendationRequest,
        RecommendationResult,
        Context,
    )
    from app.services import db_query as dbq_module

    eng = create_engine(INMEM_URL, future=True)
    Base.metadata.create_all(eng)
    SessionLocal = sessionmaker(bind=eng, expire_on_commit=False, future=True)

    with SessionLocal() as s:
        s.add(Context(id=1, name="ctx", group_name="", description=""))
        for db_id, aid in ITEMS.items():
            s.add(Item(id=db_id, name=f"item-{db_id}", is_active=True, artifact_item_id=aid))
        s.commit()

    counter = {"n": 0}

    def seed(db_id, impressions=0, views=0, attributed=0, age_days=0):
        when = datetime.now(timezone.utc) - timedelta(days=age_days)
        with SessionLocal() as s:
            req_id = None
            for i in range(impressions):
                counter["n"] += 1
                req = RecommendationRequest(
                    selected_context_id=1,
                    candidate_count=1,
                    top_k=1,
                    method="test",
                    created_at=when,
                )
                s.add(req)
                s.flush()
                req_id = int(req.id)
                s.add(
                    RecommendationResult(
                        request_id=req_id,
                        item_id=db_id,
                        rank=1,
                        cbf_score=0.5,
                        cf_score=0.5,
                        hybrid_score=0.5,
                    )
                )
            for i in range(views):
                counter["n"] += 1
                s.add(
                    InteractionLog(
                        user_key=f"u-view-{counter['n']}",
                        item_id=db_id,
                        action_type="item_view",
                        metadata_json="{}",
                        created_at=when,
                    )
                )
            for i in range(attributed):
                counter["n"] += 1
                s.add(
                    InteractionLog(
                        user_key=f"u-attr-{counter['n']}",
                        item_id=db_id,
                        action_type="item_view",
                        metadata_json="{}",
                        created_at=when,
                        recommendation_request_id=req_id,
                    )
                )
            s.commit()

    @contextmanager
    def fake_scope():
        sess = SessionLocal()
        try:
            yield sess
            sess.commit()
        finally:
            sess.close()

    monkeypatch.setattr(db_module, "is_db_enabled", lambda: True)
    monkeypatch.setattr(db_module, "get_engine", lambda: eng)
    monkeypatch.setattr(db_module, "session_scope", fake_scope)
    monkeypatch.setattr(dbq_module, "is_db_enabled", lambda: True)
    monkeypatch.setattr(dbq_module, "session_scope", fake_scope)
    monkeypatch.setattr(config_module, "get_settings", lambda: _fake_settings())

    yield SessionLocal, seed
    eng.dispose()


def test_returns_empty_when_db_disabled(monkeypatch):
    from app.services.db_query import live_item_ctr

    monkeypatch.setenv("RECSYS_DB_ENABLED", "0")
    assert live_item_ctr() == {}


def test_counts_impressions_and_views(ctr_db):
    from app.services.db_query import live_item_ctr

    _, seed = ctr_db
    seed(601, impressions=25, views=8, attributed=5)

    out = live_item_ctr()
    row = out[ITEMS[601]]
    assert row["impressions"] == 25
    # 8 browse views + 5 attributed views are all item_view rows.
    assert row["views"] == 13
    assert row["attributed_views"] == 5


def test_ctr_uses_attributed_views_not_all_views(ctr_db):
    """Browse traffic must not inflate CTR — otherwise it can exceed 1.0."""
    from app.services.db_query import live_item_ctr

    _, seed = ctr_db
    # 20 impressions, 5 click-throughs, plus 50 unrelated browse views.
    seed(601, impressions=20, views=50, attributed=5)

    row = live_item_ctr()[ITEMS[601]]
    assert row["ctr"] == pytest.approx(5 / 20)
    assert row["ctr"] <= 1.0


def test_ctr_is_none_below_impression_floor(ctr_db):
    """A single lucky click on 2 impressions must not score 50%."""
    from app.services.db_query import live_item_ctr

    _, seed = ctr_db
    seed(601, impressions=2, attributed=1)   # below floor of 20
    seed(602, impressions=20, attributed=1)  # exactly at the floor

    out = live_item_ctr()
    assert out[ITEMS[601]]["ctr"] is None
    assert out[ITEMS[601]]["impressions"] == 2  # counts still reported
    assert out[ITEMS[602]]["ctr"] == pytest.approx(1 / 20)


def test_zero_attributed_views_is_zero_not_none(ctr_db):
    """Above the floor, no click-throughs is a real 0.0 — not missing data."""
    from app.services.db_query import live_item_ctr

    _, seed = ctr_db
    seed(601, impressions=30, attributed=0)

    assert live_item_ctr()[ITEMS[601]]["ctr"] == 0.0


def test_window_excludes_old_rows(ctr_db):
    from app.services.db_query import live_item_ctr

    _, seed = ctr_db
    seed(601, impressions=25, attributed=5, age_days=0)
    seed(602, impressions=25, attributed=5, age_days=90)

    out = live_item_ctr(window_days=30)
    assert ITEMS[601] in out
    assert ITEMS[602] not in out, "rows outside the window must be excluded"

    wide = live_item_ctr(window_days=365)
    assert ITEMS[602] in wide


def test_item_ids_filter(ctr_db):
    from app.services.db_query import live_item_ctr

    _, seed = ctr_db
    seed(601, impressions=25, attributed=5)
    seed(602, impressions=25, attributed=5)

    out = live_item_ctr(item_ids=[ITEMS[601]])
    assert set(out) == {ITEMS[601]}


def test_unknown_item_filter_returns_empty(ctr_db):
    """An explicit filter matching no catalog row must not fall through to
    a full-catalog scan."""
    from app.services.db_query import live_item_ctr

    _, seed = ctr_db
    seed(601, impressions=25, attributed=5)

    assert live_item_ctr(item_ids=[999_999_999]) == {}


def test_items_without_activity_are_absent(ctr_db):
    """Matches the live_item_engagement contract: absence means zero."""
    from app.services.db_query import live_item_ctr

    _, seed = ctr_db
    seed(601, impressions=25, attributed=5)

    out = live_item_ctr()
    assert ITEMS[603] not in out


def test_keys_are_artifact_ids_not_db_ids(ctr_db):
    """Every public db_query output is in artifact-id space."""
    from app.services.db_query import live_item_ctr

    _, seed = ctr_db
    seed(601, impressions=25, attributed=5)

    out = live_item_ctr()
    assert set(out) <= set(ITEMS.values())
    assert 601 not in out
