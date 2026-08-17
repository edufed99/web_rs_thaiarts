"""
routers/_user_key.py — Translate JWT auth (or anon ``user_key``) to a
single ``user_key`` string the rest of the code understands.

When the caller sends a valid ``Authorization: Bearer <jwt>``, the
``User`` resolves to ``"user:<user_id>"``. When no JWT is present, we
fall back to the opaque ``anon:<uuid>`` string the legacy actions router
still accepts.

This is the single source of truth for the user_key translation so the
/auth swap in Phase G is consistent across ``actions``, ``catalog``,
and ``recommendations`` routers.
"""
from __future__ import annotations

from typing import Optional

from fastapi import Depends, Header

from ..core.exceptions import AuthError
from ..models_db import User
from ..services.identity import get_current_user


def get_current_user_dep(
    authorization: Optional[str] = Header(default=None),
) -> Optional[User]:
    """FastAPI dep that resolves ``Authorization: Bearer <jwt>`` to a User.

    Returns ``None`` when no header is present so catalog browse keeps
    working anonymously.
    """
    return get_current_user(authorization)


def resolve_user_key(
    *,
    user: Optional[User],
    body_user_key: Optional[str],
) -> str:
    """Pick the right user_key string for downstream services.

    Rules:

    * If a JWT-resolved ``User`` is present, return ``"user:<id>"``.
    * Otherwise require ``body_user_key`` to be present and to start
      with ``anon:`` (legacy-compatible). Empty strings raise 401.
    """
    if user is not None:
        return f"user:{int(user.id)}"
    if body_user_key and body_user_key.startswith("anon:"):
        return body_user_key
    if body_user_key:
        raise AuthError(
            "Anonymous requests must use 'anon:<uuid>'",
            extra={"code": "invalid_user_key"},
        )
    raise AuthError(
        "Missing user_key (anonymous requires 'anon:<uuid>')",
        extra={"code": "missing_user_key"},
    )