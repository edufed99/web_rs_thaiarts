"""Google identity columns for member sign-in.

Revision ID: 0012_google_member_login
Revises: 0011_email_password_reset
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0012_google_member_login"
down_revision = "0011_email_password_reset"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("google_subject_id", sa.String(255), nullable=True))
        batch.add_column(
            sa.Column(
                "auth_provider", sa.String(32), nullable=False, server_default="password"
            )
        )
        batch.add_column(
            sa.Column(
                "email_verified", sa.Boolean(), nullable=False, server_default=sa.false()
            )
        )
        batch.create_index(
            "ix_users_google_subject_id", ["google_subject_id"], unique=True
        )


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_index("ix_users_google_subject_id")
        batch.drop_column("email_verified")
        batch.drop_column("auth_provider")
        batch.drop_column("google_subject_id")
