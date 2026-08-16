"""
routers/catalog.py — GET /items, GET /items/{id}, GET /items/batch, GET /items/{id}/similar, GET /items/engagement.

Thin HTTP routing layer for catalog read operations.
Delegates all database querying, DataFrame fallback, TTL caching,
media resolution, and user state overlay to app.services.catalogue.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, Query

from ..core.exceptions import ItemNotFoundError
from ..db import session_scope
from ..model_loader import ArtifactLoader, get_singleton
from ..models_db import User
from ..schemas.item import EngagementListOut, EngagementOut, ItemListOut, ItemOut
from ..services import catalogue
from ..services.db_query import live_user_state_for_items
from ._user_key import get_current_user_dep, resolve_user_key

router = APIRouter(tags=["catalog"])

# Re-exports for backward-compatibility with tests and internal callers
RANKED_MODE_LIMIT = catalogue.RANKED_MODE_LIMIT
_DB_ROWS_CACHE_TTL_SECONDS = catalogue._DB_ROWS_CACHE_TTL_SECONDS
_db_rows_cache = catalogue._db_rows_cache
_db_rows_lock = catalogue._db_rows_lock
_db_item_rows = catalogue._db_item_rows
_db_contexts_by_item = catalogue._db_contexts_by_item
_db_catalog_signature = catalogue._db_catalog_signature
_matches_all_terms = catalogue._matches_all_terms
invalidate_db_item_rows_cache = catalogue.invalidate_db_item_rows_cache


@router.get(
    "/items",
    response_model=ItemListOut,
    summary="List active items",
    description=(
        "Returns a paginated list of active catalog items. Supports an "
        "optional `search` that matches item `name` first, then "
        "`category_group`, then `description`, an optional "
        "`context` for the legacy top-10 ranked mode, and an optional "
        "`user_key` to populate each item's `user_state`."
    ),
)
def list_items(
    search: Optional[str] = Query(
        None,
        description=(
            "Case-insensitive substring filter. Matches name first, falls "
            "back to category_group, then description. performance_type is not searched."
        ),
    ),
    limit: int = Query(20, ge=1, le=200, description="Max items to return (1-200). Ignored when `context` is set (top-10)."),
    offset: int = Query(0, ge=0, description="Number of items to skip for pagination. Ignored when `context` is set."),
    context: Optional[int] = Query(
        None,
        gt=0,
        description=(
            "Optional sub-context id. When provided, the response is the "
            "top-10 context-valid items sorted by match_percent desc, "
            "matching the legacy `catalog.views.item_list` ranked mode."
        ),
    ),
    user_key: Optional[str] = Query(
        None,
        max_length=150,
        description="Optional opaque user id — when provided, each item's user_state is populated from the live DB.",
    ),
    user: Optional[User] = Depends(get_current_user_dep),
    loader: ArtifactLoader = Depends(get_singleton),
) -> ItemListOut:
    effective_user_key = _effective_user_key(user, user_key)
    return catalogue.list_items(
        loader=loader,
        search=search,
        limit=limit,
        offset=offset,
        context=context,
        user_key=effective_user_key,
    )


@router.get(
    "/items/engagement",
    response_model=EngagementListOut,
    summary="Live engagement counters per item (public homepage ranking)",
    description=(
        "Returns `{engagements, source}` where `engagements` is a row "
        "per requested artifact item id, sorted by `engagement_score` "
        "desc. The score sums three live-action signals from the live "
        "`likes`, `saved_items`, and `ratings` tables (only ratings "
        ">= `positive_threshold` count — low ratings reflect "
        "dissatisfaction and are intentionally excluded). Anonymous — the "
        "homepage uses this to rank the \"ชุดการแสดงยอดนิยม\" cards and to "
        "surface real like / save / rating counts. Returns `source="
        "'disabled'` and an empty list when the DB layer is off."
    ),
)
def items_engagement(
    ids: str = Query(
        ...,
        description=(
            "Comma-separated artifact item ids, max 200. Same id space as "
            "`ItemOut.id`. Mirrors the `/legacy-stats` batch route."
        ),
    ),
    range: str = Query(
        "all",
        description="Popularity window. Accepted: all, 7d, 30d, 90d, 365d.",
    ),
    loader: ArtifactLoader = Depends(get_singleton),
) -> EngagementListOut:
    requested = _parse_item_ids(ids)
    return catalogue.get_items_engagement(loader=loader, item_ids=requested, range_str=range)


@router.get(
    "/items/batch",
    response_model=ItemListOut,
    summary="Get multiple catalog items in one request",
)
def get_items_batch(
    ids: str = Query(..., description="Comma-separated artifact item ids, max 200."),
    user_key: Optional[str] = Query(default=None, max_length=150),
    user: Optional[User] = Depends(get_current_user_dep),
    loader: ArtifactLoader = Depends(get_singleton),
) -> ItemListOut:
    effective_user_key = _effective_user_key(user, user_key)
    requested = _parse_item_ids(ids)
    items = catalogue.get_items_batch(loader=loader, item_ids=requested, user_key=effective_user_key)
    return ItemListOut(items=items, total=len(items))


@router.get(
    "/items/{item_id}/similar",
    response_model=ItemListOut,
    summary="Find genuinely similar catalog items",
)
def get_similar_items(
    item_id: int,
    limit: int = Query(default=4, ge=1, le=20),
    user_key: Optional[str] = Query(default=None, max_length=150),
    user: Optional[User] = Depends(get_current_user_dep),
    loader: ArtifactLoader = Depends(get_singleton),
) -> ItemListOut:
    effective_user_key = _effective_user_key(user, user_key)
    items = catalogue.get_similar_items(
        loader=loader,
        item_id=item_id,
        limit=limit,
        user_key=effective_user_key,
    )
    return ItemListOut(items=items, total=len(items))


@router.get(
    "/items/{item_id}",
    response_model=ItemOut,
    summary="Get one item by id",
    description="Returns the item plus its attached keywords, contexts, and per-user state.",
    responses={404: {"description": "Item id not found."}},
)
def get_item(
    item_id: int,
    user_key: Optional[str] = Query(
        None,
        max_length=150,
        description="Optional opaque user id — when provided, the item's user_state is populated from the live DB.",
    ),
    user: Optional[User] = Depends(get_current_user_dep),
    loader: ArtifactLoader = Depends(get_singleton),
) -> ItemOut:
    effective_user_key = _effective_user_key(user, user_key)
    item = catalogue.get_item(loader=loader, item_id=item_id, user_key=effective_user_key)
    if item is None:
        raise ItemNotFoundError(
            f"Item id {item_id} not found.",
            extra={"item_id": int(item_id)},
        )
    return item


def _effective_user_key(user: Optional[User], user_key: Optional[str]) -> str:
    if user is None and not user_key:
        return ""
    return resolve_user_key(user=user, body_user_key=user_key)


def _parse_item_ids(raw_ids: str) -> list[int]:
    parsed: list[int] = []
    seen: set[int] = set()
    for chunk in str(raw_ids or "").split(","):
        try:
            item_id = int(chunk.strip())
        except ValueError:
            continue
        if item_id > 0 and item_id not in seen:
            seen.add(item_id)
            parsed.append(item_id)
        if len(parsed) >= 200:
            break
    return parsed
