"""
Tests for ``services.ingestion`` — deep item ingestion lifecycle module.

Covers:
* ``draft_item`` (Layer A + Layer B grounding + draft store)
* ``commit_item`` (draft consumption + merge + vector embedding + DB transaction + loader append)
* ``reassign_item_keywords`` (join-row replacement + loader sync)
* ``update_item`` (item fields + contexts + keywords + loader sync)
* ``delete_item`` (cascade unlinking + item delete + loader inactive flag)
* ``attach_item_image`` & ``attach_item_video`` (upload + persistence + loader sync)
* ``update_loader_row``, ``invalidate_catalog_cache``, and helpers
"""
from __future__ import annotations

import io
import time
from contextlib import contextmanager
from typing import Iterator

import numpy as np
import pandas as pd
import pytest
from fastapi import UploadFile
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app import services
from app.core.config import reset_settings_cache, get_settings
from app.core.exceptions import (
    ArtifactsNotLoadedError,
    InvalidRequestError,
    ItemNotFoundError,
)
from app.db import reset_engine
from app.models_db import (
    Base,
    Context,
    InteractionLog,
    Item,
    ItemContext,
    ItemKeyword,
    Keyword,
    Like,
    Rating,
    SavedItem,
)
from app.model_loader import ArtifactLoader, reset_singleton, set_singleton
from app.schemas.admin import (
    ItemCommit,
    ItemCreate,
    ItemDraft,
    ItemKeywordReassign,
    ItemUpdate,
)
from app.services import grounding, ingestion
from app.services.embedding import reset_model_cache


_TINY_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


@pytest.fixture
def db_engine(monkeypatch) -> Iterator[Session]:
    """In-memory SQLite + Base.metadata.create_all + monkeypatch session_scope."""
    reset_settings_cache()
    monkeypatch.setenv("RECSYS_DB_ENABLED", "1")
    monkeypatch.setenv("RECSYS_GEMINI_API_KEY", "")
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

    monkeypatch.setattr("app.db.session_scope", _scope)
    monkeypatch.setattr(services.ingestion, "session_scope", _scope)
    monkeypatch.setattr("app.db.is_db_enabled", lambda: True)
    monkeypatch.setattr(services.ingestion, "is_db_enabled", lambda: True)
    yield engine
    engine.dispose()


