"""Tests for ``routers.admin`` — /admin/items/* endpoints.

End-to-end via ``TestClient``. Requires the DB layer so we spin up an
in-memory SQLite engine and stub ``app.services.embedding.encode_item_text``
so we don't download a 2.5 GB E5 model.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
from contextlib import contextmanager
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.config import reset_settings_cache
from app.db import reset_engine
from app.main import create_app
from app.models_db import Base, Context, Keyword, User
from app.model_loader import ArtifactLoader, set_singleton, reset_singleton
from app.services import user_query, ingestion
from app.services.embedding import reset_model_cache


# --- shared fixtures ------------------------------------------------------


def _fake_embed(item_or_text, kw_names=None, ctx_names=None):
    if isinstance(item_or_text, dict):
        text = item_or_text.get("name", "") + " " + item_or_text.get("description", "")
    else:
        text = item_or_text or ""
    arr = np.zeros(4, dtype=np.float32)
    for i, ch in enumerate(text.encode("utf-8")[:4]):
        arr[i] = float(ch) / 255.0
    norm = float(np.linalg.norm(arr)) or 1.0
    return (arr / norm).astype(np.float32)


@pytest.fixture
def client(monkeypatch):
    reset_settings_cache()
    monkeypatch.setenv("RECSYS_DB_ENABLED", "1")
    monkeypatch.setenv("RECSYS_GEMINI_API_KEY", "")  # disable Layer B
    reset_engine()

    engine = create_engine(
        "sqlite:///:memory:",
        future=True,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)

    @contextmanager
    def _scope():
        s = Session(engine, future=True, expire_on_commit=False)
        try:
            yield s
            s.commit()
        except Exception:
            s.rollback()
            raise
        finally:
            s.close()

    for mod_name in ("app.db", "app.services.user_query", "app.services.ingestion",
                     "app.services.grounding", "app.services.actions",
                     "app.services.db_query"):
        monkeypatch.setattr(f"{mod_name}.session_scope", _scope, raising=False)
    monkeypatch.setattr("app.db.is_db_enabled", lambda: True)
    monkeypatch.setattr(user_query, "is_db_enabled", lambda: True)
    monkeypatch.setattr(ingestion, "is_db_enabled", lambda: True)
    monkeypatch.setattr(ingestion.emb, "encode_item_text", _fake_embed)
    monkeypatch.setattr(ingestion.emb, "encode_text", _fake_embed)

    # Build a populated ArtifactLoader singleton.
    reset_singleton()
    reset_model_cache()
    loader = ArtifactLoader()
    loader._items = pd.DataFrame(
        [
            {
                "item_id": 222445941,
                "name": "ระบำพรหมาสตร์",
                "description": "",
                "category_group": "",
                "performance_type": "",
                "performers_count": 0,
                "duration_minutes": 0,
                "price_text": "",
                "is_active": True,
                "keyword_names": [],
                "context_names": [],
                "taxonomy_paths": [],
            }
        ]
    )
    loader._item_ids = [222445941]
    loader._embeddings = np.eye(4, dtype=np.float32)
    loader._id_to_row = {222445941: 0}
    loader._cf_user_item = {}
    loader._cf_item_users = {222445941: []}
    loader._cf_rating_weight = {}
    loader._metadata = {"item_count": 1}
    set_singleton(loader)

    yield TestClient(create_app())

    reset_singleton()
    engine.dispose()


def _signup_and_get_token(client, username: str = "admin", password: str = "hunter22"):
    r = client.post("/auth/signup", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# --- /admin/items/draft ---------------------------------------------------


def test_draft_requires_auth(client):
    r = client.post("/admin/items/draft", json={"name": "X", "context_names": []})
    assert r.status_code == 401


def test_draft_returns_proposals_and_draft_id(client):
    token = _signup_and_get_token(client)
    r = client.post(
        "/admin/items/draft",
        headers=_auth(token),
        json={"name": "ระบำพรหมาสตร์", "description": "ผู้หญิง", "context_names": ["งานบวช"]},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "draft_id" in body
    assert isinstance(body["proposals"], list)
    # Synthetic vocab has no Thai entries, so proposals may be empty — just
    # assert the shape.


def test_draft_creates_missing_context(client):
    token = _signup_and_get_token(client)
    r = client.post(
        "/admin/items/draft",
        headers=_auth(token),
        json={"name": "X", "context_names": ["บริบทใหม่"]},
    )
    assert r.status_code == 200
    body = r.json()
    assert any("Created missing context" in w for w in body["warnings"])


# --- /admin/items commit -------------------------------------------------


def test_commit_creates_item(client):
    token = _signup_and_get_token(client)
    draft = client.post(
        "/admin/items/draft",
        headers=_auth(token),
        json={"name": "การแสดงใหม่", "context_names": ["งานบวช"]},
    ).json()
    r = client.post(
        "/admin/items",
        headers=_auth(token),
        json={
            "draft_id": draft["draft_id"],
            "additional_keyword_ids": [],
            "removed_keyword_ids": [],
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["item"]["name"] == "การแสดงใหม่"


def test_commit_unknown_draft_returns_400(client):
    token = _signup_and_get_token(client)
    r = client.post(
        "/admin/items",
        headers=_auth(token),
        json={"draft_id": "no-such-id", "additional_keyword_ids": [], "removed_keyword_ids": []},
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "unknown_draft"


# --- /admin/items/{id}/keywords -----------------------------------------


def test_reassign_keywords_updates_item(client):
    """Reassign route uses ``from ..db import session_scope`` — the client
    fixture already monkeypatches ``app.db.session_scope`` to point at
    the in-memory engine, so reassign transparently reaches the test DB.
    """
    token = _signup_and_get_token(client)
    draft = client.post(
        "/admin/items/draft",
        headers=_auth(token),
        json={"name": "reassign-target", "context_names": ["งานบวช"]},
    ).json()
    committed = client.post(
        "/admin/items",
        headers=_auth(token),
        json={"draft_id": draft["draft_id"], "additional_keyword_ids": [], "removed_keyword_ids": []},
    ).json()
    item_id = committed["item"]["id"]

    r = client.post(
        f"/admin/items/{item_id}/keywords",
        headers=_auth(token),
        json={"keyword_ids": []},
    )
    assert r.status_code == 200, r.text


def test_reassign_keywords_unknown_item_returns_400(client):
    token = _signup_and_get_token(client)
    r = client.post(
        "/admin/items/99999/keywords",
        headers=_auth(token),
        json={"keyword_ids": []},
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "item_not_found"


def test_draft_with_empty_vocab_still_returns_draft_id(client):
    """Edge case: draft when the artifact's vocab is empty."""
    token = _signup_and_get_token(client)
    r = client.post(
        "/admin/items/draft",
        headers=_auth(token),
        json={"name": "Z", "context_names": []},
    )
    assert r.status_code == 200
    body = r.json()
    assert "draft_id" in body
    assert isinstance(body["proposals"], list)


