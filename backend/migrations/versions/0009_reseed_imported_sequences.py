"""reseed PostgreSQL sequences after explicit-id legacy imports.

Revision ID: 0009_reseed_imported_sequences
Revises: 0008_popularity_weights
Create Date: 2026-08-10

The legacy import runs after the table-creation migrations and preserves
explicit primary-key values. PostgreSQL sequences are not advanced by those
INSERTs, so later ORM writes can reuse an existing id. The most visible
failure was ``interaction_logs_id_seq`` returning 49 while the table already
contained ids through 2607; every like/save/rating then failed at commit.

This data-repair migration moves each owned sequence to the current MAX(id).
It never changes table rows. Re-running it is safe and is useful after a
reproducible re-import of the research dataset.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0009_reseed_imported_sequences"
down_revision = "0008_popularity_weights"
branch_labels = None
depends_on = None


# Explicit for reviewability. Every table here owns a bigint ``id`` sequence
# and may receive explicit ids from the legacy/research import.
_TABLES = (
    "accounts_userprofile",
    "contexts",
    "evaluation_runs",
    "interaction_logs",
    "item_contexts",
    "item_keywords",
    "items",
    "keywords",
    "legacy_interactions",
    "likes",
    "popularity_weights",
    "ratings",
    "recommendation_request_selected_keywords",
    "recommendation_requests",
    "recommendation_results",
    "saved_items",
    "taxonomy_nodes",
    "users",
)


def _reseed(table: str, bind) -> None:
    sequence = bind.execute(
        sa.text("SELECT pg_get_serial_sequence(:table_name, 'id')"),
        {"table_name": table},
    ).scalar_one_or_none()
    if not sequence:
        return
    maximum = int(
        bind.execute(sa.text(f'SELECT COALESCE(MAX(id), 0) FROM "{table}"')).scalar_one()
    )
    if maximum < 1:
        bind.execute(
            sa.text("SELECT setval(CAST(:sequence AS regclass), 1, false)"),
            {"sequence": sequence},
        )
    else:
        bind.execute(
            sa.text("SELECT setval(CAST(:sequence AS regclass), :maximum, true)"),
            {"sequence": sequence, "maximum": maximum},
        )


def upgrade() -> None:
    bind = op.get_bind()
    for table in _TABLES:
        _reseed(table, bind)


def downgrade() -> None:
    # Advancing sequences is a data repair and is safe to retain. Moving them
    # backwards on downgrade could immediately recreate duplicate-key errors.
    pass
