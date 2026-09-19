import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
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
let modelServer;
let modelServiceUrl;

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
          image_url, video_url, is_active, published_at)
       VALUES
         (41, $1, 'โขนทดสอบ', 'เรื่องรามเกียรติ์สำหรับทดสอบหน้ารายละเอียด',
          'โขน', 'การแสดง', 12, 45, 'ติดต่อสอบถาม',
          '/uploads/items/catalog.jpg', '', TRUE, CURRENT_TIMESTAMP),
         (42, 900002, 'โขนใกล้เคียง', 'การแสดงที่มีข้อมูลใกล้เคียงกัน',
          'โขน', 'การแสดง', 10, 30, '', '', '', TRUE, CURRENT_TIMESTAMP),
         (43, 900003, 'ลิเกจากโมเดล', 'ตัวเลือกที่โมเดลจัดไว้ก่อน',
          'ลิเก', 'การแสดง', 8, 25, '', '', '', TRUE, CURRENT_TIMESTAMP),
         (44, 900004, 'ผืนไท', 'ผืนไท เป็นการแสดงที่มีแนวคิดมาจากศิลปะการแสดงของภูมิภาคต่าง ๆ ของไทย สู่การสร้างสรรค์ผลงานบนพื้นฐานความงดงามของนาฏศิลป์ไทย และศิลปะการแสดงพื้นบ้าน ผสมผสานการออกแบบการเคลื่อนไหวร่างกาย และการใช้พื้นที่เวทีที่มีความหลากหลาย อุปกรณ์สําคัญในการแสดงคือ ผืนผ้าสื่อถึงสัญลักษณ์ของชาติ และพระมหากษัตริย์ไทย ปกแผ่ไพศาล ให้ความสุขสงบร่มเย็นแก่อาณาประชาราษฎร์ทุกเชอชาติที่รวมกัน เป็นเอกลักษณ์ ก่อให้เกิดมรดกศิลปวัฒนธรรมอันวิจิตร ภายใต้ผืนไตรรงค์ธงไทยที่สง่างาม',
          'การแสดงนาฏศิลป์สร้างสรรค์', 'การแสดงสร้างสรรค์', 16, 20, '', '', '', TRUE, NULL)`,
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

async function startModelServer() {
  modelServer = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    assert.equal(request.url, "/internal/v1/similarity");
    assert.equal(request.headers.authorization, "Bearer catalogue-test-secret");
    assert.equal(body.reference_artifact_item_id, artifactItemId);
    assert.deepEqual(body.candidate_artifact_item_ids, [900002, 900003]);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      ranked_candidates: [
        { artifact_item_id: 900003, score: 0.91 },
        { artifact_item_id: 900002, score: 0.72 },
      ],
    }));
  });
  await new Promise((resolve) => modelServer.listen(0, "127.0.0.1", resolve));
  const address = modelServer.address();
  modelServiceUrl = `http://127.0.0.1:${address.port}`;
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
  await startModelServer();

  const migrated = await runNpm(["run", "migration:run"], {
    DATABASE_URL: databaseUrl.toString(),
  });
  await seedCatalogue();
  const seeded = await runNpm(["run", "seed"], {
    DATABASE_URL: databaseUrl.toString(),
  });
  assert.equal(seeded.code, 0, `${seeded.stdout}\n${seeded.stderr}`);

  server = spawn("npm", ["run", "dev", "--", "--port", String(port)], {
    cwd: process.cwd(),
    detached: process.platform !== "win32",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl.toString(),
      MEDIA_STORE_ROOT: mediaRoot,
      PRIVATE_MODEL_SERVICE_URL: modelServiceUrl,
      MODEL_SERVICE_SHARED_SECRET: "catalogue-test-secret",
    },
    stdio: "ignore",
  });
  await waitForServer();
});

