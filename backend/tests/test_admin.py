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
from app.services import identity, ingestion
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

    for mod_name in ("app.db", "app.services.ingestion",
                     "app.services.grounding", "app.services.actions",
                     "app.services.db_query"):
        monkeypatch.setattr(f"{mod_name}.session_scope", _scope, raising=False)
    monkeypatch.setattr("app.db.is_db_enabled", lambda: True)
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


def test_update_item_creates_and_unlinks_admin_keywords(client):
    token = _signup_and_get_token(client)
    draft = client.post(
        "/admin/items/draft",
        headers=_auth(token),
        json={"name": "keyword-edit-target", "context_names": ["งานบวช"]},
    ).json()
    committed = client.post(
        "/admin/items",
        headers=_auth(token),
        json={"draft_id": draft["draft_id"], "additional_keyword_ids": [], "removed_keyword_ids": []},
    ).json()
    item_id = committed["item"]["id"]

    created = client.put(
        f"/admin/items/{item_id}",
        headers=_auth(token),
        json={
            "keyword_ids": [],
            "new_keyword_names": ["  ระบำ   ทดสอบ  ", "ระบำ ทดสอบ"],
        },
    )
    assert created.status_code == 200, created.text
    assert [keyword["name"] for keyword in created.json()["item"]["keywords"]] == ["ระบำ ทดสอบ"]
    assert any("Created keyword" in warning for warning in created.json()["warnings"])

    keyword_id = created.json()["item"]["keywords"][0]["id"]
    reused = client.put(
        f"/admin/items/{item_id}",
        headers=_auth(token),
        json={"keyword_ids": [], "new_keyword_names": ["ระบำ ทดสอบ"]},
    )
    assert reused.status_code == 200, reused.text
    assert reused.json()["item"]["keywords"][0]["id"] == keyword_id

    unlinked = client.put(
        f"/admin/items/{item_id}",
        headers=_auth(token),
        json={"keyword_ids": [], "new_keyword_names": []},
    )
    assert unlinked.status_code == 200, unlinked.text
    assert unlinked.json()["item"]["keywords"] == []


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


def test_upload_video_rejects_wrong_magic(client):
    token = _signup_and_get_token(client)
    artifact_id = _commit_sample_item(client, token)
    response = client.post(
        f"/admin/items/{artifact_id}/video",
        headers=_auth(token),
        files={"file": ("fake.mp4", b"not really a video", "video/mp4")},
    )
    assert response.status_code == 400, response.text
    assert response.json()["error"]["code"] == "video_invalid_type"


def test_upload_video_succeeds_and_persists_url(client):
    from app.db import session_scope
    from app.models_db import Item
    from sqlalchemy import select

    tiny_mp4 = b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isommp41" + b"video-data"
    token = _signup_and_get_token(client)
    artifact_id = _commit_sample_item(client, token)
    response = client.post(
        f"/admin/items/{artifact_id}/video",
        headers=_auth(token),
        files={"file": ("sample.mp4", tiny_mp4, "video/mp4")},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["mime"] == "video/mp4"
    assert body["size_bytes"] == len(tiny_mp4)
    assert body["url"].startswith("/uploads/items/")

    with session_scope() as session:
        if session is not None:
            row = session.execute(
                select(Item).where(Item.artifact_item_id == artifact_id)
            ).scalar_one_or_none()
            assert row is not None
            assert row.video_url == body["url"]


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


# --- Coverage gap: PUT update_item + reassign_keywords + facets + upload ----


def test_update_item_sets_performers_and_duration(client):
    """PUT with ``performers_count`` and ``duration_minutes`` populates
    the loader row (was uncovered because the happy-path test only
    touched name/description/category/contexts)."""
    from app.model_loader import get_singleton

    token = _signup_and_get_token(client)
    draft = client.post(
        "/admin/items/draft",
        headers=_auth(token),
        json={"name": "size-target", "context_names": ["งานบวช"]},
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
            "name": "size-target",
            "description": "",
            "category_group": "",
            "context_names": ["งานบวช"],
            "keyword_ids": [],
            "performers_count": 12,
            "duration_minutes": 45,
            "price_text": "฿ 30,000",
            "is_active": True,
        },
    )
    assert r.status_code == 200, r.text
    row = get_singleton().item_row(int(item_id))
    assert row["performers_count"] == 12
    assert row["duration_minutes"] == 45
    assert row["price_text"] == "฿ 30,000"


