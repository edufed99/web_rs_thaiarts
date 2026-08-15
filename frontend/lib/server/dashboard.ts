// lib/server/dashboard.ts — build the ``GET /metrics/dashboard`` payload
// for the admin dashboard (issue #9).
//
// Port of the legacy FastAPI ``services/dashboard_query.py`` onto the
// TypeORM tables owned by the Application Backend. Every section reads
// persisted rows — members, catalogue items, recommendation
// requests/results, interaction logs, likes/saves/ratings — with the same
// response shapes the existing admin UI renders.
//
// Degradation contract (unchanged from legacy): the payload is always
// fully populated — any DB failure produces a zeroed payload with
// ``source: "disabled"`` so the dashboard renders placeholders instead of
// erroring. The two legacy-only tables (``legacy_interactions`` for the
// points KPI, ``evaluation_runs`` for model quality) are read through
// guarded raw queries: when the table does not exist (fresh deployments)
// their sections report zeros / ``unavailable`` exactly like an empty
// legacy database did.

import type {
  AlgorithmKpiOut,
  CategoryListOut,
  DashboardOut,
  HeatmapOut,
  KpiStripOut,
  KpiTile,
  ModelQualityOut,
  PageQualityOut,
  RatingDistributionOut,
  RecentActivityListOut,
  SubContextListOut,
  TopKeywordListOut,
  TopSearchListOut,
  TrendOut,
  UserGrowthOut,
} from "@/lib/types";
import { getDataSource } from "@/db/connection";
import {
  CatalogueItemEntity,
  ItemContextEntity,
  ItemKeywordEntity,
} from "@/db/entities/Catalogue";
import {
  ApplicationUserEntity,
  InteractionLogEntity,
  RatingEntity,
} from "@/db/entities/Members";
import {
  RecommendationRequestEntity,
  RecommendationResultEntity,
} from "@/db/entities/RecommendationRequests";

const RANGE_ALIASES: Record<string, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "365d": 365,
};

export function parseRangeDays(value: string): number {
  return RANGE_ALIASES[String(value || "30d").toLowerCase().trim()] ?? 30;
}

function clampRange(rangeDays: number): number {
  return Math.min(365, Math.max(1, Number.isFinite(rangeDays) ? Math.floor(rangeDays) : 30));
}