def _fake_loader() -> ArtifactLoader:
    loader = ArtifactLoader()
    loader._items = pd.DataFrame(
        [
            {
                "item_id": 222445941,
                "name": "ระบำพรหมาสตร์",
                "description": "การแสดงโขนระบำ",
                "category_group": "ระบำ",
                "performance_type": "การแสดง",
                "performers_count": 5,
                "duration_minutes": 20,
                "price_text": "500",
                "is_active": True,
                "keyword_names": ["โขน", "ผู้หญิง"],
                "context_names": ["งานบวช"],
                "taxonomy_paths": ["", ""],
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
    return loader


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
def loader(monkeypatch):
    reset_singleton()
    reset_model_cache()
    ingestion.reset_draft_store()
    grounding.reset_vocab_cache()
    monkeypatch.setattr(services.ingestion.emb, "encode_item_text", _fake_embed)
    monkeypatch.setattr(services.ingestion.emb, "encode_text", _fake_embed)
    ldr = _fake_loader()
    set_singleton(ldr)
    yield ldr
    reset_singleton()
    ingestion.reset_draft_store()
    grounding.reset_vocab_cache()


def _seed_db_item(db_engine, name="ระบำพรหมาสตร์", artifact_id=222445941) -> int:
    with Session(db_engine) as s:
        it = Item(
            name=name,
            description="คำอธิบาย",
            category_group="ระบำ",
            performance_type="การแสดง",
            performers_count=5,
            duration_minutes=20,
            price_text="500",
            image_url="",
            video_url="",
            is_active=True,
            artifact_item_id=artifact_id,
        )
        s.add(it)
        s.commit()
        return int(it.id)


# --- draft_item tests -------------------------------------------------------


def test_draft_item_generates_proposals_and_saves_draft(db_engine, loader):
    draft_payload = ItemDraft(
        name="ระบำพรหมาสตร์",
        description="การแสดงโขน",
        category_group="ระบำ",
        performance_type="การแสดง",
        context_names=["งานบวช", "บริบทใหม่"],
        keyword_names=["", "  "],
    )
    res = ingestion.draft_item(draft_payload, loader=loader)
    assert res.draft_id is not None
    assert len(res.draft_id) > 0
    assert len(res.context_ids) == 2
    assert any("Created missing context" in w for w in res.warnings)
    # Check draft stored
    with ingestion._drafts_lock:
        assert res.draft_id in ingestion._drafts


def test_draft_item_with_keyword_names_resolution(db_engine, loader):
    # Pre-seed a keyword in DB
    with Session(db_engine) as s:
        kw = Keyword(name="ผู้หญิง")
        s.add(kw)
        s.commit()

    draft_payload = ItemDraft(
        name="ทดสอบ",
        description="",
        context_names=[],
        keyword_names=["ผู้หญิง", "ไม่มี"],
    )
    res = ingestion.draft_item(draft_payload, loader=loader)
    assert res.draft_id is not None
    with ingestion._drafts_lock:
        stored = ingestion._drafts[res.draft_id]
        assert len(stored["additional_keyword_ids"]) == 1


def test_draft_item_with_layer_b_llm(db_engine, loader, monkeypatch):
    monkeypatch.setattr(get_settings(), "gemini_api_key", "test-key", raising=False)
    monkeypatch.setattr(get_settings(), "grounding_use_llm", True, raising=False)
    monkeypatch.setattr(
        grounding, "_call_gemini", lambda *a, **kw: '{"names": ["โขน"]}'
    )
    draft_payload = ItemDraft(
        name="ระบำใหม่",
        description="",
        context_names=[],
    )
    res = ingestion.draft_item(draft_payload, loader=loader)
    assert any(p.source == "llm" for p in res.proposals)


def test_draft_item_when_db_disabled(loader, monkeypatch):
    monkeypatch.setattr(ingestion, "is_db_enabled", lambda: False)
    draft_payload = ItemDraft(name="ไม่ใช้ดีบี", context_names=["งานบวช"])
    res = ingestion.draft_item(draft_payload, loader=loader)
    assert res.draft_id is not None
    assert res.context_ids == []


# --- commit_item tests ------------------------------------------------------


def test_commit_item_success(db_engine, loader):
    # Create draft first
    draft_payload = ItemDraft(
        name="โขนรามเกียรติ์",
        description="การแสดงโขนชั้นสูง",
        category_group="โขน",
        performance_type="นาฏศิลป์",
        context_names=["งานมงคล"],
    )
    draft_out = ingestion.draft_item(draft_payload, loader=loader)

    commit_payload = ItemCommit(
        draft_id=draft_out.draft_id,
        additional_keyword_ids=[],
        removed_keyword_ids=[],
    )
    commit_out = ingestion.commit_item(commit_payload, loader=loader)
    assert commit_out.item.name == "โขนรามเกียรติ์"
    assert len(loader.item_ids) == 2


def test_commit_item_merges_and_excludes_keywords(db_engine, loader):
    # Seed keywords
    with Session(db_engine) as s:
        kw1 = Keyword(name="คีย์1")
        kw2 = Keyword(name="คีย์2")
        kw3 = Keyword(name="คีย์3")
        s.add_all([kw1, kw2, kw3])
        s.commit()
        kid1, kid2, kid3 = int(kw1.id), int(kw2.id), int(kw3.id)

    draft_id = ingestion._save_draft(
        {
            "name": "ไอเท็มใหม่",
            "description": "คำอธิบาย",
            "layer_a_ids": [kid1, kid2],
            "layer_b_ids": [],
            "additional_keyword_ids": [],
            "context_names": [],
        }
    )
    commit_payload = ItemCommit(
        draft_id=draft_id,
        additional_keyword_ids=[kid3],
        removed_keyword_ids=[kid2],
    )
    commit_out = ingestion.commit_item(commit_payload, loader=loader)
    assert commit_out.item.name == "ไอเท็มใหม่"

    # Verify ItemKeyword rows in DB
    with Session(db_engine) as s:
        rows = s.execute(select(ItemKeyword.keyword_id)).scalars().all()
        assert set(rows) == {kid1, kid3}


def test_commit_item_unknown_draft_raises(loader):
    commit_payload = ItemCommit(
        draft_id="unknown-1234",
        additional_keyword_ids=[],
        removed_keyword_ids=[],
    )
    with pytest.raises(InvalidRequestError) as exc:
        ingestion.commit_item(commit_payload, loader=loader)
    assert exc.value.extra["code"] == "unknown_draft"


def test_commit_item_expired_draft_raises(loader):
    draft_id = ingestion._save_draft({"name": "expired"})
    with ingestion._drafts_lock:
        ingestion._drafts[draft_id]["_expires_at"] = time.time() - 10

    commit_payload = ItemCommit(
        draft_id=draft_id,
        additional_keyword_ids=[],
        removed_keyword_ids=[],
    )
    with pytest.raises(InvalidRequestError) as exc:
        ingestion.commit_item(commit_payload, loader=loader)
    assert exc.value.extra["code"] == "draft_expired"


# --- reassign_item_keywords tests -------------------------------------------


def test_reassign_item_keywords_success(db_engine, loader):
    _seed_db_item(db_engine, "ระบำพรหมาสตร์", 222445941)
    with Session(db_engine) as s:
        kw = Keyword(name="คำค้นใหม่")
        s.add(kw)
        s.commit()
        kid = int(kw.id)

    payload = ItemKeywordReassign(keyword_ids=[kid])
    res = ingestion.reassign_item_keywords(222445941, payload, loader=loader)
    assert res.item.id == 222445941
    # Loader was synchronized
    assert loader._items.loc[0, "keyword_names"] == ["คำค้นใหม่"]


def test_reassign_item_keywords_not_found(db_engine, loader):
    payload = ItemKeywordReassign(keyword_ids=[1])
    with pytest.raises(InvalidRequestError) as exc:
        ingestion.reassign_item_keywords(9999999, payload, loader=loader)
    assert exc.value.extra["code"] == "item_not_found"


def test_reassign_item_keywords_db_disabled(loader, monkeypatch):
    monkeypatch.setattr(ingestion, "is_db_enabled", lambda: False)
    payload = ItemKeywordReassign(keyword_ids=[1])
    with pytest.raises(InvalidRequestError) as exc:
        ingestion.reassign_item_keywords(123, payload, loader=loader)
    assert exc.value.extra["code"] == "db_disabled"


# --- update_item tests ------------------------------------------------------


def test_update_item_scalars_and_contexts_and_keywords(db_engine, loader):
    _seed_db_item(db_engine, "ระบำพรหมาสตร์", 222445941)
    with Session(db_engine) as s:
        kw = Keyword(name="คีย์เดิม")
        s.add(kw)
        s.commit()
        kid = int(kw.id)

    payload = ItemUpdate(
        name="ระบำพรหมาสตร์ (แก้ไข)",
        description="อัปเดตคำอธิบาย",
        category_group="ระบำใหม่",
        performance_type="โขนใหม่",
        performers_count=10,
        duration_minutes=45,
        price_text="1200",
        image_url="/img/new.jpg",
        video_url="/vid/new.mp4",
        is_active=True,
        context_names=["งานฉลอง"],
        keyword_ids=[kid],
        new_keyword_names=["คีย์สร้างใหม่"],
    )
    res = ingestion.update_item(222445941, payload, loader=loader)
    assert res.item.name == "ระบำพรหมาสตร์ (แก้ไข)"
    assert res.item.description == "อัปเดตคำอธิบาย"
    assert res.item.image_url == "/img/new.jpg"
    assert res.item.video_url == "/vid/new.mp4"
    assert any("Created missing context" in w for w in res.warnings)
    assert any("Created keyword" in w for w in res.warnings)

    # Verify loader dataframe updated
    assert loader._items.loc[0, "name"] == "ระบำพรหมาสตร์ (แก้ไข)"
    assert loader._items.loc[0, "context_names"] == ["งานฉลอง"]
    assert set(loader._items.loc[0, "keyword_names"]) == {"คีย์เดิม", "คีย์สร้างใหม่"}


def test_update_item_keyword_too_long_raises(db_engine, loader):
    _seed_db_item(db_engine, "ระบำพรหมาสตร์", 222445941)
    payload = ItemUpdate(new_keyword_names=["A" * 256])
    with pytest.raises(InvalidRequestError) as exc:
        ingestion.update_item(222445941, payload, loader=loader)
    assert exc.value.extra["code"] == "keyword_name_too_long"


def test_update_item_not_found_raises(db_engine, loader):
    payload = ItemUpdate(name="ชื่อ")
    with pytest.raises(ItemNotFoundError):
        ingestion.update_item(9999999, payload, loader=loader)


def test_update_item_db_disabled_raises(loader, monkeypatch):
    monkeypatch.setattr(ingestion, "is_db_enabled", lambda: False)
    payload = ItemUpdate(name="ชื่อ")
    with pytest.raises(InvalidRequestError) as exc:
        ingestion.update_item(123, payload, loader=loader)
    assert exc.value.extra["code"] == "db_disabled"


# --- delete_item tests ------------------------------------------------------


def test_delete_item_success(db_engine, loader):
    db_id = _seed_db_item(db_engine, "ระบำพรหมาสตร์", 222445941)
    # Seed join rows and logs
    with Session(db_engine) as s:
        ctx = Context(name="บริบท")
        kw = Keyword(name="คำค้น")
        s.add_all([ctx, kw])
        s.flush()
        s.add(ItemContext(item_id=db_id, context_id=int(ctx.id), validity_status="valid"))
        s.add(ItemKeyword(item_id=db_id, keyword_id=int(kw.id), source="admin"))
        s.add(Like(user_key="anon:1", item_id=db_id))
        s.add(SavedItem(user_key="anon:1", item_id=db_id))
        s.add(Rating(user_key="anon:1", item_id=db_id, rating=5))
        s.add(InteractionLog(user_key="anon:1", item_id=db_id, action_type="click"))
        s.commit()

    res = ingestion.delete_item(222445941, loader=loader)
    assert res.deleted is True
    assert res.item_id == 222445941

    # Verify item and join rows deleted
    with Session(db_engine) as s:
        assert s.execute(select(Item)).scalar_one_or_none() is None
        assert s.execute(select(ItemKeyword)).scalar_one_or_none() is None
        assert s.execute(select(ItemContext)).scalar_one_or_none() is None
        assert s.execute(select(Like)).scalar_one_or_none() is None
        assert s.execute(select(SavedItem)).scalar_one_or_none() is None
        assert s.execute(select(Rating)).scalar_one_or_none() is None
        log = s.execute(select(InteractionLog)).scalar_one_or_none()
        assert log is not None
        assert log.item_id is None

    # Verify loader marked inactive
    assert not bool(loader._items.loc[0, "is_active"])


def test_delete_item_not_found_raises(db_engine, loader):
    with pytest.raises(InvalidRequestError) as exc:
        ingestion.delete_item(9999999, loader=loader)
    assert exc.value.extra["code"] == "item_not_found"


def test_delete_item_db_disabled_raises(loader, monkeypatch):
    monkeypatch.setattr(ingestion, "is_db_enabled", lambda: False)
    with pytest.raises(InvalidRequestError) as exc:
        ingestion.delete_item(123, loader=loader)
    assert exc.value.extra["code"] == "db_disabled"


# --- attach_item_image and attach_item_video tests --------------------------


def test_attach_item_image_success(db_engine, loader, tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), "upload_dir", tmp_path)
    _seed_db_item(db_engine, "ระบำพรหมาสตร์", 222445941)

    file = UploadFile(
        filename="test.png",
        file=io.BytesIO(_TINY_PNG),
        headers={"content-type": "image/png"},
    )
    res = ingestion.attach_item_image(222445941, file, loader=loader)
    assert res.item_id == 222445941
    assert res.url.startswith("/uploads/items/222445941_")
    assert res.mime == "image/png"


def test_attach_item_image_not_found(db_engine, loader, tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), "upload_dir", tmp_path)
    file = UploadFile(
        filename="test.png",
        file=io.BytesIO(_TINY_PNG),
        headers={"content-type": "image/png"},
    )
    with pytest.raises(InvalidRequestError) as exc:
        ingestion.attach_item_image(9999999, file, loader=loader)
    assert exc.value.extra["code"] == "item_not_found"


def test_attach_item_image_db_disabled(loader, monkeypatch):
    monkeypatch.setattr(ingestion, "is_db_enabled", lambda: False)
    file = UploadFile(filename="test.png", file=io.BytesIO(b""))
    with pytest.raises(InvalidRequestError) as exc:
        ingestion.attach_item_image(123, file, loader=loader)
    assert exc.value.extra["code"] == "db_disabled"


def test_attach_item_video_success(db_engine, loader, tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), "upload_dir", tmp_path)
    _seed_db_item(db_engine, "ระบำพรหมาสตร์", 222445941)

    tiny_mp4 = b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isommp41" + b"video-data"
    file = UploadFile(
        filename="sample.mp4",
        file=io.BytesIO(tiny_mp4),
        headers={"content-type": "video/mp4"},
    )
    res = ingestion.attach_item_video(222445941, file, loader=loader)
    assert res.item_id == 222445941
    assert res.url.startswith("/uploads/items/222445941_video_")
    assert res.mime == "video/mp4"


