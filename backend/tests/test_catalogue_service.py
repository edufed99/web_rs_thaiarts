"""Unit and integration tests for app.services.catalogue."""
from __future__ import annotations

import time
from contextlib import contextmanager
from datetime import datetime, timezone

import pandas as pd
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.exceptions import ContextNotFoundError, ItemNotFoundError
from app.models_db import Base, Context, Item, ItemContext, ItemKeyword, Keyword, Like, Rating, SavedItem, TaxonomyNode
from app.services import catalogue
from app.services.catalogue import CatalogueModule
from tests.conftest import context_id, item_id


@pytest.fixture
def mock_db_scope(monkeypatch):
    eng = create_engine(
        "sqlite:///:memory:?check_same_thread=False",
        future=True,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(eng)
    SessionLocal = sessionmaker(bind=eng, expire_on_commit=False, future=True)

    rabam_aid = item_id("ระบำพรหมาสตร์")
    khon_aid = item_id("โขน")
    dab_aid = 998877

    with SessionLocal() as s:
        s.add_all([
            Context(id=1, name="งานบวช", group_name="พิธีกรรม", description="พิธีงานบวช"),
            Context(id=2, name="งานเลี้ยง", group_name="บันเทิง", description="งานเลี้ยงรื่นเริง"),
            TaxonomyNode(id=1, name="ผู้แสดง", level=1, parent_id=None),
            TaxonomyNode(id=2, name="หญิง", level=2, parent_id=1),
            Keyword(id=10, name="ผู้หญิง", taxonomy_node_id=2),
            Keyword(id=11, name="รำ", taxonomy_node_id=None),
            Item(
                id=1,
                artifact_item_id=rabam_aid,
                name="ระบำพรหมาสตร์",
                description="คำอธิบายของ ระบำพรหมาสตร์",
                category_group="ระบำ",
                performance_type="การแสดง",
                performers_count=5,
                duration_minutes=30,
                price_text="5000",
                image_url="/img/rabam.jpg",
                video_url="/vid/rabam.mp4",
                is_active=True,
            ),
            Item(
                id=2,
                artifact_item_id=khon_aid,
                name="โขน",
                description="การแสดงโขนเรื่องรามเกียรติ์",
                category_group="โขน",
                performance_type="การแสดง",
                performers_count=10,
                duration_minutes=60,
                price_text="10000",
                image_url="/img/khon.jpg",
                video_url="",
                is_active=True,
            ),
            Item(
                id=3,
                artifact_item_id=dab_aid,
                name="ดาบสองมือ",
                description="ฟันดาบ",
                category_group="กระบี่กระบอง",
                performance_type="ศิลปะการต่อสู้",
                performers_count=2,
                duration_minutes=15,
                price_text="3000",
                is_active=False,
            ),
            ItemContext(id=1, item_id=1, context_id=1),
            ItemContext(id=2, item_id=2, context_id=1),
            ItemKeyword(id=1, item_id=1, keyword_id=10),
            ItemKeyword(id=2, item_id=2, keyword_id=11),
            Like(user_key="u1", item_id=1, created_at=datetime.now(timezone.utc)),
            SavedItem(user_key="u1", item_id=1, created_at=datetime.now(timezone.utc)),
            Rating(user_key="u1", item_id=1, rating=5, created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc)),
        ])
        s.commit()

    @contextmanager
    def fake_scope():
        sess = SessionLocal()
        try:
            yield sess
            sess.commit()
        finally:
            sess.close()

    from app import db as db_module
    from app.services import db_query as dbq_module

    monkeypatch.setattr(db_module, "session_scope", fake_scope)
    monkeypatch.setattr(db_module, "is_db_enabled", lambda: True)
    monkeypatch.setattr(dbq_module, "session_scope", fake_scope)
    monkeypatch.setattr(dbq_module, "is_db_enabled", lambda: True)
    monkeypatch.setattr(catalogue, "session_scope", fake_scope)
    monkeypatch.setattr(catalogue, "is_db_enabled", lambda: True)
    catalogue.invalidate_db_item_rows_cache()

    yield {
        "rabam_aid": rabam_aid,
        "khon_aid": khon_aid,
        "dab_aid": dab_aid,
        "SessionLocal": SessionLocal,
    }

    catalogue.invalidate_db_item_rows_cache()
    eng.dispose()


