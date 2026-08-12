"""Tests for the /me/* member summary endpoints.

Drives the endpoints end-to-end with an in-memory SQLite engine so the
DB-dependent service code runs through real SQL.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core import config as config_module
from app.main import create_app
from app.model_loader import reset_singleton
from app.models_db import Base, InteractionLog, Item, Like, Rating, SavedItem


INMEM_URL = "sqlite:///:memory:?check_same_thread=False"


def _stable_artifact_id(name: str) -> int:
    return int(hashlib.sha256(f"item::{name}".encode("utf-8")).hexdigest()[:7], 16)


@pytest.fixture
def member_client(monkeypatch, artifacts_dir):
    """TestClient wired to a real (in-memory) DB and the synthetic artifacts."""
    monkeypatch.setenv("RECSYS_ARTIFACT_DIR", str(artifacts_dir))
    monkeypatch.setenv("RECSYS_DB_ENABLED", "1")
    config_module.reset_settings_cache()
    reset_singleton()

    eng = create_engine(
        INMEM_URL, future=True, connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(eng)
    SessionLocal = sessionmaker(bind=eng, expire_on_commit=False, future=True)

    items = {
        501: "ระบำพรหมาสตร์",
        502: "โขน",
        503: "ลิเก",
    }
    with SessionLocal() as s:
        for db_id, name in items.items():
            aid = _stable_artifact_id(name)
            s.add(Item(
                id=db_id,
                name=name,
                category_group="พิธีกรรม",
                is_active=True,
                artifact_item_id=aid,
            ))
        s.commit()

    from app import db as db_module

    def fake_engine():
        return eng

    def fake_factory():
        return SessionLocal

    monkeypatch.setattr(db_module, "get_engine", fake_engine)
    monkeypatch.setattr(db_module, "get_session_factory", fake_factory)

    app = create_app()
    with TestClient(app) as c:
        yield c, SessionLocal
    reset_singleton()


def test_summary_zero_state(member_client):
    """Fresh anon user → all zeros + has_activity=False + source='postgres'."""
    client, _ = member_client
    r = client.get("/me/summary", params={"user_key": "anon:test"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["liked_count"] == 0
    assert body["saved_count"] == 0
    assert body["rated_count"] == 0
    assert body["recent_view_count"] == 0
    assert body["has_activity"] is False
    assert body["source"] == "postgres"
    # Interests list is empty when there's no data (frontend falls back).
    assert body["interests"] == []


def test_summary_with_activity(member_client):
    """After writes the counts come back, has_activity flips, and the
    interest buckets include at least one entry.

    ``recent_view_count`` counts ``item_view`` rows only (ADR-002 §3.1);
    like / save / rate logs are engagement, not views, so they must not
    inflate it. Here two distinct items were viewed, one of them twice
    (a genuine revisit outside the dedupe window), so the distinct-item
    count is 2.
    """
    client, SessionLocal = member_client
    with SessionLocal() as s:
        aid_a = _stable_artifact_id("ระบำพรหมาสตร์")
        aid_b = _stable_artifact_id("โขน")
        aid_c = _stable_artifact_id("ลิเก")
        s.add(Like(user_key="anon:alice", item_id=501))
        s.add(SavedItem(user_key="anon:alice", item_id=502))
        s.add(Rating(user_key="anon:alice", item_id=503, rating=4))
        s.add(InteractionLog(user_key="anon:alice", item_id=501, action_type="like", metadata_json="{}"))
        s.add(InteractionLog(user_key="anon:alice", item_id=502, action_type="save", metadata_json="{}"))
        s.add(InteractionLog(user_key="anon:alice", item_id=503, action_type="rate", metadata_json='{"rating":4}'))
        s.add(InteractionLog(user_key="anon:alice", item_id=501, action_type="item_view", metadata_json="{}"))
        s.add(InteractionLog(user_key="anon:alice", item_id=501, action_type="item_view", metadata_json="{}"))
        s.add(InteractionLog(user_key="anon:alice", item_id=502, action_type="item_view", metadata_json="{}"))
        s.commit()
        del aid_a, aid_b, aid_c

    r = client.get("/me/summary", params={"user_key": "anon:alice"})
    body = r.json()
    assert body["liked_count"] == 1
    assert body["saved_count"] == 1
    assert body["rated_count"] == 1
    assert body["recent_view_count"] == 2
    assert body["has_activity"] is True
    assert len(body["interests"]) >= 1
    assert any(b["is_top"] for b in body["interests"])


def test_summary_view_count_ignores_engagement_actions(member_client):
    """A user who liked/saved/rated but never opened a detail page has
    ``recent_view_count == 0``.

    Guards the regression the old approximation had: counting *any*
    interaction as a view (see ``member_query._recent_view_count``).
    """
    client, SessionLocal = member_client
    with SessionLocal() as s:
        s.add(Like(user_key="anon:carol", item_id=501))
        s.add(InteractionLog(user_key="anon:carol", item_id=501, action_type="like", metadata_json="{}"))
        s.add(InteractionLog(user_key="anon:carol", item_id=502, action_type="save", metadata_json="{}"))
        s.commit()

    body = client.get("/me/summary", params={"user_key": "anon:carol"}).json()
    assert body["liked_count"] == 1
    assert body["recent_view_count"] == 0


def test_history_returns_recent_actions_with_rating(member_client):
    client, SessionLocal = member_client
    with SessionLocal() as s:
        s.add(InteractionLog(
            user_key="anon:bob",
            item_id=502,
            action_type="rate",
            metadata_json='{"rating":5}',
        ))
        s.commit()

    r = client.get("/me/history", params={"user_key": "anon:bob", "limit": 10})
    body = r.json()
    assert body["total"] == 1
    entry = body["items"][0]
    assert entry["action_type"] == "rate"
    assert entry["rating"] == 5
    assert entry["item_name"] == "โขน"
    assert entry["item_id"] == _stable_artifact_id("โขน")


def test_history_skips_unknown_actions(member_client):
    """Actions outside the allow-list are filtered out so the history table
    doesn't get cluttered with internal writes (e.g. ``dismiss``)."""
    client, SessionLocal = member_client
    with SessionLocal() as s:
        s.add(InteractionLog(
            user_key="anon:carol",
            item_id=501,
            action_type="dismiss",
            metadata_json="{}",
        ))
        s.commit()

    r = client.get("/me/history", params={"user_key": "anon:carol"})
    assert r.json()["total"] == 0


