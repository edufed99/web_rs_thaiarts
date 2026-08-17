"""
services/identity.py — Unified Member Identity and Account Lifecycle Module.

Consolidates user authentication, registration, profile mutations, Google OAuth
identity resolution, password reset tokens, and admin user management into a
deep module with clean domain boundaries.

Legacy display name markers (`must_reset|`, `legacy:`) are parsed at the data
access boundary into a typed `AccountState` with explicit boolean flags,
preventing string-marker parsing leaks throughout routers and services.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import re
import secrets
from typing import List, Optional, Tuple

import bcrypt
import jwt
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from .. import db
from ..core.config import get_settings
from ..core.exceptions import AuthError, DbDisabledError, InvalidRequestError
from ..models_db import PasswordResetToken, User, UserProfile
from . import mailer


PASSWORD_RESET_MARKER = "must_reset|"
LEGACY_NAME_MARKER = "legacy:"


class AmbiguousGoogleEmailError(RuntimeError):
    """Raised when an email maps to multiple local research accounts."""


# --- Domain Representation --------------------------------------------------


@dataclass(frozen=True)
class AccountState:
    """Typed representation of a member account's parsed identity state."""

    display_name: str
    requires_password_reset: bool = False
    legacy_account: bool = False


def parse_account_state(raw_display_name: Optional[str], fallback: str = "") -> AccountState:
    """Parse legacy markers from stored display_name into a typed AccountState.

    Extracts explicit boolean flags (`requires_password_reset`, `legacy_account`)
    and returns the clean, member-facing `display_name`.
    """
    clean = (raw_display_name or "").strip()
    requires_reset = False
    is_legacy = False

    if clean.startswith(PASSWORD_RESET_MARKER):
        requires_reset = True
        clean = clean[len(PASSWORD_RESET_MARKER):].strip()
    if clean.startswith(LEGACY_NAME_MARKER):
        is_legacy = True
        clean = clean[len(LEGACY_NAME_MARKER):].strip()

    return AccountState(
        display_name=clean or fallback,
        requires_password_reset=requires_reset,
        legacy_account=is_legacy,
    )


def encode_display_name(
    clean_name: str,
    *,
    requires_password_reset: bool = False,
    legacy_account: bool = False,
) -> str:
    """Encode account state markers back into the display_name storage format."""
    prefix = ""
    if requires_password_reset:
        prefix += PASSWORD_RESET_MARKER
    if legacy_account:
        prefix += LEGACY_NAME_MARKER
    return f"{prefix}{clean_name.strip()}"


def _strip_internal_display_markers(value: str, fallback: str = "") -> str:
    """Backward-compatible helper returning the clean member-facing display name."""
    return parse_account_state(value, fallback=fallback).display_name


# --- DB Session / Feature Dispatch ------------------------------------------


def is_db_enabled() -> bool:
    """Check if the database layer is enabled."""
    return db.is_db_enabled()


def session_scope():
    """Context manager for DB sessions."""
    return db.session_scope()


def _require_db() -> None:
    if not is_db_enabled():
        raise DbDisabledError("Identity operations require the DB layer (RECSYS_DB_ENABLED=1)")


# --- Password Hashing & JWT Helpers -----------------------------------------


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


def create_token(user_id: int, username: str, is_admin: bool) -> tuple[str, int]:
    """Issue an HS256 JWT. Returns ``(token, expires_in_seconds)``."""
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


