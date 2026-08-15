// Public-boundary tests for issue #8: admin authorization, catalogue and
// user management through the Next.js Application Backend, the media
// lifecycle, and the Artifact Publication state transition.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import pg from "pg";

const { Client } = pg;
const databaseName = "web_rs_thaiarts_admin_test";
const adminUrl =
  process.env.TEST_POSTGRES_ADMIN_URL ??
  "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${databaseName}`;

const port = 3103;
const baseUrl = `http://127.0.0.1:${port}`;
const referenceItemId = 900101;
const editableItemId = 900102;
const thirdItemId = 900103;
const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const mp4Bytes = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from("ftypisom"), Buffer.from([0x00, 0x00, 0x02, 0x00])]);

let mediaRoot;
let server;
let modelServer;
let modelServiceUrl;
let failModelHealth = false;
const similarityRequests = [];

async function resetTestDatabase({ create }) {
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

async function waitForServer(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/health`).catch(() => undefined);
    if (response?.status !== undefined) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the admin test server");
}

async function stopServer() {
  const activeServer = server;
  if (!activeServer) return;
  if (activeServer.exitCode === null) {
    const exited = once(activeServer, "exit");
    if (process.platform === "win32") {
      await new Promise((resolve) => {
        const killer = spawn(
          "taskkill",
          ["/pid", String(activeServer.pid), "/t", "/f"],
          { stdio: "ignore" },
        );
        killer.on("close", resolve);
      });
    } else {
      process.kill(-activeServer.pid, "SIGTERM");
    }
    await exited;
  }
  server = undefined;
}

async function seedCatalogue() {
  const client = new Client({ connectionString: databaseUrl.toString() });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO contexts (id, name, group_name, description)
       VALUES (51, 'งานบวช', 'งานมงคล', 'บริบททดสอบ'), (52, 'งานศพ', 'พิธีกรรม', 'บริบททดสอบ')`,
    );
    await client.query(
      `INSERT INTO taxonomy_nodes (id, name, level, parent_id)
       VALUES (71, 'เครื่องแต่งกาย', 1, NULL), (72, 'ศีรษะ', 2, 71)`,
    );
    await client.query(
      `INSERT INTO keywords (id, name, taxonomy_node_id)
       VALUES (61, 'ชฎา', 72), (62, 'ลิเก', NULL), (63, 'โขน', NULL)`,
    );
    await client.query(
      `INSERT INTO items
         (id, artifact_item_id, name, description, category_group,
          performance_type, performers_count, duration_minutes, price_text,
          image_url, video_url, is_active)
       VALUES
         (41, $1, 'ระบำหลักทดสอบ', 'ระบำสำหรับทดสอบระบบผู้ดูแล',
          'ระบำ', 'การแสดง', 8, 30, '', '', '', TRUE),
         (42, $2, 'ลิเกรองทดสอบ', 'ลิเกสำหรับทดสอบระบบผู้ดูแล',
          'ลิเก', 'การแสดง', 6, 20, '', '', '', TRUE),
         (43, $3, 'โขนรองทดสอบ', 'โขนสำหรับทดสอบระบบผู้ดูแล',
          'โขน', 'การแสดง', 10, 40, '', '', '', TRUE)`,
      [referenceItemId, editableItemId, thirdItemId],
    );
    await client.query(
      `INSERT INTO item_contexts (id, item_id, context_id, validity_status)
       VALUES (81, 41, 51, 'valid'), (82, 42, 51, 'valid'), (83, 43, 51, 'valid')`,
    );
    await client.query(
      `INSERT INTO item_keywords (id, item_id, keyword_id, source)
       VALUES (91, 41, 61, 'fixture'), (92, 42, 62, 'fixture'), (93, 43, 63, 'fixture')`,
    );
  } finally {
    await client.end();
  }
}