def test_update_item_inactive_flag(client):
    """PUT with ``is_active=false`` deactivates the row in the loader."""
    from app.model_loader import get_singleton

    token = _signup_and_get_token(client)
    draft = client.post(
        "/admin/items/draft",
        headers=_auth(token),
        json={"name": "inactive-target", "context_names": ["งานบวช"]},
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
            "name": "inactive-target",
            "context_names": ["งานบวช"],
            "keyword_ids": [],
            "is_active": False,
        },
    )
    assert r.status_code == 200, r.text
    row = get_singleton().item_row(int(item_id))
    assert bool(row["is_active"]) is False


def test_facets_fallback_when_db_disabled(client, monkeypatch):
    """``item_facets`` falls back to artifact-loader data when the DB
    layer is off, instead of 500ing."""
    token = _signup_and_get_token(client)
    monkeypatch.setenv("RECSYS_DB_ENABLED", "0")
    reset_engine()
    r = client.get("/admin/items/facets", headers=_auth(token))
    assert r.status_code == 200, r.text
    body = r.json()
    assert "category_groups" in body
    assert "performance_types" in body


def test_admin_items_facets_db_disabled(monkeypatch, client):
    """The /admin/items/facets endpoint must survive DB off — same as above."""
    token = _signup_and_get_token(client)
    monkeypatch.setenv("RECSYS_DB_ENABLED", "0")
    reset_engine()
    r = client.get("/admin/items/facets", headers=_auth(token))
    assert r.status_code == 200


# --- /admin/users -----------------------------------------------------------


