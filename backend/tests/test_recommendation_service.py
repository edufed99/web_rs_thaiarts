"""Tests for the recommendation_service orchestrator directly."""
from __future__ import annotations

import hashlib
from contextlib import contextmanager

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.exceptions import ContextNotFoundError
from app.schemas.recommendation import RecommendationRequestIn
from app.schemas.item import UserState
from app.services.recommendation_service import (
    _build_context_out,
    _build_item_out,
    _history_reason_for_item,
    _recommendation_history_evidence,
    _profile_card_explanation,
    _profile_content_affinity,
    _profile_history_summary,
    _resolve_keywords,
    generate_profile_recommendations,
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


def test_resolve_keywords_accepts_db_keyword_ids(loader, monkeypatch):
    """The frontend can receive live DB keyword ids from /keywords.

    Recommendation resolution must accept those ids too; otherwise selected
    keywords disappear and the results header reports 0 selected keywords.
    """
    from app.models_db import Base, Keyword, TaxonomyNode
    from app.services import recommendation_service as rec_module

    eng = create_engine(
        "sqlite:///:memory:?check_same_thread=False",
        future=True,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(eng)
    SessionLocal = sessionmaker(bind=eng, expire_on_commit=False, future=True)
    with SessionLocal() as s:
        s.add(TaxonomyNode(id=1, name="ผู้แสดง", level=1, parent_id=None))
        s.add(TaxonomyNode(id=2, name="เพศ", level=2, parent_id=1))
        s.add(Keyword(id=213, name="ผู้หญิง", taxonomy_node_id=2))
        s.commit()

    @contextmanager
    def fake_scope():
        sess = SessionLocal()
        try:
            yield sess
            sess.commit()
        finally:
            sess.close()

    monkeypatch.setattr(rec_module, "session_scope", fake_scope)
    try:
        kws = _resolve_keywords(loader, [213])
        assert kws == [
            {
                "id": 213,
                "name": "ผู้หญิง",
                "taxonomy_path": "ผู้แสดง > เพศ",
            }
        ]
    finally:
        eng.dispose()


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


def test_profile_history_summary_uses_real_history_items(loader):
    history_ids = {item_id("ระบำพรหมาสตร์"), item_id("โขน")}
    summary = _profile_history_summary(loader, history_ids)

    assert "ระบำพรหมาสตร์" in summary["history_item_names"]
    assert "งานบวช" in summary["top_contexts"]
    assert "ผู้หญิง" in summary["top_keywords"]
    assert "งานบวช" in summary["sentence"]


def test_profile_card_explanation_is_short_and_history_grounded(loader):
    history_ids = {item_id("ระบำพรหมาสตร์"), item_id("โขน")}
    summary = _profile_history_summary(loader, history_ids)
    row = loader.items[loader.items["name"] == "หุ่นกระบอก"].iloc[0].to_dict()
    explanation = _profile_card_explanation(row, summary)

    assert explanation.startswith("แนะนำเพราะในอดีตคุณเคยชอบ")
    assert "ระบำพรหมาสตร์" in explanation
    assert len(explanation) < 140


def test_profile_content_affinity_uses_fresh_history_metadata(loader):
    history = {item_id("ระบำพรหมาสตร์")}
    candidates = [row.to_dict() for _, row in loader.items.iterrows()]
    scores = _profile_content_affinity(loader, history, candidates)
    assert scores[item_id("ระบำพรหมาสตร์")] > 0
    assert scores[item_id("ลิเก")] > 0  # shared ผู้หญิง keyword
    assert scores[item_id("วงดนตรีไทย")] >= 0
    assert _profile_content_affinity(loader, set(), candidates) == {
        int(row["item_id"]): 0.0 for row in candidates
    }


def test_static_history_reason_uses_high_rating_and_shared_trait(loader):
    evidence = _recommendation_history_evidence(loader, "user:u1")
    row = loader.items[loader.items["name"] == "หุ่นกระบอก"].iloc[0].to_dict()

    reason = _history_reason_for_item(row, evidence)

    assert reason == "คุณเคยให้คะแนนสูงแก่การแสดงในกลุ่มเดียวกัน"


@pytest.mark.parametrize(
    ("state", "expected"),
    [
        (UserState(liked=True), "คุณเคยกดถูกใจการแสดงกลุ่มนาฏศิลป์อนุรักษ์"),
        (UserState(saved=True), "คุณเคยบันทึกการแสดงกลุ่มนาฏศิลป์อนุรักษ์"),
        (UserState(rating=5), "คุณเคยให้คะแนนสูงแก่การแสดงกลุ่มนาฏศิลป์อนุรักษ์"),
    ],
)
def test_live_history_reason_uses_the_real_action(state, expected):
    history_id = 101
    evidence = {
        "rows": {
            history_id: {
                "category_group": "นาฏศิลป์อนุรักษ์",
                "performance_type": "การแสดง ระบำ รำ ฟ้อน",
            }
        },
        "states": {history_id: state},
        "static_ids": set(),
    }
    item = {
        "category_group": "นาฏศิลป์อนุรักษ์",
        "performance_type": "การแสดง ระบำ รำ ฟ้อน",
    }

    assert _history_reason_for_item(item, evidence) == expected


# --- Negative penalty wiring (DB enabled) -----------------------------------

@pytest.fixture
def live_db_for_rec(monkeypatch, loader):
    """SQLite in-memory engine seeded with the synthetic artifact items
    (backfilled artifact ids) so negative ratings can FK in."""
    from app.core import config as config_module
    from app import db as db_module
    from app.models_db import Base, Context, Item, Keyword, Rating, User

    eng = create_engine(
        "sqlite:///:memory:?check_same_thread=False", future=True,
        connect_args={"check_same_thread": False}, poolclass=StaticPool,
    )
    Base.metadata.create_all(eng)
    SessionLocal = sessionmaker(bind=eng, expire_on_commit=False, future=True)

    aid_to_db = {}
    with SessionLocal() as s:
        s.add(Context(id=81, name="งานบวช", group_name="พิธีกรรม"))
        s.add(Context(id=82, name="งานเลี้ยงสังสรรค์", group_name="งานเลี้ยง"))
        for keyword_db_id, keyword_name in enumerate(
            ["ผู้หญิง", "ผู้ชาย", "ชุดไทย", "หน้าจอ", "ดนตรี"],
            start=301,
        ):
            s.add(Keyword(id=keyword_db_id, name=keyword_name))
        s.add(
            User(
                id=5,
                username="person5",
                password_hash="unused",
                display_name="บุคคล5",
                is_admin=False,
            )
        )
        for i, name in enumerate(
            ["ระบำพรหมาสตร์", "โขน", "ลิเก", "หุ่นกระบอก", "วงดนตรีไทย"],
            start=901,
        ):
            aid = int(hashlib.sha256(f"item::{name}".encode("utf-8")).hexdigest()[:7], 16)
            aid_to_db[aid] = i
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
    yield SessionLocal, aid_to_db
    eng.dispose()


def test_negative_penalty_lowers_hybrid_for_negatively_rated_items(loader, live_db_for_rec):
    """When a user has a low rating for one of the candidates, that item's
    hybrid score must be reduced by a monotonic severity subtraction."""
    from app.models_db import Rating
    SessionLocal, aid_to_db = live_db_for_rec
    aid_rabam = item_id("ระบำพรหมาสตร์")
    aid_khon = item_id("โขน")

    # baseline (no user_key) — CBF-only cold-start path
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
            user_key="anon:user-neg", item_id=aid_to_db[aid_khon], rating=1,
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
    # Rating 1 has severity 1.0, so the default strength subtracts 1.0.
    assert pen_khon < base_khon
    assert pen_khon == pytest.approx(base_khon - 1.0, rel=1e-6)


def test_response_metadata_reports_personalization(loader, live_db_for_rec):
    """When user_key is set and DB is on, the response metadata should
    reflect that user_state was resolved and whether any negative penalty
    was applied."""
    SessionLocal, aid_to_db = live_db_for_rec
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
    SessionLocal, aid_to_db = live_db_for_rec
    aid_rabam = item_id("ระบำพรหมาสตร์")
    with SessionLocal() as s:
        s.add(Like(user_key="anon:liker", item_id=aid_to_db[aid_rabam]))
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


def test_recommendation_overlays_image_url_from_database(loader, live_db_for_rec):
    from app.models_db import Item

    SessionLocal, aid_to_db = live_db_for_rec
    aid_rabam = item_id("ระบำพรหมาสตร์")
    expected_url = "/uploads/items/rabam-cover.png"
    with SessionLocal() as session:
        db_item = session.get(Item, aid_to_db[aid_rabam])
        assert db_item is not None
        db_item.image_url = expected_url
        session.commit()

    out = generate_recommendations(
        loader,
        RecommendationRequestIn(
            context_id=context_id("งานบวช"),
            keyword_ids=[],
            top_k=5,
        ),
    )

    rabam = next(result for result in out.results if result.item.id == aid_rabam)
    assert rabam.item.image_url == expected_url
    # Other items the user did NOT like remain unliked.
    others = [r for r in out.results if r.item.id != aid_rabam]
    for o in others:
        assert o.item.user_state.liked is False
    # Sanity: selected keywords carry taxonomy_path on the response.
    if out.selected_keywords:
        assert out.selected_keywords[0].taxonomy_path == "ผู้แสดง"


def test_profile_recommendations_overlay_images_from_database(loader, live_db_for_rec):
    """Profile cards use current DB media just like context recommendations."""
    from app.models_db import Item, User

    SessionLocal, _aid_to_db = live_db_for_rec
    with SessionLocal() as session:
        for db_item in session.query(Item).all():
            db_item.image_url = f"/uploads/items/{db_item.artifact_item_id}.png"
        session.commit()

    # The synthetic fixture has collaborative history for ``user:u1``.
    user = User(
        id=5,
        username="person5",
        password_hash="unused",
        display_name="legacy: u1",
        is_admin=False,
    )
    out = generate_profile_recommendations(loader, user, top_k=5)

    assert out.results
    assert all(result.item.image_url for result in out.results)
    assert all(
        result.item.image_url == f"/uploads/items/{result.item.id}.png"
        for result in out.results
    )


def test_recommendation_persists_user_keywords_and_db_item_ids(loader, live_db_for_rec):
    """A logged-in user's selected keywords are stored per request.

    API recommendation rows use artifact item ids, while the history table
    requires DB item ids; this test protects both mappings.
    """
    from app.models_db import (
        Keyword,
        RecommendationRequest,
        RecommendationRequestSelectedKeyword,
        RecommendationResult,
    )

    SessionLocal, aid_to_db = live_db_for_rec
    selected_names = {"ผู้หญิง", "ชุดไทย"}
    out = generate_recommendations(
        loader,
        RecommendationRequestIn(
            context_id=context_id("งานบวช"),
            keyword_ids=[keyword_id(name) for name in selected_names],
            top_k=3,
            user_key="user:บุคคล5",
        ),
        user_id=5,
    )

    assert out.request_id.isdigit()
    assert out.metadata["persisted_to_db"] is True
    with SessionLocal() as session:
        request_row = session.get(RecommendationRequest, int(out.request_id))
        assert request_row is not None
        assert request_row.user_id == 5
        assert request_row.candidate_count == out.candidate_count

        stored_names = set(
            session.execute(
                select(Keyword.name)
                .join(
                    RecommendationRequestSelectedKeyword,
                    RecommendationRequestSelectedKeyword.keyword_id == Keyword.id,
                )
                .where(RecommendationRequestSelectedKeyword.request_id == request_row.id)
            )
            .scalars()
            .all()
        )
        assert stored_names == selected_names

        stored_item_ids = {
            item_id_value
            for (item_id_value,) in session.query(RecommendationResult.item_id)
            .filter(RecommendationResult.request_id == request_row.id)
            .all()
        }
        expected_db_ids = {aid_to_db[result.item.id] for result in out.results}
        assert stored_item_ids == expected_db_ids


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
    assert resp.metadata["cbf_model"] == "intfloat/multilingual-e5-large-instruct"


def test_generate_uses_best_model_config_from_loader(loader):
    loader._best_model_config = {
        "selected_model": {
            "method": "Hybrid-WeightedSum",
            "max_cands": 20,
            "hybrid_alpha": 0.8,
            "cbf_keyword_boost": 0.05,
            "itemknn_k": 10,
            "itemknn_shrink": 50.0,
            "cbf_model": "intfloat/multilingual-e5-large-instruct",
        }
    }
    resp = generate_recommendations(
        loader,
        RecommendationRequestIn(
            context_id=context_id("งานบวช"),
            keyword_ids=[],
            top_k=3,
        ),
    )
    assert resp.method == "Hybrid-WeightedSum"
    assert resp.metadata["hybrid_alpha"] == 0.8
    assert resp.metadata["max_cands"] == 20
    assert resp.metadata["best_model_config_loaded"] is True


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


def test_generate_recommendations_falls_back_when_persist_returns_zero(loader, monkeypatch):
    """When ``_persist_request_and_recompute_online_eval`` returns 0
    (the DB was disabled or unreachable), the response is still
    served with a uuid4 fallback ``request_id`` rather than failing."""
    from app.services import recommendation_service as rec_svc
    from app.schemas.recommendation import RecommendationRequestIn
    from app.core.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(
        rec_svc, "_persist_request_and_recompute_online_eval",
        lambda *a, **kw: 0,
    )
    req = RecommendationRequestIn(
        context_id=context_id("งานบวช"),
        keyword_ids=[keyword_id("ผู้หญิง")],
        top_k=3,
    )
    resp = rec_svc.generate_recommendations(loader, req, settings=settings)
    # request_id is set, but not an int (it's the uuid4 fallback).
    assert resp.request_id
    assert not resp.request_id.isdigit()
    # Results are still populated — the persist failure does not break
    # the recommendation path.
    assert isinstance(resp.results, list)
