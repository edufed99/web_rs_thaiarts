// lib/api.ts — Typed REST client for the FastAPI backend.
//
// Reads the backend URL from NEXT_PUBLIC_API_BASE_URL. The frontend never
// imports Python files, reads CSV, or reads model artifacts directly; all
// data comes from this client.

import type {
  ActionRequestIn,
  ContextListOut,
  HealthOut,
  ItemActionOut,
  ItemCommit,
  ItemCommitOut,
  ItemCreate,
  ItemDraft,
  ItemDraftOut,
  ItemKeywordReassign,
  ItemListOut,
  ItemOut,
  ItemReassignOut,
  KeywordListOut,
  MetricsOut,
  ProfileRecommendationResponseOut,
  RecommendationRequestIn,
  RecommendationResponseOut,
  TokenOut,
  UserLogin,
  UserOut,
  UserProfileUpdate,
  UserSignup,
} from "./types";

import { getAuthHeaders } from "./auth";

const DEFAULT_BASE_URL = "http://localhost:8080";

function baseUrl(): string {
  // process.env.NEXT_PUBLIC_* is inlined at build time by Next.js.
  const envUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  return (envUrl && envUrl.length > 0 ? envUrl : DEFAULT_BASE_URL).replace(/\/+$/, "");
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
  if (opts?.userKey) params.set("user_key", opts.userKey);
  const url = `${baseUrl()}/items${params.toString() ? `?${params.toString()}` : ""}`;
  const res = await fetch(url, {
    headers: { ...(opts?.extraHeaders ?? {}) },
    cache: "no-store",
  });
  return handle<ItemListOut>(res);
}

export async function getItem(
  itemId: number,
  opts?: { userKey?: string; extraHeaders?: Record<string, string> },
): Promise<ItemOut> {
  const params = new URLSearchParams();
  if (opts?.userKey) params.set("user_key", opts.userKey);
  const url = `${baseUrl()}/items/${itemId}${params.toString() ? `?${params.toString()}` : ""}`;
  const res = await fetch(url, {
    headers: { ...(opts?.extraHeaders ?? {}) },
    cache: "no-store",
  });
  return handle<ItemOut>(res);
}

export async function getMetrics(): Promise<MetricsOut> {
  const res = await fetch(`${baseUrl()}/metrics`, { cache: "no-store" });
  return handle<MetricsOut>(res);
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

// --- Auth + Admin ingest ----------------------------------------------------

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

export function getBaseUrl(): string {
  return baseUrl();
}
