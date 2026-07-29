"""
routers/auth.py — ``/auth/*`` endpoints.

Three routes:

* ``POST /auth/signup`` — create a user (first user / ``RECSYS_ADMIN_USERNAMES``
  members become admin). Returns ``TokenOut`` so the client can immediately
  start hitting ``/admin/*``.
* ``POST /auth/login``  — verify password, stamp ``last_login_at``, return token.
* ``GET  /auth/me``     — echo the current user (requires ``Authorization``).

Errors are surfaced via the domain exceptions (``AuthError``,
``InvalidRequestError``, ``DbDisabledError``).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from ..core.config import get_settings
from ..core.exceptions import AuthError, DbDisabledError, InvalidRequestError
from ..db import is_db_enabled
from ..models_db import User
from ..schemas.user import TokenOut, UserLogin, UserOut, UserProfileUpdate, UserSignup
from ..services import user_query
from ..services.auth import (
    create_token,
    get_current_user,
    hash_password,
    verify_password,
)


router = APIRouter(prefix="/auth", tags=["auth"])


def _require_db() -> None:
    if not is_db_enabled():
        raise DbDisabledError("Auth requires the DB layer (RECSYS_DB_ENABLED=1)")


def _user_to_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        username=user.username,
        display_name=user.display_name or "",
        is_admin=bool(user.is_admin),
        created_at=user.created_at,
        last_login_at=user.last_login_at,
    )


@router.post("/signup", response_model=TokenOut)
def signup(payload: UserSignup) -> TokenOut:
    """Create a user. 1st user (or admin allow-list member) becomes ``is_admin=True``."""
    _require_db()
    settings = get_settings()
    existing = user_query.find_user_by_username(payload.username)
    if existing is not None:
        raise InvalidRequestError(
            "Username already taken",
            extra={"code": "duplicate_username"},
        )
    # Resolve is_admin from the settings allow-list, falling back to first-user.
    is_admin = None
    if settings.admin_usernames_list:
        is_admin = payload.username in settings.admin_usernames_list
    user = user_query.create_user(
        username=payload.username,
        password_hash=hash_password(payload.password),
        display_name=payload.display_name or "",
        is_admin=is_admin,
    )
    if user is None:
        # DB disabled or race; we already raised above so this is a race.
        raise DbDisabledError("User not persisted")
    token, expires_in = create_token(user.id, user.username, bool(user.is_admin))
    return TokenOut(
        access_token=token,
        token_type="bearer",
        expires_in_seconds=expires_in,
        user=_user_to_out(user),
    )


@router.post("/login", response_model=TokenOut)
def login(payload: UserLogin) -> TokenOut:
    """Verify password and return a fresh token."""
    _require_db()
    user = user_query.find_user_by_username(payload.username)
    if user is None or not verify_password(payload.password, user.password_hash):
        raise AuthError("Invalid credentials", extra={"code": "invalid_credentials"})
    user_query.set_last_login(user.id)
    token, expires_in = create_token(user.id, user.username, bool(user.is_admin))
    return TokenOut(
        access_token=token,
        token_type="bearer",
        expires_in_seconds=expires_in,
        user=_user_to_out(user),
    )


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> UserOut:
    """Echo the current user. Requires ``Authorization: Bearer <jwt>``."""
    if user is None:
        raise AuthError("Authentication required", extra={"code": "unauthorized"})
    return _user_to_out(user)


@router.patch("/me", response_model=UserOut)
def update_me(
    payload: UserProfileUpdate,
    user: User = Depends(get_current_user),
) -> UserOut:
    """Update the current user's editable profile fields."""
    if user is None:
        raise AuthError("Authentication required", extra={"code": "unauthorized"})

    password_hash = None
    if payload.new_password:
        if not payload.current_password:
            raise InvalidRequestError(
                "Current password is required",
                extra={"code": "current_password_required"},
            )
        if not verify_password(payload.current_password, user.password_hash):
            raise AuthError(
                "Current password is incorrect",
                extra={"code": "invalid_current_password"},
            )
        password_hash = hash_password(payload.new_password)

    updated = user_query.update_user_profile(
        user.id,
        display_name=payload.display_name,
        password_hash=password_hash,
    )
    if updated is None:
        raise DbDisabledError("User not persisted")
    return _user_to_out(updated)
