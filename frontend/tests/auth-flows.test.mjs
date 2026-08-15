// Public-boundary tests for issue #6 auth flows: member Google Login,
// password recovery, and the admin Gmail sender authorization. The Next.js
// dev server is pointed at local mock Google endpoints (JWKS/token) and a
// mock SMTP server so every flow — valid, rejected, authorization-gated, and
// expired-token — runs hermetically without real Google credentials.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, createHmac, generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import bcrypt from "bcryptjs";
import { chromium } from "@playwright/test";
import { exportJWK, SignJWT } from "jose";
import pg from "pg";

const { Client } = pg;
const databaseName = "web_rs_thaiarts_auth_test";
const adminUrl =
  process.env.TEST_POSTGRES_ADMIN_URL ??
  "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${databaseName}`;
const port = 3103;
const baseUrl = `http://127.0.0.1:${port}`;
const oauthPort = 4103;
const oauthBaseUrl = `http://127.0.0.1:${oauthPort}`;
const smtpPort = 4104;

const CLIENT_ID = "test-client-id";
const CLIENT_SECRET = "test-client-secret";
const OAUTH_STATE_SECRET = "test-oauth-secret";
const GMAIL_TOKEN_FILE = () => join(mediaRoot, "gmail-token.json");

let mediaRoot;
let server;
let oauthServer;
let smtpServer;
let smtpMessages = [];
let smtpFailNext = false;
let idTokenMode = "valid";
const usedCodes = new Set();

const goodKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const forgedKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
let goodJwk;

const GOOGLE_SUBJECT = "google-subject-123";
const GOOGLE_EMAIL = "person@gmail.com";

function runNpm(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn("npm", args, {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function resetDatabase(create) {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [databaseName],
    );
    await client.query(`DROP DATABASE IF EXISTS ${databaseName}`);
    if (create) await client.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await client.end();
  }
}

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/health`).catch(() => undefined);
    if (response) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for auth-flows test server");
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const exited = once(server, "exit");
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      spawn("taskkill", ["/pid", String(server.pid), "/t", "/f"], {
        stdio: "ignore",
      }).on("close", resolve);
    });
  } else {
    process.kill(-server.pid, "SIGTERM");
  }
  await exited;
}

function cookieValue(setCookie) {
  return setCookie?.split(";", 1)[0] ?? "";
}

function stateCookiePair(setCookie) {
  const raw = setCookie?.split(";", 1)[0] ?? "";
  const match = /^thaiperform_google_login_state=([^;]+)/.exec(raw);
  return match ? match[1] : "";
}

function encodeStateCookie(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", OAUTH_STATE_SECRET).update(body, "utf8").digest("base64url");
  return `${body}.${signature}`;
}

function queryParam(url, name) {
  return new URL(url).searchParams.get(name);
}

function mutationHeaders(cookie) {
  return {
    "Content-Type": "application/json",
    ...(cookie ? { Cookie: cookie } : {}),
    Origin: baseUrl,
    "Sec-Fetch-Site": "same-origin",
    "X-CSRF-Token": "same-origin",
  };
}

async function signIdToken(claims, key, kid) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid })
    .sign(key);
}

async function currentIdToken() {
  const now = Math.floor(Date.now() / 1000);
  const base = {
    sub: GOOGLE_SUBJECT,
    email: GOOGLE_EMAIL,
    email_verified: true,
    name: "Person Name",
    picture: "https://lh3.googleusercontent.com/a/test-photo",
    iss: "accounts.google.com",
    aud: CLIENT_ID,
    iat: now,
    exp: now + 3600,
  };
  if (idTokenMode === "wrong-key") return signIdToken(base, forgedKeys.privateKey, "forged-key");
  if (idTokenMode === "expired") return signIdToken({ ...base, exp: now - 3600 }, goodKeys.privateKey, "good-key");
  if (idTokenMode === "unverified") return signIdToken({ ...base, email_verified: false }, goodKeys.privateKey, "good-key");
  return signIdToken(base, goodKeys.privateKey, "good-key");
}

function collectRequestBody(request) {
  return new Promise((resolve) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => resolve(body));
  });
}

async function startOAuthServer() {
  // fallow-ignore-next-line complexity -- The mock must dispatch every Google endpoint (JWKS, token, auth pages).
  oauthServer = createServer(async (request, response) => {
    const url = new URL(request.url, oauthBaseUrl);
    if (url.pathname === "/jwks") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ keys: [goodJwk] }));
      return;
    }
    if (url.pathname === "/token") {
      const body = await collectRequestBody(request);
      assert.match(body, /grant_type=authorization_code/);
      assert.match(body, /code_verifier=/);
      // Google treats authorization codes as single-use; replaying a code
      // must fail like the real token endpoint.
      const code = new URLSearchParams(body).get("code") ?? "";
      if (usedCodes.has(code)) {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "invalid_grant" }));
        return;
      }
      usedCodes.add(code);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        id_token: await currentIdToken(),
        access_token: "google-access-token",
        token_type: "Bearer",
        expires_in: 3600,
      }));
      return;
    }
    if (url.pathname === "/gmail-token") {
      const body = await collectRequestBody(request);
      assert.match(body, /grant_type=authorization_code/);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        refresh_token: "gmail-refresh-token",
        access_token: "gmail-access-token",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/gmail.send",
      }));
      return;
    }
    if (url.pathname === "/gmail-send") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ id: "mock-message-id" }));
      return;
    }
    if (url.pathname === "/auth") {
      // Mock consent screen: echo the state back into the Next.js callback
      // with a code that is unique per flow (Google codes are single-use).
      const state = url.searchParams.get("state") ?? "";
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(
        `<html><body><script>` +
        `location.href = "${baseUrl}/api/auth/google/login/callback?code=" + ` +
        `encodeURIComponent("code-" + ${JSON.stringify(state)}) + "&state=" + ` +
        `encodeURIComponent(${JSON.stringify(state)});` +
        `</script></body></html>`,
      );
      return;
    }
    if (url.pathname === "/gmail-auth") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<html><body><p>Mock Gmail consent</p></body></html>`);
      return;
    }
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
  });
  oauthServer.listen(oauthPort, "127.0.0.1");
  await once(oauthServer, "listening");
}

