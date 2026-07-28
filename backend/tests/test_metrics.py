"""Tests for the /contexts, /keywords, /metrics endpoints."""
from __future__ import annotations

from fastapi.testclient import TestClient


def test_list_contexts(client: TestClient):
    r = client.get("/contexts")
    assert r.status_code == 200
    body = r.json()
    ctxs = body["contexts"]
    assert len(ctxs) == 2
    names = {c["name"] for c in ctxs}
    assert "งานบวช" in names
    assert "งานเลี้ยงสังสรรค์" in names
    for c in ctxs:
        assert c["active_item_count"] >= 1
        assert c["id"] > 0


def test_list_keywords(client: TestClient):
    r = client.get("/keywords")
    assert r.status_code == 200
    body = r.json()
    kws = body["keywords"]
    assert len(kws) >= 5
    names = {k["name"] for k in kws}
    assert "ผู้หญิง" in names
    assert "ดนตรี" in names


def test_list_keywords_search(client: TestClient):
    r = client.get("/keywords", params={"search": "หญิง"})
    assert r.status_code == 200
    kws = r.json()["keywords"]
    assert len(kws) >= 1
    assert all("หญิง" in k["name"] for k in kws)


def test_metrics_shape(client: TestClient):
    r = client.get("/metrics")
    assert r.status_code == 200
    body = r.json()
    assert body["item_count"] == 5
    assert body["context_count"] == 2
    assert body["keyword_count"] >= 5
    assert body["embedding_dim"] == 4
    assert body["positive_user_count"] == 3
    assert body["unique_item_user_edges"] >= 3
    assert body["artifacts_loaded_at"]
    assert body["config_hash"]