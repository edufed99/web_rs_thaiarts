// One-time Gmail sender authorization and access-token refresh (admin only).
//
// This client is intentionally separate from member Google Login. It requests
// the narrow ``gmail.send`` scope, and its refresh token is persisted outside
// Git (env var or a private JSON file) for the password-reset mailer.
import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { postForm } from "@/lib/server/oauth-http";

export const GMAIL_STATE_COOKIE = "thaiperform_gmail_oauth_state";
const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const DEFAULT_AUTH_URI = "https://accounts.google.com/o/oauth2/auth";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
const PENDING_TTL_SECONDS = 10 * 60;
const DEFAULT_GMAIL_API_SEND_URI = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

export class GmailOAuthError extends Error {}

interface GmailClient {
  clientId: string;
  clientSecret: string;
  authUri: string;
  tokenUri: string;
  redirectUri: string;
}

function envValue(name: string): string {
  return (process.env[name] ?? "").trim();
}

// fallow-ignore-next-line complexity -- Unreadable and malformed credential files must each fail closed.
async function readClientFile(path: string | undefined): Promise<Record<string, unknown> | null> {
  if (!path) return null;
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function clientWeb(path: string | undefined): Promise<Record<string, unknown> | null> {
  const parsed = await readClientFile(path);
  if (!parsed) return null;
  const web = parsed.web as Record<string, unknown> | undefined;
  if (!web || typeof web !== "object") {
    throw new GmailOAuthError("OAuth credential must be a Web application client");
  }
  return web;
}

// fallow-ignore-next-line complexity -- Env-var and client-file fallbacks must resolve in one deterministic precedence order.
async function loadGmailClient(): Promise<GmailClient> {
  const web = await clientWeb(envValue("GMAIL_OAUTH_CLIENT_FILE"));
  const clientId = envValue("GMAIL_OAUTH_CLIENT_ID") || String(web?.client_id ?? "").trim();
  const clientSecret = envValue("GMAIL_OAUTH_CLIENT_SECRET") || String(web?.client_secret ?? "").trim();
  const authUri = envValue("GMAIL_OAUTH_AUTH_URI") || String(web?.auth_uri ?? "").trim() || DEFAULT_AUTH_URI;
  const tokenUri = envValue("GMAIL_OAUTH_TOKEN_URI") || String(web?.token_uri ?? "").trim() || DEFAULT_TOKEN_URI;
  const redirectUri = envValue("GMAIL_OAUTH_REDIRECT_URI");
  if (!clientId || !clientSecret || !redirectUri) {
    throw new GmailOAuthError("Google OAuth client is not configured");
  }
  return { clientId, clientSecret, authUri, tokenUri, redirectUri };
}

async function gmailTokenFilePath(): Promise<string> {
  return envValue("GMAIL_OAUTH_TOKEN_FILE") || "";
}

// fallow-ignore-next-line complexity -- Env and token-file sources must each be probed without leaking secrets.
async function refreshToken(): Promise<string> {
  const envToken = envValue("GMAIL_OAUTH_REFRESH_TOKEN");
  if (envToken) return envToken;
  const tokenFile = await gmailTokenFilePath();
  if (!tokenFile) return "";
  try {
    const payload = JSON.parse(await readFile(tokenFile, "utf8")) as { refresh_token?: unknown };
    return String(payload.refresh_token ?? "").trim();
  } catch {
    return "";
  }
}

export async function clientConfigured(): Promise<boolean> {
  try {
    await loadGmailClient();
    return true;
  } catch {
    return false;
  }
}

export async function authorized(): Promise<boolean> {
  return (await clientConfigured()) && Boolean(await refreshToken());
}

/** Build the Google consent URL and remember one short-lived PKCE flow. */
export async function startAuthorization(): Promise<{ authorizationUrl: string; state: string; verifier: string }> {
  const client = await loadGmailClient();
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
  const params = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    response_type: "code",
    scope: GMAIL_SEND_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return { authorizationUrl: `${client.authUri}?${params.toString()}`, state, verifier };
}

/** Exchange the one-time code and persist the refresh token for the mailer. */
// fallow-ignore-next-line complexity -- Token exchange, persistence, and cache invalidation are one security boundary.
export async function completeAuthorization(code: string, verifier: string): Promise<void> {
  const client = await loadGmailClient();
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
      "Google OAuth request failed",
    );
  } catch (error) {
    throw new GmailOAuthError(error instanceof Error ? error.message : "Google OAuth request failed");
  }
  const refreshTokenValue = String(payload.refresh_token ?? "").trim();
  if (!refreshTokenValue) {
    throw new GmailOAuthError("Google did not return a refresh token; revoke access and try again");
  }
  const tokenFile = await gmailTokenFilePath();
  if (tokenFile) {
    await mkdir(dirname(tokenFile), { recursive: true });
    await writeFile(
      tokenFile,
      JSON.stringify(
        {
          refresh_token: refreshTokenValue,
          scope: String(payload.scope ?? GMAIL_SEND_SCOPE),
          created_at: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );
    try {
      await chmod(tokenFile, 0o600);
    } catch {
      // Windows filesystems have no POSIX mode bits; best effort only.
    }
  }
  accessTokenCache = undefined;
}

let accessTokenCache: { token: string; expiresAt: number } | undefined;

/** Refresh and cache a short-lived Gmail API access token. */
// fallow-ignore-next-line complexity -- Cache expiry and refresh failure handling are one bounded token boundary.
async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (accessTokenCache && accessTokenCache.expiresAt > now + 60_000) {
    return accessTokenCache.token;
  }
  const client = await loadGmailClient();
  const storedRefreshToken = await refreshToken();
  if (!storedRefreshToken) throw new GmailOAuthError("Gmail sender has not been authorized");
  let payload: Record<string, unknown>;
  try {
    payload = await postForm(
      client.tokenUri,
      {
        client_id: client.clientId,
        client_secret: client.clientSecret,
        refresh_token: storedRefreshToken,
        grant_type: "refresh_token",
      },
      "Google OAuth request failed",
    );
  } catch (error) {
    throw new GmailOAuthError(error instanceof Error ? error.message : "Google OAuth request failed");
  }
  const accessToken = String(payload.access_token ?? "").trim();
  if (!accessToken) throw new GmailOAuthError("Google did not return an access token");
  const expiresIn = Math.max(120, Number(payload.expires_in) || 3600);
  accessTokenCache = { token: accessToken, expiresAt: now + expiresIn * 1000 };
  return accessToken;
}

/** Deliver one RFC 2822 message with the narrowly scoped Gmail API. */
export async function sendWithGmailApi(rawMessage: string): Promise<boolean> {
  try {
    const accessToken = await getAccessToken();
    const response = await fetch(envValue("GMAIL_API_SEND_URI") || DEFAULT_GMAIL_API_SEND_URI, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: Buffer.from(rawMessage, "utf8").toString("base64url") }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function pendingTtlSeconds(): number {
  return PENDING_TTL_SECONDS;
}
