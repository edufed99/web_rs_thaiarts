// Browser authentication state contains display-only user data. The only
// credential is the opaque HttpOnly session cookie, which JavaScript cannot read.
import type { UserOut } from "./types";

export const STORAGE_KEY = "thai_arts_session_user";
export const AUTH_CHANGED_EVENT = "thai_arts_auth_changed";
const LEGACY_JWT_KEY = "thai_arts_jwt";

function removeLegacyCredential(): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(LEGACY_JWT_KEY); } catch {}
}

export function getCurrentUser(): UserOut | null {
  if (typeof window === "undefined") return null;
  removeLegacyCredential();
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value ? JSON.parse(value) as UserOut : null;
  } catch { return null; }
}

export function setSessionUser(user: UserOut): void {
  if (typeof window === "undefined") return;
  removeLegacyCredential();
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
  } catch {}
}

export function updateStoredUser(user: UserOut): void { setSessionUser(user); }

function clearStoredAuth(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_JWT_KEY);
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
  } catch {}
}

export function getReadableUserName(user: Pick<UserOut, "username" | "display_name">): string {
  let name = (user.display_name || "").trim();
  if (name.startsWith("must_reset|")) name = name.slice("must_reset|".length).trim();
  if (name.startsWith("legacy:")) name = name.slice("legacy:".length).trim();
  return name || user.username;
}

export function userNeedsPasswordReset(user: Pick<UserOut, "username" | "display_name">): boolean {
  return (user.display_name || "").trim().startsWith("must_reset|");
}

/** Kept temporarily for call-site compatibility; bearer credentials no longer exist. */
export function getAuthHeaders(): Record<string, string> { return {}; }
export function isAdmin(): boolean { return Boolean(getCurrentUser()?.is_admin); }

/** Compatibility shim for the Google flow that will be replaced in issue #6. */
export function storeToken(_token: string, _seconds: number, user: UserOut): void {
  setSessionUser(user);
}

export function logout(): void {
  void fetch("/api/auth/logout", {
    method: "POST",
    headers: { "X-CSRF-Token": "same-origin" },
    credentials: "same-origin",
  }).finally(clearStoredAuth);
}