def test_clean_int():
    assert catalogue._clean_int(123) == 123
    assert catalogue._clean_int("456") == 456
    assert catalogue._clean_int(None) is None
    assert catalogue._clean_int(float("nan")) is None
    assert catalogue._clean_int("invalid") is None


def test_search_terms():
    assert catalogue._search_terms(None) == []
    assert catalogue._search_terms("") == []
    assert catalogue._search_terms("โขน | ระบำ") == ["โขน", "ระบำ"]


def test_parse_engagement_range_days():
    assert catalogue._parse_engagement_range_days("all") is None
    assert catalogue._parse_engagement_range_days("all-time") is None
    assert catalogue._parse_engagement_range_days("7d") == 7
    assert catalogue._parse_engagement_range_days("30d") == 30
    assert catalogue._parse_engagement_range_days("90d") == 90
    assert catalogue._parse_engagement_range_days("365d") == 365
    assert catalogue._parse_engagement_range_days("unknown") is None


def test_get_item_from_db(mock_db_scope, loader):
    aid = mock_db_scope["rabam_aid"]
    item = catalogue.get_item(loader, aid, user_key="u1")
    assert item is not None
    assert item.id == aid
    assert item.name == "ระบำพรหมาสตร์"
    assert item.image_url == "/img/rabam.jpg"
    assert len(item.keywords) == 1
    assert item.keywords[0].taxonomy_path == "ผู้แสดง > หญิง"
    assert len(item.contexts) == 1
    assert item.contexts[0].name == "งานบวช"


def test_get_item_not_found(mock_db_scope, loader):
    item = catalogue.get_item(loader, 999999)
    assert item is None


def test_get_item_artifact_fallback(monkeypatch, loader):
    monkeypatch.setattr(catalogue, "session_scope", lambda: None)
    monkeypatch.setattr(catalogue, "is_db_enabled", lambda: False)
    catalogue.invalidate_db_item_rows_cache()

    aid = item_id("ระบำพรหมาสตร์")
    item = catalogue.get_item(loader, aid)
    assert item is not None
    assert item.id == aid
    assert item.name == "ระบำพรหมาสตร์"


def test_list_items_db(mock_db_scope, loader):
    res = catalogue.list_items(loader, limit=10, offset=0)
    assert res.total == 2  # rabam and khon are active, dab is inactive
    assert len(res.items) == 2


def test_list_items_db_search(mock_db_scope, loader):
    res = catalogue.list_items(loader, search="โขน")
    assert res.total == 1
    assert res.items[0].name == "โขน"


def test_list_items_db_ranked_context(mock_db_scope, loader):
    ctx_id = context_id("งานบวช")
    res = catalogue.list_items(loader, context=ctx_id)
    assert res.total == 2
    assert all(it.match_percent is not None for it in res.items)
    assert all(it.suitability_label is not None for it in res.items)


def test_list_items_db_unknown_context_raises(mock_db_scope, loader):
    with pytest.raises(ContextNotFoundError):
        catalogue.list_items(loader, context=999999)


def test_list_items_artifact_fallback(monkeypatch, loader):
    monkeypatch.setattr(catalogue, "session_scope", lambda: None)
    monkeypatch.setattr(catalogue, "is_db_enabled", lambda: False)
    catalogue.invalidate_db_item_rows_cache()

    res = catalogue.list_items(loader, limit=2)
    assert res.total == 5
    assert len(res.items) == 2

    # ranked context in artifact mode
    ctx_id = context_id("งานบวช")
    res_ctx = catalogue.list_items(loader, context=ctx_id)
    assert res_ctx.total >= 1

    with pytest.raises(ContextNotFoundError):
        catalogue.list_items(loader, context=999999)


