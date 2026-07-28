"""
routers/catalog.py — GET /items, GET /items/{id}.

Read-only browse endpoints backed by the static catalog artifact.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query

from ..core.config import get_settings
from ..core.exceptions import ItemNotFoundError
from ..model_loader import ArtifactLoader, get_singleton
from ..schemas.context import ContextOut
from ..schemas.item import ItemListOut, ItemOut, UserState
from ..schemas.keyword import KeywordOut
from ..services._ids import stable_id


router = APIRouter(tags=["catalog"])


@router.get(
    "/items",
    response_model=ItemListOut,
    summary="List active items",
    description=(
        "Returns a paginated list of active catalog items. Supports an "
        "optional `search` substring match against `name` and `description`."
    ),
)
def list_items(
    search: Optional[str] = Query(None, description="Case-insensitive substring filter on name/description."),
    limit: int = Query(20, ge=1, le=200, description="Max items to return (1-200)."),
    offset: int = Query(0, ge=0, description="Number of items to skip for pagination."),
    loader: ArtifactLoader = Depends(get_singleton),
) -> ItemListOut:
    df = loader.items
    active = df[df["is_active"].astype(bool)]
    if search:
        needle = search.lower()
        mask = active["name"].fillna("").str.lower().str.contains(needle) | \
               active["description"].fillna("").str.lower().str.contains(needle)
        active = active[mask]
    total = int(len(active))
    page = active.iloc[offset : offset + limit]
    return ItemListOut(
        items=[_row_to_item_out(row, loader) for _, row in page.iterrows()],
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
    loader: ArtifactLoader = Depends(get_singleton),
) -> ItemOut:
    row = loader.item_row(int(item_id))
    if row is None:
        raise ItemNotFoundError(
            f"Item id {item_id} not found.",
            extra={"item_id": int(item_id)},
        )
    return _row_to_item_out(row, loader)


def _row_to_item_out(row, loader: ArtifactLoader) -> ItemOut:
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
        user_state=UserState(),
    )