def test_attach_item_video_not_found(db_engine, loader, tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), "upload_dir", tmp_path)
    tiny_mp4 = b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isommp41" + b"video-data"
    file = UploadFile(
        filename="sample.mp4",
        file=io.BytesIO(tiny_mp4),
        headers={"content-type": "video/mp4"},
    )
    with pytest.raises(InvalidRequestError) as exc:
        ingestion.attach_item_video(9999999, file, loader=loader)
    assert exc.value.extra["code"] == "item_not_found"


def test_attach_item_video_db_disabled(loader, monkeypatch):
    monkeypatch.setattr(ingestion, "is_db_enabled", lambda: False)
    file = UploadFile(filename="sample.mp4", file=io.BytesIO(b""))
    with pytest.raises(InvalidRequestError) as exc:
        ingestion.attach_item_video(123, file, loader=loader)
    assert exc.value.extra["code"] == "db_disabled"


# --- Helpers unit tests -----------------------------------------------------


def test_coerce_int_variants():
    assert ingestion._coerce_int(None) is None
    assert ingestion._coerce_int(10) == 10
    assert ingestion._coerce_int("20") == 20
    assert ingestion._coerce_int("invalid") is None
    assert ingestion._coerce_int(float("nan")) is None


def test_unique_ints():
    assert ingestion._unique_ints(None) == []
    assert ingestion._unique_ints([1, 2, 2, 3, 1, 4]) == [1, 2, 3, 4]


