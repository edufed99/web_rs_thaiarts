// lib/server/analytics.ts — build the ``GET /metrics/analytics`` payload
// for the admin analysis workspace (issue #9).
//
// Port of the legacy FastAPI ``services/analytics_service.py``. Only
// aggregate statistics are included — user keys, names, and row-level
// histories never leave the application. The behavior section is computed
// from persisted recommendation requests and attributed interaction logs;
// the AI insight cards use the deterministic evidence rules (the optional
// Gemini rewrite of the legacy service is not re-implemented, so
// ``engine`` is always ``"rules"``).

import type {
  AIInsightsOut,
  ActionBreakdownRow,
  AnalyticsOut,
  AudienceSegment,
  BehaviorAnalyticsOut,
  FunnelStep,
  InsightCard,
  KeywordPairRow,
} from "@/lib/types";
import { getDataSource } from "@/db/connection";
import { InteractionLogEntity } from "@/db/entities/Members";
import {
  RecommendationRequestEntity,
  RecommendationRequestSelectedKeywordEntity,
} from "@/db/entities/RecommendationRequests";
import { buildDashboardPayload } from "@/lib/server/dashboard";

const ACTION_LABELS: Record<string, string> = {
  item_view: "ดูรายละเอียด",
  view: "ดูรายละเอียด",
  search: "ค้นหา",
  keyword_click: "เลือก Keyword",
  like: "ถูกใจ",
  unlike: "ยกเลิกถูกใจ",
  save: "บันทึก",
  unsave: "ยกเลิกบันทึก",
  rate: "ให้คะแนน",
};

const POSITIVE_ACTIONS = new Set(["like", "save", "rate"]);
const VIEW_ACTIONS = new Set(["item_view", "view"]);

export async function buildAnalyticsPayload(rangeDays = 30): Promise<AnalyticsOut> {
  const safeDays = Math.min(365, Math.max(1, Math.floor(rangeDays) || 30));
  const trends = await buildDashboardPayload(safeDays);
  const generatedAt = new Date().toISOString();

  let behavior: BehaviorAnalyticsOut = { funnel: emptyFunnel(), actions: [], keyword_pairs: [], audience_segments: [], active_users: 0, returning_users: 0, engaged_users: 0, engagement_rate: 0 };
  try {
    const dataSource = await getDataSource();
    behavior = await buildBehavior(dataSource, new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000));
  } catch {
    // Analytics degrade like the dashboard: zeroed behavior, never 500.
  }

  const insights = ruleInsights(trends, behavior, safeDays);
  return {
    range_days: safeDays,
    generated_at: generatedAt,
    source: trends.source,
    trends: privacySafeTrends(trends),
    behavior,
    ai_insights: insights,
  };
}

/** Strip row-level user identifiers from the trends' recent activity feed. */
function privacySafeTrends(trends: Awaited<ReturnType<typeof buildDashboardPayload>>) {
  return {
    ...trends,
    recent_activity: {
      items: trends.recent_activity.items.map((row) => ({
        ...row,
        user: String(row.user ?? "").startsWith("user:") ? "สมาชิก" : "ผู้ใช้ไม่ระบุตัวตน",
      })),
    },
  };
}

