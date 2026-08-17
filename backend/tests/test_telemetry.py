"""
tests/test_telemetry.py — Tests for RecommendationTelemetry adapters and factory.
"""
from __future__ import annotations

import hashlib
import json
import logging
from contextlib import contextmanager
from typing import Dict, List, Optional
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import Settings
from app.models_db import (
    Base,
    Context,
    Item,
    Keyword as DbKeyword,
    RecommendationRequest as RR,
    RecommendationRequestSelectedKeyword as RRSK,
    RecommendationResult as RL,
    User,
)
from app.schemas.context import ContextOut
from app.schemas.item import ItemOut, UserState
from app.schemas.keyword import KeywordOut
from app.schemas.recommendation import (
    RecommendationRequestIn,
    RecommendationResultOut,
    ScoresOut,
)
from app.services.telemetry import (
    InMemoryTelemetryAdapter,
    NullTelemetryAdapter,
    PostgresTelemetryAdapter,
    RecommendationTelemetry,
    get_telemetry_adapter,
)


def _make_dummy_request(
    context_id: int = 1,
    keyword_ids: Optional[List[int]] = None,
    top_k: int = 5,
    user_key: Optional[str] = "user:test",
) -> RecommendationRequestIn:
    return RecommendationRequestIn(
        context_id=context_id,
        keyword_ids=keyword_ids or [],
        top_k=top_k,
        user_key=user_key,
    )


def _make_dummy_result(
    artifact_id: int,
    rank: int = 1,
    name: str = "Test Item",
) -> RecommendationResultOut:
    return RecommendationResultOut(
        rank=rank,
        item=ItemOut(
            id=artifact_id,
            name=name,
            description="desc",
            category_group="cat",
            performance_type="perf",
            performers_count=2,
            duration_minutes=15,
            price_text="free",
            image_url="",
            video_url="",
            keywords=[],
            contexts=[],
            user_state=UserState(),
        ),
        scores=ScoresOut(cbf=0.8, cf=0.6, hybrid=0.7),
        is_context_valid=True,
        matched_keywords=["ผู้หญิง"],
        explanation="test explanation",
        match_percent=85,
        suitability_label="เหมาะสมมาก",
    )


# --- Tests for NullTelemetryAdapter ---


def test_null_telemetry_adapter():
    adapter = NullTelemetryAdapter()
    assert isinstance(adapter, RecommendationTelemetry)
    req = _make_dummy_request()
    res = adapter.record_recommendation(
        request=req,
        ctx_name="งานบวช",
        results=[],
        settings=Settings(),
    )
    assert res == 0


# --- Tests for InMemoryTelemetryAdapter ---


def test_in_memory_telemetry_adapter_records_and_clears():
    adapter = InMemoryTelemetryAdapter(return_id=0)
    assert isinstance(adapter, RecommendationTelemetry)
    assert adapter.records == []
    assert adapter.calls == []

    req = _make_dummy_request(keyword_ids=[101])
    res1 = _make_dummy_result(artifact_id=201, rank=1)
    kws = [KeywordOut(id=101, name="ผู้หญิง", taxonomy_path="ผู้แสดง")]
    settings = Settings()

    rec_id = adapter.record_recommendation(
        request=req,
        ctx_name="งานบวช",
        results=[res1],
        settings=settings,
        user_id=10,
        candidate_count=20,
        selected_keywords=kws,
    )
    assert rec_id == 0
    assert len(adapter.records) == 1
    assert adapter.calls == adapter.records

    record = adapter.records[0]
    assert record["request"] == req
    assert record["ctx_name"] == "งานบวช"
    assert record["results"] == [res1]
    assert record["settings"] == settings
    assert record["user_id"] == 10
    assert record["candidate_count"] == 20
    assert record["selected_keywords"] == kws

    adapter.clear()
    assert adapter.records == []


