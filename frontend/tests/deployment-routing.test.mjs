import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const deploymentRoot = new URL("../../deployment/", import.meta.url);

test("IIS routes only migrated API paths to Next.js before compatibility", async () => {
  const config = await readFile(new URL("web.config", deploymentRoot), "utf8");
  const rules = [...config.matchAll(/<rule name="([^"]+)"[\s\S]*?<match url="([^"]+)"[\s\S]*?<action [^>]*url="([^"]+)"[^>]*\/>[\s\S]*?<\/rule>/g)]
    .map((match) => ({ name: match[1], pattern: new RegExp(match[2]), target: match[3] }))
    .filter((rule) => rule.name.includes("ThaiArtsRecommender"));

  function selectedPort(path) {
    const rule = rules.find((candidate) => candidate.pattern.test(path));
    return rule?.target.includes(":3000") ? 3000 : rule?.target.includes(":8001") ? 8001 : undefined;
  }

  for (const migratedPath of [
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
    "api/auth/signup",
    "api/auth/login",
    "api/auth/logout",
    "api/auth/me",
    "api/auth/google/login/exchange",
    "api/actions/like",
    "api/actions/save",
    "api/actions/rating",
    "api/actions/view",
    "api/me/profile",
    "api/me/profile/avatar",
    "api/me/dashboard",
  ]) {
    assert.equal(selectedPort(migratedPath), 3000, migratedPath);
  }

  for (const compatibilityPath of [
    "api/recommendations",
    "api/auth/google/login/start",
    "api/auth/google/login/callback",
    "api/auth/password-reset/request",
  ]) {
    assert.equal(selectedPort(compatibilityPath), 8001, compatibilityPath);
  }
});

test("Next.js mounts the shared uploads volume for authenticated avatar writes", async () => {
  for (const filename of ["../docker-compose.yml", "docker-compose.prod.yml"]) {
    const compose = await readFile(new URL(filename, deploymentRoot), "utf8");
    const frontend = compose.match(
      /\n  frontend:\r?\n([\s\S]*?)(?=\n  [a-z][a-z-]*:\r?\n|\nvolumes:)/,
    )?.[1] ?? "";
    assert.match(frontend, /uploads_data:\/app\/data\/uploads(?:\r?\n|$)/);
  }
});