def test_saved_liked_rated_return_artifact_ids(member_client):
    client, SessionLocal = member_client
    aid = _stable_artifact_id("ลิเก")
    with SessionLocal() as s:
        s.add(Like(user_key="anon:dave", item_id=503))
        s.add(SavedItem(user_key="anon:dave", item_id=502))
        s.add(Rating(user_key="anon:dave", item_id=501, rating=5))
        s.commit()
    saved = client.get("/me/saved", params={"user_key": "anon:dave"}).json()
    liked = client.get("/me/liked", params={"user_key": "anon:dave"}).json()
    rated = client.get("/me/rated", params={"user_key": "anon:dave"}).json()
    assert _stable_artifact_id("โขน") in saved["items"]
    assert aid in liked["items"]
    assert rated["total"] == 1
    assert rated["items"][0]["rating"] == 5
    assert rated["items"][0]["updated_at"]


def test_recent_views_are_unique_and_ordered(member_client):
    client, SessionLocal = member_client
    now = datetime.now(timezone.utc)
    with SessionLocal() as s:
        s.add(InteractionLog(user_key="anon:recent", item_id=501, action_type="item_view", metadata_json="{}", created_at=now - timedelta(hours=3)))
        s.add(InteractionLog(user_key="anon:recent", item_id=501, action_type="item_view", metadata_json="{}", created_at=now - timedelta(hours=1)))
        s.add(InteractionLog(user_key="anon:recent", item_id=502, action_type="item_view", metadata_json="{}", created_at=now - timedelta(hours=2)))
        s.commit()

    body = client.get("/me/recent-views", params={"user_key": "anon:recent"}).json()
    assert body["total"] == 2
    assert [entry["item_name"] for entry in body["items"]] == ["ระบำพรหมาสตร์", "โขน"]


