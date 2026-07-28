"""Tests for ``routers._user_key`` — the JWT/anon translation helper."""
from __future__ import annotations

import pytest

from app.core.exceptions import AuthError
from app.routers._user_key import resolve_user_key


def test_resolve_user_key_from_jwt():
    class FakeUser:
        id = 42

    assert resolve_user_key(user=FakeUser(), body_user_key=None) == "user:42"


def test_resolve_user_key_from_anon_when_no_jwt():
    assert resolve_user_key(user=None, body_user_key="anon:abc-123") == "anon:abc-123"


def test_resolve_user_key_rejects_non_anon_body():
    with pytest.raises(AuthError) as exc:
        resolve_user_key(user=None, body_user_key="user:1")
    assert exc.value.extra.get("code") == "invalid_user_key"


def test_resolve_user_key_rejects_empty_body():
    with pytest.raises(AuthError) as exc:
        resolve_user_key(user=None, body_user_key="")
    assert exc.value.extra.get("code") == "missing_user_key"


def test_resolve_user_key_rejects_none_body():
    with pytest.raises(AuthError) as exc:
        resolve_user_key(user=None, body_user_key=None)
    assert exc.value.extra.get("code") == "missing_user_key"


def test_resolve_user_key_jwt_takes_precedence_over_body():
    class FakeUser:
        id = 99

    # When JWT is present, body_user_key is ignored (no exception).
    result = resolve_user_key(user=FakeUser(), body_user_key="anon:ignored")
    assert result == "user:99"


def test_get_current_user_dep_returns_none_when_no_header():
    from app.routers._user_key import get_current_user_dep

    # No Authorization header → None.
    assert get_current_user_dep(authorization=None) is None


def test_get_current_user_dep_returns_none_for_non_bearer():
    from app.routers._user_key import get_current_user_dep

    assert get_current_user_dep(authorization="Basic foo") is None
    assert get_current_user_dep(authorization="Token abc") is None
    assert get_current_user_dep(authorization="") is None


def test_get_current_user_dep_returns_none_for_empty_bearer():
    from app.routers._user_key import get_current_user_dep

    assert get_current_user_dep(authorization="Bearer ") is None
    assert get_current_user_dep(authorization="Bearer") is None