"""Tests for ``services.identity`` — Unified Member Identity Module.

Covers:
* ``AccountState`` parsing and display name marker encoding.
* Authentication and registration flows.
* Profile credentials and self-update edge cases.
* Password reset lifecycle and token consumption.
* Admin user CRUD and self-protection rules.
* Google OAuth identity linking and token exchange.
* Error cases and DB-disabled short circuits.
"""
from __future__ import annotations

from contextlib import contextmanager
from types import SimpleNamespace
from typing import Iterator

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings, reset_settings_cache
from app.core.exceptions import AuthError, DbDisabledError, ForbiddenError, InvalidRequestError
from app.db import reset_engine
from app.models_db import Base, User
from app.services import identity


@pytest.fixture
def db_session(monkeypatch) -> Iterator[Session]:
    """In-memory SQLite + monkeypatched session_scope for identity tests."""
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


# --- AccountState and Display Name Markers ----------------------------------


def test_parse_account_state_plain():
    state = identity.parse_account_state("สมชาย")
    assert state.display_name == "สมชาย"
    assert state.requires_password_reset is False
    assert state.legacy_account is False


def test_parse_account_state_must_reset_and_legacy():
    state = identity.parse_account_state("must_reset|legacy:alice")
    assert state.display_name == "alice"
    assert state.requires_password_reset is True
    assert state.legacy_account is True


def test_parse_account_state_must_reset_only():
    state = identity.parse_account_state("must_reset|bob")
    assert state.display_name == "bob"
    assert state.requires_password_reset is True
    assert state.legacy_account is False


def test_parse_account_state_legacy_only():
    state = identity.parse_account_state("legacy:charlie")
    assert state.display_name == "charlie"
    assert state.requires_password_reset is False
    assert state.legacy_account is True


def test_parse_account_state_empty_with_fallback():
    state = identity.parse_account_state("", fallback="default_user")
    assert state.display_name == "default_user"
    assert state.requires_password_reset is False
    assert state.legacy_account is False


def test_encode_display_name():
    assert (
        identity.encode_display_name("alice", requires_password_reset=True, legacy_account=True)
        == "must_reset|legacy:alice"
    )
    assert (
        identity.encode_display_name("bob", requires_password_reset=True, legacy_account=False)
        == "must_reset|bob"
    )
    assert (
        identity.encode_display_name("charlie", requires_password_reset=False, legacy_account=True)
        == "legacy:charlie"
    )
    assert (
        identity.encode_display_name("david", requires_password_reset=False, legacy_account=False)
        == "david"
    )


# --- User Authentication & Registration -------------------------------------


def test_signup_user_happy_path(db_session):
    user, token, expires_in = identity.signup_user(
        username="alice",
        password="password123",
        email="alice@example.com",
        display_name="Alice A",
    )
    assert user.username == "alice"
    assert user.is_admin is True  # First user bootstrap
    assert token
    assert expires_in > 0

    out = identity.user_to_out(user)
    assert out.username == "alice"
    assert out.role == "super_admin"


def test_signup_user_duplicate_username_raises(db_session):
    identity.signup_user(username="alice", password="password123")
    with pytest.raises(InvalidRequestError) as exc:
        identity.signup_user(username="alice", password="password456")
    assert exc.value.extra.get("code") == "duplicate_username"


def test_authenticate_user_success_and_failure(db_session):
    identity.signup_user(username="bob", password="mypassword123")

    user, token, expires_in = identity.authenticate_user("bob", "mypassword123")
    assert user.username == "bob"
    assert token

    with pytest.raises(AuthError) as exc_wrong_pw:
        identity.authenticate_user("bob", "wrongpassword")
    assert exc_wrong_pw.value.extra.get("code") == "invalid_credentials"

    with pytest.raises(AuthError) as exc_unknown:
        identity.authenticate_user("ghost", "mypassword123")
    assert exc_unknown.value.extra.get("code") == "invalid_credentials"


# --- Profile and Credential Updates -----------------------------------------


def test_update_user_credentials_display_name_only(db_session):
    user, _, _ = identity.signup_user(
        username="charlie",
        password="password123",
        display_name="must_reset|legacy:charlie",
    )
    # Updating display_name without changing password preserves legacy reset requirement
    updated = identity.update_user_credentials(
        user.id,
        display_name="New Charlie",
    )
    assert updated.display_name == "must_reset|legacy:New Charlie"
    out = identity.user_to_out(updated)
    assert out.display_name == "New Charlie"
    assert out.requires_password_reset is True


def test_update_user_credentials_with_password_change(db_session):
    user, _, _ = identity.signup_user(
        username="david",
        password="oldpassword123",
        display_name="must_reset|legacy:david",
    )
    updated = identity.update_user_credentials(
        user.id,
        current_password="oldpassword123",
        new_password="newpassword123",
        display_name="David Clean",
    )
    assert updated.display_name == "David Clean"
    out = identity.user_to_out(updated)
    assert out.display_name == "David Clean"
    assert out.requires_password_reset is False

    # Old password no longer works
    with pytest.raises(AuthError):
        identity.authenticate_user("david", "oldpassword123")
    # New password works
    user2, _, _ = identity.authenticate_user("david", "newpassword123")
    assert user2.id == user.id


