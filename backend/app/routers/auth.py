"""
routers/auth.py — HTTP routing dispatcher for /auth/* endpoints.

Delegates core account identity, registration, verification, profile mutations,
Google OAuth identity resolution, and password reset flows to ``app.services.identity``.
"""
from __future__ import annotations

import logging
import secrets
from urllib.parse import urlencode, urlparse

from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse

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
    user_to_out as _user_to_out,
)
from ..services import gmail_oauth, google_login_oauth, identity, mailer, storage
from ..services.auth import get_current_user
from ..services.identity import (
    create_token,
    hash_password,
    verify_password,
)
from ..services.storage import mirror_google_avatar as _mirror_google_avatar


router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger("recsys.google_login")


def _require_db() -> None:
    if not is_db_enabled():
        raise DbDisabledError("Auth requires the DB layer (RECSYS_DB_ENABLED=1)")


@router.post("/signup", response_model=TokenOut)
def signup(payload: UserSignup) -> TokenOut:
    """Create a user. 1st user (or admin allow-list member) becomes ``is_admin=True``."""
    _require_db()
    user, token, expires_in = identity.signup_user(
        username=payload.username,
        password=payload.password,
        email=payload.email,
        display_name=payload.display_name,
    )
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
    user, token, expires_in = identity.authenticate_user(
        username=payload.username,
        password=payload.password,
    )
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
    """Update the current user's editable profile and credential fields."""
    if user is None:
        raise AuthError("Authentication required", extra={"code": "unauthorized"})

    updated = identity.update_user_credentials(
        user.id,
        current_password=payload.current_password,
        username=payload.username,
        email=payload.email,
        display_name=payload.display_name,
        new_password=payload.new_password,
    )
    return _user_to_out(updated)


@router.post("/password-reset/request", response_model=PasswordResetRequestOut)
def request_password_reset(payload: PasswordResetRequest) -> PasswordResetRequestOut:
    """Validate account identifiers, then email a short-lived reset link."""
    _require_db()
    result = identity.request_password_reset(payload.username, payload.email)
    return PasswordResetRequestOut(**result)


@router.post("/password-reset/confirm", response_model=PasswordResetConfirmOut)
def confirm_password_reset(payload: PasswordResetConfirm) -> PasswordResetConfirmOut:
    """Consume one valid reset token and set a new bcrypt password."""
    _require_db()
    identity.confirm_password_reset(
        payload.username,
        payload.token,
        payload.new_password,
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
        identity_obj, next_path = google_login_oauth.complete_authorization(code, state)
        user, _ = identity.resolve_google_identity(
            subject_id=identity_obj.subject_id,
            email=identity_obj.email,
            display_name=identity_obj.display_name,
            avatar_url=identity_obj.avatar_url,
        )
        if user is None:
            return _google_frontend_redirect({"error": "google_account_not_persisted"})
        _mirror_google_avatar(user, identity_obj.avatar_url)
        identity.set_last_login(int(user.id))
        exchange_code = google_login_oauth.issue_login_code(int(user.id), next_path)
        return _google_frontend_redirect({"code": exchange_code, "next": next_path})
    except identity.AmbiguousGoogleEmailError:
        return _google_frontend_redirect({"error": "ambiguous_google_email"})
    except google_login_oauth.GoogleLoginOAuthError:
        return _google_frontend_redirect({"error": "google_login_failed"})


@router.post("/google/login/exchange", response_model=TokenOut)
def google_login_exchange(payload: GoogleLoginExchange) -> TokenOut:
    """Consume the callback code once and issue the application's JWT."""
    _require_db()
    user, token, expires_in = identity.exchange_google_login(payload.code)
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
