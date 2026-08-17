"""Tests for ``services.auth`` and ``routers.auth``.

* bcrypt hash + verify.
* JWT encode/decode round-trip + expiry handling.
* ``POST /auth/signup`` + ``POST /auth/login`` + ``GET /auth/me`` happy paths.
* Auth gate rejects anonymous access to ``/admin/*``.
"""
from __future__ import annotations

import time
from types import SimpleNamespace
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
    """In-memory SQLite + monkeypatched session_scope so identity can write."""
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

    import app.db as db_module
    from app.services import member_query
    monkeypatch.setattr(db_module, "session_scope", _scope)
    monkeypatch.setattr(db_module, "is_db_enabled", lambda: True)
    monkeypatch.setattr(member_query, "session_scope", _scope)
    monkeypatch.setattr(member_query, "is_db_enabled", lambda: True)
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


def test_google_login_start_sets_state_cookie(client, monkeypatch):
    from app.routers import auth as auth_router

    monkeypatch.setattr(
        auth_router.google_login_oauth,
        "start_authorization",
        lambda next_path: ("https://accounts.example/authorize", "state-123"),
    )
    response = client.get(
        "/auth/google/login/start?next=/profile", follow_redirects=False
    )
    assert response.status_code == 303
    assert response.headers["location"] == "https://accounts.example/authorize"
    assert "thaiperform_google_login_state=state-123" in response.headers["set-cookie"]


def test_google_login_callback_issues_one_time_code(client, monkeypatch):
    from app.routers import auth as auth_router
    from app.services.google_login_oauth import GoogleIdentity

    identity = GoogleIdentity("sub", "person@gmail.com", "Person", "")
    monkeypatch.setattr(
        auth_router.google_login_oauth,
        "complete_authorization",
        lambda *_: (identity, "/profile"),
    )
    monkeypatch.setattr(
        auth_router.identity,
        "resolve_google_identity",
        lambda **_: (SimpleNamespace(id=17), "created"),
    )
    monkeypatch.setattr(auth_router.identity, "set_last_login", lambda *_: None)
    monkeypatch.setattr(
        auth_router.google_login_oauth, "issue_login_code", lambda *_: "exchange-code"
    )
    client.cookies.set(
        auth_router.google_login_oauth.STATE_COOKIE,
        "state-123",
        path="/auth/google/login/callback",
    )
    response = client.get(
        "/auth/google/login/callback?code=google-code&state=state-123",
        follow_redirects=False,
    )
    assert response.status_code == 303
    assert "code=exchange-code" in response.headers["location"]
    assert "next=%2Fprofile" in response.headers["location"]


def test_google_login_callback_rejects_mismatched_state(client):
    response = client.get(
        "/auth/google/login/callback?code=google-code&state=wrong",
        follow_redirects=False,
    )
    assert response.status_code == 303
    assert "error=invalid_google_state" in response.headers["location"]


def test_google_avatar_cache_does_not_overwrite_member_upload(monkeypatch):
    from app.routers import auth as auth_router

    monkeypatch.setattr(
        auth_router.identity,
        "get_member_profile",
        lambda *_: {"avatar_url": "/uploads/profiles/member-choice.jpg"},
    )
    called = []
    monkeypatch.setattr(
        auth_router.storage,
        "save_remote_image",
        lambda *_args, **_kwargs: called.append(True),
    )

    auth_router._mirror_google_avatar(
        SimpleNamespace(id=5),
        "https://lh3.googleusercontent.com/a/google-photo",
    )

    assert called == []


