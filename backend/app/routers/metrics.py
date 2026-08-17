"""
routers/metrics.py — GET /contexts, GET /keywords, GET /metrics,
GET /metrics/requests, GET /metrics/config, GET /metrics/dashboard.

Auxiliary read-only endpoints that drive the frontend picker UIs, the
researcher dashboard, and the new admin dashboard (Phase 3).
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import func, select

from ..core.config import get_settings, settings_with_artifact_config
from ..db import session_scope
from ..model_loader import ArtifactLoader, get_singleton
from ..models_db import (
    Context,
    Item,
    ItemContext,
    Keyword,
    RecommendationRequest,
    RecommendationResult,
    User,
)
from ..schemas.context import ContextListOut, ContextOut
from ..schemas.analytics import AnalyticsOut
from ..schemas.dashboard import DashboardOut
from ..schemas.keyword import KeywordListOut, KeywordOut
from ..schemas.metrics import (
    MetricsOut,
    ModelConfigOut,
    ReproducibilityCount,
    ReproducibilityOut,
    RequestTrendBucket,
    RequestTrendOut,
)
from ..schemas.popularity import (
    PopularityOut,
    PopularityRowOut,
    PopularityWeightsOut,
    PopularityWeightsUpdateIn,
)
from ..services._ids import stable_id
from ..services.auth import get_current_admin
from ..services.catalogue import _taxonomy_paths_by_id
from ..services.analytics_service import build_analytics_payload
from ..services.dashboard_query import build_dashboard_payload
from ..services.dashboard_export import build_dashboard_report
from ..services.popularity import (
    WeightsValidationError,
    active_weights,
    compute_popularity_scores,
    list_weights,
    set_weights,
)
from ..services.eligibility import build_context_id_map, context_name_for_id


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
    context_id: Optional[int] = Query(
        None,
        description="When provided, only return keywords attached to items in this context.",
    ),
    loader: ArtifactLoader = Depends(get_singleton),
) -> KeywordListOut:
    artifact_paths_by_name = _artifact_keyword_paths_by_name(loader)
    if context_id is not None:
        return KeywordListOut(
            keywords=_artifact_keywords(
                loader=loader,
                search=search,
                limit=limit,
                paths_by_name=artifact_paths_by_name,
                context_id=context_id,
            )
        )

    db_keywords = _db_keywords(
        search=search,
        limit=limit,
        artifact_paths_by_name=artifact_paths_by_name,
    )
    if db_keywords is not None:
        return KeywordListOut(keywords=db_keywords)

    return KeywordListOut(
        keywords=_artifact_keywords(
            loader=loader,
            search=search,
            limit=limit,
            paths_by_name=artifact_paths_by_name,
        )
    )


def _artifact_keywords(
    loader: ArtifactLoader,
    search: Optional[str],
    limit: int,
    paths_by_name: dict[str, str],
    context_id: Optional[int] = None,
) -> list[KeywordOut]:
    context_name = context_name_for_id(loader, int(context_id)) if context_id is not None else None
    if context_id is not None and not context_name:
        return []

    seen: set[str] = set()
    rows: list[KeywordOut] = []
    for _, item in loader.items.iterrows():
        context_names = list(item.get("context_names") or [])
        if context_name and context_name not in context_names:
            continue
        for n in list(item.get("keyword_names") or []):
            name = str(n or "").strip()
            if not name or name in seen:
                continue
            seen.add(name)
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
    return rows


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


def _artifact_keyword_paths_by_name(loader: ArtifactLoader) -> dict[str, str]:
    paths_by_name: dict[str, str] = {}
    if "keyword_names" not in loader.items.columns:
        return paths_by_name

    has_taxonomy_paths = "taxonomy_paths" in loader.items.columns
    for idx, names in enumerate(loader.items["keyword_names"]):
        paths = loader.items["taxonomy_paths"].iloc[idx] if has_taxonomy_paths else []
        for j, name in enumerate(names or []):
            name_text = str(name or "").strip()
            if not name_text:
                continue
            taxonomy_path = str(paths[j] if j < len(paths) and paths[j] else "").strip()
            if taxonomy_path and name_text not in paths_by_name:
                paths_by_name[name_text] = taxonomy_path
    return paths_by_name


def _db_keywords(
    search: Optional[str],
    limit: int,
    artifact_paths_by_name: dict[str, str],
) -> Optional[list[KeywordOut]]:
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
                taxonomy_path=(
                    taxonomy_paths.get(int(taxonomy_node_id), "")
                    if taxonomy_node_id
                    else artifact_paths_by_name.get(name_text.strip(), "")
                )
                or artifact_paths_by_name.get(name_text.strip(), ""),
            )
        )
        if len(out) >= limit:
            break
    return out


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


# ---------------------------------------------------------------------------
# Dashboard-only analytics endpoints
# ---------------------------------------------------------------------------

# Short Thai month labels keyed 1..12. The dashboard chart reuses this order.
_TH_MONTH_LABELS = [
    "", "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
    "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
]


def _month_window(months: int) -> tuple[int, int]:
    """Return (start_year, start_month) for the window covering the last
    ``months`` calendar months ending at the current UTC month. Always
    anchored on the first of the month.
    """
    today = datetime.now(timezone.utc)
    # Convert to (year, month) and subtract (months-1) to get the start bucket.
    year, month = today.year, today.month
    for _ in range(months - 1):
        month -= 1
        if month == 0:
            month = 12
            year -= 1
    return year, month


def _iterate_month_buckets(start_year: int, start_month: int, count: int):
    """Yield ``(year, month, label)`` tuples for ``count`` consecutive months
    starting at ``(start_year, start_month)``.
    """
    year, month = start_year, start_month
    for _ in range(count):
        yield year, month, _TH_MONTH_LABELS[month]
        month += 1
        if month == 13:
            month = 1
            year += 1


@router.get(
    "/metrics/requests",
    response_model=RequestTrendOut,
    summary="Recommendation-request trend (monthly buckets)",
    description=(
        "Returns the last ``months`` calendar months of recommendation "
        "activity, aggregated from ``recommendation_requests`` and "
        "``recommendation_results``. Used by the admin dashboard trend "
        "chart. Returns all-zero buckets (with ``source='disabled'``) when "
        "the DB layer is disabled or unreachable."
    ),
)
def request_trend(
    months: int = 12,
) -> RequestTrendOut:
    if months < 1:
        months = 1
    if months > 36:
        months = 36

    start_year, start_month = _month_window(months)
    buckets_index: dict[tuple[int, int], dict[str, int]] = {}
    for y, m, _label in _iterate_month_buckets(start_year, start_month, months):
        buckets_index[(y, m)] = {"request_count": 0, "shown_count": 0}

    source = "disabled"
    total_requests = 0
    total_shown = 0
    try:
        with session_scope() as session:
            if session is not None:
                # Recommendation requests per (year, month).
                req_rows = session.execute(
                    select(
                        func.extract("year", RecommendationRequest.created_at).label("y"),
                        func.extract("month", RecommendationRequest.created_at).label("m"),
                        func.count().label("c"),
                    )
                    .where(
                        RecommendationRequest.created_at
                        >= datetime(start_year, start_month, 1, tzinfo=timezone.utc)
                    )
                    .group_by("y", "m")
                ).all()
                # Items actually shown per (year, month) via JOIN to request's
                # created_at — counts result rows, not unique items.
                shown_rows = session.execute(
                    select(
                        func.extract("year", RecommendationRequest.created_at).label("y"),
                        func.extract("month", RecommendationRequest.created_at).label("m"),
                        func.count(RecommendationResult.id).label("c"),
                    )
                    .select_from(RecommendationResult)
                    .join(
                        RecommendationRequest,
                        RecommendationRequest.id == RecommendationResult.request_id,
                    )
                    .where(
                        RecommendationRequest.created_at
                        >= datetime(start_year, start_month, 1, tzinfo=timezone.utc)
                    )
                    .group_by("y", "m")
                ).all()
                source = "postgres"
                for y, m, c in req_rows:
                    key = (int(y), int(m))
                    if key in buckets_index:
                        buckets_index[key]["request_count"] = int(c)
                        total_requests += int(c)
                for y, m, c in shown_rows:
                    key = (int(y), int(m))
                    if key in buckets_index:
                        buckets_index[key]["shown_count"] = int(c)
                        total_shown += int(c)
    except Exception:  # noqa: BLE001 - dashboard should still render with zeros
        # Reset to disabled state if DB query failed mid-flight.
        source = "disabled"
        buckets_index = {
            (y, m): {"request_count": 0, "shown_count": 0}
            for y, m, _ in _iterate_month_buckets(start_year, start_month, months)
        }
        total_requests = 0
        total_shown = 0

    buckets: list[RequestTrendBucket] = []
    for y, m, label in _iterate_month_buckets(start_year, start_month, months):
        data = buckets_index.get((y, m), {"request_count": 0, "shown_count": 0})
        buckets.append(
            RequestTrendBucket(
                year=y,
                month=m,
                label=label,
                request_count=data["request_count"],
                shown_count=data["shown_count"],
            )
        )

    return RequestTrendOut(
        months=months,
        total_requests=total_requests,
        total_shown=total_shown,
        source=source,
        buckets=buckets,
    )


@router.get(
    "/metrics/config",
    response_model=ModelConfigOut,
    summary="Active recommender configuration",
    description=(
        "Returns the experiment configuration that the backend is currently "
        "serving — sourced from ``best_model_config.json`` (the manifest "
        "produced by the offline tuning pipeline) and augmented with the "
        "runtime ``RECSYS_*`` env-var overrides. Used by the admin "
        "dashboard so the model-control sliders reflect reality instead of "
        "showing placeholder values."
    ),
)
def model_config(
    loader: ArtifactLoader = Depends(get_singleton),
) -> ModelConfigOut:
    md = loader.metadata or {}
    settings = get_settings()
    best_cfg = loader.best_model_config or md.get("best_model_config") or {}
    if not isinstance(best_cfg, dict):
        best_cfg = {}
    selected = best_cfg.get("selected_model") or best_cfg
    if not isinstance(selected, dict):
        selected = {}
    effective = settings_with_artifact_config(settings, best_cfg)

    # ``extra`` is everything in best_model_config that we don't surface as
    # a typed field — keeps the schema forward-compatible without leaking
    # unknown keys.
    known_keys = {
        "cbf_model",
        "cf_model",
        "hybrid_method",
        "hybrid_alpha",
        "candidate_strategy",
        "embedding_dim",
        "itemknn_k",
        "itemknn_shrink",
        "cbf_keyword_boost",
        "positive_threshold",
    }
    extra = {k: v for k, v in best_cfg.items() if k not in known_keys}

    return ModelConfigOut(
        cbf_model=str(selected.get("cbf_model", effective.e5_model_name)),
        cf_model=str(selected.get("cf_model", "ItemKNN")),
        hybrid_method=str(selected.get("hybrid_method", effective.recommendation_method)),
        hybrid_alpha=effective.hybrid_alpha,
        candidate_strategy=str(selected.get("candidate_strategy", "EligibilityGate")),
        embedding_dim=int(md.get("embedding_dim", 0)) or None,
        itemknn_k=effective.itemknn_k,
        itemknn_shrink=effective.itemknn_shrink,
        cbf_keyword_boost=effective.cbf_keyword_boost,
        positive_threshold=effective.positive_threshold,
        extra=extra,
    )


@router.get(
    "/metrics/reproducibility",
    response_model=ReproducibilityOut,
    summary="Compare loaded artifacts with the paper baseline",
)
def reproducibility(loader: ArtifactLoader = Depends(get_singleton)) -> ReproducibilityOut:
    baseline_path = Path(__file__).resolve().parents[3] / "docs" / "research_baseline.json"
    baseline = json.loads(baseline_path.read_text(encoding="utf-8"))

    keywords = {
        str(name).strip()
        for values in loader.items.get("keyword_names", [])
        for name in (values or [])
        if str(name).strip()
    }
    paths = {
        str(path).strip()
        for values in loader.items.get("taxonomy_paths", [])
        for path in (values or [])
        if str(path).strip()
    }

    def count(key: str, actual: int) -> ReproducibilityCount:
        expected = int(baseline[key])
        return ReproducibilityCount(
            expected=expected,
            actual=actual,
            delta=actual - expected,
            matches=actual == expected,
        )

    live_keyword_count: Optional[int] = None
    try:
        with session_scope() as session:
            if session is not None:
                live_keyword_count = int(
                    session.execute(select(func.count(Keyword.id))).scalar_one()
                )
    except Exception:  # noqa: BLE001 - artifact audit remains available without Postgres
        live_keyword_count = None

    item_count = count("item_count", len(loader.item_ids))
    keyword_count = count(
        "keyword_count", live_keyword_count if live_keyword_count is not None else len(keywords)
    )
    taxonomy_count = count("taxonomy_path_count", len(paths))
    matches = item_count.matches and keyword_count.matches and taxonomy_count.matches
    md = loader.metadata or {}
    return ReproducibilityOut(
        status="match" if matches else "drift_detected",
        baseline_source=str(baseline.get("source", "old code/paper.docx")),
        keyword_count_source="postgres" if live_keyword_count is not None else "artifacts",
        item_count=item_count,
        keyword_count=keyword_count,
        taxonomy_path_count=taxonomy_count,
        artifact_config_hash=str(md.get("config_hash", "")),
        artifact_build_timestamp=str(md.get("build_timestamp", "")),
    )


# ---------------------------------------------------------------------------
# Phase 3 admin dashboard
# ---------------------------------------------------------------------------


@router.get(
    "/metrics/dashboard",
    response_model=DashboardOut,
    summary="Admin dashboard payload (Phase 3)",
    description=(
        "Returns the full dashboard payload used by ``/dashboard`` — "
        "KPI strip, 30-day activity trend, user growth, 7×24 usage "
        "heatmap, popular categories/sub-contexts, top search terms, "
        "rating distribution, model quality, 30-day quality trend, "
        "algorithm KPIs, top keywords, page quality, and recent "
        "activity. Model quality is sourced from the latest "
        "``evaluation_runs`` row (online preferred, offline fallback). "
        "Admin-only: requires ``Authorization: Bearer <admin_jwt>``. "
        "Returns ``source='disabled'`` with zeroed sections when the "
        "DB layer is off or unreachable."
    ),
)
def dashboard(
    range: str = Query(
        "30d",
        description="Time window for trend/heatmap/KPI deltas. Accepted: 7d, 30d, 90d, 365d.",
    ),
    admin: User = Depends(get_current_admin),
) -> DashboardOut:
    days = _parse_range_days(range)
    return build_dashboard_payload(range_days=days)


@router.get(
    "/metrics/analytics",
    response_model=AnalyticsOut,
    summary="Aggregate admin analytics with evidence-grounded AI insights",
    description=(
        "Returns the three sections used by /admin/analytics: trends, "
        "aggregate user behavior, and cached AI-assisted insights. Only "
        "aggregate statistics are included in the AI input; user identifiers "
        "and row-level histories are never transmitted. Admin-only."
    ),
)
def analytics(
    range: str = Query(
        "30d",
        description="Accepted time windows: 7d, 30d, 90d, 365d.",
    ),
    admin: User = Depends(get_current_admin),
) -> AnalyticsOut:
    return build_analytics_payload(range_days=_parse_range_days(range))


@router.get(
    "/metrics/dashboard/export",
    summary="Export the admin dashboard as Excel",
    description=(
        "Builds a styled multi-sheet Excel snapshot from the same metrics as "
        "``GET /metrics/dashboard``. The selected range is preserved and the "
        "download is restricted to authenticated administrators."
    ),
)
def export_dashboard(
    range: str = Query(
        "30d",
        description="Time window included in the report. Accepted: 7d, 30d, 90d, 365d.",
    ),
    admin: User = Depends(get_current_admin),
) -> Response:
    days = _parse_range_days(range)
    payload = build_dashboard_payload(range_days=days)
    workbook = build_dashboard_report(
        payload,
        generated_by=str(admin.display_name or admin.username or "Admin"),
    )
    filename = f"thai_arts_dashboard_{datetime.now(timezone.utc):%Y%m%d_%H%M}_{days}d.xlsx"
    return Response(
        content=workbook,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


# ---------------------------------------------------------------------------
# Phase B popularity (ADR-002)
# ---------------------------------------------------------------------------


@router.get(
    "/metrics/popularity",
    response_model=PopularityOut,
    summary="Top-N items by the popularity score (ADR-002 §4)",
    description=(
        "Returns the top ``limit`` items by the multi-signal popularity "
        "score — Bayesian-smoothed rating, time-decayed likes/saves, "
        "recency, and (when available) CTR from recommendation "
        "attribution. Sub-scores are returned alongside the total so "
        "callers can see *why* an item ranked where it did.\n\n"
        "The score is **browse-only**: it never enters "
        "``/recommendations`` ranking (ADR-001 §5 invariant). Popularity "
        "informing recommendations is a feedback loop and would make the "
        "popular-thrives trap worse.\n\n"
        "Admin-only."
    ),
)
def popularity(
    range: str = Query(
        "30d",
        description="Time window in days. Accepted: 7d, 30d, 90d, 365d.",
    ),
    limit: int = Query(
        10,
        ge=1,
        le=100,
        description="Maximum number of rows to return. Sorted by ``total`` desc.",
    ),
    loader: ArtifactLoader = Depends(get_singleton),
    admin: User = Depends(get_current_admin),
) -> PopularityOut:
    days = _parse_range_days(range)
    with session_scope() as session:
        if session is None:
            return PopularityOut(
                range_days=days, weights_id=0, source="unavailable", rows=[]
            )
        weights = active_weights(session)
        if weights is None:
            return PopularityOut(
                range_days=days, weights_id=0, source="unavailable", rows=[]
            )
        scored = compute_popularity_scores(
            session, window_days=days, weights=weights
        )

    rows: list[PopularityRowOut] = []
    for aid, payload in sorted(
        scored.items(), key=lambda kv: (-kv[1]["total"], kv[0])
    )[: int(limit)]:
        row = loader.item_row(int(aid))
        rows.append(
            PopularityRowOut(
                item_id=int(aid),
                name=str(row.get("name") or "") if row is not None else "",
                total=float(payload["total"]),
                sub_scores=dict(payload["sub_scores"]),
                engagement_score=int(payload["engagement_score"]),
                weights_applied=list(payload.get("weights_applied") or []),
                rating_confidence=int(payload.get("rating_confidence") or 0),
            )
        )
    return PopularityOut(
        range_days=days,
        weights_id=int(weights.id),
        source="live",
        rows=rows,
    )


@router.get(
    "/metrics/popularity/weights",
    response_model=PopularityWeightsOut,
    summary="The currently active popularity weights",
    description=(
        "Returns the single ``PopularityWeight`` row whose ``is_active`` "
        "is true. Admin-only. When the table is empty, returns 404."
    ),
)
def popularity_weights_active(
    admin: User = Depends(get_current_admin),
) -> PopularityWeightsOut:
    with session_scope() as session:
        if session is None:
            from fastapi import HTTPException, status

            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Database is not enabled.",
            )
        w = active_weights(session)
        if w is None:
            from fastapi import HTTPException, status

            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No active popularity weights row.",
            )
        return PopularityWeightsOut(
            id=int(w.id),
            weights=w.weights(),
            half_life_days=int(w.half_life_days),
            bayes_m=int(w.bayes_m),
            updated_at=(w.updated_at or datetime.now(timezone.utc)).isoformat(),
            updated_by=str(w.updated_by or ""),
        )


@router.put(
    "/metrics/popularity/weights",
    response_model=PopularityWeightsOut,
    summary="Replace the active popularity weights",
    description=(
        "Validates the body (weights in [0, 1], sum 1.0 ± 1e-3, every "
        "factor in the known set; half_life_days and bayes_m ≥ 0), "
        "deactivates the previous active row in the same transaction, "
        "and inserts the new one. Admin-only. ``updated_by`` is "
        "populated by the operator for audit."
    ),
)
def popularity_weights_update(
    payload: PopularityWeightsUpdateIn,
    admin: User = Depends(get_current_admin),
) -> PopularityWeightsOut:
    try:
        with session_scope() as session:
            if session is None:
                from fastapi import HTTPException, status

                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Database is not enabled.",
                )
            w = set_weights(
                session,
                weights_dict={k: float(v) for k, v in payload.weights.items()},
                half_life_days=int(payload.half_life_days),
                bayes_m=int(payload.bayes_m),
                updated_by=str(payload.updated_by or admin.username or "admin"),
            )
            session.commit()
            return PopularityWeightsOut(
                id=int(w.id),
                weights=w.weights(),
                half_life_days=int(w.half_life_days),
                bayes_m=int(w.bayes_m),
                updated_at=(w.updated_at or datetime.now(timezone.utc)).isoformat(),
                updated_by=str(w.updated_by or ""),
            )
    except WeightsValidationError as e:
        from fastapi import HTTPException, status

        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "invalid_weights", "message": str(e)},
        )


_RANGE_ALIASES = {
    "7d": 7,
    "30d": 30,
    "90d": 90,
    "365d": 365,
}


def _parse_range_days(value: str) -> int:
    """Map a range alias to a day count. Defaults to 30 for unknown values."""
    return _RANGE_ALIASES.get(str(value or "30d").lower().strip(), 30)
