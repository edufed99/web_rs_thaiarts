"""
services/auth.py — Backward-compatibility aliases for services.identity.

Authentication primitives, token issuance, and FastAPI dependency helpers
have been consolidated into ``app.services.identity``. This module re-exports
all symbols so existing imports remain unbroken.
"""
from __future__ import annotations

from . import identity
from .identity import (
    _bearer,
    create_token,
    decode_token,
    get_current_admin,
    get_current_user,
    hash_password,
    verify_password,
)
from . import user_query


__all__ = [
    "create_token",
    "decode_token",
    "get_current_admin",
    "get_current_user",
    "hash_password",
    "identity",
    "user_query",
    "verify_password",
    "_bearer",
]