def _bearer(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    parts = authorization.strip().split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip() or None


# --- Mapping Helpers --------------------------------------------------------


def _get_or_create_profile(session: Session, user: User) -> UserProfile:
    profile = session.execute(
        select(UserProfile).where(UserProfile.user_id == int(user.id))
    ).scalar_one_or_none()
    role = "super_admin" if bool(user.is_admin) else "user"
    if profile is None:
        profile = UserProfile(
            user_id=int(user.id),
            display_name=user.display_name or "",
            role=role,
            user_group=role,
        )
        session.add(profile)
        session.flush()
    else:
        profile.role = role
        profile.user_group = role
    return profile


def _find_by_username(session: Session, username: str) -> Optional[User]:
    stmt = select(User).where(User.username == username)
    return session.execute(stmt).scalar_one_or_none()


def _available_google_username(session: Session, email: str) -> str:
    local = (email.split("@", 1)[0] or "google_user").lower()
    base = re.sub(r"[^a-z0-9_.-]+", "_", local).strip("._-") or "google_user"
    if len(base) < 3:
        base = f"google_{base}"
    base = base[:55]
    candidate = base
    suffix = 2
    while _find_by_username(session, candidate) is not None:
        candidate = f"{base}_{suffix}"
        suffix += 1
    return candidate


def _count_users(session: Session) -> int:
    stmt = select(func.count()).select_from(User)
    return int(session.execute(stmt).scalar_one())


def _is_admin_username(username: str) -> bool:
    allow = get_settings().admin_usernames_list
    if allow:
        return username in allow
    return True


# --- Low-level Data Access (User Query API) ---------------------------------


def find_user_by_username(username: str) -> Optional[User]:
    """Look up a user by username. Returns ``None`` if DB disabled / no row."""
    if not is_db_enabled():
        return None
    with session_scope() as session:
        return _find_by_username(session, username)


def find_user_by_id(user_id: int) -> Optional[User]:
    """Look up a user by ID. Returns ``None`` if DB disabled / no row."""
    if not is_db_enabled():
        return None
    with session_scope() as session:
        stmt = select(User).where(User.id == int(user_id))
        return session.execute(stmt).scalar_one_or_none()


def count_users() -> int:
    if not is_db_enabled():
        return 0
    with session_scope() as session:
        return _count_users(session)


def create_user(
    username: str,
    password_hash: str,
    email: str = "",
    display_name: str = "",
    is_admin: Optional[bool] = None,
) -> Optional[User]:
    """Insert a new user. Returns the persisted row, or ``None`` if DB off / duplicate."""
    if not is_db_enabled():
        return None
    with session_scope() as session:
        if _find_by_username(session, username) is not None:
            return None
        if is_admin is None:
            allow = get_settings().admin_usernames_list
            if allow:
                is_admin = username in allow
            else:
                is_admin = _count_users(session) == 0
        user = User(
            username=username,
            email=(email or "").strip().lower(),
            password_hash=password_hash,
            display_name=display_name,
            is_admin=is_admin,
        )
        session.add(user)
        session.flush()
        role = "super_admin" if is_admin else "user"
        session.add(
            UserProfile(
                user_id=int(user.id),
                display_name=display_name,
                role=role,
                user_group=role,
            )
        )
        session.refresh(user)
        return user


def set_last_login(user_id: int, when: Optional[datetime] = None) -> None:
    """Stamp ``last_login_at`` for a user. No-op when DB disabled."""
    if not is_db_enabled():
        return
    when = when or datetime.now(timezone.utc)
    with session_scope() as session:
        stmt = select(User).where(User.id == int(user_id))
        user = session.execute(stmt).scalar_one_or_none()
        if user is not None:
            user.last_login_at = when
            session.flush()


def update_user_profile(
    user_id: int,
    *,
    username: Optional[str] = None,
    email: Optional[str] = None,
    display_name: Optional[str] = None,
    password_hash: Optional[str] = None,
) -> Optional[User]:
    """Update editable profile fields for a persisted user."""
    if not is_db_enabled():
        return None
    with session_scope() as session:
        stmt = select(User).where(User.id == int(user_id))
        user = session.execute(stmt).scalar_one_or_none()
        if user is None:
            return None
        if username is not None:
            user.username = username
        if email is not None:
            user.email = email.strip().lower()
        if display_name is not None:
            user.display_name = display_name
            profile = session.execute(
                select(UserProfile).where(UserProfile.user_id == int(user_id))
            ).scalar_one_or_none()
            if profile is not None:
                profile.display_name = display_name
                profile.updated_at = datetime.now(timezone.utc)
        if password_hash is not None:
            user.password_hash = password_hash
            if getattr(user, "google_subject_id", None):
                user.auth_provider = "password+google"
            # When changing password, clear legacy reset markers.
            state = parse_account_state(user.display_name, fallback=str(user.username))
            if state.requires_password_reset:
                user.display_name = state.display_name
                profile = _get_or_create_profile(session, user)
                profile.display_name = state.display_name
                profile.updated_at = datetime.now(timezone.utc)
        session.flush()
        session.refresh(user)
        return user


# --- High-level User Authentication & Lifecycle Operations ------------------


def signup_user(
    *,
    username: str,
    password: str,
    email: Optional[str] = None,
    display_name: Optional[str] = None,
    is_admin: Optional[bool] = None,
) -> tuple[User, str, int]:
    """Register a new user, create their profile, and issue an access token."""
    _require_db()
    settings = get_settings()
    existing = find_user_by_username(username)
    if existing is not None:
        raise InvalidRequestError(
            "Username already taken",
            extra={"code": "duplicate_username"},
        )
    if is_admin is None and settings.admin_usernames_list:
        is_admin = username in settings.admin_usernames_list

    user = create_user(
        username=username,
        password_hash=hash_password(password),
        email=email or "",
        display_name=display_name or "",
        is_admin=is_admin,
    )
    if user is None:
        raise DbDisabledError("User not persisted")
    token, expires_in = create_token(user.id, user.username, bool(user.is_admin))
    return user, token, expires_in


def authenticate_user(username: str, password: str) -> tuple[User, str, int]:
    """Verify credentials, stamp login timestamp, and issue an access token."""
    _require_db()
    user = find_user_by_username(username)
    if user is None or not verify_password(password, user.password_hash):
        raise AuthError("Invalid credentials", extra={"code": "invalid_credentials"})
    set_last_login(user.id)
    token, expires_in = create_token(user.id, user.username, bool(user.is_admin))
    return user, token, expires_in


def update_user_credentials(
    user_id: int,
    *,
    current_password: Optional[str] = None,
    username: Optional[str] = None,
    email: Optional[str] = None,
    display_name: Optional[str] = None,
    new_password: Optional[str] = None,
) -> User:
    """Self-update user account credentials and profile details."""
    _require_db()
    user = find_user_by_id(user_id)
    if user is None:
        raise AuthError("User not found", extra={"code": "user_not_found"})

    username_changed = username is not None and username != user.username
    email_changed = email is not None and email != (user.email or "")
    credentials_changed = username_changed or email_changed or bool(new_password)

    if credentials_changed:
        if not current_password:
            raise InvalidRequestError(
                "Current password is required",
                extra={"code": "current_password_required"},
            )
        if not verify_password(current_password, user.password_hash):
            raise AuthError(
                "Current password is incorrect",
                extra={"code": "invalid_current_password"},
            )

    if username_changed:
        existing = find_user_by_username(username)
        if existing is not None and int(existing.id) != int(user_id):
            raise InvalidRequestError(
                "Username already taken",
                extra={"code": "duplicate_username"},
            )

    password_hash = hash_password(new_password) if new_password else None

    # Handle display_name update while preserving legacy reset requirements if password is not changed.
    formatted_display_name = None
    if display_name is not None:
        new_clean = parse_account_state(display_name).display_name
        current_state = parse_account_state(user.display_name)
        if current_state.requires_password_reset and not password_hash:
            formatted_display_name = encode_display_name(
                new_clean,
                requires_password_reset=True,
                legacy_account=current_state.legacy_account,
            )
        else:
            formatted_display_name = new_clean

    updated = update_user_profile(
        user_id,
        username=username if username_changed else None,
        email=email if email_changed else None,
        display_name=formatted_display_name,
        password_hash=password_hash,
    )
    if updated is None:
        raise DbDisabledError("User not persisted")
    return updated


def get_member_profile(user_id: int) -> Optional[dict]:
    """Retrieve the member profile payload with clean display_name."""
    from ..schemas.member import _profile_payload

    if not is_db_enabled():
        return None
    with session_scope() as session:
        if session is None:
            return None
        user = session.execute(select(User).where(User.id == int(user_id))).scalar_one_or_none()
        if user is None:
            return None
        profile = _get_or_create_profile(session, user)
        return _profile_payload(user, profile)


def update_member_profile(
    user_id: int,
    *,
    display_name: Optional[str] = None,
    avatar_url: Optional[str] = None,
    bio: Optional[str] = None,
) -> Optional[dict]:
    """Update member profile details with clean parsing at the boundary."""
    from ..schemas.member import _profile_payload

    if not is_db_enabled():
        return None
    with session_scope() as session:
        if session is None:
            return None
        user = session.execute(select(User).where(User.id == int(user_id))).scalar_one_or_none()
        if user is None:
            return None
        profile = _get_or_create_profile(session, user)

        if display_name is not None:
            clean_name = parse_account_state(display_name).display_name
            current_state = parse_account_state(user.display_name)
            # Retain legacy reset marker internally if user still requires password reset.
            if current_state.requires_password_reset:
                stored_name = encode_display_name(
                    clean_name,
                    requires_password_reset=True,
                    legacy_account=current_state.legacy_account,
                )
            else:
                stored_name = clean_name
            user.display_name = stored_name
            profile.display_name = stored_name

        if avatar_url is not None:
            profile.avatar_url = avatar_url.strip()
        if bio is not None:
            profile.bio = bio.strip()
        profile.updated_at = datetime.now(timezone.utc)
        session.flush()
        return _profile_payload(user, profile)


# --- Google OAuth Resolution & Avatar Mirroring ------------------------------


def resolve_google_identity(
    *,
    subject_id: str,
    email: str,
    display_name: str = "",
    avatar_url: str = "",
) -> Tuple[Optional[User], str]:
    """Find, safely link, or create the local account for a Google identity."""
    if not is_db_enabled():
        return None, "disabled"
    subject = (subject_id or "").strip()
    normalized_email = (email or "").strip().lower()
    if not subject or not normalized_email:
        return None, "invalid"
    with session_scope() as session:
        existing_subject = session.execute(
            select(User).where(User.google_subject_id == subject)
        ).scalar_one_or_none()
        if existing_subject is not None:
            existing_subject.email_verified = True
            profile = _get_or_create_profile(session, existing_subject)
            if avatar_url and not profile.avatar_url:
                profile.avatar_url = avatar_url.strip()
            session.flush()
            session.refresh(existing_subject)
            return existing_subject, "existing"

        email_matches = list(
            session.execute(
                select(User).where(func.lower(User.email) == normalized_email)
            ).scalars()
        )
        if len(email_matches) > 1:
            raise AmbiguousGoogleEmailError(
                "This email is shared by multiple local accounts"
            )
        if len(email_matches) == 1:
            user = email_matches[0]
            if user.google_subject_id and user.google_subject_id != subject:
                raise AmbiguousGoogleEmailError(
                    "This email is already linked to another Google identity"
                )
            user.google_subject_id = subject
            user.auth_provider = "password+google"
            user.email_verified = True
            profile = _get_or_create_profile(session, user)
            if avatar_url and not profile.avatar_url:
                profile.avatar_url = avatar_url.strip()
            session.flush()
            session.refresh(user)
            return user, "linked"

        username = _available_google_username(session, normalized_email)
        name = (display_name or "").strip() or username
        user = User(
            username=username,
            email=normalized_email,
            password_hash=f"!google:{secrets.token_urlsafe(32)}",
            google_subject_id=subject,
            auth_provider="google",
            email_verified=True,
            display_name=name,
            is_admin=False,
        )
        session.add(user)
        session.flush()
        session.add(
            UserProfile(
                user_id=int(user.id),
                display_name=name,
                avatar_url=(avatar_url or "").strip(),
                role="user",
                user_group="user",
            )
        )
        session.flush()
        session.refresh(user)
        return user, "created"


def exchange_google_login(code: str) -> tuple[User, str, int]:
    """Consume the callback login code and issue the application JWT."""
    from . import google_login_oauth

    _require_db()
    exchanged = google_login_oauth.consume_login_code(code)
    if exchanged is None:
        raise AuthError(
            "Google login code is invalid or expired",
            extra={"code": "invalid_google_login_code"},
        )
    user_id, _next_path = exchanged
    user = find_user_by_id(user_id)
    if user is None:
        raise AuthError(
            "Google login account no longer exists",
            extra={"code": "google_account_not_found"},
        )
    token, expires_in = create_token(user.id, user.username, bool(user.is_admin))
    return user, token, expires_in


# --- Password Reset Tokens --------------------------------------------------


def find_user_by_username_and_email(username: str, email: str) -> Optional[User]:
    """Return the account only when both recovery identifiers match."""
    if not is_db_enabled():
        return None
    with session_scope() as session:
        return session.execute(
            select(User).where(
                User.username == username,
                func.lower(User.email) == email.strip().lower(),
            )
        ).scalar_one_or_none()


def create_password_reset_token(
    username: str,
    email: str,
    *,
    ttl_minutes: int,
) -> Optional[Tuple[User, str]]:
    """Create a one-time raw token while persisting only its SHA-256 hash."""
    if not is_db_enabled():
        return None
    now = datetime.now(timezone.utc)
    with session_scope() as session:
        user = session.execute(
            select(User).where(
                User.username == username,
                func.lower(User.email) == email.strip().lower(),
            )
        ).scalar_one_or_none()
        if user is None:
            return None
        recent = session.execute(
            select(PasswordResetToken.id).where(
                PasswordResetToken.user_id == int(user.id),
                PasswordResetToken.created_at > now - timedelta(minutes=1),
            ).limit(1)
        ).scalar_one_or_none()
        if recent is not None:
            return None
        session.execute(
            update(PasswordResetToken)
            .where(
                PasswordResetToken.user_id == int(user.id),
                PasswordResetToken.used_at.is_(None),
            )
            .values(used_at=now)
        )
        raw_token = secrets.token_urlsafe(32)
        session.add(
            PasswordResetToken(
                user_id=int(user.id),
                token_hash=hashlib.sha256(raw_token.encode("utf-8")).hexdigest(),
                expires_at=now + timedelta(minutes=max(1, int(ttl_minutes))),
            )
        )
        session.flush()
        return user, raw_token


def revoke_password_reset_token(raw_token: str) -> None:
    if not is_db_enabled():
        return
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    with session_scope() as session:
        row = session.execute(
            select(PasswordResetToken).where(
                PasswordResetToken.token_hash == token_hash,
                PasswordResetToken.used_at.is_(None),
            )
        ).scalar_one_or_none()
        if row is not None:
            row.used_at = datetime.now(timezone.utc)


def consume_password_reset_token(
    username: str,
    raw_token: str,
    password_hash: str,
) -> Optional[User]:
    """Atomically consume a valid token, clear legacy reset markers, and update password."""
    if not is_db_enabled():
        return None
    now = datetime.now(timezone.utc)
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    with session_scope() as session:
        user = session.execute(
            select(User).where(User.username == username)
        ).scalar_one_or_none()
        if user is None:
            return None
        token = session.execute(
            select(PasswordResetToken).where(
                PasswordResetToken.user_id == int(user.id),
                PasswordResetToken.token_hash == token_hash,
                PasswordResetToken.used_at.is_(None),
                PasswordResetToken.expires_at > now,
            )
        ).scalar_one_or_none()
        if token is None:
            return None
        token.used_at = now
        user.password_hash = password_hash
        clean_name = parse_account_state(
            user.display_name or "", fallback=str(user.username)
        ).display_name
        user.display_name = clean_name
        profile = _get_or_create_profile(session, user)
        profile.display_name = clean_name
        profile.updated_at = now
        session.execute(
            update(PasswordResetToken)
            .where(
                PasswordResetToken.user_id == int(user.id),
                PasswordResetToken.used_at.is_(None),
            )
            .values(used_at=now)
        )
        session.flush()
        session.refresh(user)
        return user


def request_password_reset(username: str, email: str) -> dict:
    """Validate recovery identifiers and dispatch a password reset email."""
    _require_db()
    settings = get_settings()
    account = find_user_by_username_and_email(username, email)
    if account is None:
        return {
            "accepted": False,
            "credentials_valid": False,
            "email_sent": False,
            "delivery_configured": mailer.delivery_configured(),
            "message": "ชื่อผู้ใช้หรืออีเมลไม่ถูกต้อง กรุณาตรวจสอบข้อมูลอีกครั้ง",
        }

    created = create_password_reset_token(
        username,
        email,
        ttl_minutes=settings.password_reset_token_minutes,
    )
    if created is None:
        return {
            "accepted": False,
            "credentials_valid": True,
            "email_sent": False,
            "delivery_configured": mailer.delivery_configured(),
            "message": "มีการส่งคำขอสำหรับบัญชีนี้แล้ว กรุณารอ 1 นาทีก่อนส่งใหม่",
        }

    user, raw_token = created
    delivery_ready = mailer.delivery_configured()
    if not mailer.send_password_reset_email(user.email, user.username, raw_token):
        revoke_password_reset_token(raw_token)
        return {
            "accepted": False,
            "credentials_valid": True,
            "email_sent": False,
            "delivery_configured": delivery_ready,
            "message": "ข้อมูลถูกต้อง แต่ระบบส่งอีเมลไม่สำเร็จ กรุณาลองใหม่หรือติดต่อผู้ดูแลระบบ",
        }

    return {
        "accepted": True,
        "credentials_valid": True,
        "email_sent": True,
        "delivery_configured": delivery_ready,
        "message": "ระบบได้ส่งคำขอเปลี่ยนรหัสผ่านไปยังอีเมลที่กำหนดแล้ว กรุณาตรวจสอบกล่องจดหมาย",
    }


def confirm_password_reset(username: str, token: str, new_password: str) -> User:
    """Consume a valid reset token and set a new password."""
    _require_db()
    updated = consume_password_reset_token(
        username,
        token,
        hash_password(new_password),
    )
    if updated is None:
        raise InvalidRequestError(
            "Reset link is invalid, expired, or already used",
            extra={"code": "invalid_reset_token"},
        )
    return updated


# --- Admin User Management --------------------------------------------------


def list_users(limit: int = 100) -> List[User]:
    """List users for admin console."""
    if not is_db_enabled():
        return []
    with session_scope() as session:
        stmt = select(User).order_by(User.id).limit(limit)
        return list(session.execute(stmt).scalars())


def create_admin_user(
    *,
    username: str,
    password: str,
    email: str = "",
    display_name: str = "",
    is_admin: bool = False,
) -> User:
    """Create a user from the admin console with explicit is_admin setting."""
    _require_db()
    if find_user_by_username(username) is not None:
        raise InvalidRequestError(
            "Username already taken",
            extra={"code": "duplicate_username"},
        )
    user = create_user(
        username=username,
        password_hash=hash_password(password),
        email=email or "",
        display_name=display_name or "",
        is_admin=is_admin,
    )
    if user is None:
        raise InvalidRequestError(
            "User could not be created",
            extra={"code": "user_not_created"},
        )
    return user


def update_user_by_admin(
    user_id: int,
    *,
    current_admin_id: Optional[int] = None,
    username: Optional[str] = None,
    email: Optional[str] = None,
    display_name: Optional[str] = None,
    password: Optional[str] = None,
    password_hash: Optional[str] = None,
    is_admin: Optional[bool] = None,
) -> User:
    """Update account and authorization fields from the admin console."""
    _require_db()
    target = find_user_by_id(user_id)
    if target is None:
        raise InvalidRequestError("User not found", extra={"code": "user_not_found"})

    if username is not None and username != target.username:
        duplicate = find_user_by_username(username)
        if duplicate is not None and int(duplicate.id) != int(user_id):
            raise InvalidRequestError(
                "Username already taken",
                extra={"code": "duplicate_username"},
            )

    if current_admin_id is not None and int(current_admin_id) == int(user_id) and is_admin is False:
        raise InvalidRequestError(
            "You cannot remove your own administrator role",
            extra={"code": "cannot_demote_self"},
        )

    pwd_hash = password_hash
    if password:
        pwd_hash = hash_password(password)

    with session_scope() as session:
        user = session.execute(
            select(User).where(User.id == int(user_id))
        ).scalar_one_or_none()
        if user is None:
            raise InvalidRequestError("User not found", extra={"code": "user_not_found"})

        if username is not None:
            user.username = username
        if email is not None:
            user.email = email.strip().lower()
        if display_name is not None:
            user.display_name = display_name
        if pwd_hash is not None:
            user.password_hash = pwd_hash
        if is_admin is not None:
            user.is_admin = bool(is_admin)

        profile = _get_or_create_profile(session, user)
        if display_name is not None:
            profile.display_name = display_name
        role = "super_admin" if bool(user.is_admin) else "user"
        profile.role = role
        profile.user_group = role
        profile.updated_at = datetime.now(timezone.utc)
        session.flush()
        session.refresh(user)
        return user


def delete_user_by_admin(user_id: int, *, current_admin_id: Optional[int] = None) -> bool:
    """Delete one user from the admin console with self-deletion guard."""
    _require_db()
    if current_admin_id is not None and int(current_admin_id) == int(user_id):
        raise InvalidRequestError(
            "You cannot delete the account you are currently using",
            extra={"code": "cannot_delete_self"},
        )
    if find_user_by_id(user_id) is None:
        raise InvalidRequestError("User not found", extra={"code": "user_not_found"})
    if not delete_user(user_id):
        raise InvalidRequestError(
            "User could not be deleted",
            extra={"code": "user_not_deleted"},
        )
    return True


def delete_user(user_id: int) -> bool:
    """Delete one account; database FK policies handle dependent records."""
    if not is_db_enabled():
        return False
    with session_scope() as session:
        result = session.execute(delete(User).where(User.id == int(user_id)))
        return bool(result.rowcount)


# --- Backward Compatibility / Domain Interface Export ----------------------


class MemberIdentityModule:
    """Namespace / module wrapper for member identity operations."""

    AccountState = AccountState
    parse_account_state = staticmethod(parse_account_state)
    encode_display_name = staticmethod(encode_display_name)
    hash_password = staticmethod(hash_password)
    verify_password = staticmethod(verify_password)
    create_token = staticmethod(create_token)
    decode_token = staticmethod(decode_token)
    signup_user = staticmethod(signup_user)
    authenticate_user = staticmethod(authenticate_user)
    update_user_credentials = staticmethod(update_user_credentials)
    get_member_profile = staticmethod(get_member_profile)
    update_member_profile = staticmethod(update_member_profile)
    resolve_google_identity = staticmethod(resolve_google_identity)
    exchange_google_login = staticmethod(exchange_google_login)
    request_password_reset = staticmethod(request_password_reset)
    confirm_password_reset = staticmethod(confirm_password_reset)
    list_users = staticmethod(list_users)
    create_admin_user = staticmethod(create_admin_user)
    update_user_by_admin = staticmethod(update_user_by_admin)
    delete_user_by_admin = staticmethod(delete_user_by_admin)
    delete_user = staticmethod(delete_user)
    find_user_by_username = staticmethod(find_user_by_username)
    find_user_by_id = staticmethod(find_user_by_id)
    count_users = staticmethod(count_users)
    create_user = staticmethod(create_user)
    set_last_login = staticmethod(set_last_login)
    update_user_profile = staticmethod(update_user_profile)