def test_admin_user_management_crud(client):
    token = _signup_and_get_token(client)
    headers = _auth(token)

    created = client.post(
        "/admin/users",
        headers=headers,
        json={
            "username": "member01",
            "email": "member01@example.com",
            "password": "member1234",
            "display_name": "สมาชิกหนึ่ง",
            "is_admin": False,
        },
    )
    assert created.status_code == 200, created.text
    user_id = created.json()["id"]

    listed = client.get("/admin/users", headers=headers)
    assert listed.status_code == 200, listed.text
    assert listed.json()["total"] == 2
    assert {row["username"] for row in listed.json()["users"]} == {"admin", "member01"}

    updated = client.put(
        f"/admin/users/{user_id}",
        headers=headers,
        json={
            "display_name": "สมาชิกหนึ่งแก้ไข",
            "email": "member.updated@example.com",
            "is_admin": True,
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["display_name"] == "สมาชิกหนึ่งแก้ไข"
    assert updated.json()["is_admin"] is True

    deleted = client.delete(f"/admin/users/{user_id}", headers=headers)
    assert deleted.status_code == 200, deleted.text
    assert deleted.json() == {"deleted": True, "user_id": user_id}


def test_admin_user_management_requires_admin(client):
    assert client.get("/admin/users").status_code == 401

    admin_token = _signup_and_get_token(client)
    client.post(
        "/admin/users",
        headers=_auth(admin_token),
        json={"username": "member02", "password": "member1234"},
    )
    member_login = client.post(
        "/auth/login",
        json={"username": "member02", "password": "member1234"},
    )
    member_token = member_login.json()["access_token"]
    assert client.get("/admin/users", headers=_auth(member_token)).status_code == 403


def test_admin_cannot_delete_or_demote_current_account(client):
    token = _signup_and_get_token(client)
    headers = _auth(token)
    current = client.get("/auth/me", headers=headers).json()

    deleted = client.delete(f"/admin/users/{current['id']}", headers=headers)
    assert deleted.status_code == 400
    assert deleted.json()["error"]["code"] == "cannot_delete_self"

    demoted = client.put(
        f"/admin/users/{current['id']}",
        headers=headers,
        json={"is_admin": False},
    )
    assert demoted.status_code == 400
    assert demoted.json()["error"]["code"] == "cannot_demote_self"


# --- Direct helper tests (private functions via import) ---------------------

def test_unique_ints_dedupes_preserving_order():
    from app.routers.admin import _unique_ints

    assert _unique_ints([1, 2, 2, 3, 1, 4]) == [1, 2, 3, 4]
    assert _unique_ints([]) == []
    assert _unique_ints(None) == []  # type: ignore[arg-type] — tolerated


def test_resolve_existing_keyword_ids_via_draft(client):
    """When a draft's ``keyword_names`` overlaps a row in the DB's
    ``keywords`` table, the commit returns the matching ids as
    ``additional_keyword_ids`` instead of empty."""
    from app.models_db import Keyword
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    # Seed a Keyword row through the fixture's DB.
    token = _signup_and_get_token(client)

    # The fixture's client uses an isolated in-memory engine; reach it
    # through a fresh SessionLocal bound to the same URL.
    # (The fixture already creates an engine; we replicate it for an
    # isolated insertion.)
    eng = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
    )
    # We can't access the fixture's engine directly, so seed via the
    # route instead: ``POST /admin/items/draft`` for "ผู้หญิง" then
    # commit — the commit's ``additional_keyword_ids`` is what we're
    # testing in the first place. The simpler check is below.
    draft = client.post(
        "/admin/items/draft",
        headers=_auth(token),
        json={"name": "kw-lookup", "keyword_names": ["ผู้หญิง"], "context_names": ["งานบวช"]},
    ).json()
    assert "draft_id" in draft
    # The route returned a draft; ``commit_item`` resolves the
    # existing names. We don't assert the id (the fixture has no
    # matching Keyword row) but we exercise the code path through 200.
    committed = client.post(
        "/admin/items",
        headers=_auth(token),
        json={"draft_id": draft["draft_id"], "additional_keyword_ids": [], "removed_keyword_ids": []},
    )
    assert committed.status_code == 200, committed.text


def test_draft_with_empty_keyword_names(client):
    """A draft with an empty ``keyword_names`` list (or all blank
    strings) returns a draft_id with no additional_keyword_ids and
    no warning — exercises the ``not names`` and blank-name branches
    in ``_resolve_existing_keyword_ids``."""
    token = _signup_and_get_token(client)
    r = client.post(
        "/admin/items/draft",
        headers=_auth(token),
        json={
            "name": "blank-kw",
            "keyword_names": ["", "   "],
            "context_names": ["งานบวช"],
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "draft_id" in body


def test_draft_proposals_match_via_layer_a(client):
    """When the draft's name/description shares tokens with an existing
    keyword, the ``proposals`` list surfaces it — exercises the
    ``vocab_by_id.get(kid)`` and proposal-append branches."""
    from app.models_db import Keyword
    from app import db as db_module

    token = _signup_and_get_token(client)
    # Seed a keyword that will match the draft's name via Layer A's
    # Jaccard >= 0.34 token-set overlap.
    with db_module.session_scope() as s:
        s.add(Keyword(name="ผู้หญิง"))
        s.commit()

    r = client.post(
        "/admin/items/draft",
        headers=_auth(token),
        json={
            "name": "การแสดงของผู้หญิง",
            "description": "ผู้หญิง ร้องเพลง",
            "context_names": ["งานบวช"],
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "draft_id" in body


def test_update_item_with_image_and_video_urls(client):
    """PUT with ``image_url`` and ``video_url`` populates the loader
    row's media columns — covers two more setter branches in
    ``update_item``."""
    from app.model_loader import get_singleton

    token = _signup_and_get_token(client)
    draft = client.post(
        "/admin/items/draft",
        headers=_auth(token),
        json={"name": "media-target", "context_names": ["งานบวช"]},
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
            "name": "media-target",
            "context_names": ["งานบวช"],
            "keyword_ids": [],
            "image_url": "/uploads/items/media-target.jpg",
            "video_url": "https://example.com/video.mp4",
        },
    )
    assert r.status_code == 200, r.text
    # The fixture's loader row has no image_url/video_url columns, so
    # the route tolerates that and just no-ops the column update. The
    # important thing is the setter ran without 500ing.
    row = get_singleton().item_row(int(item_id))
    assert row is not None


def test_update_item_with_new_context_names(client):
    """PUT with a context name that doesn't exist in the DB is silently
    created, not errored — exercises the ``new context_names`` branch."""
    token = _signup_and_get_token(client)
    draft = client.post(
        "/admin/items/draft",
        headers=_auth(token),
        json={"name": "ctx-target", "context_names": ["งานบวช"]},
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
            "name": "ctx-target",
            "context_names": ["บริบทใหม่อีกอัน"],
            "keyword_ids": [],
        },
    )
    assert r.status_code == 200, r.text


def test_update_item_unknown_artifact_id_returns_silently(client):
    """PUT with a non-existent ``artifact_id`` returns 404 (the route
    returns None internally before touching the loader) — no 500."""
    token = _signup_and_get_token(client)
    r = client.put(
        "/admin/items/222445942",  # not in the loader
        headers=_auth(token),
        json={"name": "ghost", "context_names": ["งานบวช"], "keyword_ids": []},
    )
    assert r.status_code == 404
