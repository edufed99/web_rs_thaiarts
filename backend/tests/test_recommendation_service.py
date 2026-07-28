"""Tests for the recommendation_service orchestrator directly."""
from __future__ import annotations

import hashlib
from contextlib import contextmanager

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.exceptions import ContextNotFoundError
from app.schemas.recommendation import RecommendationRequestIn
from app.services.recommendation_service import (
    _build_context_out,
    _build_item_out,
    _resolve_keywords,
    generate_recommendations,
)

from .conftest import context_id, item_id, keyword_id


def test_unknown_context_raises(loader):
    req = RecommendationRequestIn(context_id=99999, keyword_ids=[], top_k=5)
    with pytest.raises(ContextNotFoundError):
        generate_recommendations(loader, req)


def test_resolve_keywords_filters_unknown(loader):
    kws = _resolve_keywords(loader, [keyword_id("ผู้หญิง"), 99999])
    assert len(kws) == 1
    assert kws[0]["name"] == "ผู้หญิง"


def test_resolve_keywords_empty(loader):
    assert _resolve_keywords(loader, []) == []


def test_build_context_out_count(loader):
    co = _build_context_out(loader, context_id("งานบวช"), "งานบวช")
    assert co.id == context_id("งานบวช")
    assert co.name == "งานบวช"
    assert co.active_item_count == 3


def test_build_item_out_with_known_item(loader):
    rid = item_id("ระบำพรหมาสตร์")
    row = {"item_id": rid, "name": "X", "keyword_names": ["ผู้หญิง"],
           "context_names": ["งานบวช"], "taxonomy_paths": ["ผู้แสดง"],
           "description": "d", "category_group": "", "performance_type": "",
           "performers_count": None, "duration_minutes": None, "price_text": ""}
    out = _build_item_out(loader, row, rid)
    assert out.id == rid
    assert out.name == "X"
    assert len(out.keywords) == 1


# --- Negative penalty wiring (DB enabled) -----------------------------------

@pytest.fixture
def live_db_for_rec(monkeypatch, loader):
    """SQLite in-memory engine seeded with the synthetic artifact items
    (backfilled artifact ids) so negative ratings can FK in."""
    from app.core import config as config_module
    from app import db as db_module
    from app.models_db import Base, Item, Rating

    eng = create_engine(
        "sqlite:///:memory:?check_same_thread=False", future=True,
        connect_args={"check_same_thread": False}, poolclass=StaticPool,
    )
    Base.metadata.create_all(eng)
    SessionLocal = sessionmaker(bind=eng, expire_on_commit=False, future=True)

    aid_to_django = {}
    with SessionLocal() as s:
        for i, name in enumerate(
            ["ระบำพรหมาสตร์", "โขน", "ลิเก", "หุ่นกระบอก", "วงดนตรีไทย"],
            start=901,
        ):
            aid = int(hashlib.sha256(f"item::{name}".encode("utf-8")).hexdigest()[:7], 16)
            aid_to_django[aid] = i
            s.add(Item(id=i, name=name, is_active=True, artifact_item_id=aid))
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

    monkeypatch.setattr(db_module, "is_db_enabled", lambda: True)
    monkeypatch.setattr(db_module, "get_engine", fake_engine)
    monkeypatch.setattr(db_module, "session_scope", fake_scope)
    from app.services import db_query as dbq_module
    from app.services import recommendation_service as rec_module
    monkeypatch.setattr(dbq_module, "is_db_enabled", lambda: True)
    monkeypatch.setattr(dbq_module, "session_scope", fake_scope)
    # The orchestrator also imports is_db_enabled as a module-local
    # binding — patch it there too so the response metadata sees the
    # patched value.
    monkeypatch.setattr(rec_module, "is_db_enabled", lambda: True)
    db_module.reset_engine()
    config_module.reset_settings_cache()
    yield SessionLocal, aid_to_django
    eng.dispose()