def test_names_for_keyword_ids_empty(db_engine):
    with Session(db_engine) as s:
        assert ingestion._names_for_keyword_ids(s, []) == []


def test_update_loader_row_missing_or_unknown_id(loader):
    # Should safely return without error
    ingestion.update_loader_row(9999999, {"name": "test"}, loader=loader)
    empty_loader = ArtifactLoader()
    ingestion.update_loader_row(222445941, {"name": "test"}, loader=empty_loader)


def test_invalidate_catalog_cache():
    # Should run without error
    ingestion.invalidate_catalog_cache()


def test_reset_draft_store():
    ingestion._save_draft({"key": "val"})
    assert len(ingestion._drafts) > 0
    ingestion.reset_draft_store()
    assert len(ingestion._drafts) == 0


def test_ingest_inserts_db_and_appends_loader(db_engine, loader):
    item_create = ItemCreate(
        name="การแสดงทดสอบ",
        description="ทดสอบ ingestion",
        category_group="ระบำ",
        performance_type="การแสดง",
        context_names=["งานบวช"],
        keyword_ids=[],
    )
    result = ingestion.ingest_new_item(item_create)
    assert result.item.name == "การแสดงทดสอบ"
    assert result.artifact_id > 0
    assert result.db_id > 0
    assert len(loader.item_ids) == 2


