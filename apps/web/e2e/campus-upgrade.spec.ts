import { expect, test, type Page } from "@playwright/test";
import { getE2EConfig } from "./config";

const { adminEmail, adminPassword, collegeCode } = getE2EConfig();

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page
    .getByLabel(/college id or email|email or college id/i)
    .fill(adminEmail);
  await page.getByLabel(/College code/i).fill(collegeCode);
  await page.locator("#password").fill(adminPassword);
  await page.getByRole("button", { name: /login|secure sign in/i }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
}

function waitForMessageSend(page: Page) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === "POST" &&
      /^\/api\/v1\/conversations\/[^/]+\/messages$/.test(url.pathname)
    );
  });
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

  await page.goto("/admin/people");
  const addPerson = page.getByRole("link", { name: "Add Person" }).first();
  await expect(addPerson).toHaveAttribute("href", "/admin/people/new");
  await expect(page.getByRole("link", { name: "Import" }).first()).toHaveAttribute(
    "href",
    "/admin/imports",
  );
  await addPerson.click();
  await expect(page).toHaveURL(/\/admin\/people\/new$/);
  await expect(page.getByRole("heading", { name: "Add Person" }).first()).toBeVisible();
  await expect(page.getByLabel("College ID")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();

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
  const failedMessageResponses: string[] = [];
  page.on("requestfailed", (request) => {
    failedRequests.push(`${request.method()} ${request.url()} (${request.failure()?.errorText ?? "unknown"})`);
  });
  page.on("response", (response) => {
    const request = response.request();
    if (
      response.status() >= 400 &&
      request.method() !== "GET" &&
      response.url().includes("/conversations/")
    ) {
      failedMessageResponses.push(
        `${request.method()} ${response.url()} (HTTP ${response.status()})`,
      );
    }
  });
  test.skip(testInfo.project.name !== "mobile", "Mobile-only navigation behavior.");
  await loginAsAdmin(page);
  await page.goto("/messages");
  await expect(page.getByRole("heading", { name: "AVS Connect" })).toBeVisible();
  const sync = page.getByRole("button", { name: "Sync official groups" });
  if (await sync.isVisible()) await sync.click();
  const firstConversation = page.getByRole("option").first();
  await expect(firstConversation).toBeVisible({ timeout: 30_000 });
  await firstConversation.click();
  await expect(page.locator(".avs-chat-pane.chat-pane-active")).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to conversations" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();

  const text = `Mobile messenger check ${Date.now()}`;
  await page.getByRole("textbox", { name: "Type a message" }).fill(text);
  const sendButton = page.getByRole("button", { name: "Send message" });
  const textSendResponse = waitForMessageSend(page);
  await sendButton.click();
  expect((await textSendResponse).status()).toBe(201);
  await expect(page.locator(".avs-bubble-text", { hasText: text })).toBeVisible({ timeout: 30_000 });
  await expect(sendButton.locator(".spin")).toHaveCount(0, { timeout: 30_000 });

  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Attach files" }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles("public/icons/avs-icon-192.png");
  await expect(page.getByText("avs-icon-192.png")).toBeVisible();
  const attachmentSendResponse = waitForMessageSend(page);
  await sendButton.click();
  expect((await attachmentSendResponse).status()).toBe(201);
  await expect(
    page.getByRole("img", { name: "avs-icon-192.png" }).last(),
    `Attachment network failures: ${failedRequests.join(" | ") || "none"}`,
  ).toBeVisible({ timeout: 30_000 });
  expect(
    failedMessageResponses,
    `Message API failures: ${failedMessageResponses.join(" | ") || "none"}`,
  ).toEqual([]);

  await page.screenshot({ path: testInfo.outputPath("mobile-messenger.png"), fullPage: true });
});
