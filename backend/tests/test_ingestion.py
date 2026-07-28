"""Tests for ``services.ingestion.ingest_new_item``.

The orchestrator wires DB + embedding + ArtifactLoader + lock together.
We mock the embedding so tests don't download a 2.5 GB model.
"""
from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

import numpy as np
import pandas as pd
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app import services
from app.core.config import reset_settings_cache
from app.db import is_db_enabled, reset_engine
from app.models_db import Base, Context, Item, ItemContext, ItemKeyword
from app.model_loader import ArtifactLoader, get_lock, set_singleton, reset_singleton
from app.services import ingestion
from app.services.embedding import reset_model_cache


@pytest.fixture
def db_engine(monkeypatch) -> Iterator[Session]:
    """In-memory SQLite + Base.metadata.create_all + monkeypatch session_scope.

    Patches BOTH ``app.db.session_scope`` and ``services.ingestion.session_scope``
    so ingestion sees the same engine.
    """
    reset_settings_cache()
    monkeypatch.setenv("RECSYS_DB_ENABLED", "1")
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
    return loader


def _fake_embed(item_or_text, kw_names=None, ctx_names=None):
    # ``ingestion.ingest_new_item`` calls ``emb.encode_item_text`` with a
    # dict (item). ``encode_item_text`` itself passes the text to
    # ``encode_text``. Patch both; the dict branch is what we hit here.
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
    # ingestion.py uses ``emb.encode_item_text`` (alias for embedding module).
    monkeypatch.setattr(services.ingestion.emb, "encode_item_text", _fake_embed)
    monkeypatch.setattr(services.ingestion.emb, "encode_text", _fake_embed)
    loader = _fake_loader()
    set_singleton(loader)
    yield loader
    reset_singleton()


def _create_schema_item(name: str = "ระบำพรหมาสตร์") -> Item:
    return Item(
        name=name,
        description="",
        category_group="",
        performance_type="",
        performers_count=0,
        duration_minutes=0,
        price_text="",
        image_url="",
        video_url="",
        is_active=True,
        artifact_item_id=222445941,
    )


# --- Happy path ----------------------------------------------------------


def test_ingest_inserts_db_and_appends_loader(db_engine, loader):
    with db_engine.connect() as conn:
        before_items = conn.execute(_items_count()).scalar()

    from app.schemas.admin import ItemCreate

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
    assert result.django_id > 0

    # DB row inserted.
    with db_engine.connect() as conn:
        count = conn.execute(_items_count()).scalar()
        assert count == before_items + 1

    # Loader appended.
    assert len(loader.item_ids) == 2
    assert loader.metadata.get("item_count") == 2
    # Embedding dim preserved.
    assert loader.embeddings.shape[1] == 4


def test_ingest_rejects_duplicate_name(db_engine, loader):
    # Pre-seed an Item with the same name.
    with Session(db_engine) as s:
        s.add(_create_schema_item("ซ้ำ"))
        s.commit()

    from app.schemas.admin import ItemCreate
    from app.core.exceptions import InvalidRequestError

    item_create = ItemCreate(name="ซ้ำ", context_names=[], keyword_ids=[])
    with pytest.raises(InvalidRequestError):
        ingestion.ingest_new_item(item_create)


def test_ingest_rejects_empty_name(db_engine, loader):
    from app.schemas.admin import ItemCreate
    from app.core.exceptions import InvalidRequestError

    item_create = ItemCreate(name="   ", context_names=[], keyword_ids=[])
    with pytest.raises(InvalidRequestError):
        ingestion.ingest_new_item(item_create)


def test_ingest_creates_missing_context(db_engine, loader):
    from app.schemas.admin import ItemCreate

    item_create = ItemCreate(name="X-Y-Z", context_names=["บริบทใหม่"], keyword_ids=[])
    result = ingestion.ingest_new_item(item_create)
    assert any("Created missing context" in w for w in result.warnings)
    with Session(db_engine) as s:
        ctx = s.query(Context).filter(Context.name == "บริบทใหม่").one()
        assert ctx.id is not None


def test_ingest_db_disabled_short_circuits(db_engine, loader, monkeypatch):
    from app.schemas.admin import ItemCreate
    from app.core.exceptions import InvalidRequestError

    monkeypatch.setattr(services.ingestion, "is_db_enabled", lambda: False)
    item_create = ItemCreate(name="X", context_names=[], keyword_ids=[])
    with pytest.raises(InvalidRequestError):
        ingestion.ingest_new_item(item_create)


def test_ingest_loader_not_loaded(db_engine, monkeypatch):
    """``ingest_new_item`` rejects requests when ArtifactLoader isn't loaded.

    Fixture order matters: the ``loader`` fixture sets a populated
    singleton, so we explicitly reset it AFTER acquiring the fixture.
    """
    from app.schemas.admin import ItemCreate
    from app.core.exceptions import ArtifactsNotLoadedError
    from app.model_loader import reset_singleton

    # Loader fixture has already populated the singleton; tear it down.
    reset_singleton()
    monkeypatch.setattr(services.ingestion, "is_db_enabled", lambda: True)
    item_create = ItemCreate(name="X", context_names=[], keyword_ids=[])
    # ingestion calls get_singleton() which raises ArtifactsNotLoadedError
    # before reaching its own is_loaded check.
    with pytest.raises(ArtifactsNotLoadedError):
        ingestion.ingest_new_item(item_create)


def test_ingest_with_keyword_ids_writes_join_rows(db_engine, loader):
    # Pre-seed a Keyword row.
    from app.models_db import Keyword
    with Session(db_engine) as s:
        kw = Keyword(name="ทดสอบ", taxonomy_node_id=None)
        s.add(kw)
        s.commit()
        kid = int(kw.id)

    from app.schemas.admin import ItemCreate
    item_create = ItemCreate(
        name="มีคีย์เวิร์ด",
        context_names=[],
        keyword_ids=[kid],
    )
    result = ingestion.ingest_new_item(item_create)
    with Session(db_engine) as s:
        rows = s.query(ItemKeyword).filter(
            ItemKeyword.item_id == result.django_id
        ).all()
        assert len(rows) == 1
        assert rows[0].source == "admin"


def _items_count():
    from sqlalchemy import text
    return text("SELECT COUNT(*) FROM items")