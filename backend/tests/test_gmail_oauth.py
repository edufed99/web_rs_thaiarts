"""Unit tests for the admin-only Gmail OAuth sender integration."""
from __future__ import annotations

import json
from types import SimpleNamespace
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse

import pytest

from app.services import gmail_oauth, mailer


def _settings(tmp_path, **overrides):
    values = {
        "gmail_oauth_client_file": None,
        "gmail_oauth_client_id": "client-id",
        "gmail_oauth_client_secret": "client-secret",
        "gmail_oauth_refresh_token": "",
        "gmail_oauth_redirect_uri": "http://localhost:8001/auth/google/callback",
        "gmail_oauth_token_file": tmp_path / "gmail-token.json",
        "gmail_sender_email": "adminrstpa@gmail.com",
        "frontend_base_url": "http://localhost:3000",
        "password_reset_token_minutes": 30,
        "smtp_host": "",
        "smtp_port": 587,
        "smtp_username": "",
        "smtp_password": "",
        "smtp_from_email": "",
        "smtp_use_tls": True,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


@pytest.fixture(autouse=True)
def _clear_oauth_state():
    gmail_oauth._pending.clear()
    gmail_oauth._access_cache = None
    yield
    gmail_oauth._pending.clear()
    gmail_oauth._access_cache = None


def test_load_client_from_web_json(tmp_path, monkeypatch):
    client_file = tmp_path / "client.json"
    client_file.write_text(
        json.dumps(
            {
                "web": {
                    "client_id": "json-id",
                    "client_secret": "json-secret",
                    "auth_uri": "https://accounts.example/auth",
                    "token_uri": "https://accounts.example/token",
                }
            }
        ),
        encoding="utf-8",
    )
    settings = _settings(
        tmp_path,
        gmail_oauth_client_id="",
        gmail_oauth_client_secret="",
        gmail_oauth_client_file=client_file,
    )
    monkeypatch.setattr(gmail_oauth, "get_settings", lambda: settings)
    client = gmail_oauth.load_client()
    assert client.client_id == "json-id"
    assert client.token_uri == "https://accounts.example/token"
    assert gmail_oauth.client_configured() is True


@pytest.mark.parametrize("content", ["not-json", "[]", '{"installed": {}}'])
def test_load_client_rejects_invalid_file(tmp_path, monkeypatch, content):
    client_file = tmp_path / "bad.json"
    client_file.write_text(content, encoding="utf-8")
    settings = _settings(
        tmp_path,
        gmail_oauth_client_id="",
        gmail_oauth_client_secret="",
        gmail_oauth_client_file=client_file,
    )
    monkeypatch.setattr(gmail_oauth, "get_settings", lambda: settings)
    with pytest.raises(gmail_oauth.GmailOAuthError):
        gmail_oauth.load_client()
    assert gmail_oauth.client_configured() is False


def test_start_and_complete_authorization(tmp_path, monkeypatch):
    settings = _settings(tmp_path)
    monkeypatch.setattr(gmail_oauth, "get_settings", lambda: settings)
    url = gmail_oauth.start_authorization()
    params = parse_qs(urlparse(url).query)
    assert params["scope"] == [gmail_oauth.GMAIL_SEND_SCOPE]
    assert params["code_challenge_method"] == ["S256"]
    state = params["state"][0]
    captured = {}

    def fake_post(url, fields):
        captured.update(fields)
        return {"refresh_token": "refresh-value", "scope": gmail_oauth.GMAIL_SEND_SCOPE}

    monkeypatch.setattr(gmail_oauth, "_post_form", fake_post)
    gmail_oauth.complete_authorization("one-time-code", state)
    assert captured["code_verifier"]
    assert json.loads(settings.gmail_oauth_token_file.read_text())["refresh_token"] == "refresh-value"
    assert gmail_oauth.authorized() is True


def test_complete_rejects_bad_state_or_missing_refresh_token(tmp_path, monkeypatch):
    settings = _settings(tmp_path)
    monkeypatch.setattr(gmail_oauth, "get_settings", lambda: settings)
    with pytest.raises(gmail_oauth.GmailOAuthError, match="state"):
        gmail_oauth.complete_authorization("code", "missing")

    state = parse_qs(urlparse(gmail_oauth.start_authorization()).query)["state"][0]
    monkeypatch.setattr(gmail_oauth, "_post_form", lambda *_: {"access_token": "temporary"})
    with pytest.raises(gmail_oauth.GmailOAuthError, match="refresh token"):
        gmail_oauth.complete_authorization("code", state)


def test_get_access_token_refreshes_once_then_uses_cache(tmp_path, monkeypatch):
    settings = _settings(tmp_path, gmail_oauth_refresh_token="refresh-from-env")
    monkeypatch.setattr(gmail_oauth, "get_settings", lambda: settings)
    calls = []

    def fake_post(url, fields):
        calls.append(fields)
        return {"access_token": "access-value", "expires_in": 3600}

    monkeypatch.setattr(gmail_oauth, "_post_form", fake_post)
    assert gmail_oauth.get_access_token() == "access-value"
    assert gmail_oauth.get_access_token() == "access-value"
    assert len(calls) == 1


def test_get_access_token_requires_authorization(tmp_path, monkeypatch):
    settings = _settings(tmp_path)
    monkeypatch.setattr(gmail_oauth, "get_settings", lambda: settings)
    assert gmail_oauth.authorized() is False
    with pytest.raises(gmail_oauth.GmailOAuthError, match="not been authorized"):
        gmail_oauth.get_access_token()


class _FakeResponse:
    status = 200

    def __init__(self, body: bytes):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self):
        return self.body


