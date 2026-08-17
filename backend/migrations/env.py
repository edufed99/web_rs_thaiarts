"""
env.py — Alembic environment.

Sync template (matches app/db.py which uses sync create_engine + psycopg).
The DB URL is read from $RECSYS_DATABASE_URL (with the same default as
app/db.py) so the two stay aligned. When $RECSYS_DB_ENABLED=0 we refuse
to run — migrations should never be applied while the DB layer is off.
"""
from __future__ import annotations

import os
import sys
from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

# Make ``app.*`` importable when alembic is invoked from the backend dir.
HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND_ROOT = os.path.dirname(HERE)
if BACKEND_ROOT not in sys.path:
    sys.path.insert(0, BACKEND_ROOT)

from app.models_db import Base  # noqa: E402

config = context.config

# Configure Python logging from alembic.ini (if present).
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _resolve_url() -> str:
    """Pick the SQLAlchemy URL from $RECSYS_DATABASE_URL or fall back to the
    same default used in app/db.py so alembic and the app stay in sync."""
    return os.environ.get(
        "RECSYS_DATABASE_URL",
        "postgresql+psycopg://postgres:postgres@127.0.0.1:5432/web_rs_thaiarts",
    )


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode (emit SQL without a DB connection)."""
    context.configure(
        url=_resolve_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode using a sync engine."""
    if os.environ.get("RECSYS_DB_ENABLED", "1") == "0":
        raise RuntimeError(
            "RECSYS_DB_ENABLED=0 — refusing to run Alembic. "
            "Migrations require a live database; flip the env var to 1 first."
        )

    connectable = create_engine(_resolve_url(), future=True, pool_pre_ping=True)
    try:
        with connectable.connect() as connection:
            context.configure(
                connection=connection,
                target_metadata=target_metadata,
                compare_type=True,
                compare_server_default=True,
            )
            with context.begin_transaction():
                context.run_migrations()
    finally:
        connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
