import { expect, test, type Page } from "@playwright/test";

const password = process.env.E2E_SEED_PASSWORD ?? "deva1253";

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/college id or email|email or college id/i).fill("deva1253@college.com");
  await page.getByLabel(/College code/i).fill("6201");
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /login|secure sign in/i }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
}

test("admin upgrade pages render without horizontal overflow", async ({ page }, testInfo) => {
  await loginAsAdmin(page);
  await page.goto("/admin/academic");
  await expect(page.getByRole("heading", { name: "Academic structure" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Departments/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();

  await page.goto("/admin/maintenance-staff");
  await expect(page.getByRole("heading", { name: "Maintenance staff" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add staff" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();

  await page.goto("/admin/users");
  const historyButton = page.getByRole("button", { name: "History" }).first();
  await expect(historyButton).toBeVisible();
  await historyButton.click();
  await expect(page.getByRole("heading", { name: /Role history for/ })).toBeVisible();
  await page.getByRole("button", { name: "Close role history" }).click();

  await page.goto("/admin/announcements/create");
  await page.getByLabel("Recipient group").selectOption("DEPARTMENT");
  const departmentTarget = page.getByLabel("Department", { exact: true });
  await expect(departmentTarget).toBeVisible();
  await expect
    .poll(() => departmentTarget.locator("option").count())
    .toBeGreaterThan(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();

  await page.screenshot({ path: testInfo.outputPath("maintenance-page.png"), fullPage: true });
});

test("mobile messenger uses list-to-chat navigation", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const failedRequests: string[] = [];
  page.on("requestfailed", (request) => {
    failedRequests.push(`${request.method()} ${request.url()} (${request.failure()?.errorText ?? "unknown"})`);
  });
  test.skip(testInfo.project.name !== "mobile", "Mobile-only navigation behavior.");
  await loginAsAdmin(page);
  await page.goto("/messages");
  await expect(page.getByRole("heading", { name: "Messages" })).toBeVisible();
  const sync = page.getByRole("button", { name: "Sync groups" });
  if (await sync.isVisible()) await sync.click();
  const firstConversation = page.locator(".conversation-list > button").first();
  await expect(firstConversation).toBeVisible({ timeout: 30_000 });
  await firstConversation.click();
  await expect(page.locator(".messenger.chat-open .chat-pane")).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to conversations" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();

  const text = `Mobile messenger check ${Date.now()}`;
  await page.getByRole("textbox", { name: "Message", exact: true }).fill(text);
  const sendButton = page.getByRole("button", { name: "Send message" });
  await sendButton.click();
  await expect(page.locator(".message-content p", { hasText: text })).toBeVisible({ timeout: 30_000 });
  await expect(sendButton.locator(".spin")).toHaveCount(0, { timeout: 30_000 });

  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Attach files" }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles("public/icons/avs-icon-192.png");
  await expect(page.getByText("avs-icon-192.png")).toBeVisible();
  await sendButton.click();
  await expect(
    page.getByRole("img", { name: "avs-icon-192.png" }).last(),
    `Attachment network failures: ${failedRequests.join(" | ") || "none"}`,
  ).toBeVisible({ timeout: 30_000 });

  await page.screenshot({ path: testInfo.outputPath("mobile-messenger.png"), fullPage: true });
});
