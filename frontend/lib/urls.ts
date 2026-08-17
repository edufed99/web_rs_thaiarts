// lib/urls.ts — URL helpers for the REST client.

// Same-origin Application Backend base. Internal service addresses stay
// server-only and are never embedded in browser bundles.
const DEFAULT_BASE_URL = "/api";

export function getBaseUrl(): string {
  return DEFAULT_BASE_URL;
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
  if (trimmed.startsWith("/")) return `${getBaseUrl()}${trimmed}`;
  return `${getBaseUrl()}/${trimmed}`;
}
