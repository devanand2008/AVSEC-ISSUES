import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type APIResponse, type Page } from "@playwright/test";
import { getE2EConfig } from "./config";

const config = getE2EConfig();

async function body<T>(response: APIResponse) {
  expect(response.ok(), "HTTP " + response.status() + " from " + new URL(response.url()).pathname).toBeTruthy();
  return (await response.json()) as T;
}

async function authenticate(page: Page, identifier: string, password: string) {
  await body(await page.request.post(config.apiBase + "/auth/login", {
    headers: { origin: config.webBase },
    data: { identifier, password, collegeCode: config.collegeCode },
  }));
  const cookie = (await page.context().cookies()).find((item) => item.name === "college_csrf");
  if (!cookie) throw new Error("Missing local CSRF cookie.");
  return { origin: config.webBase, "x-csrf-token": decodeURIComponent(cookie.value) };
}

test("block inventory generates missing QR codes once and downloads a printable image", async ({ page }) => {
  const headers = await authenticate(page, config.adminEmail, config.adminPassword);
  const inventoryUrl = config.apiBase + "/qr/codes/blocks";
  type Block = { id: string; name: string; codeId: string | null };
  const before = await body<Block[]>(await page.request.get(inventoryUrl));
  expect(before.length).toBeGreaterThan(0);

  const batches = await Promise.all([1, 2].map(async () =>
    body<{ created: number; total: number }>(await page.request.post(inventoryUrl, { headers })),
  ));
  expect(batches.reduce((count, batch) => count + batch.created, 0)).toBe(before.filter((block) => !block.codeId).length);
  const blocks = await body<Block[]>(await page.request.get(inventoryUrl));
  expect(blocks.every((block) => block.codeId)).toBeTruthy();
  const block = blocks[0]!;
  const image = await body<{ secureUrl: string; dataUrl: string }>(
    await page.request.get(config.apiBase + "/qr/codes/" + block.codeId + "/image"),
  );
  expect(image.dataUrl).toMatch(/^data:image\/png;base64,/);
  const scan = await body<{ qrType: string; context: { blockId: string } }>(
    await page.request.post(config.apiBase + "/qr/validate", { headers, data: { token: image.secureUrl } }),
  );
  expect(scan).toMatchObject({ qrType: "BLOCK", context: { blockId: block.id } });

  await page.goto("/admin/qr-management");
  const inventory = page.getByRole("region", { name: "Block QR codes" });
  await expect(inventory.getByRole("button", { name: "Generate missing block codes" })).toBeDisabled();
  const downloaded = page.waitForEvent("download");
  await inventory.getByRole("button", { name: "Download " + block.name + " QR PNG", exact: true }).first().click();
  expect((await downloaded).suggestedFilename()).toMatch(/\.png$/);
});

test("generic QR types validate, rotate, expire and resume after mobile sign-in", async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The test opens a separate emulated phone for the scan and sign-in flow.");
  const headers = await authenticate(page, config.adminEmail, config.adminPassword);
  const codeUrl = config.apiBase + "/qr/codes";
  const scanUrl = config.apiBase + "/qr/validate";
  type Location = { id: string };
  type Qr = { id: string; secureUrl: string };
  const blocks = await body<Location[]>(await page.request.get(codeUrl + "/blocks"));
  const block = blocks[0]!;
  const floors = await body<Location[]>(await page.request.get(config.apiBase + "/locations/floors", { params: { blockId: block.id } }));
  const floor = floors[0]!;
  const sections = await body<Location[]>(await page.request.get(config.apiBase + "/academic/sections"));
  const announcement = await body<Location>(await page.request.post(config.apiBase + "/announcements", {
    headers,
    data: { title: "QR test fixture", message: "Local announcement for QR validation.", audiences: [{ scopeType: "COLLEGE" }] },
  }));
  const targets = [
    { qrType: "APPLICATION" },
    { qrType: "LINK", destination: "/notifications" },
    { qrType: "BLOCK", entityId: block.id },
    { qrType: "FLOOR", entityId: floor.id },
    { qrType: "CLASS", entityId: sections[0]!.id },
    { qrType: "ANNOUNCEMENT", entityId: announcement.id },
  ];
  const created: Qr[] = [];
  async function scan(token: string) {
    return page.request.post(scanUrl, { headers, data: { token, scanMethod: "MANUAL" } });
  }
  const roomSheet = await body<{ rooms: { reportUrl: string; dataUrl: string }[] }>(
    await page.request.get(config.apiBase + "/locations/qr-sheet", { params: { floorId: floor.id } }),
  );
  expect(roomSheet.rooms[0]?.dataUrl).toMatch(/^data:image\/png;base64,/);
  expect(await body(await scan(roomSheet.rooms[0]!.reportUrl))).toMatchObject({ valid: true, qrType: "ROOM" });
  for (const target of targets) {
    const code = await body<Qr>(await page.request.post(codeUrl, {
      headers, data: { label: "Local test " + target.qrType, ...target },
    }));
    expect(await body(await scan(code.secureUrl))).toMatchObject({ valid: true, qrType: target.qrType });
    created.push(code);
  }
  expect((await scan("https://example.invalid/scan-qr")).status()).toBe(400);

  const link = created[1]!;
  const linkStatus = codeUrl + "/" + link.id + "/status";
  await body(await page.request.patch(linkStatus, { headers, data: { status: "DISABLED" } }));
  expect((await scan(link.secureUrl)).status()).toBe(400);
  await body(await page.request.patch(linkStatus, { headers, data: { status: "ACTIVE" } }));
  expect((await scan(link.secureUrl)).ok()).toBeTruthy();
  const rotated = await body<Qr>(await page.request.post(codeUrl + "/" + link.id + "/regenerate", { headers }));
  expect((await scan(link.secureUrl)).status()).toBe(404);
  expect((await scan(rotated.secureUrl)).ok()).toBeTruthy();
  await body(await page.request.patch(linkStatus, { headers, data: { status: "REVOKED" } }));
  expect((await scan(rotated.secureUrl)).status()).toBe(400);
  const expired = await body<Qr>(await page.request.post(codeUrl, {
    headers, data: { label: "Expired link", qrType: "LINK", expiryDate: "2020-01-01T00:00:00Z" },
  }));
  expect((await scan(expired.secureUrl)).status()).toBe(400);

  const visitorContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const visitor = await visitorContext.newPage();
    await visitor.goto(created[2]!.secureUrl);
    await expect(visitor).toHaveURL(/\/login\?scan=QR_/);
    await visitor.getByLabel(/college id or email/i).fill(config.adminEmail);
    await visitor.getByLabel(/college code/i).fill(config.collegeCode);
    await visitor.locator("#password").fill(config.adminPassword);
    await visitor.getByRole("button", { name: /login|secure sign in/i }).click();
    await expect(visitor).toHaveURL(/\/report-issue\?qrToken=QR_.*&source=qr/, { timeout: 30_000 });
  } finally {
    await visitorContext.close();
  }
});

