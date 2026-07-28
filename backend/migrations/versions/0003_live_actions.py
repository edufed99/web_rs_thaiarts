"""add live user-action tables: likes, saved_items, ratings, interaction_logs.

Revision ID: 0003_live_actions
Revises: 0002_artifact_item_id
Create Date: 2026-07-28

Brings the live user-action layer online. After this revision the backend
can persist user actions (like / save / rate) via the new
``/actions/*`` endpoints, merge live positive history into the CF index,
and apply the negative-rating penalty from ``services.hybrid_service``.

* ``likes``         — one row per (user_key, item) positive
* ``saved_items``   — one row per (user_key, item) saved
* ``ratings``       — one row per (user_key, item) with 1..5 rating
* ``interaction_logs`` — append-only audit trail for every action

All tables use SQL-portable column types (no JSONB, no ARRAY) so the
SQLite in-memory engine used in ``tests/test_db.py`` can mirror this
schema verbatim.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0003_live_actions"
down_revision = "0002_artifact_item_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "likes",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("user_key", sa.String(length=150), nullable=False),
        sa.Column("item_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["item_id"], ["items.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("user_key", "item_id", name="uq_likes_user_item"),
    )
    op.create_index("ix_likes_user_key", "likes", ["user_key"])

    op.create_table(
        "saved_items",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("user_key", sa.String(length=150), nullable=False),
        sa.Column("item_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["item_id"], ["items.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("user_key", "item_id", name="uq_saved_items_user_item"),
    )
    op.create_index("ix_saved_items_user_key", "saved_items", ["user_key"])

    op.create_table(
        "ratings",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("user_key", sa.String(length=150), nullable=False),
        sa.Column("item_id", sa.BigInteger(), nullable=False),
        sa.Column("rating", sa.SmallInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["item_id"], ["items.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("user_key", "item_id", name="uq_ratings_user_item"),
        # CHECK on Postgres rejects out-of-range writes; SQLite ignores it.
        sa.CheckConstraint("rating BETWEEN 1 AND 5", name="ck_ratings_range_1_5"),
    )
    op.create_index("ix_ratings_user_key", "ratings", ["user_key"])

    op.create_table(
        "interaction_logs",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("user_key", sa.String(length=150), nullable=False),
        sa.Column("item_id", sa.BigInteger(), nullable=True),
        sa.Column("action_type", sa.String(length=40), nullable=False),
        sa.Column("metadata_json", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["item_id"], ["items.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_interaction_logs_user_key", "interaction_logs", ["user_key"])
    op.create_index("ix_interaction_logs_action_type", "interaction_logs", ["action_type"])
    op.create_index("ix_interaction_logs_created_at", "interaction_logs", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_interaction_logs_created_at", table_name="interaction_logs")
    op.drop_index("ix_interaction_logs_action_type", table_name="interaction_logs")
    op.drop_index("ix_interaction_logs_user_key", table_name="interaction_logs")
    op.drop_table("interaction_logs")

    op.drop_index("ix_ratings_user_key", table_name="ratings")
    op.drop_table("ratings")

    op.drop_index("ix_saved_items_user_key", table_name="saved_items")
    op.drop_table("saved_items")

    op.drop_index("ix_likes_user_key", table_name="likes")
    op.drop_table("likes")
