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
from fastapi.responses import RedirectResponse
from urllib.parse import urlencode

from ..core.config import get_settings
from ..core.exceptions import AuthError, DbDisabledError, InvalidRequestError
from ..db import is_db_enabled
from ..models_db import User
from ..schemas.user import (
    PasswordResetConfirm,
    PasswordResetConfirmOut,
    PasswordResetRequest,
    PasswordResetRequestOut,
    TokenOut,
    UserLogin,
    UserOut,
    UserProfileUpdate,
    UserSignup,
)
from ..services import gmail_oauth, mailer, user_query
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
        email=user.email or "",
        display_name=user.display_name or "",
        is_admin=bool(user.is_admin),
        role="super_admin" if user.is_admin else "user",
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
        email=payload.email or "",
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

    username = payload.username
    username_changed = username is not None and username != user.username
    email = payload.email
    email_changed = email is not None and email != (user.email or "")
    credentials_changed = username_changed or email_changed or bool(payload.new_password)

    if credentials_changed:
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

    if username_changed:
        existing = user_query.find_user_by_username(username)
        if existing is not None and existing.id != user.id:
            raise InvalidRequestError(
                "Username already taken",
                extra={"code": "duplicate_username"},
            )

    password_hash = None
    if payload.new_password:
        password_hash = hash_password(payload.new_password)

    updated = user_query.update_user_profile(
        user.id,
        username=username if username_changed else None,
        email=email if email_changed else None,
        display_name=payload.display_name,
        password_hash=password_hash,
    )
    if updated is None:
        raise DbDisabledError("User not persisted")
    return _user_to_out(updated)


@router.post("/password-reset/request", response_model=PasswordResetRequestOut)
def request_password_reset(payload: PasswordResetRequest) -> PasswordResetRequestOut:
    """Validate account identifiers, then email a short-lived reset link."""
    _require_db()
    settings = get_settings()
    account = user_query.find_user_by_username_and_email(payload.username, payload.email)
    if account is None:
        return PasswordResetRequestOut(
            accepted=False,
            credentials_valid=False,
            email_sent=False,
            delivery_configured=mailer.delivery_configured(),
            message="ชื่อผู้ใช้หรืออีเมลไม่ถูกต้อง กรุณาตรวจสอบข้อมูลอีกครั้ง",
        )

    created = user_query.create_password_reset_token(
        payload.username,
        payload.email,
        ttl_minutes=settings.password_reset_token_minutes,
    )
    if created is None:
        return PasswordResetRequestOut(
            accepted=False,
            credentials_valid=True,
            email_sent=False,
            delivery_configured=mailer.delivery_configured(),
            message="มีการส่งคำขอสำหรับบัญชีนี้แล้ว กรุณารอ 1 นาทีก่อนส่งใหม่",
        )

    user, raw_token = created
    delivery_ready = mailer.delivery_configured()
    if not mailer.send_password_reset_email(user.email, user.username, raw_token):
        # A token that was never delivered must not remain usable.
        user_query.revoke_password_reset_token(raw_token)
        return PasswordResetRequestOut(
            accepted=False,
            credentials_valid=True,
            email_sent=False,
            delivery_configured=delivery_ready,
            message="ข้อมูลถูกต้อง แต่ระบบส่งอีเมลไม่สำเร็จ กรุณาลองใหม่หรือติดต่อผู้ดูแลระบบ",
        )

    return PasswordResetRequestOut(
        accepted=True,
        credentials_valid=True,
        email_sent=True,
        delivery_configured=delivery_ready,
        message="ระบบได้ส่งคำขอเปลี่ยนรหัสผ่านไปยังอีเมลที่กำหนดแล้ว กรุณาตรวจสอบกล่องจดหมาย",
    )


@router.post("/password-reset/confirm", response_model=PasswordResetConfirmOut)
def confirm_password_reset(payload: PasswordResetConfirm) -> PasswordResetConfirmOut:
    """Consume one valid reset token and set a new bcrypt password."""
    _require_db()
    updated = user_query.consume_password_reset_token(
        payload.username,
        payload.token,
        hash_password(payload.new_password),
    )
    if updated is None:
        raise InvalidRequestError(
            "Reset link is invalid, expired, or already used",
            extra={"code": "invalid_reset_token"},
        )
    return PasswordResetConfirmOut(
        message="ตั้งรหัสผ่านใหม่เรียบร้อยแล้ว กรุณาเข้าสู่ระบบ",
    )


@router.get("/google/callback", include_in_schema=False)
def gmail_oauth_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    """Complete the admin-only sender OAuth flow, then return to its UI."""
    settings = get_settings()
    result = "error"
    if not error and code and state:
        try:
            gmail_oauth.complete_authorization(code, state)
            result = "success"
        except gmail_oauth.GmailOAuthError:
            result = "error"
    target = (
        f"{settings.frontend_base_url.rstrip('/')}/admin/email-settings?"
        f"{urlencode({'oauth': result})}"
    )
    response = RedirectResponse(target, status_code=303)
    response.headers["Cache-Control"] = "no-store"
    return response
