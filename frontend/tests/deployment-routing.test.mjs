import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const deploymentRoot = new URL("../../deployment/", import.meta.url);

/** Extract one service block (``\n  <name>:`` … next top-level key) from a compose file. */
function serviceBlock(compose, name) {
  const match = compose.match(
    new RegExp(`\\n  ${name}:\\r?\\n([\\s\\S]*?)(?=\\n  [a-z][a-z-]*:\\r?\\n|\\nvolumes:)`),
  );
  return match?.[1] ?? "";
}

test("IIS routes the entire public API surface to Next.js; nothing targets FastAPI", async () => {
  const config = await readFile(new URL("web.config", deploymentRoot), "utf8");
  const rules = [...config.matchAll(/<rule name="([^"]+)"[\s\S]*?<match url="([^"]+)"[\s\S]*?<action [^>]*url="([^"]+)"[^>]*\/>[\s\S]*?<\/rule>/g)]
    .map((match) => ({ name: match[1], pattern: new RegExp(match[2]), target: match[3] }))
    .filter((rule) => rule.name.includes("ThaiArtsRecommender"));

  function selectedPort(path) {
    const rule = rules.find((candidate) => candidate.pattern.test(path));
    return rule?.target.includes(":3000") ? 3000 : rule?.target.includes(":8001") ? 8001 : undefined;
  }

  for (const path of [
    "api/health",
    "api/items",
    "api/items/batch",
    "api/items/engagement",
    "api/items/168393376",
    "api/items/168393376/similar",
    "api/items/168393376/legacy-stats",
    "api/legacy-stats",
    "api/metrics",
    "api/metrics/requests",
    "api/metrics/config",
    "api/metrics/dashboard",
    "api/metrics/analytics",
    "api/metrics/dashboard/export",
    "api/contexts",
    "api/keywords",
    "api/uploads/items/cover.jpg",
    "api/uploads/items",
    "api/uploads/avatars/member.png",
    "api/recommendations",
    "api/recommendations/profile",
    "api/auth/signup",
    "api/auth/login",
    "api/auth/logout",
    "api/auth/me",
    "api/auth/google/login/start",
    "api/auth/google/login/callback",
    "api/auth/password-reset/request",
    "api/auth/password-reset/confirm",
    "api/actions/like",
    "api/actions/save",
    "api/actions/rating",
    "api/actions/view",
    "api/me/profile",
    "api/me/profile/avatar",
    "api/me/dashboard",
    "api/admin/users",
    "api/admin/items",
    "api/admin/publication",
  ]) {
    assert.equal(selectedPort(path), 3000, path);
  }

  // The retire step (issue #10): no IIS rule may target the FastAPI port.
  assert.equal(
    rules.some((rule) => rule.target.includes(":8001")),
    false,
    "web.config must not route any public path to the retired FastAPI application",
  );
});

test("production compose publishes no host ports for postgres or the model service (issue #11)", async () => {
  const compose = await readFile(new URL("docker-compose.prod.yml", deploymentRoot), "utf8");

  // PostgreSQL is internal only: no `ports:` key at all.
  assert.doesNotMatch(serviceBlock(compose, "postgres"), /^\s+ports:/m, "postgres must not publish host ports");

  // The Private Model Service is internal only: `expose` (internal network)
  // but never `ports` (host-published).
  const backend = serviceBlock(compose, "backend");
  assert.match(backend, /^\s+expose:/m, "backend must expose 8001 on the internal network");
  assert.doesNotMatch(backend, /^\s+ports:/m, "backend must not publish host ports");

  // The only host-published port in the whole file is Next.js on loopback.
  assert.match(serviceBlock(compose, "frontend"), /^\s+ports:\r?\n\s+- "127\.0\.0\.1:3000:3000"$/m);
  assert.doesNotMatch(compose, /"127\.0\.0\.1:8001:8001"|"8001:8001"|"127\.0\.0\.1:5432:5432"|"5432:5432"/);
});

test("the model service has no database or media configuration in either compose file (issue #11)", async () => {
  for (const filename of ["../docker-compose.yml", "docker-compose.prod.yml"]) {
    const compose = await readFile(new URL(filename, deploymentRoot), "utf8");
    const backend = serviceBlock(compose, "backend");

    // No database connection string, no POSTGRES_* credentials, no volumes
    // (the uploads volume belongs to Next.js only).
    assert.doesNotMatch(backend, /DATABASE_URL/, `${filename}: backend must not receive DATABASE_URL`);
    assert.doesNotMatch(backend, /POSTGRES_/, `${filename}: backend must not receive POSTGRES_* credentials`);
    assert.doesNotMatch(backend, /^\s+volumes:/m, `${filename}: backend must not mount any volume`);
    assert.doesNotMatch(backend, /MEDIA_STORE_ROOT/, `${filename}: backend must not receive media configuration`);
  }
});

test("the uploads volume is mounted only by the Next.js service (issue #11)", async () => {
  for (const filename of ["../docker-compose.yml", "docker-compose.prod.yml"]) {
    const compose = await readFile(new URL(filename, deploymentRoot), "utf8");
    const frontend = serviceBlock(compose, "frontend");
    assert.match(frontend, /uploads_data:\/app\/data\/uploads(?:\r?\n|$)/);

    // Every other service block must not reference the uploads volume.
    for (const name of ["postgres", "backend", "migrate"]) {
      assert.doesNotMatch(
        serviceBlock(compose, name),
        /uploads_data/,
        `${filename}: ${name} must not mount the uploads volume`,
      );
    }
  }
});

test("the migrate tool verifies migration state after applying them (issue #11)", async () => {
  for (const filename of ["../docker-compose.yml", "docker-compose.prod.yml"]) {
    const compose = await readFile(new URL(filename, deploymentRoot), "utf8");
    const migrate = serviceBlock(compose, "migrate");
    assert.match(migrate, /migration:run/);
    assert.match(migrate, /migration:verify/, `${filename}: migrate must fail closed on pending migrations`);
  }
});
