// lib/server/metrics.ts — corpus metrics, recommendation-request trend, and
// the active recommender configuration, served by the Application Backend.
//
// These are the issue #9 ports of the legacy FastAPI ``/metrics``,
// ``/metrics/requests`` and ``/metrics/config`` routes. The response shapes
// are unchanged so existing consumers (homepage, researcher tooling) keep
// working; only the data sources moved: live counts come from the TypeORM
// tables instead of the legacy SQLAlchemy session, and the artifact-derived
// fields (CF index stats, embedding dim) are zeroed because the Application
// Backend never opens ``artifacts/`` (architecture invariant #2).

import type { MetricsOut, ModelConfigOut, RequestTrendBucket, RequestTrendOut } from "@/lib/types";
import { getDataSource } from "@/db/connection";
import { CatalogueContextEntity, CatalogueItemEntity, CatalogueKeywordEntity } from "@/db/entities/Catalogue";
import { RecommendationRequestEntity, RecommendationResultEntity } from "@/db/entities/RecommendationRequests";

const THAI_MONTH_LABELS = [
  "", "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

function monthWindow(months: number): { startYear: number; startMonth: number } {
  const today = new Date();
  let year = today.getUTCFullYear();
  let month = today.getUTCMonth() + 1;
  for (let step = 1; step < months; step += 1) {
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return { startYear: year, startMonth: month };
}

function* iterateMonthBuckets(
  startYear: number,
  startMonth: number,
  count: number,
): Generator<{ year: number; month: number; label: string }> {
  let year = startYear;
  let month = startMonth;
  for (let index = 0; index < count; index += 1) {
    yield { year, month, label: THAI_MONTH_LABELS[month] };
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
}

/**
 * ``GET /metrics`` — aggregated corpus counts plus the build identity.
 * Item/context/keyword counts come from the live tables; the CF-index
 * fields (positive users, edges, embedding dim, artifact build) are
 * artifact-owned and therefore reported as zeros/empty by the Application
 * Backend (the private model service holds that state).
 */
export async function corpusMetrics(): Promise<MetricsOut> {
  const dataSource = await getDataSource();
  const [itemCount, contextCount, keywordCount] = await Promise.all([
    dataSource.getRepository(CatalogueItemEntity).countBy({ isActive: true }),
    dataSource.getRepository(CatalogueContextEntity).count(),
    dataSource.getRepository(CatalogueKeywordEntity).count(),
  ]);
  return {
    item_count: itemCount,
    context_count: contextCount,
    keyword_count: keywordCount,
    positive_user_count: 0,
    unique_item_user_edges: 0,
    embedding_dim: 0,
    artifacts_loaded_at: "",
    config_hash: "",
  };
}

/**
 * ``GET /metrics/requests?months=N`` — monthly recommendation-request
 * trend aggregated from the persisted ``recommendation_requests`` /
 * ``recommendation_results`` rows (the same tables the legacy dashboard
 * chart read). Returns zeroed buckets with ``source: "disabled"`` when
 * the database is unavailable so the chart never 500s.
 */
// fallow-ignore-next-line complexity -- Ported 1:1 from the legacy analytics service; splitting would break parity with the reference implementation.
export async function requestTrend(months = 12): Promise<RequestTrendOut> {
  const safeMonths = Math.min(36, Math.max(1, Math.floor(months)));
  const { startYear, startMonth } = monthWindow(safeMonths);
  const bucketsIndex = new Map<string, { requestCount: number; shownCount: number }>();
  for (const bucket of iterateMonthBuckets(startYear, startMonth, safeMonths)) {
    bucketsIndex.set(`${bucket.year}:${bucket.month}`, { requestCount: 0, shownCount: 0 });
  }

  let source: RequestTrendOut["source"] = "disabled";
  let totalRequests = 0;
  let totalShown = 0;
  try {
    const dataSource = await getDataSource();
    const since = new Date(Date.UTC(startYear, startMonth - 1, 1));
    const requests = await dataSource
      .getRepository(RecommendationRequestEntity)
      .createQueryBuilder("request")
      .select('EXTRACT(YEAR FROM request.created_at)', "y")
      .addSelect('EXTRACT(MONTH FROM request.created_at)', "m")
      .addSelect("COUNT(*)", "c")
      .where("request.created_at >= :since", { since })
      .groupBy("y")
      .addGroupBy("m")
      .getRawMany<{ y: string; m: string; c: string }>();
    const shown = await dataSource
      .getRepository(RecommendationResultEntity)
      .createQueryBuilder("result")
      .innerJoin("RecommendationRequest", "request", "request.id = result.request_id")
      .select('EXTRACT(YEAR FROM request.created_at)', "y")
      .addSelect('EXTRACT(MONTH FROM request.created_at)', "m")
      .addSelect("COUNT(*)", "c")
      .where("request.created_at >= :since", { since })
      .groupBy("y")
      .addGroupBy("m")
      .getRawMany<{ y: string; m: string; c: string }>();
    source = "postgres";
    for (const row of requests) {
      const key = `${Number(row.y)}:${Number(row.m)}`;
      const bucket = bucketsIndex.get(key);
      if (bucket) {
        bucket.requestCount += Number(row.c);
        totalRequests += Number(row.c);
      }
    }
    for (const row of shown) {
      const key = `${Number(row.y)}:${Number(row.m)}`;
      const bucket = bucketsIndex.get(key);
      if (bucket) {
        bucket.shownCount += Number(row.c);
        totalShown += Number(row.c);
      }
    }
  } catch {
    // Dashboard trend must degrade to zeros, never 500.
    source = "disabled";
    totalRequests = 0;
    totalShown = 0;
  }

  const buckets: RequestTrendBucket[] = [];
  for (const { year, month, label } of iterateMonthBuckets(startYear, startMonth, safeMonths)) {
    const data = bucketsIndex.get(`${year}:${month}`) ?? { requestCount: 0, shownCount: 0 };
    buckets.push({
      year,
      month,
      label,
      request_count: data.requestCount,
      shown_count: data.shownCount,
    });
  }
  return {
    months: safeMonths,
    total_requests: totalRequests,
    total_shown: totalShown,
    source,
    buckets,
  };
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(parsed) ? parsed : fallback;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = Number(raw);
  return raw !== undefined && raw !== "" && Number.isSafeInteger(parsed) ? parsed : fallback;
}

/**
 * ``GET /metrics/config`` — the active recommender configuration the
 * Application Backend serves. Mirrors the legacy response built from
 * ``best_model_config.json`` + ``RECSYS_*`` env overrides; here the
 * values are derived from the same ``RECSYS_*`` environment so the
 * dashboard's model sliders keep reflecting reality.
 */
export function activeModelConfig(): ModelConfigOut {
  return {
    cbf_model: process.env.RECSYS_E5_MODEL || "intfloat/multilingual-e5-large-instruct",
    cf_model: "ItemKNN",
    hybrid_method: "Hybrid-WeightedSum",
    hybrid_alpha: envFloat("RECSYS_HYBRID_ALPHA", 0.7),
    candidate_strategy: "EligibilityGate",
    embedding_dim: null,
    itemknn_k: envInt("RECSYS_ITEMKNN_K", 10),
    itemknn_shrink: envFloat("RECSYS_ITEMKNN_SHRINK", 50.0),
    cbf_keyword_boost: envFloat("RECSYS_CBF_KEYWORD_BOOST", 0.05),
    positive_threshold: envInt("RECSYS_POSITIVE_THRESHOLD", 4),
    extra: {},
  };
}
