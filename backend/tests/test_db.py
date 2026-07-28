"""Tests for the DB integration layer.

These tests exercise ``db_query.py`` and the legacy stats endpoint. They use
SQLite in-memory so they don't require a running Postgres server.
"""
from __future__ import annotations

import os
from contextlib import contextmanager
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Re-import inside test functions because we need to flip RECSYS_DB_ENABLED.
# We use SQLite in-memory so the tests are hermetic.
INMEM_URL = "sqlite:///:memory:"


@pytest.fixture
def sqlite_db_with_legacy():
    """Build an in-memory SQLite with the legacy_interactions table seeded."""
    from app.models_db import Base, LegacyInteraction, Item, Context

    eng = create_engine(INMEM_URL, future=True)
    Base.metadata.create_all(eng)
    SessionLocal = sessionmaker(bind=eng, expire_on_commit=False, future=True)
    with SessionLocal() as s:
        # Need items + contexts first (FK constraints)
        s.add(Item(id=1, name="ระบำ", is_active=True))
        s.add(Item(id=2, name="โขน", is_active=True))
        s.add(Context(id=10, name="งานบวช"))
        s.add(Context(id=11, name="งานเลี้ยง"))
        s.add(LegacyInteraction(
            id=1, legacy_user_id="u1", item_id=1, context_id=10,
            rating=5, keywords=[], raw_item_name="", imported_at=datetime.now(timezone.utc),
        ))
        s.add(LegacyInteraction(
            id=2, legacy_user_id="u2", item_id=1, context_id=10,
            rating=4, keywords=[], raw_item_name="", imported_at=datetime.now(timezone.utc),
        ))
        s.add(LegacyInteraction(
            id=3, legacy_user_id="u1", item_id=2, context_id=11,
            rating=5, keywords=[], raw_item_name="", imported_at=datetime.now(timezone.utc),
        ))
        s.add(LegacyInteraction(
            id=4, legacy_user_id="u3", item_id=2, context_id=11,
            rating=3, keywords=[], raw_item_name="", imported_at=datetime.now(timezone.utc),
        ))
        s.commit()
    yield eng
    eng.dispose()


def test_is_db_enabled_default():
    """RECSYS_DB_ENABLED can be either '0' or '1' depending on conftest order."""
    val = os.environ.get("RECSYS_DB_ENABLED")
    assert val in {"0", "1"}


def test_live_positive_users_per_item_returns_empty_when_disabled(monkeypatch):
    """When RECSYS_DB_ENABLED=0, returns {} regardless of any DB."""
    from app.services.db_query import live_positive_users_per_item
    monkeypatch.setenv("RECSYS_DB_ENABLED", "0")
    assert live_positive_users_per_item() == {}


def test_db_engine_returns_none_when_disabled(monkeypatch):
    from app.db import get_engine, reset_engine
    reset_engine()
    monkeypatch.setenv("RECSYS_DB_ENABLED", "0")
    try:
        assert get_engine() is None
    finally:
        reset_engine()


def test_db_health_endpoint_disabled(artifacts_dir, monkeypatch):
    monkeypatch.setenv("RECSYS_ARTIFACT_DIR", str(artifacts_dir))
    monkeypatch.setenv("RECSYS_DB_ENABLED", "0")
    from app.core.config import reset_settings_cache
    from app.model_loader import reset_singleton
    reset_settings_cache()
    reset_singleton()

    from app.main import create_app
    with TestClient(create_app()) as c:
        r = c.get("/db/health")
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "disabled"


def test_legacy_stats_endpoint_disabled(artifacts_dir, monkeypatch):
    monkeypatch.setenv("RECSYS_ARTIFACT_DIR", str(artifacts_dir))
    monkeypatch.setenv("RECSYS_DB_ENABLED", "0")
    from app.core.config import reset_settings_cache
    from app.model_loader import reset_singleton
    reset_settings_cache()
    reset_singleton()

    from app.main import create_app
    with TestClient(create_app()) as c:
        r = c.get("/items/1/legacy-stats")
        assert r.status_code == 200
        body = r.json()
        assert body["count"] == 0
        assert body["source"] == "disabled"


