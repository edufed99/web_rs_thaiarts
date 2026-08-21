import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import pg from "pg";

const { Client } = pg;
const databaseName = "web_rs_thaiarts_members_test";
const adminUrl =
  process.env.TEST_POSTGRES_ADMIN_URL ??
  "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${databaseName}`;
const port = 3102;
const baseUrl = `http://127.0.0.1:${port}`;

let server;
let mediaStoreRoot;

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
  throw new Error("Timed out waiting for member test server");
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

before(async () => {
  mediaStoreRoot = await mkdtemp(join(tmpdir(), "thai-arts-members-"));
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

  server = spawn("npm", ["run", "dev", "--", "-p", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl.toString(),
      NODE_ENV: "test",
      MEDIA_STORE_ROOT: mediaStoreRoot,
    },
    shell: process.platform === "win32",
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer();
});

after(async () => {
  await stopServer();
  if (mediaStoreRoot) await rm(mediaStoreRoot, { recursive: true, force: true });
  await resetDatabase(false);
});

function signup(username, email) {
  return fetch(`${baseUrl}/api/auth/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
      "Sec-Fetch-Site": "same-origin",
      "X-CSRF-Token": "same-origin",
    },
    body: JSON.stringify({
      username,
      email,
      password: "correct horse battery staple",
      display_name: username,
    }),
  });
}

test("concurrent first password signups can bootstrap at most one admin", async () => {
  const client = new Client({ connectionString: databaseUrl.toString() });
  await client.connect();

  const responses = await Promise.all([
    signup("bootstrap_one", "bootstrap-one@example.test"),
    signup("bootstrap_two", "bootstrap-two@example.test"),
  ]);
  assert.deepEqual(responses.map((response) => response.status), [200, 200]);
  const result = await client.query(
    "SELECT COUNT(*) FILTER (WHERE is_admin) AS admin_count FROM users",
  );
  await client.end();
  assert.equal(Number(result.rows[0].admin_count), 1);
});

test("password signup issues only a secure opaque server session", async () => {
  const response = await fetch(`${baseUrl}/api/auth/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
      "Sec-Fetch-Site": "same-origin",
      "X-CSRF-Token": "same-origin",
    },
    body: JSON.stringify({
      username: "member_one",
      email: "member@example.test",
      password: "correct horse battery staple",
      display_name: "สมาชิกทดสอบ",
    }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.user.username, "member_one");
  assert.equal("access_token" in body, false);

  const setCookie = response.headers.get("set-cookie");
  assert.match(setCookie, /thai_arts_session=[A-Za-z0-9_-]+/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.match(setCookie, /Path=\//i);
  assert.match(setCookie, /Max-Age=604800/i);

  const client = new Client({ connectionString: databaseUrl.toString() });
  await client.connect();
  const sessions = await client.query(
    `SELECT session.token_hash, session.expires_at
       FROM user_sessions session
       JOIN users member ON member.id = session.user_id
      WHERE member.username = 'member_one'`,
  );
  await client.end();
  assert.equal(sessions.rowCount, 1);
  assert.equal(setCookie.includes(sessions.rows[0].token_hash), false);
});

test("member profile and avatar changes persist and cannot change role", async () => {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl, "X-CSRF-Token": "same-origin" },
    body: JSON.stringify({ username: "member_one", password: "correct horse battery staple" }),
  });
  const cookie = cookieValue(login.headers.get("set-cookie"));
  const headers = { Cookie: cookie, Origin: baseUrl, "X-CSRF-Token": "same-origin" };
  const patch = await fetch(`${baseUrl}/api/me/profile`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ display_name: "ชื่อใหม่", bio: "ประวัติใหม่" }),
  });
  assert.equal(patch.status, 200);
  assert.equal((await patch.json()).bio, "ประวัติใหม่");
  const escalation = await fetch(`${baseUrl}/api/me/profile`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "super_admin" }),
  });
  assert.equal(escalation.status, 422);

  const form = new FormData();
  form.append("file", new File([new Uint8Array([137, 80, 78, 71])], "avatar.png", { type: "image/png" }));
  const upload = await fetch(`${baseUrl}/api/me/profile/avatar`, { method: "POST", headers, body: form });
  assert.equal(upload.status, 200);
  assert.match((await upload.json()).avatar_url, /^\/api\/uploads\/avatars\/user-/);
  const reloaded = await fetch(`${baseUrl}/api/me/profile`, { headers: { Cookie: cookie } });
  assert.equal((await reloaded.json()).display_name, "ชื่อใหม่");
  const removed = await fetch(`${baseUrl}/api/me/profile/avatar`, { method: "DELETE", headers });
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).avatar_url, "");
});

test("login rotates sessions and logout revokes the active session", async () => {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
      "X-CSRF-Token": "same-origin",
    },
    body: JSON.stringify({ username: "member_one", password: "correct horse battery staple" }),
  });
  assert.equal(login.status, 200);
  const cookie = cookieValue(login.headers.get("set-cookie"));

  const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).username, "member_one");

  const forged = await fetch(`${baseUrl}/api/actions/like`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      Origin: "https://attacker.example",
      "X-CSRF-Token": "same-origin",
    },
    body: JSON.stringify({ item_id: 168393376, user_key: "user:999" }),
  });
  assert.equal(forged.status, 403);

  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: baseUrl, "X-CSRF-Token": "same-origin" },
  });
  assert.equal(logout.status, 200);
  const after = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
  assert.equal(after.status, 401);
});

test("member actions are authorized by session and persist by artifact item id", async () => {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
      "X-CSRF-Token": "same-origin",
    },
    body: JSON.stringify({ username: "member_one", password: "correct horse battery staple" }),
  });
  const cookie = cookieValue(login.headers.get("set-cookie"));
  const headers = {
    "Content-Type": "application/json",
    Cookie: cookie,
    Origin: baseUrl,
    "X-CSRF-Token": "same-origin",
  };

  const like = await fetch(`${baseUrl}/api/actions/like`, {
    method: "POST",
    headers,
    body: JSON.stringify({ item_id: 168393376, user_key: "anon:forged" }),
  });
  assert.equal(like.status, 200);
  assert.equal((await like.json()).item.user_state.liked, true);

  const rating = await fetch(`${baseUrl}/api/actions/rating`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ item_id: 168393376, rating: 5 }),
  });
  assert.equal(rating.status, 200);

  const list = await fetch(`${baseUrl}/api/me/liked`, { headers: { Cookie: cookie } });
  assert.deepEqual(await list.json(), { items: [168393376], total: 1 });

  const reloadedItem = await fetch(`${baseUrl}/api/items/168393376`, { headers: { Cookie: cookie } });
  assert.equal(reloadedItem.status, 200);
  assert.equal((await reloadedItem.json()).user_state.liked, true);

  const unauthorized = await fetch(`${baseUrl}/api/me/liked`);
  assert.equal(unauthorized.status, 401);
});