def test_update_user_credentials_validates_current_password(db_session):
    user, _, _ = identity.signup_user(username="eve", password="password123")

    with pytest.raises(InvalidRequestError) as exc_missing:
        identity.update_user_credentials(user.id, username="eve-new")
    assert exc_missing.value.extra.get("code") == "current_password_required"

    with pytest.raises(AuthError) as exc_invalid:
        identity.update_user_credentials(
            user.id,
            current_password="wrongpassword",
            username="eve-new",
        )
    assert exc_invalid.value.extra.get("code") == "invalid_current_password"


def test_update_user_credentials_duplicate_username(db_session):
    user1, _, _ = identity.signup_user(username="user1", password="password123")
    user2, _, _ = identity.signup_user(username="user2", password="password123")

    with pytest.raises(InvalidRequestError) as exc:
        identity.update_user_credentials(
            user2.id,
            current_password="password123",
            username="user1",
        )
    assert exc.value.extra.get("code") == "duplicate_username"


# --- Password Reset Flow ----------------------------------------------------


def test_password_reset_flow(db_session, monkeypatch):
    from app.services import mailer

    captured = {}
    monkeypatch.setattr(mailer, "delivery_configured", lambda: True)
    monkeypatch.setattr(
        mailer,
        "send_password_reset_email",
        lambda email, username, token: captured.update(email=email, username=username, token=token) or True,
    )

    user, _, _ = identity.signup_user(
        username="resetuser",
        email="reset@example.com",
        password="oldpassword123",
    )

    # Request reset
    res = identity.request_password_reset("resetuser", "reset@example.com")
    assert res["accepted"] is True
    assert res["email_sent"] is True
    assert captured["token"]

    # Cooldown blocks immediate re-request
    res2 = identity.request_password_reset("resetuser", "reset@example.com")
    assert res2["accepted"] is False
    assert res2["credentials_valid"] is True

    # Confirm reset with valid token
    updated = identity.confirm_password_reset("resetuser", captured["token"], "newpassword123")
    assert updated.id == user.id

    # Token cannot be reused
    with pytest.raises(InvalidRequestError) as exc:
        identity.confirm_password_reset("resetuser", captured["token"], "anotherpassword123")
    assert exc.value.extra.get("code") == "invalid_reset_token"


# --- Admin User Management --------------------------------------------------


def test_admin_user_crud(db_session):
    admin = identity.create_admin_user(
        username="admin1",
        password="adminpassword123",
        email="admin@example.com",
        display_name="Admin",
        is_admin=True,
    )
    assert admin.is_admin is True

    member = identity.create_admin_user(
        username="member1",
        password="memberpassword123",
        email="member@example.com",
        display_name="Member",
        is_admin=False,
    )
    assert member.is_admin is False

    users = identity.list_users(limit=10)
    assert len(users) == 2

    # Admin updates member
    updated_member = identity.update_user_by_admin(
        member.id,
        current_admin_id=admin.id,
        display_name="Updated Member",
        is_admin=True,
    )
    assert updated_member.display_name == "Updated Member"
    assert updated_member.is_admin is True

    # Admin cannot demote self
    with pytest.raises(InvalidRequestError) as exc_demote:
        identity.update_user_by_admin(
            admin.id,
            current_admin_id=admin.id,
            is_admin=False,
        )
    assert exc_demote.value.extra.get("code") == "cannot_demote_self"

    # Admin cannot delete self
    with pytest.raises(InvalidRequestError) as exc_del_self:
        identity.delete_user_by_admin(
            admin.id,
            current_admin_id=admin.id,
        )
    assert exc_del_self.value.extra.get("code") == "cannot_delete_self"

    # Delete other user
    assert identity.delete_user_by_admin(member.id, current_admin_id=admin.id) is True
    assert identity.find_user_by_id(member.id) is None


# --- Google OAuth Identity & Avatar -----------------------------------------


def test_google_login_exchange(db_session, monkeypatch):
    from app.services import google_login_oauth

    user, _, _ = identity.signup_user(username="guser", password="password123")
    monkeypatch.setattr(
        google_login_oauth,
        "consume_login_code",
        lambda code: (user.id, "/recommend") if code == "valid-code" else None,
    )

    resolved_user, token, expires_in = identity.exchange_google_login("valid-code")
    assert resolved_user.id == user.id
    assert token

    with pytest.raises(AuthError) as exc_invalid:
        identity.exchange_google_login("invalid-code")
    assert exc_invalid.value.extra.get("code") == "invalid_google_login_code"


# --- DB Disabled Handling ---------------------------------------------------


