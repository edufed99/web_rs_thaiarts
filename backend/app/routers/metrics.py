"""
routers/metrics.py — GET /contexts, GET /keywords, GET /metrics.

Auxiliary read-only endpoints that drive the frontend picker UIs and the
researcher dashboard.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select

from ..db import session_scope
from ..model_loader import ArtifactLoader, get_singleton
from ..models_db import Context, Item, ItemContext, Keyword, TaxonomyNode
from ..schemas.context import ContextListOut, ContextOut
from ..schemas.keyword import KeywordListOut, KeywordOut
from ..schemas.metrics import MetricsOut
from ..services._ids import stable_id
from ..services.eligibility import build_context_id_map


router = APIRouter(tags=["metrics"])


@router.get(
    "/contexts",
    response_model=ContextListOut,
    summary="List filterable contexts",
    description=(
        "Returns all sub-contexts grouped by their main context. `active_item_count` "
        "reflects how many active items belong to each."
    ),
)
def list_contexts(
    loader: ArtifactLoader = Depends(get_singleton),
) -> ContextListOut:
    id_to_name = build_context_id_map(loader)
    context_meta = _context_metadata_by_name()
    db_counts = _db_context_counts_by_name()
    # Count active items per context
    counts: dict = {}
    if db_counts is not None:
        counts = db_counts
    else:
        for names in loader.items["context_names"]:
            if not names:
                continue
            for n in names:
                counts[n] = counts.get(n, 0) + 1
    out: List[ContextOut] = []
    for cid, name in sorted(id_to_name.items(), key=lambda kv: (kv[1], kv[0])):
        meta = context_meta.get(str(name), {})
        out.append(
            ContextOut(
                id=int(cid),
                name=str(name),
                group=str(meta.get("group", "") or ""),
                description=str(meta.get("description", "") or ""),
                active_item_count=int(counts.get(name, 0)),
            )
        )
    return ContextListOut(contexts=out)


def _context_metadata_by_name() -> dict[str, dict[str, str]]:
    """Read main-context groups from Postgres when available.

    Artifact context ids are stable hash ids used by the recommendation API,
    while the live ``contexts`` table stores the legacy DB ids plus
    ``group_name``. We join the two spaces by context display name.
    """
    try:
        with session_scope() as session:
            if session is None:
                return {}
            rows = session.query(Context.name, Context.group_name, Context.description).all()
    except Exception:  # noqa: BLE001 - /contexts should still work without DB
        return {}

    return {
        str(name): {
            "group": str(group_name or ""),
            "description": str(description or ""),
        }
        for name, group_name, description in rows
    }


def _db_context_counts_by_name() -> Optional[dict[str, int]]:
    try:
        with session_scope() as session:
            if session is None:
                return None
            rows = session.execute(
                select(Context.name, func.count(ItemContext.item_id))
                .join(ItemContext, ItemContext.context_id == Context.id)
                .join(Item, Item.id == ItemContext.item_id)
                .where(Item.is_active.is_(True))
                .group_by(Context.name)
            ).all()
    except Exception:  # noqa: BLE001 - fall back to artifact counts
        return None
    return {str(name): int(count) for name, count in rows}


@router.get(
    "/keywords",
    response_model=KeywordListOut,
    summary="List keywords",
    description=(
        "Returns all keywords found across the catalog. Optional `search` does a "
        "case-insensitive substring match on the keyword name."
    ),
)
def list_keywords(
    search: Optional[str] = Query(None, description="Substring filter on keyword name."),
    limit: int = Query(200, ge=1, le=1000),
    loader: ArtifactLoader = Depends(get_singleton),
) -> KeywordListOut:
    db_keywords = _db_keywords(search=search, limit=limit)
    if db_keywords is not None:
        return KeywordListOut(keywords=db_keywords)

    seen = set()
    rows = []
    paths_by_name = {}
    for idx, names in enumerate(loader.items["keyword_names"]):
        paths = loader.items["taxonomy_paths"].iloc[idx] if "taxonomy_paths" in loader.items.columns else []
        for j, n in enumerate(names or []):
            if not n or n in seen:
                continue
            seen.add(n)
            tp = paths[j] if j < len(paths) else ""
            paths_by_name[n] = tp
    for name in sorted(seen):
        if search and search.lower() not in name.lower():
            continue
        rows.append(
            KeywordOut(
                id=stable_id("keyword", name),
                name=name,
                taxonomy_path=str(paths_by_name.get(name, "") or ""),
            )
        )
        if len(rows) >= limit:
            break
    return KeywordListOut(keywords=rows)


@router.get(
    "/metrics",
    response_model=MetricsOut,
    summary="Artifact + corpus metrics",
    description=(
        "Returns aggregated counts from the loaded artifacts plus the build "
        "timestamp and config hash. Useful for the researcher dashboard."
    ),
)
def metrics(
    loader: ArtifactLoader = Depends(get_singleton),
) -> MetricsOut:
    md = loader.metadata or {}
    db_counts = _db_metric_counts()
    return MetricsOut(
        item_count=int(db_counts.get("item_count") if db_counts else md.get("item_count", len(loader.item_ids))),
        context_count=int(db_counts.get("context_count") if db_counts else md.get("context_count", 0)),
        keyword_count=int(db_counts.get("keyword_count") if db_counts else _count_unique_keywords(loader)),
        positive_user_count=int(md.get("positive_user_count", 0)),
        unique_item_user_edges=int(md.get("unique_item_user_edges", 0)),
        embedding_dim=int(md.get("embedding_dim", 0)),
        artifacts_loaded_at=str(loader.loaded_at or ""),
        config_hash=str(md.get("config_hash", "")),
    )


def _db_keywords(search: Optional[str], limit: int) -> Optional[list[KeywordOut]]:
    try:
        with session_scope() as session:
            if session is None:
                return None
            taxonomy_paths = _taxonomy_paths_by_id(session)
            stmt = select(Keyword.id, Keyword.name, Keyword.taxonomy_node_id).order_by(Keyword.name)
            rows = session.execute(stmt).all()
    except Exception:  # noqa: BLE001 - fall back to artifact keywords
        return None

    out: list[KeywordOut] = []
    needle = search.lower() if search else ""
    for keyword_id, name, taxonomy_node_id in rows:
        name_text = str(name or "")
        if needle and needle not in name_text.lower():
            continue
        out.append(
            KeywordOut(
                id=int(keyword_id),
                name=name_text,
                taxonomy_path=taxonomy_paths.get(int(taxonomy_node_id), "") if taxonomy_node_id else "",
            )
        )
        if len(out) >= limit:
            break
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


def _db_metric_counts() -> Optional[dict[str, int]]:
    try:
        with session_scope() as session:
            if session is None:
                return None
            return {
                "item_count": int(session.execute(select(func.count()).select_from(Item).where(Item.is_active.is_(True))).scalar_one()),
                "context_count": int(session.execute(select(func.count()).select_from(Context)).scalar_one()),
                "keyword_count": int(session.execute(select(func.count()).select_from(Keyword)).scalar_one()),
            }
    except Exception:  # noqa: BLE001 - metrics should still work without DB
        return None


def _count_unique_keywords(loader: ArtifactLoader) -> int:
    seen = set()
    for names in loader.items["keyword_names"]:
        for n in (names or []):
            if n:
                seen.add(n)
    return len(seen)
