// Member Google OpenID Connect (separate from the admin Gmail sender client).
//
// Requests only identity scopes, never stores a Google access/refresh token,
// and converts a successful callback into a normal Application Backend server
// session. The OAuth exchange and ID-token verification happen server-side in
// Next.js route handlers; the browser only ever navigates.
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { postForm } from "@/lib/server/oauth-http";

export const LOGIN_STATE_COOKIE = "thaiperform_google_login_state";
const SCOPES = "openid email profile";
const DEFAULT_AUTH_URI = "https://accounts.google.com/o/oauth2/v2/auth";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
const DEFAULT_JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

export class GoogleLoginOAuthError extends Error {}

export interface GoogleLoginClient {
  clientId: string;
  clientSecret: string;
  authUri: string;
  tokenUri: string;
  jwksUri: string;
  redirectUri: string;
}

export interface GoogleIdentity {
  subjectId: string;
  email: string;
  displayName: string;
  avatarUrl: string;
}

export interface PendingLoginFlow {
  state: string;
  verifier: string;
  nextPath: string;
}

function envValue(name: string): string {
  return (process.env[name] ?? "").trim();
}

// fallow-ignore-next-line complexity -- Unreadable and malformed credential files must each fail closed.
function readClientFile(path: string | undefined): Record<string, unknown> | null {
  if (!path) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function clientWeb(path: string | undefined): Record<string, unknown> | null {
  const parsed = readClientFile(path);
  if (!parsed) return null;
  const web = parsed.web as Record<string, unknown> | undefined;
  if (!web || typeof web !== "object") {
    throw new GoogleLoginOAuthError("OAuth credential must be a Web application client");
  }
  return web;
}

// fallow-ignore-next-line complexity -- Env-var and client-file fallbacks must resolve in one deterministic precedence order.
export function loadLoginClient(): GoogleLoginClient {
  const web = clientWeb(envValue("GOOGLE_LOGIN_CLIENT_FILE"));
  const clientId = envValue("GOOGLE_LOGIN_CLIENT_ID") || String(web?.client_id ?? "").trim();
  const clientSecret = envValue("GOOGLE_LOGIN_CLIENT_SECRET") || String(web?.client_secret ?? "").trim();
  const authUri = envValue("GOOGLE_LOGIN_AUTH_URI") || String(web?.auth_uri ?? "").trim() || DEFAULT_AUTH_URI;
  const tokenUri = envValue("GOOGLE_LOGIN_TOKEN_URI") || String(web?.token_uri ?? "").trim() || DEFAULT_TOKEN_URI;
  const jwksUri = envValue("GOOGLE_LOGIN_JWKS_URI") || DEFAULT_JWKS_URI;
  const redirectUri = envValue("GOOGLE_LOGIN_REDIRECT_URI");
  if (!clientId || !clientSecret || !redirectUri) {
    throw new GoogleLoginOAuthError("Google member login is not configured");
  }
  return { clientId, clientSecret, authUri, tokenUri, jwksUri, redirectUri };
}

export function safeNextPath(value: string | null | undefined): string {
  const candidate = (value ?? "").trim();
  if (candidate.startsWith("/") && !candidate.startsWith("//")) return candidate;
  return "/recommend";
}

function stateTtlSeconds(): number {
  const raw = Number(envValue("GOOGLE_LOGIN_STATE_TTL_SECONDS"));
  return Number.isSafeInteger(raw) && raw >= 60 ? raw : 600;
}

export function stateTtl(): number {
  return stateTtlSeconds();
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

/** Build the Google authorization URL and the pending flow bound to the browser. */
export function startAuthorization(nextPath: string | null | undefined): { authorizationUrl: string; flow: PendingLoginFlow } {
  const client = loadLoginClient();
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const params = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    response_type: "code",
    scope: SCOPES,
    state,
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return {
    authorizationUrl: `${client.authUri}?${params.toString()}`,
    flow: { state, verifier, nextPath: safeNextPath(nextPath) },
  };
}

/**
 * Exchange the one-time authorization code and verify the returned ID token.
 * Returns the verified identity; the caller persists the local member.
 */
// fallow-ignore-next-line complexity -- Exchange errors and missing ID tokens are distinct failure modes of one boundary.
export async function completeAuthorization(code: string, verifier: string): Promise<GoogleIdentity> {
  const client = loadLoginClient();
  let payload: Record<string, unknown>;
  try {
    payload = await postForm(
      client.tokenUri,
      {
        code,
        client_id: client.clientId,
        client_secret: client.clientSecret,
        redirect_uri: client.redirectUri,
        grant_type: "authorization_code",
        code_verifier: verifier,
      },
      "Google token exchange failed",
    );
  } catch (error) {
    throw new GoogleLoginOAuthError(error instanceof Error ? error.message : "Google token exchange failed");
  }
  const idToken = String(payload.id_token ?? "").trim();
  if (!idToken) throw new GoogleLoginOAuthError("Google did not return an identity token");
  return verifyIdToken(idToken, client);
}

// fallow-ignore-next-line complexity -- Signature, audience, issuer, and claim checks each reject a distinct forgery.
async function verifyIdToken(idToken: string, client: GoogleLoginClient): Promise<GoogleIdentity> {
  let claims;
  try {
    const jwks = createRemoteJWKSet(new URL(client.jwksUri));
    const verified = await jwtVerify(idToken, jwks, {
      audience: client.clientId,
      issuer: [...GOOGLE_ISSUERS],
    });
    claims = verified.payload as Record<string, unknown>;
  } catch {
    throw new GoogleLoginOAuthError("Google identity token could not be verified");
  }
  if (claims.email_verified !== true) {
    throw new GoogleLoginOAuthError("Google account email is not verified");
  }
  const subject = String(claims.sub ?? "").trim();
  const email = String(claims.email ?? "").trim().toLowerCase();
  if (!subject || !email) throw new GoogleLoginOAuthError("Google identity is missing required fields");
  return {
    subjectId: subject,
    email,
    displayName: String(claims.name ?? "").trim(),
    avatarUrl: String(claims.picture ?? "").trim(),
  };
}
