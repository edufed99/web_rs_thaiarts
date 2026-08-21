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

test("nginx routes the entire public API surface to Next.js; nothing targets FastAPI", async () => {
  // nginx (Docker) is the public reverse proxy now (replaced IIS W3SVC).
  // The steady-state site config must proxy every path to the Next.js
  // frontend over the internal Docker network and never to the Private
  // Model Service (backend:8001).
  const config = await readFile(new URL("nginx/conf.d/thaiarts.conf", deploymentRoot), "utf8");

  // No public path may be routed to the retired FastAPI application port.
  assert.doesNotMatch(config, /:8001\b/, "nginx must not proxy any path to the FastAPI model service (backend:8001)");

  // Every proxy_pass in the file targets the Next.js frontend over the
  // internal network. The HTTPS server proxies `location /` (which covers
  // pages and /api/* — Next.js serves both on port 3000); the HTTP server
  // only 301-redirects to https and serves the ACME webroot (no proxy_pass).
  const proxyPasses = [...config.matchAll(/proxy_pass\s+(http:\/\/[^;\s]+)\s*;/g)].map((m) => m[1]);
  assert.ok(proxyPasses.length > 0, "nginx must define at least one proxy_pass to the frontend");
  for (const target of proxyPasses) {
    assert.equal(target, "http://frontend:3000", `nginx must proxy to frontend:3000, found ${target}`);
  }

  // The catch-all `location /` block must proxy to the frontend (this is the
  // rule that serves every /api/* and page path).
  const rootLocation = config.match(/location\s+\/\s*\{[\s\S]*?proxy_pass\s+http:\/\/frontend:3000\s*;/);
  assert.ok(rootLocation, "nginx `location /` must proxy_pass to http://frontend:3000");

  // Sanity: the same contract holds for the bootstrap config used during
  // first-time cert issuance (HTTP-only, no 443 yet).
  const bootstrap = await readFile(new URL("nginx/bootstrap/thaiarts.bootstrap.conf", deploymentRoot), "utf8");
  assert.doesNotMatch(bootstrap, /:8001\b/, "nginx bootstrap must not proxy to FastAPI (backend:8001)");
  assert.match(bootstrap, /location\s+\/\s*\{[\s\S]*?proxy_pass\s+http:\/\/frontend:3000\s*;/);

  // The IIS rollback artifact (`web.config`) still routes every public path
  // to Next.js on 127.0.0.1:3000 and never to 8001 — kept so IIS can reclaim
  // 80/443 if nginx is rolled back (see deployment/release/ROLLBACK.md).
  const webConfig = await readFile(new URL("web.config", deploymentRoot), "utf8");
  const rules = [...webConfig.matchAll(/<rule name="([^"]+)"[\s\S]*?<match url="([^"]+)"[\s\S]*?<action [^>]*url="([^"]+)"[^>]*\/>[\s\S]*?<\/rule>/g)]
    .map((match) => ({ name: match[1], pattern: new RegExp(match[2]), target: match[3] }))
    .filter((rule) => rule.name.includes("ThaiArtsRecommender"));
  assert.equal(
    rules.some((rule) => rule.target.includes(":8001")),
    false,
    "web.config must not route any public path to the retired FastAPI application",
  );
  assert.ok(
    rules.every((rule) => rule.target.includes(":3000")),
    "web.config rollback rules must all target Next.js on :3000",
  );
});

test("production compose publishes only nginx (80/443) + Next.js loopback; no postgres/model-service host ports (issue #11)", async () => {
  const compose = await readFile(new URL("docker-compose.prod.yml", deploymentRoot), "utf8");

  // PostgreSQL is internal only: no `ports:` key at all.
  assert.doesNotMatch(serviceBlock(compose, "postgres"), /^\s+ports:/m, "postgres must not publish host ports");

  // The Private Model Service is internal only: `expose` (internal network)
  // but never `ports` (host-published).
  const backend = serviceBlock(compose, "backend");
  assert.match(backend, /^\s+expose:/m, "backend must expose 8001 on the internal network");
  assert.doesNotMatch(backend, /^\s+ports:/m, "backend must not publish host ports");

  // Next.js is still published on loopback only (the IIS-rollback path).
  assert.match(serviceBlock(compose, "frontend"), /^\s+ports:\r?\n\s+- "127\.0\.0\.1:3000:3000"$/m);

  // nginx is the public reverse proxy: it publishes host 80 and 443.
  const nginx = serviceBlock(compose, "nginx");
  assert.match(nginx, /"80:80"/, "nginx must publish host :80");
  assert.match(nginx, /"443:443"/, "nginx must publish host :443");

  // No service in the whole file publishes the model-service or postgres
  // ports to the host. (Next.js 127.0.0.1:3000 and nginx 80/443 are the only
  // host-published ports.)
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
