"""add Postgres sequences + DEFAULT = nextval(...) for legacy tables.

Revision ID: 0005_legacy_autoincrement
Revises: 0004_admin_users
Create Date: 2026-07-28

Seven tables (``contexts``, ``taxonomy_nodes``, ``keywords``, ``items``,
``item_contexts``, ``item_keywords``, ``legacy_interactions``) were
created out-of-band by ``pipelines/migrate_sqlite_to_postgres.py`` from
the legacy SQLite dump. The legacy schema defined ``id`` as ``INTEGER``
without autoincrement, so the migration script could only INSERT
rows when it supplied an explicit id (1..N). The Postgres tables
inherited this — ``id`` is ``bigint NOT NULL`` with no default.

The admin ingest slice (``POST /admin/items/draft`` in
``app/routers/admin.py:131``) creates a new ``Context`` row when an
admin enters a never-seen context name, and the ORM does not supply an
id. Postgres then rejects the INSERT with
``null value in column 'id' violates not-null constraint`` (500 ISE).

The same defect lurks in the keyword / item insert paths
(``ingestion.py``) — they read from existing rows because the unit
tests run against in-memory SQLite (where ``Integer`` is autoincrement),
so the bug was latent until exercised against real Postgres.

This migration fixes the root cause: each legacy table gets a
``<table>_id_seq`` sequence owned by its ``id`` column, with
``DEFAULT = nextval('<table>_id_seq')``. Future inserts from the ORM
can omit ``id`` and Postgres will issue one. The sequence is
``setval`` to ``max(id)`` of the existing data so new rows never
collide with the 1..N legacy rows.

Downgrade removes the default + drops the sequence. The legacy rows
themselves are untouched (this migration is online-safe).

Notes
-----
* Idempotent: ``CREATE SEQUENCE IF NOT EXISTS`` and ``DROP SEQUENCE
  IF EXISTS`` make upgrade/downgrade re-runnable.
* All seven tables are touched; the migration is one transaction so
  partial failure leaves the DB unchanged.
* The down_revision is ``0004_admin_users`` so this is the next
  revision on the linear branch.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0005_legacy_autoincrement"
down_revision = "0004_admin_users"
branch_labels = None
depends_on = None


# Seven legacy tables that need an IDENTITY column. The list is
# intentionally explicit (not driven by inspection) so the migration is
# reviewable and the sequence naming is predictable.
_LEGACY_TABLES = (
    "contexts",
    "taxonomy_nodes",
    "keywords",
    "items",
    "item_contexts",
    "item_keywords",
    "legacy_interactions",
)


def _max_id(table: str, bind) -> int:
    """Return the current maximum id in the given table, or 0 if empty.

    Used to seed the sequence so future inserts never collide with the
    1..N legacy rows. Runs against the bind in the same transaction as
    the migration.
    """
    result = bind.execute(sa.text(f'SELECT COALESCE(MAX(id), 0) FROM "{table}"'))
    return int(result.scalar_one())


def upgrade() -> None:
    bind = op.get_bind()
    for table in _LEGACY_TABLES:
        seq_name = f"{table}_id_seq"
        # 1. Create the sequence (does not conflict with existing rows).
        op.execute(f"CREATE SEQUENCE IF NOT EXISTS {seq_name} AS bigint")
        # 2. Seed it past current max so nextval() never collides.
        max_id = _max_id(table, bind)
        op.execute(f"SELECT setval('{seq_name}', {max_id}, true)")
        # 3. Make the column default to nextval() so the ORM can omit id.
        op.execute(f'ALTER TABLE "{table}" ALTER COLUMN id SET DEFAULT nextval(\'{seq_name}\')')
        # 4. Sequence is owned by the column — drops with the table.
        op.execute(f"ALTER SEQUENCE {seq_name} OWNED BY \"{table}\".id")


def downgrade() -> None:
    for table in _LEGACY_TABLES:
        seq_name = f"{table}_id_seq"
        # Drop the default first so the column is back to NOT NULL no-default.
        op.execute(f'ALTER TABLE "{table}" ALTER COLUMN id DROP DEFAULT')
        # Drop the sequence (OWNED BY was set, so it survives only with the table).
        op.execute(f"DROP SEQUENCE IF EXISTS {seq_name}")
