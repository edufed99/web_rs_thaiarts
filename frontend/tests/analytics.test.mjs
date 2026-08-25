// Public-boundary tests for issue #9: member dashboard/history and
// administrator metrics/dashboard/analytics/export journeys served by the
// Next.js Application Backend.
//
// Coverage: role enforcement (401 anonymous / 403 non-admin / 200 admin),
// empty states on a fresh database, populated payloads computed from
// persisted actions and recommendation outcomes, the legacy-stats and
// engagement compatibility endpoints, and the Excel export response
// behavior.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import ExcelJS from "exceljs";
import pg from "pg";

const { Client } = pg;
const databaseName = "web_rs_thaiarts_analytics_test";
const adminUrl =
  process.env.TEST_POSTGRES_ADMIN_URL ??
  "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${databaseName}`;
const port = 3104;
const baseUrl = `http://127.0.0.1:${port}`;

const CONTEXT_IDS = [51, 52];
const KEYWORD_IDS = [61, 62, 63];
const ITEM_IDS = [41, 42, 43];
const ARTIFACT_IDS = [900101, 900102, 900103];

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
  throw new Error("Timed out waiting for the analytics test server");
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

async function signup(username, password = "correct horse battery staple") {
  return fetch(`${baseUrl}/api/auth/signup`, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify({ username, email: `${username}@example.test`, password, display_name: username }),
  });
}

/** Seed the catalogue fixture shared by all analytics sections. */
async function seedCatalogue(client) {
  await client.query(
    `INSERT INTO contexts (id, name, group_name, description)
     VALUES (51, 'งานบวช', 'งานมงคล', 'บริบททดสอบ'), (52, 'งานศพ', 'พิธีกรรม', 'บริบททดสอบ')`,
  );
  await client.query(
    `INSERT INTO keywords (id, name, taxonomy_node_id)
     VALUES (61, 'ชฎา', NULL), (62, 'ลิเก', NULL), (63, 'โขน', NULL)`,
  );
  await client.query(
    `INSERT INTO items
       (id, artifact_item_id, name, description, category_group,
        performance_type, performers_count, duration_minutes, price_text,
        image_url, video_url, is_active)
     VALUES
       (41, $1, 'ระบำหลักทดสอบ', 'ระบำสำหรับทดสอบระบบ', 'ระบำ', 'การแสดง', 8, 30, '', '', '', TRUE),
       (42, $2, 'ลิเกรองทดสอบ', 'ลิเกสำหรับทดสอบระบบ', 'ลิเก', 'การแสดง', 6, 20, '', '', '', TRUE),
       (43, $3, 'โขนรองทดสอบ', 'โขนสำหรับทดสอบระบบ', 'โขน', 'การแสดง', 10, 40, '', '', '', TRUE)`,
    ARTIFACT_IDS,
  );
  await client.query(
    `INSERT INTO item_contexts (id, item_id, context_id, validity_status)
     VALUES (81, 41, 51, 'valid'), (82, 42, 51, 'valid'), (83, 43, 52, 'valid')`,
  );
  await client.query(
    `INSERT INTO item_keywords (id, item_id, keyword_id, source)
     VALUES (91, 41, 61, 'fixture'), (92, 42, 62, 'fixture'), (93, 43, 63, 'fixture')`,
  );
}

let adminCookie = "";
let memberCookie = "";
let adminId = 0;