function startSmtpServer() {
  smtpServer = createNetServer((socket) => {
    let buffer = "";
    let dataMode = false;
    let dataLines = [];
    let authStep = 0;
    const send = (line) => socket.write(`${line}\r\n`);
    send("220 mock.test ESMTP");
    socket.on("error", () => {});
    // fallow-ignore-next-line complexity -- The mock must speak the full SMTP conversation (EHLO, AUTH, MAIL, RCPT, DATA).
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      while (true) {
        const crlf = buffer.indexOf("\r\n");
        const lf = crlf >= 0 ? crlf : buffer.indexOf("\n");
        if (lf < 0) break;
        const line = buffer.slice(0, lf);
        buffer = buffer.slice(lf + (crlf >= 0 ? 2 : 1));
        if (dataMode) {
          if (line === ".") {
            dataMode = false;
            smtpMessages.push(dataLines.join("\r\n"));
            send("250 2.0.0 OK");
          } else {
            dataLines.push(line);
          }
          continue;
        }
        const command = /^([A-Z]+)/.exec(line)?.[1] ?? "";
        if (smtpFailNext && (command === "MAIL" || command === "RCPT")) {
          send("554 5.7.1 Rejected by test mock");
          continue;
        }
        if (command === "EHLO" || command === "HELO") {
          send("250-mock.test");
          send("250-AUTH PLAIN LOGIN");
          send("250 8BITMIME");
        } else if (command === "AUTH" && /^AUTH PLAIN(\s|$)/.test(line)) {
          send("235 2.7.0 Authentication successful");
        } else if (command === "AUTH") {
          authStep = 1;
          send("334 VXNlcm5hbWU6");
        } else if (command === "DATA") {
          dataMode = true;
          dataLines = [];
          send("354 End data with <CR><LF>.<CR><LF>");
        } else if (command === "QUIT") {
          send("221 2.0.0 Bye");
          socket.end();
        } else if (command === "MAIL" || command === "RCPT" || command === "RSET" || command === "NOOP") {
          send("250 2.0.0 OK");
        } else if (authStep === 1) {
          authStep = 2;
          send("334 UGFzc3dvcmQ6");
        } else if (authStep === 2) {
          authStep = 0;
          send("235 2.7.0 Authentication successful");
        } else {
          send("250 2.0.0 OK");
        }
      }
    });
  });
  smtpServer.listen(smtpPort, "127.0.0.1");
  return once(smtpServer, "listening");
}

