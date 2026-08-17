"""
models_db.py — SQLAlchemy ORM models for the catalog + legacy interactions +
live user actions.

These mirror the schema managed by Alembic (see backend/migrations/).
The backend uses them to query legacy user logs and live user actions
(likes / ratings / saved items) at serving time so the CF service can
merge live positive evidence with the precomputed CF index, and so the
actions router can persist user clicks.

Notes
-----
* ``Item.artifact_item_id`` bridges the artifact id space
  (``stable_id("item", name)`` from the pipeline) and the DB id space
  (``items.id``, referenced by every relational table). The two never
  overlap; live actions and CF live merge both translate through this
  column.
* All column types are SQL-portable (no JSONB / ARRAY / Postgres-only
  types) so the SQLite in-memory engine used in ``tests/test_db.py`` can
  create the same schema.
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


# Cross-dialect big-autoincrement primary key: Postgres keeps BIGINT,
# SQLite renders INTEGER PRIMARY KEY so the column autoincrements via
# rowid without an explicit server-side sequence.
BigAutoPK = BigInteger().with_variant(Integer(), "sqlite")


class Base(DeclarativeBase):
    pass


class Context(Base):
    __tablename__ = "contexts"

    id: Mapped[int] = mapped_column(BigAutoPK, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    group_name: Mapped[str] = mapped_column(String(255), default="")
    description: Mapped[str] = mapped_column(Text, default="")


class TaxonomyNode(Base):
    __tablename__ = "taxonomy_nodes"

    id: Mapped[int] = mapped_column(BigAutoPK, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    level: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    parent_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("taxonomy_nodes.id", ondelete="SET NULL"), nullable=True
    )


class Keyword(Base):
    __tablename__ = "keywords"

    id: Mapped[int] = mapped_column(BigAutoPK, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    taxonomy_node_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("taxonomy_nodes.id", ondelete="SET NULL"), nullable=True
    )


class Item(Base):
    __tablename__ = "items"
    __table_args__ = (
        UniqueConstraint("artifact_item_id", name="uq_items_artifact_item_id"),
        Index("ix_items_artifact_item_id", "artifact_item_id", unique=True),
    )

    id: Mapped[int] = mapped_column(BigAutoPK, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    category_group: Mapped[str] = mapped_column(String(255), default="")
    performance_type: Mapped[str] = mapped_column(String(255), default="")
    performers_count: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    duration_minutes: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    price_text: Mapped[str] = mapped_column(String(255), default="")
    image_url: Mapped[str] = mapped_column(String(500), default="")
    video_url: Mapped[str] = mapped_column(String(500), default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Bridge to the artifact id space used by CF indices, API responses, and
    # the live-action tables below. Backfilled by migration 0002.
    artifact_item_id: Mapped[int] = mapped_column(BigInteger, nullable=False)


class ItemContext(Base):
    __tablename__ = "item_contexts"

    id: Mapped[int] = mapped_column(BigAutoPK, primary_key=True)
    item_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("items.id", ondelete="CASCADE"))
    context_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("contexts.id", ondelete="CASCADE"))
    validity_status: Mapped[str] = mapped_column(String(30), default="valid")


class ItemKeyword(Base):
    __tablename__ = "item_keywords"

    id: Mapped[int] = mapped_column(BigAutoPK, primary_key=True)
    item_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("items.id", ondelete="CASCADE"))
    keyword_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("keywords.id", ondelete="CASCADE"))
    source: Mapped[str] = mapped_column(String(100), default="")


class LegacyInteraction(Base):
    __tablename__ = "legacy_interactions"

    id: Mapped[int] = mapped_column(BigAutoPK, primary_key=True)
    legacy_user_id: Mapped[str] = mapped_column(String(150), nullable=False)
    item_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("items.id", ondelete="CASCADE"))
    context_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("contexts.id", ondelete="CASCADE"), nullable=True
    )
    rating: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    # SQL-portable JSON. SQLAlchemy's ``JSON`` type renders as native
    # JSON / JSONB on Postgres (with ``astext_type`` available for
    # jsonb_path_ops queries) and as TEXT on SQLite so the test suite
    # can keep using in-memory SQLite without a Postgres dependency.
    keywords: Mapped[list] = mapped_column(JSON, default=list)
    raw_item_name: Mapped[str] = mapped_column(String(255), default="")
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


# ---------------------------------------------------------------------------
# Live user actions
# ---------------------------------------------------------------------------

class Like(Base):
    __tablename__ = "likes"
    __table_args__ = (
        UniqueConstraint("user_key", "item_id", name="uq_likes_user_item"),
        Index("ix_likes_user_key", "user_key"),
    )

    id: Mapped[int] = mapped_column(BigAutoPK, primary_key=True)
    user_key: Mapped[str] = mapped_column(String(150), nullable=False)
    # FK to the catalog row (DB id) — the artifact id is recovered via
    # Item.artifact_item_id at query time.
    item_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("items.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class SavedItem(Base):
    __tablename__ = "saved_items"
    __table_args__ = (
        UniqueConstraint("user_key", "item_id", name="uq_saved_items_user_item"),
        Index("ix_saved_items_user_key", "user_key"),
    )

    id: Mapped[int] = mapped_column(BigAutoPK, primary_key=True)
    user_key: Mapped[str] = mapped_column(String(150), nullable=False)
    item_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("items.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Rating(Base):
    __tablename__ = "ratings"
    __table_args__ = (
        UniqueConstraint("user_key", "item_id", name="uq_ratings_user_item"),
        Index("ix_ratings_user_key", "user_key"),
    )

    id: Mapped[int] = mapped_column(BigAutoPK, primary_key=True)
    user_key: Mapped[str] = mapped_column(String(150), nullable=False)
    item_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("items.id", ondelete="CASCADE"), nullable=False
    )
    # 1..5. CHECK constraint is added by migration 0003 so SQLite (no CHECK
    # enforcement) still allows tests to insert any value while production
    # Postgres rejects out-of-range writes.
    rating: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class InteractionLog(Base):
    """Append-only audit trail for every user action.

    Mirrors ``recommender.InteractionLog`` from the legacy Django prototype
    at ``../web_appRS/thai_arts_webapp/`` (read-only reference; this project
    does not run Django). Used by the dashboard / future analytics — not
    read by the recommendation hot path.
    """

    __tablename__ = "interaction_logs"
    __table_args__ = (
        Index("ix_interaction_logs_user_key", "user_key"),
        Index("ix_interaction_logs_action_type", "action_type"),
        Index("ix_interaction_logs_created_at", "created_at"),
        Index("ix_interaction_logs_request_id", "recommendation_request_id"),
    )

    id: Mapped[int] = mapped_column(BigAutoPK, primary_key=True)
    user_key: Mapped[str] = mapped_column(String(150), nullable=False)
    # SET NULL on item delete so a deleted item's history is preserved.
    item_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("items.id", ondelete="SET NULL"), nullable=True
    )
    action_type: Mapped[str] = mapped_column(String(40), nullable=False)
    # JSON-as-string for SQLite parity. Callers use json.dumps / json.loads.
    metadata_json: Mapped[str] = mapped_column(Text, default="")
    # Added by migration 0006. Attributes an action to the recommendation
    # that surfaced the item, which is what makes per-item click-through
    # rate computable (ADR-002 §3.2). NULL when the action did not originate
    # from a recommendation.
    recommendation_request_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("recommendation_requests.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )


class User(Base):
    """Application user (admin slice — see ADR §11.1).

    The auth slice replaces the opaque ``anon:<uuid>`` user_key with a
    bcrypt-hashed username/password backed by this table. The first signed-up
    user (or anyone whose username is in ``RECSYS_ADMIN_USERNAMES``) is
    granted ``is_admin=True``; only admins can call ``/admin/*``.

    Lives alongside (not replaces) the existing ``anon:<uuid>`` flow —
    catalog browse remains anonymous-compatible via the user_key query
    param.
    """

    __tablename__ = "users"
    __table_args__ = (
        Index("ix_users_username", "username", unique=True),
    )

    id: Mapped[int] = mapped_column(BigAutoPK, primary_key=True)
    username: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(320), default="", nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    google_subject_id: Mapped[Optional[str]] = mapped_column(
        String(255), unique=True, nullable=True, index=True
    )
    auth_provider: Mapped[str] = mapped_column(
        String(32), default="password", nullable=False
    )
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), default="")
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    last_login_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class PasswordResetToken(Base):
    """Hashed, expiring, one-time token used by the email reset flow."""

    __tablename__ = "password_reset_tokens"
    __table_args__ = (
        Index("ix_password_reset_tokens_user_id", "user_id"),
        Index("ix_password_reset_tokens_token_hash", "token_hash", unique=True),
        Index("ix_password_reset_tokens_expires_at", "expires_at"),
    )

    id: Mapped[int] = mapped_column(BigAutoPK, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


# ---------------------------------------------------------------------------
# Recommender history (migration 0006)
# ---------------------------------------------------------------------------


class UserProfile(Base):
    """1:1 mirror of legacy ``accounts_userprofile``.

    Used by the dashboard / admin slice; not consulted by the recommendation
    hot path. ``role='super_admin'`` flips ``users.is_admin`` on import.
    """

    __tablename__ = "accounts_userprofile"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_accounts_userprofile_user_id"),
        Index("ix_accounts_userprofile_user_id", "user_id", unique=True),
        Index("ix_accounts_userprofile_role", "role"),
        CheckConstraint(
            "role IN ('user', 'super_admin')",
            name="ck_accounts_userprofile_role",
        ),
        CheckConstraint(
            "user_group IN ('user', 'super_admin')",
            name="ck_accounts_userprofile_user_group",
        ),
    )

    id: Mapped[int] = mapped_column(BigAutoPK, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    display_name: Mapped[str] = mapped_column(String(150), default="", nullable=False)
    role: Mapped[str] = mapped_column(String(20), default="user", nullable=False)
    user_group: Mapped[str] = mapped_column(String(100), default="user", nullable=False)
    experience_level: Mapped[str] = mapped_column(String(20), default="none", nullable=False)
    avatar_url: Mapped[str] = mapped_column(Text, default="", nullable=False)
    bio: Mapped[str] = mapped_column(Text, default="", nullable=False)
    consent_accepted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    consent_version: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    consent_accepted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    consent_withdrawn_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )


class RecommendationRequest(Base):
    """Snapshot of every recommendation request that hit the API.

    One row per ``POST /recommendations`` (and the auth-only
    ``GET /recommendations/profile``). The dashboard reads this table to
    render the 12-month trend chart via ``/metrics/requests``.
    """

    __tablename__ = "recommendation_requests"
    __table_args__ = (
        Index("ix_recommendation_requests_user_id", "user_id"),
        Index("ix_recommendation_requests_created_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(BigAutoPK, primary_key=True)
    user_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    selected_context_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("contexts.id", ondelete="RESTRICT"), nullable=False
    )
    candidate_count: Mapped[int] = mapped_column(Integer, nullable=False)
    top_k: Mapped[int] = mapped_column(Integer, nullable=False)
    method: Mapped[str] = mapped_column(String(80), nullable=False)
    # JSON-as-string for SQLite parity.
    metadata_json: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )


class RecommendationRequestSelectedKeyword(Base):
    """M2M between ``RecommendationRequest`` and ``Keyword``."""

    __tablename__ = "recommendation_request_selected_keywords"
    __table_args__ = (
        UniqueConstraint("request_id", "keyword_id", name="uq_rsk_request_keyword"),
        Index("ix_rsk_request_id", "request_id"),
        Index("ix_rsk_keyword_id", "keyword_id"),
    )

    id: Mapped[int] = mapped_column(BigAutoPK, primary_key=True)
    request_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("recommendation_requests.id", ondelete="CASCADE"),
        nullable=False,
    )
    keyword_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("keywords.id", ondelete="CASCADE"), nullable=False
    )


class RecommendationResult(Base):
    """One ranked result inside a ``RecommendationRequest``.

    One row per (request, item) pair. The dashboard reads
    ``COUNT(*) FROM recommendation_results`` joined with
    ``recommendation_requests.created_at`` for the "shown items" series.
    """

    __tablename__ = "recommendation_results"
    __table_args__ = (
        UniqueConstraint("request_id", "item_id", name="uq_rr_request_item"),
        UniqueConstraint("request_id", "rank", name="uq_rr_request_rank"),
        Index("ix_rr_request_id", "request_id"),
        Index("ix_rr_item_id", "item_id"),
    )

    id: Mapped[int] = mapped_column(BigAutoPK, primary_key=True)
    request_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("recommendation_requests.id", ondelete="CASCADE"),
        nullable=False,
    )
    item_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("items.id", ondelete="CASCADE"), nullable=False
    )
    rank: Mapped[int] = mapped_column(Integer, nullable=False)
    cbf_score: Mapped[float] = mapped_column(nullable=False)
    cf_score: Mapped[float] = mapped_column(nullable=False)
    hybrid_score: Mapped[float] = mapped_column(nullable=False)
    is_context_valid: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    matched_keywords_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    explanation: Mapped[str] = mapped_column(Text, default="", nullable=False)


class EvaluationRun(Base):
    """One snapshot of a recommender quality run.

    Populated by two paths:

    * ``source='offline'`` — ``pipelines/run_offline_evaluation.py``
      runs an 80/20 holdout over ``legacy_interactions`` and predicts
      top-10 with the live recommender. One row per run.
    * ``source='online'`` — recomputed lazily on every
      ``POST /recommendations`` from the last 30 days of
      ``recommendation_results`` joined with ``interaction_logs``.

    The dashboard's model-quality tiles prefer online rows when any
    exist, otherwise fall back to the latest offline row. When the
    table is empty the dashboard renders "รอการประเมิน".
    """

    __tablename__ = "evaluation_runs"
    __table_args__ = (
        Index("ix_evaluation_runs_source", "source"),
        Index("ix_evaluation_runs_ran_at", "ran_at"),
    )

    id: Mapped[int] = mapped_column(BigAutoPK, primary_key=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    ran_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    test_user_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    test_interaction_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    ndcg10: Mapped[float] = mapped_column(nullable=False, default=0.0)
    hr10: Mapped[float] = mapped_column(nullable=False, default=0.0)
    mrr10: Mapped[float] = mapped_column(nullable=False, default=0.0)
    coverage: Mapped[float] = mapped_column(nullable=False, default=0.0)
    violation_rate: Mapped[float] = mapped_column(nullable=False, default=0.0)
    metadata_json: Mapped[str] = mapped_column(Text, default="", nullable=False)


class PopularityWeight(Base):
    """One version of the popularity score weights (ADR-002 §4.4).

    The current ``engagement_score`` formula in ``db_query.py`` is
    hardcoded; this table is the replacement so an admin can retune
    the score without a code change or a deploy.

    Invariants enforced by ``services.popularity.set_weights``:

    * ``weights_json`` deserialises to ``{factor: float ∈ [0, 1]}``
      with values summing to 1.0 ± 1e-3.
    * At most one row has ``is_active=True`` at any time.
    * ``bayes_m`` ≥ 0 (the smoothing prior strength).
    * ``half_life_days`` ≥ 0 (0 disables time decay).

    Validation lives in the service, not the DB, because a stale row
    written by a previous version of the service must still load —
    a CHECK constraint here would break a rollback.
    """

    __tablename__ = "popularity_weights"
    __table_args__ = (Index("ix_popularity_weights_is_active", "is_active"),)

    id: Mapped[int] = mapped_column(BigAutoPK, primary_key=True)
    # JSON-as-string for SQLite parity (tests run on SQLite). Validated
    # on write; readers trust the writer.
    weights_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    half_life_days: Mapped[int] = mapped_column(Integer, nullable=False, default=14)
    bayes_m: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_by: Mapped[str] = mapped_column(
        String(150), nullable=False, default=""
    )

    def weights(self) -> dict:
        """Deserialise ``weights_json`` lazily on access (callers hot-path)."""
        import json

        try:
            out = json.loads(self.weights_json or "{}")
        except (TypeError, ValueError):
            return {}
        return out if isinstance(out, dict) else {}


__all__ = [
    "Base",
    "Context",
    "TaxonomyNode",
    "Keyword",
    "Item",
    "ItemContext",
    "ItemKeyword",
    "LegacyInteraction",
    "Like",
    "SavedItem",
    "Rating",
    "InteractionLog",
    "User",
    "PasswordResetToken",
    "UserProfile",
    "RecommendationRequest",
    "RecommendationRequestSelectedKeyword",
    "RecommendationResult",
    "EvaluationRun",
    "PopularityWeight",
]
