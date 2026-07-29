// lib/auth.ts — JWT-backed auth helpers.
//
// The backend issues HS256 JWTs at POST /auth/signup and POST /auth/login.
// The token, plus a small parsed user payload, are persisted to
// localStorage so a refresh keeps the session alive. All functions are
// SSR-safe — they bail out to a null user when invoked outside a browser.

import type { UserOut } from "./types";

export const STORAGE_KEY = "thai_arts_jwt";
export const AUTH_CHANGED_EVENT = "thai_arts_auth_changed";

export interface StoredAuth {
  access_token: string;
  expires_at: number; // unix seconds
  user: UserOut;
}

/**
 * Read the stored auth payload from localStorage. Returns ``null`` when:
 * - the key is missing,
 * - the value cannot be parsed,
 * - the token has expired (we proactively clean it up).
 */
export function getStoredAuth(): StoredAuth | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredAuth>;
    if (
      !parsed ||
      typeof parsed.access_token !== "string" ||
      typeof parsed.expires_at !== "number" ||
      !parsed.user
    ) {
      return null;
    }
    if (parsed.expires_at <= Math.floor(Date.now() / 1000)) {
      // Expired — clear and return null.
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
      return null;
    }
    return parsed as StoredAuth;
  } catch {
    return null;
  }
}

export function setStoredAuth(payload: StoredAuth): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
  } catch {
    // localStorage may throw in private-mode browsers; degrade gracefully.
  }
}

export function updateStoredUser(user: UserOut): void {
  const auth = getStoredAuth();
  if (!auth) return;
  setStoredAuth({ ...auth, user });
}

export function clearStoredAuth(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
  } catch {
    // ignore
  }
}

/**
 * Return the current authenticated user, or ``null`` if no valid session.
 * Decoded client-side from the stored JWT — no network round-trip needed.
 */
export function getCurrentUser(): UserOut | null {
  const auth = getStoredAuth();
  return auth ? auth.user : null;
}

export function getReadableUserName(user: UserOut): string {
  const displayName = (user.display_name || "").trim();
  const legacyMarker = "legacy:";
  if (displayName.includes(legacyMarker)) {
    const legacyName = displayName.split(legacyMarker, 2)[1]?.trim();
    if (legacyName) return legacyName;
  }
  if (displayName && !displayName.startsWith("must_reset|")) return displayName;
  return user.username;
}

export function getJwt(): string | null {
  const auth = getStoredAuth();
  return auth ? auth.access_token : null;
}

/**
 * Return ``{"Authorization": "Bearer <jwt>"}`` when authenticated, else
 * an empty object. The action / admin endpoints accept either JWT or
 * anon user_key in the body; we just prefer the JWT header when present.
 */
export function getAuthHeaders(): Record<string, string> {
  const token = getJwt();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

export function isAdmin(): boolean {
  const u = getCurrentUser();
  return Boolean(u && u.is_admin);
}

/**
 * Persist a freshly issued token. ``expires_at`` is computed from
 * ``expires_in_seconds`` plus the current wall-clock time.
 */
export function storeToken(
  access_token: string,
  expires_in_seconds: number,
  user: UserOut,
): void {
  const expires_at = Math.floor(Date.now() / 1000) + expires_in_seconds;
  setStoredAuth({ access_token, expires_at, user });
}

export function logout(): void {
  clearStoredAuth();
}
