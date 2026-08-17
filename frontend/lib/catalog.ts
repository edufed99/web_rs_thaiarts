// lib/catalog.ts — Catalogue browse/get/batch/similar/legacy-stats +
// engagement + contexts + keywords endpoint functions.

import type {
  ContextListOut,
  EngagementListOut,
  ItemListOut,
  ItemOut,
  KeywordListOut,
  LegacyStatsOut,
} from "./types";
import { getAuthHeaders } from "./auth";
import { baseUrl, handle } from "./http";

export async function getContexts(): Promise<ContextListOut> {
  const res = await fetch(`${baseUrl()}/contexts`, { cache: "no-store" });
  return handle<ContextListOut>(res);
}

export async function getKeywords(
  search?: string,
  limit?: number,
  contextId?: number,
): Promise<KeywordListOut> {
  const params = new URLSearchParams();
  if (search && search.trim().length > 0) {
    params.set("search", search.trim());
  }
  if (limit !== undefined) params.set("limit", String(limit));
  if (contextId !== undefined) params.set("context_id", String(contextId));
  const url = `${baseUrl()}/keywords${params.toString() ? `?${params.toString()}` : ""}`;
  const res = await fetch(url, { cache: "no-store" });
  return handle<KeywordListOut>(res);
}

export async function getItems(opts?: {
  search?: string;
  limit?: number;
  offset?: number;
  contextId?: number;
  userKey?: string;
  extraHeaders?: Record<string, string>;
}): Promise<ItemListOut> {
  const params = new URLSearchParams();
  if (opts?.search) params.set("search", opts.search);
  if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts?.offset !== undefined) params.set("offset", String(opts.offset));
  if (opts?.contextId !== undefined) params.set("context", String(opts.contextId));
  // Session cookies personalize member state server-side; user_key is never
  // forwarded to any Python origin — the Application Backend owns personalization.
  const url = `${baseUrl()}/items${params.toString() ? `?${params.toString()}` : ""}`;
  const res = await fetch(url, {
    headers: { ...getAuthHeaders(), ...(opts?.extraHeaders ?? {}) },
    cache: "no-store",
  });
  return handle<ItemListOut>(res);
}

export async function getItem(
  itemId: number,
  opts?: { userKey?: string; extraHeaders?: Record<string, string> },
): Promise<ItemOut> {
  const res = await fetch(`${baseUrl()}/items/${itemId}`, {
    headers: { ...getAuthHeaders(), ...(opts?.extraHeaders ?? {}) },
    cache: "no-store",
  });
  return handle<ItemOut>(res);
}

export async function getItemsBatch(
  itemIds: number[],
  opts?: { userKey?: string; extraHeaders?: Record<string, string> },
): Promise<ItemListOut> {
  if (itemIds.length === 0) return { items: [], total: 0 };
  const params = new URLSearchParams({ ids: itemIds.join(",") });
  const res = await fetch(`${baseUrl()}/items/batch?${params.toString()}`, {
    headers: { ...getAuthHeaders(), ...(opts?.extraHeaders ?? {}) },
    cache: "no-store",
  });
  return handle<ItemListOut>(res);
}

export async function getSimilarItems(
  itemId: number,
  opts?: { limit?: number; userKey?: string; extraHeaders?: Record<string, string> },
): Promise<ItemListOut> {
  const params = new URLSearchParams({ limit: String(opts?.limit ?? 4) });
  const res = await fetch(`${baseUrl()}/items/${itemId}/similar?${params.toString()}`, {
    headers: { ...getAuthHeaders(), ...(opts?.extraHeaders ?? {}) },
    cache: "no-store",
  });
  return handle<ItemListOut>(res);
}

/**
 * Real per-item rating stats from the legacy Postgres table.
 * Used by the home / dashboard cards instead of fake-rendered numbers.
 * Endpoint is anonymous (no JWT required) and returns zeros if the DB
 * layer is disabled.
 */
export async function getItemLegacyStats(itemId: number): Promise<LegacyStatsOut> {
  const res = await fetch(`${baseUrl()}/items/${itemId}/legacy-stats`, {
    cache: "no-store",
  });
  return handle<LegacyStatsOut>(res);
}

/**
 * Batch live-engagement counters (likes + saves + positive ratings) for the
 * given artifact item ids. Used by the public homepage to rank the "popular
 * performances" section by actual user engagement rather than the legacy
 * rating aggregate. Returns the same shape as the backend
 * ``EngagementListOut`` — sorted by ``engagement_score`` desc, with one
 * zero row per requested id that has no engagement at all.
 */
export async function getItemEngagementBatch(
  itemIds: number[],
  opts?: { range?: "all" | "7d" | "30d" | "90d" | "365d" },
): Promise<EngagementListOut> {
  if (itemIds.length === 0) {
    return { engagements: [], source: "postgres" };
  }
  const params = new URLSearchParams({ ids: itemIds.join(",") });
  if (opts?.range && opts.range !== "all") params.set("range", opts.range);
  const res = await fetch(`${baseUrl()}/items/engagement?${params.toString()}`, {
    cache: "no-store",
  });
  return handle<EngagementListOut>(res);
}

interface LegacyStatsBatchOut {
  stats: LegacyStatsOut[];
}

/**
 * Batch form of ``getItemLegacyStats``. Hits the ``/legacy-stats`` endpoint
 * which does a single round-trip for up to 200 ids, avoiding the N+1 fan-out
 * that the parallel helper above caused on grids (it also kept relying on
 * the per-id route, which only returned zeros before the id-translation fix).
 *
 * Unknown ids and network failures degrade to a zero-stat entry so the UI
 * can keep rendering rather than fail the whole grid.
 */
export async function getItemLegacyStatsBatch(
  itemIds: number[],
): Promise<Map<number, LegacyStatsOut>> {
  if (itemIds.length === 0) return new Map();
  const res = await fetch(`${baseUrl()}/legacy-stats?ids=${itemIds.join(",")}`, {
    cache: "no-store",
  });
  let body: LegacyStatsBatchOut;
  try {
    body = await handle<LegacyStatsBatchOut>(res);
  } catch {
    return new Map(
      itemIds.map((id) => [
        id,
        { item_id: id, count: 0, avg_rating: 0, source: "disabled" as const },
      ]),
    );
  }
  return new Map(body.stats.map((s) => [s.item_id, s]));
}
