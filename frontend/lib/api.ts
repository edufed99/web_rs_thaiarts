// lib/api.ts — Typed REST client for the FastAPI backend.
//
// Uses the same-origin Next.js Application Backend. Internal service
// addresses stay server-only and are never embedded in browser bundles.

import type {
  ActionRequestIn,
  AnalyticsOut,
  AdminUserCreate,
  AdminUserDeleteOut,
  AdminUserListOut,
  AdminUserUpdate,
  ContextListOut,
  DashboardOut,
  GmailOAuthStartOut,
  GmailOAuthStatusOut,
  GoogleLoginExchange,
  EngagementListOut,
  HealthOut,
  HistoryListOut,
  ItemDeleteOut,
  ItemActionOut,
  ItemCommit,
  ItemCommitOut,
  ItemCreate,
  ItemDraft,
  ItemDraftOut,
  ItemFacetsOut,
  ItemImageUploadOut,
  ItemVideoUploadOut,
  ItemKeywordReassign,
  ItemListOut,
  ItemOut,
  ItemReassignOut,
  ItemUpdate,
  ItemViewOut,
  KeywordListOut,
  LikedItemsOut,
  MemberDashboardOut,
  MemberProfileOut,
  MemberProfileUpdate,
  RatedItemsOut,
  RatingSummaryOut,
  RecentViewsOut,
  SavedItemsOut,
  UserSummaryOut,
  LegacyStatsOut,
  MetricsOut,
  ModelConfigOut,
  PasswordResetConfirm,
  PasswordResetConfirmOut,
  PasswordResetRequest,
  PasswordResetRequestOut,
  ProfileRecommendationResponseOut,
  RecommendationRequestIn,
  RecommendationResponseOut,
  RequestTrendOut,
  TokenOut,
  UserLogin,
  UserOut,
  UserProfileUpdate,
  UserSignup,
  ViewRequestIn,
} from "./types";

import { getAuthHeaders, getCurrentUser } from "./auth";

const DEFAULT_BASE_URL = "/api";

function baseUrl(): string {
  return DEFAULT_BASE_URL;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface ErrorBody {
  error?: {
    code?: string;
    message?: string;
    [k: string]: unknown;
  };
}

async function handle<T>(res: Response): Promise<T> {
  if (res.ok) {
    return (await res.json()) as T;
  }
  let body: ErrorBody = {};
  try {
    body = (await res.json()) as ErrorBody;
  } catch {
    // Non-JSON body — fall through with empty error.
  }
  const code = body.error?.code ?? "http_error";
  const message = body.error?.message ?? `HTTP ${res.status} ${res.statusText}`;
  throw new ApiClientError(res.status, code, message, body.error);
}

// fallow-ignore-next-line unused-export -- Preserved public API client contract.
export async function getHealth(): Promise<HealthOut> {
  const res = await fetch(`${baseUrl()}/health`, { cache: "no-store" });
  return handle<HealthOut>(res);
}

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
  // The backend's ``resolve_user_key`` prefers the JWT bearer token when
  // present and only falls back to the legacy ``anon:<uuid>`` query param
  // for fully anonymous callers. For anonymous users we deliberately omit
  // ``user_key`` so the catalog endpoint skips the per-row live-user-state
  // SELECT — anon users have no personalised likes / saves / ratings to
  // surface, and the extra query was a measurable hot-path cost on the
  // home → /items search flow.
  if (opts?.userKey && getCurrentUser() != null) {
    params.set("user_key", opts.userKey);
  }
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
  const params = new URLSearchParams();
  // Only forward user_key for authenticated members — anonymous callers
  // would 401 on the backend auth check and gain nothing from the per-row
  // user_state lookup anyway.
  if (opts?.userKey && getCurrentUser() != null) {
    params.set("user_key", opts.userKey);
  }
  const url = `${baseUrl()}/items/${itemId}${params.toString() ? `?${params.toString()}` : ""}`;
  const res = await fetch(url, {
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
  if (opts?.userKey && getCurrentUser() != null) params.set("user_key", opts.userKey);
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
  if (opts?.userKey && getCurrentUser() != null) params.set("user_key", opts.userKey);
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

export async function postRecommendations(
  body: RecommendationRequestIn,
  extraHeaders: Record<string, string> = {},
): Promise<RecommendationResponseOut> {
  const res = await fetch(`${baseUrl()}/recommendations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return handle<RecommendationResponseOut>(res);
}

export async function getProfileRecommendations(
  opts?: { topK?: number; extraHeaders?: Record<string, string> },
): Promise<ProfileRecommendationResponseOut> {
  const params = new URLSearchParams();
  if (opts?.topK !== undefined) params.set("top_k", String(opts.topK));
  const url = `${baseUrl()}/recommendations/profile${params.toString() ? `?${params.toString()}` : ""}`;
  const res = await fetch(url, {
    headers: { ...(opts?.extraHeaders ?? {}) },
    cache: "no-store",
  });
  return handle<ProfileRecommendationResponseOut>(res);
}

// --- Live user actions ------------------------------------------------------

function actionBody(body: ActionRequestIn): ActionRequestIn {
  return {
    user_key: body.user_key,
    item_id: body.item_id,
    request_id: body.request_id ?? null,
    context_id: body.context_id ?? null,
    rating: body.rating ?? null,
  };
}

export async function postLike(
  body: ActionRequestIn,
  extraHeaders: Record<string, string> = {},
): Promise<ItemActionOut> {
  const res = await fetch(`${baseUrl()}/actions/like`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(actionBody(body)),
    cache: "no-store",
  });
  return handle<ItemActionOut>(res);
}

export async function deleteLike(
  body: ActionRequestIn,
  extraHeaders: Record<string, string> = {},
): Promise<ItemActionOut> {
  const res = await fetch(`${baseUrl()}/actions/like`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(actionBody(body)),
    cache: "no-store",
  });
  return handle<ItemActionOut>(res);
}

export async function postSave(
  body: ActionRequestIn,
  extraHeaders: Record<string, string> = {},
): Promise<ItemActionOut> {
  const res = await fetch(`${baseUrl()}/actions/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(actionBody(body)),
    cache: "no-store",
  });
  return handle<ItemActionOut>(res);
}

export async function deleteSave(
  body: ActionRequestIn,
  extraHeaders: Record<string, string> = {},
): Promise<ItemActionOut> {
  const res = await fetch(`${baseUrl()}/actions/save`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(actionBody(body)),
    cache: "no-store",
  });
  return handle<ItemActionOut>(res);
}

export async function putRating(
  body: ActionRequestIn,
  extraHeaders: Record<string, string> = {},
): Promise<ItemActionOut> {
  const res = await fetch(`${baseUrl()}/actions/rating`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(actionBody(body)),
    cache: "no-store",
  });
  return handle<ItemActionOut>(res);
}