def test_session_scope_disabled_yields_none(monkeypatch):
    from app.db import session_scope
    monkeypatch.setenv("RECSYS_DB_ENABLED", "0")
    with session_scope() as s:
        assert s is None


def test_orm_models_importable():
    from app.models_db import (
        Base, Context, TaxonomyNode, Keyword, Item,
        ItemContext, ItemKeyword, LegacyInteraction, Like, Rating, SavedItem,
    )
    # All tables exist on Base.metadata
    table_names = set(Base.metadata.tables.keys())
    assert {"contexts", "taxonomy_nodes", "keywords", "items",
            "item_contexts", "item_keywords", "legacy_interactions"}.issubset(table_names)


# ---------------------------------------------------------------------------
# Live-action layer (likes / saved_items / ratings / interaction_logs)
# ---------------------------------------------------------------------------

@pytest.fixture
def sqlite_db_with_live_actions(monkeypatch):
    """In-memory SQLite with items (artifact ids backfilled) + seed rows.

    Returns (engine, items_by_artifact_id) so tests can assert against the
    real ORM layer. Also monkeypatches ``app.db.get_engine`` and
    ``session_scope`` so service code uses this engine.
    """
    import hashlib
    from app.core import config as config_module
    from app import db as db_module
    from app.models_db import (
        Base, Item, Like, Rating, SavedItem, LegacyInteraction,
    )

    eng = create_engine(INMEM_URL, future=True)
    Base.metadata.create_all(eng)
    SessionLocal = sessionmaker(bind=eng, expire_on_commit=False, future=True)

    items = {
        111: "แสดงโขน",
        222: "ระบำ",
        333: "ลิเก",
    }
    by_artifact = {}
    with SessionLocal() as s:
        for django_id, name in items.items():
            aid = int(hashlib.sha256(f"item::{name}".encode("utf-8")).hexdigest()[:7], 16)
            by_artifact[aid] = django_id
            s.add(Item(
                id=django_id,
                name=name,
                is_active=True,
                artifact_item_id=aid,
            ))
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

    # Patch the symbols where they are *imported into* — services do
    # ``from ..db import session_scope`` which creates a module-local binding
    # in their own namespace. Patching only ``app.db`` would leave the
    # services pointing at the original generator. We patch both to be safe.
    monkeypatch.setattr(db_module, "is_db_enabled", lambda: True)
    monkeypatch.setattr(db_module, "get_engine", fake_engine)
    monkeypatch.setattr(db_module, "session_scope", fake_scope)
    from app.services import db_query as dbq_module
    from app.services import actions as actions_module
    monkeypatch.setattr(dbq_module, "is_db_enabled", lambda: True)
    monkeypatch.setattr(dbq_module, "session_scope", fake_scope)
    monkeypatch.setattr(actions_module, "is_db_enabled", lambda: True)
    monkeypatch.setattr(actions_module, "session_scope", fake_scope)
    db_module.reset_engine()
    config_module.reset_settings_cache()
    yield eng, by_artifact
    eng.dispose()


def test_orm_tables_include_live_action_tables():
    from app.models_db import Base
    table_names = set(Base.metadata.tables.keys())
    assert {"likes", "saved_items", "ratings", "interaction_logs"}.issubset(table_names)


def test_live_user_positive_items_merges_likes_and_high_ratings(sqlite_db_with_live_actions):
    from app.services.db_query import live_user_positive_items
    from app.models_db import Like, Rating

    eng, by_artifact = sqlite_db_with_live_actions
    aid_khon, aid_rabam, aid_like = (
        next(a for a, d in by_artifact.items() if d == 111),
        next(a for a, d in by_artifact.items() if d == 222),
        next(a for a, d in by_artifact.items() if d == 333),
    )

    SessionLocal = sessionmaker(bind=eng, expire_on_commit=False, future=True)
    with SessionLocal() as s:
        s.add(Like(user_key="anon:u1", item_id=by_artifact[aid_khon]))
        s.add(Like(user_key="anon:u1", item_id=by_artifact[aid_rabam]))
        s.add(Rating(user_key="anon:u1", item_id=by_artifact[aid_like], rating=5))
        s.add(Rating(user_key="anon:u1", item_id=by_artifact[aid_khon], rating=2))
        s.commit()

    pos = live_user_positive_items("anon:u1")
    # like on khon + rabam, rating 5 on like, rating 2 on khon is negative.
    assert aid_khon in pos
    assert aid_rabam in pos
    assert aid_like in pos


