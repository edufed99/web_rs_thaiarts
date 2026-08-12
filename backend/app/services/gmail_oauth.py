"""One-time Gmail OAuth setup and Gmail API access-token refresh helpers.

The public application never asks ordinary members for Gmail access. An
authenticated admin authorizes the single sender mailbox once; the resulting
refresh token is kept outside Git and reused by the password-reset mailer.
"""
from __future__ import annotations

import base64
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import logging
import os
from pathlib import Path
import secrets
from threading import Lock
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from ..core.config import get_settings


logger = logging.getLogger("recsys.gmail_oauth")
GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send"
_AUTH_URI = "https://accounts.google.com/o/oauth2/auth"
_TOKEN_URI = "https://oauth2.googleapis.com/token"
_PENDING_TTL_SECONDS = 10 * 60
_pending: dict[str, tuple[float, str]] = {}
_pending_lock = Lock()
_access_cache: tuple[str, float] | None = None
_access_lock = Lock()


class GmailOAuthError(RuntimeError):
    """Safe, non-secret error raised by the Gmail OAuth integration."""


@dataclass(frozen=True)
class OAuthClient:
    client_id: str
    client_secret: str
    auth_uri: str
    token_uri: str
    redirect_uri: str


def _read_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError) as exc:
        raise GmailOAuthError("Google OAuth credential file is unreadable") from exc
    if not isinstance(payload, dict):
        raise GmailOAuthError("Google OAuth credential file is invalid")
    return payload


def load_client() -> OAuthClient:
    settings = get_settings()
    client_id = str(getattr(settings, "gmail_oauth_client_id", "") or "").strip()
    client_secret = str(getattr(settings, "gmail_oauth_client_secret", "") or "").strip()
    auth_uri = _AUTH_URI
    token_uri = _TOKEN_URI

    client_file = getattr(settings, "gmail_oauth_client_file", None)
    if (not client_id or not client_secret) and client_file:
        payload = _read_json(Path(client_file))
        web = payload.get("web")
        if not isinstance(web, dict):
            raise GmailOAuthError("OAuth credential must be a Web application client")
        client_id = str(web.get("client_id") or "").strip()
        client_secret = str(web.get("client_secret") or "").strip()
        auth_uri = str(web.get("auth_uri") or _AUTH_URI).strip()
        token_uri = str(web.get("token_uri") or _TOKEN_URI).strip()

    redirect_uri = str(
        getattr(settings, "gmail_oauth_redirect_uri", "")
        or "http://localhost:8001/auth/google/callback"
    ).strip()
    if not client_id or not client_secret:
        raise GmailOAuthError("Google OAuth client is not configured")
    return OAuthClient(client_id, client_secret, auth_uri, token_uri, redirect_uri)


def client_configured() -> bool:
    try:
        load_client()
        return True
    except GmailOAuthError:
        return False


def _refresh_token() -> str:
    settings = get_settings()
    env_token = str(getattr(settings, "gmail_oauth_refresh_token", "") or "").strip()
    if env_token:
        return env_token
    token_file = Path(getattr(settings, "gmail_oauth_token_file"))
    if not token_file.is_file():
        return ""
    try:
        return str(_read_json(token_file).get("refresh_token") or "").strip()
    except GmailOAuthError:
        return ""


def authorized() -> bool:
    return client_configured() and bool(_refresh_token())


def start_authorization() -> str:
    """Return a Google consent URL and remember one short-lived PKCE state."""
    client = load_client()
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode("ascii")).digest()
    ).rstrip(b"=").decode("ascii")
    now = time.time()
    with _pending_lock:
        for key, (created_at, _) in list(_pending.items()):
            if now - created_at > _PENDING_TTL_SECONDS:
                _pending.pop(key, None)
        _pending[state] = (now, verifier)
    return f"{client.auth_uri}?{urlencode({
        'client_id': client.client_id,
        'redirect_uri': client.redirect_uri,
        'response_type': 'code',
        'scope': GMAIL_SEND_SCOPE,
        'access_type': 'offline',
        'prompt': 'consent',
        'include_granted_scopes': 'true',
        'state': state,
        'code_challenge': challenge,
        'code_challenge_method': 'S256',
    })}"


def complete_authorization(code: str, state: str) -> None:
    """Exchange a one-time authorization code and persist its refresh token."""
    with _pending_lock:
        pending = _pending.pop(state, None)
    if pending is None or time.time() - pending[0] > _PENDING_TTL_SECONDS:
        raise GmailOAuthError("OAuth state is invalid or expired")
    verifier = pending[1]
    client = load_client()
    payload = _post_form(
        client.token_uri,
        {
            "code": code,
            "client_id": client.client_id,
            "client_secret": client.client_secret,
            "redirect_uri": client.redirect_uri,
            "grant_type": "authorization_code",
            "code_verifier": verifier,
        },
    )
    refresh_token = str(payload.get("refresh_token") or "").strip()
    if not refresh_token:
        raise GmailOAuthError("Google did not return a refresh token; revoke access and try again")
    settings = get_settings()
    token_file = Path(settings.gmail_oauth_token_file)
    token_file.parent.mkdir(parents=True, exist_ok=True)
    token_file.write_text(
        json.dumps(
            {
                "refresh_token": refresh_token,
                "scope": str(payload.get("scope") or GMAIL_SEND_SCOPE),
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    try:
        os.chmod(token_file, 0o600)
    except OSError:
        logger.warning("Could not tighten permissions on Gmail OAuth token file")
    global _access_cache
    _access_cache = None


def get_access_token() -> str:
    """Refresh and cache a short-lived Gmail API access token."""
    global _access_cache
    now = time.time()
    with _access_lock:
        if _access_cache and _access_cache[1] > now + 60:
            return _access_cache[0]
        client = load_client()
        refresh_token = _refresh_token()
        if not refresh_token:
            raise GmailOAuthError("Gmail sender has not been authorized")
        payload = _post_form(
            client.token_uri,
            {
                "client_id": client.client_id,
                "client_secret": client.client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
        )
        access_token = str(payload.get("access_token") or "").strip()
        if not access_token:
            raise GmailOAuthError("Google did not return an access token")
        expires_in = max(120, int(payload.get("expires_in") or 3600))
        _access_cache = (access_token, now + expires_in)
        return access_token


def _post_form(url: str, fields: dict[str, str]) -> dict[str, Any]:
    body = urlencode(fields).encode("utf-8")
    request = Request(
        url,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        # Do not include Google's response body: it can contain sensitive data.
        raise GmailOAuthError(f"Google OAuth request failed ({exc.code})") from exc
    except (URLError, OSError, ValueError) as exc:
        raise GmailOAuthError("Google OAuth request failed") from exc
    if not isinstance(payload, dict):
        raise GmailOAuthError("Google OAuth response is invalid")
    return payload