// fallow-ignore-next-line complexity -- Ported 1:1 from the legacy analytics service; splitting would break parity with the reference implementation.
async function buildBehavior(
  dataSource: Awaited<ReturnType<typeof getDataSource>>,
  since: Date,
): Promise<BehaviorAnalyticsOut> {
  const requestRows = await dataSource.getRepository(RecommendationRequestEntity)
    .createQueryBuilder("request")
    .select("request.id", "id")
    .where("request.created_at >= :since", { since })
    .getRawMany<{ id: string }>();
  const requestIds = new Set(requestRows.map((row) => Number(row.id)));

  const logRows = await dataSource.getRepository(InteractionLogEntity)
    .createQueryBuilder("log")
    .select("log.recommendation_request_id", "request_id")
    .addSelect("log.action_type", "action_type")
    .addSelect("log.user_key", "user_key")
    .where("log.created_at >= :since", { since })
    .getRawMany<{ request_id: string | null; action_type: string; user_key: string }>();

  const actionCounts = new Map<string, number>();
  const activeUserKeys = new Set<string>();
  const engagedUserKeys = new Set<string>();
  const viewRequests = new Set<number>();
  const positiveRequests = new Set<number>();
  const ratedRequests = new Set<number>();
  for (const row of logRows) {
    const action = String(row.action_type ?? "").trim();
    const userKey = String(row.user_key ?? "").trim();
    if (action) actionCounts.set(action, (actionCounts.get(action) ?? 0) + 1);
    if (userKey) activeUserKeys.add(userKey);
    if (action && POSITIVE_ACTIONS.has(action) && userKey) engagedUserKeys.add(userKey);
    if (row.request_id !== null) {
      const requestId = Number(row.request_id);
      if (VIEW_ACTIONS.has(action)) viewRequests.add(requestId);
      if (POSITIVE_ACTIONS.has(action)) positiveRequests.add(requestId);
      if (action === "rate") ratedRequests.add(requestId);
    }
  }

  const detailRequests = intersection(requestIds, viewRequests);
  const engagedRequests = intersection(detailRequests, positiveRequests);
  const feedbackRequests = intersection(detailRequests, ratedRequests);
  const funnel = funnelSteps([
    ["search", "ค้นหา/ขอคำแนะนำ", requestIds.size],
    ["detail", "ดูรายละเอียด", detailRequests.size],
    ["engage", "ถูกใจหรือบันทึก", engagedRequests.size],
    ["rate", "ให้คะแนน", feedbackRequests.size],
  ]);

  const totalActions = [...actionCounts.values()].reduce((sum, count) => sum + count, 0);
  const actions: ActionBreakdownRow[] = [...actionCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 10)
    .map(([action, count]) => ({
      action,
      label: ACTION_LABELS[action] ?? action,
      count,
      pct: pct(count, totalActions),
    }));

  // First-seen timestamp per user key, for the "returning" segment.
  const firstSeenRows = await dataSource.getRepository(InteractionLogEntity)
    .createQueryBuilder("log")
    .select("log.user_key", "user_key")
    .addSelect("MIN(log.created_at)", "first_seen")
    .groupBy("log.user_key")
    .getRawMany<{ user_key: string; first_seen: Date }>();
  const firstSeen = new Map(firstSeenRows.map((row) => [String(row.user_key), new Date(row.first_seen).getTime()]));
  let returning = 0;
  for (const userKey of activeUserKeys) {
    const first = firstSeen.get(userKey);
    if (first !== undefined && first < since.getTime()) returning += 1;
  }

  const authenticated = [...activeUserKeys].filter((key) => key.startsWith("user:")).length;
  const anonymous = activeUserKeys.size - authenticated;
  const activeTotal = activeUserKeys.size;
  const segments: AudienceSegment[] = [
    {
      key: "authenticated",
      label: "สมาชิกที่เข้าสู่ระบบ",
      count: authenticated,
      pct: pct(authenticated, activeTotal),
      definition: "user_key ที่ผูกกับบัญชีสมาชิก",
    },
    {
      key: "anonymous",
      label: "ผู้ใช้ไม่ระบุตัวตน",
      count: anonymous,
      pct: pct(anonymous, activeTotal),
      definition: "ผู้ใช้แบบ anon โดยไม่เปิดเผยตัวตน",
    },
    {
      key: "returning",
      label: "ผู้ใช้กลับมาใช้งาน",
      count: returning,
      pct: pct(returning, activeTotal),
      definition: "เคยมีกิจกรรมก่อนช่วงเวลาที่เลือกและกลับมาใช้อีก",
    },
    {
      key: "engaged",
      label: "ผู้ใช้ที่มีส่วนร่วม",
      count: engagedUserKeys.size,
      pct: pct(engagedUserKeys.size, activeTotal),
      definition: "มีการถูกใจ บันทึก หรือให้คะแนนอย่างน้อยหนึ่งครั้ง",
    },
  ];

  return {
    funnel,
    actions,
    keyword_pairs: await keywordPairs(dataSource, since),
    audience_segments: segments,
    active_users: activeTotal,
    returning_users: returning,
    engaged_users: engagedUserKeys.size,
    engagement_rate: pct(engagedUserKeys.size, activeTotal),
  };
}

