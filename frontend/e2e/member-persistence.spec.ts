import { expect, test } from "@playwright/test";

const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;
const apiBase = process.env.E2E_API_BASE_URL || "http://127.0.0.1:8001";

test.beforeEach(async ({ page }) => {
  test.skip(!username || !password, "Set E2E_USERNAME and E2E_PASSWORD for a dedicated test member.");
  await page.goto("/login?next=/items");
  await page.getByLabel("ชื่อผู้ใช้").fill(username!);
  await page.getByLabel("รหัสผ่าน").fill(password!);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await expect(page).toHaveURL(/\/items/);
});

test("like is persisted in Postgres and restored after the test", async ({ page }) => {
  const detailLink = page.locator('a[href^="/items/"]').first();
  await expect(detailLink).toBeVisible();
  await detailLink.click();

  const likeButton = page.locator('[data-testid="item-action-bar"] button').filter({ hasText: /ถูกใจ/ }).first();
  await expect(likeButton).toBeEnabled();
  const initial = await likeButton.getAttribute("aria-pressed");

  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/actions/like") && response.ok()),
    likeButton.click(),
  ]);
  await page.reload();
  const persisted = page.locator('[data-testid="item-action-bar"] button').filter({ hasText: /ถูกใจ/ }).first();
  await expect(persisted).toHaveAttribute("aria-pressed", initial === "true" ? "false" : "true");

  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/actions/like") && response.ok()),
    persisted.click(),
  ]);
  await expect(persisted).toHaveAttribute("aria-pressed", initial ?? "false");
});

test("member cannot escalate own role through profile API", async ({ page }) => {
  const result = await page.evaluate(async (backendUrl) => {
    const stored = JSON.parse(localStorage.getItem("thai_arts_jwt") || "{}");
    const token = stored.token;
    const response = await fetch(`${backendUrl}/me/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ role: "super_admin" }),
    });
    return response.status;
  }, apiBase);
  expect(result).toBe(422);
});
