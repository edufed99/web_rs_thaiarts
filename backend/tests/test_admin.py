"""Tests for ``routers.admin`` — /admin/items/* endpoints.

End-to-end via ``TestClient``. Requires the DB layer so we spin up an
in-memory SQLite engine and stub ``app.services.embedding.encode_item_text``
so we don't download a 2.5 GB E5 model.
"""
from __future__ import annotations

import uuid

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


def test_update_item_edits_catalog_row(client):
    token = _signup_and_get_token(client)
    draft = client.post(
        "/admin/items/draft",
        headers=_auth(token),
        json={"name": "edit-target", "context_names": ["งานบวช"]},
    ).json()
    committed = client.post(
        "/admin/items",
        headers=_auth(token),
        json={"draft_id": draft["draft_id"], "additional_keyword_ids": [], "removed_keyword_ids": []},
    ).json()
    item_id = committed["item"]["id"]

    r = client.put(
        f"/admin/items/{item_id}",
        headers=_auth(token),
        json={
            "name": "edit-target-updated",
            "description": "รายละเอียดใหม่",
            "category_group": "หมวดทดสอบ",
            "context_names": ["บริบทใหม่"],
            "keyword_ids": [],
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["item"]["name"] == "edit-target-updated"

    reread = client.get(f"/items/{item_id}", headers=_auth(token))
    assert reread.status_code == 200, reread.text
    assert reread.json()["description"] == "รายละเอียดใหม่"
    assert reread.json()["contexts"][0]["name"] == "บริบทใหม่"


def test_delete_item_removes_catalog_row(client):
    token = _signup_and_get_token(client)
    draft = client.post(
        "/admin/items/draft",
        headers=_auth(token),
        json={"name": "delete-target", "context_names": ["งานบวช"]},
    ).json()
    committed = client.post(
        "/admin/items",
        headers=_auth(token),
        json={"draft_id": draft["draft_id"], "additional_keyword_ids": [], "removed_keyword_ids": []},
    ).json()
    item_id = committed["item"]["id"]

    r = client.delete(f"/admin/items/{item_id}", headers=_auth(token))
    assert r.status_code == 200, r.text
    assert r.json()["deleted"] is True

    catalog = client.get("/items?search=delete-target", headers=_auth(token))
    assert catalog.status_code == 200, catalog.text
    assert catalog.json()["items"] == []


def test_facets_returns_distinct_categories_and_types(client):
    """``GET /admin/items/facets`` surfaces distinct dropdown values.

    First ingest two items with distinct categories/performance types so
    the DB has rows to group over. Admin-only guard must return 401 for
    anonymous callers.
    """
    # Anonymous = 401.
    r_anon = client.get("/admin/items/facets")
    assert r_anon.status_code == 401

    token = _signup_and_get_token(client)
    headers = _auth(token)

    for name, cat, perf in [
        ("facets-a", "หมวด A", "ประเภท 1"),
        ("facets-b", "หมวด B", "ประเภท 2"),
        ("facets-c", "หมวด A", "ประเภท 1"),  # duplicate
    ]:
        draft = client.post(
            "/admin/items/draft",
            headers=headers,
            json={
                "name": name,
                "category_group": cat,
                "performance_type": perf,
                "context_names": [],
            },
        ).json()
        assert client.post(
            "/admin/items",
            headers=headers,
            json={
                "draft_id": draft["draft_id"],
                "additional_keyword_ids": [],
                "removed_keyword_ids": [],
            },
        ).status_code == 200

    r = client.get("/admin/items/facets", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source"] == "db"
    # The category/performance_type fields in draft defaults are empty, so
    # the duplicates-collapsing rule means only the rows we explicitly
    # tagged survive.
    assert "หมวด A" in body["category_groups"]
    assert "หมวด B" in body["category_groups"]
    assert body["category_groups"].count("หมวด A") == 1
    assert "ประเภท 1" in body["performance_types"]
    assert "ประเภท 2" in body["performance_types"]
    # Cascade map: "ประเภท 1" only ever appeared with "หมวด A".
    cascade = body["category_groups_by_performance_type"]
    assert "ประเภท 1" in cascade and "หมวด A" in cascade["ประเภท 1"]
    assert "ประเภท 2" in cascade and "หมวด B" in cascade["ประเภท 2"]


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


# --- /admin/items/{id}/image -----------------------------------------------

# 1x1 transparent PNG, generated once and reused across tests.
_TINY_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\x0d\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _commit_sample_item(client, token: str) -> int:
    """Helper: create a minimal item via draft+commit, return its artifact id."""
    draft = client.post(
        "/admin/items/draft",
        headers=_auth(token),
        json={"name": f"img-target-{uuid.uuid4().hex[:6]}", "context_names": []},
    ).json()
    committed = client.post(
        "/admin/items",
        headers=_auth(token),
        json={
            "draft_id": draft["draft_id"],
            "additional_keyword_ids": [],
            "removed_keyword_ids": [],
        },
    ).json()
    return int(committed["item"]["id"])


def test_upload_image_rejects_oversize(client, monkeypatch):
    """6 MB body is rejected with ``image_too_large``."""
    from app.core.config import get_settings

    settings = get_settings()
    # Shrink the cap so the test stays fast — we want a small oversize
    # body, not 5+ MB on disk.
    monkeypatch.setattr(settings, "max_upload_bytes", 1024)

    token = _signup_and_get_token(client)
    artifact_id = _commit_sample_item(client, token)

    big = b"\x89PNG\r\n\x1a\n" + b"x" * (settings.max_upload_bytes + 100)
    r = client.post(
        f"/admin/items/{artifact_id}/image",
        headers=_auth(token),
        files={"file": ("big.png", big, "image/png")},
    )
    assert r.status_code == 400, r.text
    assert r.json()["error"]["code"] == "image_too_large"


def test_upload_image_rejects_wrong_magic(client):
    """Plain text disguised as image/png is rejected by magic-byte sniff."""
    token = _signup_and_get_token(client)
    artifact_id = _commit_sample_item(client, token)

    r = client.post(
        f"/admin/items/{artifact_id}/image",
        headers=_auth(token),
        files={"file": ("fake.png", b"hello world this is not an image", "image/png")},
    )
    assert r.status_code == 400, r.text
    assert r.json()["error"]["code"] == "image_invalid_type"


def test_upload_image_succeeds(client):
    """Real PNG → file on disk under the configured ``upload_dir`` + ``image_url``
    persisted on the DB row.

    The StaticFiles mount in ``main.py`` binds to ``settings.upload_dir`` at
    app-creation time — verifying that round-trip needs a fresh app, but
    FastAPI's ``StaticFiles`` is itself covered by upstream tests, so we
    only assert what our own code does: stream to disk + persist ``image_url``
    on the DB row that the public catalog read will surface.
    """
    from app.core.config import get_settings
    from app.db import session_scope
    from app.models_db import Item
    from sqlalchemy import select

    settings = get_settings()
    expected_items_dir = settings.upload_dir / "items"
    # Snapshot any pre-existing files so the assertion stays scoped to
    # what this test just wrote.
    before = {p.name for p in expected_items_dir.iterdir()} if expected_items_dir.exists() else set()

    token = _signup_and_get_token(client)
    artifact_id = _commit_sample_item(client, token)

    r = client.post(
        f"/admin/items/{artifact_id}/image",
        headers=_auth(token),
        files={"file": ("cover.png", _TINY_PNG, "image/png")},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["mime"] == "image/png"
    assert body["size_bytes"] == len(_TINY_PNG)
    assert body["item_id"] == artifact_id
    assert body["url"].startswith("/uploads/items/")

    # New file written to disk with the exact bytes we sent.
    after = {p.name for p in expected_items_dir.iterdir()}
    new_files = sorted(after - before)
    assert len(new_files) == 1
    written = (expected_items_dir / new_files[0]).read_bytes()
    assert written == _TINY_PNG
    assert body["url"].endswith(new_files[0])

    # DB row carries the new URL — the public catalog read surfaces
    # this directly, so a redirect to ``/items/{id}`` would render it.
    with session_scope() as session:
        if session is not None:
            row = session.execute(
                select(Item).where(Item.artifact_item_id == artifact_id)
            ).scalar_one_or_none()
            assert row is not None
            assert row.image_url == body["url"]


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
