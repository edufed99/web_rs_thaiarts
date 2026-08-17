"""Tests for user query helpers in ``services.identity`` — DB-layer helpers for the auth slice.

Uses an in-memory SQLite engine so the ``users`` table is created via
``Base.metadata.create_all``. Mirrors ``tests/test_db.py`` for the live-action
tables.
"""
from __future__ import annotations

from typing import Iterator

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.config import reset_settings_cache, get_settings
from app.db import is_db_enabled, reset_engine
from app.models_db import Base, User
from app.services import identity


@pytest.fixture
def db_session(monkeypatch) -> Iterator[Session]:
    """Spin up an in-memory SQLite engine + create_all + monkeypatch app.db."""
    reset_settings_cache()
    monkeypatch.setenv("RECSYS_DB_ENABLED", "1")
    reset_engine()

    engine = create_engine(
        "sqlite:///:memory:",
        future=True,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)

    # session_scope opens a Session bound to this engine.
    from contextlib import contextmanager

    @contextmanager
    def _scope():
        s = Session(engine, future=True, expire_on_commit=False)
        try:
            yield s
            s.commit()
        except Exception:
            s.rollback()
            raise
        finally:
            s.close()

    monkeypatch.setattr(identity, "session_scope", _scope)
    monkeypatch.setattr(identity, "is_db_enabled", lambda: True)
    yield Session(engine)
    engine.dispose()


def test_find_user_by_username_returns_none_when_empty(db_session):
    assert identity.find_user_by_username("alice") is None


def test_create_user_then_find(db_session):
    u = identity.create_user("alice", "$2b$12$abcdef", "Alice", is_admin=False)
    assert u is not None
    assert u.username == "alice"
    assert u.is_admin is False

    found = identity.find_user_by_username("alice")
    assert found is not None
    assert found.id == u.id


def test_create_user_first_user_is_admin_when_allowlist_empty(db_session, monkeypatch):
    # Allowlist must be patched BEFORE the first user is created, since
    # first-user-bootstrap fires only when count==0.
    monkeypatch.setattr(get_settings(), "admin_usernames", "", raising=False)
    u = identity.create_user("first", "$2b$12$xx", "First")
    assert u.is_admin is True


def test_create_user_allowlist_promotes_only_members(db_session, monkeypatch):
    monkeypatch.setattr(get_settings(), "admin_usernames", "bob", raising=False)
    a = identity.create_user("alice", "$2b$12$aa")
    b = identity.create_user("bob", "$2b$12$bb")
    # Allow-list mode: alice is not in the list, bob is.
    assert a.is_admin is False
    assert b.is_admin is True


def test_create_user_rejects_duplicate(db_session):
    identity.create_user("dup", "$2b$12$x")
    again = identity.create_user("dup", "$2b$12$x")
    assert again is None


def test_set_last_login_stamps(db_session):
    u = identity.create_user("alice", "$2b$12$aa")
    identity.set_last_login(u.id)
    fresh = identity.find_user_by_id(u.id)
    assert fresh is not None
    assert fresh.last_login_at is not None


def test_count_users(db_session):
    assert identity.count_users() == 0
    identity.create_user("a", "$2b$12$aa")
    identity.create_user("b", "$2b$12$bb")
    assert identity.count_users() == 2


def test_list_users_caps_limit(db_session):
    for i in range(3):
        identity.create_user(f"u{i}", "$2b$12$aa")
    rows = identity.list_users(limit=2)
    assert len(rows) == 2
    assert all(isinstance(r, User) for r in rows)


def test_find_user_by_id_missing(db_session):
    assert identity.find_user_by_id(999) is None


def test_google_identity_creates_and_reuses_member(db_session):
    created, action = identity.resolve_google_identity(
        subject_id="google-1",
        email="new.member@gmail.com",
        display_name="New Member",
        avatar_url="https://example/avatar.png",
    )
    assert action == "created"
    assert created.is_admin is False
    assert created.auth_provider == "google"
    assert created.email_verified is True
    again, action = identity.resolve_google_identity(
        subject_id="google-1", email="new.member@gmail.com"
    )
    assert action == "existing"
    assert again.id == created.id


def test_google_identity_links_one_existing_email(db_session):
    old = identity.create_user(
        "existing", "$2b$12$aa", email="existing@gmail.com", is_admin=False
    )
    linked, action = identity.resolve_google_identity(
        subject_id="google-linked", email="EXISTING@gmail.com"
    )
    assert action == "linked"
    assert linked.id == old.id
    assert linked.auth_provider == "password+google"


def test_google_identity_refuses_ambiguous_shared_email(db_session):
    identity.create_user("one", "hash", email="shared@gmail.com", is_admin=False)
    identity.create_user("two", "hash", email="shared@gmail.com", is_admin=False)
    with pytest.raises(identity.AmbiguousGoogleEmailError):
        identity.resolve_google_identity(
            subject_id="google-shared", email="shared@gmail.com"
        )


def test_disabled_db_short_circuits(monkeypatch):
    monkeypatch.setattr(identity, "is_db_enabled", lambda: False)
    assert identity.find_user_by_username("any") is None
    assert identity.find_user_by_id(1) is None
    assert identity.create_user("any", "x") is None
    assert identity.count_users() == 0
    assert identity.list_users() == []
    # set_last_login is a no-op when DB is off.
    identity.set_last_login(1)
