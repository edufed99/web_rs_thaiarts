"""
db.py — SQLAlchemy engine + session factory.

The backend reads catalog + legacy interactions from Postgres at startup.
This supplements the static artifacts/ — items/keywords/contexts come from
parquet, but live legacy_interactions come from the DB so newly imported
data is reflected immediately.

Config (env vars):
    RECSYS_DATABASE_URL  — SQLAlchemy URL (default: postgresql+psycopg://postgres:postgres@127.0.0.1:5432/web_rs_thaiarts)
    RECSYS_DB_ENABLED    — "1" to enable, "0" to disable (default: "1")

If disabled, the DB layer is bypassed and the system runs on artifacts only
(useful for tests / synthetic mode).
"""
from __future__ import annotations

import logging
import os
from contextlib import contextmanager
from typing import Iterator, Optional

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from .core.config import get_settings

logger = logging.getLogger(__name__)


_engine: Optional[Engine] = None
_SessionLocal: Optional[sessionmaker] = None


def is_db_enabled() -> bool:
    raw = os.environ.get("RECSYS_DB_ENABLED")
    if raw is not None:
        return raw == "1"
    return bool(get_settings().db_enabled)


def get_engine() -> Engine:
    """Lazy-init the engine. Returns None if DB is disabled."""
    global _engine
    if not is_db_enabled():
        return None
    if _engine is None:
        url = os.environ.get("RECSYS_DATABASE_URL") or get_settings().database_url
        logger.info("Connecting to DB: %s", url)
        _engine = create_engine(url, future=True, pool_pre_ping=True)
    return _engine


def get_session_factory() -> sessionmaker:
    global _SessionLocal
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(bind=get_engine(), expire_on_commit=False, future=True)
    return _SessionLocal


@contextmanager
def session_scope() -> Iterator[Optional[Session]]:
    """Open a session. Yields None if DB is disabled."""
    if not is_db_enabled():
        yield None
        return
    SessionLocal = get_session_factory()
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def reset_engine() -> None:
    """Test helper — drop the cached engine/sessionmaker."""
    global _engine, _SessionLocal
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _SessionLocal = None
