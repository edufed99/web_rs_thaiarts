"""email identities and one-time password reset tokens.

Revision ID: 0011_email_password_reset
Revises: 0010_member_profiles
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0011_email_password_reset"
down_revision = "0010_member_profiles"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(
            sa.Column("email", sa.String(length=320), nullable=False, server_default="")
        )
        # Deliberately non-unique: the local research fixture uses one shared
        # mailbox for many accounts. Reset still requires username + email.
        batch.create_index("ix_users_email", ["email"], unique=False)

    op.execute(
        sa.text(
            """
            UPDATE users
            SET email = CASE
                WHEN is_admin = true THEN 'adminrstpa@gmail.com'
                ELSE 'pichaya.chuy@gmail.com'
            END
            """
        )
    )

    op.create_table(
        "password_reset_tokens",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_password_reset_tokens_user_id", "password_reset_tokens", ["user_id"]
    )
    op.create_index(
        "ix_password_reset_tokens_token_hash",
        "password_reset_tokens",
        ["token_hash"],
        unique=True,
    )
    op.create_index(
        "ix_password_reset_tokens_expires_at",
        "password_reset_tokens",
        ["expires_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_password_reset_tokens_expires_at", table_name="password_reset_tokens")
    op.drop_index("ix_password_reset_tokens_token_hash", table_name="password_reset_tokens")
    op.drop_index("ix_password_reset_tokens_user_id", table_name="password_reset_tokens")
    op.drop_table("password_reset_tokens")
    with op.batch_alter_table("users") as batch:
        batch.drop_index("ix_users_email")
        batch.drop_column("email")
