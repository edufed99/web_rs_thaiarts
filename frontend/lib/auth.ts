// Browser authentication state contains display-only user data. The only
// credential is the opaque HttpOnly session cookie, which JavaScript cannot read.
import type {
  GoogleLoginExchange,
  PasswordResetConfirm,
  PasswordResetConfirmOut,
  PasswordResetRequest,
  PasswordResetRequestOut,
  TokenOut,
  UserLogin,
  UserProfileUpdate,
  UserOut,
  UserSignup,
} from "./types";

import { baseUrl, handle, mutateJson } from "./http";

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

/**
 * Compatibility shim for call sites that once received a bearer JWT from the
 * FastAPI Google flow. Issue #6 removed bearer credentials entirely: Google
 * Login now issues the HttpOnly server session directly, so only the display
 * user snapshot is stored here.
 */
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

// --- REST auth endpoints (migrated from lib/api.ts) -------------------------

export async function postSignup(body: UserSignup): Promise<TokenOut> {
  return mutateJson("/auth/signup", "POST", body);
}

export async function postLogin(body: UserLogin): Promise<TokenOut> {
  return mutateJson("/auth/login", "POST", body);
}

export function googleLoginStartUrl(nextPath = "/recommend"): string {
  const search = new URLSearchParams({ next: nextPath }).toString();
  return `${baseUrl()}/auth/google/login/start?${search}`;
}

export async function postGoogleLoginExchange(
  body: GoogleLoginExchange,
): Promise<TokenOut> {
  return mutateJson("/auth/google/login/exchange", "POST", body);
}

// fallow-ignore-next-line unused-export -- Preserved public API client contract.
export async function getMe(): Promise<UserOut> {
  const res = await fetch(`${baseUrl()}/auth/me`, {
    method: "GET",
    headers: { ...getAuthHeaders() },
    cache: "no-store",
  });
  return handle<UserOut>(res);
}

export async function patchMe(body: UserProfileUpdate): Promise<UserOut> {
  return mutateJson("/auth/me", "PATCH", body, getAuthHeaders());
}

export async function postPasswordResetRequest(
  body: PasswordResetRequest,
): Promise<PasswordResetRequestOut> {
  return mutateJson("/auth/password-reset/request", "POST", body);
}

export async function postPasswordResetConfirm(
  body: PasswordResetConfirm,
): Promise<PasswordResetConfirmOut> {
  return mutateJson("/auth/password-reset/confirm", "POST", body);
}