def test_db_disabled_short_circuits(monkeypatch):
    monkeypatch.setattr(identity, "is_db_enabled", lambda: False)

    assert identity.find_user_by_username("any") is None
    assert identity.find_user_by_id(1) is None
    assert identity.count_users() == 0
    assert identity.list_users() == []
    assert identity.get_member_profile(1) is None
    assert identity.update_member_profile(1, display_name="Test") is None
    assert identity.delete_user(1) is False

    with pytest.raises(DbDisabledError):
        identity.signup_user(username="a", password="p")

    with pytest.raises(DbDisabledError):
        identity.authenticate_user("a", "p")

    with pytest.raises(DbDisabledError):
        identity.create_admin_user(username="a", password="p")


# --- MemberIdentityModule Facade -------------------------------------------


def test_member_identity_module_facade():
    mod = identity.MemberIdentityModule
    assert mod.AccountState is identity.AccountState
    assert mod.parse_account_state("test").display_name == "test"
    assert mod.hash_password("pw").startswith("$2b$")


# --- Additional Coverage & Edge Cases ---------------------------------------


def test_bearer_token_parsing():
    assert identity._bearer(None) is None
    assert identity._bearer("") is None
    assert identity._bearer("Basic abc") is None
    assert identity._bearer("Bearer") is None
    assert identity._bearer("Bearer token123") == "token123"


def test_get_current_user_and_admin_dependencies(db_session):
    user, token, _ = identity.signup_user(username="admin_dep", password="password123")
    assert identity.get_current_user(f"Bearer {token}").id == user.id
    assert identity.get_current_user(None) is None

    # Invalid token raises AuthError
    with pytest.raises(AuthError):
        identity.get_current_user("Bearer invalid-token")

    # Admin check
    admin_checked = identity.get_current_admin(user)
    assert admin_checked.id == user.id

    # Non-admin raises ForbiddenError
    member, member_token, _ = identity.signup_user(
        username="member_dep",
        password="password123",
        is_admin=False,
    )
    with pytest.raises(ForbiddenError):
        identity.get_current_admin(member)

    with pytest.raises(AuthError):
        identity.get_current_admin(None)


def test_update_member_profile_avatar_and_bio(db_session):
    user, _, _ = identity.signup_user(username="prof_user", password="password123")
    prof = identity.update_member_profile(
        user.id,
        avatar_url="https://example.com/avatar.jpg",
        bio="Test bio description",
    )
    assert prof["avatar_url"] == "https://example.com/avatar.jpg"
    assert prof["bio"] == "Test bio description"


def test_update_user_credentials_email_change(db_session):
    user, _, _ = identity.signup_user(
        username="emailuser",
        password="password123",
        email="old@example.com",
    )
    updated = identity.update_user_credentials(
        user.id,
        current_password="password123",
        email="NEW@example.com",
    )
    assert updated.email == "new@example.com"


def test_admin_user_update_with_password(db_session):
    admin = identity.create_admin_user(
        username="admin_pw",
        password="password123",
        is_admin=True,
    )
    target = identity.create_admin_user(
        username="target_pw",
        password="password123",
        is_admin=False,
    )
    updated = identity.update_user_by_admin(
        target.id,
        current_admin_id=admin.id,
        password="newpassword123",
        email="target@example.com",
    )
    assert updated.email == "target@example.com"
    # Login with new password
    u, _, _ = identity.authenticate_user("target_pw", "newpassword123")
    assert u.id == target.id


def test_admin_user_update_and_delete_not_found(db_session):
    admin = identity.create_admin_user(username="admin_nf", password="password123", is_admin=True)
    with pytest.raises(InvalidRequestError) as exc_up:
        identity.update_user_by_admin(9999, current_admin_id=admin.id, username="any")
    assert exc_up.value.extra.get("code") == "user_not_found"

    with pytest.raises(InvalidRequestError) as exc_del:
        identity.delete_user_by_admin(9999, current_admin_id=admin.id)
    assert exc_del.value.extra.get("code") == "user_not_found"


def test_admin_user_update_duplicate_username(db_session):
    admin = identity.create_admin_user(username="admin_dup1", password="password123", is_admin=True)
    user2 = identity.create_admin_user(username="user_dup2", password="password123", is_admin=False)
    with pytest.raises(InvalidRequestError) as exc:
        identity.update_user_by_admin(user2.id, current_admin_id=admin.id, username="admin_dup1")
    assert exc.value.extra.get("code") == "duplicate_username"


def test_resolve_google_identity_invalid_and_conflicts(db_session):
    res, status = identity.resolve_google_identity(subject_id="", email="")
    assert res is None
    assert status == "invalid"

    # Email linked to different subject raises AmbiguousGoogleEmailError
    u1, _ = identity.resolve_google_identity(
        subject_id="subj-1",
        email="linked@example.com",
    )
    with pytest.raises(identity.AmbiguousGoogleEmailError):
        identity.resolve_google_identity(
            subject_id="subj-2",
            email="linked@example.com",
        )
