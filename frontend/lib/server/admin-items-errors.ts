import { NextResponse } from "next/server";

import { AdminItemError } from "@/lib/server/admin-items";
import { apiError } from "@/lib/server/api-response";

/**
 * Shared error normalization for the admin item mutation routes. The
 * codes mirror the legacy FastAPI contract so the admin UI keeps mapping
 * them to Thai messages.
 */
export function itemMutationError(error: AdminItemError): NextResponse {
  return apiError(error.status, error.code, error.message);
}

// fallow-ignore-next-line complexity -- Error codes are normalized without exposing internals.
export function itemMutationCaughtError(error: unknown): NextResponse {
  if (error instanceof AdminItemError) {
    return itemMutationError(error);
  }
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code === "23505") {
    return apiError(409, "already_exists", "That item name or identifier is already in use.");
  }
  if (code === "23514") {
    return apiError(400, "artifact_id_immutable", "The Artifact Item Identifier is immutable once assigned.");
  }
  return apiError(500, "internal_server_error", "The server could not complete this request.");
}
