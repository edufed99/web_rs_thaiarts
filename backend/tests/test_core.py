"""Tests for core config and exceptions."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config import (
    Settings,
    get_settings,
    reset_settings_cache,
    settings_with_artifact_config,
)
from app.core.exceptions import (
    ArtifactsNotLoadedError,
    ContextNotFoundError,
    DomainError,
    InvalidRequestError,
    ItemNotFoundError,
    KeywordNotFoundError,
    register_exception_handlers,
)


# --- Settings ---

def test_settings_defaults(monkeypatch):
    monkeypatch.delenv("RECSYS_ARTIFACT_DIR", raising=False)
    s = Settings()
    assert s.hybrid_alpha == 0.7
    assert s.itemknn_k == 10
    assert s.cbf_keyword_boost == 0.05
    assert s.positive_threshold == 4
    assert s.default_top_k == 10


def test_settings_models_and_outputs_dirs(artifacts_dir):
    s = Settings(artifact_dir=artifacts_dir)
    assert s.models_dir == artifacts_dir / "models"
    assert s.outputs_dir == artifacts_dir / "outputs"


def test_settings_max_cands_env_parsing(monkeypatch):
    monkeypatch.setenv("RECSYS_MAX_CANDS", "")
    s = Settings()
    assert s.max_cands is None
    monkeypatch.setenv("RECSYS_MAX_CANDS", "20")
    s = Settings()
    assert s.max_cands == 20


def test_settings_with_artifact_config_overrides_serving_fields():
    base = Settings()
    out = settings_with_artifact_config(
        base,
        {
            "selected_model": {
                "max_cands": 20,
                "top_k": 10,
                "cbf_model": "intfloat/multilingual-e5-large-instruct",
                "cbf_keyword_boost": 0.05,
                "itemknn_k": 10,
                "itemknn_shrink": 50.0,
                "hybrid_alpha": 0.8,
                "method": "Hybrid-WeightedSum",
            }
        },
    )
    assert out.max_cands == 20
    assert out.default_top_k == 10
    assert out.hybrid_alpha == 0.8
    assert out.e5_model_name == "intfloat/multilingual-e5-large-instruct"
    assert out.recommendation_method == "Hybrid-WeightedSum"


def test_settings_with_artifact_config_ignores_bad_manifest():
    base = Settings()
    out = settings_with_artifact_config(base, {"selected_model": {"hybrid_alpha": "bad"}})
    assert out.hybrid_alpha == base.hybrid_alpha


def test_settings_cors_split(monkeypatch):
    # Env values are comma-separated strings; the ``_split_cors`` validator
    # parses them into a list. We assert on ``cors_origins_list``.
    monkeypatch.setenv("RECSYS_CORS_ORIGINS", "http://a,http://b")
    s = Settings()
    assert s.cors_origins_list == ["http://a", "http://b"]


def test_settings_cors_default():
    s = Settings()
    assert s.cors_origins_list == ["http://localhost:3000", "http://127.0.0.1:3000"]


def test_get_settings_is_singleton(monkeypatch):
    reset_settings_cache()
    a = get_settings()
    b = get_settings()
    assert a is b
    reset_settings_cache()
    c = get_settings()
    assert c is not a


# --- Exceptions ---

def test_domain_error_has_code_and_message():
    e = DomainError("boom")
    assert e.message == "boom"
    assert e.code == "bad_request"
    assert e.status_code == 400


def test_subclasses_have_own_codes():
    assert ArtifactsNotLoadedError("x").status_code == 503
    assert ArtifactsNotLoadedError("x").code == "artifacts_not_loaded"
    assert ContextNotFoundError("x").code == "context_not_found"
    assert ItemNotFoundError("x").code == "item_not_found"
    assert KeywordNotFoundError("x").code == "keyword_not_found"
    assert InvalidRequestError("x").code == "invalid_request"


def test_extra_field_is_carried():
    e = ItemNotFoundError("nope", extra={"item_id": 42})
    assert e.extra == {"item_id": 42}


def test_handlers_format_json_response():
    app = FastAPI()
    register_exception_handlers(app)

    @app.get("/raise/{item_id}")
    def _raise(item_id: int):
        raise ItemNotFoundError(f"missing {item_id}", extra={"item_id": item_id})

    c = TestClient(app, raise_server_exceptions=False)
    r = c.get("/raise/42")
    assert r.status_code == 404
    body = r.json()
    assert body["error"]["code"] == "item_not_found"
    assert "missing 42" in body["error"]["message"]
    assert body["error"]["item_id"] == 42


def test_validation_error_handler():
    from pydantic import BaseModel, Field

    class M(BaseModel):
        n: int = Field(..., gt=0)

    app = FastAPI()
    register_exception_handlers(app)

    @app.post("/validate")
    def _v(m: M):
        return {"ok": True}

    c = TestClient(app, raise_server_exceptions=False)
    r = c.post("/validate", json={"n": -1})
    assert r.status_code == 422
    body = r.json()
    assert body["error"]["code"] == "validation_error"
    assert "errors" in body["error"]


def test_unexpected_error_handler_returns_json_500():
    app = FastAPI()
    register_exception_handlers(app)

    @app.get("/explode")
    def _explode():
        raise RuntimeError("database detail must not leak")

    c = TestClient(app, raise_server_exceptions=False)
    r = c.get("/explode")
    assert r.status_code == 500
    assert r.json() == {
        "error": {
            "code": "internal_server_error",
            "message": "The server could not complete this request.",
        }
    }
    assert "database detail" not in r.text