// fallow-ignore-next-line complexity -- Inserting a user and its mirror profile is one bounded fixture boundary.
async function insertUser({ id, username, email, password, isAdmin = false, displayName }) {
  const client = new Client({ connectionString: databaseUrl.toString() });
  await client.connect();
  try {
    const passwordHash = password ? await bcrypt.hash(password, 4) : `!google:${"x".repeat(32)}`;
    await client.query(
      `INSERT INTO users
         (id, username, email, password_hash, google_subject_id, auth_provider,
          email_verified, display_name, is_admin)
       VALUES ($1, $2, $3, $4, NULL, 'password', TRUE, $5, $6)`,
      [id, username, email, passwordHash, displayName ?? username, isAdmin],
    );
    await client.query(
      `INSERT INTO accounts_userprofile (user_id, display_name, role, user_group)
       VALUES ($1, $2, $3, $3)`,
      [id, displayName ?? username, isAdmin ? "super_admin" : "user"],
    );
  } finally {
    await client.end();
  }
}

async function query(sql, params = []) {
  const client = new Client({ connectionString: databaseUrl.toString() });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows;
  } finally {
    await client.end();
  }
}

async function login(username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify({ username, password }),
  });
  return { response, cookie: cookieValue(response.headers.get("set-cookie")) };
}

/** Move old reset tokens out of the one-minute resend window for a user. */
async function clearResetCooldown(userId) {
  await query(
    "UPDATE password_reset_tokens SET created_at = NOW() - INTERVAL '2 minutes' WHERE user_id = $1",
    [userId],
  );
}

async function startGoogleLogin(next = "/profile") {
  const response = await fetch(
    `${baseUrl}/api/auth/google/login/start?next=${encodeURIComponent(next)}`,
    { redirect: "manual" },
  );
  const location = response.headers.get("location") ?? "";
  return {
    response,
    location,
    state: queryParam(location, "state"),
    cookie: stateCookiePair(response.headers.get("set-cookie")),
  };
}

before(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), "thai-arts-auth-"));
  await resetDatabase(true);
  const migration = await runNpm(["run", "migration:run"], {
    DATABASE_URL: databaseUrl.toString(),
  });
  assert.equal(migration.code, 0, migration.stderr || migration.stdout);

  const client = new Client({ connectionString: databaseUrl.toString() });
  await client.connect();
  await client.query(
    `INSERT INTO items
       (id, artifact_item_id, name, description, category_group,
        performance_type, price_text, image_url, video_url, is_active)
     VALUES (41, 168393376, 'โขนทดสอบ', 'รายการสำหรับทดสอบสมาชิก',
       'โขน', 'การแสดง', '', '', '', TRUE)`,
  );
  await client.end();

  goodJwk = await exportJWK(goodKeys.publicKey);
  goodJwk.kid = "good-key";
  goodJwk.use = "sig";
  goodJwk.alg = "RS256";

  await startOAuthServer();
  await startSmtpServer();

  server = spawn("npm", ["run", "dev", "--", "-p", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl.toString(),
      NODE_ENV: "test",
      GOOGLE_LOGIN_CLIENT_ID: CLIENT_ID,
      GOOGLE_LOGIN_CLIENT_SECRET: CLIENT_SECRET,
      GOOGLE_LOGIN_REDIRECT_URI: `${baseUrl}/api/auth/google/login/callback`,
      GOOGLE_LOGIN_AUTH_URI: `${oauthBaseUrl}/auth`,
      GOOGLE_LOGIN_TOKEN_URI: `${oauthBaseUrl}/token`,
      GOOGLE_LOGIN_JWKS_URI: `${oauthBaseUrl}/jwks`,
      GOOGLE_LOGIN_STATE_TTL_SECONDS: "600",
      GMAIL_OAUTH_CLIENT_ID: "gmail-client-id",
      GMAIL_OAUTH_CLIENT_SECRET: "gmail-client-secret",
      GMAIL_OAUTH_REDIRECT_URI: `${baseUrl}/api/admin/gmail-oauth/callback`,
      GMAIL_OAUTH_AUTH_URI: `${oauthBaseUrl}/gmail-auth`,
      GMAIL_OAUTH_TOKEN_URI: `${oauthBaseUrl}/gmail-token`,
      GMAIL_OAUTH_TOKEN_FILE: GMAIL_TOKEN_FILE(),
      GMAIL_API_SEND_URI: `${oauthBaseUrl}/gmail-send`,
      GMAIL_SENDER_EMAIL: "sender@example.test",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: String(smtpPort),
      SMTP_USERNAME: "smtp-user",
      SMTP_PASSWORD: "smtp-pass",
      SMTP_FROM_EMAIL: "sender@example.test",
      FRONTEND_BASE_URL: baseUrl,
      PASSWORD_RESET_TOKEN_MINUTES: "30",
      OAUTH_STATE_SECRET: OAUTH_STATE_SECRET,
      MODEL_SERVICE_URL: "http://127.0.0.1:9",
      COMPATIBILITY_SERVICE_URL: "http://127.0.0.1:9",
    },
    shell: process.platform === "win32",
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer();
});

