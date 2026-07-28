"""baseline — initial schema as imported by the legacy migration script.

Revision ID: 0001_baseline
Revises:
Create Date: 2026-07-28

The seven tables (contexts, taxonomy_nodes, keywords, items, item_contexts,
item_keywords, legacy_interactions) were created out-of-band by
``pipelines/migrate_sqlite_to_postgres.py::ensure_schema`` and seeded with
2534 legacy interactions, 114 items, etc. before Alembic was introduced.

This baseline revision is **stamp-only** — it performs no DDL. On an
existing database, mark it as applied with::

    cd backend
    alembic stamp 0001_baseline

Future revisions (0002, 0003, …) are real DDL and apply normally.
"""
from __future__ import annotations

# revision identifiers, used by Alembic.
revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: tables already exist (created by the legacy migration script)."""
    pass


def downgrade() -> None:
    """No-op: removing the baseline marker does not drop the legacy tables."""
    pass
