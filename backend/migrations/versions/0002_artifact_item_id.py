"""add items.artifact_item_id bridge column.

Revision ID: 0002_artifact_item_id
Revises: 0001_baseline
Create Date: 2026-07-28

The static artifacts produced by ``pipelines/train_or_generate_artifacts.py``
use ``stable_id("item", name)`` (first 7 hex chars of sha256) as the item id,
while the Postgres ``items`` table imported from the legacy Django SQLite
uses the original Django id (1..114). The two id spaces never overlap, so
the live CF merge in ``services.cf_service`` was silently dropping every row.

This migration adds an ``artifact_item_id`` column on ``items``, backfills it
from each row's ``name`` using the same hash used by the pipeline, and
uniques the column so ``likes`` / ``ratings`` / ``saved_items`` can FK into
artifact-id space.

After this revision every item in Postgres has a non-null artifact id, and
the backend can translate Django id <-> artifact id via
``app.services.db_query``.
"""
from __future__ import annotations

import hashlib
import sys

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0002_artifact_item_id"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def _stable_id(name: str) -> int:
    """Mirror of app.services._ids.stable_id and pipeline stable_id.

    Computed inline so this migration has no app import (Alembic's env.py
    already wires app.models_db but keeping this standalone makes the
    migration reproducible without a working app module)."""
    h = hashlib.sha256(f"item::{name}".encode("utf-8")).hexdigest()
    return int(h[:7], 16)


def upgrade() -> None:
    # 1. Add the column (nullable for the backfill step).
    op.add_column(
        "items",
        sa.Column("artifact_item_id", sa.BigInteger(), nullable=True),
    )

    # 2. Backfill from items.name using stable_id("item", name).
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, name FROM items")).fetchall()
    for django_id, name in rows:
        if not name:
            continue
        aid = _stable_id(str(name))
        bind.execute(
            sa.text("UPDATE items SET artifact_item_id = :a WHERE id = :i"),
            {"a": aid, "i": int(django_id)},
        )

    # 3. Enforce NOT NULL + UNIQUE so FKs from likes/ratings/saved_items can
    #    land on this column.
    op.alter_column("items", "artifact_item_id", nullable=False)
    op.create_unique_constraint(
        "uq_items_artifact_item_id", "items", ["artifact_item_id"]
    )
    op.create_index(
        "ix_items_artifact_item_id", "items", ["artifact_item_id"], unique=True
    )


def downgrade() -> None:
    op.drop_index("ix_items_artifact_item_id", table_name="items")
    op.drop_constraint("uq_items_artifact_item_id", "items", type_="unique")
    op.drop_column("items", "artifact_item_id")
