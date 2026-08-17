"""add popularity_weights table for the Phase B popularity score (ADR-002).

Revision ID: 0008_popularity_weights
Revises: 0007_evaluation_runs
Create Date: 2026-07-31

The current ``engagement_score`` in ``db_query.py`` is a hardcoded
``like + save + rating`` sum with no time window, no Bayesian smoothing,
and no admin-tunable weights. ADR-002 §4 replaces it with a weighted,
time-decayed, Bayesian-smoothed score whose coefficients live in this
table so an admin can retune without a code change or a deploy.

Why a table rather than another ``RECSYS_*`` env var
---------------------------------------------------
The project already has two runtime-tunability surfaces
(``RECSYS_*`` env vars + ``artifacts/best_model_config.json``), but the
popularity coefficients are *user-visible ranking input* rather than
infrastructure. They change for editorial reasons (a marketing push
wants to recency-weight more) and they need an audit trail. A
versioned table is the right shape; the previous two layers are not
versioned and do not carry an ``updated_by``.

Schema mirrors 0006/0007: BigAutoField PK, explicit
``<table>_id_seq`` sequence so the ORM can omit ``id`` on insert, no
``CREATE TABLE IF NOT EXISTS`` (ADR-001 §5 invariant).

Invariants enforced by the service layer
----------------------------------------
* At most one row has ``is_active=True`` at any time
  (``services.popularity.set_weights`` deactivates the previous
  active row in the same transaction).
* ``weights_json`` deserialises to a dict mapping factor name to a
  weight in ``[0, 1]`` whose values sum to 1.0 ± 1e-3. Validation
  lives in the service, not the DB, so a stale row that pre-dates
  the current schema doesn't fail to load.
* The first row is seeded here (Phase B weights from ADR-002 §4.4
  — Saved 0.30, Rating 0.35, Like 0.25, Recency 0.10) so the system
  works immediately after migration without a second seed script.
"""
from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision = "0008_popularity_weights"
down_revision = "0007_evaluation_runs"
branch_labels = None
depends_on = None


_TABLE = "popularity_weights"

# Phase B weights per ADR-002 §4.4 (View / CTR not yet — the column
# ships without them because their data only appears 30 days after
# Phase A is live). Sum is exactly 1.0 so ``compute_popularity_scores``
# doesn't have to renormalise at first deploy.
_PHASE_B_WEIGHTS = {
    "saved": 0.30,
    "rating": 0.35,
    "like": 0.25,
    "recency": 0.10,
}


def _max_id(bind) -> int:
    result = bind.execute(sa.text(f'SELECT COALESCE(MAX(id), 0) FROM "{_TABLE}"'))
    return int(result.scalar_one())


def _attach_sequence(bind) -> None:
    """Mirror 0006 / 0007 — sequence + setval(max) + DEFAULT nextval + OWNED BY."""
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
        sa.Column(
            "weights_json",
            sa.Text(),
            nullable=False,
            server_default="{}",
            comment="JSON: {factor: weight in [0,1]}. Validated at write time, not at read.",
        ),
        sa.Column(
            "half_life_days",
            sa.Integer(),
            nullable=False,
            server_default="14",
            comment="Days after which a contributing event's weight is halved. 0 = no decay.",
        ),
        sa.Column(
            "bayes_m",
            sa.Integer(),
            nullable=False,
            server_default="3",
            comment=(
                "Bayesian prior strength for rating smoothing. 0 = no smoothing "
                "(revert to raw mean). Per ADR-002 §4.2 default is 3, not 10, "
                "because today's near-zero telemetry would flatten every "
                "ranking under m=10."
            ),
        ),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
            comment="At most one row may be active; the service enforces this.",
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column(
            "updated_by",
            sa.String(length=150),
            nullable=False,
            server_default="",
            comment="Username or anon id of the operator who wrote the row.",
        ),
    )
    op.create_index("ix_popularity_weights_is_active", _TABLE, ["is_active"])

    # Seed the first active row so the system has weights on day one.
    # No ``on_conflict`` guard — fresh table, single row, idempotent.
    bind.execute(
        sa.text(
            "INSERT INTO popularity_weights "
            "(weights_json, half_life_days, bayes_m, is_active, updated_by) "
            "VALUES (:w, :h, :m, true, 'migration:0008')"
        ),
        {
            "w": json.dumps(_PHASE_B_WEIGHTS, ensure_ascii=False),
            "h": 14,
            "m": 3,
        },
    )

    _attach_sequence(bind)


def downgrade() -> None:
    op.drop_index("ix_popularity_weights_is_active", table_name=_TABLE)
    op.drop_table(_TABLE)
