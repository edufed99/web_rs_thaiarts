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

import logging
import secrets

from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse
from urllib.parse import urlencode
from urllib.parse import urlparse

from ..core.config import get_settings
from ..core.exceptions import AuthError, DbDisabledError, InvalidRequestError
from ..db import is_db_enabled
from ..models_db import User
from ..schemas.user import (
    GoogleLoginExchange,
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
from ..services import gmail_oauth, google_login_oauth, mailer, storage, user_query
from ..services.auth import (
    create_token,
    get_current_user,
    hash_password,
    verify_password,
)


router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger("recsys.google_login")
_GOOGLE_AVATAR_HOSTS = {"lh3.googleusercontent.com"}


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
        auth_provider=str(getattr(user, "auth_provider", "password") or "password"),
        email_verified=bool(getattr(user, "email_verified", False)),
        created_at=user.created_at,
        last_login_at=user.last_login_at,
    )


def _mirror_google_avatar(user: User, source_url: str) -> None:
    """Cache Google's profile photo unless the member chose a custom image."""
    if not source_url:
        return
    profile = user_query.get_member_profile(int(user.id))
    if profile is None:
        return
    previous = str(profile.get("avatar_url") or "")
    if previous and not storage.is_allowed_remote_image_url(
        previous, _GOOGLE_AVATAR_HOSTS
    ):
        return
    settings = get_settings()
    try:
        _filename, public_url, _size, _mime = storage.save_remote_image(
            source_url,
            settings.upload_dir / "profiles",
            prefix=f"user-{int(user.id)}-google",
            max_bytes=settings.max_upload_bytes,
            allowed_mime=settings.allowed_upload_mime,
            allowed_hosts=_GOOGLE_AVATAR_HOSTS,
            public_subdir="profiles",
        )
        updated = user_query.update_member_profile(
            int(user.id), avatar_url=public_url
        )
        if updated is None:
            storage.delete_upload(public_url, settings.upload_dir)
            return
        if previous and previous != public_url:
            storage.delete_upload(previous, settings.upload_dir)
    except InvalidRequestError as exc:
        logger.warning("Google avatar cache failed for user %s: %s", user.id, exc)


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


@router.get("/google/login/start", include_in_schema=False)
def google_login_start(next: str = "/recommend") -> RedirectResponse:
    """Start member OpenID Connect and bind its state to this browser."""
    _require_db()
    try:
        authorization_url, state = google_login_oauth.start_authorization(next)
    except google_login_oauth.GoogleLoginOAuthError as exc:
        raise InvalidRequestError(
            str(exc), extra={"code": "google_login_not_configured"}
        ) from exc
    settings = get_settings()
    response = RedirectResponse(authorization_url, status_code=303)
    response.set_cookie(
        google_login_oauth.STATE_COOKIE,
        state,
        max_age=max(60, int(settings.google_login_state_ttl_seconds)),
        httponly=True,
        secure=urlparse(settings.google_login_redirect_uri).scheme == "https",
        samesite="lax",
        path="/auth/google/login/callback",
    )
    response.headers["Cache-Control"] = "no-store"
    return response


def _google_frontend_redirect(result: dict[str, str]) -> RedirectResponse:
    settings = get_settings()
    target = (
        f"{settings.frontend_base_url.rstrip('/')}/auth/google/callback?"
        f"{urlencode(result)}"
    )
    response = RedirectResponse(target, status_code=303)
    response.delete_cookie(
        google_login_oauth.STATE_COOKIE,
        path="/auth/google/login/callback",
    )
    response.headers["Cache-Control"] = "no-store"
    return response


@router.get("/google/login/callback", include_in_schema=False)
def google_login_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    """Verify Google identity and redirect with a single-use local code."""
    cookie_state = request.cookies.get(google_login_oauth.STATE_COOKIE)
    if error:
        return _google_frontend_redirect({"error": "google_access_denied"})
    if not code or not state or not cookie_state or not secrets.compare_digest(state, cookie_state):
        return _google_frontend_redirect({"error": "invalid_google_state"})
    try:
        identity, next_path = google_login_oauth.complete_authorization(code, state)
        user, _ = user_query.resolve_google_identity(
            subject_id=identity.subject_id,
            email=identity.email,
            display_name=identity.display_name,
            avatar_url=identity.avatar_url,
        )
        if user is None:
            return _google_frontend_redirect({"error": "google_account_not_persisted"})
        _mirror_google_avatar(user, identity.avatar_url)
        user_query.set_last_login(int(user.id))
        exchange_code = google_login_oauth.issue_login_code(int(user.id), next_path)
        return _google_frontend_redirect({"code": exchange_code, "next": next_path})
    except user_query.AmbiguousGoogleEmailError:
        return _google_frontend_redirect({"error": "ambiguous_google_email"})
    except google_login_oauth.GoogleLoginOAuthError:
        return _google_frontend_redirect({"error": "google_login_failed"})


@router.post("/google/login/exchange", response_model=TokenOut)
def google_login_exchange(payload: GoogleLoginExchange) -> TokenOut:
    """Consume the callback code once and issue the application's JWT."""
    _require_db()
    exchanged = google_login_oauth.consume_login_code(payload.code)
    if exchanged is None:
        raise AuthError(
            "Google login code is invalid or expired",
            extra={"code": "invalid_google_login_code"},
        )
    user_id, _next_path = exchanged
    user = user_query.find_user_by_id(user_id)
    if user is None:
        raise AuthError(
            "Google login account no longer exists",
            extra={"code": "google_account_not_found"},
        )
    token, expires_in = create_token(user.id, user.username, bool(user.is_admin))
    return TokenOut(
        access_token=token,
        token_type="bearer",
        expires_in_seconds=expires_in,
        user=_user_to_out(user),
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