/**
 * Log an item view (ADR-002 §3.1).
 *
 * Fire-and-forget on purpose: this is telemetry, so a failure must never
 * surface to the user or break the page being measured. Unlike every other
 * call in this file it resolves to `null` on error instead of throwing.
 *
 * The backend dedupes repeats per (user, item) inside a 30-minute window,
 * so callers don't need to guard against re-renders.
 */
export async function postView(
  body: ViewRequestIn,
  extraHeaders: Record<string, string> = {},
): Promise<ItemViewOut | null> {
  try {
    const res = await fetch(`${baseUrl()}/actions/view`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...extraHeaders },
      body: JSON.stringify({
        user_key: body.user_key,
        item_id: body.item_id,
        request_id: body.request_id ?? null,
        context_id: body.context_id ?? null,
      }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as ItemViewOut;
  } catch {
    return null;
  }
}

// --- Auth + Admin ingest ----------------------------------------------------

// --- Member summary (GET /me/*) -------------------------------------------

function memberParams(
  userKey: string,
  extra: Record<string, string | number | undefined> = {},
): string {
  const params = new URLSearchParams();
  params.set("user_key", userKey);
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  }
  return params.toString();
}

export async function getMeSummary(
  userKey: string,
  extraHeaders: Record<string, string> = {},
): Promise<UserSummaryOut> {
  const url = `${baseUrl()}/me/summary?${memberParams(userKey)}`;
  const res = await fetch(url, { headers: { ...extraHeaders }, cache: "no-store" });
  return handle<UserSummaryOut>(res);
}

export async function getMeHistory(
  userKey: string,
  limit = 20,
  extraHeaders: Record<string, string> = {},
): Promise<HistoryListOut> {
  const url = `${baseUrl()}/me/history?${memberParams(userKey, { limit })}`;
  const res = await fetch(url, { headers: { ...extraHeaders }, cache: "no-store" });
  return handle<HistoryListOut>(res);
}

export async function getMeSaved(
  userKey: string,
  extraHeaders: Record<string, string> = {},
): Promise<SavedItemsOut> {
  const url = `${baseUrl()}/me/saved?${memberParams(userKey)}`;
  const res = await fetch(url, { headers: { ...extraHeaders }, cache: "no-store" });
  return handle<SavedItemsOut>(res);
}

export async function getMeLiked(
  userKey: string,
  extraHeaders: Record<string, string> = {},
): Promise<LikedItemsOut> {
  const url = `${baseUrl()}/me/liked?${memberParams(userKey)}`;
  const res = await fetch(url, { headers: { ...extraHeaders }, cache: "no-store" });
  return handle<LikedItemsOut>(res);
}

