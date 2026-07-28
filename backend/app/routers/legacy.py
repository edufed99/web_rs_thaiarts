"""
routers/legacy.py — Read-only endpoints over the live Postgres DB.

These endpoints surface per-item statistics from the ``legacy_interactions``
table so the dashboard can show how many legacy users rated each item.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from ..db import is_db_enabled
from ..schemas.metrics import HealthOut
from ..services.db_query import live_item_stats


router = APIRouter(tags=["legacy"])


@router.get(
    "/items/{item_id}/legacy-stats",
    summary="Legacy interaction stats for an item",
    description=(
        "Returns the count and average rating of legacy interactions for an "
        "item, sourced from the live ``legacy_interactions`` Postgres table. "
        "Returns zeros when the DB layer is disabled."
    ),
)
def legacy_stats(item_id: int):
    stats = live_item_stats().get(int(item_id), {"count": 0.0, "avg_rating": 0.0})
    return {
        "item_id": int(item_id),
        "count": int(stats["count"]),
        "avg_rating": float(stats["avg_rating"]),
        "source": "postgres" if is_db_enabled() else "disabled",
    }


@router.get(
    "/db/health",
    response_model=HealthOut,
    summary="Database liveness",
    description=(
        "Returns 200 with status='ok' when the DB is reachable, "
        "status='disabled' when RECSYS_DB_ENABLED=0."
    ),
)
def db_health():
    from ..db import get_engine
    from sqlalchemy import text as sql_text
    eng = get_engine()
    if eng is None:
        return HealthOut(
            status="disabled",
            version="1.0.0",
            artifacts_loaded_at=None,
            item_count=0,
            context_count=0,
            embedding_dim=0,
        )
    try:
        with eng.connect() as conn:
            conn.execute(sql_text("SELECT 1"))
        return HealthOut(
            status="ok",
            version="1.0.0",
            artifacts_loaded_at=None,
            item_count=0,
            context_count=0,
            embedding_dim=0,
        )
    except Exception as exc:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=503,
            content={
                "status": "error",
                "error": {"code": "db_unreachable", "message": str(exc)},
            },
        )