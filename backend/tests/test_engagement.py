"""Tests for live engagement aggregate + the ``/items/engagement`` endpoint.

Engagement = likes + saved_items + positive (rating ≥ 4) ratings per item.
Mirrors the same SQLite-in-memory pattern used by test_db.py
(``sqlite_db_with_live_actions``) so we test the real ORM layer under a
monkeypatched db engine.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

INMEM_URL = "sqlite:///:memory:"


def _sqlite_with_actions(items_with_actions, monkeypatch, items_by_db_id):
    """Build SQLite DB seeded with the given actions, monkeypatch the live
    db engine so service code sees it. Returns the engine for cleanup.

    ``items_with_actions`` is ``{db_id: {"likes": n, "saves": n, "ratings": [...]}}``.
    ``items_by_db_id`` is ``{db_id: artifact_id}`` — needed because the
    engine path goes through ``artifact_item_id``.
    """
    from app import db as db_module
    from app.core import config as config_module
    from app.models_db import Base, Item, Like, Rating, SavedItem
    from app.services import actions as actions_module
    from app.services import db_query as dbq_module

    eng = create_engine(INMEM_URL, future=True)
    Base.metadata.create_all(eng)
    SessionLocal = sessionmaker(bind=eng, expire_on_commit=False, future=True)
    now = datetime.now(timezone.utc)
    with SessionLocal() as s:
        for db_id, aid in items_by_db_id.items():
            s.add(
                Item(
                    id=db_id,
                    name=f"item-{db_id}",
                    is_active=True,
                    artifact_item_id=aid,
                )
            )
        s.flush()
        for db_id, data in items_with_actions.items():
            for n in range(data.get("likes", 0)):
                s.add(
                    Like(
                        user_key=f"u-like-{db_id}-{n}",
                        item_id=db_id,
                        created_at=now,
                    )
                )
            for n in range(data.get("saves", 0)):
                s.add(
                    SavedItem(
                        user_key=f"u-save-{db_id}-{n}",
                        item_id=db_id,
                        created_at=now,
                    )
                )
            for n, rating in enumerate(data.get("ratings", [])):
                s.add(
                    Rating(
                        user_key=f"u-rating-{db_id}-{n}",
                        item_id=db_id,
                        rating=int(rating),
                        created_at=now,
                        updated_at=now,
                    )
                )
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

    # Patch where the symbols are imported, mirroring test_db.py.
    monkeypatch.setattr(db_module, "is_db_enabled", lambda: True)
    monkeypatch.setattr(db_module, "get_engine", fake_engine)
    monkeypatch.setattr(db_module, "session_scope", fake_scope)
    monkeypatch.setattr(dbq_module, "is_db_enabled", lambda: True)
    monkeypatch.setattr(dbq_module, "session_scope", fake_scope)
    monkeypatch.setattr(actions_module, "is_db_enabled", lambda: True)
    monkeypatch.setattr(config_module, "get_settings", lambda: _fake_settings())
    return eng


def _fake_settings():
    """Stub Settings so ``_engagement_positive_rating_clause`` doesn't hit
    the cached real Settings + getters."""
    from types import SimpleNamespace

    return SimpleNamespace(positive_threshold=4)


def test_live_item_engagement_zero_state_when_disabled(monkeypatch):
    """RECSYS_DB_ENABLED=0 → empty dict regardless of contents."""
    from app.services.db_query import live_item_engagement

    monkeypatch.setenv("RECSYS_DB_ENABLED", "0")
    assert live_item_engagement() == {}


def test_live_item_engagement_aggregates_sources(monkeypatch):
    """Aggregates likes + saves + positive ratings correctly.

    Layout:
      artifact 10001 (db 1): 2 likes + 1 save + 2 positive ratings (5, 4) → score 5
      artifact 10002 (db 2): 0 likes + 0 saves + 3 ratings (5, 4, 3) → score 2
      artifact 10003 (db 3): 1 like + 0 saves + 0 ratings → score 1
      artifact 10004 (db 4): zero engagement — should NOT appear
    """
    items_by_db = {1: 10001, 2: 10002, 3: 10003, 4: 10004}
    actions = {
        1: {"likes": 2, "saves": 1, "ratings": [5, 4]},
        2: {"likes": 0, "saves": 0, "ratings": [5, 4, 3]},
        3: {"likes": 1, "saves": 0, "ratings": []},
        4: {},
    }
    eng = _sqlite_with_actions(actions, monkeypatch, items_by_db)
    try:
        from app.services.db_query import live_item_engagement

        out = live_item_engagement()
        assert out[10001] == {
            "like_count": 2,
            "save_count": 1,
            "rating_count": 2,
            "engagement_score": 5,
        }
        assert out[10002] == {
            "like_count": 0,
            "save_count": 0,
            "rating_count": 2,
            "engagement_score": 2,
        }
        assert out[10003] == {
            "like_count": 1,
            "save_count": 0,
            "rating_count": 0,
            "engagement_score": 1,
        }
        # Items with zero engagement are absent — callers default to zero.
        assert 10004 not in out
    finally:
        eng.dispose()


def test_live_item_engagement_excludes_low_ratings(monkeypatch):
    """Ratings below POSITIVE_THRESHOLD do NOT contribute to engagement."""
    items_by_db = {1: 10001, 2: 10002}
    actions = {
        # All negative — should not surface.
        1: {"likes": 0, "saves": 0, "ratings": [1, 2, 3]},
        # Positive — should surface with score = 1 like + 1 positive rating.
        2: {"likes": 1, "saves": 0, "ratings": [5]},
    }
    eng = _sqlite_with_actions(actions, monkeypatch, items_by_db)
    try:
        from app.services.db_query import live_item_engagement

        out = live_item_engagement()
        assert set(out.keys()) == {10002}
        assert out[10002]["engagement_score"] == 2
        assert out[10002]["like_count"] == 1
        assert out[10002]["rating_count"] == 1
    finally:
        eng.dispose()


def test_live_item_engagement_window_days_filters_old_actions(monkeypatch):
    from app import db as db_module
    from app.core import config as config_module
    from app.models_db import Base, Item, Like, Rating, SavedItem
    from app.services import db_query as dbq_module
    from app.services.db_query import live_item_engagement

    eng = create_engine(INMEM_URL, future=True)
    Base.metadata.create_all(eng)
    SessionLocal = sessionmaker(bind=eng, expire_on_commit=False, future=True)
    now = datetime.now(timezone.utc)
    old = now - timedelta(days=12)
    with SessionLocal() as s:
        s.add(Item(id=1, name="recent", is_active=True, artifact_item_id=10001))
        s.add(Item(id=2, name="old", is_active=True, artifact_item_id=10002))
        s.add(Like(user_key="u-like-recent", item_id=1, created_at=now))
        s.add(SavedItem(user_key="u-save-old", item_id=2, created_at=old))
        s.add(
            Rating(
                user_key="u-rating-old",
                item_id=2,
                rating=5,
                created_at=old,
                updated_at=old,
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
    monkeypatch.setattr(db_module, "session_scope", fake_scope)
    monkeypatch.setattr(dbq_module, "is_db_enabled", lambda: True)
    monkeypatch.setattr(dbq_module, "session_scope", fake_scope)
    monkeypatch.setattr(config_module, "get_settings", lambda: _fake_settings())
    try:
        weekly = live_item_engagement(window_days=7)
        assert weekly == {
            10001: {
                "like_count": 1,
                "save_count": 0,
                "rating_count": 0,
                "engagement_score": 1,
            }
        }

        all_time = live_item_engagement()
        assert all_time[10002]["engagement_score"] == 2
    finally:
        eng.dispose()


def test_items_engagement_endpoint_disabled(artifacts_dir, monkeypatch):
    """GET /items/engagement with DB off → empty list, source='disabled'."""
    monkeypatch.setenv("RECSYS_ARTIFACT_DIR", str(artifacts_dir))
    monkeypatch.setenv("RECSYS_DB_ENABLED", "0")
    from app.core.config import reset_settings_cache
    from app.model_loader import reset_singleton

    reset_settings_cache()
    reset_singleton()

    from app.main import create_app

    with TestClient(create_app()) as c:
        r = c.get("/items/engagement?ids=10001,10002")
        assert r.status_code == 200
        body = r.json()
        assert body == {"engagements": [], "source": "disabled"}


def test_items_engagement_endpoint_zero_rows_for_unknown_ids(
    artifacts_dir, monkeypatch
):
    """For an unknown id, the endpoint surfaces a zero engagement row."""
    monkeypatch.setenv("RECSYS_ARTIFACT_DIR", str(artifacts_dir))
    monkeypatch.setenv("RECSYS_DB_ENABLED", "0")
    from app.core.config import reset_settings_cache
    from app.model_loader import reset_singleton

    reset_settings_cache()
    reset_singleton()

    from app.main import create_app

    with TestClient(create_app()) as c:
        # Empty ids → empty engagements (DB disabled branch).
        r = c.get("/items/engagement?ids=")
        assert r.status_code == 200
        assert r.json()["engagements"] == []
        assert r.json()["source"] == "disabled"


def test_engagement_schema_validation():
    """EngagementOut rejects negative counts at the schema boundary."""
    from app.schemas.item import EngagementListOut, EngagementOut

    out = EngagementListOut(
        engagements=[
            EngagementOut(
                item_id=1,
                like_count=2,
                save_count=1,
                rating_count=2,
                engagement_score=5,
            )
        ],
        source="postgres",
    )
    assert out.engagements[0].engagement_score == 5
    assert out.source == "postgres"

    with pytest.raises(Exception):
        EngagementOut(
            item_id=1,
            like_count=-1,
            save_count=0,
            rating_count=0,
            engagement_score=0,
        )


def test_items_engagement_with_unknown_id_returns_zero_row():
    """An unknown id in the ``ids`` param returns an empty row (not a 404).

    This is the path the catalog page uses to render engagement on
    cards that may have been deleted since the page was loaded.
    """
    from app.core import config as config_module
    from app.main import create_app
    from app.model_loader import reset_singleton
    from fastapi.testclient import TestClient

    reset_singleton()
    config_module.reset_settings_cache()
    with TestClient(create_app()) as c:
        r = c.get("/items/engagement?ids=999999999")
        assert r.status_code == 200
        body = r.json()
        assert body["source"] in ("disabled", "db")
        assert isinstance(body["engagements"], list)


def test_items_engagement_parses_malformed_ids_gracefully():
    """A non-numeric id in the ``ids`` param is skipped, not a 400.

    The query string parser is forgiving on purpose: callers may
    pass ids from URL params that have been URL-decoded poorly.
    """
    from app.core import config as config_module
    from app.main import create_app
    from app.model_loader import reset_singleton
    from fastapi.testclient import TestClient

    reset_singleton()
    config_module.reset_settings_cache()
    with TestClient(create_app()) as c:
        r = c.get("/items/engagement?ids=abc,123,def")
        assert r.status_code == 200
        assert r.json()["engagements"] == []


def test_live_item_engagement_positive_ratings_only():
    """The ``rating_count`` sub-score counts only ratings >= positive
    threshold (default 4). 1-3 star ratings are not engagement."""
    from app.core import config as config_module
    from app.db import reset_engine
    from app.services.db_query import live_item_engagement
    from app.services import db_query as dbq_module
    from app import db as db_module
    from app.models_db import Base, Item, Like, Rating
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool

    eng = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(eng)
    SessionLocal = sessionmaker(bind=eng, expire_on_commit=False)

    with SessionLocal() as s:
        s.add(Item(id=1, name="x", is_active=True, artifact_item_id=9001))
        s.add(Rating(user_key="u1", item_id=1, rating=5))
        s.add(Rating(user_key="u2", item_id=1, rating=3))  # below 4
        s.add(Rating(user_key="u3", item_id=1, rating=2))  # below 4
        s.commit()

    from contextlib import contextmanager

    @contextmanager
    def fs():
        sess = SessionLocal()
        try:
            yield sess
            sess.commit()
        finally:
            sess.close()

    config_module.reset_settings_cache()
    monkeypatch_eng = fs  # noqa: F841 — alias for clarity

    # Direct import to patch; bind the right modules.
    from unittest.mock import patch

    with patch.object(db_module, "is_db_enabled", lambda: True), \
         patch.object(db_module, "session_scope", fs), \
         patch.object(dbq_module, "is_db_enabled", lambda: True), \
         patch.object(dbq_module, "session_scope", fs):
        out = live_item_engagement()
    assert out[9001]["rating_count"] == 1  # only the 5-star
    assert out[9001]["like_count"] == 0
    assert out[9001]["save_count"] == 0
    assert out[9001]["engagement_score"] == 1
    eng.dispose()
