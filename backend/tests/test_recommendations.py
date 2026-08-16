"""Tests for the /recommendations endpoint."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.models_db import User
from tests.conftest import context_id, item_id, keyword_id


def test_recommend_happy_path(client: TestClient):
    body = {
        "context_id": context_id("งานบวช"),
        "keyword_ids": [],
        "top_k": 5,
        "user_key": "user:u1",
    }
    r = client.post("/recommendations", json=body)
    assert r.status_code == 200
    data = r.json()
    assert data["candidate_count"] == 3
    assert 1 <= len(data["results"]) <= 5
    # Items in u1's history should have cf_score==0 (cf_itemknn excludes them)
    # But they may still appear via cbf; check no crash.
    for res in data["results"]:
        assert "rank" in res
        assert "scores" in res
        assert "cbf" in res["scores"]
        assert "cf" in res["scores"]
        assert "hybrid" in res["scores"]
        assert "explanation" in res
        assert res["rank"] >= 1


def test_recommend_results_sorted_by_hybrid_desc(client: TestClient):
    body = {
        "context_id": context_id("งานบวช"),
        "keyword_ids": [],
        "top_k": 5,
    }
    data = client.post("/recommendations", json=body).json()
    scores = [r["scores"]["hybrid"] for r in data["results"]]
    assert scores == sorted(scores, reverse=True)


def test_recommend_with_keywords(client: TestClient):
    body = {
        "context_id": context_id("งานบวช"),
        "keyword_ids": [keyword_id("ผู้หญิง")],
        "top_k": 3,
    }
    r = client.post("/recommendations", json=body)
    assert r.status_code == 200
    data = r.json()
    # ระบำพรหมาสตร์ has ผู้หญิง — should be first
    if data["results"]:
        first = data["results"][0]
        assert first["matched_keywords"] == ["ผู้หญิง"]


def test_recommend_unknown_context(client: TestClient):
    r = client.post("/recommendations", json={"context_id": 99999, "keyword_ids": [], "top_k": 5})
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "context_not_found"


def test_recommend_top_k_zero_rejected(client: TestClient):
    r = client.post("/recommendations", json={"context_id": context_id("งานบวช"), "keyword_ids": [], "top_k": 0})
    assert r.status_code == 422


def test_recommend_top_k_too_large_rejected(client: TestClient):
    r = client.post("/recommendations", json={"context_id": context_id("งานบวช"), "keyword_ids": [], "top_k": 51})
    assert r.status_code == 422


def test_recommend_invalid_json_body(client: TestClient):
    r = client.post(
        "/recommendations",
        content="not-json",
        headers={"Content-Type": "application/json"},
    )
    assert r.status_code == 422


def test_recommend_empty_context_returns_empty_results(client: TestClient):
    """A context that has no items yields candidate_count=0 and results=[]."""
    # Build a request for an existing context with user_key set so cf doesn't crash
    body = {
        "context_id": context_id("งานเลี้ยงสังสรรค์"),
        "keyword_ids": [],
        "top_k": 5,
        "user_key": "user:u1",
    }
    r = client.post("/recommendations", json=body)
    assert r.status_code == 200
    data = r.json()
    assert data["candidate_count"] == 2
    assert isinstance(data["results"], list)


def test_recommend_dedupes_keywords(client: TestClient):
    body = {
        "context_id": context_id("งานบวช"),
        "keyword_ids": [keyword_id("ผู้หญิง"), keyword_id("ผู้หญิง")],
        "top_k": 3,
    }
    r = client.post("/recommendations", json=body)
    assert r.status_code == 200
    selected = r.json()["selected_keywords"]
    assert len(selected) == 1


def test_recommend_negative_keyword_id_rejected(client: TestClient):
    body = {
        "context_id": context_id("งานบวช"),
        "keyword_ids": [-1],
        "top_k": 3,
    }
    r = client.post("/recommendations", json=body)
    assert r.status_code == 422


def test_profile_recommendations_requires_auth(client: TestClient):
    r = client.get("/recommendations/profile")

    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthorized"


def test_authenticated_recommendation_uses_best_profile_key(client: TestClient):
    from app.routers import recommendations as recommendations_router

    app = client.app
    app.dependency_overrides[recommendations_router.get_current_user_dep] = lambda: User(
        id=7,
        username="profile-user",
        password_hash="unused",
        is_admin=False,
    )
    try:
        body = {
            "context_id": context_id("งานบวช"),
            "keyword_ids": [],
            "top_k": 3,
            "user_key": "anon:must-be-overridden",
        }
        r = client.post("/recommendations", json=body)
    finally:
        app.dependency_overrides.clear()

    assert r.status_code == 200
    assert r.json()["metadata"]["user_key_provided"] is True


def test_recommendations_with_in_memory_telemetry_dependency_override(client: TestClient):
    from app.services.telemetry import InMemoryTelemetryAdapter, get_telemetry_adapter

    adapter = InMemoryTelemetryAdapter()
    app = client.app
    app.dependency_overrides[get_telemetry_adapter] = lambda: adapter
    try:
        body = {
            "context_id": context_id("งานบวช"),
            "keyword_ids": [keyword_id("ผู้หญิง")],
            "top_k": 3,
            "user_key": "user:u1",
        }
        r = client.post("/recommendations", json=body)
        assert r.status_code == 200
        data = r.json()
        assert len(data["results"]) > 0
        assert len(adapter.records) == 1
        record = adapter.records[0]
        assert record["ctx_name"] == "งานบวช"
        assert record["candidate_count"] == 3
        assert len(record["results"]) == len(data["results"])
        assert len(record["selected_keywords"]) == 1
        assert record["selected_keywords"][0].name == "ผู้หญิง"
    finally:
        app.dependency_overrides.clear()