def test_interest_uses_current_positive_state_not_undo_logs(member_client):
    client, SessionLocal = member_client
    with SessionLocal() as s:
        s.get(Item, 501).category_group = "อนุรักษ์"
        s.get(Item, 502).category_group = "สร้างสรรค์"
        s.add(Like(user_key="anon:signal", item_id=501))
        s.add(Rating(user_key="anon:signal", item_id=502, rating=1))
        # Undo events must not become positive interest signals.
        s.add(InteractionLog(user_key="anon:signal", item_id=502, action_type="unlike", metadata_json="{}"))
        s.add(InteractionLog(user_key="anon:signal", item_id=502, action_type="unsave", metadata_json="{}"))
        s.commit()

    body = client.get("/me/summary", params={"user_key": "anon:signal"}).json()
    assert body["interests"][0]["name"] == "อนุรักษ์"
    assert body["interests"][0]["percent"] == 100
    assert not any(entry["name"] == "สร้างสรรค์" and entry["percent"] > 0 for entry in body["interests"])
    assert len(body["interests"]) == 1


def test_rating_summary_uses_current_database_values(member_client):
    client, SessionLocal = member_client
    with SessionLocal() as s:
        s.add(Rating(user_key="anon:ratings", item_id=501, rating=5))
        s.add(Rating(user_key="anon:ratings", item_id=502, rating=3))
        s.commit()
    body = client.get("/me/rating-summary", params={"user_key": "anon:ratings"}).json()
    assert body["total"] == 2
    assert body["average"] == 4.0
    assert {row["stars"]: row["count"] for row in body["distribution"]} == {
        5: 1, 4: 0, 3: 1, 2: 0, 1: 0,
    }


def test_me_endpoints_reject_missing_user_key(member_client):
    client, _ = member_client
    r = client.get("/me/summary")
    assert r.status_code in (401, 403)


def test_summary_when_db_disabled(monkeypatch, artifacts_dir):
    """DB off → source='disabled' + zeros."""
    monkeypatch.setenv("RECSYS_ARTIFACT_DIR", str(artifacts_dir))
    monkeypatch.setenv("RECSYS_DB_ENABLED", "0")
    config_module.reset_settings_cache()
    reset_singleton()
    app = create_app()
    with TestClient(app) as c:
        r = c.get("/me/summary", params={"user_key": "anon:anyone"})
    body = r.json()
    assert body["source"] == "disabled"
    assert body["liked_count"] == 0
    assert body["has_activity"] is False

def test_member_summary_returns_empty_when_db_disabled(monkeypatch, member_client):
    """``/me/summary`` returns a zero-state shape when the DB layer
    is disabled — exercises the early-out branch."""
    from app.services import member_query as mq_module

    client, _ = member_client
    monkeypatch.setattr(mq_module, "is_db_enabled", lambda: False)
    r = client.get("/me/summary", params={"user_key": "anon:test"})
    assert r.status_code == 200
    body = r.json()
    assert body["liked_count"] == 0
    assert body["has_activity"] is False
    assert body["source"] == "disabled"


def test_member_history_skips_unparseable_rating_metadata(monkeypatch, member_client):
    """A ``rate`` log with invalid JSON ``metadata_json`` returns
    ``rating=None`` rather than crashing on the parse fallback."""
    from app.services import member_query as mq_module

    client, SessionLocal = member_client
    monkeypatch.setattr(mq_module, "is_db_enabled", lambda: True)
    monkeypatch.setattr(mq_module, "session_scope", _scope_of(member_client))

    with SessionLocal() as s:
        s.add(InteractionLog(
            user_key="anon:bad", item_id=502, action_type="rate",
            metadata_json="not-json",
        ))
        s.commit()
    body = client.get("/me/history", params={"user_key": "anon:bad"}).json()
    # The bad row is still surfaced (the action verb is "rate"); the
    # rating field is just None.
    assert any(e["action_type"] == "rate" for e in body["items"])


def _scope_of(member_client):
    """Helper to recover the in-memory session_scope from a fixture."""
    from app import db as db_module
    return db_module.session_scope
