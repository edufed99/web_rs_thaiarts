"""Google OpenID Connect flow for ordinary member sign-in.

This integration is intentionally separate from ``gmail_oauth``: it requests
only identity scopes, stores no Google access/refresh token, and converts a
successful callback into a short-lived, single-use local exchange code.
"""
from __future__ import annotations

import base64
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import secrets
from threading import Lock
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import jwt

from ..core.config import get_settings


_AUTH_URI = "https://accounts.google.com/o/oauth2/v2/auth"
_TOKEN_URI = "https://oauth2.googleapis.com/token"
_JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs"
_SCOPES = "openid email profile"
STATE_COOKIE = "thaiperform_google_login_state"


class GoogleLoginOAuthError(RuntimeError):
    """Safe, non-secret error raised during member Google sign-in."""


@dataclass(frozen=True)
class OAuthClient:
    client_id: str
    client_secret: str
    auth_uri: str
    token_uri: str
    redirect_uri: str


@dataclass(frozen=True)
class GoogleIdentity:
    subject_id: str
    email: str
    display_name: str
    avatar_url: str


_pending: dict[str, tuple[float, str, str]] = {}
_pending_lock = Lock()
_login_codes: dict[str, tuple[float, int, str]] = {}
_login_codes_lock = Lock()


def _safe_next_path(value: str | None) -> str:
    candidate = (value or "").strip()
    if candidate.startswith("/") and not candidate.startswith("//"):
        return candidate
    return "/recommend"


def _read_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError) as exc:
        raise GoogleLoginOAuthError("Google login credential file is unreadable") from exc
    if not isinstance(payload, dict):
        raise GoogleLoginOAuthError("Google login credential file is invalid")
    return payload


def load_client() -> OAuthClient:
    settings = get_settings()
    client_id = str(settings.google_login_client_id or "").strip()
    client_secret = str(settings.google_login_client_secret or "").strip()
    auth_uri = _AUTH_URI
    token_uri = _TOKEN_URI
    client_file = settings.google_login_client_file
    if (not client_id or not client_secret) and client_file:
        web = _read_json(Path(client_file)).get("web")
        if not isinstance(web, dict):
            raise GoogleLoginOAuthError("OAuth credential must be a Web application client")
        client_id = str(web.get("client_id") or "").strip()
        client_secret = str(web.get("client_secret") or "").strip()
        auth_uri = str(web.get("auth_uri") or auth_uri).strip()
        token_uri = str(web.get("token_uri") or token_uri).strip()
    if not client_id or not client_secret:
        raise GoogleLoginOAuthError("Google member login is not configured")
    return OAuthClient(
        client_id=client_id,
        client_secret=client_secret,
        auth_uri=auth_uri,
        token_uri=token_uri,
        redirect_uri=str(settings.google_login_redirect_uri).strip(),
    )


def client_configured() -> bool:
    try:
        load_client()
        return True
    except GoogleLoginOAuthError:
        return False


def start_authorization(next_path: str | None = None) -> tuple[str, str]:
    """Return the Google authorization URL plus state bound to the browser."""
    client = load_client()
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode("ascii")).digest()
    ).rstrip(b"=").decode("ascii")
    now = time.time()
    ttl = max(60, int(get_settings().google_login_state_ttl_seconds))
    with _pending_lock:
        for key, (created, _, _) in list(_pending.items()):
            if now - created > ttl:
                _pending.pop(key, None)
        _pending[state] = (now, verifier, _safe_next_path(next_path))
    query = urlencode(
        {
            "client_id": client.client_id,
            "redirect_uri": client.redirect_uri,
            "response_type": "code",
            "scope": _SCOPES,
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "prompt": "select_account",
        }
    )
    return f"{client.auth_uri}?{query}", state


def complete_authorization(code: str, state: str) -> tuple[GoogleIdentity, str]:
    with _pending_lock:
        pending = _pending.pop(state, None)
    ttl = max(60, int(get_settings().google_login_state_ttl_seconds))
    if pending is None or time.time() - pending[0] > ttl:
        raise GoogleLoginOAuthError("Google login state is invalid or expired")
    client = load_client()
    token_payload = _post_form(
        client.token_uri,
        {
            "code": code,
            "client_id": client.client_id,
            "client_secret": client.client_secret,
            "redirect_uri": client.redirect_uri,
            "grant_type": "authorization_code",
            "code_verifier": pending[1],
        },
    )
    id_token = str(token_payload.get("id_token") or "").strip()
    if not id_token:
        raise GoogleLoginOAuthError("Google did not return an identity token")
    return _verify_id_token(id_token, client.client_id), pending[2]


def _verify_id_token(id_token: str, client_id: str) -> GoogleIdentity:
    try:
        signing_key = jwt.PyJWKClient(_JWKS_URI).get_signing_key_from_jwt(id_token)
        claims = jwt.decode(
            id_token,
            signing_key.key,
            algorithms=["RS256"],
            audience=client_id,
        )
    except Exception as exc:
        raise GoogleLoginOAuthError("Google identity token could not be verified") from exc
    if claims.get("iss") not in {"accounts.google.com", "https://accounts.google.com"}:
        raise GoogleLoginOAuthError("Google identity token has an invalid issuer")
    if claims.get("email_verified") is not True:
        raise GoogleLoginOAuthError("Google account email is not verified")
    subject = str(claims.get("sub") or "").strip()
    email = str(claims.get("email") or "").strip().lower()
    if not subject or not email:
        raise GoogleLoginOAuthError("Google identity is missing required fields")
    return GoogleIdentity(
        subject_id=subject,
        email=email,
        display_name=str(claims.get("name") or "").strip(),
        avatar_url=str(claims.get("picture") or "").strip(),
    )


def issue_login_code(user_id: int, next_path: str) -> str:
    raw = secrets.token_urlsafe(32)
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    now = time.time()
    ttl = max(30, int(get_settings().google_login_code_ttl_seconds))
    with _login_codes_lock:
        for key, (created, _, _) in list(_login_codes.items()):
            if now - created > ttl:
                _login_codes.pop(key, None)
        _login_codes[digest] = (now, int(user_id), _safe_next_path(next_path))
    return raw


def consume_login_code(raw: str) -> tuple[int, str] | None:
    digest = hashlib.sha256((raw or "").encode("utf-8")).hexdigest()
    with _login_codes_lock:
        value = _login_codes.pop(digest, None)
    ttl = max(30, int(get_settings().google_login_code_ttl_seconds))
    if value is None or time.time() - value[0] > ttl:
        return None
    return value[1], value[2]


def _post_form(url: str, fields: dict[str, str]) -> dict[str, Any]:
    request = Request(
        url,
        data=urlencode(fields).encode("utf-8"),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise GoogleLoginOAuthError(f"Google token exchange failed ({exc.code})") from exc
    except (URLError, OSError, ValueError) as exc:
        raise GoogleLoginOAuthError("Google token exchange failed") from exc
    if not isinstance(payload, dict):
        raise GoogleLoginOAuthError("Google token response is invalid")
    return payload
