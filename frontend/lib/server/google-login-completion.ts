// Shared member Google Login completion used by the Next.js callback route
// (redirect flow) and the exchange route (JSON contract).
import { getDataSource } from "@/db/connection";
import { ApplicationUserEntity, type ApplicationUser } from "@/db/entities/Members";
import {
  completeAuthorization,
  stateTtl,
  type GoogleIdentity,
} from "@/lib/server/google-login-oauth";
import { AmbiguousGoogleEmailError, resolveGoogleIdentity } from "@/lib/server/google-members";
import { timingSafeEqualText, type OAuthStatePayload } from "@/lib/server/oauth-state-cookie";
import { rotateSession } from "@/lib/server/sessions";

export type GoogleLoginErrorCode =
  | "invalid_google_state"
  | "google_login_failed"
  | "ambiguous_google_email"
  | "google_account_not_persisted";

export type GoogleLoginOutcome =
  | { ok: true; user: ApplicationUser; token: string; nextPath: string }
  | { ok: false; error: GoogleLoginErrorCode };

/**
 * Validate the browser-bound PKCE flow, verify the Google identity, resolve
 * or create the local member, and issue a fresh server session.
 */
// fallow-ignore-next-line complexity -- Each branch rejects a distinct attack (state reuse, forged token, ambiguous account).
export async function completeGoogleLogin(
  code: string,
  state: string,
  pending: OAuthStatePayload | null,
): Promise<GoogleLoginOutcome> {
  const ttlMs = stateTtl() * 1000;
  if (
    !pending ||
    !timingSafeEqualText(pending.state, state) ||
    Date.now() - pending.iat * 1000 > ttlMs
  ) {
    return { ok: false, error: "invalid_google_state" };
  }
  let identity: GoogleIdentity;
  try {
    identity = await completeAuthorization(code, pending.verifier);
  } catch {
    return { ok: false, error: "google_login_failed" };
  }
  let user: ApplicationUser;
  try {
    ({ user } = await resolveGoogleIdentity(identity));
  } catch (error) {
    if (error instanceof AmbiguousGoogleEmailError) return { ok: false, error: "ambiguous_google_email" };
    return { ok: false, error: "google_account_not_persisted" };
  }
  user.lastLoginAt = new Date();
  await getDataSource().then((dataSource) =>
    dataSource.getRepository(ApplicationUserEntity).save(user),
  );
  const token = await rotateSession(Number(user.id));
  return { ok: true, user, token, nextPath: pending.next ?? "/recommend" };
}
