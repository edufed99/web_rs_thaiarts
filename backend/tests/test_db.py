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
INMEM_THREAD_URL = "sqlite:///:memory:?check_same_thread=False"


def _stable_artifact_id(name: str) -> int:
    import hashlib

    return int(hashlib.sha256(f"item::{name}".encode("utf-8")).hexdigest()[:7], 16)


def _stable_context_id(name: str) -> int:
    import hashlib

    return int(hashlib.sha256(f"context::{name}".encode("utf-8")).hexdigest()[:7], 16)


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


def test_popularity_weight_deserializes_valid_json():
    from app.models_db import PopularityWeight

    row = PopularityWeight(weights_json='{"saved": 0.3, "rating": 0.7}')
    assert row.weights() == {"saved": 0.3, "rating": 0.7}


def test_popularity_weight_rejects_invalid_or_non_object_json():
    from app.models_db import PopularityWeight

    assert PopularityWeight(weights_json="not-json").weights() == {}
    assert PopularityWeight(weights_json="[]").weights() == {}


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
        for db_id, name in items.items():
            aid = int(hashlib.sha256(f"item::{name}".encode("utf-8")).hexdigest()[:7], 16)
            by_artifact[aid] = db_id
            s.add(Item(
                id=db_id,
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


@pytest.fixture
def db_catalog_client(monkeypatch, artifacts_dir):
    """FastAPI client whose browse endpoints read from an in-memory DB."""
    from app.core import config as config_module
    from app import db as db_module
    from app.main import create_app
    from app.model_loader import reset_singleton
    from app.models_db import (
        Base, Context, Item, ItemContext, ItemKeyword, Keyword, TaxonomyNode,
    )
    from app.routers import catalog as catalog_module
    from app.routers import metrics as metrics_module

    monkeypatch.setenv("RECSYS_ARTIFACT_DIR", str(artifacts_dir))
    monkeypatch.setenv("RECSYS_DB_ENABLED", "1")
    config_module.reset_settings_cache()
    reset_singleton()

    eng = create_engine(
        INMEM_THREAD_URL,
        future=True,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(eng)
    SessionLocal = sessionmaker(bind=eng, expire_on_commit=False, future=True)

    dab_id = _stable_artifact_id("ดาบสองมือ")
    rabam_id = _stable_artifact_id("ระบำพรหมาสตร์")
    khon_id = _stable_artifact_id("โขน")
    with SessionLocal() as s:
        s.add_all([
            Context(id=10, name="งานบวช", group_name="พิธีกรรม", description="พิธีงานบวช"),
            Context(id=11, name="งานเลี้ยงสังสรรค์", group_name="งานเลี้ยง", description="งานสังสรรค์"),
            TaxonomyNode(id=1, name="ผู้แสดง", level=1),
            TaxonomyNode(id=2, name="เพศ", level=2, parent_id=1),
            Keyword(id=100, name="ผู้หญิง", taxonomy_node_id=2),
            Keyword(id=101, name="ดนตรี", taxonomy_node_id=None),
            Keyword(id=102, name="อาวุธ", taxonomy_node_id=1),
            Item(id=501, name="ระบำพรหมาสตร์", description="ระบำ", is_active=True, artifact_item_id=rabam_id),
            Item(id=502, name="โขน", description="โขน", is_active=True, artifact_item_id=khon_id),
            Item(id=503, name="ดาบสองมือ", description="การแสดงอาวุธ", is_active=True, artifact_item_id=dab_id),
            Item(id=504, name="ซ่อนอยู่", description="", is_active=False, artifact_item_id=_stable_artifact_id("ซ่อนอยู่")),
            ItemContext(id=1, item_id=501, context_id=10),
            ItemContext(id=2, item_id=502, context_id=10),
            ItemContext(id=3, item_id=503, context_id=11),
            ItemContext(id=4, item_id=504, context_id=10),
            ItemKeyword(id=1, item_id=501, keyword_id=100),
            ItemKeyword(id=2, item_id=502, keyword_id=101),
            ItemKeyword(id=3, item_id=503, keyword_id=102),
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

    monkeypatch.setattr(db_module, "is_db_enabled", lambda: True)
    monkeypatch.setattr(db_module, "session_scope", fake_scope)
    monkeypatch.setattr(catalog_module, "session_scope", fake_scope)
    monkeypatch.setattr(metrics_module, "session_scope", fake_scope)
    monkeypatch.setattr(catalog_module, "live_user_state_for_items", lambda _user_key, _ids: {})
    db_module.reset_engine()

    app = create_app()
    with TestClient(app) as client:
        yield client, {"dab_id": dab_id, "rabam_id": rabam_id, "khon_id": khon_id}
    eng.dispose()


def test_orm_tables_include_live_action_tables():
    from app.models_db import Base
    table_names = set(Base.metadata.tables.keys())
    assert {"likes", "saved_items", "ratings", "interaction_logs"}.issubset(table_names)


def test_live_user_positive_items_merges_likes_saves_and_high_ratings(sqlite_db_with_live_actions):
    from app.services.db_query import live_user_positive_items
    from app.models_db import Like, Rating, SavedItem

    eng, by_artifact = sqlite_db_with_live_actions
    aid_khon, aid_rabam, aid_like = (
        next(a for a, d in by_artifact.items() if d == 111),
        next(a for a, d in by_artifact.items() if d == 222),
        next(a for a, d in by_artifact.items() if d == 333),
    )

    SessionLocal = sessionmaker(bind=eng, expire_on_commit=False, future=True)
    with SessionLocal() as s:
        s.add(Like(user_key="anon:u1", item_id=by_artifact[aid_khon]))
        s.add(SavedItem(user_key="anon:u1", item_id=by_artifact[aid_rabam]))
        s.add(Rating(user_key="anon:u1", item_id=by_artifact[aid_like], rating=5))
        s.add(Rating(user_key="anon:u1", item_id=by_artifact[aid_khon], rating=2))
        s.commit()

    pos = live_user_positive_items("anon:u1")
    # like on khon, save on rabam, rating 5 on like; rating 2 is negative.
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


def test_db_to_artifact_translation_round_trip(sqlite_db_with_live_actions):
    from app.services.db_query import artifact_id_to_db_id, db_id_to_artifact_id

    eng, by_artifact = sqlite_db_with_live_actions
    aid = next(iter(by_artifact.keys()))
    db_id = by_artifact[aid]
    assert artifact_id_to_db_id(aid) == db_id
    assert db_id_to_artifact_id(db_id) == aid


def test_artifact_ids_to_db_ids_bulk_matches_single(sqlite_db_with_live_actions):
    """The bulk helper must agree with the single-id helper, and skip unknowns."""
    from app.services.db_query import artifact_id_to_db_id, artifact_ids_to_db_ids

    eng, by_artifact = sqlite_db_with_live_actions
    known = list(by_artifact.keys())
    mapping = artifact_ids_to_db_ids(known + [999_999_999])

    assert mapping == {aid: by_artifact[aid] for aid in known}
    for aid in known:
        assert mapping[aid] == artifact_id_to_db_id(aid)
    # Unknown artifact ids are absent rather than mapped to None.
    assert 999_999_999 not in mapping
    assert artifact_ids_to_db_ids([]) == {}


def test_legacy_stats_translates_artifact_id_to_db_id(
    sqlite_db_with_live_actions, artifacts_dir, monkeypatch
):
    """Regression: the endpoint takes an ARTIFACT id, but legacy_interactions
    is keyed by items.id. Passing the artifact id straight through returns
    zeros for every item — which is what this route used to do.
    """
    from app.core.config import reset_settings_cache
    from app.model_loader import reset_singleton
    from app.models_db import Base, Item, LegacyInteraction
    from app.routers import legacy as legacy_module

    eng, by_artifact = sqlite_db_with_live_actions
    artifact_id = next(iter(by_artifact.keys()))
    db_id = by_artifact[artifact_id]
    # fixture's seed: {111: 'แสดงโขน', 222: 'ระบำ', 333: 'ลิเก'}
    seeded_names = {111: "แสดงโขน", 222: "ระบำ", 333: "ลิเก"}

    # Build a fresh thread-safe engine for TestClient (which runs in a worker
    # thread, but the fixture's engine was created on the test thread).
    client_eng = create_engine(
        INMEM_THREAD_URL,
        future=True,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(client_eng)
    client_session = sessionmaker(bind=client_eng, expire_on_commit=False, future=True)

    # Reseed items + legacy rows on the client engine so the lookup chain
    # artifact_id -> db_id -> legacy_interactions stays in one database.
    with client_session() as s:
        for db_id_seeded, name in seeded_names.items():
            # Translate back to that item's artifact id via the fixture map.
            aid_for_seeded = next(
                aid for aid, did in by_artifact.items() if did == db_id_seeded
            )
            s.add(Item(
                id=db_id_seeded,
                name=name,
                is_active=True,
                artifact_item_id=aid_for_seeded,
            ))
        for i, rating in enumerate((4, 5, 3)):
            s.add(LegacyInteraction(
                legacy_user_id=f"legacy:{i}",
                item_id=db_id,
                rating=rating,
                imported_at=datetime(2026, 1, 1),
            ))
        s.commit()

    @contextmanager
    def client_scope():
        sess = client_session()
        try:
            yield sess
            sess.commit()
        finally:
            sess.close()

    def client_engine():
        return client_eng

    monkeypatch.setenv("RECSYS_ARTIFACT_DIR", str(artifacts_dir))
    monkeypatch.setenv("RECSYS_DB_ENABLED", "1")
    monkeypatch.setattr(legacy_module, "is_db_enabled", lambda: True)
    from app.services import db_query as dbq_module
    monkeypatch.setattr(dbq_module, "is_db_enabled", lambda: True)
    monkeypatch.setattr(dbq_module, "session_scope", client_scope)
    reset_settings_cache()
    reset_singleton()

    monkeypatch.setenv("RECSYS_ARTIFACT_DIR", str(artifacts_dir))
    monkeypatch.setenv("RECSYS_DB_ENABLED", "1")
    monkeypatch.setattr(legacy_module, "is_db_enabled", lambda: True)
    reset_settings_cache()
    reset_singleton()

    from app.main import create_app
    with TestClient(create_app()) as c:
        r = c.get(f"/items/{artifact_id}/legacy-stats")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["item_id"] == artifact_id
        assert body["count"] == 3
        assert body["avg_rating"] == pytest.approx(4.0)

        # The raw DB id must NOT be accepted as if it were an artifact id.
        r_wrong = c.get(f"/items/{db_id}/legacy-stats")
        assert r_wrong.json()["count"] == 0

        # Batch form returns one row per requested id, in order, and
        # tolerates unknown ids.
        r_batch = c.get("/legacy-stats", params={"ids": f"{artifact_id},999999999"})
        assert r_batch.status_code == 200, r_batch.text
        stats = r_batch.json()["stats"]
        assert [s["item_id"] for s in stats] == [artifact_id, 999999999]
        assert stats[0]["count"] == 3
        assert stats[0]["avg_rating"] == pytest.approx(4.0)
        assert stats[1]["count"] == 0

        # Junk and duplicate ids are dropped rather than failing the request.
        r_junk = c.get(
            "/legacy-stats",
            params={"ids": f"{artifact_id},,abc,{artifact_id}"},
        )
        assert r_junk.status_code == 200, r_junk.text
        assert [s["item_id"] for s in r_junk.json()["stats"]] == [artifact_id]


# ---------------------------------------------------------------------------
# DB-backed catalog/keyword API
# ---------------------------------------------------------------------------


def test_items_endpoint_prefers_db_catalog(db_catalog_client):
    client, ids = db_catalog_client
    r = client.get("/items", params={"limit": 200, "user_key": "anon:db"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 3
    names = {item["name"] for item in body["items"]}
    assert "ดาบสองมือ" in names
    assert "ซ่อนอยู่" not in names
    dab = next(item for item in body["items"] if item["id"] == ids["dab_id"])
    assert dab["contexts"][0]["group"] == "งานเลี้ยง"
    assert dab["keywords"][0]["name"] == "อาวุธ"


def test_items_endpoint_db_search_matches_keyword_and_detail(db_catalog_client):
    client, ids = db_catalog_client
    r = client.get("/items", params={"search": "อาวุธ", "user_key": "anon:db"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 1
    assert body["items"][0]["id"] == ids["dab_id"]

    detail = client.get(f"/items/{ids['dab_id']}", params={"user_key": "anon:db"})
    assert detail.status_code == 200, detail.text
    data = detail.json()
    assert data["name"] == "ดาบสองมือ"
    assert data["contexts"][0]["active_item_count"] == 1


def test_items_endpoint_db_ranked_context_mode(db_catalog_client):
    client, ids = db_catalog_client
    r = client.get(
        "/items",
        params={"context": _stable_context_id("งานบวช"), "user_key": "anon:db"},
    )
    assert r.status_code == 200, r.text
    returned = {item["id"] for item in r.json()["items"]}
    assert ids["rabam_id"] in returned
    assert ids["khon_id"] in returned
    assert ids["dab_id"] not in returned


def test_keywords_and_metrics_prefer_db_counts(db_catalog_client):
    client, _ = db_catalog_client
    contexts = client.get("/contexts").json()["contexts"]
    counts = {ctx["name"]: ctx["active_item_count"] for ctx in contexts}
    assert counts["งานบวช"] == 2
    assert counts["งานเลี้ยงสังสรรค์"] == 1

    keywords = client.get("/keywords", params={"limit": 1000}).json()["keywords"]
    assert {kw["name"] for kw in keywords} == {"ดนตรี", "ผู้หญิง", "อาวุธ"}
    assert any(kw["taxonomy_path"] == "ผู้แสดง > เพศ" for kw in keywords)

    filtered = client.get("/keywords", params={"search": "หญิง"}).json()["keywords"]
    assert [kw["name"] for kw in filtered] == ["ผู้หญิง"]

    metrics = client.get("/metrics").json()
    assert metrics["item_count"] == 3
    assert metrics["context_count"] == 2
    assert metrics["keyword_count"] == 3


# --- db_health branch coverage -----------------------------------------------


def test_db_health_ok_when_engine_responds(monkeypatch):
    """``/db/health`` returns 200 ok when ``get_engine().connect()`` works."""
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.pool import StaticPool

    from app.core import config as config_module
    from app.db import reset_engine
    from app.main import create_app
    from app.model_loader import reset_singleton

    monkeypatch.setenv("RECSYS_ARTIFACT_DIR", str(__import__("pathlib").Path(__file__).parent))
    config_module.reset_settings_cache()
    reset_singleton()
    eng = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    monkeypatch.setattr("app.db.get_engine", lambda: eng)
    reset_engine()
    try:
        with TestClient(create_app()) as c:
            r = c.get("/db/health")
            assert r.status_code == 200
            body = r.json()
            assert body["status"] == "ok"
    finally:
        eng.dispose()


def test_db_health_returns_503_when_engine_raises(monkeypatch):
    """``/db/health`` returns 503 when the SELECT 1 throws."""
    from fastapi.testclient import TestClient

    from app.core import config as config_module
    from app.db import reset_engine
    from app.main import create_app
    from app.model_loader import reset_singleton

    class _BoomEngine:
        def connect(self):
            raise RuntimeError("simulated outage")

    monkeypatch.setenv("RECSYS_ARTIFACT_DIR", str(__import__("pathlib").Path(__file__).parent))
    config_module.reset_settings_cache()
    reset_singleton()
    monkeypatch.setattr("app.db.get_engine", lambda: _BoomEngine())
    reset_engine()
    with TestClient(create_app()) as c:
        r = c.get("/db/health")
        assert r.status_code == 503


def test_live_positive_users_per_item_db_id_space(monkeypatch):
    """Deprecated helper still works and returns DB-id-keyed data."""
    from app.services.db_query import live_positive_users_per_item

    # The conftest's `client` fixture doesn't seed LegacyInteraction, so
    # we use a fresh in-memory engine here.
    from contextlib import contextmanager
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool

    from app import db as db_module
    from app.core import config as config_module
    from app.models_db import Base, LegacyInteraction
    from app.services import db_query as dbq_module

    eng = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    SessionLocal = sessionmaker(bind=eng, expire_on_commit=False)

    with SessionLocal() as s:
        s.add(LegacyInteraction(item_id=10, legacy_user_id=1, rating=5, imported_at=__import__("datetime").datetime.now(__import__("datetime").timezone.utc)))
        s.add(LegacyInteraction(item_id=10, legacy_user_id=2, rating=4, imported_at=__import__("datetime").datetime.now(__import__("datetime").timezone.utc)))
        s.add(LegacyInteraction(item_id=20, legacy_user_id=1, rating=2, imported_at=__import__("datetime").datetime.now(__import__("datetime").timezone.utc)))  # below default
        s.commit()

    @contextmanager
    def fs():
        sess = SessionLocal()
        try:
            yield sess
            sess.commit()
        finally:
            sess.close()

    config_module.reset_settings_cache()
    monkeypatch.setattr(db_module, "is_db_enabled", lambda: True)
    monkeypatch.setattr(db_module, "session_scope", fs)
    monkeypatch.setattr(dbq_module, "is_db_enabled", lambda: True)
    monkeypatch.setattr(dbq_module, "session_scope", fs)

    out = live_positive_users_per_item()
    # Item 10 has two positive users; item 20 has none (only a 2-star rating).
    assert out[10] == {"legacy:1", "legacy:2"}
    assert 20 not in out
    eng.dispose()
