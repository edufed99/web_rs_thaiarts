"""
services/recommendation_service.py — Orchestrator.

Runs eligibility → CBF → CF → hybrid → negative penalty → explanation →
top-K and returns a ``RecommendationResponseOut``.

Per-user live state (``likes`` / ``saved_items`` / ``ratings``) is read
once and applied to both the scoring pipeline (negative penalty,
``hybrid_service.apply_negative_penalty``) and the response payload
(``UserState`` on each result item).
"""
from __future__ import annotations

import uuid
from collections import Counter
from typing import Dict, List, Optional

from sqlalchemy import select

from ..core.config import Settings, settings_with_artifact_config
from ..core.exceptions import ContextNotFoundError, InvalidRequestError
from ..db import is_db_enabled, session_scope
from ..model_loader import ArtifactLoader
from ..models_db import Keyword, TaxonomyNode, User
from ..schemas.context import ContextOut
from ..schemas.item import ItemOut, UserState
from ..schemas.keyword import KeywordOut
from ..schemas.recommendation import (
    RecommendationRequestIn,
    RecommendationResponseOut,
    RecommendationResultOut,
    ProfileRecommendationResponseOut,
    ScoresOut,
)
from ..explanations import build_explanation
from .cbf_service import score_items_by_content
from .cf_service import score_items_by_itemknn
from .db_query import (
    live_user_positive_items,
    live_user_negative_ratings,
    live_user_state_for_items,
)
from .eligibility import (
    context_name_for_id,
    get_context_valid_items,
)
from .hybrid_service import apply_negative_penalty, weighted_sum
from .suitability import catalog_match_percent, suitability_label


def generate_profile_recommendations(
    loader: ArtifactLoader,
    user: User,
    top_k: int = 10,
    settings: Optional[Settings] = None,
) -> ProfileRecommendationResponseOut:
    """Recommend items from the authenticated user's past behavior only.

    This powers the "คาดว่าคุณจะชอบจากพฤติกรรมในอดีต" section before the
    user selects a context. Imported legacy users have static CF keys such
    as ``user:บุคคล2`` while JWT users resolve to ``user:<id>`` for new
    live actions, so we pick the richest available profile key.
    """
    settings = _effective_settings(loader, settings)
    top_k = max(1, min(50, int(top_k)))
    profile_key, history_count = _best_profile_key(loader, user)
    current_user_key = f"user:{int(user.id)}"

    if history_count == 0:
        return ProfileRecommendationResponseOut(
            request_id=str(uuid.uuid4()),
            top_k=top_k,
            history_count=0,
            metadata={
                "profile_key": profile_key,
                "note": "no positive history for this user",
                "history_summary": _profile_history_summary(loader, set()),
            },
            results=[],
        )

    active_items = [
        row.to_dict()
        for _, row in loader.items.iterrows()
        if bool(row.get("is_active", True))
    ]
    scores = score_items_by_itemknn(loader, profile_key, active_items, settings=settings)
    history_ids = set(loader.cf_user_item.get(profile_key, [])) | live_user_positive_items(profile_key)
    history_summary = _profile_history_summary(loader, history_ids)

    ranked = sorted(
        active_items,
        key=lambda item: (
            float(scores.get(int(item["item_id"]), 0.0)),
            str(item.get("name") or ""),
        ),
        reverse=True,
    )
    ranked = [
        item
        for item in ranked
        if int(item["item_id"]) not in history_ids
        and float(scores.get(int(item["item_id"]), 0.0)) > 0
    ][:top_k]

    ranked_ids = [int(item["item_id"]) for item in ranked]
    state_map = live_user_state_for_items(current_user_key, ranked_ids)

    results: List[RecommendationResultOut] = []
    for rank, item in enumerate(ranked, start=1):
        iid = int(item["item_id"])
        item_keywords = list(item.get("keyword_names") or [])
        item_contexts = list(item.get("context_names") or [])
        mp = catalog_match_percent(
            keyword_count=len(item_keywords),
            context_count=len(item_contexts),
            description_length=len(str(item.get("description") or "")),
            rating_average=0.66,
        )
        results.append(
            RecommendationResultOut(
                rank=rank,
                item=_build_item_out(loader, item, iid, user_state=state_map.get(iid)),
                scores=ScoresOut(
                    cbf=0.0,
                    cf=float(scores.get(iid, 0.0)),
                    hybrid=float(scores.get(iid, 0.0)),
                ),
                is_context_valid=True,
                matched_keywords=[],
                explanation=_profile_card_explanation(item, history_summary),
                match_percent=mp,
                suitability_label=suitability_label(mp),
            )
        )

    return ProfileRecommendationResponseOut(
        request_id=str(uuid.uuid4()),
        top_k=top_k,
        history_count=history_count,
            metadata={
                "profile_key": profile_key,
                "current_user_key": current_user_key,
                "candidate_count": len(active_items),
                "history_summary": history_summary,
            },
            results=results,
        )


