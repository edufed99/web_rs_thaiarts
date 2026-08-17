"""add evaluation_runs table for Phase 3 dashboard model-quality tiles.

Revision ID: 0007_evaluation_runs
Revises: 0006_recommender_history
Create Date: 2026-07-30

The dashboard mockup at ``imageRS/dashboard.png`` includes five
model-quality tiles (nDCG@10 / HR@10 / MRR@10 / Coverage / Violation) and
a 30-day quality trend line. The numbers are sourced from a new
``evaluation_runs`` table so they reflect real algorithm output rather
than a hardcoded placeholder.

Two writers populate the table:

* **Offline** — ``pipelines/run_offline_evaluation.py`` runs an 80/20
  holdout over ``legacy_interactions`` and predicts top-10 for every
  test user with the live recommender. The result is a single row
  with ``source='offline'`` capturing the production-config snapshot.
* **Online** — every ``POST /recommendations`` triggers a recompute
  from the last 30 days of ``recommendation_results`` joined with
  ``interaction_logs`` (positive = user opened the item detail within
  24h). The result is a row with ``source='online'``.

The dashboard prefers ``online`` when at least one online row exists,
otherwise falls back to ``offline`` (or ``unavailable`` if the table is
empty, in which case the tiles render as "รอการประเมิน").

Schema mirrors the 0006 pattern: BigAutoField PK, explicit
``<table>_id_seq`` sequence so the ORM can omit ``id`` on insert
(matches the legacy import path).
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0007_evaluation_runs"
down_revision = "0006_recommender_history"
branch_labels = None
depends_on = None


_TABLE = "evaluation_runs"


def _max_id(bind) -> int:
    result = bind.execute(sa.text(f'SELECT COALESCE(MAX(id), 0) FROM "{_TABLE}"'))
    return int(result.scalar_one())


def _attach_sequence(bind) -> None:
    """Mirror 0006 — CREATE SEQUENCE + setval(max) + DEFAULT nextval + OWNED BY."""
    seq = f"{_TABLE}_id_seq"
    op.execute(f"CREATE SEQUENCE IF NOT EXISTS {seq} AS bigint")
    max_id = _max_id(bind)
    if max_id < 1:
        op.execute(f"SELECT setval('{seq}', 1, false)")
    else:
        op.execute(f"SELECT setval('{seq}', {max_id}, true)")
        op.execute(f'ALTER TABLE "{_TABLE}" ALTER COLUMN id SET DEFAULT nextval(\'{seq}\')')
        op.execute(f"ALTER SEQUENCE {seq} OWNED BY \"{_TABLE}\".id")


def upgrade() -> None:
    bind = op.get_bind()

    op.create_table(
        _TABLE,
        sa.Column("id", sa.BigInteger(), primary_key=True),
        # 'offline' = holdout run from legacy_interactions
        # 'online'  = recomputed from recommendation_results + interaction_logs
        sa.Column("source", sa.String(length=20), nullable=False),
        sa.Column("ran_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("test_user_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("test_interaction_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ndcg10", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("hr10", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("mrr10", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("coverage", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("violation_rate", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("metadata_json", sa.Text(), nullable=False, server_default=""),
    )
    op.create_index("ix_evaluation_runs_source", _TABLE, ["source"])
    op.create_index("ix_evaluation_runs_ran_at", _TABLE, ["ran_at"])

    _attach_sequence(bind)


def downgrade() -> None:
    op.drop_index("ix_evaluation_runs_ran_at", table_name=_TABLE)
    op.drop_index("ix_evaluation_runs_source", table_name=_TABLE)
    op.drop_table(_TABLE)
