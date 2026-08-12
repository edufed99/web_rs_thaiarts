"""Tests for the /actions/* endpoints and the services.actions module.

Drives the endpoints end-to-end through the FastAPI TestClient with an
in-memory SQLite engine monkeypatched into ``app.db`` so the action
writes (likes / saved_items / ratings / interaction_logs) go to a real
ORM, not a mocked out object.

The tests build a synthetic 3-item catalog with backfilled artifact ids
so the live-action layer can FK into ``items``.
"""
from __future__ import annotations

import hashlib
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# check_same_thread=False + StaticPool so the in-memory engine can be used
# across threads (FastAPI TestClient invokes endpoints in a worker thread).
INMEM_URL = "sqlite:///:memory:?check_same_thread=False"


def _stable_artifact_id(name: str) -> int:
    return int(hashlib.sha256(f"item::{name}".encode("utf-8")).hexdigest()[:7], 16)


@pytest.fixture
def actions_client(monkeypatch, artifacts_dir):
    """TestClient wired to a real DB and the synthetic artifacts.

    Yields ``(client, items_by_artifact_id)`` so tests can pick artifact
    ids for their POST bodies. The same monkeypatch dance used in
    ``test_db.py`` applies here so that services code sees the in-memory
    engine instead of the production psycopg engine.
    """
    from app.core import config as config_module
    from app import db as db_module
    from app.main import create_app
    from app.model_loader import reset_singleton
    from app.models_db import Base, Item

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

    # Use the same item names as conftest's synthetic artifacts so the
    # artifact loader has a row to return (artifact id == stable_id("item", name)).
    items = {
        501: "ระบำพรหมาสตร์",  # item_id 222445941
        502: "โขน",            # item_id 123250508
        503: "ลิเก",           # item_id 27904623
    }
    by_artifact = {}
    with SessionLocal() as s:
        for db_id, name in items.items():
            aid = _stable_artifact_id(name)
            by_artifact[aid] = db_id
            s.add(Item(
                id=db_id,
                name=name,
                is_active=True,
                artifact_item_id=aid,
            ))
        s.commit()

    def fake_engine():
        # Bypass the cached engine — return the in-memory engine directly
        # so SQLAlchemy does not try to talk to the production Postgres URL.
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
    from app.services import actions as actions_module
    monkeypatch.setattr(dbq_module, "is_db_enabled", lambda: True)
    monkeypatch.setattr(dbq_module, "session_scope", fake_scope)
    monkeypatch.setattr(actions_module, "is_db_enabled", lambda: True)
    monkeypatch.setattr(actions_module, "session_scope", fake_scope)
    db_module.reset_engine()

    app = create_app()
    with TestClient(app) as client:
        yield client, by_artifact
    eng.dispose()


# --- Endpoint tests ---------------------------------------------------------

def test_post_like_persists_and_returns_state(actions_client):
    client, by_artifact = actions_client
    aid = next(iter(by_artifact.keys()))
    body = {"user_key": "anon:u1", "item_id": aid}
    r = client.post("/actions/like", json=body)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["action"] == "liked"
    assert data["item"]["user_state"]["liked"] is True
    assert data["item"]["user_state"]["saved"] is False
    assert data["item"]["user_state"]["rating"] == 0


def test_post_like_is_idempotent(actions_client):
    client, by_artifact = actions_client
    aid = next(iter(by_artifact.keys()))
    body = {"user_key": "anon:u1", "item_id": aid}
    r1 = client.post("/actions/like", json=body)
    r2 = client.post("/actions/like", json=body)
    assert r1.status_code == 200
    assert r2.status_code == 200
    # Same final state either way; likes table still has 1 row.
    assert r1.json()["item"]["user_state"]["liked"] is True
    assert r2.json()["item"]["user_state"]["liked"] is True


def test_delete_like_removes_state(actions_client):
    client, by_artifact = actions_client
    aid = next(iter(by_artifact.keys()))
    client.post("/actions/like", json={"user_key": "anon:u1", "item_id": aid})
    r = client.request(
        "DELETE", "/actions/like", json={"user_key": "anon:u1", "item_id": aid}
    )
    assert r.status_code == 200
    assert r.json()["action"] == "unliked"
    assert r.json()["item"]["user_state"]["liked"] is False


