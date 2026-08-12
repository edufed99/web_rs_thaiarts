"""
services/user_query.py — DB-side helpers for the ``users`` table (admin slice).

These mirror the conventions of ``db_query.py``:

* Public ``fn()`` returns ``None`` / ``[]`` when the DB is disabled.
* Private ``_fn(session, ...)`` does the actual work and takes a
  ``Session`` as first arg so tests can drive it with a SQLite in-memory
  engine.
* The first signed-up user is auto-promoted to ``is_admin=True`` *only
  when* ``settings.admin_usernames`` is empty (no explicit allow-list).
  When the allow-list is non-empty, ``is_admin`` follows membership in
  that list (set at signup time).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import re
import secrets
from typing import List, Optional, Tuple

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from ..core.config import get_settings
from ..db import is_db_enabled, session_scope
from ..models_db import PasswordResetToken, User, UserProfile


PASSWORD_RESET_MARKER = "must_reset|"
LEGACY_NAME_MARKER = "legacy:"


class AmbiguousGoogleEmailError(RuntimeError):
    """Raised when an email maps to multiple local research accounts."""


# --- Private helpers --------------------------------------------------------


def _strip_internal_display_markers(value: str, fallback: str = "") -> str:
    """Return only the member-facing portion of a migrated display name."""
    clean = (value or "").strip()
    if clean.startswith(PASSWORD_RESET_MARKER):
        clean = clean[len(PASSWORD_RESET_MARKER):].strip()
    if clean.startswith(LEGACY_NAME_MARKER):
        clean = clean[len(LEGACY_NAME_MARKER):].strip()
    return clean or fallback


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
    """Whether ``username`` is in the ``admin_usernames`` allow-list.

    When the allow-list is empty this returns ``True`` (the legacy
    bootstrap-admin rule); the actual decision is then made by combining
    this with ``count == 0`` in ``create_user``. Kept for backwards
    compatibility with tests that probe the helper directly.
    """
    allow = get_settings().admin_usernames_list
    if allow:
        return username in allow
    # No explicit allow-list → first user is admin (applied in create_user).
    return True


# --- Public API -------------------------------------------------------------


def find_user_by_username(username: str) -> Optional[User]:
    """Look up a user by username. Returns ``None`` if DB disabled / no row."""
    if not is_db_enabled():
        return None
    with session_scope() as session:
        return _find_by_username(session, username)


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
    """Insert a new user. Returns the persisted row, or ``None`` if DB off.

    If ``is_admin`` is not supplied, ``_is_admin_username`` decides:
    * When ``settings.admin_usernames`` is empty and this is the first
      user, ``is_admin=True`` (bootstrap admin).
    * When ``admin_usernames`` is non-empty, membership decides.
    * Otherwise ``False``.
    """
    if not is_db_enabled():
        return None
    with session_scope() as session:
        if _find_by_username(session, username) is not None:
            return None  # duplicate; caller should validate beforehand
        if is_admin is None:
            allow = get_settings().admin_usernames_list
            if allow:
                # Allow-list mode: membership decides, regardless of user count.
                is_admin = username in allow
            else:
                # No allow-list → first user is bootstrap admin.
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
        stmt = select(User).where(User.id == user_id)
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
        stmt = select(User).where(User.id == user_id)
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
                select(UserProfile).where(UserProfile.user_id == user_id)
            ).scalar_one_or_none()
            if profile is not None:
                profile.display_name = display_name
                profile.updated_at = datetime.now(timezone.utc)
        if password_hash is not None:
            user.password_hash = password_hash
            if getattr(user, "google_subject_id", None):
                user.auth_provider = "password+google"
            # Imported accounts use a display-name prefix as their legacy
            # password-reset flag. Once the password is changed, remove the
            # internal markers from both profile mirrors.
            if (user.display_name or "").strip().startswith(PASSWORD_RESET_MARKER):
                clean_name = _strip_internal_display_markers(
                    user.display_name,
                    fallback=str(user.username),
                )
                user.display_name = clean_name
                profile = _get_or_create_profile(session, user)
                profile.display_name = clean_name
                profile.updated_at = datetime.now(timezone.utc)
        session.flush()
        session.refresh(user)
        return user


def _profile_payload(user: User, profile: UserProfile) -> dict:
    """Return the canonical member profile representation.

    Authorization always comes from ``users.is_admin``. The legacy profile
    role/group columns are mirrors only and are synchronized whenever the
    profile is read or updated.
    """
    role = "super_admin" if bool(user.is_admin) else "user"
    return {
        "user_id": int(user.id),
        "username": str(user.username),
        "email": str(user.email or ""),
        "display_name": str(user.display_name or ""),
        "avatar_url": str(profile.avatar_url or ""),
        "bio": str(profile.bio or ""),
        "role": role,
        "created_at": user.created_at,
        "last_login_at": user.last_login_at,
        "updated_at": profile.updated_at,
    }


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
        # Keep legacy mirrors consistent with the canonical auth flag.
        profile.role = role
        profile.user_group = role
    return profile


def get_member_profile(user_id: int) -> Optional[dict]:
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
    """Update self-editable fields only; role/group are never accepted."""
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
            clean_name = _strip_internal_display_markers(display_name)
            if (user.display_name or "").strip().startswith(PASSWORD_RESET_MARKER):
                # Editing public profile information must not silently clear
                # the separate password-reset requirement.
                stored_name = f"{PASSWORD_RESET_MARKER}{clean_name}"
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


def find_user_by_id(user_id: int) -> Optional[User]:
    if not is_db_enabled():
        return None
    with session_scope() as session:
        stmt = select(User).where(User.id == user_id)
        return session.execute(stmt).scalar_one_or_none()


def resolve_google_identity(
    *,
    subject_id: str,
    email: str,
    display_name: str = "",
    avatar_url: str = "",
) -> Tuple[Optional[User], str]:
    """Find, safely link, or create the local account for a Google identity.

    An existing unique email is linked so its recommendation history remains
    attached to the same user ID. Shared fixture emails are never guessed.
    Google-created accounts are always ordinary members, never bootstrap admins.
    """
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


def list_users(limit: int = 100) -> List[User]:
    if not is_db_enabled():
        return []
    with session_scope() as session:
        stmt = select(User).order_by(User.id).limit(limit)
        return list(session.execute(stmt).scalars())


def update_user_by_admin(
    user_id: int,
    *,
    username: Optional[str] = None,
    email: Optional[str] = None,
    display_name: Optional[str] = None,
    password_hash: Optional[str] = None,
    is_admin: Optional[bool] = None,
) -> Optional[User]:
    """Update account and authorization fields from the admin console."""
    if not is_db_enabled():
        return None
    with session_scope() as session:
        user = session.execute(
            select(User).where(User.id == int(user_id))
        ).scalar_one_or_none()
        if user is None:
            return None
        if username is not None:
            user.username = username
        if email is not None:
            user.email = email.strip().lower()
        if display_name is not None:
            user.display_name = display_name
        if password_hash is not None:
            user.password_hash = password_hash
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


def delete_user(user_id: int) -> bool:
    """Delete one account; database FK policies handle dependent records."""
    if not is_db_enabled():
        return False
    with session_scope() as session:
        result = session.execute(delete(User).where(User.id == int(user_id)))
        return bool(result.rowcount)


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
    """Create a one-time raw token while persisting only its SHA-256 hash.

    Returns ``None`` for an unknown username/email pair and during the
    one-minute resend cooldown. Callers must validate the pair first when
    they need to distinguish a mismatch from the cooldown state.
    """
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
    """Atomically consume a valid token and replace the user's password."""
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
        clean_name = _strip_internal_display_markers(
            user.display_name or "", fallback=str(user.username)
        )
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
