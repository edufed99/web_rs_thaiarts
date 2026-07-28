// lib/user.ts — Opaque user identity for live personalization.
//
// The backend does not require auth. Instead each browser generates a
// stable opaque ``user_key`` like ``anon:<uuid>`` and stores it in
// localStorage. The key is sent with every recommendation + action request
// so the CF service can apply live personalization (likes, ratings) and
// the action endpoints can record / dedupe the writes.
//
// All functions are SSR-safe: they bail out to an empty string when
// invoked outside a browser.

const STORAGE_KEY = "recsys_user_key";
const PREFIX = "anon:";

function makeUserKey(): string {
  // crypto.randomUUID is available in all modern browsers and Node 19+.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return PREFIX + crypto.randomUUID();
  }
  // Fallback (should be unreachable in supported runtimes).
  return PREFIX + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function getUserKey(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing && existing.length > 0) return existing;
    const fresh = makeUserKey();
    window.localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // localStorage may throw in private-mode browsers; degrade gracefully.
    return "";
  }
}

export function clearUserKey(): string {
  if (typeof window === "undefined") return "";
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  return getUserKey();
}
