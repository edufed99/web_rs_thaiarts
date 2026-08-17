// lib/actions.ts — Live user actions (/actions/*).

import type { ActionRequestIn, ItemActionOut, ItemViewOut, ViewRequestIn } from "./types";
import { actionBody, baseUrl, mutateJson, mutationHeaders } from "./http";

export async function postLike(
  body: ActionRequestIn,
  extraHeaders: Record<string, string> = {},
): Promise<ItemActionOut> {
  return mutateJson("/actions/like", "POST", actionBody(body), extraHeaders);
}

export async function deleteLike(
  body: ActionRequestIn,
  extraHeaders: Record<string, string> = {},
): Promise<ItemActionOut> {
  return mutateJson("/actions/like", "DELETE", actionBody(body), extraHeaders);
}

export async function postSave(
  body: ActionRequestIn,
  extraHeaders: Record<string, string> = {},
): Promise<ItemActionOut> {
  return mutateJson("/actions/save", "POST", actionBody(body), extraHeaders);
}

export async function deleteSave(
  body: ActionRequestIn,
  extraHeaders: Record<string, string> = {},
): Promise<ItemActionOut> {
  return mutateJson("/actions/save", "DELETE", actionBody(body), extraHeaders);
}

export async function putRating(
  body: ActionRequestIn,
  extraHeaders: Record<string, string> = {},
): Promise<ItemActionOut> {
  return mutateJson("/actions/rating", "PUT", actionBody(body), extraHeaders);
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
      headers: mutationHeaders({ "Content-Type": "application/json", ...extraHeaders }),
      credentials: "same-origin",
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