def test_google_login_exchange_returns_app_jwt(client, monkeypatch):
    from app.routers import auth as auth_router

    signup_response = client.post(
        "/auth/signup",
        json={"username": "google_member", "password": "secret123"},
    )
    user_id = signup_response.json()["user"]["id"]
    monkeypatch.setattr(
        auth_router.google_login_oauth,
        "consume_login_code",
        lambda *_: (user_id, "/recommend"),
    )
    response = client.post(
        "/auth/google/login/exchange", json={"code": "x" * 24}
    )
    assert response.status_code == 200
    assert response.json()["user"]["id"] == user_id
    assert response.json()["access_token"]


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
    r = client.post(
        "/auth/signup",
        json={"username": "alice", "email": " Alice@Example.COM ", "password": "hunter22"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["token_type"] == "bearer"
    assert isinstance(body["access_token"], str)
    assert body["user"]["username"] == "alice"
    assert body["user"]["email"] == "alice@example.com"
    assert body["user"]["is_admin"] is True  # first user = bootstrap admin
    assert body["user"]["role"] == "super_admin"


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
    assert r.json()["role"] == "super_admin"


def test_member_profile_is_self_editable_but_role_is_forbidden(client):
    sig = client.post(
        "/auth/signup",
        json={"username": "alice", "password": "hunter22", "display_name": "Alice"},
    ).json()
    headers = {"Authorization": f"Bearer {sig['access_token']}"}

    before = client.get("/me/profile", headers=headers)
    assert before.status_code == 200
    assert before.json()["role"] == "super_admin"

    updated = client.patch(
        "/me/profile",
        json={"display_name": "อลิซ", "avatar_url": "https://example.com/a.jpg", "bio": "สนใจนาฏศิลป์"},
        headers=headers,
    )
    assert updated.status_code == 200
    assert updated.json()["display_name"] == "อลิซ"
    assert updated.json()["bio"] == "สนใจนาฏศิลป์"
    assert updated.json()["role"] == "super_admin"

    escalation = client.patch(
        "/me/profile",
        json={"role": "user"},
        headers=headers,
    )
    assert escalation.status_code == 422
    assert client.get("/me/profile", headers=headers).json()["role"] == "super_admin"


def test_member_can_upload_and_remove_avatar(client, tmp_path):
    settings = get_settings()
    original_upload_dir = settings.upload_dir
    object.__setattr__(settings, "upload_dir", tmp_path)
    try:
        signup = client.post("/auth/signup", json={"username": "avataruser", "password": "hunter22"}).json()
        headers = {"Authorization": f"Bearer {signup['access_token']}"}
        png = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\r" + b"IHDR" + b"\x00" * 13
        uploaded = client.post(
            "/me/profile/avatar",
            files={"file": ("avatar.png", png, "image/png")},
            headers=headers,
        )
        assert uploaded.status_code == 200, uploaded.text
        url = uploaded.json()["avatar_url"]
        assert url.startswith("/uploads/profiles/user-")
        assert (tmp_path / url.removeprefix("/uploads/")).exists()

        removed = client.delete("/me/profile/avatar", headers=headers)
        assert removed.status_code == 200
        assert removed.json()["avatar_url"] == ""
        assert not (tmp_path / url.removeprefix("/uploads/")).exists()
    finally:
        object.__setattr__(settings, "upload_dir", original_upload_dir)


def test_member_dashboard_requires_auth_and_returns_profile(client):
    assert client.get("/me/dashboard").status_code == 401
    sig = client.post("/auth/signup", json={"username": "member", "password": "hunter22"}).json()
    headers = {"Authorization": f"Bearer {sig['access_token']}"}
    response = client.get("/me/dashboard", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["profile"]["username"] == "member"
    assert body["summary"]["liked_count"] == 0
    assert body["recent_views"]["items"] == []


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


def test_update_me_changes_username_with_current_password(client):
    sig = client.post("/auth/signup", json={"username": "alice", "password": "hunter22"}).json()
    token = sig["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    updated = client.patch(
        "/auth/me",
        json={"username": "alice-new", "current_password": "hunter22"},
        headers=headers,
    )

    assert updated.status_code == 200
    assert updated.json()["username"] == "alice-new"
    assert client.post("/auth/login", json={"username": "alice", "password": "hunter22"}).status_code == 401
    assert client.post("/auth/login", json={"username": "alice-new", "password": "hunter22"}).status_code == 200


def test_update_me_username_requires_correct_current_password(client):
    sig = client.post("/auth/signup", json={"username": "alice", "password": "hunter22"}).json()
    headers = {"Authorization": f"Bearer {sig['access_token']}"}

    missing = client.patch("/auth/me", json={"username": "alice-new"}, headers=headers)
    wrong = client.patch(
        "/auth/me",
        json={"username": "alice-new", "current_password": "wrong"},
        headers=headers,
    )

    assert missing.status_code == 400
    assert missing.json()["error"]["code"] == "current_password_required"
    assert wrong.status_code == 401
    assert wrong.json()["error"]["code"] == "invalid_current_password"


def test_update_me_rejects_duplicate_username(client):
    first = client.post("/auth/signup", json={"username": "alice", "password": "hunter22"}).json()
    client.post("/auth/signup", json={"username": "bob", "password": "hunter22"})

    duplicate = client.patch(
        "/auth/me",
        json={"username": "bob", "current_password": "hunter22"},
        headers={"Authorization": f"Bearer {first['access_token']}"},
    )

    assert duplicate.status_code == 400
    assert duplicate.json()["error"]["code"] == "duplicate_username"


def test_update_me_changes_email_with_current_password(client):
    sig = client.post(
        "/auth/signup",
        json={"username": "alice", "email": "old@example.com", "password": "hunter22"},
    ).json()
    headers = {"Authorization": f"Bearer {sig['access_token']}"}

    missing_password = client.patch(
        "/auth/me", json={"email": "new@example.com"}, headers=headers
    )
    updated = client.patch(
        "/auth/me",
        json={"email": " NEW@example.com ", "current_password": "hunter22"},
        headers=headers,
    )

    assert missing_password.status_code == 400
    assert missing_password.json()["error"]["code"] == "current_password_required"
    assert updated.status_code == 200
    assert updated.json()["email"] == "new@example.com"


def test_password_reset_email_flow_is_one_time(client, monkeypatch):
    from app.services import mailer

    captured = {}

    def fake_send(email, username, token):
        captured.update(email=email, username=username, token=token)
        return True

    monkeypatch.setattr(mailer, "delivery_configured", lambda: True)
    monkeypatch.setattr(mailer, "send_password_reset_email", fake_send)
    client.post(
        "/auth/signup",
        json={
            "username": "legacy-user",
            "email": "member@example.com",
            "password": "oldpass123",
            "display_name": "must_reset|legacy:legacy-user",
        },
    )

    requested = client.post(
        "/auth/password-reset/request",
        json={"username": "legacy-user", "email": "MEMBER@example.com"},
    )
    assert requested.status_code == 200
    assert requested.json()["accepted"] is True
    assert requested.json()["credentials_valid"] is True
    assert requested.json()["email_sent"] is True
    assert requested.json()["delivery_configured"] is True
    assert captured["email"] == "member@example.com"
    assert len(captured["token"]) >= 20

    confirmed = client.post(
        "/auth/password-reset/confirm",
        json={
            "username": "legacy-user",
            "token": captured["token"],
            "new_password": "newpass123",
        },
    )
    assert confirmed.status_code == 200
    assert client.post(
        "/auth/login", json={"username": "legacy-user", "password": "oldpass123"}
    ).status_code == 401
    login = client.post(
        "/auth/login", json={"username": "legacy-user", "password": "newpass123"}
    )
    assert login.status_code == 200
    assert login.json()["user"]["display_name"] == "legacy-user"

    reused = client.post(
        "/auth/password-reset/confirm",
        json={
            "username": "legacy-user",
            "token": captured["token"],
            "new_password": "another123",
        },
    )
    assert reused.status_code == 400
    assert reused.json()["error"]["code"] == "invalid_reset_token"


def test_password_reset_request_reports_invalid_account_details(client, monkeypatch):
    from app.services import mailer

    sent = []
    monkeypatch.setattr(mailer, "delivery_configured", lambda: True)
    monkeypatch.setattr(
        mailer,
        "send_password_reset_email",
        lambda *args: sent.append(args) or True,
    )

    response = client.post(
        "/auth/password-reset/request",
        json={"username": "unknown", "email": "unknown@example.com"},
    )

    assert response.status_code == 200
    assert response.json()["accepted"] is False
    assert response.json()["credentials_valid"] is False
    assert response.json()["email_sent"] is False
    assert response.json()["message"] == "ชื่อผู้ใช้หรืออีเมลไม่ถูกต้อง กรุณาตรวจสอบข้อมูลอีกครั้ง"
    assert sent == []


def test_undelivered_password_reset_token_is_revoked(client, monkeypatch):
    from app.services import mailer

    captured = {}

    def failed_send(_email, _username, token):
        captured["token"] = token
        return False

    monkeypatch.setattr(mailer, "delivery_configured", lambda: False)
    monkeypatch.setattr(mailer, "send_password_reset_email", failed_send)
    client.post(
        "/auth/signup",
        json={"username": "alice", "email": "alice@example.com", "password": "hunter22"},
    )
    requested = client.post(
        "/auth/password-reset/request",
        json={"username": "alice", "email": "alice@example.com"},
    )
    assert requested.json()["credentials_valid"] is True
    assert requested.json()["email_sent"] is False
    assert requested.json()["accepted"] is False

    rejected = client.post(
        "/auth/password-reset/confirm",
        json={"username": "alice", "token": captured["token"], "new_password": "newpass123"},
    )
    assert rejected.status_code == 400
    assert rejected.json()["error"]["code"] == "invalid_reset_token"


def test_mailer_reports_unconfigured(monkeypatch):
    from app.services import mailer

    settings = SimpleNamespace(
        smtp_host="smtp.gmail.com",
        smtp_username="",
        smtp_password="",
        smtp_from_email="",
    )
    monkeypatch.setattr(mailer, "get_settings", lambda: settings)

    assert mailer.delivery_configured() is False
    assert mailer.send_password_reset_email("member@example.com", "alice", "token") is False


def test_mailer_sends_tls_message(monkeypatch):
    from app.services import mailer

    settings = SimpleNamespace(
        smtp_host="smtp.gmail.com",
        smtp_port=587,
        smtp_username="sender@example.com",
        smtp_password="app-password",
        smtp_from_email="sender@example.com",
        smtp_use_tls=True,
        frontend_base_url="http://localhost:3000",
        password_reset_token_minutes=30,
    )
    calls = []

    class FakeSMTP:
        def __init__(self, host, port, timeout):
            calls.append(("connect", host, port, timeout))

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def starttls(self):
            calls.append(("starttls",))

        def login(self, username, password):
            calls.append(("login", username, password))

        def send_message(self, message):
            calls.append(("send", message["To"], message.get_content()))

    monkeypatch.setattr(mailer, "get_settings", lambda: settings)
    monkeypatch.setattr(mailer.smtplib, "SMTP", FakeSMTP)

    assert mailer.send_password_reset_email("member@example.com", "alice", "raw-token") is True
    assert ("starttls",) in calls
    sent = next(call for call in calls if call[0] == "send")
    assert sent[1] == "member@example.com"
    assert "reset-password" in sent[2]


def test_mailer_handles_smtp_failure(monkeypatch):
    from app.services import mailer

    settings = SimpleNamespace(
        smtp_host="smtp.gmail.com",
        smtp_port=587,
        smtp_username="sender@example.com",
        smtp_password="app-password",
        smtp_from_email="sender@example.com",
        smtp_use_tls=True,
        frontend_base_url="http://localhost:3000",
        password_reset_token_minutes=30,
    )
    monkeypatch.setattr(mailer, "get_settings", lambda: settings)
    monkeypatch.setattr(
        mailer.smtplib,
        "SMTP",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError("offline")),
    )

    assert mailer.send_password_reset_email("member@example.com", "alice", "raw-token") is False


def test_legacy_reset_marker_survives_profile_edit_until_password_change(client):
    sig = client.post(
        "/auth/signup",
        json={
            "username": "legacy-user",
            "password": "hunter22",
            "display_name": "must_reset|legacy:legacy-user",
        },
    ).json()
    headers = {"Authorization": f"Bearer {sig['access_token']}"}

    profile_update = client.patch(
        "/me/profile",
        json={"display_name": "ชื่อใหม่"},
        headers=headers,
    )
    assert profile_update.status_code == 200
    assert profile_update.json()["display_name"] == "ชื่อใหม่"
    assert profile_update.json()["requires_password_reset"] is True

    password_update = client.patch(
        "/auth/me",
        json={"current_password": "hunter22", "new_password": "newpass123"},
        headers=headers,
    )
    assert password_update.status_code == 200
    assert password_update.json()["display_name"] == "ชื่อใหม่"
    assert password_update.json()["requires_password_reset"] is False
    assert client.get("/me/profile", headers=headers).json()["display_name"] == "ชื่อใหม่"
    assert client.get("/me/profile", headers=headers).json()["requires_password_reset"] is False


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


def test_update_me_requires_current_password(client):
    sig = client.post("/auth/signup", json={"username": "alice", "password": "hunter22"}).json()
    token = sig["access_token"]

    r = client.patch(
        "/auth/me",
        json={"new_password": "newpass123"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert r.status_code == 400
    assert r.json()["error"]["code"] == "current_password_required"