def test_post_save_persists(actions_client):
    client, by_artifact = actions_client
    aid = next(iter(by_artifact.keys()))
    r = client.post("/actions/save", json={"user_key": "anon:u2", "item_id": aid})
    assert r.status_code == 200
    data = r.json()
    assert data["action"] == "saved"
    assert data["item"]["user_state"]["saved"] is True


def test_delete_save_removes_state(actions_client):
    client, by_artifact = actions_client
    aid = next(iter(by_artifact.keys()))
    client.post("/actions/save", json={"user_key": "anon:u2", "item_id": aid})
    r = client.request(
        "DELETE", "/actions/save", json={"user_key": "anon:u2", "item_id": aid}
    )
    assert r.status_code == 200
    assert r.json()["action"] == "unsaved"


def test_put_rating_upserts(actions_client):
    client, by_artifact = actions_client
    aid = next(iter(by_artifact.keys()))
    r1 = client.put(
        "/actions/rating",
        json={"user_key": "anon:u3", "item_id": aid, "rating": 4},
    )
    assert r1.status_code == 200
    assert r1.json()["action"] == "rated"
    assert r1.json()["item"]["user_state"]["rating"] == 4

    # Overwrite with a different rating.
    r2 = client.put(
        "/actions/rating",
        json={"user_key": "anon:u3", "item_id": aid, "rating": 5},
    )
    assert r2.status_code == 200
    assert r2.json()["item"]["user_state"]["rating"] == 5


def test_put_rating_rejects_out_of_range(actions_client):
    client, by_artifact = actions_client
    aid = next(iter(by_artifact.keys()))
    r = client.put(
        "/actions/rating",
        json={"user_key": "anon:u4", "item_id": aid, "rating": 0},
    )
    assert r.status_code == 422
    r = client.put(
        "/actions/rating",
        json={"user_key": "anon:u4", "item_id": aid, "rating": 6},
    )
    assert r.status_code == 422


def test_put_rating_requires_rating_field(actions_client):
    client, by_artifact = actions_client
    aid = next(iter(by_artifact.keys()))
    r = client.put(
        "/actions/rating",
        json={"user_key": "anon:u5", "item_id": aid},  # no rating
    )
    assert r.status_code == 400


def test_like_unknown_item_returns_404(actions_client):
    client, _ = actions_client
    r = client.post(
        "/actions/like",
        json={"user_key": "anon:u6", "item_id": 999_999_999},
    )
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "item_not_found"


def test_action_records_interaction_log(actions_client):
    client, by_artifact = actions_client
    aid = next(iter(by_artifact.keys()))
    client.post(
        "/actions/like",
        json={"user_key": "anon:u7", "item_id": aid, "context_id": 42},
    )
    # Inspect the interaction_logs table directly.
    from app.services import db_query as dbq_module
    # Re-open a session against the in-memory engine that the client used.
    eng = dbq_module.session_scope  # type: ignore[attr-defined]
    # The actions monkeypatch installed a different session_scope, so
    # query through the ORM by reaching into a fresh session via the
    # app's monkeypatched engine.
    from app.models_db import InteractionLog
    from app import db as db_module
    SessionLocal = sessionmaker(bind=db_module.get_engine(), future=True)
    with SessionLocal() as s:
        rows = s.query(InteractionLog).all()
    assert any(r.action_type == "like" and r.user_key == "anon:u7" for r in rows)


# --- View tests (ADR-002 §3.1) ----------------------------------------------

def _logs(action_type: str | None = None):
    """Read interaction_logs through a fresh session on the test engine."""
    from app import db as db_module
    from app.models_db import InteractionLog

    SessionLocal = sessionmaker(bind=db_module.get_engine(), future=True)
    with SessionLocal() as s:
        q = s.query(InteractionLog)
        if action_type is not None:
            q = q.filter(InteractionLog.action_type == action_type)
        return q.all()


