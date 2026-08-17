// Public HTTP + model-contract tests for model-backed recommendations served
// through Next.js (issue #7). A real Next.js dev server and a real Postgres
// test database run the Application Backend; a mock Private Model Service
// asserts the exact inference contract (eligible candidate set in artifact
// id space, personalization inputs, top-K) and returns deterministic scores.
//
// Covers: ranking, validation, personalization, profile recommendations
// (session-gated), persistence of request/result analytics, the bounded
// timeout + retry policy, and the clearly identified Recommendation Fallback.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import pg from "pg";

const { Client } = pg;
const databaseName = "web_rs_thaiarts_recommendations_test";
const adminUrl =
  process.env.TEST_POSTGRES_ADMIN_URL ??
  "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${databaseName}`;

const port = 3103;
const baseUrl = `http://127.0.0.1:${port}`;
const secret = "recommendations-test-secret";

const artifactItemId = 168393376;
const secondItemId = 900002;
const thirdItemId = 900003;
const contextId = stableId("context", "งานบวช");
const keywordChadaId = 61;
const keywordWomenId = 62;

let mediaRoot;
let server;
let modelServer;
let modelServiceUrl;
let inferenceAttempts = [];
let failRemaining = 0;
let hangNext = false;
let contextInternalId = 51;

function stableId(namespace, value) {
  const digest = createHash("sha256").update(`${namespace}::${value}`, "utf8").digest("hex");
  return Number.parseInt(digest.slice(0, 7), 16);
}

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
  throw new Error("Timed out waiting for the recommendations test server");
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
  // On Windows ``npm`` is a .cmd shim whose tree can survive taskkill;
  // sweep the port so the next run cannot talk to a stale server.
  await killProcessesOnPort(port);
}

async function killProcessesOnPort(targetPort) {
  if (process.platform !== "win32") return;
  try {
    const script = `Get-NetTCPConnection -LocalPort ${targetPort} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }`;
    await new Promise((resolve) => {
      const killer = spawn("powershell", ["-NoProfile", "-Command", script], {
        stdio: "ignore",
      });
      killer.on("close", resolve);
    });
  } catch {
    // Port sweep is best-effort; a busy port fails loudly at bind time.
  }
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
       VALUES (61, 'ชฎา', 72), (62, 'ผู้หญิง', 71)`,
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
          'โขน', 'การแสดง', 10, 30, '', '', '', TRUE),
         (43, 900003, 'ลิเกจากโมเดล', 'ตัวเลือกที่โมเดลจัดไว้ก่อน',
          'ลิเก', 'การแสดง', 8, 25, '', '', '', TRUE)`,
      [artifactItemId],
    );
    await client.query(
      `INSERT INTO item_contexts (id, item_id, context_id, validity_status)
       VALUES (81, 41, 51, 'valid'), (82, 42, 51, 'valid'), (83, 43, 51, 'valid')`,
    );
    await client.query(
      `INSERT INTO item_keywords (id, item_id, keyword_id, source)
       VALUES (91, 41, 61, 'fixture'), (92, 42, 61, 'fixture'), (93, 43, 62, 'fixture')`,
    );
  } finally {
    await client.end();
  }
}

