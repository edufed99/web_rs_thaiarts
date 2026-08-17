// lib/admin.ts — Admin users + Gmail OAuth + item draft/commit/update/facets/
// delete + uploads + Artifact Publication functions.

import type {
  AdminUserCreate,
  AdminUserDeleteOut,
  AdminUserListOut,
  AdminUserUpdate,
  ContextCreateIn,
  ContextOut,
  GmailOAuthStartOut,
  GmailOAuthStatusOut,
  ItemCommit,
  ItemCommitOut,
  ItemDeleteOut,
  ItemDraft,
  ItemDraftOut,
  ItemFacetsOut,
  ItemImageUploadOut,
  ItemReassignOut,
  ItemUpdate,
  ItemVideoUploadOut,
  PublicationExecuteOut,
  PublicationStatusOut,
  UserOut,
} from "./types";
import { getAuthHeaders } from "./auth";
import { baseUrl, handle, mutateJson, mutationHeaders } from "./http";

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
    headers: mutationHeaders({ ...getAuthHeaders() }),
    credentials: "same-origin",
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

export async function createAdminContext(body: ContextCreateIn): Promise<ContextOut> {
  const res = await fetch(`${baseUrl()}/admin/contexts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return handle<ContextOut>(res);
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

/**
 * Current Artifact Publication state (issue #8): the latest recorded
 * build, pending catalogue rows, and the Private Model Service's own
 * artifact report. Admin-only.
 */
export async function getPublicationStatus(): Promise<PublicationStatusOut> {
  const res = await fetch(`${baseUrl()}/admin/publication`, {
    headers: { ...getAuthHeaders() },
    cache: "no-store",
  });
  return handle<PublicationStatusOut>(res);
}

/**
 * Execute an explicit Artifact Publication (issue #8). Requires admin;
 * fails with 503 when the Private Model Service is unreachable. On
 * success every pending catalogue row becomes covered by the recorded
 * build and re-enters personalized scoring.
 */
export async function executePublication(
  note?: string,
): Promise<PublicationExecuteOut> {
  const res = await fetch(`${baseUrl()}/admin/publication`, {
    method: "POST",
    headers: mutationHeaders({
      "Content-Type": "application/json",
      ...getAuthHeaders(),
    }),
    credentials: "same-origin",
    body: JSON.stringify({ note: note ?? "" }),
    cache: "no-store",
  });
  return handle<PublicationExecuteOut>(res);
}
