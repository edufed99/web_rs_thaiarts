"""add users table for admin slice + auth.

Revision ID: 0004_admin_users
Revises: 0003_live_actions
Create Date: 2026-07-28

Brings the auth slice online (see ADR §11.1 — auth is now in scope).
The ``users`` table backs ``POST /auth/signup``, ``POST /auth/login``,
``GET /auth/me``, and the ``Depends(get_current_user)`` /
``Depends(get_current_admin)`` dependencies that gate the
``/admin/items/*`` and (in Phase G) ``/actions/*`` write endpoints.

Columns mirror ``backend/app/models_db.py:User``:

* ``id``            — BigAutoPK
* ``username``      — unique, 120 chars
* ``password_hash`` — bcrypt hash ($2b$…), 255 chars
* ``display_name``  — optional, 120 chars
* ``is_admin``      — Boolean, gates /admin/* endpoints
* ``created_at``    — server-side now()
* ``last_login_at`` — nullable, set by /auth/login

All column types are SQL-portable so the SQLite in-memory engine used in
``tests/test_db.py`` can mirror this schema verbatim.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0004_admin_users"
down_revision = "0003_live_actions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), primary_key=True),
        sa.Column("username", sa.String(length=120), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_users_username", "users", ["username"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_users_username", table_name="users")
    op.drop_table("users")