def test_in_memory_telemetry_adapter_custom_return_id():
    adapter = InMemoryTelemetryAdapter(return_id=999)
    req = _make_dummy_request()
    rec_id = adapter.record_recommendation(
        request=req,
        ctx_name="งานบวช",
        results=[],
        settings=Settings(),
    )
    assert rec_id == 999
    assert len(adapter.records) == 1
    # Candidate count defaults to len(results) if candidate_count is None
    assert adapter.records[0]["candidate_count"] == 0
    assert adapter.records[0]["selected_keywords"] == []


# --- Tests for get_telemetry_adapter factory ---


def test_get_telemetry_adapter_db_disabled(monkeypatch):
    from app.services import telemetry as tel_module

    monkeypatch.setattr(tel_module, "is_db_enabled", lambda: False)
    adapter = tel_module.get_telemetry_adapter()
    assert isinstance(adapter, InMemoryTelemetryAdapter)


def test_get_telemetry_adapter_db_enabled(monkeypatch):
    from app.services import telemetry as tel_module

    monkeypatch.setattr(tel_module, "is_db_enabled", lambda: True)
    adapter = tel_module.get_telemetry_adapter()
    assert isinstance(adapter, PostgresTelemetryAdapter)


# --- Tests for PostgresTelemetryAdapter ---