export async function getMeRated(
  userKey: string,
  extraHeaders: Record<string, string> = {},
): Promise<RatedItemsOut> {
  const url = `${baseUrl()}/me/rated?${memberParams(userKey)}`;
  const res = await fetch(url, { headers: { ...extraHeaders }, cache: "no-store" });
  return handle<RatedItemsOut>(res);
}

export async function getMeRatingSummary(
  userKey: string,
  extraHeaders: Record<string, string> = {},
): Promise<RatingSummaryOut> {
  const url = `${baseUrl()}/me/rating-summary?${memberParams(userKey)}`;
  const res = await fetch(url, { headers: { ...extraHeaders }, cache: "no-store" });
  return handle<RatingSummaryOut>(res);
}

export async function getMeRecentViews(
  userKey: string,
  days = 30,
  limit = 20,
  extraHeaders: Record<string, string> = {},
): Promise<RecentViewsOut> {
  const url = `${baseUrl()}/me/recent-views?${memberParams(userKey, { days, limit })}`;
  const res = await fetch(url, { headers: { ...extraHeaders }, cache: "no-store" });
  return handle<RecentViewsOut>(res);
}

export async function getMemberProfile(): Promise<MemberProfileOut> {
  const res = await fetch(`${baseUrl()}/me/profile`, {
    headers: { ...getAuthHeaders() },
    cache: "no-store",
  });
  return handle<MemberProfileOut>(res);
}

