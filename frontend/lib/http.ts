// lib/http.ts — Shared internal fetch helpers for the REST client.
//
// These are NOT part of the public `@/lib/api` surface; they are shared by
// the endpoint-domain modules (catalog, metrics, recommendations, actions,
// member, admin, auth). The barrel (lib/api.ts) re-exports the public
// endpoint functions only, so importers of `@/lib/api` see no change.

import type { ActionRequestIn } from "./types";
import { getBaseUrl } from "./urls";
import { ApiClientError } from "./errors";

function baseUrl(): string {
  return getBaseUrl();
}

export function mutationHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "X-CSRF-Token": "same-origin", ...extra };
}

async function mutateJson<T>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const response = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: mutationHeaders({ "Content-Type": "application/json", ...extraHeaders }),
    credentials: "same-origin",
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return handle<T>(response);
}

interface ErrorBody {
  error?: {
    code?: string;
    message?: string;
    [k: string]: unknown;
  };
}

export async function handle<T>(res: Response): Promise<T> {
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

// --- Live user actions ------------------------------------------------------

export function actionBody(body: ActionRequestIn): ActionRequestIn {
  return {
    user_key: body.user_key,
    item_id: body.item_id,
    request_id: body.request_id ?? null,
    context_id: body.context_id ?? null,
    rating: body.rating ?? null,
  };
}

// --- Member summary (GET /me/*) -------------------------------------------

export function memberParams(
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

export { baseUrl, mutateJson };