test("resending an archived poster delivers one fresh notification to its saved audience", async ({ page, browser }) => {
  const headers = await authenticate(page, config.adminEmail, config.adminPassword);
  const announcementUrl = config.apiBase + "/announcements";
  const users = await body<{ data: { email: string; publicId: string }[] }>(
    await page.request.get(config.apiBase + "/users", { params: { search: config.studentEmail } }),
  );
  const target = users.data.find((user) => user.email === config.studentEmail);
  if (!target) throw new Error("Missing local test recipient.");
  const title = "Archived poster " + randomUUID().slice(0, 8);
  const source = await body<{ id: string }>(await page.request.post(announcementUrl, {
    headers,
    data: { title, message: "Local poster resend test.", audiences: [{ scopeType: "COLLEGE", userId: target.publicId }] },
  }));
  const detail = announcementUrl + "/" + source.id;
  const image = await readFile("public/icons/avs-icon-192.png");
  const imageInfo = { fileName: "poster.png", mimeType: "image/png", sizeBytes: image.length };
  const presigned = await body<{ storageKey: string; uploadUrl: string }>(
    await page.request.post(detail + "/image/presign", { headers, data: imageInfo }),
  );
  expect((await page.request.put(presigned.uploadUrl, { headers: { "Content-Type": imageInfo.mimeType }, data: image })).ok()).toBeTruthy();
  await body(await page.request.post(detail + "/image/complete", {
    headers,
    data: { ...imageInfo, storageKey: presigned.storageKey, width: 192, height: 192 },
  }));
  await body(await page.request.post(detail + "/publish", { headers }));
  await body(await page.request.post(detail + "/archive", { headers }));

  const recipientContext = await browser.newContext();
  try {
    const recipient = await recipientContext.newPage();
    const recipientHeaders = await authenticate(recipient, config.studentEmail, config.studentPassword);
    expect((await recipient.request.post(detail + "/resend-poster", {
      headers: { ...recipientHeaders, "Idempotency-Key": randomUUID() },
    })).status()).toBe(403);

    await page.goto("/admin/announcements/" + source.id);
    await page.getByRole("button", { name: "Resend poster" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Resend this poster?" });
    await expect(dialog).toBeVisible();
    const delivered = page.waitForResponse((response) => response.url().endsWith("/resend-poster"));
    await dialog.getByRole("button", { name: "Resend poster" }).click();
    const response = await delivered;
    expect(response.ok()).toBeTruthy();
    const fresh = (await response.json()) as { announcementId: string; recipientCount: number };
    expect(fresh.recipientCount).toBe(1);
    expect(fresh.announcementId).not.toBe(source.id);
    await expect(page.getByRole("status").getByText(/Poster resent to 1 active recipient/)).toBeVisible();

    const replay = await body(await page.request.post(detail + "/resend-poster", {
      headers: { ...headers, "Idempotency-Key": response.request().headers()["idempotency-key"]! },
    }));
    expect(replay).toEqual(fresh);
    const pending = await body<{ id: string; imageUrl: string }[]>(await recipient.request.get(announcementUrl + "/me/pending"));
    expect(pending.find((poster) => poster.id === fresh.announcementId)?.imageUrl).toBeTruthy();
    const notifications = await body<{ data: { notification: { relatedEntityId: string } }[] }>(
      await recipient.request.get(config.apiBase + "/notifications"),
    );
    expect(notifications.data.filter(({ notification }) => notification.relatedEntityId === fresh.announcementId)).toHaveLength(1);
  } finally {
    await recipientContext.close();
  }
});