export async function patchMemberProfile(
  body: MemberProfileUpdate,
): Promise<MemberProfileOut> {
  const res = await fetch(`${baseUrl()}/me/profile`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return handle<MemberProfileOut>(res);
}

export async function uploadMemberAvatar(file: File): Promise<MemberProfileOut> {
  const form = new FormData();
  form.set("file", file);
  const res = await fetch(`${baseUrl()}/me/profile/avatar`, {
    method: "POST",
    headers: { ...getAuthHeaders() },
    body: form,
    cache: "no-store",
  });
  return handle<MemberProfileOut>(res);
}

export async function deleteMemberAvatar(): Promise<MemberProfileOut> {
  const res = await fetch(`${baseUrl()}/me/profile/avatar`, {
    method: "DELETE",
    headers: { ...getAuthHeaders() },
    cache: "no-store",
  });
  return handle<MemberProfileOut>(res);
}

export async function getMemberDashboard(): Promise<MemberDashboardOut> {
  const res = await fetch(`${baseUrl()}/me/dashboard`, {
    headers: { ...getAuthHeaders() },
    cache: "no-store",
  });
  return handle<MemberDashboardOut>(res);
}

export async function postSignup(body: UserSignup): Promise<TokenOut> {
  const res = await fetch(`${baseUrl()}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return handle<TokenOut>(res);
}

export async function postLogin(body: UserLogin): Promise<TokenOut> {
  const res = await fetch(`${baseUrl()}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return handle<TokenOut>(res);
}

export function googleLoginStartUrl(nextPath = "/recommend"): string {
  const search = new URLSearchParams({ next: nextPath }).toString();
  return `${baseUrl()}/auth/google/login/start?${search}`;
}

export async function postGoogleLoginExchange(
  body: GoogleLoginExchange,
): Promise<TokenOut> {
  const res = await fetch(`${baseUrl()}/auth/google/login/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return handle<TokenOut>(res);
}

// fallow-ignore-next-line unused-export -- Preserved public API client contract.
export async function getMe(): Promise<UserOut> {
  const res = await fetch(`${baseUrl()}/auth/me`, {
    method: "GET",
    headers: { ...getAuthHeaders() },
    cache: "no-store",
  });
  return handle<UserOut>(res);
}

export async function patchMe(body: UserProfileUpdate): Promise<UserOut> {
  const res = await fetch(`${baseUrl()}/auth/me`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return handle<UserOut>(res);
}

export async function postPasswordResetRequest(
  body: PasswordResetRequest,
): Promise<PasswordResetRequestOut> {
  const res = await fetch(`${baseUrl()}/auth/password-reset/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return handle<PasswordResetRequestOut>(res);
}

export async function postPasswordResetConfirm(
  body: PasswordResetConfirm,
): Promise<PasswordResetConfirmOut> {
  const res = await fetch(`${baseUrl()}/auth/password-reset/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return handle<PasswordResetConfirmOut>(res);
}

export async function getGmailOAuthStatus(): Promise<GmailOAuthStatusOut> {
  const res = await fetch(`${baseUrl()}/admin/gmail-oauth/status`, {
    headers: { ...getAuthHeaders() },
    cache: "no-store",
  });
  return handle<GmailOAuthStatusOut>(res);
}

export async function startGmailOAuth(): Promise<GmailOAuthStartOut> {
  const res = await fetch(`${baseUrl()}/admin/gmail-oauth/start`, {
    method: "POST",
    headers: { ...getAuthHeaders() },
    cache: "no-store",
  });
  return handle<GmailOAuthStartOut>(res);
}

export async function getAdminUsers(): Promise<AdminUserListOut> {
  const res = await fetch(`${baseUrl()}/admin/users`, {
    headers: { ...getAuthHeaders() },
    cache: "no-store",
  });
  return handle<AdminUserListOut>(res);
}

export async function postAdminUser(body: AdminUserCreate): Promise<UserOut> {
  const res = await fetch(`${baseUrl()}/admin/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return handle<UserOut>(res);
}

export async function putAdminUser(userId: number, body: AdminUserUpdate): Promise<UserOut> {
  const res = await fetch(`${baseUrl()}/admin/users/${userId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return handle<UserOut>(res);
}

export async function deleteAdminUser(userId: number): Promise<AdminUserDeleteOut> {
  const res = await fetch(`${baseUrl()}/admin/users/${userId}`, {
    method: "DELETE",
    headers: { ...getAuthHeaders() },
    cache: "no-store",
  });
  return handle<AdminUserDeleteOut>(res);
}

export async function postItemDraft(body: ItemDraft): Promise<ItemDraftOut> {
  const res = await fetch(`${baseUrl()}/admin/items/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return handle<ItemDraftOut>(res);
}

export async function postItemCommit(body: ItemCommit): Promise<ItemCommitOut> {
  const res = await fetch(`${baseUrl()}/admin/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return handle<ItemCommitOut>(res);
}

// fallow-ignore-next-line unused-export -- Preserved public API client contract.
export async function putItemKeywords(
  artifactId: number,
  body: ItemKeywordReassign,
): Promise<ItemReassignOut> {
  const res = await fetch(`${baseUrl()}/admin/items/${artifactId}/keywords`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return handle<ItemReassignOut>(res);
}

export async function putAdminItem(
  artifactId: number,
  body: ItemUpdate,
): Promise<ItemReassignOut> {
  const res = await fetch(`${baseUrl()}/admin/items/${artifactId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return handle<ItemReassignOut>(res);
}

/**
 * Distinct ``category_group`` + ``performance_type`` values for the admin
 * form dropdowns. Admin-only — the backend rejects anonymous calls.
 */
export async function getItemFacets(): Promise<ItemFacetsOut> {
  const res = await fetch(`${baseUrl()}/admin/items/facets`, {
    headers: { ...getAuthHeaders() },
    cache: "no-store",
  });
  return handle<ItemFacetsOut>(res);
}

export async function deleteAdminItem(artifactId: number): Promise<ItemDeleteOut> {
  const res = await fetch(`${baseUrl()}/admin/items/${artifactId}`, {
    method: "DELETE",
    headers: { ...getAuthHeaders() },
    cache: "no-store",
  });
  return handle<ItemDeleteOut>(res);
}

/**
 * Upload a cover image (JPEG / PNG / WebP, max 5 MB) for an item.
 * Sends ``multipart/form-data`` so the browser sets the boundary
 * automatically — we don't set Content-Type here.
 */
export async function uploadItemImage(
  artifactId: number,
  file: File,
): Promise<ItemImageUploadOut> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${baseUrl()}/admin/items/${artifactId}/image`, {
    method: "POST",
    headers: { ...getAuthHeaders() },
    body: form,
    cache: "no-store",
  });
  return handle<ItemImageUploadOut>(res);
}

/** Upload an MP4, WebM, or MOV file (max 100 MB) for an item. */
export async function uploadItemVideo(
  artifactId: number,
  file: File,
): Promise<ItemVideoUploadOut> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${baseUrl()}/admin/items/${artifactId}/video`, {
    method: "POST",
    headers: { ...getAuthHeaders() },
    body: form,
    cache: "no-store",
  });
  return handle<ItemVideoUploadOut>(res);
}

export function getBaseUrl(): string {
  return baseUrl();
}

/**
 * Turn an internal-service-relative media path into a same-origin
 * Application Backend URL the browser can fetch.
 *
 * Already-absolute URLs (``http://...``, ``https://...``, ``data:...``) are
 * returned unchanged so legacy test fixtures keep working.
 */
export function resolveImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const trimmed = path.trim();
  if (trimmed.length === 0) return null;
  if (/^(https?:|data:|blob:)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return trimmed;
  if (trimmed.startsWith("/")) return `${baseUrl()}${trimmed}`;
  return `${baseUrl()}/${trimmed}`;
}
