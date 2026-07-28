"""
routers/catalog.py — GET /items, GET /items/{id}.

Read-only browse endpoints backed by the static catalog artifact.

Two list modes:

* **Browse mode** (default) — paginated search across name, description
  and keyword names. Returns up to ``limit`` items.
* **Ranked mode** (``?context=<id>``) — returns the top-10 items that
  pass the eligibility gate for the selected sub-context, sorted by
  ``match_percent`` descending (legacy ``item_list`` behaviour). Each
  item carries a populated ``match_percent`` and ``suitability_label``.
"""
from __future__ import annotations

from typing import Optional

import pandas as pd
from fastapi import APIRouter, Depends, Query

from ..core.config import get_settings
from ..core.exceptions import ContextNotFoundError, ItemNotFoundError
from ..model_loader import ArtifactLoader, get_singleton
from ..models_db import User
from ..schemas.context import ContextOut
from ..schemas.item import ItemListOut, ItemOut, UserState
from ..schemas.keyword import KeywordOut
from ..services._ids import stable_id
from ..services.db_query import live_user_state_for_items
from ..services.eligibility import context_name_for_id
from ..services.suitability import catalog_match_percent, suitability_label
from ._user_key import get_current_user_dep, resolve_user_key


router = APIRouter(tags=["catalog"])

# Legacy top-10 cap used by ``item_list`` when a context is selected.
RANKED_MODE_LIMIT = 10


@router.get(
    "/items",
    response_model=ItemListOut,
    summary="List active items",
    description=(
        "Returns a paginated list of active catalog items. Supports an "
        "optional `search` substring match against `name`, `description` "
        "and `keyword_names`, an optional `context` for the legacy "
        "top-10 ranked mode, and an optional `user_key` to populate "
        "each item's `user_state`."
    ),
)
def list_items(
    search: Optional[str] = Query(None, description="Case-insensitive substring filter on name/description/keywords."),
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
    effective_user_key = resolve_user_key(user=user, body_user_key=user_key)
    df = loader.items
    active = df[df["is_active"].astype(bool)]

    # Optional ranked-by-context mode (legacy top-10).
    if context is not None:
        return _ranked_by_context(active, context, effective_user_key, loader)

    # Browse mode: optional substring search + pagination.
    if search:
        needle = search.lower()
        name_mask = active["name"].fillna("").str.lower().str.contains(needle, regex=False, na=False)
        desc_mask = active["description"].fillna("").str.lower().str.contains(needle, regex=False, na=False)
        kw_mask = active["keyword_names"].apply(
            lambda names: needle in " ".join(str(n).lower() for n in (names or []))
        )
        active = active[name_mask | desc_mask | kw_mask]

    total = int(len(active))
    page = active.iloc[offset : offset + limit]
    artifact_ids = [int(r["item_id"]) for _, r in page.iterrows()]
    state_map = live_user_state_for_items(effective_user_key, artifact_ids)
    return ItemListOut(
        items=[
            _row_to_item_out(row, loader, user_state=state_map.get(int(row["item_id"])))
            for _, row in page.iterrows()
        ],
        total=total,
    )


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
    effective_user_key = resolve_user_key(user=user, body_user_key=user_key)
    row = loader.item_row(int(item_id))
    if row is None:
        raise ItemNotFoundError(
            f"Item id {item_id} not found.",
            extra={"item_id": int(item_id)},
        )
    state_map = live_user_state_for_items(effective_user_key, [int(item_id)])
    return _row_to_item_out(row, loader, user_state=state_map.get(int(item_id)))


def _row_to_item_out(row, loader: ArtifactLoader, user_state: Optional[UserState] = None) -> ItemOut:
    iid = int(row["item_id"])
    kw_names = list(row.get("keyword_names") or [])
    kw_paths = list(row.get("taxonomy_paths") or [])
    keyword_objs = [
        KeywordOut(
            id=stable_id("keyword", str(n)),
            name=str(n),
            taxonomy_path=str(kw_paths[idx]) if idx < len(kw_paths) else "",
        )
        for idx, n in enumerate(kw_names)
        if n
    ]
    ctx_names = list(row.get("context_names") or [])
    context_objs = [
        ContextOut(
            id=stable_id("context", str(c)),
            name=str(c),
            group="",
            description="",
            active_item_count=0,
        )
        for c in ctx_names
        if c
    ]
    # Always compute match_percent for consistency; omit the label until a
    # caller actually wants it surfaced (ranked-mode + recommendation path).
    mp = catalog_match_percent(
        keyword_count=len(kw_names),
        context_count=len(ctx_names),
        description_length=len(str(row.get("description") or "")),
    )
    return ItemOut(
        id=iid,
        name=str(row.get("name") or ""),
        description=str(row.get("description") or ""),
        category_group=str(row.get("category_group") or ""),
        performance_type=str(row.get("performance_type") or ""),
        performers_count=row.get("performers_count"),
        duration_minutes=row.get("duration_minutes"),
        price_text=str(row.get("price_text") or ""),
        image_url="",
        video_url="",
        keywords=keyword_objs,
        contexts=context_objs,
        user_state=user_state or UserState(),
        match_percent=mp,
        suitability_label=suitability_label(mp),
    )


def _ranked_by_context(
    df: "pd.DataFrame",
    context_id: int,
    user_key: Optional[str],
    loader: ArtifactLoader,
) -> ItemListOut:
    """Return the top-10 items valid for ``context_id`` sorted by match_percent desc."""
    ctx_name = context_name_for_id(loader, int(context_id))
    if not ctx_name:
        raise ContextNotFoundError(
            f"Context id {context_id} is not known.",
            extra={"context_id": context_id},
        )
    mask = df["context_names"].apply(lambda names: ctx_name in (names or []))
    eligible = df[mask]
    # Compute match_percent on the eligible subset, then sort desc.
    scored = []
    for _, row in eligible.iterrows():
        mp = catalog_match_percent(
            keyword_count=len(row.get("keyword_names") or []),
            context_count=len(row.get("context_names") or []),
            description_length=len(str(row.get("description") or "")),
        )
        scored.append((mp, str(row.get("name") or ""), row))
    scored.sort(key=lambda t: (-t[0], t[1]))
    top = scored[:RANKED_MODE_LIMIT]
    artifact_ids = [int(r["item_id"]) for _, _, r in top]
    state_map = live_user_state_for_items(user_key or "", artifact_ids)
    items = []
    for mp, _name, row in top:
        item = _row_to_item_out(row, loader, user_state=state_map.get(int(row["item_id"])))
        items.append(item)
    return ItemListOut(items=items, total=len(items))