def test_get_items_batch_db(mock_db_scope, loader):
    ids = [mock_db_scope["khon_aid"], mock_db_scope["rabam_aid"]]
    items = catalogue.get_items_batch(loader, ids)
    assert len(items) == 2
    assert [it.id for it in items] == ids


def test_get_items_batch_empty(loader):
    assert catalogue.get_items_batch(loader, []) == []


def test_get_items_batch_artifact(monkeypatch, loader):
    monkeypatch.setattr(catalogue, "session_scope", lambda: None)
    monkeypatch.setattr(catalogue, "is_db_enabled", lambda: False)
    catalogue.invalidate_db_item_rows_cache()

    ids = [item_id("ลิเก"), item_id("โขน")]
    items = catalogue.get_items_batch(loader, ids)
    assert len(items) == 2
    assert [it.id for it in items] == ids


def test_get_similar_items(mock_db_scope, loader):
    aid = mock_db_scope["rabam_aid"]
    similar = catalogue.get_similar_items(loader, aid, limit=1)
    assert len(similar) == 1
    assert similar[0].id != aid


def test_get_similar_items_unknown_raises(loader):
    with pytest.raises(ItemNotFoundError):
        catalogue.get_similar_items(loader, 999999)


def test_engagement_methods(mock_db_scope, loader):
    aid = mock_db_scope["rabam_aid"]

    single = catalogue.get_item_engagement(loader, aid)
    assert single is not None
    assert single.item_id == aid
    assert single.like_count == 1
    assert single.save_count == 1
    assert single.rating_count == 1
    assert single.engagement_score == 3

    # Unknown item in DB
    single_unk = catalogue.get_item_engagement(loader, 88888)
    assert single_unk is not None
    assert single_unk.engagement_score == 0

    listed = catalogue.list_item_engagement(loader, limit=10)
    assert listed.source == "postgres"
    assert len(listed.engagements) >= 1

    batch = catalogue.get_items_engagement(loader, [aid, 88888])
    assert batch.source == "postgres"
    assert len(batch.engagements) == 2


def test_engagement_methods_db_disabled(monkeypatch, loader):
    monkeypatch.setattr(catalogue, "is_db_enabled", lambda: False)

    assert catalogue.get_item_engagement(loader, 1) is None
    assert catalogue.list_item_engagement(loader).source == "disabled"
    assert catalogue.get_items_engagement(loader, [1, 2]).source == "disabled"
    assert catalogue.get_items_engagement(loader, []).source == "disabled"


def test_get_item_facets_db(mock_db_scope, loader):
    facets = catalogue.get_item_facets(loader)
    assert facets.source == "db"
    assert "ระบำ" in facets.category_groups
    assert "โขน" in facets.category_groups
    assert "การแสดง" in facets.performance_types


def test_get_item_facets_artifact_fallback(monkeypatch, loader):
    monkeypatch.setattr(catalogue, "session_scope", lambda: None)
    catalogue.invalidate_db_item_rows_cache()

    facets = catalogue.get_item_facets(loader)
    assert facets.source == "artifact"
    assert len(facets.category_groups) > 0


def test_catalogue_module_facade(mock_db_scope, loader):
    aid = mock_db_scope["rabam_aid"]
    assert CatalogueModule.get_item(loader, aid) is not None
    assert CatalogueModule.list_items(loader, limit=5).total >= 1
    assert len(CatalogueModule.get_items_batch(loader, [aid])) == 1
    assert len(CatalogueModule.get_similar_items(loader, aid, limit=1)) == 1
    assert CatalogueModule.get_item_engagement(loader, aid) is not None
    assert CatalogueModule.list_item_engagement(loader).source == "postgres"
    assert CatalogueModule.get_items_engagement(loader, [aid]).source == "postgres"
    assert CatalogueModule.get_item_facets(loader).source == "db"
    CatalogueModule.invalidate_cache()