before(async () => {
  await resetDatabase(true);
  mediaStoreRoot = await mkdtemp(join(tmpdir(), "thai-arts-analytics-"));
  const migrated = await runNpm(["run", "migration:run"], {
    DATABASE_URL: databaseUrl.toString(),
  });
  assert.equal(migrated.code, 0, `${migrated.stdout}\n${migrated.stderr}`);
  const seeded = await runNpm(["run", "seed"], {
    DATABASE_URL: databaseUrl.toString(),
  });
  assert.equal(seeded.code, 0, `${seeded.stdout}\n${seeded.stderr}`);

  const client = new Client({ connectionString: databaseUrl.toString() });
  await client.connect();
  await seedCatalogue(client);
  await client.end();

  server = spawn("npm", ["run", "dev", "--", "--port", String(port)], {
    cwd: process.cwd(),
    detached: process.platform !== "win32",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl.toString(),
      NODE_ENV: "test",
      MEDIA_STORE_ROOT: mediaStoreRoot,
      RECSYS_HYBRID_ALPHA: "0.6",
      RECSYS_ITEMKNN_K: "12",
    },
    stdio: "ignore",
  });
  await waitForServer();

  const adminSignup = await signup("admin_analytics");
  const adminBody = await adminSignup.json().catch(() => null);
  assert.equal(adminSignup.status, 200, JSON.stringify(adminBody));
  adminCookie = cookieValue(adminSignup.headers.get("set-cookie"));
  adminId = adminBody.user.id;
  const memberSignup = await signup("member_analytics");
  const memberBody = await memberSignup.json().catch(() => null);
  assert.equal(memberSignup.status, 200, JSON.stringify(memberBody));
  memberCookie = cookieValue(memberSignup.headers.get("set-cookie"));
});

after(async () => {
  await stopServer();
  if (mediaStoreRoot) await rm(mediaStoreRoot, { recursive: true, force: true });
  await resetDatabase(false);
});

// --- Role enforcement -------------------------------------------------------

test("anonymous callers are rejected from every admin analytics journey", async () => {
  const cases = [
    "/api/metrics/dashboard",
    "/api/metrics/dashboard?range=7d",
    "/api/metrics/analytics",
    "/api/metrics/dashboard/export",
  ];
  for (const path of cases) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 401, `${path} should be 401`);
    assert.equal((await response.json()).error.code, "unauthorized");
  }
});

test("authenticated non-admin members cannot access admin analytics", async () => {
  const dashboard = await fetch(`${baseUrl}/api/metrics/dashboard`, {
    headers: { Cookie: memberCookie },
  });
  assert.equal(dashboard.status, 403);
  assert.equal((await dashboard.json()).error.code, "forbidden");

  const analytics = await fetch(`${baseUrl}/api/metrics/analytics`, {
    headers: { Cookie: memberCookie },
  });
  assert.equal(analytics.status, 403);

  const exportResponse = await fetch(`${baseUrl}/api/metrics/dashboard/export`, {
    headers: { Cookie: memberCookie },
  });
  assert.equal(exportResponse.status, 403);
});

test("member dashboard/history journeys require an authenticated member", async () => {
  const anonymous = await fetch(`${baseUrl}/api/me/dashboard`);
  assert.equal(anonymous.status, 401);
  const anonymousHistory = await fetch(`${baseUrl}/api/me/history`);
  assert.equal(anonymousHistory.status, 401);

  const member = await fetch(`${baseUrl}/api/me/dashboard`, {
    headers: { Cookie: memberCookie },
  });
  assert.equal(member.status, 200);
  const payload = await member.json();
  assert.equal(payload.profile.username, "member_analytics");
  assert.ok(Array.isArray(payload.recent_activity.items));
  assert.ok(Array.isArray(payload.recent_views.items));
  assert.equal(payload.summary.source, "postgres");
  assert.equal(payload.summary.has_activity, false, "fresh member has no activity");
});

// --- Empty states (fresh database) -----------------------------------------

test("metrics endpoints report corpus counts and empty trends on a fresh database", async () => {
  const metrics = await fetch(`${baseUrl}/api/metrics`);
  assert.equal(metrics.status, 200);
  const payload = await metrics.json();
  assert.equal(payload.item_count, 3);
  assert.equal(payload.context_count, 2);
  assert.equal(payload.keyword_count, 3);

  const trend = await fetch(`${baseUrl}/api/metrics/requests?months=12`);
  assert.equal(trend.status, 200);
  const trendPayload = await trend.json();
  assert.equal(trendPayload.source, "postgres");
  assert.equal(trendPayload.months, 12);
  assert.equal(trendPayload.total_requests, 0);
  assert.equal(trendPayload.buckets.length, 12);
  for (const bucket of trendPayload.buckets) {
    assert.equal(bucket.request_count, 0);
    assert.equal(bucket.shown_count, 0);
  }

  const config = await fetch(`${baseUrl}/api/metrics/config`);
  assert.equal(config.status, 200);
  const configPayload = await config.json();
  assert.equal(configPayload.cbf_model, "intfloat/multilingual-e5-large-instruct");
  assert.equal(configPayload.cf_model, "ItemKNN");
  assert.equal(configPayload.hybrid_method, "Hybrid-WeightedSum");
  assert.equal(configPayload.hybrid_alpha, 0.6, "RECSYS_HYBRID_ALPHA env override");
  assert.equal(configPayload.itemknn_k, 12, "RECSYS_ITEMKNN_K env override");
  assert.equal(configPayload.positive_threshold, 4);
});

