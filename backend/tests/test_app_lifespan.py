"""Tests that confirm artifacts-missing behavior at the app level."""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


def test_health_degraded_when_artifacts_missing(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("RECSYS_ARTIFACT_DIR", str(tmp_path))
    from app.core.config import reset_settings_cache
    from app.model_loader import reset_singleton
    reset_settings_cache()
    reset_singleton()

    app = create_app()
    with TestClient(app) as c:
        r = c.get("/health")
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "degraded"
        assert body["artifacts_loaded_at"] is None
        assert body["item_count"] == 0


def test_swagger_and_redoc_reachable(client: TestClient):
    assert client.get("/docs").status_code == 200
    assert client.get("/redoc").status_code == 200
    spec = client.get("/openapi.json").json()
    assert spec["info"]["title"] == "Thai Arts Recommender API"
    # All custom routers expose paths
    expected_paths = {"/health", "/recommendations", "/items", "/items/{item_id}",
                      "/contexts", "/keywords", "/metrics"}
    assert expected_paths.issubset(set(spec["paths"].keys()))