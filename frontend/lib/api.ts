// lib/api.ts — Typed REST client for the FastAPI backend.
//
// Reads the backend URL from NEXT_PUBLIC_API_BASE_URL. The frontend never
// imports Python files, reads CSV, or reads model artifacts directly; all
// data comes from this client.

import type {
  ContextListOut,
  HealthOut,
  ItemListOut,
  KeywordListOut,
  MetricsOut,
  RecommendationRequestIn,
  RecommendationResponseOut,
} from "./types";

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

export async function getKeywords(search?: string): Promise<KeywordListOut> {
  const params = new URLSearchParams();
  if (search && search.trim().length > 0) {
    params.set("search", search.trim());
  }
  const url = `${baseUrl()}/keywords${params.toString() ? `?${params.toString()}` : ""}`;
  const res = await fetch(url, { cache: "no-store" });
  return handle<KeywordListOut>(res);
}

export async function getItems(opts?: {
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<ItemListOut> {
  const params = new URLSearchParams();
  if (opts?.search) params.set("search", opts.search);
  if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts?.offset !== undefined) params.set("offset", String(opts.offset));
  const url = `${baseUrl()}/items${params.toString() ? `?${params.toString()}` : ""}`;
  const res = await fetch(url, { cache: "no-store" });
  return handle<ItemListOut>(res);
}

export async function getMetrics(): Promise<MetricsOut> {
  const res = await fetch(`${baseUrl()}/metrics`, { cache: "no-store" });
  return handle<MetricsOut>(res);
}

export async function postRecommendations(
  body: RecommendationRequestIn,
): Promise<RecommendationResponseOut> {
  const res = await fetch(`${baseUrl()}/recommendations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return handle<RecommendationResponseOut>(res);
}

export function getBaseUrl(): string {
  return baseUrl();
}