test("dashboard returns a zeroed but fully-populated payload on a fresh database", async () => {
  const response = await fetch(`${baseUrl}/api/metrics/dashboard?range=30d`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.source, "postgres");
  assert.equal(payload.range_days, 30);
  assert.ok(payload.generated_at);
  assert.equal(payload.kpis.members.raw_value, 2, "two signups exist");
  assert.equal(payload.kpis.performances.raw_value, 3);
  assert.equal(payload.kpis.indices.raw_value, 0);
  assert.equal(payload.kpis.points.raw_value, 0, "no interactions on fresh DB");
  assert.equal(payload.kpis.active_users.raw_value, 0);
  assert.equal(payload.trend_30d.labels.length, 0);
  assert.equal(payload.user_growth.new_users.length, 1, "both signups land on today's bucket");
  assert.equal(payload.user_growth.new_users[0], 2);
  assert.equal(payload.usage_heatmap.matrix.length, 7);
  assert.equal(payload.usage_heatmap.matrix[0].length, 24);
  assert.equal(payload.popular_categories.total_items, 3);
  assert.equal(payload.popular_subcontexts.total_requests, 0);
  assert.equal(payload.top_search_terms.items.length, 0);
  assert.equal(payload.rating_distribution.total, 0);
  assert.equal(payload.rating_distribution.buckets.length, 5);
  assert.equal(payload.model_quality.source, "unavailable", "no evaluation_runs table on fresh DB");
  assert.equal(payload.quality_trend_30d.labels.length, 0);
  assert.equal(payload.algorithm_kpis.search_total, 0);
  assert.equal(payload.top_keywords.items.length, 0);
  assert.equal(payload.page_quality.metrics.length, 5);
  assert.equal(payload.recent_activity.items.length, 0);
});

test("analytics returns zeroed behavior plus rule insights on a fresh database", async () => {
  const response = await fetch(`${baseUrl}/api/metrics/analytics?range=30d`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.range_days, 30);
  assert.equal(payload.source, "postgres");
  assert.equal(payload.behavior.funnel.length, 4);
  for (const step of payload.behavior.funnel) assert.equal(step.count, 0);
  assert.equal(payload.behavior.actions.length, 0);
  assert.equal(payload.behavior.keyword_pairs.length, 0);
  assert.equal(payload.behavior.active_users, 0);
  assert.equal(payload.behavior.engagement_rate, 0);
  assert.equal(payload.ai_insights.engine, "rules");
  assert.equal(payload.ai_insights.cached, false);
  assert.equal(payload.ai_insights.items.length, 4);
  // Privacy: recent activity rows must never expose raw user keys.
  assert.ok(payload.trends.recent_activity.items.length === 0);
});

