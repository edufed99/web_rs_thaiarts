"""Tests for the /health endpoint."""
from __future__ import annotations

from fastapi.testclient import TestClient


def test_health_ok(client: TestClient):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["version"]
    assert body["item_count"] == 5
    assert body["embedding_dim"] == 4
    assert body["artifacts_loaded_at"] is not None


def test_health_endpoint_in_openapi(client: TestClient):
    r = client.get("/openapi.json")
    assert r.status_code == 200
    spec = r.json()
    assert "/health" in spec["paths"]
    assert "Liveness probe" in spec["paths"]["/health"]["get"].get("summary", "")