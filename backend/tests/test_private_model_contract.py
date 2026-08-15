"""Contract tests for the database-free Private Model Service."""
from __future__ import annotations

import hashlib
from importlib import import_module

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.core.config import reset_settings_cache
from app.model_loader import reset_singleton


def item_id(name: str) -> int:
    digest = hashlib.sha256(f"item::{name}".encode("utf-8")).hexdigest()
    return int(digest[:7], 16)


@pytest.fixture
def private_client(artifacts_dir, monkeypatch):
    """Run the isolated model app against deterministic fixture artifacts."""
    vectors = np.asarray(
        [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
            [-1.0, 0.0, 0.0, 0.0],
        ],
        dtype=np.float32,
    )
    np.savez_compressed(artifacts_dir / "models" / "item_embeddings.npz", vectors=vectors)

    monkeypatch.setenv("RECSYS_ARTIFACT_DIR", str(artifacts_dir))
    monkeypatch.setenv("RECSYS_INTERNAL_SERVICE_SECRET", "contract-test-secret")
    reset_settings_cache()
    reset_singleton()

    private_main = import_module("app.private_main")
    with TestClient(private_main.create_private_model_app()) as client:
        yield client

    reset_singleton()
    reset_settings_cache()


def _auth(secret: str = "contract-test-secret") -> dict[str, str]:
    return {"Authorization": f"Bearer {secret}"}


def _request() -> dict:
    return {
        "eligible_candidate_ids": [
            item_id("ระบำพรหมาสตร์"),
            item_id("โขน"),
            item_id("วงดนตรีไทย"),
        ],
        "personalization": {
            "context_name": "งานบวช",
            "keyword_names": ["ผู้หญิง"],
            "positive_history": [
                {"artifact_item_id": item_id("หุ่นกระบอก"), "rating_weight": 1.0}
            ],
            "negative_ratings": [],
        },
        "top_k": 3,
    }


def test_private_app_exposes_only_versioned_authenticated_model_routes(private_client):
    route_paths = {
        route.path
        for route in private_client.app.routes
        if getattr(route, "include_in_schema", True)
    }
    assert route_paths == {
        "/internal/v1/health",
        "/internal/v1/inference",
        "/internal/v1/similarity",
    }


@pytest.fixture
def similarity_client(artifacts_dir, monkeypatch):
    """Use vectors where embedding order intentionally opposes metadata order."""
    vectors = np.asarray(
        [
            [1.0, 0.0],   # ระบำ: strongest embedding match for reference
            [1.0, 0.0],   # โขน: reference
            [0.7, 0.7],   # ลิเก: middle embedding match
            [-1.0, 0.0],  # หุ่น: strongest metadata match, opposite embedding
            [0.0, 1.0],
        ],
        dtype=np.float32,
    )
    vectors /= np.linalg.norm(vectors, axis=1, keepdims=True)
    np.savez_compressed(artifacts_dir / "models" / "item_embeddings.npz", vectors=vectors)

    monkeypatch.setenv("RECSYS_ARTIFACT_DIR", str(artifacts_dir))
    monkeypatch.setenv("RECSYS_INTERNAL_SERVICE_SECRET", "contract-test-secret")
    reset_settings_cache()
    reset_singleton()
    private_main = import_module("app.private_main")
    with TestClient(private_main.create_private_model_app()) as client:
        yield client
    reset_singleton()
    reset_settings_cache()


def test_similarity_ranks_multiple_candidates_by_artifact_similarity(similarity_client):
    response = similarity_client.post(
        "/internal/v1/similarity",
        headers=_auth(),
        json={
            "reference_artifact_item_id": item_id("โขน"),
            "candidate_artifact_item_ids": [
                item_id("หุ่นกระบอก"),
                item_id("ลิเก"),
                item_id("ระบำพรหมาสตร์"),
            ],
            "limit": 3,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"ranked_candidates"}
    assert [row["artifact_item_id"] for row in body["ranked_candidates"]] == [
        item_id("ระบำพรหมาสตร์"),
        item_id("ลิเก"),
        item_id("หุ่นกระบอก"),
    ]
    assert all(set(row) == {"artifact_item_id", "score"} for row in body["ranked_candidates"])


def test_similarity_rejects_unknown_artifact_identifiers(private_client):
    response = private_client.post(
        "/internal/v1/similarity",
        headers=_auth(),
        json={
            "reference_artifact_item_id": item_id("โขน"),
            "candidate_artifact_item_ids": [999_999_999],
            "limit": 1,
        },
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_inference_request"


@pytest.mark.parametrize(
    "headers",
    [{}, _auth("wrong-secret")],
    ids=["missing", "invalid"],
)
def test_inference_rejects_missing_or_invalid_internal_credential(private_client, headers):
    response = private_client.post("/internal/v1/inference", json=_request(), headers=headers)

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_internal_service_credential"


def test_inference_returns_ordered_artifact_ids_and_scores_only(private_client, monkeypatch):
    """A DB call or browser-facing enrichment would make this contract test fail."""
    from app.services import db_query

    def db_access_forbidden(*_args, **_kwargs):
        raise AssertionError("Private Model Service attempted PostgreSQL access")

    for name in (
        "live_positive_users_per_item_artifact",
        "live_user_positive_items",
        "live_user_negative_ratings",
        "live_user_state_for_items",
        "live_item_media_for_items",
    ):
        if hasattr(db_query, name):
            monkeypatch.setattr(db_query, name, db_access_forbidden)

    response = private_client.post(
        "/internal/v1/inference", json=_request(), headers=_auth()
    )

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"ranked_candidates"}
    assert [row["artifact_item_id"] for row in body["ranked_candidates"]] == [
        item_id("ระบำพรหมาสตร์"),
        item_id("โขน"),
        item_id("วงดนตรีไทย"),
    ]
    for row in body["ranked_candidates"]:
        assert set(row) == {"artifact_item_id", "scores"}
        assert set(row["scores"]) == {"cbf", "cf", "final"}
        assert all(isinstance(value, float) for value in row["scores"].values())


def test_live_negative_rating_monotonically_demotes_candidate(private_client):
    request = _request()
    request["personalization"]["negative_ratings"] = [
        {"artifact_item_id": item_id("ระบำพรหมาสตร์"), "rating": 1}
    ]

    response = private_client.post(
        "/internal/v1/inference", json=request, headers=_auth()
    )

    assert response.status_code == 200
    assert response.json()["ranked_candidates"][0]["artifact_item_id"] == item_id("โขน")


@pytest.mark.parametrize(
    "mutate",
    [
        lambda request: request.update(eligible_candidate_ids=[]),
        lambda request: request.update(eligible_candidate_ids=[999_999_999]),
        lambda request: request["personalization"].update(
            positive_history=[{"artifact_item_id": item_id("โขน"), "rating_weight": 1.5}]
        ),
        lambda request: request.update(unexpected_browser_field={"image_url": "/uploads/x"}),
    ],
    ids=["empty-candidates", "unknown-candidate", "invalid-weight", "extra-field"],
)
def test_inference_rejects_malformed_inputs(private_client, mutate):
    request = _request()
    mutate(request)

    response = private_client.post(
        "/internal/v1/inference", json=request, headers=_auth()
    )

    assert response.status_code in {400, 422}


def test_private_health_requires_internal_credential(private_client):
    assert private_client.get("/internal/v1/health").status_code == 401

    response = private_client.get("/internal/v1/health", headers=_auth())
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
