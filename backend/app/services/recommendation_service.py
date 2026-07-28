"""
services/recommendation_service.py — Orchestrator.

Runs eligibility → CBF → CF → hybrid → explanation → top-K and returns a
``RecommendationResponseOut``.
"""
from __future__ import annotations

import uuid
from typing import Dict, List, Optional

from ..core.config import Settings
from ..core.exceptions import ContextNotFoundError, InvalidRequestError
from ..model_loader import ArtifactLoader
from ..schemas.context import ContextOut
from ..schemas.item import ItemOut, UserState
from ..schemas.keyword import KeywordOut
from ..schemas.recommendation import (
    RecommendationRequestIn,
    RecommendationResponseOut,
    RecommendationResultOut,
    ScoresOut,
)
from ..explanations import build_explanation
from .cbf_service import score_items_by_content
from .cf_service import score_items_by_itemknn
from .eligibility import (
    context_name_for_id,
    get_context_valid_items,
)
from .hybrid_service import weighted_sum


def generate_recommendations(
    loader: ArtifactLoader,
    request: RecommendationRequestIn,
    settings: Optional[Settings] = None,
) -> RecommendationResponseOut:
    settings = settings or Settings()

    # 1. Validate context
    ctx_name = context_name_for_id(loader, int(request.context_id))
    if not ctx_name:
        raise ContextNotFoundError(
            f"Context id {request.context_id} is not known.",
            extra={"context_id": request.context_id},
        )

    # 2. Resolve selected keywords (filter unknown ids)
    kw_rows = _resolve_keywords(loader, request.keyword_ids)
    selected_keyword_names = [k["name"] for k in kw_rows]
    selected_keyword_objs = [
        KeywordOut(id=int(k["id"]), name=str(k["name"]), taxonomy_path=str(k.get("taxonomy_path") or ""))
        for k in kw_rows
    ]

    # 3. Eligibility gate
    candidates = get_context_valid_items(
        loader,
        context_id=int(request.context_id),
        selected_keyword_names=selected_keyword_names,
        max_cands=settings.max_cands,
        min_cands=settings.min_cands,
    )
    if not candidates:
        return _empty_response(request, ctx_name, selected_keyword_objs, settings)

    # 4. CBF + CF
    cbf = score_items_by_content(
        loader, candidates, selected_keyword_names, context_name=ctx_name, settings=settings
    )
    cf = score_items_by_itemknn(
        loader, request.user_key or None, candidates, settings=settings
    )
    hybrid = weighted_sum(cbf, cf, settings=settings)

    # 5. Rank by (hybrid, cbf, name) desc, take top_k
    ranked = sorted(
        candidates,
        key=lambda item: (
            hybrid.get(int(item["item_id"]), 0.0),
            cbf.get(int(item["item_id"]), 0.0),
            str(item.get("name") or ""),
        ),
        reverse=True,
    )[: request.top_k]

    # 6. Build result rows
    results: List[RecommendationResultOut] = []
    for rank, item in enumerate(ranked, start=1):
        iid = int(item["item_id"])
        item_keywords = list(item.get("keyword_names") or [])
        matched = [k for k in selected_keyword_names if k in item_keywords]
        explanation = build_explanation(
            item=item,
            context_name=ctx_name,
            selected_keyword_names=selected_keyword_names,
            cbf_score=float(cbf.get(iid, 0.0)),
            cf_score=float(cf.get(iid, 0.0)),
            matched_keywords=matched,
        )
        results.append(
            RecommendationResultOut(
                rank=rank,
                item=_build_item_out(loader, item, iid),
                scores=ScoresOut(
                    cbf=float(cbf.get(iid, 0.0)),
                    cf=float(cf.get(iid, 0.0)),
                    hybrid=float(hybrid.get(iid, 0.0)),
                ),
                is_context_valid=True,
                matched_keywords=matched,
                explanation=explanation,
            )
        )

    return RecommendationResponseOut(
        request_id=str(uuid.uuid4()),
        selected_context=_build_context_out(loader, int(request.context_id), ctx_name),
        selected_keywords=selected_keyword_objs,
        candidate_count=len(candidates),
        top_k=request.top_k,
        method="Hybrid-WeightedSum",
        metadata={
            "cbf_model": "precomputed-E5",
            "cf_model": "ItemKNN",
            "hybrid_alpha": float(settings.hybrid_alpha),
            "cbf_keyword_boost": float(settings.cbf_keyword_boost),
            "itemknn_k": int(settings.itemknn_k),
            "itemknn_shrink": float(settings.itemknn_shrink),
            "user_key_provided": bool(request.user_key),
        },
        results=results,
    )