// fallow-ignore-next-line complexity -- Ported 1:1 from the legacy analytics service; splitting would break parity with the reference implementation.
async function keywordPairs(
  dataSource: Awaited<ReturnType<typeof getDataSource>>,
  since: Date,
): Promise<KeywordPairRow[]> {
  const rows = await dataSource.getRepository(RecommendationRequestSelectedKeywordEntity)
    .createQueryBuilder("selection")
    .innerJoin("RecommendationRequest", "request", "request.id = selection.request_id")
    .innerJoin("CatalogueKeyword", "keyword", "keyword.id = selection.keyword_id")
    .select("selection.request_id", "request_id")
    .addSelect("keyword.name", "name")
    .where("request.created_at >= :since", { since })
    .getRawMany<{ request_id: string; name: string }>();

  const byRequest = new Map<number, Set<string>>();
  for (const row of rows) {
    const clean = String(row.name ?? "").trim();
    if (!clean) continue;
    const names = byRequest.get(Number(row.request_id)) ?? new Set<string>();
    names.add(clean);
    byRequest.set(Number(row.request_id), names);
  }
  const counts = new Map<string, number>();
  for (const names of byRequest.values()) {
    const sorted = [...names].sort();
    for (let left = 0; left < sorted.length; left += 1) {
      for (let right = left + 1; right < sorted.length; right += 1) {
        const key = `${sorted[left]}||${sorted[right]}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, count]) => {
      const [left, right] = key.split("||");
      return { left, right, count };
    });
}

// ---------------------------------------------------------------------------
// Evidence-grounded rule insights (no LLM in the Application Backend)
// ---------------------------------------------------------------------------

// fallow-ignore-next-line complexity -- Ported 1:1 from the legacy analytics service; splitting would break parity with the reference implementation.
function ruleInsights(
  trends: Awaited<ReturnType<typeof buildDashboardPayload>>,
  behavior: BehaviorAnalyticsOut,
  rangeDays: number,
): AIInsightsOut {
  const ttlSeconds = Math.min(86400, Math.max(60, Number(process.env.ANALYTICS_CACHE_TTL_SECONDS) || 600));
  const searches = behavior.funnel[0]?.count ?? 0;
  const detail = behavior.funnel[1]?.count ?? 0;
  const conversion = pct(detail, searches);
  const sessionDelta = trends.kpis.sessions.delta_pct;
  const topKeyword = trends.top_keywords.items[0] ?? null;
  const quality = trends.model_quality;
  const openIssues = trends.page_quality.open_issues;

  const trafficTone = (sessionDelta ?? 0) >= 0 ? "positive" : "warning";
  const trafficText =
    sessionDelta !== null
      ? `Sessions เปลี่ยนแปลง ${sessionDelta >= 0 ? "+" : ""}${sessionDelta.toFixed(1)}% เมื่อเทียบช่วงก่อนหน้า`
      : "ยังไม่มีช่วงก่อนหน้ามากพอสำหรับการเปรียบเทียบ Sessions";
  const trafficConfidence = Math.min(0.95, 0.55 + searches / 500.0);
  const conversionTone = searches > 0 && conversion < 35 ? "warning" : "positive";

  const cards: InsightCard[] = [
    {
      id: "traffic",
      title: "ทิศทางการใช้งานระบบ",
      summary: trafficText,
      evidence: [
        `Sessions ในช่วงนี้ ${Math.round(trends.kpis.sessions.raw_value).toLocaleString("en-US")} ครั้ง`,
        `Active users ${behavior.active_users.toLocaleString("en-US")} คน`,
      ],
      recommendation:
        trafficTone === "positive"
          ? "รักษาช่องทางที่สร้างการใช้งานและติดตามแนวโน้มรายสัปดาห์"
          : "ตรวจวันที่และช่วงเวลาที่การใช้งานลดลง แล้วทบทวนช่องทางประชาสัมพันธ์",
      confidence: trafficConfidence,
      tone: trafficTone,
    },
    {
      id: "funnel",
      title: "จุดเปลี่ยนสำคัญของ Funnel",
      summary: `Search → Detail อยู่ที่ ${conversion.toFixed(1)}%`,
      evidence: [
        `คำขอคำแนะนำ ${searches.toLocaleString("en-US")} ครั้ง`,
        `คำขอที่นำไปสู่การดูรายละเอียด ${detail.toLocaleString("en-US")} ครั้ง`,
        `Engagement rate ต่อผู้ใช้ ${behavior.engagement_rate.toFixed(1)}%`,
      ],
      recommendation:
        conversion < 35
          ? "ทดลองปรับคำอธิบายและภาพของผลลัพธ์อันดับต้นเพื่อเพิ่มการเปิดรายละเอียด"
          : "รักษาคุณภาพผลลัพธ์อันดับต้น และติดตามขั้นถูกใจ/บันทึกต่อ",
      confidence: trafficConfidence,
      tone: conversionTone,
    },
    {
      id: "demand",
      title: "ความต้องการที่เด่นที่สุด",
      summary: topKeyword ? `“${topKeyword.term}” เป็น Keyword อันดับหนึ่ง` : "ยังไม่มี Keyword มากพอสำหรับระบุความต้องการเด่น",
      evidence: topKeyword
        ? [`ถูกเลือก ${topKeyword.count.toLocaleString("en-US")} ครั้ง`, `มีคู่ Keyword ${behavior.keyword_pairs.length.toLocaleString("en-US")} คู่`]
        : ["Top Keywords ยังไม่มีข้อมูล", "คู่ Keyword ยังไม่มีข้อมูล"],
      recommendation: topKeyword
        ? "ตรวจความครอบคลุมของ catalog และ Context ที่สัมพันธ์กับ Keyword นี้"
        : "เพิ่มการบันทึก Keyword จาก Recommendation flow ก่อนวิเคราะห์ความต้องการ",
      confidence: topKeyword ? trafficConfidence : 0.45,
      tone: "neutral",
    },
    {
      id: "quality",
      title: "คุณภาพโมเดลและข้อมูล",
      summary:
        quality.source !== "unavailable"
          ? `nDCG@10 ${quality.ndcg10.toFixed(3)} · Coverage ${quality.coverage.toFixed(3)}`
          : "ยังไม่มี Evaluation run สำหรับยืนยันคุณภาพโมเดล",
      evidence: [
        `แหล่ง Evaluation: ${quality.source}`,
        `Violation rate ${quality.violation_rate.toFixed(3)}`,
        `ประเด็นคุณภาพข้อมูลที่เปิดอยู่ ${openIssues.toLocaleString("en-US")} รายการ`,
      ],
      recommendation:
        quality.source === "unavailable" || openIssues > 0
          ? "แก้รายการข้อมูลที่ไม่ครบและรัน Evaluation ใหม่ก่อนสรุปผลเชิงนโยบาย"
          : "คุณภาพอยู่ในเกณฑ์ดี ควรกำหนดรอบ Evaluation อย่างสม่ำเสมอ",
      confidence: quality.source !== "unavailable" ? 0.85 : 0.5,
      tone: quality.source === "unavailable" || openIssues > 0 ? "warning" : "positive",
    },
  ];

  return {
    engine: "rules",
    generated_at: new Date().toISOString(),
    cached: false,
    cache_ttl_seconds: ttlSeconds,
    privacy_notice:
      "สรุปจากข้อมูลรวม พร้อมหลักฐานตรวจสอบได้ — ตัวเลขเป็นเพียงสถิติรวม ไม่เปิดเผยข้อมูลส่วนบุคคล",
    items: cards,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyFunnel(): FunnelStep[] {
  return funnelSteps([
    ["search", "ค้นหา/ขอคำแนะนำ", 0],
    ["detail", "ดูรายละเอียด", 0],
    ["engage", "ถูกใจหรือบันทึก", 0],
    ["rate", "ให้คะแนน", 0],
  ]);
}

function funnelSteps(rows: Array<[string, string, number]>): FunnelStep[] {
  const start = rows[0]?.[2] ?? 0;
  let previous = start;
  return rows.map(([key, label, count], index) => {
    const step: FunnelStep = {
      key,
      label,
      count,
      rate_from_previous: index === 0 && count > 0 ? 100 : pct(count, previous),
      conversion_from_start: pct(count, start),
    };
    previous = count;
    return step;
  });
}

function intersection(left: Set<number>, right: Set<number>): Set<number> {
  return new Set([...left].filter((value) => right.has(value)));
}

function pct(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 10000) / 100;
}
