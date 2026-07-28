"""
services/auth.py — bcrypt password hashing + PyJWT token helpers + FastAPI deps.

The auth slice replaces the opaque ``anon:<uuid>`` user_key with real
username/password authentication. Tokens are HS256 JWTs signed with
``settings.jwt_secret``; the payload carries ``sub`` (user id as str),
``username``, ``is_admin``, ``iat``, ``exp``.

Two FastAPI dependencies are exported:

* ``get_current_user(authorization)`` — returns ``Optional[User]``. If no
  ``Authorization: Bearer …`` header is present, returns ``None`` so
  catalog browse (which is anonymous-compatible) keeps working.
* ``get_current_admin(current_user)`` — returns the authenticated ``User``
  if ``is_admin=True``; otherwise raises ``ForbiddenError``. Used by
  ``/admin/*`` endpoints.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from fastapi import Depends, Header

from ..core.config import get_settings
from ..core.exceptions import AuthError, ForbiddenError
from ..models_db import User
from . import user_query


# --- Password hashing -------------------------------------------------------


def hash_password(plain: str) -> str:
    """Hash ``plain`` with bcrypt. The resulting string starts with ``$2b$``."""
    if not isinstance(plain, str):
        raise TypeError("password must be str")
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """Return True iff ``plain`` matches ``hashed``."""
    if not plain or not hashed:
        return False
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


# --- Token issuance / verification ------------------------------------------


def create_token(user_id: int, username: str, is_admin: bool) -> tuple[str, int]:
    """Issue an HS256 JWT. Returns ``(token, expires_in_seconds)``.

    The expiry is ``now + settings.jwt_expiry_days``. The token's ``exp``
    claim lets clients reject stale tokens without a round-trip.
    """
    settings = get_settings()
    now = datetime.now(timezone.utc)
    exp = now + timedelta(days=settings.jwt_expiry_days)
    payload = {
        "sub": str(user_id),
        "username": username,
        "is_admin": bool(is_admin),
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm="HS256")
    return token, int((exp - now).total_seconds())


def decode_token(token: str) -> dict:
    """Verify signature + expiry, return the payload. Raises ``AuthError``."""
    settings = get_settings()
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError as exc:
        raise AuthError("Token expired", extra={"code": "token_expired"}) from exc
    except jwt.InvalidTokenError as exc:
        raise AuthError("Invalid token", extra={"code": "invalid_token"}) from exc


# --- FastAPI dependencies ---------------------------------------------------


def _bearer(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    parts = authorization.strip().split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip() or None


def get_current_user(
    authorization: Optional[str] = Header(default=None),
) -> Optional[User]:
    """Resolve the current user from ``Authorization: Bearer <jwt>``.

    Returns ``None`` when the header is absent (catalog browse) so
    anonymous callers are not penalised. When a header is present but
    invalid / expired, raises ``AuthError``.
    """
    token = _bearer(authorization)
    if not token:
        return None
    payload = decode_token(token)
    try:
        user_id = int(payload["sub"])
    except (KeyError, ValueError, TypeError) as exc:
        raise AuthError("Invalid token payload", extra={"code": "invalid_token"}) from exc
    user = user_query.find_user_by_id(user_id)
    if user is None:
        # User row gone (deleted? revoked?) — treat as unauthorized.
        raise AuthError("User not found", extra={"code": "user_not_found"})
    return user


def get_current_admin(
    user: Optional[User] = Depends(get_current_user),
) -> User:
    """Gate ``/admin/*`` endpoints. Raises 403 if the user is not admin."""
    if user is None:
        raise AuthError("Authentication required", extra={"code": "unauthorized"})
    if not user.is_admin:
        raise ForbiddenError("Admin role required", extra={"code": "not_admin"})
    return user