def test_post_form_parses_json_and_sanitizes_failures(monkeypatch):
    monkeypatch.setattr(gmail_oauth, "urlopen", lambda *_args, **_kwargs: _FakeResponse(b'{"ok": true}'))
    assert gmail_oauth._post_form("https://example/token", {"x": "y"}) == {"ok": True}

    def http_failure(*_args, **_kwargs):
        raise HTTPError("https://example/token", 400, "bad", {}, None)

    monkeypatch.setattr(gmail_oauth, "urlopen", http_failure)
    with pytest.raises(gmail_oauth.GmailOAuthError, match="400"):
        gmail_oauth._post_form("https://example/token", {})

    monkeypatch.setattr(gmail_oauth, "urlopen", lambda *_args, **_kwargs: (_ for _ in ()).throw(URLError("offline")))
    with pytest.raises(gmail_oauth.GmailOAuthError, match="failed"):
        gmail_oauth._post_form("https://example/token", {})


def test_mailer_sends_through_gmail_api(tmp_path, monkeypatch):
    settings = _settings(tmp_path, gmail_oauth_refresh_token="refresh")
    monkeypatch.setattr(mailer, "get_settings", lambda: settings)
    monkeypatch.setattr(gmail_oauth, "get_settings", lambda: settings)
    monkeypatch.setattr(gmail_oauth, "get_access_token", lambda: "access")
    monkeypatch.setattr(mailer, "urlopen", lambda *_args, **_kwargs: _FakeResponse(b"{}"))
    assert mailer.delivery_configured() is True
    assert mailer.send_password_reset_email("member@example.com", "alice", "raw-token") is True


def test_admin_oauth_helpers_do_not_expose_secrets(tmp_path, monkeypatch):
    from app.routers import admin, auth

    settings = _settings(tmp_path)
    monkeypatch.setattr(admin, "get_settings", lambda: settings)
    monkeypatch.setattr(admin.gmail_oauth, "client_configured", lambda: True)
    monkeypatch.setattr(admin.gmail_oauth, "authorized", lambda: False)
    monkeypatch.setattr(admin.mailer, "delivery_configured", lambda: False)
    status = admin.gmail_oauth_status(admin_user=object())
    assert status.sender_email == "adminrstpa@gmail.com"
    assert "secret" not in status.model_dump()

    monkeypatch.setattr(admin.gmail_oauth, "start_authorization", lambda: "https://accounts.example/auth")
    assert admin.gmail_oauth_start(admin_user=object()).authorization_url.endswith("/auth")

    monkeypatch.setattr(auth.gmail_oauth, "complete_authorization", lambda *_: None)
    monkeypatch.setattr(auth, "get_settings", lambda: settings)
    response = auth.gmail_oauth_callback(code="code", state="state")
    assert response.status_code == 303
    assert "oauth=success" in response.headers["location"]