def test_post_view_logs_once(actions_client):
    client, by_artifact = actions_client
    aid = next(iter(by_artifact.keys()))
    r = client.post("/actions/view", json={"user_key": "anon:v1", "item_id": aid})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["action"] == "viewed"
    assert body["item_id"] == aid
    assert body["deduped"] is False

    rows = [x for x in _logs("item_view") if x.user_key == "anon:v1"]
    assert len(rows) == 1


def test_post_view_dedupes_within_window(actions_client):
    """A refresh must not inflate the count: the second call is a no-op."""
    client, by_artifact = actions_client
    aid = next(iter(by_artifact.keys()))
    payload = {"user_key": "anon:v2", "item_id": aid}
    first = client.post("/actions/view", json=payload)
    second = client.post("/actions/view", json=payload)
    assert first.json()["deduped"] is False
    assert second.status_code == 200
    assert second.json()["deduped"] is True

    rows = [x for x in _logs("item_view") if x.user_key == "anon:v2"]
    assert len(rows) == 1, "dedupe window must suppress the second write"


def test_post_view_dedupe_is_per_user_and_item(actions_client):
    """Dedupe must key on (user, item) — not suppress unrelated views."""
    client, by_artifact = actions_client
    aids = list(by_artifact.keys())
    client.post("/actions/view", json={"user_key": "anon:v3", "item_id": aids[0]})
    other_item = client.post(
        "/actions/view", json={"user_key": "anon:v3", "item_id": aids[1]}
    )
    other_user = client.post(
        "/actions/view", json={"user_key": "anon:v4", "item_id": aids[0]}
    )
    assert other_item.json()["deduped"] is False
    assert other_user.json()["deduped"] is False
    assert len([x for x in _logs("item_view") if x.user_key == "anon:v3"]) == 2
    assert len([x for x in _logs("item_view") if x.user_key == "anon:v4"]) == 1


def test_post_view_dedupe_window_disabled(monkeypatch, actions_client):
    """``view_dedupe_minutes = 0`` disables suppression entirely."""
    from app.core import config as config_module

    client, by_artifact = actions_client
    monkeypatch.setenv("RECSYS_VIEW_DEDUPE_MINUTES", "0")
    config_module.reset_settings_cache()

    aid = next(iter(by_artifact.keys()))
    payload = {"user_key": "anon:v5", "item_id": aid}
    client.post("/actions/view", json=payload)
    second = client.post("/actions/view", json=payload)
    assert second.json()["deduped"] is False
    assert len([x for x in _logs("item_view") if x.user_key == "anon:v5"]) == 2
    config_module.reset_settings_cache()


def test_post_view_attributes_persisted_request_id(actions_client):
    """A view from a recommendation stores the FK, enabling CTR."""
    from app import db as db_module
    from app.models_db import RecommendationRequest

    client, by_artifact = actions_client
    aid = next(iter(by_artifact.keys()))

    SessionLocal = sessionmaker(bind=db_module.get_engine(), future=True)
    with SessionLocal() as s:
        req = RecommendationRequest(
            selected_context_id=1, candidate_count=5, top_k=3, method="test"
        )
        s.add(req)
        s.commit()
        req_id = int(req.id)

    r = client.post(
        "/actions/view",
        json={"user_key": "anon:v6", "item_id": aid, "request_id": str(req_id)},
    )
    assert r.status_code == 200
    rows = [x for x in _logs("item_view") if x.user_key == "anon:v6"]
    assert len(rows) == 1
    assert rows[0].recommendation_request_id == req_id


def test_post_view_ignores_uuid_request_id(actions_client):
    """``request_id`` is a uuid when the recommendation persist failed
    (recommendation_service.py:391). It is not a foreign key, so it must be
    dropped rather than raising an integrity error."""
    client, by_artifact = actions_client
    aid = next(iter(by_artifact.keys()))
    r = client.post(
        "/actions/view",
        json={
            "user_key": "anon:v7",
            "item_id": aid,
            "request_id": "3f2b1c66-0000-4a1e-9d33-8c7b5a4e2100",
        },
    )
    assert r.status_code == 200, r.text
    rows = [x for x in _logs("item_view") if x.user_key == "anon:v7"]
    assert len(rows) == 1
    assert rows[0].recommendation_request_id is None