async function startModelServer() {
  // fallow-ignore-next-line complexity -- The stub serves health, similarity, and test-control endpoints.
  modelServer = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/internal/v1/health") {
      const authorized = request.headers.authorization === "Bearer admin-test-secret";
      if (!authorized) {
        response.writeHead(401).end();
        return;
      }
      if (failModelHealth) {
        response.writeHead(503).end();
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ status: "ok", artifact_version: "test-build", artifact_item_count: 3 }));
      return;
    }
    if (request.method === "POST" && request.url === "/internal/v1/similarity") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      assert.equal(request.headers.authorization, "Bearer admin-test-secret");
      similarityRequests.push(body);
      const ranked = [...body.candidate_artifact_item_ids].reverse().map((id, index) => ({
        artifact_item_id: id,
        score: 0.9 - index / 10,
      }));
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ranked_candidates: ranked }));
      return;
    }
    if (request.method === "POST" && request.url === "/__control") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      failModelHealth = Boolean(body.fail_health);
      response.writeHead(200).end("{}");
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve) => modelServer.listen(0, "127.0.0.1", resolve));
  const address = modelServer.address();
  modelServiceUrl = `http://127.0.0.1:${address.port}`;
}

async function modelControl(payload) {
  await fetch(`${modelServiceUrl}/__control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function mutationHeaders(cookie, extra = {}) {
  return {
    "Content-Type": "application/json",
    Origin: baseUrl,
    "Sec-Fetch-Site": "same-origin",
    "X-CSRF-Token": "same-origin",
    ...(cookie ? { Cookie: cookie } : {}),
    ...extra,
  };
}

// Multipart uploads must NOT set Content-Type — the browser (and undici)
// needs to generate the boundary itself, matching lib/api.ts behavior.
function multipartHeaders(cookie) {
  return {
    Origin: baseUrl,
    "Sec-Fetch-Site": "same-origin",
    "X-CSRF-Token": "same-origin",
    ...(cookie ? { Cookie: cookie } : {}),
  };
}

function cookieValue(setCookie) {
  return setCookie?.split(";", 1)[0] ?? "";
}

async function signup(username, password = "correct horse battery staple") {
  return fetch(`${baseUrl}/api/auth/signup`, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify({ username, email: `${username}@example.test`, password, display_name: username }),
  });
}

let adminCookie = "";
let memberCookie = "";
let committedNewItemId = 0;

before(async () => {
  await resetTestDatabase({ create: true });
  mediaRoot = await mkdtemp(join(tmpdir(), "thaiarts-admin-"));
  await mkdir(join(mediaRoot, "items"), { recursive: true });
  await mkdir(join(mediaRoot, "avatars"), { recursive: true });

  const migrated = await runNpm(["run", "migration:run"], {
    DATABASE_URL: databaseUrl.toString(),
  });
  assert.equal(migrated.code, 0, `${migrated.stdout}\n${migrated.stderr}`);
  const seeded = await runNpm(["run", "seed"], {
    DATABASE_URL: databaseUrl.toString(),
  });
  assert.equal(seeded.code, 0, `${seeded.stdout}\n${seeded.stderr}`);
  await seedCatalogue();
  await startModelServer();

  server = spawn("npm", ["run", "dev", "--", "--port", String(port)], {
    cwd: process.cwd(),
    detached: process.platform !== "win32",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl.toString(),
      MEDIA_STORE_ROOT: mediaRoot,
      MODEL_SERVICE_URL: "http://127.0.0.1:9",
      COMPATIBILITY_SERVICE_URL: "http://127.0.0.1:9",
      PRIVATE_MODEL_SERVICE_URL: modelServiceUrl,
      MODEL_SERVICE_SHARED_SECRET: "admin-test-secret",
    },
    stdio: "ignore",
  });
  await waitForServer();

  // First signup bootstraps the admin (documented behavior), the second
  // is a plain member.
  const adminSignup = await signup("admin_one");
  assert.equal(adminSignup.status, 200, await adminSignup.text());
  adminCookie = cookieValue(adminSignup.headers.get("set-cookie"));
  const memberSignup = await signup("member_two");
  assert.equal(memberSignup.status, 200, await memberSignup.text());
  memberCookie = cookieValue(memberSignup.headers.get("set-cookie"));
});

after(async () => {
  await stopServer();
  if (modelServer) await new Promise((resolve) => modelServer.close(resolve));
  if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
  await resetTestDatabase({ create: false });
});

// --- Authorization ----------------------------------------------------------

test("anonymous callers are rejected from every admin operation", async () => {
  const cases = [
    ["GET", "/api/admin/users"],
    ["GET", "/api/admin/items/facets"],
    ["GET", "/api/admin/publication"],
  ];
  for (const [method, path] of cases) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 401, `${method} ${path} should be 401`);
    assert.equal((await response.json()).error.code, "unauthorized");
  }
  const mutation = await fetch(`${baseUrl}/api/admin/users`, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify({ username: "x", password: "password123", is_admin: false }),
  });
  assert.equal(mutation.status, 401);
  const itemMutation = await fetch(`${baseUrl}/api/admin/items/${editableItemId}`, {
    method: "PUT",
    headers: mutationHeaders(),
    body: JSON.stringify({ name: "ไม่ควรสำเร็จ" }),
  });
  assert.equal(itemMutation.status, 401);
  const publication = await fetch(`${baseUrl}/api/admin/publication`, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify({}),
  });
  assert.equal(publication.status, 401);
});

test("authenticated non-admin users cannot access administrative operations", async () => {
  const list = await fetch(`${baseUrl}/api/admin/users`, {
    headers: { Cookie: memberCookie },
  });
  assert.equal(list.status, 403);
  assert.equal((await list.json()).error.code, "forbidden");

  const create = await fetch(`${baseUrl}/api/admin/users`, {
    method: "POST",
    headers: mutationHeaders(memberCookie),
    body: JSON.stringify({ username: "sneaky", password: "password123", is_admin: true }),
  });
  assert.equal(create.status, 403);

  const editItem = await fetch(`${baseUrl}/api/admin/items/${editableItemId}`, {
    method: "PUT",
    headers: mutationHeaders(memberCookie),
    body: JSON.stringify({ name: "แฮ็กข้อมูล" }),
  });
  assert.equal(editItem.status, 403);

  const deleteItem = await fetch(`${baseUrl}/api/admin/items/${editableItemId}`, {
    method: "DELETE",
    headers: mutationHeaders(memberCookie),
  });
  assert.equal(deleteItem.status, 403);

  const facets = await fetch(`${baseUrl}/api/admin/items/facets`, {
    headers: { Cookie: memberCookie },
  });
  assert.equal(facets.status, 403);

  const status = await fetch(`${baseUrl}/api/admin/publication`, {
    headers: { Cookie: memberCookie },
  });
  assert.equal(status.status, 403);

  const publish = await fetch(`${baseUrl}/api/admin/publication`, {
    method: "POST",
    headers: mutationHeaders(memberCookie),
    body: JSON.stringify({}),
  });
  assert.equal(publish.status, 403);

  const image = await fetch(`${baseUrl}/api/admin/items/${editableItemId}/image`, {
    method: "POST",
    headers: multipartHeaders(memberCookie),
    body: new FormData(),
  });
  assert.equal(image.status, 403);
});

// --- Admin user management -------------------------------------------------

test("administrators can create, list, update, and delete users", async () => {
  const create = await fetch(`${baseUrl}/api/admin/users`, {
    method: "POST",
    headers: mutationHeaders(adminCookie),
    body: JSON.stringify({
      username: "managed_user",
      email: "managed@example.test",
      password: "password123",
      display_name: "ผู้ใช้ที่จัดการ",
      is_admin: false,
    }),
  });
  assert.equal(create.status, 200);
  const created = await create.json();
  assert.equal(created.username, "managed_user");
  assert.equal(created.is_admin, false);

  const duplicate = await fetch(`${baseUrl}/api/admin/users`, {
    method: "POST",
    headers: mutationHeaders(adminCookie),
    body: JSON.stringify({ username: "managed_user", password: "password123", is_admin: false }),
  });
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).error.code, "duplicate_username");

  const list = await fetch(`${baseUrl}/api/admin/users`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(list.status, 200);
  const listing = await list.json();
  assert.ok(listing.users.some((user) => user.username === "admin_one" && user.is_admin));
  assert.ok(listing.users.some((user) => user.username === "member_two" && !user.is_admin));

  const update = await fetch(`${baseUrl}/api/admin/users/${created.id}`, {
    method: "PUT",
    headers: mutationHeaders(adminCookie),
    body: JSON.stringify({ display_name: "เปลี่ยนชื่อแล้ว", is_admin: true }),
  });
  assert.equal(update.status, 200);
  assert.equal((await update.json()).display_name, "เปลี่ยนชื่อแล้ว");

  const demoteSelf = await fetch(`${baseUrl}/api/admin/users/1`, {
    method: "PUT",
    headers: mutationHeaders(adminCookie),
    body: JSON.stringify({ is_admin: false }),
  });
  assert.equal(demoteSelf.status, 400);
  assert.equal((await demoteSelf.json()).error.code, "cannot_demote_self");

  const deleteSelf = await fetch(`${baseUrl}/api/admin/users/1`, {
    method: "DELETE",
    headers: mutationHeaders(adminCookie),
  });
  assert.equal(deleteSelf.status, 400);
  assert.equal((await deleteSelf.json()).error.code, "cannot_delete_self");

  const remove = await fetch(`${baseUrl}/api/admin/users/${created.id}`, {
    method: "DELETE",
    headers: mutationHeaders(adminCookie),
  });
  assert.equal(remove.status, 200);
  assert.equal((await remove.json()).deleted, true);

  const missing = await fetch(`${baseUrl}/api/admin/users/999999`, {
    method: "DELETE",
    headers: mutationHeaders(adminCookie),
  });
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, "user_not_found");
});

// --- Catalogue edit behavior -----------------------------------------------

test("admin edits are immediately visible in browsing and preserve the artifact item id", async () => {
  const update = await fetch(`${baseUrl}/api/admin/items/${editableItemId}`, {
    method: "PUT",
    headers: mutationHeaders(adminCookie),
    body: JSON.stringify({
      name: "ลิเกรองเปลี่ยนชื่อ",
      description: "คำอธิบายที่แก้ไขโดยผู้ดูแลระบบ",
      context_names: ["งานบวช"],
      keyword_ids: [62, 63],
      new_keyword_names: ["คำใหม่"],
    }),
  });
  assert.equal(update.status, 200);
  const updated = await update.json();
  assert.equal(updated.item.id, editableItemId);
  assert.equal(updated.item.name, "ลิเกรองเปลี่ยนชื่อ");
  assert.ok(updated.item.keywords.some((keyword) => keyword.name === "คำใหม่"));
  assert.ok(updated.item.keywords.some((keyword) => keyword.name === "โขน"));

  // Browsing reflects the edit immediately.
  const browse = await fetch(`${baseUrl}/api/items/${editableItemId}`);
  assert.equal(browse.status, 200);
  const browsed = await browse.json();
  assert.equal(browsed.id, editableItemId);
  assert.equal(browsed.name, "ลิเกรองเปลี่ยนชื่อ");

  // The artifact item identifier never changed.
  const client = new Client({ connectionString: databaseUrl.toString() });
  await client.connect();
  const row = await client.query(
    "SELECT artifact_item_id, published_at FROM items WHERE id = 42",
  );
  await client.end();
  assert.equal(Number(row.rows[0].artifact_item_id), editableItemId);
  assert.equal(row.rows[0].published_at, null);

  const missing = await fetch(`${baseUrl}/api/admin/items/999999999`, {
    method: "PUT",
    headers: mutationHeaders(adminCookie),
    body: JSON.stringify({ name: "ไม่มีรายการนี้" }),
  });
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, "item_not_found");
});

test("edited items are unavailable to personalized scoring until publication", async () => {
  // The reference item is published; the edited item must be excluded
  // from the model-service candidates.
  const before = await fetch(`${baseUrl}/api/items/${referenceItemId}/similar?limit=4`);
  assert.equal(before.status, 200);
  const beforeBody = await before.json();
  assert.deepEqual(
    beforeBody.items.map((item) => item.id),
    [thirdItemId],
    "edited item must not be ranked while unpublished",
  );
  assert.equal(
    similarityRequests.at(-1).candidate_artifact_item_ids.includes(editableItemId),
    false,
  );

  const status = await fetch(`${baseUrl}/api/admin/publication`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(status.status, 200);
  const statusBody = await status.json();
  assert.equal(statusBody.model.reachable, true);
  assert.equal(statusBody.model.artifact_version, "test-build");
  assert.ok(statusBody.pending.items.some((item) => item.id === 42));
  assert.equal(statusBody.published, null);
});

// --- Media lifecycle -------------------------------------------------------

test("media uploads are sniffed, persisted, and old files are cleaned up", async () => {
  const first = new FormData();
  first.append("file", new File([jpegBytes], "cover.jpg", { type: "image/jpeg" }));
  const uploadOne = await fetch(`${baseUrl}/api/admin/items/${editableItemId}/image`, {
    method: "POST",
    headers: multipartHeaders(adminCookie),
    body: first,
  });
  assert.equal(uploadOne.status, 200);
  const imageOne = await uploadOne.json();
  assert.equal(imageOne.mime, "image/jpeg");
  assert.equal(imageOne.item_id, editableItemId);
  assert.match(imageOne.url, /^\/uploads\/items\/900102_[A-Za-z0-9-]+\.jpg$/);

  const served = await fetch(`${baseUrl}/api${imageOne.url}`);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-type"), "image/jpeg");
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), jpegBytes);

  const second = new FormData();
  second.append("file", new File([pngBytes], "cover2.png", { type: "image/png" }));
  const uploadTwo = await fetch(`${baseUrl}/api/admin/items/${editableItemId}/image`, {
    method: "POST",
    headers: multipartHeaders(adminCookie),
    body: second,
  });
  assert.equal(uploadTwo.status, 200);
  const imageTwo = await uploadTwo.json();
  assert.equal(imageTwo.mime, "image/png");
  assert.notEqual(imageTwo.url, imageOne.url);

  // Old file removed best-effort after the DB write.
  const oldFile = await fetch(`${baseUrl}/api${imageOne.url}`);
  assert.equal(oldFile.status, 404);

  const browse = await fetch(`${baseUrl}/api/items/${editableItemId}`);
  assert.equal((await browse.json()).image_url, imageTwo.url);

  const wrong = new FormData();
  wrong.append("file", new File([Buffer.from("not an image")], "fake.jpg", { type: "image/jpeg" }));
  const rejected = await fetch(`${baseUrl}/api/admin/items/${editableItemId}/image`, {
    method: "POST",
    headers: multipartHeaders(adminCookie),
    body: wrong,
  });
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error.code, "image_invalid_type");

  const missingItem = new FormData();
  missingItem.append("file", new File([jpegBytes], "cover.jpg", { type: "image/jpeg" }));
  const missing = await fetch(`${baseUrl}/api/admin/items/999999999/image`, {
    method: "POST",
    headers: multipartHeaders(adminCookie),
    body: missingItem,
  });
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, "item_not_found");

  const videoForm = new FormData();
  videoForm.append("file", new File([mp4Bytes], "show.mp4", { type: "video/mp4" }));
  const video = await fetch(`${baseUrl}/api/admin/items/${editableItemId}/video`, {
    method: "POST",
    headers: multipartHeaders(adminCookie),
    body: videoForm,
  });
  assert.equal(video.status, 200);
  const videoBody = await video.json();
  assert.equal(videoBody.mime, "video/mp4");
  assert.match(videoBody.url, /\/uploads\/items\/900102_video_[A-Za-z0-9-]+\.mp4$/);
});

// --- Create-item journey (draft + commit) ----------------------------------

test("administrators can ground a draft and commit a new catalogue item", async () => {
  const draft = await fetch(`${baseUrl}/api/admin/items/draft`, {
    method: "POST",
    headers: mutationHeaders(adminCookie),
    body: JSON.stringify({
      name: "ชุดการแสดงใหม่ทดสอบ",
      description: "การแสดงที่สวมชฎาและร้องลิเก",
      category_group: "ระบำ",
      performance_type: "การแสดง",
      context_names: ["งานบวช"],
      keyword_names: ["ลิเก"],
    }),
  });
  assert.equal(draft.status, 200);
  const draftBody = await draft.json();
  assert.ok(draftBody.draft_id.length > 0);
  assert.ok(draftBody.proposals.some((proposal) => proposal.id === 61 && proposal.source === "auto"));
  assert.ok(draftBody.context_ids.includes(51));

  const commit = await fetch(`${baseUrl}/api/admin/items`, {
    method: "POST",
    headers: mutationHeaders(adminCookie),
    body: JSON.stringify({ draft_id: draftBody.draft_id, additional_keyword_ids: [], removed_keyword_ids: [] }),
  });
  assert.equal(commit.status, 200);
  const committed = await commit.json();
  assert.equal(committed.item.name, "ชุดการแสดงใหม่ทดสอบ");
  assert.ok(committed.item.keywords.some((keyword) => keyword.name === "ชฎา"));
  assert.ok(committed.item.keywords.some((keyword) => keyword.name === "ลิเก"));
  const newArtifactId = committed.item.id;
  committedNewItemId = newArtifactId;

  // Browsing sees it immediately.
  const browse = await fetch(`${baseUrl}/api/items/${newArtifactId}`);
  assert.equal(browse.status, 200);
  assert.equal((await browse.json()).name, "ชุดการแสดงใหม่ทดสอบ");

  // New content stays unavailable to scoring until publication.
  const status = await fetch(`${baseUrl}/api/admin/publication`, {
    headers: { Cookie: adminCookie },
  });
  const statusBody = await status.json();
  assert.ok(
    statusBody.pending.items.some((item) => item.name === "ชุดการแสดงใหม่ทดสอบ"),
    "newly created items stay pending until publication",
  );

  // A stale draft cannot be replayed.
  const replay = await fetch(`${baseUrl}/api/admin/items`, {
    method: "POST",
    headers: mutationHeaders(adminCookie),
    body: JSON.stringify({ draft_id: draftBody.draft_id, additional_keyword_ids: [], removed_keyword_ids: [] }),
  });
  assert.equal(replay.status, 400);
  assert.equal((await replay.json()).error.code, "unknown_draft");
});

// --- Artifact Publication state transition ---------------------------------

test("a successful Artifact Publication covers pending rows and re-enables scoring", async () => {
  const statusBefore = await fetch(`${baseUrl}/api/admin/publication`, {
    headers: { Cookie: adminCookie },
  });
  const before = await statusBefore.json();
  assert.equal(before.pending.count, 2); // edited item + newly created item

  const publish = await fetch(`${baseUrl}/api/admin/publication`, {
    method: "POST",
    headers: mutationHeaders(adminCookie),
    body: JSON.stringify({ note: "รอบทดสอบการเผยแพร่" }),
  });
  assert.equal(publish.status, 200);
  const result = await publish.json();
  assert.equal(result.publication.build_id, "test-build:3");
  assert.equal(result.publication.item_count, 2);
  assert.equal(result.publication.note, "รอบทดสอบการเผยแพร่");
  assert.equal(result.pending_after, 0);

  const statusAfter = await fetch(`${baseUrl}/api/admin/publication`, {
    headers: { Cookie: adminCookie },
  });
  const after = await statusAfter.json();
  assert.equal(after.pending.count, 0);
  assert.equal(after.published.build_id, "test-build:3");

  // Personalized scoring accepts the previously-pending rows again.
  const similar = await fetch(`${baseUrl}/api/items/${referenceItemId}/similar?limit=4`);
  const similarBody = await similar.json();
  assert.deepEqual(
    new Set(similarBody.items.map((item) => item.id)),
    new Set([editableItemId, thirdItemId, committedNewItemId]),
    "published rows re-enter model-service scoring",
  );
});

test("publication fails when the model service is unreachable or unauthenticated", async () => {
  await modelControl({ fail_health: true });
  try {
    // Edit something so there is a pending row to publish.
    const update = await fetch(`${baseUrl}/api/admin/items/${thirdItemId}`, {
      method: "PUT",
      headers: mutationHeaders(adminCookie),
      body: JSON.stringify({ price_text: "ราคาใหม่" }),
    });
    assert.equal(update.status, 200);

    const publish = await fetch(`${baseUrl}/api/admin/publication`, {
      method: "POST",
      headers: mutationHeaders(adminCookie),
      body: JSON.stringify({}),
    });
    assert.equal(publish.status, 503);
    assert.equal((await publish.json()).error.code, "model_service_unavailable");

    // The pending row stays pending; the previous publication is intact.
    const status = await fetch(`${baseUrl}/api/admin/publication`, {
      headers: { Cookie: adminCookie },
    });
    const body = await status.json();
    assert.equal(body.model.reachable, false);
    assert.ok(body.pending.items.some((item) => item.id === 43));
  } finally {
    await modelControl({ fail_health: false });
  }
});

// --- Delete + CSRF ----------------------------------------------------------

test("deleting an item removes it from browsing and cleans linked rows", async () => {
  const update = await fetch(`${baseUrl}/api/admin/items/${thirdItemId}`, {
    method: "PUT",
    headers: mutationHeaders(adminCookie),
    body: JSON.stringify({ name: "โขนรองลบทิ้ง" }),
  });
  assert.equal(update.status, 200);

  const remove = await fetch(`${baseUrl}/api/admin/items/${thirdItemId}`, {
    method: "DELETE",
    headers: mutationHeaders(adminCookie),
  });
  assert.equal(remove.status, 200);
  assert.equal((await remove.json()).deleted, true);

  const browse = await fetch(`${baseUrl}/api/items/${thirdItemId}`);
  assert.equal(browse.status, 404);
  assert.equal((await browse.json()).error.code, "item_not_found");

  const client = new Client({ connectionString: databaseUrl.toString() });
  await client.connect();
  const links = await client.query(
    "SELECT COUNT(*) AS count FROM item_keywords WHERE item_id = 43",
  );
  const contexts = await client.query(
    "SELECT COUNT(*) AS count FROM item_contexts WHERE item_id = 43",
  );
  await client.end();
  assert.equal(Number(links.rows[0].count), 0);
  assert.equal(Number(contexts.rows[0].count), 0);
});

test("admin mutations without the same-origin CSRF contract are rejected", async () => {
  const forged = await fetch(`${baseUrl}/api/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: adminCookie,
      Origin: "https://attacker.example",
      "X-CSRF-Token": "same-origin",
    },
    body: JSON.stringify({ username: "csrf_user", password: "password123", is_admin: false }),
  });
  assert.equal(forged.status, 403);
  assert.equal((await forged.json()).error.code, "csrf_failed");
});