function startModelServer() {
  inferenceAttempts = [];
  failRemaining = 0;
  hangNext = false;
  modelServer = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    assert.equal(request.url, "/internal/v1/inference");
    assert.equal(request.headers.authorization, `Bearer ${secret}`);
    inferenceAttempts.push(body);

    if (hangNext) {
      return; // never respond — the caller's bounded timeout aborts both attempts
    }
    if (failRemaining > 0) {
      failRemaining -= 1;
      response.writeHead(503, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { code: "transient" } }));
      return;
    }

    const eligible = body.eligible_candidate_ids;
    const ranked = eligible.slice(0, body.top_k).map((artifact_item_id, index) => ({
      artifact_item_id,
      scores: {
        cbf: Number((0.4 + index * 0.01).toFixed(4)),
        cf: 0.8,
        final: Number((0.6 + index * 0.01).toFixed(4)),
      },
    }));
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ranked_candidates: ranked }));
  });
  return new Promise((resolve) => {
    modelServer.listen(0, "127.0.0.1", () => {
      const address = modelServer.address();
      modelServiceUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
}

async function queryRows(sql, params = []) {
  const client = new Client({ connectionString: databaseUrl.toString() });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows;
  } finally {
    await client.end();
  }
}

function postRecommendation(body) {
  return fetch(`${baseUrl}/api/recommendations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

function signup(username) {
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
      email: `${username}@example.test`,
      password: "password-1234",
      display_name: username,
    }),
    cache: "no-store",
  });
}

function cookieValue(setCookie) {
  return setCookie?.split(";", 1)[0] ?? "";
}

before(async () => {
  await killProcessesOnPort(port);
  await resetTestDatabase({ create: true });
  mediaRoot = await mkdtemp(join(tmpdir(), "thaiarts-recommendations-"));
  await mkdir(join(mediaRoot, "items"), { recursive: true });
  await writeFile(join(mediaRoot, "items", "catalog.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  await startModelServer();

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
      PRIVATE_MODEL_SERVICE_URL: modelServiceUrl,
      MODEL_SERVICE_SHARED_SECRET: secret,
      MODEL_SERVICE_TIMEOUT_MS: "400",
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

test("anonymous context recommendations are served by Next.js with model-backed ranking", async () => {
  inferenceAttempts.length = 0;
  const response = await postRecommendation({
    context_id: contextId,
    keyword_ids: [keywordChadaId],
    top_k: 3,
    user_key: "anon:test-anon",
  });
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(body.selected_context.id, contextId);
  assert.equal(body.selected_context.name, "งานบวช");
  assert.equal(body.candidate_count, 3);
  assert.equal(body.top_k, 3);
  assert.equal(body.method, "Hybrid-WeightedSum");
  assert.equal(body.embedding_backend, "e5");
  assert.ok(body.request_id.length > 0, "request_id must be present");
  assert.deepEqual(body.selected_keywords, [
    { id: keywordChadaId, name: "ชฎา", taxonomy_path: "เครื่องแต่งกาย > ศีรษะ" },
  ]);
  assert.equal(body.metadata.fallback, false);
  assert.equal(body.metadata.model_service, "private-v1");

  // Keyword-matched items come first in the eligible set; the model's order
  // is preserved verbatim and scores.final is mapped to the public hybrid.
  assert.deepEqual(
    body.results.map((result) => result.item.id),
    [secondItemId, artifactItemId, thirdItemId],
  );
  assert.deepEqual(body.results[0].scores, { cbf: 0.4, cf: 0.8, hybrid: 0.6 });
  assert.deepEqual(body.results[1].scores, { cbf: 0.41, cf: 0.8, hybrid: 0.61 });
  assert.equal(body.results[0].rank, 1);
  assert.equal(body.results[0].is_context_valid, true);
  assert.deepEqual(body.results[0].matched_keywords, ["ชฎา"]);
  assert.deepEqual(body.results[1].matched_keywords, ["ชฎา"]);
  assert.deepEqual(body.results[2].matched_keywords, []);
  assert.ok(body.results[0].explanation.includes("งานบวช"), body.results[0].explanation);
  assert.ok(body.results[0].match_percent >= 82 && body.results[0].match_percent <= 98);
  assert.ok(["เหมาะมาก", "เหมาะสม", "เหมาะใช้ได้"].includes(body.results[0].suitability_label));
  assert.deepEqual(body.results[0].item.user_state, { liked: false, saved: false, rating: 0 });

  // Model-contract: the inference request carries artifact ids only, keyword
  // names (not ids), and never PostgreSQL ids (41/42/43 are internal).
  assert.equal(inferenceAttempts.length, 1);
  const inference = inferenceAttempts[0];
  assert.deepEqual(inference.eligible_candidate_ids, [secondItemId, artifactItemId, thirdItemId]);
  assert.equal(inference.personalization.context_name, "งานบวช");
  assert.deepEqual(inference.personalization.keyword_names, ["ชฎา"]);
  assert.equal(inference.top_k, 3);
  assert.deepEqual(inference.personalization.positive_history, []);
  assert.deepEqual(inference.personalization.negative_ratings, []);
});

test("keyword ids in the artifact stable-hash space also resolve by name", async () => {
  const artifactKeywordId = stableId("keyword", "ชฎา");
  const response = await postRecommendation({
    context_id: contextId,
    keyword_ids: [artifactKeywordId],
    top_k: 2,
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.selected_keywords.map((keyword) => keyword.name), ["ชฎา"]);
  assert.equal(body.results.length, 2);
});

test("validation and unknown-context errors preserve the public contract", async () => {
  const badTopK = await postRecommendation({ context_id: contextId, top_k: 0 });
  assert.equal(badTopK.status, 422);
  assert.equal((await badTopK.json()).error.code, "validation_error");

  const badContext = await postRecommendation({ context_id: 999999999, top_k: 5 });
  assert.equal(badContext.status, 404);
  const errorBody = await badContext.json();
  assert.equal(errorBody.error.code, "context_not_found");
  assert.equal(errorBody.error.context_id, 999999999);

  const badKeyword = await postRecommendation({
    context_id: contextId,
    keyword_ids: [-1],
    top_k: 5,
  });
  assert.equal(badKeyword.status, 422);

  const badJson = await fetch(`${baseUrl}/api/recommendations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not json",
  });
  assert.equal(badJson.status, 400);
  assert.equal((await badJson.json()).error.code, "invalid_json");
});