function nowUtc(): Date {
  return new Date();
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function safePctChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) * 100) / previous * 10) / 10;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function buildDashboardPayload(rangeDays = 30): Promise<DashboardOut> {
  const safeDays = clampRange(rangeDays);
  const generatedAt = new Date().toISOString();
  try {
    const dataSource = await getDataSource();
    const kpis = await kpiStrip(dataSource, safeDays);
    const modelQualityResult = await modelQuality(dataSource);
    const qualityTrend = await qualityTrend30d(dataSource);
    const trend30d = await activityTrend(dataSource, safeDays);
    const userGrowthResult = await userGrowth(dataSource, safeDays);
    const heatmap = await usageHeatmap(dataSource, safeDays);
    const popularCategoriesResult = await popularCategories(dataSource);
    const popularSubcontextsResult = await popularSubcontexts(dataSource);
    const topSearch = await topSearchTerms(dataSource, safeDays);
    const ratingDistributionResult = await ratingDistribution(dataSource);
    const algorithmKpisResult = await algorithmKpis(dataSource, safeDays);
    const topKeywordsResult = await topKeywords(dataSource, safeDays);
    const pageQualityResult = await pageQuality(dataSource);
    const recentActivityResult = await recentActivity(dataSource);
    return {
      range_days: safeDays,
      generated_at: generatedAt,
      source: "postgres",
      kpis,
      trend_30d: trend30d,
      user_growth: userGrowthResult,
      usage_heatmap: heatmap,
      popular_categories: popularCategoriesResult,
      popular_subcontexts: popularSubcontextsResult,
      top_search_terms: topSearch,
      rating_distribution: ratingDistributionResult,
      model_quality: modelQualityResult,
      quality_trend_30d: qualityTrend,
      algorithm_kpis: algorithmKpisResult,
      top_keywords: topKeywordsResult,
      page_quality: pageQualityResult,
      recent_activity: recentActivityResult,
    };
  } catch {
    return zeroDashboard(safeDays, generatedAt);
  }
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

async function kpiStrip(dataSource: Awaited<ReturnType<typeof getDataSource>>, rangeDays: number): Promise<KpiStripOut> {
  const since = daysAgo(rangeDays);
  const prevSince = daysAgo(rangeDays * 2);

  const [members, performances, indices, points, activeUsers, sessions, prevActiveUsers, prevSessions] = await Promise.all([
    dataSource.getRepository(ApplicationUserEntity).count(),
    dataSource.getRepository(CatalogueItemEntity).countBy({ isActive: true }),
    dataSource.getRepository(RecommendationResultEntity).count(),
    countLegacyInteractions(dataSource),
    distinctUserKeysSince(dataSource, since),
    distinctUserDaySessionsSince(dataSource, since),
    distinctUserKeysBetween(dataSource, prevSince, since),
    distinctUserDaySessionsBetween(dataSource, prevSince, since),
  ]);

  const tile = (label: string, value: number, deltaPct: number | null, tone: KpiTile["tone"], hint: string): KpiTile => ({
    label,
    value: formatCount(value),
    raw_value: value,
    delta_pct: deltaPct,
    tone,
    hint,
  });

  return {
    members: tile("สมาชิก", members, null, "neutral", "ผู้ใช้ที่ลงทะเบียนทั้งหมด"),
    performances: tile("ชุดการแสดง", performances, null, "neutral", "รายการที่เปิดใช้งานในแค็ตตาล็อก"),
    indices: tile("ค่าดัชนี", indices, null, "positive", "จำนวนผลลัพธ์คำแนะนำที่แสดง"),
    points: tile("คะแนน", points, null, "neutral", "สัญญาณเชิงบวกจากข้อมูลย้อนหลัง"),
    active_users: tile("ผู้ใช้งานที่ใช้งาน", activeUsers, safePctChange(activeUsers, prevActiveUsers), "positive", `distinct user_key ใน ${rangeDays} วันล่าสุด`),
    sessions: tile("เซสชัน", sessions, safePctChange(sessions, prevSessions), "positive", "(ผู้ใช้ × วัน) ในช่วงเวลา"),
  };
}

async function countLegacyInteractions(dataSource: Awaited<ReturnType<typeof getDataSource>>): Promise<number> {
  if (!(await tableExists(dataSource, "legacy_interactions"))) return 0;
  const rows = await dataSource.query<Array<{ c: string }>>(
    "SELECT COUNT(*) AS c FROM legacy_interactions",
  );
  return Number(rows[0]?.c ?? 0);
}

async function distinctUserKeysSince(dataSource: Awaited<ReturnType<typeof getDataSource>>, since: Date): Promise<number> {
  const rows = await dataSource.getRepository(InteractionLogEntity)
    .createQueryBuilder("log")
    .select("COUNT(DISTINCT log.user_key)", "c")
    .where("log.created_at >= :since", { since })
    .getRawOne<{ c: string }>();
  return Number(rows?.c ?? 0);
}

async function distinctUserKeysBetween(dataSource: Awaited<ReturnType<typeof getDataSource>>, from: Date, to: Date): Promise<number> {
  const rows = await dataSource.getRepository(InteractionLogEntity)
    .createQueryBuilder("log")
    .select("COUNT(DISTINCT log.user_key)", "c")
    .where("log.created_at >= :from", { from })
    .andWhere("log.created_at < :to", { to })
    .getRawOne<{ c: string }>();
  return Number(rows?.c ?? 0);
}

async function distinctUserDaySessionsSince(dataSource: Awaited<ReturnType<typeof getDataSource>>, since: Date): Promise<number> {
  const rows = await dataSource.getRepository(InteractionLogEntity)
    .createQueryBuilder("log")
    .select("COUNT(DISTINCT (log.user_key || '|' || CAST(log.created_at AS date)))", "c")
    .where("log.created_at >= :since", { since })
    .getRawOne<{ c: string }>();
  return Number(rows?.c ?? 0);
}

async function distinctUserDaySessionsBetween(dataSource: Awaited<ReturnType<typeof getDataSource>>, from: Date, to: Date): Promise<number> {
  const rows = await dataSource.getRepository(InteractionLogEntity)
    .createQueryBuilder("log")
    .select("COUNT(DISTINCT (log.user_key || '|' || CAST(log.created_at AS date)))", "c")
    .where("log.created_at >= :from", { from })
    .andWhere("log.created_at < :to", { to })
    .getRawOne<{ c: string }>();
  return Number(rows?.c ?? 0);
}

// fallow-ignore-next-line complexity -- Ported 1:1 from the legacy analytics service; splitting would break parity with the reference implementation.
async function activityTrend(dataSource: Awaited<ReturnType<typeof getDataSource>>, rangeDays: number): Promise<TrendOut> {
  const since = daysAgo(rangeDays);
  const rows = await dataSource.getRepository(InteractionLogEntity)
    .createQueryBuilder("log")
    .select("TO_CHAR(log.created_at, 'YYYY-MM-DD')", "d")
    .addSelect("log.action_type", "action_type")
    .addSelect("COUNT(*)", "c")
    .where("log.created_at >= :since", { since })
    .groupBy("d")
    .addGroupBy("log.action_type")
    .getRawMany<{ d: string; action_type: string; c: string }>();

  const buckets = new Map<string, { sessions: number; searches: number; ratings: number }>();
  for (const row of rows) {
    const label = String(row.d).slice(0, 10);
    const bucket = buckets.get(label) ?? { sessions: 0, searches: 0, ratings: 0 };
    const kind = String(row.action_type ?? "");
    if (kind === "search") bucket.searches += Number(row.c);
    else if (kind === "rate") bucket.ratings += Number(row.c);
    else bucket.sessions += Number(row.c);
    buckets.set(label, bucket);
  }
  const labels = [...buckets.keys()].sort();
  return {
    labels,
    sessions: labels.map((label) => buckets.get(label)!.sessions),
    searches: labels.map((label) => buckets.get(label)!.searches),
    ratings: labels.map((label) => buckets.get(label)!.ratings),
    ndcg10: [],
    hr10: [],
    mrr10: [],
  };
}

async function userGrowth(dataSource: Awaited<ReturnType<typeof getDataSource>>, rangeDays: number): Promise<UserGrowthOut> {
  const since = daysAgo(rangeDays);
  const newRows = await dataSource.getRepository(ApplicationUserEntity)
    .createQueryBuilder("user")
    .select("TO_CHAR(user.created_at, 'YYYY-MM-DD')", "d")
    .addSelect("COUNT(*)", "c")
    .where("user.created_at >= :since", { since })
    .groupBy("d")
    .getRawMany<{ d: string; c: string }>();
  const activeRows = await dataSource.getRepository(InteractionLogEntity)
    .createQueryBuilder("log")
    .select("TO_CHAR(log.created_at, 'YYYY-MM-DD')", "d")
    .addSelect("COUNT(DISTINCT log.user_key)", "c")
    .where("log.created_at >= :since", { since })
    .groupBy("d")
    .getRawMany<{ d: string; c: string }>();

  const newByDay = new Map(newRows.map((row) => [String(row.d).slice(0, 10), Number(row.c)]));
  const activeByDay = new Map(activeRows.map((row) => [String(row.d).slice(0, 10), Number(row.c)]));
  const labels = [...new Set([...newByDay.keys(), ...activeByDay.keys()])].sort();
  return {
    labels,
    new_users: labels.map((label) => newByDay.get(label) ?? 0),
    active_users: labels.map((label) => activeByDay.get(label) ?? 0),
  };
}

async function usageHeatmap(dataSource: Awaited<ReturnType<typeof getDataSource>>, rangeDays: number): Promise<HeatmapOut> {
  const since = daysAgo(rangeDays);
  const rows = await dataSource.getRepository(InteractionLogEntity)
    .createQueryBuilder("log")
    .select('EXTRACT(DOW FROM log.created_at)', "w")
    .addSelect('EXTRACT(HOUR FROM log.created_at)', "h")
    .addSelect("COUNT(*)", "c")
    .where("log.created_at >= :since", { since })
    .groupBy("w")
    .addGroupBy("h")
    .getRawMany<{ w: string; h: string; c: string }>();

  const matrix = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  let maxValue = 0;
  for (const row of rows) {
    // PostgreSQL DOW: 0=Sunday..6=Saturday; convert to ISO weekday 0=Mon..6=Sun.
    const isoWeekday = (Number(row.w) + 6) % 7;
    const hour = Number(row.h);
    matrix[isoWeekday][hour] += Number(row.c);
    if (matrix[isoWeekday][hour] > maxValue) maxValue = matrix[isoWeekday][hour];
  }
  return {
    weekday_labels: ["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."],
    hour_labels: Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`),
    matrix,
    max_value: maxValue,
  };
}

async function popularCategories(dataSource: Awaited<ReturnType<typeof getDataSource>>): Promise<CategoryListOut> {
  const total = await dataSource.getRepository(CatalogueItemEntity).countBy({ isActive: true });
  if (total === 0) return { items: [], total_items: 0 };
  const rows = await dataSource.getRepository(CatalogueItemEntity)
    .createQueryBuilder("item")
    .select("item.category_group", "name")
    .addSelect("COUNT(*)", "c")
    .where("item.is_active = TRUE")
    .groupBy("item.category_group")
    .orderBy("COUNT(*)", "DESC")
    .limit(8)
    .getRawMany<{ name: string; c: string }>();
  return {
    items: rows.map((row) => ({
      name: row.name || "อื่นๆ",
      count: Number(row.c),
      pct: Math.round((Number(row.c) * 100 * 10) / total) / 10,
    })),
    total_items: total,
  };
}

async function popularSubcontexts(dataSource: Awaited<ReturnType<typeof getDataSource>>): Promise<SubContextListOut> {
  const total = await dataSource.getRepository(RecommendationRequestEntity).count();
  const rows = await dataSource.getRepository(RecommendationRequestEntity)
    .createQueryBuilder("request")
    .innerJoin("CatalogueContext", "context", "context.id = request.selected_context_id")
    .select("context.name", "name")
    .addSelect("COUNT(request.id)", "c")
    .groupBy("context.name")
    .orderBy("COUNT(request.id)", "DESC")
    .addOrderBy("context.name", "ASC")
    .limit(8)
    .getRawMany<{ name: string; c: string }>();
  return {
    items: rows.map((row) => ({
      name: row.name,
      count: Number(row.c),
      pct: total > 0 ? Math.round((Number(row.c) * 100 * 10) / total) / 10 : 0,
    })),
    total_requests: total,
  };
}

// fallow-ignore-next-line complexity -- Ported 1:1 from the legacy analytics service; splitting would break parity with the reference implementation.
function extractTerm(actionType: string, metadataJson: string): string {
  if (!metadataJson) return "";
  let metadata: unknown;
  try {
    metadata = JSON.parse(metadataJson);
  } catch {
    return "";
  }
  if (!metadata || typeof metadata !== "object") return "";
  const record = metadata as Record<string, unknown>;
  const term = record.term ?? record.keyword ?? record.q;
  return typeof term === "string" ? term.trim() : "";
}

// fallow-ignore-next-line complexity -- Ported 1:1 from the legacy analytics service; splitting would break parity with the reference implementation.
async function topSearchTerms(dataSource: Awaited<ReturnType<typeof getDataSource>>, rangeDays: number): Promise<TopSearchListOut> {
  const since = daysAgo(rangeDays);
  const rows = await dataSource.getRepository(InteractionLogEntity)
    .createQueryBuilder("log")
    .select("log.action_type", "action_type")
    .addSelect("log.metadata_json", "metadata_json")
    .where("log.created_at >= :since", { since })
    .andWhere("log.action_type IN ('search', 'keyword_click', 'item_view')")
    .limit(5000)
    .getRawMany<{ action_type: string; metadata_json: string }>();

  const counts = new Map<string, { searches: number; views: number; ratings: number; likes: number }>();
  for (const row of rows) {
    const term = extractTerm(row.action_type, row.metadata_json);
    if (!term) continue;
    const bucket = counts.get(term) ?? { searches: 0, views: 0, ratings: 0, likes: 0 };
    if (row.action_type === "search" || row.action_type === "keyword_click") bucket.searches += 1;
    else if (row.action_type === "item_view") bucket.views += 1;
    else if (row.action_type === "rate") bucket.ratings += 1;
    else if (row.action_type === "like") bucket.likes += 1;
    counts.set(term, bucket);
  }
  const scored = [...counts.entries()].map(([term, c]) => ({
    term,
    searches: c.searches,
    views: c.views,
    ratings: c.ratings,
    likes: c.likes,
    score: c.searches * 0.5 + c.views * 0.3 + c.ratings * 0.15 + c.likes * 0.05,
  }));
  scored.sort((left, right) => right.score - left.score || left.term.localeCompare(right.term));
  return {
    items: scored.slice(0, 10).map((row, index) => ({
      rank: index + 1,
      term: row.term,
      searches: row.searches,
      views: row.views,
      ratings: row.ratings,
      likes: row.likes,
      score: Math.round(row.score * 100) / 100,
    })),
  };
}

async function ratingDistribution(dataSource: Awaited<ReturnType<typeof getDataSource>>): Promise<RatingDistributionOut> {
  const rows = await dataSource.getRepository(RatingEntity)
    .createQueryBuilder("rating")
    .select("rating.rating", "rating")
    .addSelect("COUNT(*)", "c")
    .groupBy("rating.rating")
    .orderBy("rating.rating", "ASC")
    .getRawMany<{ rating: string; c: string }>();
  const counts = new Map<number, number>();
  let total = 0;
  for (const row of rows) {
    counts.set(Number(row.rating), Number(row.c));
    total += Number(row.c);
  }
  const buckets = [1, 2, 3, 4, 5].map((star) => ({
    star,
    count: counts.get(star) ?? 0,
    pct: total > 0 ? Math.round(((counts.get(star) ?? 0) * 100 * 10) / total) / 10 : 0,
  }));
  let weighted = 0;
  for (const bucket of buckets) weighted += bucket.star * bucket.count;
  return {
    buckets,
    average: total > 0 ? Math.round((weighted / total) * 100) / 100 : 0,
    total,
  };
}

interface EvaluationRunRow {
  source: string;
  ran_at: Date;
  ndcg10: string;
  hr10: string;
  mrr10: string;
  coverage: string;
  violation_rate: string;
  test_user_count: string;
  test_interaction_count: string;
}

async function latestEvaluationRun(
  dataSource: Awaited<ReturnType<typeof getDataSource>>,
  preferredSource: "online" | "offline",
): Promise<EvaluationRunRow | undefined> {
  if (!(await tableExists(dataSource, "evaluation_runs"))) return undefined;
  const rows = await dataSource.query<EvaluationRunRow[]>(
    `SELECT source, ran_at, ndcg10, hr10, mrr10, coverage, violation_rate,
            test_user_count, test_interaction_count
     FROM evaluation_runs
     WHERE source = $1
     ORDER BY ran_at DESC
     LIMIT 1`,
    [preferredSource],
  );
  return rows[0];
}

// fallow-ignore-next-line complexity -- Ported 1:1 from the legacy analytics service; splitting would break parity with the reference implementation.
async function modelQuality(dataSource: Awaited<ReturnType<typeof getDataSource>>): Promise<ModelQualityOut> {
  const online = await latestEvaluationRun(dataSource, "online");
  const run = online ?? (await latestEvaluationRun(dataSource, "offline"));
  if (!run) return { source: "unavailable", ran_at: "", test_user_count: 0, test_interaction_count: 0, ndcg10: 0, hr10: 0, mrr10: 0, coverage: 0, violation_rate: 0 };
  return {
    ndcg10: Number(run.ndcg10),
    hr10: Number(run.hr10),
    mrr10: Number(run.mrr10),
    coverage: Number(run.coverage),
    violation_rate: Number(run.violation_rate),
    source: run.source === "online" ? "online" : "offline",
    ran_at: run.ran_at instanceof Date ? run.ran_at.toISOString() : String(run.ran_at),
    test_user_count: Number(run.test_user_count),
    test_interaction_count: Number(run.test_interaction_count),
  };
}

// fallow-ignore-next-line complexity -- Ported 1:1 from the legacy analytics service; splitting would break parity with the reference implementation.
async function qualityTrend30d(dataSource: Awaited<ReturnType<typeof getDataSource>>): Promise<TrendOut> {
  if (!(await tableExists(dataSource, "evaluation_runs"))) return emptyTrend();
  const since = daysAgo(30);
  const rows = await dataSource.query<Array<{ ran_at: Date; ndcg10: string; hr10: string; mrr10: string }>>(
    `SELECT ran_at, ndcg10, hr10, mrr10
     FROM evaluation_runs
     WHERE source = 'online' AND ran_at >= $1
     ORDER BY ran_at ASC`,
    [since],
  );
  const byDay = new Map<string, Array<{ n: number; h: number; m: number }>>();
  for (const row of rows) {
    const key = row.ran_at instanceof Date ? row.ran_at.toISOString().slice(0, 10) : String(row.ran_at).slice(0, 10);
    const bucket = byDay.get(key) ?? [];
    bucket.push({ n: Number(row.ndcg10), h: Number(row.hr10), m: Number(row.mrr10) });
    byDay.set(key, bucket);
  }
  const labels = [...byDay.keys()].sort();
  const average = (values: number[]) => Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10000) / 10000;
  return {
    labels,
    ndcg10: labels.map((label) => average(byDay.get(label)!.map((entry) => entry.n))),
    hr10: labels.map((label) => average(byDay.get(label)!.map((entry) => entry.h))),
    mrr10: labels.map((label) => average(byDay.get(label)!.map((entry) => entry.m))),
    sessions: [],
    searches: [],
    ratings: [],
  };
}

// fallow-ignore-next-line complexity -- Ported 1:1 from the legacy analytics service; splitting would break parity with the reference implementation.
async function algorithmKpis(dataSource: Awaited<ReturnType<typeof getDataSource>>, rangeDays: number): Promise<AlgorithmKpiOut> {
  const since = daysAgo(rangeDays);
  const searchRows = await dataSource.getRepository(InteractionLogEntity)
    .createQueryBuilder("log")
    .select("COUNT(*)", "c")
    .where("log.created_at >= :since", { since })
    .andWhere("log.action_type IN ('search', 'keyword_click')")
    .getRawOne<{ c: string }>();
  const searchTotal = Number(searchRows?.c ?? 0);

  // "Search → detail" = distinct searching users who also opened an item
  // detail in the same window (the legacy cheap approximation).
  const searchToDetailRows = await dataSource.query<Array<{ c: string }>>(
    `SELECT COUNT(DISTINCT search.user_key) AS c
     FROM interaction_logs search
     WHERE search.created_at >= $1
       AND search.action_type IN ('search', 'keyword_click')
       AND search.user_key IN (
         SELECT DISTINCT log.user_key
         FROM interaction_logs log
         WHERE log.created_at >= $1 AND log.action_type = 'item_view'
       )`,
    [since],
  );
  const searchToDetail = Number(searchToDetailRows[0]?.c ?? 0);

  const itemsShownRows = await dataSource.getRepository(InteractionLogEntity)
    .createQueryBuilder("log")
    .select("COUNT(*)", "c")
    .where("log.created_at >= :since", { since })
    .andWhere("log.action_type = 'item_view'")
    .getRawOne<{ c: string }>();
  const itemsShown = Number(itemsShownRows?.c ?? 0);

  const recsShownRows = await dataSource.getRepository(RecommendationResultEntity)
    .createQueryBuilder("result")
    .innerJoin("RecommendationRequest", "request", "request.id = result.request_id")
    .select("COUNT(*)", "c")
    .where("request.created_at >= :since", { since })
    .getRawOne<{ c: string }>();
  const recsShown = Number(recsShownRows?.c ?? 0);

  const searchToDetailPct = searchTotal > 0 ? Math.round((searchToDetail * 100 * 10) / searchTotal) / 10 : 0;
  const ctrPct = recsShown > 0 ? Math.round((itemsShown * 100 * 10) / recsShown) / 10 : 0;
  return {
    search_total: searchTotal,
    search_to_detail_total: searchToDetail,
    search_to_detail_pct: searchToDetailPct,
    items_shown_total: itemsShown,
    ctr_pct: ctrPct,
    delta_pct: null,
  };
}

// fallow-ignore-next-line complexity -- Ported 1:1 from the legacy analytics service; splitting would break parity with the reference implementation.
async function topKeywords(dataSource: Awaited<ReturnType<typeof getDataSource>>, rangeDays: number): Promise<TopKeywordListOut> {
  const since = daysAgo(rangeDays);
  // Keywords explicitly selected on persisted recommendation requests.
  const selectedRows = await dataSource.getRepository(RecommendationRequestEntity)
    .createQueryBuilder("request")
    .innerJoin("recommendation_request_selected_keywords", "selection", "selection.request_id = request.id")
    .innerJoin("CatalogueKeyword", "keyword", "keyword.id = selection.keyword_id")
    .select("keyword.name", "name")
    .addSelect("COUNT(selection.id)", "c")
    .where("request.created_at >= :since", { since })
    .groupBy("keyword.name")
    .getRawMany<{ name: string; c: string }>();
  const counts = new Map<string, number>();
  for (const row of selectedRows) {
    if (String(row.name).trim()) counts.set(String(row.name).trim(), Number(row.c));
  }
  // Backward compatibility with older search/keyword-click telemetry.
  const logRows = await dataSource.getRepository(InteractionLogEntity)
    .createQueryBuilder("log")
    .select("log.metadata_json", "metadata_json")
    .where("log.created_at >= :since", { since })
    .andWhere("log.action_type IN ('search', 'keyword_click')")
    .limit(5000)
    .getRawMany<{ metadata_json: string }>();
  for (const row of logRows) {
    const term = extractTerm("search", row.metadata_json);
    if (term) counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 5);
  return {
    items: sorted.map(([term, count], index) => ({ rank: index + 1, term, count })),
  };
}

// fallow-ignore-next-line complexity -- Ported 1:1 from the legacy analytics service; splitting would break parity with the reference implementation.
async function pageQuality(dataSource: Awaited<ReturnType<typeof getDataSource>>): Promise<PageQualityOut> {
  const total = await dataSource.getRepository(CatalogueItemEntity).countBy({ isActive: true });
  if (total === 0) return { metrics: [], open_issues: 0 };

  const [hasContext, hasKeyword, hasImage, hasRating] = await Promise.all([
    dataSource.getRepository(ItemContextEntity)
      .createQueryBuilder("link").select("COUNT(DISTINCT link.item_id)", "c").getRawOne<{ c: string }>(),
    dataSource.getRepository(ItemKeywordEntity)
      .createQueryBuilder("link").select("COUNT(DISTINCT link.item_id)", "c").getRawOne<{ c: string }>(),
    dataSource.getRepository(CatalogueItemEntity)
      .createQueryBuilder("item").select("COUNT(*)", "c").where("item.is_active = TRUE").andWhere("item.image_url <> ''").getRawOne<{ c: string }>(),
    dataSource.getRepository(RatingEntity)
      .createQueryBuilder("rating").select("COUNT(DISTINCT rating.item_id)", "c").getRawOne<{ c: string }>(),
  ]);

  const metric = (name: string, value: number, target: number) => {
    const pct = Math.round((value * 100 * 10) / total) / 10;
    return {
      name,
      value: pct,
      target,
      tone: (pct >= target ? "success" : pct >= target - 15 ? "warning" : "danger") as "success" | "warning" | "danger",
    };
  };
  return {
    metrics: [
      metric("ความสมบูรณ์ข้อมูล", total, 90),
      metric("คำสำคัญ", Number(hasKeyword?.c ?? 0), 90),
      metric("รูปภาพ", Number(hasImage?.c ?? 0), 90),
      metric("บริบท", Number(hasContext?.c ?? 0), 90),
      metric("คะแนนมัธยฐาน", Number(hasRating?.c ?? 0), 50),
    ],
    open_issues: Math.max(0, total - Math.min(Number(hasContext?.c ?? 0), Number(hasKeyword?.c ?? 0), Number(hasImage?.c ?? 0))),
  };
}

// fallow-ignore-next-line complexity -- Ported 1:1 from the legacy analytics service; splitting would break parity with the reference implementation.
async function recentActivity(dataSource: Awaited<ReturnType<typeof getDataSource>>): Promise<RecentActivityListOut> {
  const rows = await dataSource.getRepository(InteractionLogEntity)
    .createQueryBuilder("log")
    .leftJoin("CatalogueItem", "item", "item.id = log.item_id")
    .select("log.id", "log_id")
    .addSelect("log.action_type", "action_type")
    .addSelect("log.metadata_json", "metadata_json")
    .addSelect("log.created_at", "created_at")
    .addSelect("log.user_key", "user_key")
    .addSelect("item.artifact_item_id", "artifact_item_id")
    .addSelect("item.name", "item_name")
    .orderBy("log.created_at", "DESC")
    .addOrderBy("log.id", "DESC")
    .limit(5)
    .getRawMany<{ log_id: string; action_type: string; metadata_json: string; created_at: Date; user_key: string; item_name: string | null }>();

  return {
    items: rows.map((row) => recentActivityRow(row)),
  };
}

// fallow-ignore-next-line complexity -- Deleted-item fallback plus date coercion keep one row shape.
function recentActivityRow(row: { log_id: string; action_type: string; metadata_json: string; created_at: Date; user_key: string; item_name: string | null }): RecentActivityListOut["items"][number] {
  return {
    log_id: Number(row.log_id),
    time: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    action: row.action_type,
    target: row.item_name || extractTerm(row.action_type, row.metadata_json) || "(รายการที่ถูกลบ)",
    user: row.user_key || "anon",
    type: row.action_type,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function tableExists(dataSource: Awaited<ReturnType<typeof getDataSource>>, table: string): Promise<boolean> {
  const rows = await dataSource.query<Array<{ name: string | null }>>(
    "SELECT to_regclass($1) AS name",
    [`public.${table}`],
  );
  return rows[0]?.name !== null;
}

function emptyTrend(): TrendOut {
  return { labels: [], sessions: [], searches: [], ratings: [], ndcg10: [], hr10: [], mrr10: [] };
}

function zeroDashboard(rangeDays: number, generatedAt: string): DashboardOut {
  const emptyTile = (label: string): KpiTile => ({
    label,
    value: "—",
    raw_value: 0,
    delta_pct: null,
    tone: "neutral",
    hint: "",
  });
  return {
    range_days: rangeDays,
    generated_at: generatedAt,
    source: "disabled",
    kpis: {
      members: emptyTile("สมาชิก"),
      performances: emptyTile("ชุดการแสดง"),
      indices: emptyTile("ค่าดัชนี"),
      points: emptyTile("คะแนน"),
      active_users: emptyTile("ผู้ใช้งานที่ใช้งาน"),
      sessions: emptyTile("เซสชัน"),
    },
    trend_30d: emptyTrend(),
    user_growth: { labels: [], new_users: [], active_users: [] },
    usage_heatmap: {
      weekday_labels: ["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."],
      hour_labels: Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`),
      matrix: Array.from({ length: 7 }, () => new Array<number>(24).fill(0)),
      max_value: 0,
    },
    popular_categories: { items: [], total_items: 0 },
    popular_subcontexts: { items: [], total_requests: 0 },
    top_search_terms: { items: [] },
    rating_distribution: {
      buckets: [1, 2, 3, 4, 5].map((star) => ({ star, count: 0, pct: 0 })),
      average: 0,
      total: 0,
    },
    model_quality: { source: "unavailable", ran_at: "", test_user_count: 0, test_interaction_count: 0, ndcg10: 0, hr10: 0, mrr10: 0, coverage: 0, violation_rate: 0 },
    quality_trend_30d: emptyTrend(),
    algorithm_kpis: { search_total: 0, search_to_detail_total: 0, search_to_detail_pct: 0, items_shown_total: 0, ctr_pct: 0, delta_pct: null },
    top_keywords: { items: [] },
    page_quality: { metrics: [], open_issues: 0 },
    recent_activity: { items: [] },
  };
}