def test_negative_penalty_lowers_hybrid_for_negatively_rated_items(loader, live_db_for_rec):
    """When a user has a low rating for one of the candidates, that item's
    hybrid score must be reduced by the negative-penalty factor."""
    from app.models_db import Rating
    SessionLocal, aid_to_django = live_db_for_rec
    aid_rabam = item_id("ระบำพรหมาสตร์")
    aid_khon = item_id("โขน")

    # baseline (no user_key) — pure popularity path
    base = generate_recommendations(
        loader,
        RecommendationRequestIn(
            context_id=context_id("งานบวช"),
            keyword_ids=[],
            top_k=5,
        ),
    )
    base_rabam = next(r.scores.hybrid for r in base.results if r.item.id == aid_rabam)
    base_khon = next(r.scores.hybrid for r in base.results if r.item.id == aid_khon)

    # Seed a negative rating for โขน
    with SessionLocal() as s:
        s.add(Rating(
            user_key="anon:user-neg", item_id=aid_to_django[aid_khon], rating=1,
        ))
        s.commit()

    penalised = generate_recommendations(
        loader,
        RecommendationRequestIn(
            context_id=context_id("งานบวช"),
            keyword_ids=[],
            top_k=5,
            user_key="anon:user-neg",
        ),
    )
    pen_rabam = next(r.scores.hybrid for r in penalised.results if r.item.id == aid_rabam)
    pen_khon = next(r.scores.hybrid for r in penalised.results if r.item.id == aid_khon)

    # ระบำ untouched → score should match baseline (within ranking ties).
    assert pen_rabam == pytest.approx(base_rabam, rel=1e-6)
    # โขน was penalised by factor (1/5)**1.0 = 0.2 → score strictly lower.
    assert pen_khon < base_khon
    assert pen_khon == pytest.approx(base_khon * 0.2, rel=1e-6)


def test_response_metadata_reports_personalization(loader, live_db_for_rec):
    """When user_key is set and DB is on, the response metadata should
    reflect that user_state was resolved and whether any negative penalty
    was applied."""
    SessionLocal, aid_to_django = live_db_for_rec
    req = RecommendationRequestIn(
        context_id=context_id("งานบวช"),
        keyword_ids=[],
        top_k=3,
        user_key="anon:meta",
    )
    out = generate_recommendations(loader, req)
    assert out.metadata["user_key_provided"] is True
    assert out.metadata["db_enabled"] is True
    assert out.metadata["user_state_resolved"] is True
    assert out.metadata["negative_ratings_applied"] is False


def test_user_state_populated_in_response(loader, live_db_for_rec):
    """When a user has liked an item, the response payload's user_state
    must reflect that."""
    from app.models_db import Like
    SessionLocal, aid_to_django = live_db_for_rec
    aid_rabam = item_id("ระบำพรหมาสตร์")
    with SessionLocal() as s:
        s.add(Like(user_key="anon:liker", item_id=aid_to_django[aid_rabam]))
        s.commit()

    req = RecommendationRequestIn(
        context_id=context_id("งานบวช"),
        keyword_ids=[],
        top_k=5,
        user_key="anon:liker",
    )
    out = generate_recommendations(loader, req)
    rabam = next(r for r in out.results if r.item.id == aid_rabam)
    assert rabam.item.user_state.liked is True
    # Other items the user did NOT like remain unliked.
    others = [r for r in out.results if r.item.id != aid_rabam]
    for o in others:
        assert o.item.user_state.liked is False
    # Sanity: selected keywords carry taxonomy_path on the response.
    if out.selected_keywords:
        assert out.selected_keywords[0].taxonomy_path == "ผู้แสดง"


def test_generate_returns_request_id_and_method(loader):
    req = RecommendationRequestIn(
        context_id=context_id("งานบวช"),
        keyword_ids=[],
        top_k=3,
    )
    resp = generate_recommendations(loader, req)
    assert resp.request_id
    assert resp.method == "Hybrid-WeightedSum"
    assert resp.top_k == 3
    assert resp.metadata["cbf_model"] == "precomputed-E5"


def test_generate_empty_candidate_set(loader):
    """When context has no items (mocked via unknown context), we never reach empty path.
    Instead test with a context that has items but a keyword filter that excludes everything."""
    # We can't easily build an empty context with current fixtures, but we can
    # verify the empty response helper:
    from app.services.recommendation_service import _empty_response
    from app.schemas.keyword import KeywordOut
    req = RecommendationRequestIn(context_id=context_id("งานบวช"), keyword_ids=[], top_k=5)
    resp = _empty_response(req, "งานบวช", [KeywordOut(id=1, name="x")], settings=None)
    assert resp.candidate_count == 0
    assert resp.results == []