after(async () => {
  await stopServer();
  if (modelServer) await new Promise((resolve) => modelServer.close(resolve));
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
  assert.equal(detail.name_en, null);
  assert.equal(detail.suitability_label, "เหมาะใช้ได้");
  assert.equal(detail.suitability_label_en, "Suitable");
  assert.equal(detail.contexts[0].id, contextId);
  assert.deepEqual(detail.keywords[0], {
    id: 61,
    name: "ชฎา",
    name_en: null,
    taxonomy_path: "เครื่องแต่งกาย > ศีรษะ",
  });

  const contexts = await fetch(`${baseUrl}/api/contexts`).then((response) => response.json());
  assert.deepEqual(contexts.contexts, [
    {
      id: contextId,
      name: "งานบวช",
      name_en: null,
      group: "งานมงคล",
      description: "บริบททดสอบ",
      description_en: null,
      active_item_count: 2,
    },
  ]);

  const keywords = await fetch(
    `${baseUrl}/api/keywords?context_id=${contextId}&search=ชฎา`,
  ).then((response) => response.json());
  assert.deepEqual(keywords.keywords, [
    { id: 61, name: "ชฎา", name_en: null, taxonomy_path: "เครื่องแต่งกาย > ศีรษะ" },
  ]);

  const ranked = await fetch(`${baseUrl}/api/items?context=${contextId}`).then(
    (response) => response.json(),
  );
  assert.equal(ranked.total, 2);
  assert.ok(ranked.items.every((item) => item.contexts.some((context) => context.id === contextId)));

  const similar = await fetch(`${baseUrl}/api/items/${artifactItemId}/similar?limit=4`).then(
    (response) => response.json(),
  );
  assert.deepEqual(similar.items.map((item) => item.id), [900003, 900002]);
});

test("media rejects a symlink that escapes its selected public directory", async (t) => {
  try {
    await symlink(
      join(mediaRoot, "avatars", "member.png"),
      join(mediaRoot, "items", "avatar-link.png"),
      "file",
    );
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) {
      t.skip(`symlink creation is unavailable: ${error.code}`);
      return;
    }
    throw error;
  }

  const response = await fetch(`${baseUrl}/api/uploads/items/avatar-link.png`);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "unsafe_media_path");
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

test("PostgreSQL rejects mutation of an established Artifact Item Identifier", async () => {
  const client = new Client({ connectionString: databaseUrl.toString() });
  await client.connect();
  try {
    await assert.rejects(
      client.query("UPDATE items SET artifact_item_id = 777777777 WHERE id = 41"),
      (error) => error?.code === "23514" && /immutable/i.test(error.message),
    );
  } finally {
    await client.end();
  }

  const response = await fetch(`${baseUrl}/api/items/${artifactItemId}`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).id, artifactItemId);
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

test("bilingual catalogue exposes English metadata, suitability labels, and bilingual search", async () => {
  // 1. getItem returns name_en, description_en, category_group_en, performance_type_en for seeded items (e.g. ผืนไท)
  const itemResponse = await fetch(`${baseUrl}/api/items/900004`);
  assert.equal(itemResponse.status, 200);
  const item = await itemResponse.json();
  assert.equal(item.id, 900004);
  assert.equal(item.name, "ผืนไท");
  assert.equal(item.name_en, "Phuen Thai (Thai Cultural Canvas)");
  assert.ok(item.description_en.includes("Phuen Thai is the performance"));
  assert.equal(item.category_group_en, "Creative Performing Arts");
  assert.equal(item.performance_type_en, "Creative Contemporary Dance");

  // 3. Item suitability_label_en is populated correctly
  assert.ok(typeof item.match_percent === "number");
  if (item.match_percent >= 92) {
    assert.equal(item.suitability_label_en, "Highly Recommended");
    assert.equal(item.suitability_label, "เหมาะมาก");
  } else if (item.match_percent >= 87) {
    assert.equal(item.suitability_label_en, "Recommended");
    assert.equal(item.suitability_label, "เหมาะสม");
  } else {
    assert.equal(item.suitability_label_en, "Suitable");
    assert.equal(item.suitability_label, "เหมาะใช้ได้");
  }

  // 2. listItems with English search query (e.g. search=Phuen) returns matching item
  const enSearch = await fetch(`${baseUrl}/api/items?search=Phuen&limit=10`).then((res) => res.json());
  assert.ok(enSearch.total >= 1);
  assert.equal(enSearch.items[0].id, 900004);
  assert.equal(enSearch.items[0].name_en, "Phuen Thai (Thai Cultural Canvas)");

  // Bilingual search checks category_group_en (e.g. search=Creative)
  const catSearch = await fetch(`${baseUrl}/api/items?search=Creative&limit=10`).then((res) => res.json());
  assert.ok(catSearch.total >= 1);
  assert.ok(catSearch.items.some((it) => it.id === 900004));

  // Bilingual search checks description_en (e.g. search=Canvas)
  const descSearch = await fetch(`${baseUrl}/api/items?search=Canvas&limit=10`).then((res) => res.json());
  assert.ok(descSearch.total >= 1);
  assert.ok(descSearch.items.some((it) => it.id === 900004));

  // Thai search still works alongside bilingual search
  const thSearch = await fetch(`${baseUrl}/api/items?search=ผืนไท&limit=10`).then((res) => res.json());
  assert.equal(thSearch.total, 1);
  assert.equal(thSearch.items[0].id, 900004);
});