test("legacy-stats and engagement compatibility endpoints degrade gracefully", async () => {
  const single = await fetch(`${baseUrl}/api/items/${ARTIFACT_IDS[0]}/legacy-stats`);
  assert.equal(single.status, 200);
  const singlePayload = await single.json();
  assert.equal(singlePayload.item_id, ARTIFACT_IDS[0]);
  assert.equal(singlePayload.count, 0);
  assert.equal(singlePayload.avg_rating, 0);
  assert.equal(singlePayload.source, "disabled", "no legacy_interactions table on fresh DB");

  const batch = await fetch(`${baseUrl}/api/legacy-stats?ids=${ARTIFACT_IDS.join(",")}`);
  assert.equal(batch.status, 200);
  const batchPayload = await batch.json();
  assert.equal(batchPayload.stats.length, 3);
  for (const row of batchPayload.stats) {
    assert.equal(row.count, 0);
    assert.equal(row.source, "disabled");
  }

  const engagement = await fetch(`${baseUrl}/api/items/engagement?ids=${ARTIFACT_IDS.join(",")}`);
  assert.equal(engagement.status, 200);
  const engagementPayload = await engagement.json();
  assert.equal(engagementPayload.source, "postgres");
  assert.equal(engagementPayload.engagements.length, 3);
  for (const row of engagementPayload.engagements) {
    assert.equal(row.like_count, 0);
    assert.equal(row.save_count, 0);
    assert.equal(row.rating_count, 0);
    assert.equal(row.engagement_score, 0);
  }

  const invalid = await fetch(`${baseUrl}/api/items/engagement?ids=abc`);
  assert.equal(invalid.status, 422);
  const tooMany = await fetch(`${baseUrl}/api/items/engagement?ids=${Array.from({ length: 201 }, (_, i) => i + 1).join(",")}`);
  assert.equal(tooMany.status, 422);
});

// --- Populated data ---------------------------------------------------------

