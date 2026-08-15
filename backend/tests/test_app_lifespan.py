"""Tests for the Private Model Service app lifecycle.

The public FastAPI application was retired with issue #10; the only ASGI
entry point left is the database-free ``app.private_main`` app. It loads
immutable artifacts during lifespan and refuses to start when they are
missing (a model process that cannot score must not serve stale results).
"""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import reset_settings_cache
from app.core.exceptions import ArtifactsNotLoadedError
from app.model_loader import reset_singleton
from app.private_main import create_private_model_app


@pytest.fixture
def clean_singletons(monkeypatch):
    reset_settings_cache()
    reset_singleton()
    yield
    reset_singleton()
    reset_settings_cache()


def test_private_app_starts_with_artifacts_and_exposes_only_private_routes(
    artifacts_dir: Path, clean_singletons, monkeypatch
):
    monkeypatch.setenv("RECSYS_ARTIFACT_DIR", str(artifacts_dir))
    monkeypatch.setenv("RECSYS_INTERNAL_SERVICE_SECRET", "lifespan-test-secret")
    reset_settings_cache()

    app = create_private_model_app()
    with TestClient(app) as client:
        assert client.app.openapi_url is None  # no public schema
        assert client.app.docs_url is None
        routes = {
            route.path
            for route in app.routes
            if getattr(route, "include_in_schema", True)
        }
        assert routes == {
            "/internal/v1/health",
            "/internal/v1/inference",
            "/internal/v1/similarity",
        }


def test_private_app_refuses_to_start_without_artifacts(
    tmp_path: Path, clean_singletons, monkeypatch
):
    monkeypatch.setenv("RECSYS_ARTIFACT_DIR", str(tmp_path))
    reset_settings_cache()

    app = create_private_model_app()
    with pytest.raises(ArtifactsNotLoadedError):
        with TestClient(app):
            pass  # lifespan raises ArtifactsNotLoadedError on startup
