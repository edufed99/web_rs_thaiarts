"""
services/dashboard_query.py — Build the ``/metrics/dashboard`` payload.

Mirrors the ``member_query`` pattern:

* One ``session_scope()`` per call.
* Returns ``source='disabled'`` + zeroed sections when the DB layer is
  off so the frontend can render placeholders without retrying.
* Catches any DB exception and falls back to disabled state so a
  transient outage does not 500 the admin page.

Sections implemented:

* M1: KPIs (counts only), zero-state for the rest, model quality (latest
  ``evaluation_runs`` row, prefer online over offline).
* M2 (next): trend, user growth, heatmap, popular categories /
  subcontexts, top search terms, rating distribution, quality trend,
  algorithm KPIs, top keywords, page quality, recent activity.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

from sqlalchemy import distinct, func, select
from sqlalchemy.orm import Session

from ..db import is_db_enabled, session_scope
from ..models_db import (
    EvaluationRun,
    Item,
    ItemContext,
    ItemKeyword,
    InteractionLog,
    LegacyInteraction,
    Rating,
    RecommendationRequest,
    RecommendationRequestSelectedKeyword,
    RecommendationResult,
    User,
)
from ..schemas.dashboard import (
    AlgorithmKpiOut,
    CategoryItem,
    CategoryListOut,
    DashboardOut,
    HeatmapOut,
    KpiStripOut,
    KpiTile,
    KeywordListOut,
    KeywordRow,
    ModelQualityOut,
    PageQualityMetric,
    PageQualityOut,
    RatingDistributionBucket,
    RatingDistributionOut,
    RecentActivityListOut,
    RecentActivityRow,
    SubContextItem,
    SubContextListOut,
    TopSearchListOut,
    TopSearchRow,
    TrendBucket,
    TrendOut,
    UserGrowthBucket,
    UserGrowthOut,
)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def build_dashboard_payload(range_days: int = 30) -> DashboardOut:
    """Return the dashboard payload for the given range (default 30d).

    Always returns a fully-populated ``DashboardOut`` — empty sections
    are zeroed, never missing — so the frontend can render uniformly.
    """
    range_days = max(1, min(int(range_days or 30), 365))
    generated_at = datetime.now(timezone.utc).isoformat()

    if not is_db_enabled():
        return _zero_dashboard(range_days, generated_at, source="disabled")

    try:
        with session_scope() as session:
            if session is None:
                return _zero_dashboard(range_days, generated_at, source="disabled")

            kpis = _kpi_strip(session, range_days)
            model_quality = _model_quality(session)
            quality_trend = _quality_trend_30d(session)
            # M2 sections — wired but currently return zero-state.
            trend_30d = _activity_trend(session, range_days)
            user_growth = _user_growth(session, range_days)
            heatmap = _usage_heatmap(session, range_days)
            popular_categories = _popular_categories(session)
            popular_subcontexts = _popular_subcontexts(session)
            top_search = _top_search_terms(session, range_days)
            rating_dist = _rating_distribution(session)
            algo_kpis = _algorithm_kpis(session, range_days)
            top_keywords = _top_keywords(session, range_days)
            page_quality = _page_quality(session)
            recent = _recent_activity(session)
            source = "postgres"
    except Exception:  # noqa: BLE001 - dashboard should never 500
        return _zero_dashboard(range_days, generated_at, source="disabled")

    return DashboardOut(
        range_days=range_days,
        generated_at=generated_at,
        source=source,
        kpis=kpis,
        trend_30d=trend_30d,
        user_growth=user_growth,
        usage_heatmap=heatmap,
        popular_categories=popular_categories,
        popular_subcontexts=popular_subcontexts,
        top_search_terms=top_search,
        rating_distribution=rating_dist,
        model_quality=model_quality,
        quality_trend_30d=quality_trend,
        algorithm_kpis=algo_kpis,
        top_keywords=top_keywords,
        page_quality=page_quality,
        recent_activity=recent,
    )


# ---------------------------------------------------------------------------
# Sections
# ---------------------------------------------------------------------------


def _kpi_strip(session: Session, range_days: int) -> KpiStripOut:
    """Top-line numbers for the 6-tile strip.

    Members/Performances are total counts. Indices = total rec_results.
    Points = legacy_interactions count (legacy "ดัชนีความสนใจ" surrogate
    until a dedicated points table exists — counts the historical
    rating pool). Active users / sessions = distinct user_key in the
    last ``range_days`` days.
    """
    since = datetime.now(timezone.utc) - timedelta(days=range_days)
    prev_since = since - timedelta(days=range_days)

    members = int(session.execute(select(func.count()).select_from(User)).scalar_one() or 0)
    performances = int(
        session.execute(select(func.count()).select_from(Item).where(Item.is_active.is_(True))).scalar_one() or 0
    )
    indices = int(session.execute(select(func.count()).select_from(RecommendationResult)).scalar_one() or 0)
    points = int(session.execute(select(func.count()).select_from(LegacyInteraction)).scalar_one() or 0)

    active_users = int(
        session.execute(
            select(func.count(distinct(InteractionLog.user_key))).where(InteractionLog.created_at >= since)
        ).scalar_one()
        or 0
    )
    sessions = int(
        session.execute(
            select(func.count(distinct(func.concat(InteractionLog.user_key, InteractionLog.created_at.cast(type_=__import__("sqlalchemy").Date)))))
            .where(InteractionLog.created_at >= since)
        ).scalar_one()
        or 0
    )

    # Deltas: compare against the previous range window.
    prev_active_users = int(
        session.execute(
            select(func.count(distinct(InteractionLog.user_key)))
            .where(InteractionLog.created_at >= prev_since, InteractionLog.created_at < since)
        ).scalar_one()
        or 0
    )
    prev_sessions = int(
        session.execute(
            select(func.count(distinct(func.concat(InteractionLog.user_key, InteractionLog.created_at.cast(type_=__import__("sqlalchemy").Date)))))
            .where(InteractionLog.created_at >= prev_since, InteractionLog.created_at < since)
        ).scalar_one()
        or 0
    )

    return KpiStripOut(
        members=KpiTile(label="สมาชิก", value=f"{members:,}", raw_value=float(members), delta_pct=None, tone="neutral", hint="ผู้ใช้ที่ลงทะเบียนทั้งหมด"),
        performances=KpiTile(label="ชุดการแสดง", value=f"{performances:,}", raw_value=float(performances), delta_pct=None, tone="neutral", hint="รายการที่เปิดใช้งานในแค็ตตาล็อก"),
        indices=KpiTile(label="ค่าดัชนี", value=f"{indices:,}", raw_value=float(indices), delta_pct=None, tone="positive", hint="จำนวนผลลัพธ์คำแนะนำที่แสดง"),
        points=KpiTile(label="คะแนน", value=f"{points:,}", raw_value=float(points), delta_pct=None, tone="neutral", hint="สัญญาณเชิงบวกจากข้อมูลย้อนหลัง"),
        active_users=KpiTile(
            label="ผู้ใช้งานที่ใช้งาน",
            value=f"{active_users:,}",
            raw_value=float(active_users),
            delta_pct=_safe_pct_change(active_users, prev_active_users),
            tone="positive",
            hint=f"distinct user_key ใน {range_days} วันล่าสุด",
        ),
        sessions=KpiTile(
            label="เซสชัน",
            value=f"{sessions:,}",
            raw_value=float(sessions),
            delta_pct=_safe_pct_change(sessions, prev_sessions),
            tone="positive",
            hint="(ผู้ใช้ × วัน) ในช่วงเวลา",
        ),
    )


def _activity_trend(session: Session, range_days: int) -> TrendOut:
    """Per-day series for sessions / searches / ratings over ``range_days`` days."""
    since = datetime.now(timezone.utc) - timedelta(days=range_days)
    rows = session.execute(
        select(
            func.date(InteractionLog.created_at).label("d"),
            InteractionLog.action_type,
            func.count().label("c"),
        )
        .where(InteractionLog.created_at >= since)
        .group_by("d", InteractionLog.action_type)
    ).all()

    bucket: Dict[str, TrendBucket] = {}
    for d, action_type, c in rows:
        label = d.isoformat() if hasattr(d, "isoformat") else str(d)
        b = bucket.setdefault(label, TrendBucket(label=label))
        kind = str(action_type or "")
        if kind == "search":
            b.searches += int(c)
        elif kind == "rate":
            b.ratings += int(c)
        else:
            b.sessions += int(c)

    labels = sorted(bucket.keys())
    return TrendOut(
        labels=labels,
        sessions=[bucket[k].sessions for k in labels],
        searches=[bucket[k].searches for k in labels],
        ratings=[bucket[k].ratings for k in labels],
    )


def _user_growth(session: Session, range_days: int) -> UserGrowthOut:
    since = datetime.now(timezone.utc) - timedelta(days=range_days)
    new_rows = session.execute(
        select(func.date(User.created_at).label("d"), func.count().label("c"))
        .where(User.created_at >= since)
        .group_by("d")
    ).all()
    active_rows = session.execute(
        select(func.date(InteractionLog.created_at).label("d"), func.count(distinct(InteractionLog.user_key)).label("c"))
        .where(InteractionLog.created_at >= since)
        .group_by("d")
    ).all()

    new_by_day: Dict[str, int] = {str(d): int(c) for d, c in new_rows}
    active_by_day: Dict[str, int] = {str(d): int(c) for d, c in active_rows}
    labels = sorted(set(new_by_day.keys()) | set(active_by_day.keys()))
    return UserGrowthOut(
        labels=labels,
        new_users=[new_by_day.get(k, 0) for k in labels],
        active_users=[active_by_day.get(k, 0) for k in labels],
    )


def _usage_heatmap(session: Session, range_days: int) -> HeatmapOut:
    """7×24 heatmap of interaction counts by weekday and hour (UTC)."""
    since = datetime.now(timezone.utc) - timedelta(days=range_days)
    rows = session.execute(
        select(
            func.extract("dow", InteractionLog.created_at).label("w"),
            func.extract("hour", InteractionLog.created_at).label("h"),
            func.count().label("c"),
        )
        .where(InteractionLog.created_at >= since)
        .group_by("w", "h")
    ).all()

    matrix = [[0] * 24 for _ in range(7)]
    max_v = 0
    for w, h, c in rows:
        wi = int(w)  # PostgreSQL: 0=Sunday..6=Saturday
        # Convert to ISO weekday (0=Mon..6=Sun).
        wi_iso = (wi + 6) % 7
        hi = int(h)
        matrix[wi_iso][hi] += int(c)
        if matrix[wi_iso][hi] > max_v:
            max_v = matrix[wi_iso][hi]

    return HeatmapOut(
        weekday_labels=["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."],
        hour_labels=[f"{h:02d}:00" for h in range(24)],
        matrix=matrix,
        max_value=int(max_v),
    )


def _popular_categories(session: Session) -> CategoryListOut:
    total = int(
        session.execute(select(func.count()).select_from(Item).where(Item.is_active.is_(True))).scalar_one() or 0
    )
    if total == 0:
        return CategoryListOut(items=[], total_items=0)
    rows = session.execute(
        select(Item.category_group, func.count().label("c"))
        .where(Item.is_active.is_(True))
        .group_by(Item.category_group)
        .order_by(func.count().desc())
        .limit(8)
    ).all()
    items = [
        CategoryItem(
            name=str(name or "อื่นๆ"),
            count=int(c),
            pct=round(int(c) * 100 / total, 1),
        )
        for name, c in rows
    ]
    return CategoryListOut(items=items, total_items=total)


def _popular_subcontexts(session: Session) -> SubContextListOut:
    from ..models_db import Context  # local import to avoid circulars in some envs

    total = int(
        session.execute(select(func.count()).select_from(RecommendationRequest)).scalar_one() or 0
    )
    rows = session.execute(
        select(Context.name, func.count(RecommendationRequest.id).label("c"))
        .join(Context, Context.id == RecommendationRequest.selected_context_id)
        .group_by(Context.name)
        .order_by(func.count(RecommendationRequest.id).desc())
        .limit(8)
    ).all()
    items = [
        SubContextItem(
            name=str(name),
            count=int(c),
            pct=round(int(c) * 100 / total, 1) if total else 0.0,
        )
        for name, c in rows
    ]
    return SubContextListOut(items=items, total_requests=total)


def _top_search_terms(session: Session, range_days: int) -> TopSearchListOut:
    """Aggregate search-like interactions by their metadata term."""
    since = datetime.now(timezone.utc) - timedelta(days=range_days)
    rows = session.execute(
        select(InteractionLog.action_type, InteractionLog.metadata_json)
        .where(InteractionLog.created_at >= since)
        .where(InteractionLog.action_type.in_(("search", "keyword_click", "item_view")))
        .limit(5000)
    ).all()

    counts: Dict[str, Dict[str, int]] = {}
    for action_type, metadata_json in rows:
        term = _extract_term(action_type, metadata_json)
        if not term:
            continue
        bucket = counts.setdefault(term, {"searches": 0, "views": 0, "ratings": 0, "likes": 0})
        if action_type == "search" or action_type == "keyword_click":
            bucket["searches"] += 1
        elif action_type == "item_view":
            bucket["views"] += 1
        elif action_type == "rate":
            bucket["ratings"] += 1
        elif action_type == "like":
            bucket["likes"] += 1

    scored = []
    for term, c in counts.items():
        score = c["searches"] * 0.5 + c["views"] * 0.3 + c["ratings"] * 0.15 + c["likes"] * 0.05
        scored.append((term, c["searches"], c["views"], c["ratings"], c["likes"], score))
    scored.sort(key=lambda t: (-t[5], t[0]))
    return TopSearchListOut(
        items=[
            TopSearchRow(rank=i + 1, term=term, searches=s, views=v, ratings=r, likes=l, score=round(score, 2))
            for i, (term, s, v, r, l, score) in enumerate(scored[:10])
        ]
    )


def _extract_term(action_type: str, metadata_json: str) -> str:
    if not metadata_json:
        return ""
    try:
        meta = json.loads(metadata_json)
    except (TypeError, ValueError):
        return ""
    if not isinstance(meta, dict):
        return ""
    return str(meta.get("term") or meta.get("keyword") or meta.get("q") or "").strip()


def _rating_distribution(session: Session) -> RatingDistributionOut:
    rows = session.execute(
        select(Rating.rating, func.count().label("c"))
        .group_by(Rating.rating)
        .order_by(Rating.rating.asc())
    ).all()
    counts = {int(r): int(c) for r, c in rows}
    total = sum(counts.values())
    buckets = [
        RatingDistributionBucket(
            star=star,
            count=counts.get(star, 0),
            pct=round(counts.get(star, 0) * 100 / total, 1) if total else 0.0,
        )
        for star in (1, 2, 3, 4, 5)
    ]
    avg = (
        sum(star * counts.get(star, 0) for star in (1, 2, 3, 4, 5)) / total
        if total
        else 0.0
    )
    return RatingDistributionOut(buckets=buckets, average=round(avg, 2), total=total)


def _model_quality(session: Session) -> ModelQualityOut:
    """Latest evaluation run, preferring online over offline."""
    online = session.execute(
        select(EvaluationRun)
        .where(EvaluationRun.source == "online")
        .order_by(EvaluationRun.ran_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    if online is not None:
        return _eval_to_quality(online)
    offline = session.execute(
        select(EvaluationRun)
        .where(EvaluationRun.source == "offline")
        .order_by(EvaluationRun.ran_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    if offline is not None:
        return _eval_to_quality(offline)
    return ModelQualityOut(source="unavailable")


def _eval_to_quality(run: EvaluationRun) -> ModelQualityOut:
    return ModelQualityOut(
        ndcg10=float(run.ndcg10),
        hr10=float(run.hr10),
        mrr10=float(run.mrr10),
        coverage=float(run.coverage),
        violation_rate=float(run.violation_rate),
        source=str(run.source),
        ran_at=run.ran_at.isoformat() if run.ran_at else "",
        test_user_count=int(run.test_user_count),
        test_interaction_count=int(run.test_interaction_count),
    )


def _quality_trend_30d(session: Session) -> TrendOut:
    """Per-day nDCG/HR/MRR from the last 30 days of online runs (zeros when missing)."""
    since = datetime.now(timezone.utc) - timedelta(days=30)
    rows = session.execute(
        select(EvaluationRun.ran_at, EvaluationRun.ndcg10, EvaluationRun.hr10, EvaluationRun.mrr10)
        .where(EvaluationRun.source == "online")
        .where(EvaluationRun.ran_at >= since)
        .order_by(EvaluationRun.ran_at.asc())
    ).all()
    by_day: Dict[str, List[Tuple[float, float, float]]] = {}
    for ran_at, n, h, m in rows:
        if ran_at is None:
            continue
        key = ran_at.date().isoformat()
        by_day.setdefault(key, []).append((float(n), float(h), float(m)))
    labels = sorted(by_day.keys())
    return TrendOut(
        labels=labels,
        ndcg10=[round(sum(x[0] for x in by_day[k]) / len(by_day[k]), 4) for k in labels],
        hr10=[round(sum(x[1] for x in by_day[k]) / len(by_day[k]), 4) for k in labels],
        mrr10=[round(sum(x[2] for x in by_day[k]) / len(by_day[k]), 4) for k in labels],
    )


def _algorithm_kpis(session: Session, range_days: int) -> AlgorithmKpiOut:
    """Search → item-view funnel + shown-items CTR over the range window."""
    since = datetime.now(timezone.utc) - timedelta(days=range_days)
    search_total = int(
        session.execute(
            select(func.count())
            .select_from(InteractionLog)
            .where(InteractionLog.created_at >= since, InteractionLog.action_type.in_(("search", "keyword_click")))
        ).scalar_one()
        or 0
    )
    # "search-to-detail" = search followed by an item_view by the same user
    # within 24h. Implemented as: count of distinct (user_key, search_id)
    # where a subsequent item_view exists. To keep the query cheap we
    # approximate as: searches whose user_key also has any item_view in
    # the same range window.
    search_to_detail = int(
        session.execute(
            select(func.count(distinct(InteractionLog.user_key)))
            .select_from(InteractionLog)
            .where(
                InteractionLog.created_at >= since,
                InteractionLog.action_type.in_(("search", "keyword_click")),
                InteractionLog.user_key.in_(
                    select(distinct(InteractionLog.user_key))
                    .where(InteractionLog.created_at >= since, InteractionLog.action_type == "item_view")
                ),
            )
        ).scalar_one()
        or 0
    )
    items_shown = int(
        session.execute(
            select(func.count())
            .select_from(InteractionLog)
            .where(InteractionLog.created_at >= since, InteractionLog.action_type == "item_view")
        ).scalar_one()
        or 0
    )
    recs_shown = int(
        session.execute(
            select(func.count()).select_from(RecommendationResult)
            .join(RecommendationRequest, RecommendationRequest.id == RecommendationResult.request_id)
            .where(RecommendationRequest.created_at >= since)
        ).scalar_one()
        or 0
    )

    search_to_detail_pct = round(search_to_detail * 100 / search_total, 1) if search_total else 0.0
    ctr_pct = round(items_shown * 100 / recs_shown, 1) if recs_shown else 0.0
    return AlgorithmKpiOut(
        search_total=search_total,
        search_to_detail_total=search_to_detail,
        search_to_detail_pct=search_to_detail_pct,
        items_shown_total=items_shown,
        ctr_pct=ctr_pct,
    )


def _top_keywords(session: Session, range_days: int) -> KeywordListOut:
    """Top 5 keywords selected in recommendation searches.

    New recommendation requests persist their selections in
    ``recommendation_request_selected_keywords``. Search/keyword-click logs
    are still included for backward compatibility with older telemetry.
    """
    since = datetime.now(timezone.utc) - timedelta(days=range_days)
    from ..models_db import Keyword

    selected_rows = session.execute(
        select(Keyword.name, func.count(RecommendationRequestSelectedKeyword.id))
        .join(
            RecommendationRequestSelectedKeyword,
            RecommendationRequestSelectedKeyword.keyword_id == Keyword.id,
        )
        .join(
            RecommendationRequest,
            RecommendationRequest.id == RecommendationRequestSelectedKeyword.request_id,
        )
        .where(RecommendationRequest.created_at >= since)
        .group_by(Keyword.name)
    ).all()

    counts: Dict[str, int] = {
        str(term): int(count) for term, count in selected_rows if str(term).strip()
    }
    rows = session.execute(
        select(InteractionLog.metadata_json)
        .where(InteractionLog.created_at >= since)
        .where(InteractionLog.action_type.in_(("search", "keyword_click")))
        .limit(5000)
    ).all()
    for (metadata_json,) in rows:
        term = _extract_term("search", metadata_json)
        if term:
            counts[term] = counts.get(term, 0) + 1
    sorted_terms = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:5]
    return KeywordListOut(
        items=[KeywordRow(rank=i + 1, term=term, count=c) for i, (term, c) in enumerate(sorted_terms)]
    )


def _page_quality(session: Session) -> PageQualityOut:
    """Catalog completeness percentages across the five quality dimensions."""
    total = int(
        session.execute(select(func.count()).select_from(Item).where(Item.is_active.is_(True))).scalar_one() or 0
    )
    if total == 0:
        return PageQualityOut(metrics=[], open_issues=0)

    has_context = int(
        session.execute(
            select(func.count(func.distinct(ItemContext.item_id))).select_from(ItemContext)
        ).scalar_one()
        or 0
    )
    has_keyword = int(
        session.execute(
            select(func.count(func.distinct(ItemKeyword.item_id))).select_from(ItemKeyword)
        ).scalar_one()
        or 0
    )
    has_image = int(
        session.execute(
            select(func.count()).select_from(Item).where(Item.is_active.is_(True), Item.image_url != "")
        ).scalar_one()
        or 0
    )
    has_description = int(
        session.execute(
            select(func.count()).select_from(Item).where(Item.is_active.is_(True), Item.description != "")
        ).scalar_one()
        or 0
    )
    has_rating = int(
        session.execute(
            select(func.count(func.distinct(Rating.item_id))).select_from(Rating)
        ).scalar_one()
        or 0
    )

    def metric(name: str, value: int, target: float = 90.0) -> PageQualityMetric:
        pct = round(value * 100 / total, 1)
        if pct >= target:
            tone = "success"
        elif pct >= target - 15:
            tone = "warning"
        else:
            tone = "danger"
        return PageQualityMetric(name=name, value=pct, target=target, tone=tone)

    return PageQualityOut(
        metrics=[
            metric("ความสมบูรณ์ข้อมูล", total - 0, 90.0),  # placeholder — same as total
            metric("คำสำคัญ", has_keyword, 90.0),
            metric("รูปภาพ", has_image, 90.0),
            metric("บริบท", has_context, 90.0),
            metric("คะแนนมัธยฐาน", has_rating, 50.0),
        ],
        open_issues=max(0, total - min(has_context, has_keyword, has_image)),
    )


def _recent_activity(session: Session) -> RecentActivityListOut:
    """Last 5 interaction_logs rows joined with item names."""
    rows = session.execute(
        select(
            InteractionLog.id,
            InteractionLog.action_type,
            InteractionLog.metadata_json,
            InteractionLog.created_at,
            InteractionLog.user_key,
            Item.artifact_item_id,
            Item.name,
        )
        .join(Item, Item.id == InteractionLog.item_id, isouter=True)
        .order_by(InteractionLog.created_at.desc())
        .limit(5)
    ).all()

    items: List[RecentActivityRow] = []
    for log_id, action_type, metadata_json, created_at, user_key, artifact_id, item_name in rows:
        target = str(item_name) if item_name else ""
        if not target and metadata_json:
            target = _extract_term(str(action_type), metadata_json) or "(รายการที่ถูกลบ)"
        items.append(
            RecentActivityRow(
                log_id=int(log_id),
                time=created_at.isoformat() if created_at else "",
                action=str(action_type),
                target=target,
                user=str(user_key or "anon"),
                type=str(action_type),
            )
        )
    return RecentActivityListOut(items=items)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _safe_pct_change(current: int, previous: int) -> Optional[float]:
    if previous <= 0:
        return None
    return round((current - previous) * 100 / previous, 1)


def _zero_dashboard(range_days: int, generated_at: str, source: str) -> DashboardOut:
    """Return a fully-zeroed payload (used when DB is disabled)."""
    empty = KpiTile(label="", value="—", raw_value=0.0, delta_pct=None, tone="neutral", hint="")
    return DashboardOut(
        range_days=range_days,
        generated_at=generated_at,
        source=source,
        kpis=KpiStripOut(
            members=empty.model_copy(update={"label": "สมาชิก"}),
            performances=empty.model_copy(update={"label": "ชุดการแสดง"}),
            indices=empty.model_copy(update={"label": "ค่าดัชนี"}),
            points=empty.model_copy(update={"label": "คะแนน"}),
            active_users=empty.model_copy(update={"label": "ผู้ใช้งานที่ใช้งาน"}),
            sessions=empty.model_copy(update={"label": "เซสชัน"}),
        ),
        trend_30d=TrendOut(),
        user_growth=UserGrowthOut(),
        usage_heatmap=HeatmapOut(matrix=[[0] * 24 for _ in range(7)]),
        popular_categories=CategoryListOut(),
        popular_subcontexts=SubContextListOut(),
        top_search_terms=TopSearchListOut(),
        rating_distribution=RatingDistributionOut(),
        model_quality=ModelQualityOut(source="unavailable"),
        quality_trend_30d=TrendOut(),
        algorithm_kpis=AlgorithmKpiOut(),
        top_keywords=KeywordListOut(),
        page_quality=PageQualityOut(),
        recent_activity=RecentActivityListOut(),
    )
