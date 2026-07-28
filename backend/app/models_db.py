"""
models_db.py — SQLAlchemy ORM models for the catalog + legacy interactions.

These mirror the schema created by pipelines/migrate_sqlite_to_postgres.py.
The backend uses them to query legacy user logs at serving time so the CF
service can merge live positive evidence with the precomputed CF index.
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, SmallInteger, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Context(Base):
    __tablename__ = "contexts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    group_name: Mapped[str] = mapped_column(String(255), default="")
    description: Mapped[str] = mapped_column(Text, default="")


class TaxonomyNode(Base):
    __tablename__ = "taxonomy_nodes"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    level: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    parent_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("taxonomy_nodes.id", ondelete="SET NULL"), nullable=True
    )


class Keyword(Base):
    __tablename__ = "keywords"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    taxonomy_node_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("taxonomy_nodes.id", ondelete="SET NULL"), nullable=True
    )


class Item(Base):
    __tablename__ = "items"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
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


class ItemContext(Base):
    __tablename__ = "item_contexts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    item_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("items.id", ondelete="CASCADE"))
    context_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("contexts.id", ondelete="CASCADE"))
    validity_status: Mapped[str] = mapped_column(String(30), default="valid")


class ItemKeyword(Base):
    __tablename__ = "item_keywords"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    item_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("items.id", ondelete="CASCADE"))
    keyword_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("keywords.id", ondelete="CASCADE"))
    source: Mapped[str] = mapped_column(String(100), default="")


class LegacyInteraction(Base):
    __tablename__ = "legacy_interactions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    legacy_user_id: Mapped[str] = mapped_column(String(150), nullable=False)
    item_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("items.id", ondelete="CASCADE"))
    context_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("contexts.id", ondelete="CASCADE"), nullable=True
    )
    rating: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    keywords: Mapped[list] = mapped_column(JSONB, default=list)
    raw_item_name: Mapped[str] = mapped_column(String(255), default="")
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


__all__ = [
    "Base",
    "Context",
    "TaxonomyNode",
    "Keyword",
    "Item",
    "ItemContext",
    "ItemKeyword",
    "LegacyInteraction",
]