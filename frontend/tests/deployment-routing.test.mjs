import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const deploymentRoot = new URL("../../deployment/", import.meta.url);

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
    "api/auth/google/login/exchange",
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

test("Next.js mounts the shared uploads volume for authenticated avatar writes", async () => {
  for (const filename of ["../docker-compose.yml", "docker-compose.prod.yml"]) {
    const compose = await readFile(new URL(filename, deploymentRoot), "utf8");
    const frontend = compose.match(
      /\n  frontend:\r?\n([\s\S]*?)(?=\n  [a-z][a-z-]*:\r?\n|\nvolumes:)/,
    )?.[1] ?? "";
    assert.match(frontend, /uploads_data:\/app\/data\/uploads(?:\r?\n|$)/);
  }
});