after(async () => {
  await stopServer();
  if (oauthServer) {
    oauthServer.close();
    await once(oauthServer, "close");
  }
  if (smtpServer) {
    smtpServer.close();
    await once(smtpServer, "close");
  }
  if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
  await resetDatabase(false);
});

// --- Google Login -----------------------------------------------------------

test("Google login start binds a signed state cookie and redirects to Google", async () => {
  const { response, location, state, cookie } = await startGoogleLogin("/profile");
  assert.equal(response.status, 303);
  assert.ok(location.startsWith(`${oauthBaseUrl}/auth?`), location);
  assert.ok(state.length >= 20);
  assert.ok(cookie.length > 40);
  const cookieHeader = response.headers.get("set-cookie") ?? "";
  assert.match(cookieHeader, /HttpOnly/i);
  assert.match(cookieHeader, /SameSite=Lax/i);
  assert.match(cookieHeader, /Path=\//i);
  assert.match(cookieHeader, /Max-Age=600/i);
});

test("Google login callback verifies the ID token and creates a server session", async () => {
  const started = await startGoogleLogin("/profile");
  const callback = await fetch(
    `${baseUrl}/api/auth/google/login/callback?code=${encodeURIComponent(`code-${started.state}`)}&state=${encodeURIComponent(started.state)}`,
    {
      redirect: "manual",
      headers: { Cookie: `thaiperform_google_login_state=${started.cookie}` },
    },
  );
  assert.equal(callback.status, 303);
  const location = callback.headers.get("location") ?? "";
  assert.ok(location.startsWith(`${baseUrl}/auth/google/callback?next=`), location);
  assert.equal(queryParam(location, "next"), "/profile");

  const sessionCookie = cookieValue(callback.headers.get("set-cookie"));
  assert.match(sessionCookie, /^thai_arts_session=/);
  const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: sessionCookie } });
  assert.equal(me.status, 200);
  const body = await me.json();
  assert.equal(body.username, "person");
  assert.equal(body.auth_provider, "google");
  assert.equal(body.is_admin, false);
  assert.equal(body.email_verified, true);

  const rows = await query(
    `SELECT username, google_subject_id, auth_provider, is_admin
       FROM users WHERE google_subject_id = $1`,
    [GOOGLE_SUBJECT],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].username, "person");
  assert.equal(rows[0].auth_provider, "google");
  assert.equal(rows[0].is_admin, false);
});

test("Google login callback rejects a mismatched state", async () => {
  const started = await startGoogleLogin("/profile");
  const callback = await fetch(
    `${baseUrl}/api/auth/google/login/callback?code=${encodeURIComponent(`code-${started.state}`)}&state=wrong-state`,
    {
      redirect: "manual",
      headers: { Cookie: `thaiperform_google_login_state=${started.cookie}` },
    },
  );
  assert.equal(callback.status, 303);
  assert.equal(queryParam(callback.headers.get("location") ?? "", "error"), "invalid_google_state");
  // The failed flow must clear the pending state cookie immediately.
  assert.match(callback.headers.get("set-cookie") ?? "", /thaiperform_google_login_state=;.*Max-Age=0/);
});