def test_post_view_ignores_nonexistent_request_id(actions_client):
    """An integer id that matches no row must not become a dangling FK."""
    client, by_artifact = actions_client
    aid = next(iter(by_artifact.keys()))
    r = client.post(
        "/actions/view",
        json={"user_key": "anon:v8", "item_id": aid, "request_id": "987654"},
    )
    assert r.status_code == 200, r.text
    rows = [x for x in _logs("item_view") if x.user_key == "anon:v8"]
    assert rows[0].recommendation_request_id is None


def test_view_unknown_item_returns_404(actions_client):
    client, _ = actions_client
    r = client.post(
        "/actions/view", json={"user_key": "anon:v9", "item_id": 999_999_999}
    )
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "item_not_found"


def test_view_excluded_from_user_history(monkeypatch, actions_client):
    """Views must never surface in the history table (ADR-002 §3.1).

    ``member_query`` binds ``session_scope`` / ``is_db_enabled`` at import
    time, so the fixture's patches don't reach it — we patch that module
    explicitly here. Without this the endpoint returns an empty list and the
    exclusion assertion would pass vacuously.
    """
    from app import db as db_module
    from app.services import member_query as mq_module

    client, by_artifact = actions_client
    monkeypatch.setattr(mq_module, "is_db_enabled", lambda: True)
    monkeypatch.setattr(mq_module, "session_scope", db_module.session_scope)

    aid = next(iter(by_artifact.keys()))
    client.post("/actions/view", json={"user_key": "anon:v10", "item_id": aid})
    client.post("/actions/like", json={"user_key": "anon:v10", "item_id": aid})

    body = client.get("/me/history", params={"user_key": "anon:v10"}).json()
    kinds = [e["action_type"] for e in body["items"]]
    # The 'like' must be present, proving the query really sees the rows...
    assert kinds == ["like"], body
    # ...and the item_view row, which exists in the table, must be filtered.
    assert len([x for x in _logs("item_view") if x.user_key == "anon:v10"]) == 1


def test_view_does_not_change_user_state(actions_client):
    """A view writes no state table — liked/saved/rating stay untouched."""
    from app.services.actions import fetch_user_state

    client, by_artifact = actions_client
    aid = next(iter(by_artifact.keys()))
    client.post("/actions/view", json={"user_key": "anon:v11", "item_id": aid})
    assert fetch_user_state("anon:v11", aid) == {
        "liked": False,
        "saved": False,
        "rating": 0,
    }


# --- Service-level tests (no HTTP) ------------------------------------------

def test_perform_item_action_rejects_unknown_action(actions_client):
    from app.services.actions import perform_item_action, VALID_ACTIONS
    from app.core.exceptions import InvalidActionError

    _, by_artifact = actions_client
    aid = next(iter(by_artifact.keys()))
    with pytest.raises(InvalidActionError):
        perform_item_action(
            user_key="anon:u8", item_id=aid, action="dismiss"
        )
    assert "dismiss" not in VALID_ACTIONS  # 'dismiss' is out of scope


def test_fetch_user_state_returns_defaults_when_no_actions(actions_client):
    from app.services.actions import fetch_user_state

    _, by_artifact = actions_client
    aid = next(iter(by_artifact.keys()))
    state = fetch_user_state("anon:never", aid)
    assert state == {"liked": False, "saved": False, "rating": 0}


def test_db_disabled_returns_503(monkeypatch, artifacts_dir):
    """When RECSYS_DB_ENABLED=0, /actions endpoints must return 503."""
    from app.core import config as config_module
    from app.main import create_app
    from app.model_loader import reset_singleton

    monkeypatch.setenv("RECSYS_ARTIFACT_DIR", str(artifacts_dir))
    monkeypatch.setenv("RECSYS_DB_ENABLED", "0")
    config_module.reset_settings_cache()
    reset_singleton()
    app = create_app()
    with TestClient(app) as client:
        r = client.post(
            "/actions/like",
            json={"user_key": "anon:x", "item_id": 222445941},
        )
        assert r.status_code == 503
        assert r.json()["error"]["code"] == "db_disabled"
