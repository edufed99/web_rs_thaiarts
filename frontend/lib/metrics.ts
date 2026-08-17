// lib/metrics.ts — Corpus + live-table metrics + admin dashboard endpoints.

import type {
  AnalyticsOut,
  DashboardOut,
  HealthOut,
  MetricsOut,
  ModelConfigOut,
  RequestTrendOut,
} from "./types";
import { getAuthHeaders } from "./auth";
import { baseUrl, handle } from "./http";
import { ApiClientError } from "./errors";

// fallow-ignore-next-line unused-export -- Preserved public API client contract.
export async function getHealth(): Promise<HealthOut> {
  const res = await fetch(`${baseUrl()}/health`, { cache: "no-store" });
  return handle<HealthOut>(res);
}

export async function getMetrics(): Promise<MetricsOut> {
  const res = await fetch(`${baseUrl()}/metrics`, { cache: "no-store" });
  return handle<MetricsOut>(res);
}

/**
 * Monthly request/shown trend for the dashboard chart. Falls back to
 * an empty trend with ``source='disabled'`` when the DB layer is off.
 */
// fallow-ignore-next-line unused-export -- Preserved public API client contract.
export async function getRequestTrend(months: number = 12): Promise<RequestTrendOut> {
  const safeMonths = Math.min(36, Math.max(1, Math.floor(months)));
  const url = `${baseUrl()}/metrics/requests?months=${safeMonths}`;
  const res = await fetch(url, { cache: "no-store" });
  return handle<RequestTrendOut>(res);
}

/**
 * Active recommender configuration the backend is serving (from
 * ``best_model_config.json`` + RECSYS_* env vars). Used by the dashboard
 * model-control sliders to render real values.
 */
// fallow-ignore-next-line unused-export -- Preserved public API client contract.
export async function getModelConfig(): Promise<ModelConfigOut> {
  const res = await fetch(`${baseUrl()}/metrics/config`, { cache: "no-store" });
  return handle<ModelConfigOut>(res);
}

/**
 * Full admin dashboard payload from ``GET /metrics/dashboard``. Admin-only —
 * the backend rejects this call without a JWT for an ``is_admin=True`` user.
 * Falls back to a zeroed payload with ``source: "disabled"`` when the DB
 * layer is off.
 */
export async function getDashboard(
  range: "7d" | "30d" | "90d" | "365d" = "30d",
): Promise<DashboardOut> {
  const res = await fetch(`${baseUrl()}/metrics/dashboard?range=${range}`, {
    headers: { ...getAuthHeaders() },
    cache: "no-store",
  });
  return handle<DashboardOut>(res);
}

export async function getAnalytics(
  range: "7d" | "30d" | "90d" | "365d" = "30d",
): Promise<AnalyticsOut> {
  const res = await fetch(`${baseUrl()}/metrics/analytics?range=${range}`, {
    headers: { ...getAuthHeaders() },
    cache: "no-store",
  });
  return handle<AnalyticsOut>(res);
}

export async function downloadDashboardReport(
  range: "7d" | "30d" | "90d" | "365d" = "30d",
): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(`${baseUrl()}/metrics/dashboard/export?range=${range}`, {
    headers: { ...getAuthHeaders() },
    cache: "no-store",
  });
  if (!res.ok) {
    await handle<never>(res);
    throw new ApiClientError(res.status, "export_failed", "ส่งออกรายงานไม่สำเร็จ");
  }
  const fallback = `thai_arts_dashboard_${new Date().toISOString().slice(0, 10)}_${range}.xlsx`;
  const disposition = res.headers.get("Content-Disposition") || "";
  const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
  return {
    blob: await res.blob(),
    filename: filenameMatch?.[1] || fallback,
  };
}