test("Google login callback rejects a missing state cookie", async () => {
  const callback = await fetch(
    `${baseUrl}/api/auth/google/login/callback?code=mock-google-code&state=anything`,
    { redirect: "manual" },
  );
  assert.equal(callback.status, 303);
  assert.equal(queryParam(callback.headers.get("location") ?? "", "error"), "invalid_google_state");
});

test("Google login callback maps the user cancel error code", async () => {
  const callback = await fetch(
    `${baseUrl}/api/auth/google/login/callback?error=access_denied`,
    { redirect: "manual" },
  );
  assert.equal(callback.status, 303);
  assert.equal(queryParam(callback.headers.get("location") ?? "", "error"), "google_access_denied");
});

test("Google login callback rejects an ID token signed by an unknown key", async () => {
  idTokenMode = "wrong-key";
  try {
    const started = await startGoogleLogin("/profile");
    const callback = await fetch(
      `${baseUrl}/api/auth/google/login/callback?code=${encodeURIComponent(`code-${started.state}`)}&state=${encodeURIComponent(started.state)}`,
      {
        redirect: "manual",
        headers: { Cookie: `thaiperform_google_login_state=${started.cookie}` },
      },
    );
    assert.equal(callback.status, 303);
    assert.equal(queryParam(callback.headers.get("location") ?? "", "error"), "google_login_failed");
  } finally {
    idTokenMode = "valid";
  }
});

test("Google login callback rejects an expired state flow", async () => {
  const stale = encodeStateCookie({
    state: "stale-state",
    verifier: "stale-verifier",
    next: "/profile",
    iat: Math.floor(Date.now() / 1000) - 700,
  });
  const callback = await fetch(
    `${baseUrl}/api/auth/google/login/callback?code=mock-google-code&state=stale-state`,
    {
      redirect: "manual",
      headers: { Cookie: `thaiperform_google_login_state=${stale}` },
    },
  );
  assert.equal(callback.status, 303);
  assert.equal(queryParam(callback.headers.get("location") ?? "", "error"), "invalid_google_state");
});

test("Google login callback rejects an unverified email claim", async () => {
  idTokenMode = "unverified";
  try {
    const started = await startGoogleLogin("/profile");
    const callback = await fetch(
      `${baseUrl}/api/auth/google/login/callback?code=${encodeURIComponent(`code-${started.state}`)}&state=${encodeURIComponent(started.state)}`,
      {
        redirect: "manual",
        headers: { Cookie: `thaiperform_google_login_state=${started.cookie}` },
      },
    );
    assert.equal(callback.status, 303);
    assert.equal(queryParam(callback.headers.get("location") ?? "", "error"), "google_login_failed");
  } finally {
    idTokenMode = "valid";
  }
});

test("Google login exchange consumes the flow once and returns a session", async () => {
  const started = await startGoogleLogin("/items");
  const code = `code-${started.state}`;
  const exchange = await fetch(`${baseUrl}/api/auth/google/login/exchange`, {
    method: "POST",
    headers: mutationHeaders(`thaiperform_google_login_state=${started.cookie}`),
    body: JSON.stringify({ code, state: started.state }),
  });
  assert.equal(exchange.status, 200);
  const body = await exchange.json();
  assert.equal(body.user.username, "person");
  assert.equal(body.expires_in_seconds, 604800);
  assert.equal("access_token" in body, false);
  assert.equal("token_type" in body, false);

  const cookie = cookieValue(exchange.headers.get("set-cookie"));
  assert.match(cookie, /^thai_arts_session=/);
  const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).username, "person");

  // Google authorization codes are single-use: replaying the same code fails.
  const replay = await fetch(`${baseUrl}/api/auth/google/login/exchange`, {
    method: "POST",
    headers: mutationHeaders(`thaiperform_google_login_state=${started.cookie}`),
    body: JSON.stringify({ code, state: started.state }),
  });
  assert.equal(replay.status, 401);
  assert.equal((await replay.json()).error.code, "google_login_failed");
});

