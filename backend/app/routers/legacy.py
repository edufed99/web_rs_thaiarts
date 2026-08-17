"""
routers/legacy.py — Read-only endpoints over the live Postgres DB.

These endpoints surface per-item statistics from the ``legacy_interactions``
table so the UI can show how many users rated each item.

Id spaces
---------
``legacy_interactions.item_id`` references ``items.id`` (the DB primary key),
but every API surface — including the ``item_id`` in these routes — speaks
**artifact ids** (``items.artifact_item_id``). Requests therefore translate
through ``artifact_id_to_db_id`` before touching the aggregate. Skipping that
translation silently returns zeros instead of raising, so keep it.
"""
from __future__ import annotations

from typing import Dict, List

from fastapi import APIRouter, Query

from ..db import is_db_enabled
from ..schemas.metrics import HealthOut
from ..services.db_query import (
    artifact_id_to_db_id,
    artifact_ids_to_db_ids,
    live_item_stats,
)


router = APIRouter(tags=["legacy"])

_EMPTY = {"count": 0.0, "avg_rating": 0.0}


def _payload(artifact_id: int, stats: Dict[str, float]) -> dict:
    return {
        "item_id": int(artifact_id),
        "count": int(stats["count"]),
        "avg_rating": float(stats["avg_rating"]),
        "source": "postgres" if is_db_enabled() else "disabled",
    }


@router.get(
    "/legacy-stats",
    summary="Legacy interaction stats for several items",
    description=(
        "Batch form of ``/items/{item_id}/legacy-stats``. Accepts a "
        "comma-separated list of **artifact** item ids (max 200) and returns "
        "one entry per requested id, so a catalog grid needs a single "
        "round-trip instead of one request per card. Unknown ids come back "
        "with zeros rather than an error.\n\n"
        "Mounted at ``/legacy-stats`` rather than ``/items/legacy-stats`` "
        "because the catalog router registers ``/items/{item_id}`` first, "
        "which would shadow a literal sibling segment."
    ),
)
def legacy_stats_batch(
    ids: str = Query(
        ...,
        description="Comma-separated artifact item ids, e.g. ``80903627,22052483``.",
    ),
):
    raw = [chunk.strip() for chunk in ids.split(",")]
    artifact_ids: List[int] = []
    for chunk in raw:
        if not chunk:
            continue
        try:
            artifact_ids.append(int(chunk))
        except ValueError:
            # Ignore junk rather than failing the whole grid.
            continue
    # Preserve caller order while dropping duplicates.
    seen = set()
    unique_ids = [i for i in artifact_ids if not (i in seen or seen.add(i))][:200]

    # Two queries total, regardless of how many ids were asked for.
    aggregate = live_item_stats()
    db_ids = artifact_ids_to_db_ids(unique_ids)
    return {
        "stats": [
            _payload(aid, aggregate.get(db_ids.get(aid), _EMPTY))
            for aid in unique_ids
        ]
    }


@router.get(
    "/items/{item_id}/legacy-stats",
    summary="Legacy interaction stats for an item",
    description=(
        "Returns the count and average rating of legacy interactions for an "
        "item, sourced from the live ``legacy_interactions`` Postgres table. "
        "``item_id`` is an **artifact** id and is translated to the DB id "
        "internally. Returns zeros when the DB layer is disabled or the item "
        "has no interactions."
    ),
)
def legacy_stats(item_id: int):
    db_id = artifact_id_to_db_id(item_id)
    aggregate = live_item_stats()
    stats = aggregate.get(db_id, _EMPTY) if db_id is not None else _EMPTY
    return _payload(item_id, stats)


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