test("metrics reflect persisted actions and recommendation outcomes", async () => {
  const client = new Client({ connectionString: databaseUrl.toString() });
  await client.connect();
  try {
    // Two recommendation requests with selected keywords and ranked results.
    await client.query(
      `INSERT INTO recommendation_requests
         (id, user_id, selected_context_id, candidate_count, top_k, method, metadata_json, created_at)
       VALUES
         (1, $1, 51, 3, 5, 'Hybrid-WeightedSum', '{"fallback": false, "user_key": "user:2"}', NOW()),
         (2, NULL, 52, 3, 5, 'Hybrid-WeightedSum', '{"fallback": true, "user_key": "anon:test"}', NOW())`,
      [adminId],
    );
    await client.query(
      `INSERT INTO recommendation_request_selected_keywords (id, request_id, keyword_id)
       VALUES (1, 1, 61), (2, 1, 62), (3, 2, 63)`,
    );
    await client.query(
      `INSERT INTO recommendation_results
         (id, request_id, item_id, rank, cbf_score, cf_score, hybrid_score, is_context_valid, matched_keywords_json, explanation)
       VALUES
         (1, 1, 41, 1, 0.9, 0.8, 0.85, TRUE, '["ชฎา"]', ''),
         (2, 1, 42, 2, 0.8, 0.7, 0.75, TRUE, '["ลิเก"]', ''),
         (3, 1, 43, 3, 0.7, 0.6, 0.65, TRUE, '["โขน"]', ''),
         (4, 2, 43, 1, 0.6, 0.0, 0.3, TRUE, '["โขน"]', '')`,
    );
    // Member activity: a view attributed to request 1, a like, and a rating.
    await client.query(
      `INSERT INTO interaction_logs
         (id, user_key, item_id, action_type, metadata_json, recommendation_request_id, created_at)
       VALUES
         (101, 'user:2', 41, 'item_view', '{}', 1, NOW()),
         (102, 'user:2', 41, 'like', '{}', 1, NOW()),
         (103, 'user:2', 42, 'rate', '{"rating": 5}', NULL, NOW())`,
    );
    await client.query(
      `INSERT INTO likes (id, user_key, item_id, created_at) VALUES (1, 'user:2', 41, NOW())`,
    );
    await client.query(
      `INSERT INTO saved_items (id, user_key, item_id, created_at) VALUES (1, 'user:2', 42, NOW())`,
    );
    await client.query(
      `INSERT INTO ratings (id, user_key, item_id, rating, created_at, updated_at)
       VALUES (1, 'user:2', 42, 5, NOW(), NOW()), (2, 'user:2', 43, 3, NOW(), NOW())`,
    );
  } finally {
    await client.end();
  }

  // Request trend reflects the persisted rows.
  const trend = await fetch(`${baseUrl}/api/metrics/requests?months=12`);
  assert.equal(trend.status, 200);
  const trendPayload = await trend.json();
  assert.equal(trendPayload.total_requests, 2);
  assert.equal(trendPayload.total_shown, 4);
  const currentBucket = trendPayload.buckets[trendPayload.buckets.length - 1];
  assert.equal(currentBucket.request_count, 2);
  assert.equal(currentBucket.shown_count, 4);

  // Engagement reflects likes + saves + positive ratings (rating >= 4).
  const engagement = await fetch(`${baseUrl}/api/items/engagement?ids=${ARTIFACT_IDS.join(",")}`);
  assert.equal(engagement.status, 200);
  const engagementPayload = await engagement.json();
  const byId = new Map(engagementPayload.engagements.map((row) => [row.item_id, row]));
  assert.equal(byId.get(ARTIFACT_IDS[0]).like_count, 1);
  assert.equal(byId.get(ARTIFACT_IDS[1]).save_count, 1);
  assert.equal(byId.get(ARTIFACT_IDS[1]).rating_count, 1, "5-star rating is positive");
  assert.equal(byId.get(ARTIFACT_IDS[1]).engagement_score, 2);
  assert.equal(byId.get(ARTIFACT_IDS[2]).rating_count, 0, "3-star rating is not engagement");

  // Dashboard reflects the persisted rows.
  const dashboard = await fetch(`${baseUrl}/api/metrics/dashboard?range=30d`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(dashboard.status, 200);
  const payload = await dashboard.json();
  assert.equal(payload.kpis.indices.raw_value, 4, "recommendation_results count");
  assert.equal(payload.kpis.points.raw_value, 4, "1 like + 1 save + 2 ratings");
  assert.equal(payload.kpis.active_users.raw_value, 1);
  assert.equal(payload.kpis.sessions.raw_value, 1, "one user on one day");
  assert.equal(payload.popular_subcontexts.total_requests, 2);
  assert.deepEqual(
    new Set(payload.popular_subcontexts.items.map((row) => row.name)),
    new Set(["งานบวช", "งานศพ"]),
  );
  assert.equal(payload.rating_distribution.total, 2);
  assert.equal(payload.rating_distribution.average, 4);
  assert.equal(payload.rating_distribution.buckets[4].count, 1);
  assert.equal(payload.rating_distribution.buckets[2].count, 1);
  assert.equal(payload.top_keywords.items.length, 3, "ชฎา/ลิเก/โขน each selected once");
  assert.deepEqual(
    new Set(payload.top_keywords.items.map((row) => row.term)),
    new Set(["ชฎา", "ลิเก", "โขน"]),
  );
  assert.equal(payload.algorithm_kpis.items_shown_total, 1);
  assert.equal(payload.algorithm_kpis.ctr_pct, 25, "1 view / 4 shown");
  assert.ok(payload.trend_30d.labels.length >= 1);
  assert.equal(payload.trend_30d.ratings[0], 1);
  assert.equal(payload.recent_activity.items.length, 3);
  assert.deepEqual(
    new Set(payload.recent_activity.items.map((row) => row.target)),
    new Set(["ระบำหลักทดสอบ", "ลิเกรองทดสอบ"]),
  );
  assert.equal(payload.recent_activity.items[0].target, "ลิเกรองทดสอบ", "rate log is the newest activity");
  assert.equal(payload.user_growth.new_users.length, 1);
});

test("analytics funnel and segments reflect attributed outcomes", async () => {
  const response = await fetch(`${baseUrl}/api/metrics/analytics?range=30d`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  const funnel = Object.fromEntries(payload.behavior.funnel.map((step) => [step.key, step.count]));
  assert.equal(funnel.search, 2, "two recommendation requests");
  assert.equal(funnel.detail, 1, "one request with an attributed item_view");
  assert.equal(funnel.engage, 1, "the attributed like");
  assert.equal(funnel.rate, 0, "the rating was not request-attributed");
  assert.equal(payload.behavior.active_users, 1);
  assert.equal(payload.behavior.engaged_users, 1);
  assert.equal(payload.behavior.engagement_rate, 100);
  const segments = Object.fromEntries(payload.behavior.audience_segments.map((s) => [s.key, s.count]));
  assert.equal(segments.authenticated, 1);
  assert.equal(segments.anonymous, 0);
  assert.equal(segments.engaged, 1);
  const actions = Object.fromEntries(payload.behavior.actions.map((row) => [row.action, row.count]));
  assert.equal(actions.item_view, 1);
  assert.equal(actions.like, 1);
  assert.equal(actions.rate, 1);
  assert.equal(payload.behavior.keyword_pairs.length, 1, "ชฎา+ลิเก pair from request 1");
  assert.equal(payload.behavior.keyword_pairs[0].count, 1);
  assert.equal(payload.ai_insights.items.length, 4);
  // Privacy: trends recent activity must mask the raw user key.
  assert.equal(payload.trends.recent_activity.items.length, 3);
  for (const row of payload.trends.recent_activity.items) {
    assert.ok(!row.user.startsWith("user:"), "user keys are masked in analytics");
  }
});

test("member history surfaces persisted actions with request attribution", async () => {
  const history = await fetch(`${baseUrl}/api/me/history?limit=20`, {
    headers: { Cookie: memberCookie },
  });
  assert.equal(history.status, 200);
  const historyPayload = await history.json();
  assert.ok(historyPayload.items.length >= 0);

  // A like from a recommendation result must persist the attribution.
  const like = await fetch(`${baseUrl}/api/actions/like`, {
    method: "POST",
    headers: mutationHeaders(memberCookie),
    body: JSON.stringify({ item_id: ARTIFACT_IDS[0], request_id: "1" }),
  });
  assert.equal(like.status, 200);

  const client = new Client({ connectionString: databaseUrl.toString() });
  await client.connect();
  let attributed = false;
  try {
    const rows = await client.query(
      `SELECT recommendation_request_id FROM interaction_logs
       WHERE user_key = $1 AND action_type = 'like'
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      ["user:2"],
    );
    attributed = Number(rows.rows[0]?.recommendation_request_id) === 1;
  } finally {
    await client.end();
  }
  assert.equal(attributed, true, "action with request_id is attributed to the persisted request");

  const memberHistory = await fetch(`${baseUrl}/api/me/history?limit=20`, {
    headers: { Cookie: memberCookie },
  });
  const memberHistoryPayload = await memberHistory.json();
  assert.ok(
    memberHistoryPayload.items.some(
      (entry) => entry.action_type === "like" && entry.item_id === ARTIFACT_IDS[0],
    ),
    "the member's like appears in their history",
  );
});

// --- Export behavior --------------------------------------------------------

test("the dashboard export returns a valid Excel workbook to administrators only", async () => {
  const response = await fetch(`${baseUrl}/api/metrics/dashboard/export?range=7d`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("content-type"),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  const disposition = response.headers.get("content-disposition") ?? "";
  assert.match(disposition, /^attachment; filename="thai_arts_dashboard_.*_7d\.xlsx"$/);
  assert.equal(response.headers.get("cache-control"), "no-store");

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  const sheetNames = workbook.worksheets.map((sheet) => sheet.name);
  for (const expected of ["ภาพรวม", "แนวโน้ม", "ผู้ใช้งาน", "คำค้น", "หมวดหมู่-บริบท", "คุณภาพ", "กิจกรรมล่าสุด", "คำอธิบาย"]) {
    assert.ok(sheetNames.includes(expected), `workbook should contain sheet ${expected}`);
  }
  const summary = workbook.getWorksheet("ภาพรวม");
  assert.equal(summary.getCell(7, 1).value, "ตัวชี้วัด");
  assert.equal(summary.getCell(8, 1).value, "สมาชิก");
  assert.equal(summary.getCell(8, 2).value, 2, "members KPI lands in the summary sheet");
  const quality = workbook.getWorksheet("คุณภาพ");
  assert.equal(quality.getCell(6, 2).value, 0, "unavailable quality exports as zero");
});