test("Google login exchange cannot forge a state cookie without the server secret", async () => {
  const forged = encodeStateCookieWithSecret({
    state: "forged-state",
    verifier: "forged-verifier",
    next: "/admin",
    iat: Math.floor(Date.now() / 1000),
  }, "attacker-secret");
  const exchange = await fetch(`${baseUrl}/api/auth/google/login/exchange`, {
    method: "POST",
    headers: mutationHeaders(`thaiperform_google_login_state=${forged}`),
    body: JSON.stringify({ code: "mock-google-code", state: "forged-state" }),
  });
  assert.equal(exchange.status, 401);
});

function encodeStateCookieWithSecret(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(body, "utf8").digest("base64url");
  return `${body}.${signature}`;
}

test("Google browser callback completes through Next.js without exposing credentials", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const bearerRequests = [];
    page.on("request", (request) => {
      if (request.headers().authorization?.startsWith("Bearer ")) bearerRequests.push(request.url());
    });
    await page.goto(`${baseUrl}/api/auth/google/login/start?next=/items`);
    await page.waitForURL((url) => url.pathname === "/items");
    const browserState = await page.evaluate(async () => {
      const me = await fetch("/api/auth/me");
      return {
        legacyJwt: localStorage.getItem("thai_arts_jwt"),
        visibleCookie: document.cookie,
        meStatus: me.status,
        username: me.ok ? (await me.json()).username : null,
      };
    });
    assert.equal(browserState.legacyJwt, null);
    assert.doesNotMatch(browserState.visibleCookie, /thai_arts_session/);
    assert.equal(browserState.meStatus, 200);
    assert.equal(browserState.username, "person");
    assert.deepEqual(bearerRequests, []);
    const cookies = await context.cookies();
    const sessionCookie = cookies.find((cookie) => cookie.name === "thai_arts_session");
    assert.equal(sessionCookie?.httpOnly, true);
    assert.equal(sessionCookie?.secure, true);
    const stateCookie = cookies.find((cookie) => cookie.name === "thaiperform_google_login_state");
    assert.equal(stateCookie, undefined);
  } finally {
    await browser.close();
  }
});

// --- Password reset ---------------------------------------------------------

test("password reset request emails a one-time link and confirm consumes it once", async () => {
  await insertUser({
    id: 6001,
    username: "reset_user",
    email: "reset@example.test",
    password: "old-password-1",
    displayName: "must_reset|legacy:reset_user",
  });

  const requested = await fetch(`${baseUrl}/api/auth/password-reset/request`, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify({ username: "reset_user", email: "RESET@example.test" }),
  });
  assert.equal(requested.status, 200);
  const requestBody = await requested.json();
  assert.equal(requestBody.accepted, true);
  assert.equal(requestBody.credentials_valid, true);
  assert.equal(requestBody.email_sent, true);
  assert.equal(requestBody.delivery_configured, true);

  const message = smtpMessages.at(-1) ?? "";
  const tokenMatch = /reset-password\?username=reset_user&token=([A-Za-z0-9_-]+)/.exec(message);
  assert.ok(tokenMatch, "reset email must carry the one-time token");
  const rawToken = tokenMatch[1];
  assert.match(message, /From: sender@example\.test/);
  assert.match(message, /To: reset@example\.test/);
  assert.match(message, /เปิดลิงก์นี้ภายใน 30 นาที/);
  assert.equal(smtpMessages.filter((entry) => entry.includes("reset-password?username=reset_user")).length, 1);

  const confirmed = await fetch(`${baseUrl}/api/auth/password-reset/confirm`, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify({ username: "reset_user", token: rawToken, new_password: "new-password-1" }),
  });
  assert.equal(confirmed.status, 200);
  assert.equal((await confirmed.json()).reset, true);

  const oldLogin = await login("reset_user", "old-password-1");
  assert.equal(oldLogin.response.status, 401);
  const newLogin = await login("reset_user", "new-password-1");
  assert.equal(newLogin.response.status, 200);
  assert.equal((await newLogin.response.json()).user.display_name, "reset_user");

  const reuse = await fetch(`${baseUrl}/api/auth/password-reset/confirm`, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify({ username: "reset_user", token: rawToken, new_password: "another-pass" }),
  });
  assert.equal(reuse.status, 400);
  assert.equal((await reuse.json()).error.code, "invalid_reset_token");
});

