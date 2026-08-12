"""API-level research flow: login -> context -> taxonomy -> E5 -> Top 10."""
from __future__ import annotations

from contextlib import contextmanager

import numpy as np
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.config import reset_settings_cache
from app.main import create_app
from app.model_loader import reset_singleton
from app.models_db import Base


def test_login_taxonomy_e5_top10(monkeypatch):
    monkeypatch.setenv("RECSYS_DB_ENABLED", "1")
    monkeypatch.setenv("RECSYS_RESEARCH_MODE", "1")
    monkeypatch.setenv("RECSYS_PRELOAD_E5", "0")
    reset_settings_cache()
    reset_singleton()

    engine = create_engine(
        "sqlite:///:memory:",
        future=True,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)

    @contextmanager
    def scope():
        session = Session(engine, future=True, expire_on_commit=False)
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    from app.routers import auth as auth_router
    from app.services import cbf_service, user_query
    from app.services import recommendation_service

    monkeypatch.setattr(auth_router, "is_db_enabled", lambda: True)
    monkeypatch.setattr(user_query, "is_db_enabled", lambda: True)
    monkeypatch.setattr(user_query, "session_scope", scope)
    monkeypatch.setattr(
        cbf_service,
        "encode_query",
        lambda _text: np.ones(1024, dtype=np.float32) / np.sqrt(1024),
    )
    monkeypatch.setattr(recommendation_service, "live_user_negative_ratings", lambda *_a, **_k: {})
    monkeypatch.setattr(recommendation_service, "live_user_state_for_items", lambda *_a, **_k: {})
    monkeypatch.setattr(
        recommendation_service,
        "_persist_request_and_recompute_online_eval",
        lambda *_a, **_k: 0,
    )

    with TestClient(create_app()) as client:
        assert client.post(
            "/auth/signup", json={"username": "research-user", "password": "hunter22"}
        ).status_code == 200
        login = client.post(
            "/auth/login", json={"username": "research-user", "password": "hunter22"}
        )
        assert login.status_code == 200
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

        contexts = client.get("/contexts").json()["contexts"]
        assert contexts
        chosen = contexts[0]
        keywords = client.get(
            "/keywords", params={"context_id": chosen["id"], "limit": 1000}
        ).json()["keywords"]
        taxonomy_keywords = [row for row in keywords if row["taxonomy_path"]]
        assert taxonomy_keywords

        response = client.post(
            "/recommendations",
            headers=headers,
            json={
                "context_id": chosen["id"],
                "keyword_ids": [row["id"] for row in taxonomy_keywords[:3]],
                "top_k": 10,
            },
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["embedding_backend"] == "e5"
        assert len(body["results"]) == 10
        assert [row["rank"] for row in body["results"]] == list(range(1, 11))

    engine.dispose()
    reset_singleton()
    reset_settings_cache()
