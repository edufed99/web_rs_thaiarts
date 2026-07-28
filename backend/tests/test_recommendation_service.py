"""Tests for the recommendation_service orchestrator directly."""
from __future__ import annotations

import pytest

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
    assert out.keywords[0].taxonomy_path == "ผู้แสดง"


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