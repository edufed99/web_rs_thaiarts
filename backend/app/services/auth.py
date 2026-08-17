"""
services/auth.py — Authentication primitives and FastAPI dependency helpers.

Holds the ``get_current_user`` / ``get_current_admin`` ``Depends``/``Header``
dependency glue that gates ``/auth/*`` and ``/admin/*`` endpoints. The core
token and user-lookup primitives it builds on (``decode_token``, ``_bearer``,
``find_user_by_id``, ...) live in ``app.services.identity``. This module also
re-exports those ``identity`` primitives (``create_token``, ``decode_token``,
``hash_password``, ``verify_password``) so legacy callers that import them
from ``services.auth`` remain unbroken.
"""
from __future__ import annotations

from typing import Optional

from fastapi import Depends, Header

from ..core.exceptions import AuthError, ForbiddenError
from ..models_db import User
from . import identity
from .identity import (
    _bearer,
    create_token,
    decode_token,
    hash_password,
    verify_password,
)


def get_current_user(
    authorization: Optional[str] = Header(default=None),
) -> Optional[User]:
    """Resolve the current user from ``Authorization: Bearer <jwt>``."""
    token = _bearer(authorization)
    if not token:
        return None
    payload = decode_token(token)
    try:
        user_id = int(payload["sub"])
    except (KeyError, ValueError, TypeError) as exc:
        raise AuthError("Invalid token payload", extra={"code": "invalid_token"}) from exc
    user = identity.find_user_by_id(user_id)
    if user is None:
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


__all__ = [
    "create_token",
    "decode_token",
    "get_current_admin",
    "get_current_user",
    "hash_password",
    "identity",
    "verify_password",
    "_bearer",
]