test("live personalization feeds the inference request and the response user_state", async () => {
  const client = new Client({ connectionString: databaseUrl.toString() });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO likes (user_key, item_id) VALUES ('anon:test-personal', 41)`,
    );
    await client.query(
      `INSERT INTO ratings (user_key, item_id, rating) VALUES
         ('anon:test-personal', 42, 5), ('anon:test-personal', 43, 2)`,
    );
  } finally {
    await client.end();
  }

  inferenceAttempts.length = 0;
  const response = await postRecommendation({
    context_id: contextId,
    keyword_ids: [],
    top_k: 3,
    user_key: "anon:test-personal",
  });
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(inferenceAttempts.length, 1);
  const inference = inferenceAttempts[0];
  assert.deepEqual(inference.personalization.positive_history, [
    { artifact_item_id: secondItemId, rating_weight: 1.0 },
    { artifact_item_id: artifactItemId, rating_weight: 1.0 },
  ]);
  assert.deepEqual(inference.personalization.negative_ratings, [
    { artifact_item_id: thirdItemId, rating: 2 },
  ]);

  const byId = new Map(body.results.map((result) => [result.item.id, result.item]));
  assert.deepEqual(byId.get(artifactItemId).user_state, { liked: true, saved: false, rating: 0 });
  assert.deepEqual(byId.get(secondItemId).user_state, { liked: false, saved: false, rating: 5 });
  assert.deepEqual(byId.get(thirdItemId).user_state, { liked: false, saved: false, rating: 2 });
  assert.equal(body.metadata.user_state_resolved, true);
  assert.equal(body.metadata.negative_ratings_applied, true);
});

test("request/result analytics are persisted and the response request_id is the row id", async () => {
  const response = await postRecommendation({
    context_id: contextId,
    keyword_ids: [keywordChadaId],
    top_k: 3,
    user_key: "anon:test-analytics",
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.metadata.persisted_to_db, true);

  const requestRows = await queryRows(
    `SELECT id, candidate_count, top_k, method, metadata_json, selected_context_id
     FROM recommendation_requests WHERE id = $1`,
    [Number(body.request_id)],
  );
  assert.equal(requestRows.length, 1);
  assert.equal(requestRows[0].candidate_count, 3);
  assert.equal(requestRows[0].top_k, 3);
  assert.equal(requestRows[0].method, "Hybrid-WeightedSum");
  assert.equal(Number(requestRows[0].selected_context_id), contextInternalId);
  const metadata = JSON.parse(requestRows[0].metadata_json);
  assert.equal(metadata.fallback, false);
  assert.equal(metadata.user_key, "anon:test-analytics");

  const resultRows = await queryRows(
    `SELECT rank, cbf_score, cf_score, hybrid_score, matched_keywords_json
     FROM recommendation_results WHERE request_id = $1 ORDER BY rank ASC`,
    [Number(body.request_id)],
  );
  assert.deepEqual(
    resultRows.map((row) => row.rank),
    [1, 2, 3],
  );
  assert.equal(Number(resultRows[0].hybrid_score), 0.6);
  assert.deepEqual(JSON.parse(resultRows[0].matched_keywords_json), ["ชฎา"]);

  const keywordRows = await queryRows(
    `SELECT keyword_id FROM recommendation_request_selected_keywords
     WHERE request_id = $1`,
    [Number(body.request_id)],
  );
  assert.deepEqual(keywordRows.map((row) => Number(row.keyword_id)), [keywordChadaId]);
});

test("the model service retries a transient 5xx once, then serves the ranking", async () => {
  inferenceAttempts.length = 0;
  failRemaining = 1;
  const response = await postRecommendation({
    context_id: contextId,
    keyword_ids: [],
    top_k: 3,
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(inferenceAttempts.length, 2, "the failed attempt must be retried once");
  assert.equal(body.metadata.fallback, false);
  assert.equal(body.results.length, 3);
});

test("a hanging model service is bounded by the timeout and returns the identified fallback", async () => {
  inferenceAttempts.length = 0;
  hangNext = true;
  const startedAt = Date.now();
  const response = await postRecommendation({
    context_id: contextId,
    keyword_ids: [],
    top_k: 3,
    user_key: "anon:test-timeout",
  });
  const elapsedMs = Date.now() - startedAt;
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(elapsedMs < 2_000, `timeout fallback took ${elapsedMs}ms — the bound was not applied`);
  assert.equal(body.metadata.fallback, true);
  assert.equal(body.metadata.fallback_reason, "model_service_unavailable");
  assert.ok(body.metadata.fallback_note.length > 0);
  assert.equal(body.results.length, 3);
  assert.ok(body.results.every((result) => result.scores.hybrid === 0));
  assert.ok(body.results.every((result) => result.explanation.includes("โมเดลไม่พร้อมใช้งาน")));
  assert.deepEqual(body.results.map((result) => result.rank), [1, 2, 3]);

  const requestRows = await queryRows(
    `SELECT metadata_json FROM recommendation_requests WHERE id = $1`,
    [Number(body.request_id)],
  );
  const metadata = JSON.parse(requestRows[0].metadata_json);
  assert.equal(metadata.fallback, true);
  assert.equal(metadata.fallback_reason, "model_service_unavailable");

  hangNext = false; // restore the mock for subsequent tests
});

test("profile recommendations require a session and personalize from member history", async () => {
  const anonymous = await fetch(`${baseUrl}/api/recommendations/profile`);
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error.code, "unauthorized");

  const signupResponse = await signup("recsys_member");
  assert.equal(signupResponse.status, 200);
  const cookie = cookieValue(signupResponse.headers.get("set-cookie"));

  const emptyProfile = await fetch(`${baseUrl}/api/recommendations/profile?top_k=5`, {
    headers: { cookie },
    cache: "no-store",
  });
  assert.equal(emptyProfile.status, 200);
  const emptyBody = await emptyProfile.json();
  assert.equal(emptyBody.history_count, 0);
  assert.equal(emptyBody.method, "Profile-ItemKNN");
  assert.deepEqual(emptyBody.results, []);

  // Like the khon item under the session member's user:<id> key.
  const like = await fetch(`${baseUrl}/api/actions/like`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": "same-origin", Origin: baseUrl, "Sec-Fetch-Site": "same-origin", cookie },
    body: JSON.stringify({ user_key: "anon:ignored", item_id: artifactItemId }),
    cache: "no-store",
  });
  assert.equal(like.status, 200);

  inferenceAttempts.length = 0;
  const profile = await fetch(`${baseUrl}/api/recommendations/profile?top_k=5`, {
    headers: { cookie },
    cache: "no-store",
  });
  assert.equal(profile.status, 200);
  const profileBody = await profile.json();
  assert.equal(profileBody.history_count, 1);
  assert.equal(profileBody.metadata.fallback, false);

  // Model contract: history is excluded from the eligible set and carried
  // as positive_history in artifact id space.
  assert.equal(inferenceAttempts.length, 1);
  assert.deepEqual(
    [...inferenceAttempts[0].eligible_candidate_ids].sort((left, right) => left - right),
    [secondItemId, thirdItemId],
  );
  assert.deepEqual(inferenceAttempts[0].personalization.positive_history, [
    { artifact_item_id: artifactItemId, rating_weight: 1.0 },
  ]);
  assert.equal(inferenceAttempts[0].personalization.context_name, "");

  // 0.75 * cf + 0.25 * content affinity: the khon-lookalike shares keyword,
  // context and category with history; the likay one only the context.
  assert.equal(profileBody.results.length, 2);
  assert.equal(profileBody.results[0].item.id, secondItemId);
  const khon = profileBody.results.find((result) => result.item.id === secondItemId);
  const likay = profileBody.results.find((result) => result.item.id === thirdItemId);
  assert.ok(khon.scores.hybrid > likay.scores.hybrid, "affinity must break the cf tie");
  assert.equal(khon.scores.cf, 0.8);
  assert.equal(khon.scores.cbf, 1); // full keyword+context+category overlap
  assert.ok(khon.explanation.includes("ในอดีตคุณเคยชอบ"), khon.explanation);
});

test("profile recommendations fall back to content affinity when the model errors", async () => {
  const signupResponse = await signup("recsys_member2");
  const cookie = cookieValue(signupResponse.headers.get("set-cookie"));
  const like = await fetch(`${baseUrl}/api/actions/like`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": "same-origin", Origin: baseUrl, "Sec-Fetch-Site": "same-origin", cookie },
    body: JSON.stringify({ user_key: "anon:ignored", item_id: artifactItemId }),
    cache: "no-store",
  });
  assert.equal(like.status, 200);

  failRemaining = 3; // both attempts fail — the content-affinity fallback must serve
  const profile = await fetch(`${baseUrl}/api/recommendations/profile?top_k=5`, {
    headers: { cookie },
    cache: "no-store",
  });
  assert.equal(profile.status, 200);
  const body = await profile.json();
  assert.equal(body.metadata.fallback, true);
  assert.equal(body.metadata.fallback_reason, "model_service_unavailable");
  assert.equal(body.results.length, 2);
  assert.equal(body.results[0].item.id, secondItemId);
  assert.equal(body.results[0].scores.cf, 0);
  assert.ok(body.results[0].explanation.includes("โมเดลไม่พร้อมใช้งาน"));
});
