"""
schemas/user.py — Pydantic v2 request/response models for /auth/* endpoints.

Validation:
* ``username`` is trimmed and must be 3..64 chars after trimming.
* ``password`` is 8..128 chars (long enough to be meaningful, short enough
  to discourage paste errors).
* ``display_name`` is optional and trimmed.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator


def _strip(value: str) -> str:
    return value.strip() if isinstance(value, str) else value


class UserSignup(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=128)
    display_name: Optional[str] = Field(default=None, max_length=120)

    @field_validator("username", "display_name")
    @classmethod
    def _trim(cls, v):
        return _strip(v) if isinstance(v, str) else v


class UserLogin(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("username")
    @classmethod
    def _trim(cls, v):
        return _strip(v) if isinstance(v, str) else v


class UserOut(BaseModel):
    id: int
    username: str
    display_name: str = ""
    is_admin: bool = False
    created_at: Optional[datetime] = None
    last_login_at: Optional[datetime] = None


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in_seconds: int
    user: UserOut