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

from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.config import get_settings
from ..db import is_db_enabled, session_scope
from ..models_db import User


# --- Private helpers --------------------------------------------------------


def _find_by_username(session: Session, username: str) -> Optional[User]:
    stmt = select(User).where(User.username == username)
    return session.execute(stmt).scalar_one_or_none()


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
    allow = get_settings().admin_usernames
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
            allow = get_settings().admin_usernames
            if allow:
                # Allow-list mode: membership decides, regardless of user count.
                is_admin = username in allow
            else:
                # No allow-list → first user is bootstrap admin.
                is_admin = _count_users(session) == 0
        user = User(
            username=username,
            password_hash=password_hash,
            display_name=display_name,
            is_admin=is_admin,
        )
        session.add(user)
        session.flush()
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


def find_user_by_id(user_id: int) -> Optional[User]:
    if not is_db_enabled():
        return None
    with session_scope() as session:
        stmt = select(User).where(User.id == user_id)
        return session.execute(stmt).scalar_one_or_none()


def list_users(limit: int = 100) -> List[User]:
    if not is_db_enabled():
        return []
    with session_scope() as session:
        stmt = select(User).order_by(User.id).limit(limit)
        return list(session.execute(stmt).scalars())