def _profile_history_summary(loader: ArtifactLoader, history_ids: set[int]) -> Dict:
    """Summarise what the user previously liked, grounded in history items."""
    if not history_ids:
        return {
            "history_item_names": [],
            "top_contexts": [],
            "top_keywords": [],
            "top_performance_types": [],
            "sentence": "ยังไม่มีประวัติความชอบมากพอให้สรุปรูปแบบเดิม",
        }

    item_names: List[str] = []
    context_counter: Counter[str] = Counter()
    keyword_counter: Counter[str] = Counter()
    type_counter: Counter[str] = Counter()

    for _, row in loader.items.iterrows():
        iid = int(row.get("item_id"))
        if iid not in history_ids:
            continue
        name = str(row.get("name") or "").strip()
        if name:
            item_names.append(name)
        for context_name in list(row.get("context_names") or []):
            if context_name:
                context_counter[str(context_name)] += 1
        for keyword_name in list(row.get("keyword_names") or []):
            if keyword_name:
                keyword_counter[str(keyword_name)] += 1
        performance_type = str(row.get("performance_type") or "").strip()
        category_group = str(row.get("category_group") or "").strip()
        if performance_type:
            type_counter[performance_type] += 1
        elif category_group:
            type_counter[category_group] += 1

    top_contexts = [name for name, _ in context_counter.most_common(3)]
    top_keywords = [name for name, _ in keyword_counter.most_common(4)]
    top_types = [name for name, _ in type_counter.most_common(3)]
    item_examples = item_names[:3]

    parts: List[str] = []
    if item_examples:
        parts.append(f"คุณเคยสนใจรายการ เช่น {', '.join(item_examples)}")
    if top_types:
        parts.append(f"โดยมักเป็นกลุ่ม {', '.join(top_types)}")
    if top_contexts:
        parts.append(f"ในบริบท {', '.join(top_contexts)}")
    if top_keywords:
        parts.append(f"มีคุณลักษณะเด่น เช่น {', '.join(top_keywords)}")

    return {
        "history_item_names": item_names,
        "top_contexts": top_contexts,
        "top_keywords": top_keywords,
        "top_performance_types": top_types,
        "sentence": " ".join(parts) if parts else "ยังไม่มีประวัติความชอบมากพอให้สรุปรูปแบบเดิม",
    }


def _profile_card_explanation(item: Dict, history_summary: Dict) -> str:
    """Build a short card-level reason from a user's historical interests."""
    history_items = [str(name) for name in history_summary.get("history_item_names", []) if name]
    top_contexts = [str(name) for name in history_summary.get("top_contexts", []) if name]
    top_keywords = [str(name) for name in history_summary.get("top_keywords", []) if name]
    top_types = [str(name) for name in history_summary.get("top_performance_types", []) if name]

    item_contexts = {str(name) for name in list(item.get("context_names") or []) if name}
    item_keywords = {str(name) for name in list(item.get("keyword_names") or []) if name}
    item_type = str(item.get("performance_type") or item.get("category_group") or "").strip()

    context_overlap = [name for name in top_contexts if name in item_contexts][:1]
    keyword_overlap = [name for name in top_keywords if name in item_keywords][:2]
    type_overlap = [name for name in top_types if name and name == item_type][:1]

    if history_items:
        reason = f"แนะนำเพราะในอดีตคุณเคยชอบ {history_items[0]}"
    else:
        reason = "แนะนำจากรายการที่คุณเคยถูกใจหรือให้คะแนนสูง"

    if keyword_overlap:
        return f"{reason} และรายการนี้มีคุณลักษณะใกล้เคียง เช่น {', '.join(keyword_overlap)}"
    if context_overlap:
        return f"{reason} ในบริบทใกล้เคียง เช่น {context_overlap[0]}"
    if type_overlap:
        return f"{reason} ซึ่งอยู่ในกลุ่มการแสดงคล้ายกัน"
    return f"{reason} แล้วพบว่ามีรูปแบบผู้ใช้ใกล้เคียงกัน"


