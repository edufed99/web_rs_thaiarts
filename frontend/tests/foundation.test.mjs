import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { after, before, test } from "node:test";

import pg from "pg";

const { Client } = pg;
const databaseName = "web_rs_thaiarts_foundation_test";
const adminUrl =
  process.env.TEST_POSTGRES_ADMIN_URL ??
  "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${databaseName}`;

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

async function emptyTestDatabase() {
  const client = new Client({ connectionString: databaseUrl.toString() });
  await client.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE");
    await client.query("CREATE SCHEMA public");
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

// fallow-ignore-next-line complexity -- Bounded retry polling is intentional in this HTTP test.
async function waitForHealth(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(url).catch(() => undefined);
    if (response?.status !== undefined && response.status !== 404) return response;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function stopServer() {
  const activeServer = server;
  if (!activeServer) return;
  if (activeServer.exitCode === null) {
    const exited = once(activeServer, "exit");
    if (process.platform === "win32") {
      await new Promise((resolve) => {
        const killer = spawn("taskkill", ["/pid", String(activeServer.pid), "/t", "/f"], {
          stdio: "ignore",
        });
        killer.on("close", resolve);
      });
    } else {
      process.kill(-activeServer.pid, "SIGTERM");
    }
    await exited;
  }
  server = undefined;
}

async function startServer(connectionString) {
  server = spawn("npm", ["run", "dev", "--", "--port", "3100"], {
    cwd: process.cwd(),
    detached: process.platform !== "win32",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      DATABASE_URL: connectionString,
      MODEL_SERVICE_URL: "http://127.0.0.1:9",
    },
    stdio: "ignore",
  });
  return waitForHealth("http://127.0.0.1:3100/api/health");
}

before(async () => {
  await resetTestDatabase({ create: true });
});

after(async () => {
  await stopServer();
  await resetTestDatabase({ create: false });
});

test("an empty development database is rebuilt from migrations and seed data", async () => {
  const result = await runNpm(["run", "db:rebuild"], {
    DATABASE_URL: databaseUrl.toString(),
    ALLOW_DATABASE_RESET: "1",
  });

  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);

  const client = new Client({ connectionString: databaseUrl.toString() });
  await client.connect();
  try {
    const status = await client.query(
      "SELECT value FROM application_status WHERE key = 'database'",
    );
    assert.deepEqual(status.rows, [{ value: "ready" }]);

    const migrations = await client.query(
      "SELECT name FROM typeorm_migrations ORDER BY id",
    );
    assert.deepEqual(migrations.rows, [
      { name: "CreateApplicationStatus1723708800000" },
      { name: "CreateCatalogue1786766400000" },
      { name: "ProtectArtifactItemId1786766500000" },
      { name: "CreateMembersAndSessions1786939200000" },
      { name: "CreatePasswordResetTokens1787200000000" },
    ]);
  } finally {
    await client.end();
  }
});

test("the compiled operational CLI migrates and seeds without starting Next.js", async () => {
  await emptyTestDatabase();
  const built = await runNpm(["run", "build:db"]);
  assert.equal(built.code, 0, `${built.stdout}\n${built.stderr}`);

  const migrated = await runNpm(["run", "migration:run:compiled"], {
    DATABASE_URL: databaseUrl.toString(),
  });
  assert.equal(migrated.code, 0, `${migrated.stdout}\n${migrated.stderr}`);
  const seeded = await runNpm(["run", "seed:compiled"], {
    DATABASE_URL: databaseUrl.toString(),
  });
  assert.equal(seeded.code, 0, `${seeded.stdout}\n${seeded.stderr}`);

  const client = new Client({ connectionString: databaseUrl.toString() });
  await client.connect();
  try {
    const status = await client.query(
      "SELECT value FROM application_status WHERE key = 'database'",
    );
    assert.deepEqual(status.rows, [{ value: "ready" }]);
  } finally {
    await client.end();
  }
});

test("Next.js requires explicit migrations and seeds before health becomes ready", async () => {
  await emptyTestDatabase();
  const unavailable = await startServer(databaseUrl.toString());
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {
    status: "unavailable",
    database: "disconnected",
  });

  const migrated = await runNpm(["run", "migration:run"], {
    DATABASE_URL: databaseUrl.toString(),
  });
  assert.equal(migrated.code, 0, `${migrated.stdout}\n${migrated.stderr}`);
  const seeded = await runNpm(["run", "seed"], {
    DATABASE_URL: databaseUrl.toString(),
  });
  assert.equal(seeded.code, 0, `${seeded.stdout}\n${seeded.stderr}`);

  const response = await fetch("http://127.0.0.1:3100/api/health");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "ok",
    database: "connected",
  });
});

test("health returns 503 when PostgreSQL is unreachable", async () => {
  await stopServer();
  const response = await startServer(
    "postgresql://postgres:postgres@127.0.0.1:1/unreachable",
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    status: "unavailable",
    database: "disconnected",
  });
});
