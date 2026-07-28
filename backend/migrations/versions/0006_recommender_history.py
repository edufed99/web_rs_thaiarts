"""add recommender history tables + accounts_userprofile + interaction_logs.request_id.

Revision ID: 0006_recommender_history
Revises: 0005_legacy_autoincrement
Create Date: 2026-07-28

The legacy CSV export at ``db_csv_export_20260728/`` carries four tables
that are not yet represented in ``web_rs_thaiarts``:

* ``accounts_userprofile`` — 157 rows (role, user_group, experience_level,
  consent metadata) keyed 1:1 onto ``users``. dbold.md §81 documents the
  shape; the role column replaces the boolean ``users.is_admin`` we used
  in 0004 — ``role='super_admin'`` flips the flag on import.
* ``recommender_recommendationrequest`` — 2 rows (Hybrid-WeightedSum
  requests with ``selected_context_id``, ``candidate_count``, ``top_k``,
  ``method``, ``metadata`` JSON).
* ``recommender_recommendationrequest_selected_keywords`` — 6 rows
  (M2M between requests and keywords).
* ``recommender_recommendationresult`` — 20 rows (ranked results
  carrying CBF / CF / hybrid scores + explanation).

The export also includes a ``recommendation_request_id`` column on
``recommender_interactionlog`` that the live schema does not have. We add
it as a nullable FK so logs created before this revision still load.

Schema is faithful to dbold.md (BigAutoField PKs, JSONB for metadata,
JSONB arrays for ``matched_keywords``, indexed ``user_key`` columns).
Each new table gets an explicit ``<table>_id_seq`` so the ORM can omit
``id`` on insert just like the legacy slice (mirrors the 0005 pattern).

Downgrade drops the FK + tables; legacy data is untouched.

Notes
-----
* The ``users`` table is the FK target for all four new tables; the
  import script translates ``auth_user.id`` (CSV) → ``users.id`` (PG) by
  preserving the same numeric id where possible (the live ``users``
  table already has a row whose id was the first-user-admin signup, so
  the import script offsets new rows starting at ``max(id) + 1`` to
  avoid clashing).
* ``accounts_userprofile`` has a OneToOneField on ``users`` so we set
  ``UNIQUE (user_id)`` to enforce that in Postgres.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0006_recommender_history"
down_revision = "0005_legacy_autoincrement"
branch_labels = None
depends_on = None


# Tables that get a sequence + nextval default. Matches the 0005 list
# convention so a future script can introspect it the same way.
_HISTORY_TABLES = (
    "accounts_userprofile",
    "recommendation_requests",
    "recommendation_request_selected_keywords",
    "recommendation_results",
)


def _max_id(table: str, bind) -> int:
    """Return current MAX(id) for ``table`` (0 if empty)."""
    result = bind.execute(sa.text(f'SELECT COALESCE(MAX(id), 0) FROM "{table}"'))
    return int(result.scalar_one())


def _attach_sequence(table: str, bind) -> None:
    """Mirror 0005 — CREATE SEQUENCE + setval(max) + DEFAULT nextval + OWNED BY.

    ``setval(seq, n, true)`` requires ``n >= 1``. On a freshly created empty
    table ``max(id)`` returns 0, so we seed to 1 with ``is_called=false``
    (``nextval`` will then return 1 on the first INSERT). We also bump the
    column default to ``nextval`` only if the table is non-empty; otherwise
    the default is set in step 1's ``create_table`` via ``BigInteger`` PK.
    """
    seq = f"{table}_id_seq"
    op.execute(f"CREATE SEQUENCE IF NOT EXISTS {seq} AS bigint")
    max_id = _max_id(table, bind)
    if max_id < 1:
        # Empty table — seed sequence so nextval() returns 1 on first INSERT.
        op.execute(f"SELECT setval('{seq}', 1, false)")
    else:
        op.execute(f"SELECT setval('{seq}', {max_id}, true)")
        op.execute(f'ALTER TABLE "{table}" ALTER COLUMN id SET DEFAULT nextval(\'{seq}\')')
        op.execute(f"ALTER SEQUENCE {seq} OWNED BY \"{table}\".id")


def upgrade() -> None:
    bind = op.get_bind()

    # 1. accounts_userprofile (1:1 with users).
    op.create_table(
        "accounts_userprofile",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("display_name", sa.String(length=150), nullable=False, server_default=""),
        sa.Column("role", sa.String(length=20), nullable=False, server_default="user"),
        sa.Column("user_group", sa.String(length=100), nullable=False, server_default=""),
        sa.Column("experience_level", sa.String(length=20), nullable=False, server_default="none"),
        sa.Column("consent_accepted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("consent_version", sa.String(length=40), nullable=False, server_default=""),
        sa.Column("consent_accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("consent_withdrawn_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="accounts_userprofile_user_id_fkey", ondelete="CASCADE"),
        sa.UniqueConstraint("user_id", name="uq_accounts_userprofile_user_id"),
    )
    op.create_index("ix_accounts_userprofile_user_id", "accounts_userprofile", ["user_id"], unique=True)
    op.create_index("ix_accounts_userprofile_role", "accounts_userprofile", ["role"])

    # 2. recommendation_requests.
    op.create_table(
        "recommendation_requests",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("user_id", sa.BigInteger(), nullable=True),
        sa.Column("selected_context_id", sa.BigInteger(), nullable=False),
        sa.Column("candidate_count", sa.Integer(), nullable=False),
        sa.Column("top_k", sa.Integer(), nullable=False),
        sa.Column("method", sa.String(length=80), nullable=False),
        sa.Column("metadata_json", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="recommendation_requests_user_id_fkey", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["selected_context_id"], ["contexts.id"], name="recommendation_requests_ctx_fkey", ondelete="RESTRICT"),
    )
    op.create_index("ix_recommendation_requests_user_id", "recommendation_requests", ["user_id"])
    op.create_index("ix_recommendation_requests_created_at", "recommendation_requests", ["created_at"])

    # 3. recommendation_request_selected_keywords (M2M).
    op.create_table(
        "recommendation_request_selected_keywords",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("request_id", sa.BigInteger(), nullable=False),
        sa.Column("keyword_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["request_id"], ["recommendation_requests.id"], name="rsk_request_fkey", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["keyword_id"], ["keywords.id"], name="rsk_keyword_fkey", ondelete="CASCADE"),
        sa.UniqueConstraint("request_id", "keyword_id", name="uq_rsk_request_keyword"),
    )
    op.create_index("ix_rsk_request_id", "recommendation_request_selected_keywords", ["request_id"])
    op.create_index("ix_rsk_keyword_id", "recommendation_request_selected_keywords", ["keyword_id"])

    # 4. recommendation_results.
    op.create_table(
        "recommendation_results",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("request_id", sa.BigInteger(), nullable=False),
        sa.Column("item_id", sa.BigInteger(), nullable=False),
        sa.Column("rank", sa.Integer(), nullable=False),
        sa.Column("cbf_score", sa.Float(), nullable=False),
        sa.Column("cf_score", sa.Float(), nullable=False),
        sa.Column("hybrid_score", sa.Float(), nullable=False),
        sa.Column("is_context_valid", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("matched_keywords_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("explanation", sa.Text(), nullable=False, server_default=""),
        sa.ForeignKeyConstraint(["request_id"], ["recommendation_requests.id"], name="rr_request_fkey", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["item_id"], ["items.id"], name="rr_item_fkey", ondelete="CASCADE"),
        sa.UniqueConstraint("request_id", "item_id", name="uq_rr_request_item"),
        sa.UniqueConstraint("request_id", "rank", name="uq_rr_request_rank"),
    )
    op.create_index("ix_rr_request_id", "recommendation_results", ["request_id"])
    op.create_index("ix_rr_item_id", "recommendation_results", ["item_id"])

    # 5. Attach sequences so the ORM can omit id (mirrors 0005).
    for table in _HISTORY_TABLES:
        _attach_sequence(table, bind)

    # 6. interaction_logs.recommendation_request_id (FK → recommendation_requests).
    op.add_column(
        "interaction_logs",
        sa.Column("recommendation_request_id", sa.BigInteger(), nullable=True),
    )
    op.create_foreign_key(
        "interaction_logs_request_id_fkey",
        "interaction_logs",
        "recommendation_requests",
        ["recommendation_request_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_interaction_logs_request_id",
        "interaction_logs",
        ["recommendation_request_id"],
    )


def downgrade() -> None:
    # Reverse order: drop FK first, then tables.
    op.drop_index("ix_interaction_logs_request_id", table_name="interaction_logs")
    op.drop_constraint("interaction_logs_request_id_fkey", "interaction_logs", type_="foreignkey")
    op.drop_column("interaction_logs", "recommendation_request_id")

    op.drop_index("ix_rr_item_id", table_name="recommendation_results")
    op.drop_index("ix_rr_request_id", table_name="recommendation_results")
    op.drop_table("recommendation_results")

    op.drop_index("ix_rsk_keyword_id", table_name="recommendation_request_selected_keywords")
    op.drop_index("ix_rsk_request_id", table_name="recommendation_request_selected_keywords")
    op.drop_table("recommendation_request_selected_keywords")

    op.drop_index("ix_recommendation_requests_created_at", table_name="recommendation_requests")
    op.drop_index("ix_recommendation_requests_user_id", table_name="recommendation_requests")
    op.drop_table("recommendation_requests")

    op.drop_index("ix_accounts_userprofile_role", table_name="accounts_userprofile")
    op.drop_index("ix_accounts_userprofile_user_id", table_name="accounts_userprofile")
    op.drop_table("accounts_userprofile")