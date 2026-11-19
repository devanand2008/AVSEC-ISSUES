import { expect, test } from "@playwright/test";
import { getE2EConfig } from "./config";

test("portal navigation keeps logout accessible and ends the session", async ({ page }, testInfo) => {
  const { adminEmail, adminPassword, collegeCode, apiBase } = getE2EConfig();
  await page.goto("/login");
  await page.getByLabel(/college id or email|email or college id/i).fill(adminEmail);
  await page.getByLabel(/college code/i).fill(collegeCode);
  await page.locator("#password").fill(adminPassword);
  await page.getByRole("button", { name: /login|secure sign in/i }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });

  const header = page.getByRole("banner");
  const logout = header.getByRole("button", { name: "Log out", exact: true });
  const account = header.getByRole("button", { name: /account menu/i });

  if (testInfo.project.name === "mobile") {
    for (const width of [320, 390, 768, 1000]) {
      await page.setViewportSize({ width, height: 860 });
      await expect(logout).toBeInViewport();
      await expect(account).toBeInViewport();
      expect((await logout.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
    await page.setViewportSize({ width: 320, height: 660 });
    const openNavigation = header.getByRole("button", { name: "Open navigation" });
    await openNavigation.click();
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(openNavigation).toBeFocused();
    await expect(logout).toBeVisible();
  } else {
    await expect(logout).toBeHidden();
    await account.click();
    await expect(logout).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(account).toBeFocused();
    await account.click();
  }

  const response = page.waitForResponse((result) =>
    new URL(result.url()).pathname === "/api/v1/auth/logout" &&
    result.request().method() === "POST"
  );
  await logout.click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await response).status()).toBe(204);
  expect((await page.request.get(`${apiBase}/auth/me`)).status()).toBe(401);
  await page.goto("/profile");
  await expect(page).toHaveURL(/\/login$/);
});