test("password reset confirm revokes every server session for the account", async () => {
  const loginResult = await login("reset_user", "new-password-1");
  assert.equal(loginResult.response.status, 200);
  const oldCookie = loginResult.cookie;
  const meBefore = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: oldCookie } });
  assert.equal(meBefore.status, 200);

  const confirmed = await fetch(`${baseUrl}/api/auth/password-reset/confirm`, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify({ username: "reset_user", token: "not-a-real-token-but-long-enough", new_password: "newpass123" }),
  });
  assert.equal(confirmed.status, 400);

  // Real token via a fresh request.
  await clearResetCooldown(6001);
  const requested = await fetch(`${baseUrl}/api/auth/password-reset/request`, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify({ username: "reset_user", email: "reset@example.test" }),
  });
  assert.equal((await requested.json()).email_sent, true);
  const message = smtpMessages.at(-1) ?? "";
  const token = /reset-password\?username=reset_user&token=([A-Za-z0-9_-]+)/.exec(message)?.[1];
  assert.ok(token);
  const reset = await fetch(`${baseUrl}/api/auth/password-reset/confirm`, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify({ username: "reset_user", token, new_password: "final-password" }),
  });
  assert.equal(reset.status, 200);

  const meAfter = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: oldCookie } });
  assert.equal(meAfter.status, 401);
  const rows = await query("SELECT COUNT(*)::int AS count FROM user_sessions WHERE user_id = 6001");
  assert.equal(rows[0].count, 0);
});

test("password reset request reports unknown account details", async () => {
  const requested = await fetch(`${baseUrl}/api/auth/password-reset/request`, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify({ username: "ghost_user", email: "ghost@example.test" }),
  });
  assert.equal(requested.status, 200);
  const body = await requested.json();
  assert.equal(body.accepted, false);
  assert.equal(body.credentials_valid, false);
  assert.equal(body.email_sent, false);
});

test("password reset request enforces a one-minute resend cooldown", async () => {
  await clearResetCooldown(6001);
  const first = await fetch(`${baseUrl}/api/auth/password-reset/request`, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify({ username: "reset_user", email: "reset@example.test" }),
  });
  assert.equal((await first.json()).accepted, true);
  const second = await fetch(`${baseUrl}/api/auth/password-reset/request`, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify({ username: "reset_user", email: "reset@example.test" }),
  });
  const secondBody = await second.json();
  assert.equal(secondBody.accepted, false);
  assert.equal(secondBody.credentials_valid, true);
  assert.equal(secondBody.email_sent, false);
  assert.match(secondBody.message, /1 นาที/);
});

test("password reset rejects an expired token", async () => {
  await clearResetCooldown(6001);
  const requested = await fetch(`${baseUrl}/api/auth/password-reset/request`, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify({ username: "reset_user", email: "reset@example.test" }),
  });
  assert.equal((await requested.json()).email_sent, true);
  const message = smtpMessages.at(-1) ?? "";
  const rawToken = /reset-password\?username=reset_user&token=([A-Za-z0-9_-]+)/.exec(message)?.[1];
  assert.ok(rawToken);
  const tokenHash = createHash("sha256").update(rawToken, "utf8").digest("hex");
  await query(
    "UPDATE password_reset_tokens SET expires_at = NOW() - INTERVAL '1 minute' WHERE token_hash = $1",
    [tokenHash],
  );
  const confirmed = await fetch(`${baseUrl}/api/auth/password-reset/confirm`, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify({ username: "reset_user", token: rawToken, new_password: "expired-pass" }),
  });
  assert.equal(confirmed.status, 400);
  assert.equal((await confirmed.json()).error.code, "invalid_reset_token");
});

test("an undelivered reset token is revoked", async () => {
  smtpFailNext = true;
  try {
    const requested = await fetch(`${baseUrl}/api/auth/password-reset/request`, {
      method: "POST",
      headers: mutationHeaders(),
      body: JSON.stringify({ username: "reset_user", email: "reset@example.test" }),
    });
    const body = await requested.json();
    assert.equal(body.accepted, false);
    assert.equal(body.credentials_valid, true);
    assert.equal(body.email_sent, false);
    assert.equal(body.delivery_configured, true);
    const pending = await query(
      "SELECT COUNT(*)::int AS count FROM password_reset_tokens WHERE user_id = 6001 AND used_at IS NULL AND expires_at > NOW()",
    );
    assert.equal(pending[0].count, 0);
  } finally {
    smtpFailNext = false;
  }
});

