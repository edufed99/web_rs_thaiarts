import { expect, test } from "@playwright/test";

test("privacy policy page explains personal data and Google sign-in use", async ({ page }) => {
  await page.goto("/privacy");

  await expect(page.getByRole("heading", { name: "นโยบายความเป็นส่วนตัว" })).toBeVisible();
  await expect(page.getByText("การเข้าสู่ระบบด้วย Google")).toBeVisible();
  await expect(page.getByRole("region", { name: "การติดต่อ" }).getByRole("link", { name: "dpatt148@gmail.com" })).toBeVisible();
});

test("terms page explains user responsibilities and contact", async ({ page }) => {
  await page.goto("/terms");

  await expect(page.getByRole("heading", { name: "ข้อกำหนดและเงื่อนไขการใช้งาน" })).toBeVisible();
  await expect(page.getByText("ความรับผิดชอบของผู้ใช้")).toBeVisible();
  await expect(page.getByRole("region", { name: "ช่องทางติดต่อ" }).getByRole("link", { name: "dpatt148@gmail.com" })).toBeVisible();
});