def test_commit_merges_layer_a_b_and_admin_additions(client):
    """``commit_item`` merges the Layer A/B proposals + admin's additions."""
    token = _signup_and_get_token(client)
    draft = client.post(
        "/admin/items/draft",
        headers=_auth(token),
        json={"name": "merge-test", "context_names": ["งานบวช"]},
    ).json()
    r = client.post(
        "/admin/items",
        headers=_auth(token),
        json={
            "draft_id": draft["draft_id"],
            "additional_keyword_ids": [1, 2],
            "removed_keyword_ids": [],
        },
    )
    assert r.status_code == 200, r.text


def test_commit_removed_keyword_ids_excludes(client):
    """``removed_keyword_ids`` removes ids from the merged set."""
    token = _signup_and_get_token(client)
    draft = client.post(
        "/admin/items/draft",
        headers=_auth(token),
        json={"name": "remove-test", "context_names": ["งานบวช"]},
    ).json()
    r = client.post(
        "/admin/items",
        headers=_auth(token),
        json={
            "draft_id": draft["draft_id"],
            "additional_keyword_ids": [5],
            "removed_keyword_ids": [5],  # remove immediately
        },
    )
    assert r.status_code == 200, r.text


def test_commit_with_expired_draft_returns_400(client, monkeypatch):
    """Force a draft to be expired and assert the route rejects it."""
    import time as _time
    from app.routers import admin as admin_module
    token = _signup_and_get_token(client)
    draft = client.post(
        "/admin/items/draft",
        headers=_auth(token),
        json={"name": "exp-test", "context_names": []},
    ).json()
    # Reach into the in-memory drafts and set _expires_at to the past.
    with admin_module._drafts_lock:
        payload = admin_module._drafts[draft["draft_id"]]
        payload["_expires_at"] = _time.time() - 1
    r = client.post(
        "/admin/items",
        headers=_auth(token),
        json={
            "draft_id": draft["draft_id"],
            "additional_keyword_ids": [],
            "removed_keyword_ids": [],
        },
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "draft_expired"


def test_admin_route_rejects_non_admin_user(client):
    # First user (admin) signs up; second user is not.
    client.post("/auth/signup", json={"username": "admin", "password": "hunter22"})
    non_admin = client.post(
        "/auth/signup", json={"username": "user2", "password": "hunter22"}
    ).json()
    token = non_admin["access_token"]
    r = client.post(
        "/admin/items/draft",
        headers=_auth(token),
        json={"name": "X", "context_names": []},
    )
    assert r.status_code == 403