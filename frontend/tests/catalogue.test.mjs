import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import pg from "pg";

const { Client } = pg;
const databaseName = "web_rs_thaiarts_catalogue_test";
const adminUrl =
  process.env.TEST_POSTGRES_ADMIN_URL ??
  "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${databaseName}`;

const port = 3101;
const baseUrl = `http://127.0.0.1:${port}`;
const artifactItemId = 168393376;
const contextId = 142863314;
const imageBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

let mediaRoot;
let server;

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
  throw new Error("Timed out waiting for the catalogue test server");
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
       VALUES (51, 'งานบวช', 'งานมงคล', 'บริบททดสอบ')`,
    );
    await client.query(
      `INSERT INTO taxonomy_nodes (id, name, level, parent_id)
       VALUES (71, 'เครื่องแต่งกาย', 1, NULL), (72, 'ศีรษะ', 2, 71)`,
    );
    await client.query(
      `INSERT INTO keywords (id, name, taxonomy_node_id)
       VALUES (61, 'ชฎา', 72)`,
    );
    await client.query(
      `INSERT INTO items
         (id, artifact_item_id, name, description, category_group,
          performance_type, performers_count, duration_minutes, price_text,
          image_url, video_url, is_active)
       VALUES
         (41, $1, 'โขนทดสอบ', 'เรื่องรามเกียรติ์สำหรับทดสอบหน้ารายละเอียด',
          'โขน', 'การแสดง', 12, 45, 'ติดต่อสอบถาม',
          '/uploads/items/catalog.jpg', '', TRUE),
         (42, 900002, 'โขนใกล้เคียง', 'การแสดงที่มีข้อมูลใกล้เคียงกัน',
          'โขน', 'การแสดง', 10, 30, '', '', '', TRUE)`,
      [artifactItemId],
    );
    await client.query(
      `INSERT INTO item_contexts (id, item_id, context_id, validity_status)
       VALUES (81, 41, 51, 'valid'), (82, 42, 51, 'valid')`,
    );
    await client.query(
      `INSERT INTO item_keywords (id, item_id, keyword_id, source)
       VALUES (91, 41, 61, 'fixture'), (92, 42, 61, 'fixture')`,
    );
  } finally {
    await client.end();
  }
}

before(async () => {
  await resetTestDatabase({ create: true });
  mediaRoot = await mkdtemp(join(tmpdir(), "thaiarts-media-"));
  await mkdir(join(mediaRoot, "items"), { recursive: true });
  await mkdir(join(mediaRoot, "avatars"), { recursive: true });
  await mkdir(join(mediaRoot, "private"), { recursive: true });
  await writeFile(join(mediaRoot, "items", "catalog.jpg"), imageBytes);
  await writeFile(join(mediaRoot, "avatars", "member.png"), Buffer.from("avatar"));
  await writeFile(join(mediaRoot, "private", "secret.txt"), "not public");

  const migrated = await runNpm(["run", "migration:run"], {
    DATABASE_URL: databaseUrl.toString(),
  });
  assert.equal(migrated.code, 0, `${migrated.stdout}\n${migrated.stderr}`);
  const seeded = await runNpm(["run", "seed"], {
    DATABASE_URL: databaseUrl.toString(),
  });
  assert.equal(seeded.code, 0, `${seeded.stdout}\n${seeded.stderr}`);
  await seedCatalogue();

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
    },
    stdio: "ignore",
  });
  await waitForServer();
});

after(async () => {
  await stopServer();
  if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
  await resetTestDatabase({ create: false });
});

test("anonymous visitors browse catalogue, discovery facets, and item detail through Next.js", async () => {
  const listResponse = await fetch(`${baseUrl}/api/items?search=โขน&limit=20`);
  assert.equal(listResponse.status, 200);
  const list = await listResponse.json();
  assert.equal(list.total, 2);
  assert.equal(list.items[0].id, artifactItemId);
  assert.equal(list.items[0].image_url, "/uploads/items/catalog.jpg");
  assert.deepEqual(list.items[0].user_state, { liked: false, saved: false, rating: 0 });

  const detailResponse = await fetch(`${baseUrl}/api/items/${artifactItemId}`);
  assert.equal(detailResponse.status, 200);
  const detail = await detailResponse.json();
  assert.equal(detail.name, "โขนทดสอบ");
  assert.equal(detail.contexts[0].id, contextId);
  assert.deepEqual(detail.keywords[0], {
    id: 61,
    name: "ชฎา",
    taxonomy_path: "เครื่องแต่งกาย > ศีรษะ",
  });

  const contexts = await fetch(`${baseUrl}/api/contexts`).then((response) => response.json());
  assert.deepEqual(contexts.contexts, [
    {
      id: contextId,
      name: "งานบวช",
      group: "งานมงคล",
      description: "บริบททดสอบ",
      active_item_count: 2,
    },
  ]);

  const keywords = await fetch(
    `${baseUrl}/api/keywords?context_id=${contextId}&search=ชฎา`,
  ).then((response) => response.json());
  assert.deepEqual(keywords.keywords, [
    { id: 61, name: "ชฎา", taxonomy_path: "เครื่องแต่งกาย > ศีรษะ" },
  ]);

  const ranked = await fetch(`${baseUrl}/api/items?context=${contextId}`).then(
    (response) => response.json(),
  );
  assert.equal(ranked.total, 2);
  assert.ok(ranked.items.every((item) => item.contexts.some((context) => context.id === contextId)));

  const similar = await fetch(`${baseUrl}/api/items/${artifactItemId}/similar?limit=4`).then(
    (response) => response.json(),
  );
  assert.deepEqual(similar.items.map((item) => item.id), [900002]);
});

test("unknown catalogue resources preserve stable public 404 behavior", async () => {
  const itemResponse = await fetch(`${baseUrl}/api/items/999999999`);
  assert.equal(itemResponse.status, 404);
  assert.equal((await itemResponse.json()).error.code, "item_not_found");

  const contextResponse = await fetch(`${baseUrl}/api/items?context=999999999`);
  assert.equal(contextResponse.status, 404);
  assert.equal((await contextResponse.json()).error.code, "context_not_found");
});

test("renaming a database item does not change its immutable Artifact Item Identifier", async () => {
  const client = new Client({ connectionString: databaseUrl.toString() });
  await client.connect();
  try {
    await client.query("UPDATE items SET name = 'โขนเปลี่ยนชื่อ' WHERE id = 41");
  } finally {
    await client.end();
  }

  const response = await fetch(`${baseUrl}/api/items/${artifactItemId}`);
  assert.equal(response.status, 200);
  const item = await response.json();
  assert.equal(item.id, artifactItemId);
  assert.equal(item.name, "โขนเปลี่ยนชื่อ");
});

test("catalogue and avatar media are served while unsafe paths and arbitrary files are rejected", async () => {
  const imageResponse = await fetch(`${baseUrl}/api/uploads/items/catalog.jpg`);
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers.get("content-type"), "image/jpeg");
  assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), imageBytes);

  const avatarResponse = await fetch(`${baseUrl}/api/uploads/avatars/member.png`);
  assert.equal(avatarResponse.status, 200);

  for (const path of [
    "items",
    "missing.jpg",
    "private/secret.txt",
    "items/%2e%2e%2fprivate%2fsecret.txt",
    "items/%252e%252e%252fprivate%252fsecret.txt",
  ]) {
    const response = await fetch(`${baseUrl}/api/uploads/${path}`);
    assert.ok(
      response.status === 400 || response.status === 404,
      `${path} unexpectedly returned ${response.status}`,
    );
    assert.notEqual(await response.text(), "not public");
  }
});
