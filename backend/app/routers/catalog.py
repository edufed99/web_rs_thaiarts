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

from typing import Any, Optional

import pandas as pd
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select

from ..core.exceptions import ContextNotFoundError, ItemNotFoundError
from ..db import session_scope
from ..model_loader import ArtifactLoader, get_singleton
from ..models_db import Context, Item, ItemContext, ItemKeyword, Keyword, TaxonomyNode, User
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
        "optional `search` substring match against `name`, `description`, "
        "`keyword_names`, and `taxonomy_path`, an optional `context` for the legacy "
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

    db_items = _db_item_rows()
    if db_items is not None:
        active_items = [row for row in db_items if row["is_active"]]
        if context is not None:
            return _ranked_by_context_db(active_items, context, effective_user_key, loader)
        terms = _search_terms(search)
        if terms:
            active_items = [
                row
                for row in active_items
                if _matches_all_terms(
                    terms,
                    [
                        row["name"],
                        row["description"],
                        *(k["name"] for k in row["keywords"]),
                        *(k.get("taxonomy_path") or "" for k in row["keywords"]),
                    ],
                )
            ]
        total = len(active_items)
        page = active_items[offset : offset + limit]
        artifact_ids = [int(row["artifact_item_id"]) for row in page]
        state_map = live_user_state_for_items(effective_user_key, artifact_ids)
        return ItemListOut(
            items=[
                _db_row_to_item_out(row, user_state=state_map.get(int(row["artifact_item_id"])))
                for row in page
            ],
            total=total,
        )

    df = loader.items
    active = df[df["is_active"].astype(bool)]

    # Optional ranked-by-context mode (legacy top-10).
    if context is not None:
        return _ranked_by_context(active, context, effective_user_key, loader)

    # Browse mode: optional substring search + pagination.
    terms = _search_terms(search)
    if terms:
        active = active[
            active.apply(
                lambda row: _matches_all_terms(
                    terms,
                    [
                        row.get("name") or "",
                        row.get("description") or "",
                        *(row.get("keyword_names") or []),
                        *(row.get("taxonomy_paths") or []),
                    ],
                ),
                axis=1,
            )
        ]

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
    db_row = _db_item_row(int(item_id))
    if db_row is not None:
        state_map = live_user_state_for_items(effective_user_key, [int(item_id)])
        return _db_row_to_item_out(db_row, user_state=state_map.get(int(item_id)))

    row = loader.item_row(int(item_id))
    if row is None:
        raise ItemNotFoundError(
            f"Item id {item_id} not found.",
            extra={"item_id": int(item_id)},
        )
    state_map = live_user_state_for_items(effective_user_key, [int(item_id)])
    return _row_to_item_out(row, loader, user_state=state_map.get(int(item_id)))


def _search_terms(search: Optional[str]) -> list[str]:
    if not search:
        return []
    return [term.strip().lower() for term in str(search).split("|") if term.strip()]


def _matches_all_terms(terms: list[str], values: list[Any]) -> bool:
    value_texts = [str(value or "").lower() for value in values]
    return all(any(_matches_term(term, value) for value in value_texts) for term in terms)


def _matches_term(term: str, value: str) -> bool:
    if not term:
        return True
    start = value.find(term)
    while start != -1:
        if _is_acceptable_match_boundary(term, value, start):
            return True
        start = value.find(term, start + 1)
    return False


def _is_acceptable_match_boundary(term: str, value: str, start: int) -> bool:
    end = start + len(term)
    if not _is_thai_text(term):
        return True
    # Keep short Thai keyword search permissive: "โขน" should still match
    # compact titles such as "โขนเรื่อง..." where Thai writing omits spaces.
    if len(term) <= 3:
        return True
    if end >= len(value):
        return True
    return not _is_thai_char(value[end])


def _is_thai_text(value: str) -> bool:
    return any(_is_thai_char(ch) for ch in value)


def _is_thai_char(ch: str) -> bool:
    return "\u0e00" <= ch <= "\u0e7f"