// --- Admin Gmail sender -----------------------------------------------------

test("Gmail OAuth status and start require an administrator", async () => {
  const anonymousStatus = await fetch(`${baseUrl}/api/admin/gmail-oauth/status`);
  assert.equal(anonymousStatus.status, 401);

  await insertUser({
    id: 6002,
    username: "plain_member",
    email: "member@example.test",
    password: "member-pass-1",
    isAdmin: false,
  });
  const memberLogin = await login("plain_member", "member-pass-1");
  assert.equal(memberLogin.response.status, 200);
  const memberStatus = await fetch(`${baseUrl}/api/admin/gmail-oauth/status`, {
    headers: { Cookie: memberLogin.cookie },
  });
  assert.equal(memberStatus.status, 403);
  const memberStart = await fetch(`${baseUrl}/api/admin/gmail-oauth/start`, {
    method: "POST",
    headers: mutationHeaders(memberLogin.cookie),
  });
  assert.equal(memberStart.status, 403);
});

// fallow-ignore-next-line complexity -- The happy path, a wrong-state attempt, and status verification share one test.
test("Gmail sender authorization completes only for the flow owner", async () => {
  await insertUser({
    id: 6003,
    username: "admin_user",
    email: "admin@example.test",
    password: "admin-pass-1",
    isAdmin: true,
  });
  const adminLogin = await login("admin_user", "admin-pass-1");
  assert.equal(adminLogin.response.status, 200);

  const start = await fetch(`${baseUrl}/api/admin/gmail-oauth/start`, {
    method: "POST",
    headers: mutationHeaders(adminLogin.cookie),
  });
  assert.equal(start.status, 200);
  const startBody = await start.json();
  assert.ok(startBody.authorization_url.startsWith(`${oauthBaseUrl}/gmail-auth?`));
  const state = queryParam(startBody.authorization_url, "state");
  const rawCookie = start.headers.get("set-cookie") ?? "";
  const stateCookie = /^thaiperform_gmail_oauth_state=([^;]+)/.exec(rawCookie)?.[1];
  assert.ok(stateCookie);

  // A wrong state must fail without writing the token file.
  const wrong = await fetch(
    `${baseUrl}/api/admin/gmail-oauth/callback?code=code&state=wrong`,
    {
      redirect: "manual",
      headers: { Cookie: `thaiperform_gmail_oauth_state=${stateCookie}` },
    },
  );
  assert.equal(wrong.status, 303);
  assert.equal(queryParam(wrong.headers.get("location") ?? "", "oauth"), "error");
  assert.equal(existsSync(GMAIL_TOKEN_FILE()), false);

  // The correct state completes and persists the refresh token.
  const completed = await fetch(
    `${baseUrl}/api/admin/gmail-oauth/callback?code=mock-gmail-code&state=${encodeURIComponent(state)}`,
    {
      redirect: "manual",
      headers: { Cookie: `thaiperform_gmail_oauth_state=${stateCookie}` },
    },
  );
  assert.equal(completed.status, 303);
  assert.equal(queryParam(completed.headers.get("location") ?? "", "oauth"), "success");

  const tokenFile = JSON.parse(await readFile(GMAIL_TOKEN_FILE(), "utf8"));
  assert.equal(tokenFile.refresh_token, "gmail-refresh-token");

  const status = await fetch(`${baseUrl}/api/admin/gmail-oauth/status`, {
    headers: { Cookie: adminLogin.cookie },
  });
  assert.equal(status.status, 200);
  const statusBody = await status.json();
  assert.equal(statusBody.client_configured, true);
  assert.equal(statusBody.authorized, true);
  assert.equal(statusBody.delivery_configured, true);
  assert.equal(statusBody.sender_email, "sender@example.test");
  assert.equal(statusBody.redirect_uri, `${baseUrl}/api/admin/gmail-oauth/callback`);
});

test("Gmail sender callback without a state cookie is rejected", async () => {
  const callback = await fetch(
    `${baseUrl}/api/admin/gmail-oauth/callback?code=code&state=orphaned`,
    { redirect: "manual" },
  );
  assert.equal(callback.status, 303);
  assert.equal(queryParam(callback.headers.get("location") ?? "", "oauth"), "error");
});
