"""
migrate_sqlite_to_postgres.py — One-shot migration script.

Reads the legacy Django SQLite database (read-only) and loads catalog data
plus user interactions into the new Postgres backend. This is the bridge
between the legacy system and the new FastAPI + Postgres architecture.

Usage:
    python pipelines/migrate_sqlite_to_postgres.py \\
        --sqlite "C:/Users/Pichaya/Downloads/web_appRS/thai_arts_webapp/db.sqlite3" \\
        --target-url "postgresql+asyncpg://postgres:postgres@127.0.0.1:5432/thai_arts_recommender"

What it migrates (read from SQLite):
    catalog_context, catalog_taxonomynode, catalog_keyword
    catalog_item, catalog_itemcontext, catalog_itemkeyword
    recommender_legacyinteraction   (2534 rows from user logs)

What it does NOT migrate (out of scope — not used by backend):
    auth_*, django_*, sqlite_sequence, accounts_*, recommender_itemembedding
    (the latter is recomputed by train_or_generate_artifacts.py)

The legacy project is never modified. This script only opens it with mode=ro.
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path
from typing import Iterator

from sqlalchemy import create_engine, MetaData, Table, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Migrate legacy SQLite → new Postgres.")
    p.add_argument(
        "--sqlite",
        required=True,
        help="Path to the legacy Django SQLite file (read-only).",
    )
    p.add_argument(
        "--target-url",
        required=True,
        help="SQLAlchemy URL for the target Postgres database.",
    )
    p.add_argument(
        "--batch-size",
        type=int,
        default=500,
        help="Rows per bulk insert.",
    )
    return p.parse_args()


def open_legacy_sqlite(path: Path) -> sqlite3.Connection:
    """Open the legacy SQLite in URI mode with read-only flag."""
    uri = f"file:{path.as_posix()}?mode=ro"
    con = sqlite3.connect(uri, uri=True)
    # Ensure every text read returns str (not bytes).
    con.text_factory = str
    return con


def fetch_table(con: sqlite3.Connection, table: str, columns: list[str]) -> Iterator[tuple]:
    placeholders = ", ".join(columns)
    cur = con.execute(f"SELECT {placeholders} FROM {table}")
    return cur  # caller iterates; bulk INSERT to PG handles the rest


def migrate_contexts(session, con, metadata) -> int:
    rows = list(con.execute('SELECT id, name, "group", description FROM catalog_context'))
    payload = [
        {"id": r[0], "name": r[1], "group_name": r[2] or "", "description": r[3] or ""}
        for r in rows
    ]
    return upsert(session, metadata.tables["contexts"], payload, ["id"])


def migrate_taxonomy(session, con, metadata) -> int:
    rows = list(con.execute("SELECT id, name, level, parent_id FROM catalog_taxonomynode"))
    payload = [
        {"id": r[0], "name": r[1], "level": r[2], "parent_id": r[3]}
        for r in rows
    ]
    return upsert(session, metadata.tables["taxonomy_nodes"], payload, ["id"])


def migrate_keywords(session, con, metadata) -> int:
    rows = list(con.execute("SELECT id, name, taxonomy_node_id FROM catalog_keyword"))
    payload = [
        {"id": r[0], "name": r[1], "taxonomy_node_id": r[2]}
        for r in rows
    ]
    return upsert(session, metadata.tables["keywords"], payload, ["id"])


def migrate_items(session, con, metadata) -> int:
    rows = list(con.execute(
        "SELECT id, name, description, category_group, performance_type, "
        "performers_count, duration_minutes, price_text, image_url, video_url, is_active "
        "FROM catalog_item"
    ))
    payload = [
        {
            "id": r[0],
            "name": r[1],
            "description": r[2] or "",
            "category_group": r[3] or "",
            "performance_type": r[4] or "",
            "performers_count": r[5],
            "duration_minutes": r[6],
            "price_text": r[7] or "",
            "image_url": r[8] or "",
            "video_url": r[9] or "",
            "is_active": bool(r[10]),
        }
        for r in rows
    ]
    return upsert(session, metadata.tables["items"], payload, ["id"])


def migrate_item_context(session, con, metadata) -> int:
    rows = list(con.execute(
        "SELECT id, item_id, context_id, validity_status FROM catalog_itemcontext"
    ))
    payload = [
        {
            "id": r[0],
            "item_id": r[1],
            "context_id": r[2],
            "validity_status": r[3] or "valid",
        }
        for r in rows
    ]
    return upsert(session, metadata.tables["item_contexts"], payload, ["id"])


def migrate_item_keyword(session, con, metadata) -> int:
    rows = list(con.execute(
        "SELECT id, item_id, keyword_id, source FROM catalog_itemkeyword"
    ))
    payload = [
        {"id": r[0], "item_id": r[1], "keyword_id": r[2], "source": r[3] or ""}
        for r in rows
    ]
    return upsert(session, metadata.tables["item_keywords"], payload, ["id"])


def migrate_legacy_interactions(session, con, metadata) -> int:
    """Map legacy_user_id → synthetic user_key 'legacy:<legacy_user_id>'.
    No FK to auth_user because that table is empty / not migrated.
    """
    rows = list(con.execute(
        "SELECT id, legacy_user_id, item_id, context_id, rating, keywords, "
        "raw_item_name, imported_at "
        "FROM recommender_legacyinteraction"
    ))
    payload = []
    for r in rows:
        kw_raw = r[5]
        if isinstance(kw_raw, (bytes, bytearray)):
            kw_raw = kw_raw.decode("utf-8", errors="ignore")
        if not kw_raw:
            keywords = []
        else:
            import json
            try:
                parsed = json.loads(kw_raw)
                keywords = parsed if isinstance(parsed, list) else []
            except (ValueError, TypeError):
                keywords = []
        payload.append({
            "id": r[0],
            "legacy_user_id": r[1] or "",
            "item_id": r[2],
            "context_id": r[3],
            "rating": r[4],
            "keywords": keywords,
            "raw_item_name": r[6] or "",
            "imported_at": r[7],
        })
    return upsert(session, metadata.tables["legacy_interactions"], payload, ["id"])


def ensure_schema(engine) -> MetaData:
    """Create the tables we migrate into. Returns the MetaData with the
    reflected Table objects so callers can use them in upserts."""
    ddl_statements = [
        # contexts
        """CREATE TABLE IF NOT EXISTS contexts (
            id BIGINT PRIMARY KEY,
            name VARCHAR(255) NOT NULL UNIQUE,
            group_name VARCHAR(255) DEFAULT '',
            description TEXT DEFAULT ''
        )""",
        # taxonomy_nodes
        """CREATE TABLE IF NOT EXISTS taxonomy_nodes (
            id BIGINT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            level SMALLINT NOT NULL,
            parent_id BIGINT REFERENCES taxonomy_nodes(id) ON DELETE SET NULL
        )""",
        # keywords
        """CREATE TABLE IF NOT EXISTS keywords (
            id BIGINT PRIMARY KEY,
            name VARCHAR(255) NOT NULL UNIQUE,
            taxonomy_node_id BIGINT REFERENCES taxonomy_nodes(id) ON DELETE SET NULL
        )""",
        # items
        """CREATE TABLE IF NOT EXISTS items (
            id BIGINT PRIMARY KEY,
            name VARCHAR(255) NOT NULL UNIQUE,
            description TEXT DEFAULT '',
            category_group VARCHAR(255) DEFAULT '',
            performance_type VARCHAR(255) DEFAULT '',
            performers_count INTEGER,
            duration_minutes INTEGER,
            price_text VARCHAR(255) DEFAULT '',
            image_url VARCHAR(500) DEFAULT '',
            video_url VARCHAR(500) DEFAULT '',
            is_active BOOLEAN NOT NULL DEFAULT TRUE
        )""",
        # item_contexts (M2M with metadata)
        """CREATE TABLE IF NOT EXISTS item_contexts (
            id BIGINT PRIMARY KEY,
            item_id BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
            context_id BIGINT NOT NULL REFERENCES contexts(id) ON DELETE CASCADE,
            validity_status VARCHAR(30) DEFAULT 'valid'
        )""",
        # item_keywords (M2M with metadata)
        """CREATE TABLE IF NOT EXISTS item_keywords (
            id BIGINT PRIMARY KEY,
            item_id BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
            keyword_id BIGINT NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
            source VARCHAR(100) DEFAULT ''
        )""",
        # legacy_interactions
        """CREATE TABLE IF NOT EXISTS legacy_interactions (
            id BIGINT PRIMARY KEY,
            legacy_user_id VARCHAR(150) NOT NULL,
            item_id BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
            context_id BIGINT REFERENCES contexts(id) ON DELETE CASCADE,
            rating SMALLINT NOT NULL,
            keywords JSONB DEFAULT '[]'::jsonb,
            raw_item_name VARCHAR(255) DEFAULT '',
            imported_at TIMESTAMPTZ NOT NULL
        )""",
    ]
    with engine.begin() as conn:
        for ddl in ddl_statements:
            conn.execute(text(ddl))
    metadata = MetaData()
    metadata.reflect(bind=engine)
    return metadata


def upsert(session, table, payload, index_elements):
    """PostgreSQL upsert via ON CONFLICT DO NOTHING."""
    if not payload:
        return 0
    stmt = pg_insert(table).values(payload)
    stmt = stmt.on_conflict_do_nothing(index_elements=index_elements)
    session.execute(stmt)
    return len(payload)


def main() -> int:
    args = parse_args()
    sqlite_path = Path(args.sqlite).expanduser().resolve()
    if not sqlite_path.exists():
        print(f"ERROR: SQLite not found: {sqlite_path}", file=sys.stderr)
        return 2

    print(f"Source SQLite: {sqlite_path}")
    print(f"Target URL:    {args.target_url}")

    legacy = open_legacy_sqlite(sqlite_path)
    target = create_engine(args.target_url, future=True)

    print("Ensuring target schema (CREATE TABLE IF NOT EXISTS)...")
    metadata = ensure_schema(target)

    with Session(target) as session:
        with session.begin():
            counts = {}
            counts["contexts"] = migrate_contexts(session, legacy, metadata)
            counts["taxonomy_nodes"] = migrate_taxonomy(session, legacy, metadata)
            counts["keywords"] = migrate_keywords(session, legacy, metadata)
            counts["items"] = migrate_items(session, legacy, metadata)
            counts["item_contexts"] = migrate_item_context(session, legacy, metadata)
            counts["item_keywords"] = migrate_item_keyword(session, legacy, metadata)
            counts["legacy_interactions"] = migrate_legacy_interactions(session, legacy, metadata)

    legacy.close()
    target.dispose()

    print()
    print("=== Migration complete ===")
    for k, v in counts.items():
        print(f"  {k:25s} {v:>6d} rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())