def _db_item_rows() -> Optional[list[dict[str, Any]]]:
    """Return active-capable catalog rows from Postgres, or None on fallback."""
    try:
        with session_scope() as session:
            if session is None:
                return None
            item_rows = session.execute(select(Item).order_by(Item.id)).scalars().all()
            item_ids = [int(item.id) for item in item_rows]
            contexts_by_item = _db_contexts_by_item(session, item_ids)
            keywords_by_item = _db_keywords_by_item(session, item_ids)
    except Exception:  # noqa: BLE001 - catalog must still work in artifact-only mode
        return None

    return [
        _db_item_to_row(
            item,
            contexts=contexts_by_item.get(int(item.id), []),
            keywords=keywords_by_item.get(int(item.id), []),
        )
        for item in item_rows
    ]


def _db_item_row(artifact_item_id: int) -> Optional[dict[str, Any]]:
    try:
        with session_scope() as session:
            if session is None:
                return None
            item = session.execute(
                select(Item).where(Item.artifact_item_id == int(artifact_item_id))
            ).scalar_one_or_none()
            if item is None:
                return None
            contexts = _db_contexts_by_item(session, [int(item.id)]).get(int(item.id), [])
            keywords = _db_keywords_by_item(session, [int(item.id)]).get(int(item.id), [])
    except Exception:  # noqa: BLE001 - fall back to artifacts
        return None

    return _db_item_to_row(item, contexts=contexts, keywords=keywords)


def _db_item_to_row(
    item: Item,
    *,
    contexts: list[dict[str, Any]],
    keywords: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "artifact_item_id": int(item.artifact_item_id),
        "name": str(item.name or ""),
        "description": str(item.description or ""),
        "category_group": str(item.category_group or ""),
        "performance_type": str(item.performance_type or ""),
        "performers_count": item.performers_count,
        "duration_minutes": item.duration_minutes,
        "price_text": str(item.price_text or ""),
        "image_url": str(item.image_url or ""),
        "video_url": str(item.video_url or ""),
        "is_active": bool(item.is_active),
        "contexts": contexts,
        "keywords": keywords,
    }


def _db_contexts_by_item(session, item_ids: list[int]) -> dict[int, list[dict[str, Any]]]:
    if not item_ids:
        return {}
    counts = dict(
        session.execute(
            select(ItemContext.context_id, func.count(ItemContext.item_id))
            .join(Item, Item.id == ItemContext.item_id)
            .where(Item.is_active.is_(True))
            .group_by(ItemContext.context_id)
        ).all()
    )
    rows = session.execute(
        select(
            ItemContext.item_id,
            Context.name,
            Context.group_name,
            Context.description,
            Context.id,
        )
        .join(Context, Context.id == ItemContext.context_id)
        .where(ItemContext.item_id.in_(item_ids))
        .order_by(Context.group_name, Context.name)
    ).all()
    out: dict[int, list[dict[str, Any]]] = {}
    for item_id, name, group_name, description, context_pk in rows:
        out.setdefault(int(item_id), []).append(
            {
                "id": stable_id("context", str(name)),
                "db_id": int(context_pk),
                "name": str(name or ""),
                "group": str(group_name or ""),
                "description": str(description or ""),
                "active_item_count": int(counts.get(context_pk, 0)),
            }
        )
    return out


def _db_keywords_by_item(session, item_ids: list[int]) -> dict[int, list[dict[str, Any]]]:
    if not item_ids:
        return {}
    taxonomy_paths = _taxonomy_paths_by_id(session)
    rows = session.execute(
        select(
            ItemKeyword.item_id,
            Keyword.id,
            Keyword.name,
            Keyword.taxonomy_node_id,
        )
        .join(Keyword, Keyword.id == ItemKeyword.keyword_id)
        .where(ItemKeyword.item_id.in_(item_ids))
        .order_by(Keyword.name)
    ).all()
    out: dict[int, list[dict[str, Any]]] = {}
    for item_id, keyword_id, name, taxonomy_node_id in rows:
        out.setdefault(int(item_id), []).append(
            {
                "id": int(keyword_id),
                "name": str(name or ""),
                "taxonomy_path": taxonomy_paths.get(int(taxonomy_node_id), "") if taxonomy_node_id else "",
            }
        )
    return out


