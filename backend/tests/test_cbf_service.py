"""Tests for services.cbf_service."""
from __future__ import annotations

import math

import numpy as np
import pytest

from app.core.config import Settings
from app.core.exceptions import EmbeddingBackendUnavailableError
from app.services.cbf_service import (
    build_query_text,
    score_items_by_content,
    score_items_by_content_with_runtime,
)

from .conftest import item_id


@pytest.fixture
def candidates(loader):
    return [
        {"item_id": item_id("ระบำพรหมาสตร์"), "keyword_names": ["ผู้หญิง", "ชุดไทย"]},
        {"item_id": item_id("โขน"), "keyword_names": ["ผู้ชาย", "หน้าจอ"]},
        {"item_id": item_id("หุ่นกระบอก"), "keyword_names": ["หน้าจอ", "ผู้ชาย"]},
    ]


def test_build_query_text_combines_inputs():
    text = build_query_text(["ผู้หญิง", "ชุดไทย"], context_name="งานบวช")
    assert "ผู้หญิง" in text and "งานบวช" in text
    assert text.strip() == text


def test_empty_query_returns_zero(loader, candidates):
    scores = score_items_by_content(loader, candidates, [], context_name="")
    assert all(v == 0.0 for v in scores.values())
    assert set(scores.keys()) == {c["item_id"] for c in candidates}


def test_keyword_match_adds_boost(loader, candidates):
    """Items with overlapping keywords score higher than items without."""
    no_ctx = score_items_by_content(
        loader, candidates, ["ผู้หญิง"], context_name=None, settings=Settings(),
    )
    boosted = no_ctx[item_id("ระบำพรหมาสตร์")]
    plain = no_ctx[item_id("โขน")]
    # Hit item must strictly outscore non-hit items
    assert boosted > plain
    # The diff is bounded by the boost (it can be smaller because the proxy
    # query is weighted toward the hit item itself)
    diff = boosted - plain
    assert 0 < diff <= Settings().cbf_keyword_boost + 1e-6


def test_scores_within_range(loader, candidates):
    scores = score_items_by_content(
        loader, candidates, ["ผู้หญิง"], context_name="งานบวช"
    )
    for v in scores.values():
        # cosine is in [-1, 1], boost <= 0.1 by default
        assert -1.01 <= v <= 1.1


def test_custom_boost(loader, candidates):
    s = Settings(cbf_keyword_boost=0.5)
    scores = score_items_by_content(loader, candidates, ["ผู้หญิง"], context_name=None, settings=s)
    boosted = scores[item_id("ระบำพรหมาสตร์")]
    plain = scores[item_id("โขน")]
    diff = boosted - plain
    # diff strictly positive and bounded above by the boost value
    assert diff > 0
    assert diff <= s.cbf_keyword_boost + 1e-6


def test_e5_query_encoder_used_for_1024d_artifacts(loader, candidates, monkeypatch):
    from app.services import cbf_service

    vecs = np.zeros((len(loader.item_ids), 1024), dtype=np.float32)
    vecs[:, 0] = 1.0
    loader._embeddings = vecs
    called = {}

    def fake_encode_query(text: str):
        called["text"] = text
        q = np.zeros(1024, dtype=np.float32)
        q[0] = 1.0
        return q

    monkeypatch.setattr(cbf_service, "encode_query", fake_encode_query)
    scores = score_items_by_content(
        loader, candidates, ["ผู้หญิง"], context_name="งานบวช", settings=Settings()
    )
    assert called["text"].startswith("งานบวช")
    assert set(scores.keys()) == {c["item_id"] for c in candidates}


def test_runtime_response_discloses_e5(loader, candidates, monkeypatch):
    from app.services import cbf_service

    loader._embeddings = np.ones((len(loader.item_ids), 1024), dtype=np.float32)
    monkeypatch.setattr(
        cbf_service,
        "encode_query",
        lambda _text: np.ones(1024, dtype=np.float32) / np.sqrt(1024),
    )
    outcome = score_items_by_content_with_runtime(
        loader, candidates, ["ผู้หญิง"], context_name="งานบวช", settings=Settings()
    )
    assert outcome.embedding_backend == "e5"
    assert outcome.embedding_latency_ms >= 0


def test_research_mode_never_silently_falls_back(loader, candidates, monkeypatch):
    from app.services import cbf_service

    loader._embeddings = np.ones((len(loader.item_ids), 1024), dtype=np.float32)

    def unavailable(_text):
        raise RuntimeError("model cache missing")

    monkeypatch.setattr(cbf_service, "encode_query", unavailable)
    with pytest.raises(EmbeddingBackendUnavailableError, match="proxy fallback is disabled"):
        score_items_by_content(
            loader,
            candidates,
            ["ผู้หญิง"],
            context_name="งานบวช",
            settings=Settings(research_mode=True),
        )


def test_non_research_mode_reports_proxy_on_e5_failure(loader, candidates, monkeypatch):
    from app.services import cbf_service

    loader._embeddings = np.ones((len(loader.item_ids), 1024), dtype=np.float32)
    monkeypatch.setattr(cbf_service, "encode_query", lambda _text: (_ for _ in ()).throw(RuntimeError()))
    outcome = score_items_by_content_with_runtime(
        loader, candidates, ["ผู้หญิง"], settings=Settings(research_mode=False)
    )
    assert outcome.embedding_backend == "proxy"


def test_no_candidates_returns_empty(loader):
    scores = score_items_by_content(loader, [], ["x"], context_name=None)
    assert scores == {}


def test_missing_item_embedding_returns_zero(loader, candidates, monkeypatch):
    """If an item has no embedding, its score is 0 (not raised)."""
    from app.model_loader import get_singleton
    ldr = get_singleton() if loader is None else loader
    bad = [{"item_id": 99999999, "keyword_names": []}]
    scores = score_items_by_content(ldr, bad, ["x"], context_name=None)
    assert scores[99999999] == 0.0