@pytest.fixture
def telemetry_db(monkeypatch):
    """Isolated in-memory SQLite DB seeded with contexts, keywords, and items."""
    from app.services import telemetry as tel_module

    eng = create_engine(
        "sqlite:///:memory:?check_same_thread=False",
        future=True,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(eng)
    SessionLocal = sessionmaker(bind=eng, expire_on_commit=False, future=True)

    aid_map = {}
    with SessionLocal() as s:
        ctx = Context(id=1, name="งานบวช", group_name="พิธีกรรม")
        s.add(ctx)
        kw1 = DbKeyword(id=10, name="ผู้หญิง")
        kw2 = DbKeyword(id=11, name="ชุดไทย")
        s.add(kw1)
        s.add(kw2)

        user = User(id=5, username="u5", password_hash="pw", is_admin=False)
        s.add(user)

        for i, name in enumerate(["ระบำพรหมาสตร์", "โขน"], start=100):
            aid = int(hashlib.sha256(f"item::{name}".encode("utf-8")).hexdigest()[:7], 16)
            aid_map[name] = aid
            s.add(Item(id=i, name=name, is_active=True, artifact_item_id=aid))
        s.commit()

    @contextmanager
    def fake_scope():
        sess = SessionLocal()
        try:
            yield sess
            sess.commit()
        finally:
            sess.close()

    monkeypatch.setattr(tel_module, "is_db_enabled", lambda: True)
    monkeypatch.setattr(tel_module, "session_scope", fake_scope)

    yield SessionLocal, aid_map
    eng.dispose()


def test_postgres_telemetry_when_db_disabled(monkeypatch):
    from app.services import telemetry as tel_module

    monkeypatch.setattr(tel_module, "is_db_enabled", lambda: False)
    adapter = PostgresTelemetryAdapter()
    req = _make_dummy_request()
    res = adapter.record_recommendation(
        request=req,
        ctx_name="งานบวช",
        results=[],
        settings=Settings(),
    )
    assert res == 0


def test_postgres_telemetry_when_session_is_none(monkeypatch):
    from app.services import telemetry as tel_module

    @contextmanager
    def null_scope():
        yield None

    monkeypatch.setattr(tel_module, "is_db_enabled", lambda: True)
    monkeypatch.setattr(tel_module, "session_scope", null_scope)
    adapter = PostgresTelemetryAdapter()
    req = _make_dummy_request()
    res = adapter.record_recommendation(
        request=req,
        ctx_name="งานบวช",
        results=[],
        settings=Settings(),
    )
    assert res == 0


def test_postgres_telemetry_missing_context(telemetry_db, caplog):
    adapter = PostgresTelemetryAdapter()
    req = _make_dummy_request()
    with caplog.at_level(logging.WARNING):
        res = adapter.record_recommendation(
            request=req,
            ctx_name="บริบทที่ไม่เคยมีในระบบ",
            results=[],
            settings=Settings(),
        )
    assert res == 0
    assert "missing from the database" in caplog.text


def test_postgres_telemetry_happy_path(telemetry_db):
    SessionLocal, aid_map = telemetry_db
    adapter = PostgresTelemetryAdapter()
    req = _make_dummy_request(top_k=3, user_key="user:u5")
    res1 = _make_dummy_result(artifact_id=aid_map["ระบำพรหมาสตร์"], rank=1, name="ระบำพรหมาสตร์")
    res2 = _make_dummy_result(artifact_id=aid_map["โขน"], rank=2, name="โขน")
    # Also include an unmapped artifact item ID to ensure it is safely skipped
    res_unmapped = _make_dummy_result(artifact_id=9999999, rank=3, name="Unmapped")
    kws = [
        KeywordOut(id=10, name="ผู้หญิง", taxonomy_path="ผู้แสดง"),
        KeywordOut(id=11, name="ชุดไทย", taxonomy_path="เครื่องแต่งกาย"),
    ]

    persisted_id = adapter.record_recommendation(
        request=req,
        ctx_name="งานบวช",
        results=[res1, res2, res_unmapped],
        settings=Settings(),
        user_id=5,
        candidate_count=15,
        selected_keywords=kws,
    )

    assert persisted_id > 0

    with SessionLocal() as session:
        rr = session.get(RR, persisted_id)
        assert rr is not None
        assert rr.user_id == 5
        assert rr.selected_context_id == 1
        assert rr.candidate_count == 15
        assert rr.top_k == 3
        meta = json.loads(rr.metadata_json)
        assert meta["selected_keyword_names"] == ["ผู้หญิง", "ชุดไทย"]

        # Check keywords
        selected_kw_ids = session.execute(
            select(RRSK.keyword_id).where(RRSK.request_id == persisted_id)
        ).scalars().all()
        assert set(selected_kw_ids) == {10, 11}

        # Check results
        results_rows = session.execute(
            select(RL).where(RL.request_id == persisted_id).order_by(RL.rank)
        ).scalars().all()
        assert len(results_rows) == 2  # Only the 2 mapped items persisted
        assert results_rows[0].item_id == 100
        assert results_rows[0].rank == 1
        assert results_rows[0].cbf_score == pytest.approx(0.8)
        assert results_rows[1].item_id == 101
        assert results_rows[1].rank == 2


def test_postgres_telemetry_handles_db_exception(telemetry_db, monkeypatch, caplog):
    from app.services import telemetry as tel_module

    @contextmanager
    def exploding_scope():
        raise RuntimeError("Database connection pool exhausted")
        yield  # pragma: no cover

    monkeypatch.setattr(tel_module, "session_scope", exploding_scope)
    adapter = PostgresTelemetryAdapter()
    req = _make_dummy_request()
    with caplog.at_level(logging.ERROR):
        res = adapter.record_recommendation(
            request=req,
            ctx_name="งานบวช",
            results=[],
            settings=Settings(),
        )
    assert res == 0
    assert "Failed to persist recommendation request telemetry" in caplog.text


def test_postgres_telemetry_recompute_online_eval_exception_ignored(telemetry_db, monkeypatch):
    """If recompute_online_eval fails, the persisted request id is still returned safely."""
    from app.services import evaluation

    def exploding_recompute(*args, **kwargs):
        raise ValueError("Recompute error")

    monkeypatch.setattr(evaluation, "recompute_online_eval", exploding_recompute)
    adapter = PostgresTelemetryAdapter()
    req = _make_dummy_request()
    res = adapter.record_recommendation(
        request=req,
        ctx_name="งานบวช",
        results=[],
        settings=Settings(),
        user_id=5,
    )
    assert res > 0