def _taxonomy_paths_by_id(session) -> dict[int, str]:
    nodes = {
        int(node_id): {"name": str(name or ""), "parent_id": int(parent_id) if parent_id else None}
        for node_id, name, parent_id in session.execute(
            select(TaxonomyNode.id, TaxonomyNode.name, TaxonomyNode.parent_id)
        ).all()
    }
    cache: dict[int, str] = {}

    def path_for(node_id: int) -> str:
        if node_id in cache:
            return cache[node_id]
        node = nodes.get(int(node_id))
        if not node:
            return ""
        parent_id = node["parent_id"]
        parent_path = path_for(parent_id) if parent_id else ""
        path = f"{parent_path} > {node['name']}" if parent_path else node["name"]
        cache[node_id] = path
        return path

    return {node_id: path_for(node_id) for node_id in nodes}


def _db_row_to_item_out(row: dict[str, Any], user_state: Optional[UserState] = None) -> ItemOut:
    kw_names = [str(k["name"]) for k in row["keywords"] if k.get("name")]
    ctx_names = [str(c["name"]) for c in row["contexts"] if c.get("name")]
    mp = catalog_match_percent(
        keyword_count=len(kw_names),
        context_count=len(ctx_names),
        description_length=len(str(row.get("description") or "")),
    )
    return ItemOut(
        id=int(row["artifact_item_id"]),
        name=str(row.get("name") or ""),
        description=str(row.get("description") or ""),
        category_group=str(row.get("category_group") or ""),
        performance_type=str(row.get("performance_type") or ""),
        performers_count=row.get("performers_count"),
        duration_minutes=row.get("duration_minutes"),
        price_text=str(row.get("price_text") or ""),
        image_url=str(row.get("image_url") or ""),
        video_url=str(row.get("video_url") or ""),
        keywords=[KeywordOut(**k) for k in row["keywords"] if k.get("name")],
        contexts=[
            ContextOut(
                id=int(c["id"]),
                name=str(c["name"]),
                group=str(c.get("group", "") or ""),
                description=str(c.get("description", "") or ""),
                active_item_count=int(c.get("active_item_count", 0)),
            )
            for c in row["contexts"]
            if c.get("name")
        ],
        user_state=user_state or UserState(),
        match_percent=mp,
        suitability_label=suitability_label(mp),
    )


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
    # Loader rows may carry pandas NaN for missing numeric fields — coerce
    # those to ``None`` so Pydantic v2.12's strict ``finite_number`` check
    # accepts them.
    def _clean_int(value):
        if value is None:
            return None
        try:
            if value != value:  # NaN guard (covers float('nan'), numpy.nan, pandas.NA-like)
                return None
        except TypeError:
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    return ItemOut(
        id=iid,
        name=str(row.get("name") or ""),
        description=str(row.get("description") or ""),
        category_group=str(row.get("category_group") or ""),
        performance_type=str(row.get("performance_type") or ""),
        performers_count=_clean_int(row.get("performers_count")),
        duration_minutes=_clean_int(row.get("duration_minutes")),
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


def _ranked_by_context_db(
    rows: list[dict[str, Any]],
    context_id: int,
    user_key: Optional[str],
    loader: ArtifactLoader,
) -> ItemListOut:
    ctx_name = context_name_for_id(loader, int(context_id))
    if not ctx_name:
        raise ContextNotFoundError(
            f"Context id {context_id} is not known.",
            extra={"context_id": context_id},
        )
    eligible = [
        row
        for row in rows
        if any(str(c.get("name") or "") == ctx_name for c in row["contexts"])
    ]
    scored = []
    for row in eligible:
        mp = catalog_match_percent(
            keyword_count=len(row["keywords"]),
            context_count=len(row["contexts"]),
            description_length=len(str(row.get("description") or "")),
        )
        scored.append((mp, str(row.get("name") or ""), row))
    scored.sort(key=lambda t: (-t[0], t[1]))
    top = scored[:RANKED_MODE_LIMIT]
    artifact_ids = [int(r["artifact_item_id"]) for _, _, r in top]
    state_map = live_user_state_for_items(user_key or "", artifact_ids)
    return ItemListOut(
        items=[
            _db_row_to_item_out(row, user_state=state_map.get(int(row["artifact_item_id"])))
            for _, _, row in top
        ],
        total=len(top),
    )
