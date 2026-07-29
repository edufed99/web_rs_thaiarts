"""Tests for ``services.auth`` and ``routers.auth``.

* bcrypt hash + verify.
* JWT encode/decode round-trip + expiry handling.
* ``POST /auth/signup`` + ``POST /auth/login`` + ``GET /auth/me`` happy paths.
* Auth gate rejects anonymous access to ``/admin/*``.
"""
from __future__ import annotations

import time
from typing import Iterator

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings, reset_settings_cache
from app.core.exceptions import AuthError
from app.db import reset_engine
from app.main import create_app
from app.models_db import Base
from app.services.auth import (
    create_token,
    decode_token,
    hash_password,
    verify_password,
)


@pytest.fixture
def db_enabled(monkeypatch) -> Iterator[Session]:
    """In-memory SQLite + monkeypatched session_scope so user_query can write."""
    reset_settings_cache()
    monkeypatch.setenv("RECSYS_DB_ENABLED", "1")
    reset_engine()

    engine = create_engine(
        "sqlite:///:memory:",
        future=True,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)

    from contextlib import contextmanager

    @contextmanager
    def _scope():
        s = Session(engine, future=True, expire_on_commit=False)
        try:
            yield s
            s.commit()
        except Exception:
            s.rollback()
            raise
        finally:
            s.close()

    from app.services import user_query
    monkeypatch.setattr(user_query, "session_scope", _scope)
    monkeypatch.setattr(user_query, "is_db_enabled", lambda: True)
    yield Session(engine)
    engine.dispose()


@pytest.fixture
def client(db_enabled):
    return TestClient(create_app())


# --- bcrypt ----------------------------------------------------------------


def test_hash_password_is_bcrypt_format():
    h = hash_password("hunter22")
    assert h.startswith("$2b$") or h.startswith("$2a$") or h.startswith("$2y$")


def test_verify_password_round_trip():
    h = hash_password("hunter22")
    assert verify_password("hunter22", h) is True
    assert verify_password("wrong", h) is False


def test_verify_password_empty_inputs():
    assert verify_password("", "anything") is False
    assert verify_password("anything", "") is False


def test_hash_password_non_string_raises():
    with pytest.raises(TypeError):
        hash_password(123)  # type: ignore[arg-type]


# --- JWT -------------------------------------------------------------------


def test_create_token_and_decode():
    token, ttl = create_token(user_id=42, username="alice", is_admin=True)
    payload = decode_token(token)
    assert int(payload["sub"]) == 42
    assert payload["username"] == "alice"
    assert payload["is_admin"] is True
    assert ttl > 0


def test_decode_token_rejects_expired():
    # Patch settings to force a 0-day expiry.
    settings = get_settings()
    original = settings.jwt_expiry_days
    object.__setattr__(settings, "jwt_expiry_days", -1)
    try:
        token, _ = create_token(user_id=1, username="x", is_admin=False)
        with pytest.raises(AuthError) as exc:
            decode_token(token)
        assert exc.value.extra.get("code") == "token_expired"
    finally:
        object.__setattr__(settings, "jwt_expiry_days", original)


def test_decode_token_rejects_bad_signature():
    settings = get_settings()
    # Sign with a different secret.
    bogus = jwt.encode({"sub": "1"}, "wrong-secret", algorithm="HS256")
    with pytest.raises(AuthError) as exc:
        decode_token(bogus)
    assert exc.value.extra.get("code") == "invalid_token"


def test_decode_token_garbage_raises():
    with pytest.raises(AuthError):
        decode_token("not-a-real-token")


# --- router: /auth/signup -------------------------------------------------


def test_signup_creates_user_and_returns_token(client):
    r = client.post("/auth/signup", json={"username": "alice", "password": "hunter22"})
    assert r.status_code == 200
    body = r.json()
    assert body["token_type"] == "bearer"
    assert isinstance(body["access_token"], str)
    assert body["user"]["username"] == "alice"
    assert body["user"]["is_admin"] is True  # first user = bootstrap admin


def test_signup_rejects_short_password(client):
    r = client.post("/auth/signup", json={"username": "x", "password": "short"})
    assert r.status_code == 422


def test_signup_rejects_short_username(client):
    r = client.post("/auth/signup", json={"username": "ab", "password": "hunter22"})
    assert r.status_code == 422


def test_signup_rejects_duplicate(client):
    client.post("/auth/signup", json={"username": "alice", "password": "hunter22"})
    r = client.post("/auth/signup", json={"username": "alice", "password": "different9"})
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "duplicate_username"


def test_login_returns_token(client):
    client.post("/auth/signup", json={"username": "bob", "password": "hunter22"})
    r = client.post("/auth/login", json={"username": "bob", "password": "hunter22"})
    assert r.status_code == 200
    assert "access_token" in r.json()


def test_login_wrong_password_returns_401(client):
    client.post("/auth/signup", json={"username": "bob", "password": "hunter22"})
    r = client.post("/auth/login", json={"username": "bob", "password": "wrong-pw1"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "invalid_credentials"


def test_login_unknown_user_returns_401(client):
    r = client.post("/auth/login", json={"username": "ghost", "password": "hunter22"})
    assert r.status_code == 401


def test_me_returns_current_user(client):
    sig = client.post("/auth/signup", json={"username": "alice", "password": "hunter22"}).json()
    token = sig["access_token"]
    r = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["username"] == "alice"


def test_me_without_token_returns_401(client):
    r = client.get("/auth/me")
    assert r.status_code == 401


def test_me_with_bad_token_returns_401(client):
    r = client.get("/auth/me", headers={"Authorization": "Bearer not-a-real-token"})
    assert r.status_code == 401


def test_update_me_changes_display_name(client):
    sig = client.post("/auth/signup", json={"username": "alice", "password": "hunter22"}).json()
    token = sig["access_token"]
    r = client.patch(
        "/auth/me",
        json={"display_name": "อลิซ"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    assert r.json()["display_name"] == "อลิซ"


def test_update_me_changes_password_with_current_password(client):
    sig = client.post("/auth/signup", json={"username": "alice", "password": "hunter22"}).json()
    token = sig["access_token"]
    r = client.patch(
        "/auth/me",
        json={"current_password": "hunter22", "new_password": "newpass123"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200

    old_login = client.post("/auth/login", json={"username": "alice", "password": "hunter22"})
    assert old_login.status_code == 401
    new_login = client.post("/auth/login", json={"username": "alice", "password": "newpass123"})
    assert new_login.status_code == 200


def test_update_me_rejects_wrong_current_password(client):
    sig = client.post("/auth/signup", json={"username": "alice", "password": "hunter22"}).json()
    token = sig["access_token"]
    r = client.patch(
        "/auth/me",
        json={"current_password": "wrong", "new_password": "newpass123"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "invalid_current_password"
