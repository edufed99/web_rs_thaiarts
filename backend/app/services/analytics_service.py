"""Aggregate-only analytics for the admin analysis workspace.

The Gemini path receives only totals, percentages, and already-grounded rule
insights. User keys, names, e-mail addresses, and row-level histories never
leave the application.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from itertools import combinations
import json
import logging
from threading import Lock
import time
from typing import Dict, Iterable, List, Tuple

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.config import get_settings
from ..db import is_db_enabled, session_scope
from ..models_db import (
    InteractionLog,
    Keyword,
    RecommendationRequest,
    RecommendationRequestSelectedKeyword,
)
from ..schemas.analytics import (
    AIInsightsOut,
    ActionBreakdownRow,
    AnalyticsOut,
    AudienceSegment,
    BehaviorAnalyticsOut,
    FunnelStep,
    InsightCard,
    KeywordPairRow,
)
from .dashboard_query import build_dashboard_payload


logger = logging.getLogger("recsys.analytics")
_cache_lock = Lock()
_insight_cache: Dict[str, Tuple[float, AIInsightsOut]] = {}


ACTION_LABELS = {
    "item_view": "ดูรายละเอียด",
    "view": "ดูรายละเอียด",
    "search": "ค้นหา",
    "keyword_click": "เลือก Keyword",
    "like": "ถูกใจ",
    "unlike": "ยกเลิกถูกใจ",
    "save": "บันทึก",
    "unsave": "ยกเลิกบันทึก",
    "rate": "ให้คะแนน",
}
POSITIVE_ACTIONS = {"like", "save", "rate"}
VIEW_ACTIONS = {"item_view", "view"}


def build_analytics_payload(range_days: int = 30) -> AnalyticsOut:
    range_days = max(1, min(int(range_days or 30), 365))
    trends = _privacy_safe_trends(build_dashboard_payload(range_days=range_days))
    generated_at = datetime.now(timezone.utc).isoformat()

    behavior = BehaviorAnalyticsOut(funnel=_empty_funnel())
    if is_db_enabled():
        try:
            with session_scope() as session:
                if session is not None:
                    behavior = _build_behavior(
                        session,
                        datetime.now(timezone.utc) - timedelta(days=range_days),
                    )
        except Exception:  # noqa: BLE001 - analytics should degrade like dashboard
            logger.exception("Could not build behavior analytics")

    insights = _cached_insights(range_days, trends, behavior)
    return AnalyticsOut(
        range_days=range_days,
        generated_at=generated_at,
        source=trends.source,
        trends=trends,
        behavior=behavior,
        ai_insights=insights,
    )


def _privacy_safe_trends(trends):
    """Remove row-level user identifiers from the analytics response."""
    safe_recent = trends.recent_activity.model_copy(
        update={
            "items": [
                row.model_copy(
                    update={
                        "user": (
                            "สมาชิก"
                            if str(row.user or "").startswith("user:")
                            else "ผู้ใช้ไม่ระบุตัวตน"
                        )
                    }
                )
                for row in trends.recent_activity.items
            ]
        }
    )
    return trends.model_copy(update={"recent_activity": safe_recent})


def clear_analytics_cache() -> None:
    with _cache_lock:
        _insight_cache.clear()


def _build_behavior(session: Session, since: datetime) -> BehaviorAnalyticsOut:
    request_ids = {
        int(row[0])
        for row in session.execute(
            select(RecommendationRequest.id).where(RecommendationRequest.created_at >= since)
        ).all()
    }
    log_rows = session.execute(
        select(
            InteractionLog.recommendation_request_id,
            InteractionLog.action_type,
            InteractionLog.user_key,
        ).where(InteractionLog.created_at >= since)
    ).all()

    action_counts: Counter[str] = Counter()
    active_user_keys: set[str] = set()
    engaged_user_keys: set[str] = set()
    view_requests: set[int] = set()
    positive_requests: set[int] = set()
    rated_requests: set[int] = set()
    for request_id, raw_action, raw_user_key in log_rows:
        action = str(raw_action or "").strip()
        user_key = str(raw_user_key or "").strip()
        if action:
            action_counts[action] += 1
        if user_key:
            active_user_keys.add(user_key)
        if action in POSITIVE_ACTIONS and user_key:
            engaged_user_keys.add(user_key)
        if request_id is not None:
            request_id = int(request_id)
            if action in VIEW_ACTIONS:
                view_requests.add(request_id)
            if action in POSITIVE_ACTIONS:
                positive_requests.add(request_id)
            if action == "rate":
                rated_requests.add(request_id)

    detail_requests = request_ids & view_requests
    engaged_requests = detail_requests & positive_requests
    feedback_requests = detail_requests & rated_requests
    funnel_counts = [
        ("search", "ค้นหา/ขอคำแนะนำ", len(request_ids)),
        ("detail", "ดูรายละเอียด", len(detail_requests)),
        ("engage", "ถูกใจหรือบันทึก", len(engaged_requests)),
        ("rate", "ให้คะแนน", len(feedback_requests)),
    ]
    funnel = _funnel_steps(funnel_counts)

    total_actions = sum(action_counts.values())
    actions = [
        ActionBreakdownRow(
            action=action,
            label=ACTION_LABELS.get(action, action),
            count=count,
            pct=_pct(count, total_actions),
        )
        for action, count in action_counts.most_common(10)
    ]

    first_seen = {
        str(user_key): created_at
        for user_key, created_at in session.execute(
            select(InteractionLog.user_key, func.min(InteractionLog.created_at)).group_by(
                InteractionLog.user_key
            )
        ).all()
    }
    returning = 0
    for user_key in active_user_keys:
        first = first_seen.get(user_key)
        if first is None:
            continue
        if first.tzinfo is None:
            first = first.replace(tzinfo=timezone.utc)
        if first < since:
            returning += 1

    authenticated = sum(1 for key in active_user_keys if key.startswith("user:"))
    anonymous = len(active_user_keys) - authenticated
    active_total = len(active_user_keys)
    segments = [
        AudienceSegment(
            key="authenticated",
            label="สมาชิกที่เข้าสู่ระบบ",
            count=authenticated,
            pct=_pct(authenticated, active_total),
            definition="user_key ที่ผูกกับบัญชีสมาชิก",
        ),
        AudienceSegment(
            key="anonymous",
            label="ผู้ใช้ไม่ระบุตัวตน",
            count=anonymous,
            pct=_pct(anonymous, active_total),
            definition="ผู้ใช้แบบ anon โดยไม่เปิดเผยตัวตน",
        ),
        AudienceSegment(
            key="returning",
            label="ผู้ใช้กลับมาใช้งาน",
            count=returning,
            pct=_pct(returning, active_total),
            definition="เคยมีกิจกรรมก่อนช่วงเวลาที่เลือกและกลับมาใช้อีก",
        ),
        AudienceSegment(
            key="engaged",
            label="ผู้ใช้ที่มีส่วนร่วม",
            count=len(engaged_user_keys),
            pct=_pct(len(engaged_user_keys), active_total),
            definition="มีการถูกใจ บันทึก หรือให้คะแนนอย่างน้อยหนึ่งครั้ง",
        ),
    ]

    return BehaviorAnalyticsOut(
        funnel=funnel,
        actions=actions,
        keyword_pairs=_keyword_pairs(session, since),
        audience_segments=segments,
        active_users=active_total,
        returning_users=returning,
        engaged_users=len(engaged_user_keys),
        engagement_rate=_pct(len(engaged_user_keys), active_total),
    )


def _keyword_pairs(session: Session, since: datetime) -> List[KeywordPairRow]:
    rows = session.execute(
        select(
            RecommendationRequestSelectedKeyword.request_id,
            Keyword.name,
        )
        .join(
            RecommendationRequest,
            RecommendationRequest.id == RecommendationRequestSelectedKeyword.request_id,
        )
        .join(Keyword, Keyword.id == RecommendationRequestSelectedKeyword.keyword_id)
        .where(RecommendationRequest.created_at >= since)
    ).all()
    by_request: Dict[int, set[str]] = defaultdict(set)
    for request_id, name in rows:
        clean = str(name or "").strip()
        if clean:
            by_request[int(request_id)].add(clean)
    counts: Counter[Tuple[str, str]] = Counter()
    for names in by_request.values():
        for left, right in combinations(sorted(names), 2):
            counts[(left, right)] += 1
    return [
        KeywordPairRow(left=pair[0], right=pair[1], count=count)
        for pair, count in counts.most_common(10)
    ]


def _empty_funnel() -> List[FunnelStep]:
    return _funnel_steps(
        [
            ("search", "ค้นหา/ขอคำแนะนำ", 0),
            ("detail", "ดูรายละเอียด", 0),
            ("engage", "ถูกใจหรือบันทึก", 0),
            ("rate", "ให้คะแนน", 0),
        ]
    )


def _funnel_steps(rows: Iterable[Tuple[str, str, int]]) -> List[FunnelStep]:
    rows = list(rows)
    start = rows[0][2] if rows else 0
    previous = start
    out: List[FunnelStep] = []
    for index, (key, label, count) in enumerate(rows):
        out.append(
            FunnelStep(
                key=key,
                label=label,
                count=count,
                rate_from_previous=100.0 if index == 0 and count else _pct(count, previous),
                conversion_from_start=_pct(count, start),
            )
        )
        previous = count
    return out


def _cached_insights(range_days, trends, behavior) -> AIInsightsOut:
    settings = get_settings()
    ttl = max(60, min(int(settings.analytics_cache_seconds), 86400))
    aggregate = {
        "range_days": range_days,
        "sessions": trends.kpis.sessions.raw_value,
        "session_delta": trends.kpis.sessions.delta_pct,
        "active_users": behavior.active_users,
        "engagement_rate": behavior.engagement_rate,
        "funnel": [step.model_dump() for step in behavior.funnel],
        "top_keywords": [row.model_dump() for row in trends.top_keywords.items[:5]],
        "quality": trends.model_quality.model_dump(),
        "page_quality": trends.page_quality.model_dump(),
    }
    digest = sha256(
        json.dumps(aggregate, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    key = f"{range_days}:{digest}"
    now = time.monotonic()
    with _cache_lock:
        cached = _insight_cache.get(key)
        if cached and now - cached[0] < ttl:
            return cached[1].model_copy(update={"cached": True})

    cards = _rule_insights(trends, behavior)
    engine = "rules"
    if settings.analytics_use_llm and settings.gemini_api_key:
        rewritten = _rewrite_with_gemini(cards)
        if rewritten is not None:
            cards = rewritten
            engine = "gemini"
    result = AIInsightsOut(
        engine=engine,
        generated_at=datetime.now(timezone.utc).isoformat(),
        cached=False,
        cache_ttl_seconds=ttl,
        items=cards,
    )
    with _cache_lock:
        _insight_cache.clear()
        _insight_cache[key] = (now, result)
    return result


def _rule_insights(trends, behavior) -> List[InsightCard]:
    searches = behavior.funnel[0].count if behavior.funnel else 0
    detail = behavior.funnel[1].count if len(behavior.funnel) > 1 else 0
    conversion = _pct(detail, searches)
    session_delta = trends.kpis.sessions.delta_pct
    top_keyword = trends.top_keywords.items[0] if trends.top_keywords.items else None
    quality = trends.model_quality
    open_issues = trends.page_quality.open_issues

    traffic_tone = "positive" if (session_delta or 0) >= 0 else "warning"
    traffic_text = (
        f"Sessions เปลี่ยนแปลง {session_delta:+.1f}% เมื่อเทียบช่วงก่อนหน้า"
        if session_delta is not None
        else "ยังไม่มีช่วงก่อนหน้ามากพอสำหรับการเปรียบเทียบ Sessions"
    )
    confidence = min(0.95, 0.55 + searches / 500.0)
    cards = [
        InsightCard(
            id="traffic",
            title="ทิศทางการใช้งานระบบ",
            summary=traffic_text,
            evidence=[
                f"Sessions ในช่วงนี้ {int(trends.kpis.sessions.raw_value):,} ครั้ง",
                f"Active users {behavior.active_users:,} คน",
            ],
            recommendation=(
                "รักษาช่องทางที่สร้างการใช้งานและติดตามแนวโน้มรายสัปดาห์"
                if traffic_tone == "positive"
                else "ตรวจวันที่และช่วงเวลาที่การใช้งานลดลง แล้วทบทวนช่องทางประชาสัมพันธ์"
            ),
            confidence=confidence,
            tone=traffic_tone,
        ),
        InsightCard(
            id="funnel",
            title="จุดเปลี่ยนสำคัญของ Funnel",
            summary=f"Search → Detail อยู่ที่ {conversion:.1f}%",
            evidence=[
                f"คำขอคำแนะนำ {searches:,} ครั้ง",
                f"คำขอที่นำไปสู่การดูรายละเอียด {detail:,} ครั้ง",
                f"Engagement rate ต่อผู้ใช้ {behavior.engagement_rate:.1f}%",
            ],
            recommendation=(
                "ทดลองปรับคำอธิบายและภาพของผลลัพธ์อันดับต้นเพื่อเพิ่มการเปิดรายละเอียด"
                if conversion < 35
                else "รักษาคุณภาพผลลัพธ์อันดับต้น และติดตามขั้นถูกใจ/บันทึกต่อ"
            ),
            confidence=confidence,
            tone="warning" if searches and conversion < 35 else "positive",
        ),
        InsightCard(
            id="demand",
            title="ความต้องการที่เด่นที่สุด",
            summary=(
                f"“{top_keyword.term}” เป็น Keyword อันดับหนึ่ง"
                if top_keyword
                else "ยังไม่มี Keyword มากพอสำหรับระบุความต้องการเด่น"
            ),
            evidence=(
                [f"ถูกเลือก {top_keyword.count:,} ครั้ง", f"มีคู่ Keyword {len(behavior.keyword_pairs):,} คู่"]
                if top_keyword
                else ["Top Keywords ยังไม่มีข้อมูล", "คู่ Keyword ยังไม่มีข้อมูล"]
            ),
            recommendation=(
                "ตรวจความครอบคลุมของ catalog และ Context ที่สัมพันธ์กับ Keyword นี้"
                if top_keyword
                else "เพิ่มการบันทึก Keyword จาก Recommendation flow ก่อนวิเคราะห์ความต้องการ"
            ),
            confidence=confidence if top_keyword else 0.45,
            tone="neutral",
        ),
        InsightCard(
            id="quality",
            title="คุณภาพโมเดลและข้อมูล",
            summary=(
                f"nDCG@10 {quality.ndcg10:.3f} · Coverage {quality.coverage:.3f}"
                if quality.source != "unavailable"
                else "ยังไม่มี Evaluation run สำหรับยืนยันคุณภาพโมเดล"
            ),
            evidence=[
                f"แหล่ง Evaluation: {quality.source}",
                f"Violation rate {quality.violation_rate:.3f}",
                f"ประเด็นคุณภาพข้อมูลที่เปิดอยู่ {open_issues:,} รายการ",
            ],
            recommendation=(
                "แก้รายการข้อมูลที่ไม่ครบและรัน Evaluation ใหม่ก่อนสรุปผลเชิงนโยบาย"
                if quality.source == "unavailable" or open_issues > 0
                else "คุณภาพอยู่ในเกณฑ์ดี ควรกำหนดรอบ Evaluation อย่างสม่ำเสมอ"
            ),
            confidence=0.85 if quality.source != "unavailable" else 0.5,
            tone="warning" if quality.source == "unavailable" or open_issues > 0 else "positive",
        ),
    ]
    return cards


def _rewrite_with_gemini(cards: List[InsightCard]) -> List[InsightCard] | None:
    """Let Gemini improve wording only; evidence and scores remain server-owned."""
    settings = get_settings()
    safe_cards = [
        {
            "id": card.id,
            "title": card.title,
            "summary": card.summary,
            "evidence": card.evidence,
            "recommendation": card.recommendation,
        }
        for card in cards
    ]
    prompt = (
        "คุณเป็นนักวิเคราะห์ระบบแนะนำชุดการแสดงนาฏศิลป์ไทย "
        "ปรับถ้อยคำ title, summary และ recommendation ให้กระชับและเป็นภาษาไทยทางการ "
        "ห้ามเพิ่มตัวเลข ห้ามเปลี่ยน evidence และห้ามอนุมานข้อมูลรายบุคคล "
        "ตอบ JSON เท่านั้นในรูป {\"insights\":[{\"id\":...,\"title\":...,"
        "\"summary\":...,\"recommendation\":...}]}\nข้อมูลรวม:\n"
        + json.dumps(safe_cards, ensure_ascii=False)
    )
    try:
        from .grounding import _call_gemini

        raw = _call_gemini(prompt, settings.gemini_model, settings.gemini_api_key)
        parsed = json.loads(raw)
        rewrites = {
            str(item.get("id")): item
            for item in parsed.get("insights", [])
            if isinstance(item, dict) and item.get("id")
        }
    except Exception as exc:  # noqa: BLE001
        logger.warning("Gemini analytics rewrite failed: %s", exc)
        return None

    out: List[InsightCard] = []
    for card in cards:
        rewrite = rewrites.get(card.id, {})
        out.append(
            card.model_copy(
                update={
                    "title": _safe_text(rewrite.get("title"), card.title),
                    "summary": _safe_text(rewrite.get("summary"), card.summary),
                    "recommendation": _safe_text(
                        rewrite.get("recommendation"), card.recommendation
                    ),
                }
            )
        )
    return out


def _safe_text(value, fallback: str) -> str:
    clean = str(value or "").strip()
    return clean[:500] if clean else fallback


def _pct(value: int, total: int) -> float:
    if total <= 0:
        return 0.0
    return round((float(value) / float(total)) * 100.0, 2)