def test_ingest_rejects_duplicate_name(db_engine, loader):
    _seed_db_item(db_engine, "ซ้ำ")
    item_create = ItemCreate(name="ซ้ำ", context_names=[], keyword_ids=[])
    with pytest.raises(InvalidRequestError):
        ingestion.ingest_new_item(item_create)


def test_ingest_rejects_empty_name(db_engine, loader):
    item_create = ItemCreate(name="   ", context_names=[], keyword_ids=[])
    with pytest.raises(InvalidRequestError):
        ingestion.ingest_new_item(item_create)


def test_ingest_creates_missing_context(db_engine, loader):
    item_create = ItemCreate(name="X-Y-Z", context_names=["บริบทใหม่"], keyword_ids=[])
    result = ingestion.ingest_new_item(item_create)
    assert any("Created missing context" in w for w in result.warnings)


def test_ingest_db_disabled_short_circuits(db_engine, loader, monkeypatch):
    monkeypatch.setattr(services.ingestion, "is_db_enabled", lambda: False)
    item_create = ItemCreate(name="X", context_names=[], keyword_ids=[])
    with pytest.raises(InvalidRequestError):
        ingestion.ingest_new_item(item_create)


def test_ingest_loader_not_loaded(db_engine, monkeypatch):
    reset_singleton()
    monkeypatch.setattr(services.ingestion, "is_db_enabled", lambda: True)
    item_create = ItemCreate(name="X", context_names=[], keyword_ids=[])
    with pytest.raises(ArtifactsNotLoadedError):
        ingestion.ingest_new_item(item_create)