def _best_profile_key(loader: ArtifactLoader, user: User) -> tuple[str, int]:
    keys = [f"user:{int(user.id)}"]
    if user.username:
        keys.append(f"user:{user.username}")
    display = str(user.display_name or "")
    marker = "legacy:"
    if marker in display:
        legacy_name = display.split(marker, 1)[1].strip()
        if legacy_name:
            keys.append(f"user:{legacy_name}")

    seen = set()
    best_key = keys[0]
    best_count = -1
    for key in keys:
        if key in seen:
            continue
        seen.add(key)
        count = len(set(loader.cf_user_item.get(key, [])) | live_user_positive_items(key))
        if count > best_count:
            best_key = key
            best_count = count
    return best_key, max(best_count, 0)


def generate_recommendations(
    loader: ArtifactLoader,
    request: RecommendationRequestIn,
    settings: Optional[Settings] = None,
) -> RecommendationResponseOut:
    settings = _effective_settings(loader, settings)

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

    # 4b. Negative-rating penalty: items the user rated below the positive
    #     threshold (live DB only — mirrors legacy services.apply_negative_penalty).
    negative_ratings: Dict[int, int] = {}
    if request.user_key:
        negative_ratings = live_user_negative_ratings(
            request.user_key, max_rating=settings.positive_threshold
        )
    if negative_ratings:
        hybrid = apply_negative_penalty(
            hybrid, negative_ratings, alpha=settings.negative_penalty_alpha
        )

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

    # 6. Bulk-fetch per-item user state for the top-K so the response carries
    #    liked/saved/rating flags without N extra queries.
    ranked_ids: List[int] = [int(item["item_id"]) for item in ranked]
    state_map: Dict[int, UserState] = live_user_state_for_items(
        request.user_key or "", ranked_ids
    )

    # 7. Build result rows
    results: List[RecommendationResultOut] = []
    for rank, item in enumerate(ranked, start=1):
        iid = int(item["item_id"])
        item_keywords = list(item.get("keyword_names") or [])
        item_contexts = list(item.get("context_names") or [])
        matched = [k for k in selected_keyword_names if k in item_keywords]
        explanation = build_explanation(
            item=item,
            context_name=ctx_name,
            selected_keyword_names=selected_keyword_names,
            cbf_score=float(cbf.get(iid, 0.0)),
            cf_score=float(cf.get(iid, 0.0)),
            matched_keywords=matched,
        )
        # Display-only suitability hint. Mirrors the legacy
        # catalog_match_percent heuristic (see services/suitability.py).
        # rating_average is not precomputed for the new app — we use the
        # legacy default of 0.66 so the formula matches ``/items?context=``
        # ordering downstream.
        mp = catalog_match_percent(
            keyword_count=len(item_keywords),
            context_count=len(item_contexts),
            description_length=len(str(item.get("description") or "")),
            rating_average=0.66,
        )
        results.append(
            RecommendationResultOut(
                rank=rank,
                item=_build_item_out(loader, item, iid, user_state=state_map.get(iid)),
                scores=ScoresOut(
                    cbf=float(cbf.get(iid, 0.0)),
                    cf=float(cf.get(iid, 0.0)),
                    hybrid=float(hybrid.get(iid, 0.0)),
                ),
                is_context_valid=True,
                matched_keywords=matched,
                explanation=explanation,
                match_percent=mp,
                suitability_label=suitability_label(mp),
            )
        )

    return RecommendationResponseOut(
        request_id=str(uuid.uuid4()),
        selected_context=_build_context_out(loader, int(request.context_id), ctx_name),
        selected_keywords=selected_keyword_objs,
        candidate_count=len(candidates),
        top_k=request.top_k,
        method=settings.recommendation_method,
        metadata={
            "cbf_model": str(settings.e5_model_name),
            "cf_model": "ItemKNN",
            "hybrid_alpha": float(settings.hybrid_alpha),
            "cbf_keyword_boost": float(settings.cbf_keyword_boost),
            "itemknn_k": int(settings.itemknn_k),
            "itemknn_shrink": float(settings.itemknn_shrink),
            "max_cands": settings.max_cands,
            "best_model_config_loaded": bool(loader.best_model_config),
            "negative_penalty_alpha": float(settings.negative_penalty_alpha),
            "user_key_provided": bool(request.user_key),
            "db_enabled": bool(is_db_enabled()),
            "user_state_resolved": bool(request.user_key and is_db_enabled()),
            "negative_ratings_applied": bool(negative_ratings),
        },
        results=results,
    )


