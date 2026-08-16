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
from typing import List, Literal, Optional
import re

from pydantic import BaseModel, Field, field_validator


def _strip(value: str) -> str:
    return value.strip() if isinstance(value, str) else value


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _normalize_email(value: str) -> str:
    clean = value.strip().lower() if isinstance(value, str) else value
    if clean and not _EMAIL_RE.fullmatch(clean):
        raise ValueError("invalid email address")
    return clean


class UserSignup(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    email: Optional[str] = Field(default=None, min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=128)
    display_name: Optional[str] = Field(default=None, max_length=120)

    @field_validator("username", "display_name", mode="before")
    @classmethod
    def _trim(cls, v):
        return _strip(v) if isinstance(v, str) else v

    @field_validator("email", mode="before")
    @classmethod
    def _email(cls, v):
        return _normalize_email(v) if isinstance(v, str) else v


class UserLogin(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("username")
    @classmethod
    def _trim(cls, v):
        return _strip(v) if isinstance(v, str) else v


class UserProfileUpdate(BaseModel):
    username: Optional[str] = Field(default=None, min_length=3, max_length=64)
    email: Optional[str] = Field(default=None, min_length=3, max_length=320)
    display_name: Optional[str] = Field(default=None, max_length=120)
    current_password: Optional[str] = Field(default=None, min_length=1, max_length=128)
    new_password: Optional[str] = Field(default=None, min_length=8, max_length=128)

    @field_validator("username", "display_name", mode="before")
    @classmethod
    def _trim_profile_fields(cls, v):
        return _strip(v) if isinstance(v, str) else v

    @field_validator("email", mode="before")
    @classmethod
    def _email(cls, v):
        return _normalize_email(v) if isinstance(v, str) else v


class PasswordResetRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    email: str = Field(min_length=3, max_length=320)

    @field_validator("username", mode="before")
    @classmethod
    def _username(cls, v):
        return _strip(v) if isinstance(v, str) else v

    @field_validator("email", mode="before")
    @classmethod
    def _email(cls, v):
        return _normalize_email(v)


class PasswordResetConfirm(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    token: str = Field(min_length=20, max_length=256)
    new_password: str = Field(min_length=8, max_length=128)

    @field_validator("username", "token", mode="before")
    @classmethod
    def _trim(cls, v):
        return _strip(v) if isinstance(v, str) else v


class PasswordResetRequestOut(BaseModel):
    accepted: bool = False
    credentials_valid: bool = False
    email_sent: bool = False
    delivery_configured: bool = False
    message: str


class PasswordResetConfirmOut(BaseModel):
    reset: bool = True
    message: str


class GmailOAuthStatusOut(BaseModel):
    client_configured: bool
    authorized: bool
    delivery_configured: bool
    sender_email: str
    redirect_uri: str


class GmailOAuthStartOut(BaseModel):
    authorization_url: str


class GoogleLoginExchange(BaseModel):
    code: str = Field(min_length=20, max_length=512)


class UserOut(BaseModel):
    id: int
    username: str
    email: str = ""
    display_name: str = ""
    is_admin: bool = False
    role: Literal["user", "super_admin"] = "user"
    auth_provider: str = "password"
    email_verified: bool = False
    requires_password_reset: bool = False
    legacy_account: bool = False
    created_at: Optional[datetime] = None
    last_login_at: Optional[datetime] = None


class AdminUserCreate(UserSignup):
    """Fields an administrator may set when creating an account."""

    is_admin: bool = False


class AdminUserUpdate(BaseModel):
    """Partial account update used by the admin user-management screen."""

    username: Optional[str] = Field(default=None, min_length=3, max_length=64)
    email: Optional[str] = Field(default=None, max_length=320)
    display_name: Optional[str] = Field(default=None, max_length=120)
    password: Optional[str] = Field(default=None, min_length=8, max_length=128)
    is_admin: Optional[bool] = None

    @field_validator("username", "display_name", mode="before")
    @classmethod
    def _trim_admin_fields(cls, v):
        return _strip(v) if isinstance(v, str) else v

    @field_validator("email", mode="before")
    @classmethod
    def _admin_email(cls, v):
        return _normalize_email(v) if isinstance(v, str) else v


class AdminUserListOut(BaseModel):
    users: List[UserOut]
    total: int


class AdminUserDeleteOut(BaseModel):
    deleted: bool = True
    user_id: int


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in_seconds: int
    user: UserOut
