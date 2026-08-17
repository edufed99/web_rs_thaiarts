from __future__ import annotations

import json
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import pytest

from app.services import google_login_oauth as oauth


@pytest.fixture(autouse=True)
def clear_oauth_state():
    oauth._pending.clear()
    oauth._login_codes.clear()
    yield
    oauth._pending.clear()
    oauth._login_codes.clear()


def _settings(tmp_path, **overrides):
    values = {
        "google_login_client_file": tmp_path / "client.json",
        "google_login_client_id": "",
        "google_login_client_secret": "",
        "google_login_redirect_uri": "http://localhost:8001/auth/google/login/callback",
        "google_login_state_ttl_seconds": 600,
        "google_login_code_ttl_seconds": 120,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _write_client(settings):
    settings.google_login_client_file.write_text(
        json.dumps(
            {
                "web": {
                    "client_id": "member-client",
                    "client_secret": "member-secret",
                    "auth_uri": "https://accounts.example/auth",
                    "token_uri": "https://accounts.example/token",
                }
            }
        ),
        encoding="utf-8",
    )


def test_load_client_and_start_pkce(tmp_path, monkeypatch):
    settings = _settings(tmp_path)
    _write_client(settings)
    monkeypatch.setattr(oauth, "get_settings", lambda: settings)
    client = oauth.load_client()
    assert client.client_id == "member-client"
    assert oauth.client_configured() is True

    url, state = oauth.start_authorization("//evil.example")
    params = parse_qs(urlparse(url).query)
    assert params["scope"] == ["openid email profile"]
    assert params["code_challenge_method"] == ["S256"]
    assert params["state"] == [state]
    assert oauth._pending[state][2] == "/recommend"


def test_load_client_rejects_bad_files(tmp_path, monkeypatch):
    settings = _settings(tmp_path)
    settings.google_login_client_file.write_text("[]", encoding="utf-8")
    monkeypatch.setattr(oauth, "get_settings", lambda: settings)
    with pytest.raises(oauth.GoogleLoginOAuthError, match="invalid"):
        oauth.load_client()
    settings.google_login_client_file.write_text("{}", encoding="utf-8")
    with pytest.raises(oauth.GoogleLoginOAuthError, match="Web application"):
        oauth.load_client()
    assert oauth.client_configured() is False


def test_complete_authorization_and_single_use_code(tmp_path, monkeypatch):
    settings = _settings(tmp_path)
    _write_client(settings)
    monkeypatch.setattr(oauth, "get_settings", lambda: settings)
    _url, state = oauth.start_authorization("/profile")
    monkeypatch.setattr(oauth, "_post_form", lambda *_: {"id_token": "signed"})
    expected = oauth.GoogleIdentity("sub", "person@gmail.com", "Person", "pic")
    monkeypatch.setattr(oauth, "_verify_id_token", lambda *_: expected)
    identity, next_path = oauth.complete_authorization("authorization-code", state)
    assert identity == expected
    assert next_path == "/profile"
    with pytest.raises(oauth.GoogleLoginOAuthError, match="state"):
        oauth.complete_authorization("again", state)

    raw = oauth.issue_login_code(42, "/profile")
    assert oauth.consume_login_code(raw) == (42, "/profile")
    assert oauth.consume_login_code(raw) is None


def test_verify_id_token_claims(monkeypatch):
    key = SimpleNamespace(key="public")
    monkeypatch.setattr(
        oauth.jwt,
        "PyJWKClient",
        lambda *_: SimpleNamespace(get_signing_key_from_jwt=lambda *_: key),
    )
    claims = {
        "iss": "https://accounts.google.com",
        "sub": "123",
        "email": "PERSON@GMAIL.COM",
        "email_verified": True,
        "name": "Person",
        "picture": "https://example/pic",
    }
    monkeypatch.setattr(oauth.jwt, "decode", lambda *_args, **_kwargs: claims)
    identity = oauth._verify_id_token("token", "client")
    assert identity.email == "person@gmail.com"

    claims["email_verified"] = False
    with pytest.raises(oauth.GoogleLoginOAuthError, match="not verified"):
        oauth._verify_id_token("token", "client")
    claims["email_verified"] = True
    claims["iss"] = "https://evil.example"
    with pytest.raises(oauth.GoogleLoginOAuthError, match="issuer"):
        oauth._verify_id_token("token", "client")


def test_post_form_network_errors(monkeypatch):
    from urllib.error import HTTPError, URLError

    monkeypatch.setattr(
        oauth,
        "urlopen",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            HTTPError("url", 400, "bad", None, None)
        ),
    )
    with pytest.raises(oauth.GoogleLoginOAuthError, match="400"):
        oauth._post_form("https://example", {})
    monkeypatch.setattr(
        oauth,
        "urlopen",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(URLError("offline")),
    )
    with pytest.raises(oauth.GoogleLoginOAuthError, match="failed"):
        oauth._post_form("https://example", {})