def test_live_user_negative_ratings_returns_low_ratings(sqlite_db_with_live_actions):
    from app.services.db_query import live_user_negative_ratings
    from app.models_db import Rating

    eng, by_artifact = sqlite_db_with_live_actions
    aid_khon = next(a for a, d in by_artifact.items() if d == 111)
    aid_rabam = next(a for a, d in by_artifact.items() if d == 222)

    SessionLocal = sessionmaker(bind=eng, expire_on_commit=False, future=True)
    with SessionLocal() as s:
        s.add(Rating(user_key="anon:u2", item_id=by_artifact[aid_khon], rating=1))
        s.add(Rating(user_key="anon:u2", item_id=by_artifact[aid_rabam], rating=5))
        s.commit()

    neg = live_user_negative_ratings("anon:u2", max_rating=4)
    assert neg == {aid_khon: 1}


def test_live_user_state_for_items_returns_per_item_state(sqlite_db_with_live_actions):
    from app.services.db_query import live_user_state_for_items
    from app.models_db import Like, Rating, SavedItem

    eng, by_artifact = sqlite_db_with_live_actions
    aid_khon = next(a for a, d in by_artifact.items() if d == 111)
    aid_rabam = next(a for a, d in by_artifact.items() if d == 222)
    aid_like = next(a for a, d in by_artifact.items() if d == 333)

    SessionLocal = sessionmaker(bind=eng, expire_on_commit=False, future=True)
    with SessionLocal() as s:
        s.add(Like(user_key="anon:u3", item_id=by_artifact[aid_khon]))
        s.add(SavedItem(user_key="anon:u3", item_id=by_artifact[aid_rabam]))
        s.add(Rating(user_key="anon:u3", item_id=by_artifact[aid_like], rating=4))
        s.commit()

    state = live_user_state_for_items("anon:u3", [aid_khon, aid_rabam, aid_like])
    assert state[aid_khon].liked is True
    assert state[aid_khon].saved is False
    assert state[aid_rabam].saved is True
    assert state[aid_rabam].liked is False
    assert state[aid_like].rating == 4
    assert state[aid_like].liked is False


def test_live_positive_users_per_item_artifact_joins_artifact_id(sqlite_db_with_live_actions):
    from app.services.db_query import live_positive_users_per_item_artifact
    from app.models_db import LegacyInteraction

    eng, by_artifact = sqlite_db_with_live_actions
    aid_khon = next(a for a, d in by_artifact.items() if d == 111)

    SessionLocal = sessionmaker(bind=eng, expire_on_commit=False, future=True)
    with SessionLocal() as s:
        s.add(LegacyInteraction(
            id=1, legacy_user_id="legacy1", item_id=by_artifact[aid_khon],
            context_id=None, rating=5, keywords=[], raw_item_name="",
            imported_at=datetime.now(timezone.utc),
        ))
        s.commit()

    out = live_positive_users_per_item_artifact()
    assert aid_khon in out
    assert "legacy:legacy1" in out[aid_khon]


def test_live_user_positive_items_returns_empty_when_db_disabled(monkeypatch):
    from app import db as db_module
    from app.services.db_query import live_user_positive_items

    monkeypatch.setattr(db_module, "is_db_enabled", lambda: False)
    assert live_user_positive_items("anon:nobody") == set()


def test_django_to_artifact_translation_round_trip(sqlite_db_with_live_actions):
    from app.services.db_query import artifact_id_to_django_id, django_id_to_artifact_id

    eng, by_artifact = sqlite_db_with_live_actions
    aid = next(iter(by_artifact.keys()))
    django_id = by_artifact[aid]
    assert artifact_id_to_django_id(aid) == django_id
    assert django_id_to_artifact_id(django_id) == aid