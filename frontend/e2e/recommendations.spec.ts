import { expect, test } from "@playwright/test";

const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;

test.beforeEach(async ({ page }) => {
  test.skip(
    !username || !password,
    "Set E2E_USERNAME and E2E_PASSWORD for a dedicated test member.",
  );
  await page.goto("/login?next=/recommend");
  await page.getByLabel("ชื่อผู้ใช้").fill(username!);
  await page.getByLabel("รหัสผ่าน", { exact: true }).fill(password!);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/recommend");
});

test("profile recommendations tab settles into results or the empty state, never an error", async ({ page }) => {
  await expect(
    page.getByRole("heading", { name: "แนะนำจากสิ่งที่คุณชอบ" }),
  ).toBeVisible();
  // The profile request is session-gated; it must settle into the results
  // grid or the no-history empty state — the ErrorState title would mean the
  // Application Backend failed to answer.
  await expect(page.getByText("เกิดข้อผิดพลาด")).toHaveCount(0, { timeout: 30_000 });
  await expect(
    page
      .locator("#profile-recommendation-results, div:has-text('ยังไม่มีประวัติพอสำหรับคำแนะนำจากโปรไฟล์')")
      .first(),
  ).toBeVisible();
});

test("discover flow submits a context and renders results or the identified fallback", async ({ page }) => {
  await page.goto("/recommend#discover-new-performances");
  await expect(
    page.getByRole("heading", { name: "ปรับคำแนะนำด้วยโอกาสและคุณลักษณะ" }),
  ).toBeVisible();

  const select = page.locator("select").first();
  await expect(select).toBeVisible();
  await expect
    .poll(() => select.locator("option").count(), { timeout: 30_000 })
    .toBeGreaterThan(1);
  await select.selectOption({ index: 1 });
  await page.getByRole("button", { name: "คำนวณคำแนะนำเฉพาะคุณ" }).click();

  await page.waitForURL((url) => url.pathname === "/results");
  await expect(page.getByRole("heading", { name: "ผลคำแนะนำเฉพาะคุณ" })).toBeVisible();

  // The model service may be absent in the e2e environment; the clearly
  // identified fallback still answers 200, so the summary header always
  // renders. A visible ErrorState would mean the request failed outright.
  await expect(page.locator("section.panel").filter({ hasText: "บริบท:" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("เกิดข้อผิดพลาด")).toHaveCount(0);
});
