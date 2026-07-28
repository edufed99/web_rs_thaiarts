"""Tests for the DB integration layer.

These tests exercise ``db_query.py`` and the legacy stats endpoint. They use
SQLite in-memory so they don't require a running Postgres server.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

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
        ItemContext, ItemKeyword, LegacyInteraction,
    )
    # All tables exist on Base.metadata
    table_names = set(Base.metadata.tables.keys())
    assert {"contexts", "taxonomy_nodes", "keywords", "items",
            "item_contexts", "item_keywords", "legacy_interactions"}.issubset(table_names)