def _effective_settings(loader: ArtifactLoader, settings: Optional[Settings]) -> Settings:
    return settings_with_artifact_config(settings or Settings(), loader.best_model_config)


def _resolve_keywords(loader: ArtifactLoader, keyword_ids: List[int]) -> List[Dict]:
    if not keyword_ids:
        return []
    out: List[Dict] = []
    name_by_id = loader.metadata.get("keyword_id_to_name", {})
    seen_ids = set()
    for kid in keyword_ids:
        kid_int = int(kid)
        if kid_int in seen_ids:
            continue
        seen_ids.add(kid_int)

        name = name_by_id.get(str(kid_int))
        if name:
            out.append({
                "id": kid_int,
                "name": str(name),
                "taxonomy_path": _taxonomy_path_for_keyword(loader, str(name)),
            })
            continue

        # The frontend may receive ids from the live DB (/keywords prefers
        # Postgres when available), while artifacts use stable hash ids.
        # Accept both id spaces so selected keywords survive the recommend
        # request and can still drive CBF scoring.
        db_keyword = _lookup_db_keyword(kid_int)
        if db_keyword is not None:
            out.append(db_keyword)
            continue

        # Best-effort: build mapping by scanning artifact keywords (slow path).
        artifact_keyword = _lookup_artifact_keyword(loader, kid_int)
        if artifact_keyword is not None:
            out.append(artifact_keyword)
    return out


def _lookup_artifact_keyword(loader: ArtifactLoader, kid: int) -> Optional[Dict]:
    from ._ids import stable_id
    seen = set()
    for idx, names in enumerate(loader.items["keyword_names"]):
        paths = loader.items["taxonomy_paths"].iloc[idx] if "taxonomy_paths" in loader.items.columns else []
        for j, n in enumerate(names or []):
            if n in seen:
                continue
            seen.add(n)
            if stable_id("keyword", n) == int(kid):
                return {
                    "id": int(kid),
                    "name": str(n),
                    "taxonomy_path": str(paths[j]) if j < len(paths) else "",
                }
    return None


def _lookup_db_keyword(kid: int) -> Optional[Dict]:
    try:
        with session_scope() as session:
            if session is None:
                return None
            row = session.execute(
                select(Keyword.id, Keyword.name, Keyword.taxonomy_node_id).where(
                    Keyword.id == int(kid)
                )
            ).one_or_none()
            if row is None:
                return None
            keyword_id, name, taxonomy_node_id = row
            taxonomy_path = ""
            if taxonomy_node_id:
                taxonomy_path = _db_taxonomy_path(session, int(taxonomy_node_id))
            return {
                "id": int(keyword_id),
                "name": str(name or ""),
                "taxonomy_path": taxonomy_path,
            }
    except Exception:  # noqa: BLE001 - artifact-only serving must keep working
        return None


def _db_taxonomy_path(session, node_id: int) -> str:
    nodes = {
        int(row_id): {
            "name": str(name or ""),
            "parent_id": int(parent_id) if parent_id else None,
        }
        for row_id, name, parent_id in session.execute(
            select(TaxonomyNode.id, TaxonomyNode.name, TaxonomyNode.parent_id)
        ).all()
    }
    parts: List[str] = []
    current: Optional[int] = int(node_id)
    while current:
        node = nodes.get(current)
        if not node:
            break
        if node["name"]:
            parts.append(str(node["name"]))
        current = node["parent_id"]
    return " > ".join(reversed(parts))


def _taxonomy_path_for_keyword(loader: ArtifactLoader, keyword_name: str) -> str:
    for idx, names in enumerate(loader.items["keyword_names"]):
        paths = loader.items["taxonomy_paths"].iloc[idx] if "taxonomy_paths" in loader.items.columns else []
        for j, name in enumerate(names or []):
            if str(name) == str(keyword_name):
                return str(paths[j]) if j < len(paths) else ""
    return ""


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


def _build_item_out(
    loader: ArtifactLoader,
    item: Dict,
    item_id: int,
    user_state: Optional[UserState] = None,
) -> ItemOut:
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
        image_url=str(item.get("image_url") or ""),
        video_url="",
        keywords=keyword_objs,
        contexts=context_objs,
        user_state=user_state or UserState(),
    )


def _empty_response(
    request: RecommendationRequestIn,
    ctx_name: str,
    selected_keyword_objs: List[KeywordOut],
    settings: Optional[Settings],
) -> RecommendationResponseOut:
    settings = settings or Settings()
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
        method=settings.recommendation_method,
        metadata={"note": "no candidates in this context"},
        results=[],
    )