def _resolve_keywords(loader: ArtifactLoader, keyword_ids: List[int]) -> List[Dict]:
    if not keyword_ids:
        return []
    out: List[Dict] = []
    name_by_id = loader.metadata.get("keyword_id_to_name", {})
    for kid in keyword_ids:
        name = name_by_id.get(str(int(kid)))
        if not name:
            # Best-effort: build mapping by scanning item keywords (slow path).
            name = _lookup_keyword_name(loader, int(kid))
            if name is None:
                continue
        out.append({"id": int(kid), "name": str(name), "taxonomy_path": ""})
    return out


def _lookup_keyword_name(loader: ArtifactLoader, kid: int) -> Optional[str]:
    from ._ids import stable_id
    seen = set()
    for names in loader.items["keyword_names"]:
        for n in (names or []):
            if n in seen:
                continue
            seen.add(n)
            if stable_id("keyword", n) == int(kid):
                loader.metadata.setdefault("keyword_id_to_name", {})[str(int(kid))] = n
                return n
    return None


def _build_context_out(loader: ArtifactLoader, context_id: int, ctx_name: str) -> ContextOut:
    # Count active items with this context
    count = 0
    for names in loader.items["context_names"]:
        if ctx_name in (names or []):
            count += 1
    group = _context_group_for(loader, ctx_name)
    return ContextOut(
        id=int(context_id),
        name=str(ctx_name),
        group=str(group),
        description="",
        active_item_count=int(count),
    )


def _context_group_for(loader: ArtifactLoader, ctx_name: str) -> str:
    # The artifact doesn't store group; we infer it from keyword taxonomy_path prefix
    # if available, else return an empty string. Tests can override via metadata.
    cached = loader.metadata.get("context_groups", {})
    if ctx_name in cached:
        return cached[ctx_name]
    return ""


def _build_item_out(loader: ArtifactLoader, item: Dict, item_id: int) -> ItemOut:
    from ._ids import stable_id
    item_keywords = list(item.get("keyword_names") or [])
    keyword_objs = [
        KeywordOut(
            id=stable_id("keyword", str(n)),
            name=str(n),
            taxonomy_path=str(tp),
        )
        for n, tp in zip(item_keywords, item.get("taxonomy_paths") or [])
        if n
    ]
    item_contexts = list(item.get("context_names") or [])
    context_objs = [
        ContextOut(
            id=stable_id("context", str(c)),
            name=str(c),
            group="",
            description="",
            active_item_count=0,
        )
        for c in item_contexts
        if c
    ]
    return ItemOut(
        id=int(item_id),
        name=str(item.get("name") or ""),
        description=str(item.get("description") or ""),
        category_group=str(item.get("category_group") or ""),
        performance_type=str(item.get("performance_type") or ""),
        performers_count=item.get("performers_count"),
        duration_minutes=item.get("duration_minutes"),
        price_text=str(item.get("price_text") or ""),
        image_url="",
        video_url="",
        keywords=keyword_objs,
        contexts=context_objs,
        user_state=UserState(),
    )


def _empty_response(
    request: RecommendationRequestIn,
    ctx_name: str,
    selected_keyword_objs: List[KeywordOut],
    settings: Settings,
) -> RecommendationResponseOut:
    return RecommendationResponseOut(
        request_id=str(uuid.uuid4()),
        selected_context=ContextOut(
            id=int(request.context_id),
            name=str(ctx_name),
            group="",
            description="",
            active_item_count=0,
        ),
        selected_keywords=selected_keyword_objs,
        candidate_count=0,
        top_k=request.top_k,
        method="Hybrid-WeightedSum",
        metadata={"note": "no candidates in this context"},
        results=[],
    )