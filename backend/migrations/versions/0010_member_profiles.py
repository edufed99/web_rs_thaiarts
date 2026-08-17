"""member self-service profile fields and two-role constraints.

Revision ID: 0010_member_profiles
Revises: 0009_reseed_imported_sequences
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0010_member_profiles"
down_revision = "0009_reseed_imported_sequences"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("accounts_userprofile") as batch:
        batch.add_column(sa.Column("avatar_url", sa.Text(), nullable=False, server_default=""))
        batch.add_column(sa.Column("bio", sa.Text(), nullable=False, server_default=""))

    # ``users.is_admin`` is the canonical authorization source. Normalize the
    # imported mirrors before applying the two-value constraints.
    op.execute(
        sa.text(
            """
            UPDATE accounts_userprofile
            SET role = CASE
                    WHEN EXISTS (
                        SELECT 1 FROM users
                        WHERE users.id = accounts_userprofile.user_id
                          AND users.is_admin = true
                    ) THEN 'super_admin' ELSE 'user' END,
                user_group = CASE
                    WHEN EXISTS (
                        SELECT 1 FROM users
                        WHERE users.id = accounts_userprofile.user_id
                          AND users.is_admin = true
                    ) THEN 'super_admin' ELSE 'user' END
            """
        )
    )

    with op.batch_alter_table("accounts_userprofile") as batch:
        batch.create_check_constraint(
            "ck_accounts_userprofile_role",
            "role IN ('user', 'super_admin')",
        )
        batch.create_check_constraint(
            "ck_accounts_userprofile_user_group",
            "user_group IN ('user', 'super_admin')",
        )


def downgrade() -> None:
    with op.batch_alter_table("accounts_userprofile") as batch:
        batch.drop_constraint("ck_accounts_userprofile_user_group", type_="check")
        batch.drop_constraint("ck_accounts_userprofile_role", type_="check")
        batch.drop_column("bio")
        batch.drop_column("avatar_url")
