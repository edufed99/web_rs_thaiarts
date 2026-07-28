"""
routers/metrics.py — GET /contexts, GET /keywords, GET /metrics.

Auxiliary read-only endpoints that drive the frontend picker UIs and the
researcher dashboard.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, Query

from ..core.config import get_settings
from ..model_loader import ArtifactLoader, get_singleton
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
    # Count active items per context
    counts: dict = {}
    for names in loader.items["context_names"]:
        if not names:
            continue
        for n in names:
            counts[n] = counts.get(n, 0) + 1
    out: List[ContextOut] = []
    for cid, name in sorted(id_to_name.items(), key=lambda kv: (kv[1], kv[0])):
        out.append(
            ContextOut(
                id=int(cid),
                name=str(name),
                group="",
                description="",
                active_item_count=int(counts.get(name, 0)),
            )
        )
    return ContextListOut(contexts=out)


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
    return MetricsOut(
        item_count=int(md.get("item_count", len(loader.item_ids))),
        context_count=int(md.get("context_count", 0)),
        keyword_count=_count_unique_keywords(loader),
        positive_user_count=int(md.get("positive_user_count", 0)),
        unique_item_user_edges=int(md.get("unique_item_user_edges", 0)),
        embedding_dim=int(md.get("embedding_dim", 0)),
        artifacts_loaded_at=str(loader.loaded_at or ""),
        config_hash=str(md.get("config_hash", "")),
    )


def _count_unique_keywords(loader: ArtifactLoader) -> int:
    seen = set()
    for names in loader.items["keyword_names"]:
        for n in (names or []):
            if n:
                seen.add(n)
    return len(seen)