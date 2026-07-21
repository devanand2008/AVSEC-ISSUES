import { expect, request as playwrightRequest, test, type APIRequestContext, type APIResponse } from "@playwright/test";

const apiBase = process.env.E2E_API_URL ?? "http://localhost:4000/api/v1";
const webOrigin = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const password = process.env.E2E_SEED_PASSWORD ?? "deva1253";

async function body<T>(response: APIResponse): Promise<T> {
  const text = await response.text();
  expect(response.ok(), text).toBeTruthy();
  return JSON.parse(text) as T;
}

async function login(identifier: string): Promise<APIRequestContext> {
  const context = await playwrightRequest.newContext();
  await body(await context.post(`${apiBase}/auth/login`, { data: { identifier, password, collegeCode: "6201" } }));
  return context;
}

async function csrfHeaders(context: APIRequestContext): Promise<Record<string, string>> {
  const state = await context.storageState();
  const token = state.cookies.find((cookie) => cookie.name === "college_csrf")?.value;
  expect(token).toBeTruthy();
  return { origin: webOrigin, "x-csrf-token": token! };
}

test("student signs in and sees the scoped portal", async ({ page }) => {
  const initialAuth = page.waitForResponse((response) => response.url().endsWith("/api/v1/auth/me"));
  await page.goto("/login");
  await initialAuth;
  await page.getByLabel(/college id or email|email or college id/i).fill("student@college.local");
  await page.getByLabel(/College code/).fill("6201");
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /login|secure sign in/i }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: /Good day, Aarav/ })).toBeVisible({ timeout: 30_000 });
  await page.goto("/admin/users");
  await expect(page.locator(".error-box")).toContainText("do not have access", { timeout: 30_000 });
});

test("issue lifecycle routes, uploads, closes, and enforces authorization", async ({}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "API lifecycle is exercised once; mobile is covered by the portal test.");
  const student = await login("student@college.local");
  const studentHeaders = await csrfHeaders(student);

  const campuses = await body<Array<{ id: string; name: string }>>(await student.get(`${apiBase}/locations/campuses`));
  const campus = campuses.find((item) => item.name === "Main Campus")!;
  const blocks = await body<Array<{ id: string; name: string }>>(await student.get(`${apiBase}/locations/blocks`, { params: { campusId: campus.id } }));
  const block = blocks.find((item) => item.name === "Academic Block A")!;
  const floors = await body<Array<{ id: string; name: string }>>(await student.get(`${apiBase}/locations/floors`, { params: { blockId: block.id } }));
  const floor = floors.find((item) => item.name === "First Floor")!;
  const rooms = await body<Array<{ id: string; name: string }>>(await student.get(`${apiBase}/locations/rooms`, { params: { floorId: floor.id } }));
  const room = rooms.find((item) => item.name === "A Classroom 2")!;
  const categories = await body<Array<{ id: string; name: string }>>(await student.get(`${apiBase}/issue-categories`));
  const category = categories.find((item) => item.name === "Electrical")!;
  const issueTypes = await body<Array<{ id: string; name: string }>>(await student.get(`${apiBase}/issue-types`, { params: { categoryId: category.id } }));
  const issueType = issueTypes.find((item) => item.name === "Fan not working")!;

  const idempotencyKey = crypto.randomUUID();
  const createPayload = {
    roomId: room.id,
    categoryId: category.id,
    issueTypeId: issueType.id,
    title: `Playwright fan lifecycle ${Date.now()}`,
    description: "The ceiling fan has stopped during class and needs an electrical inspection.",
    prioritySuggestion: "HIGH",
    exactPosition: "front-left",
    createDespiteDuplicate: true,
  };
  const createHeaders = { ...studentHeaders, "idempotency-key": idempotencyKey };
  const issue = await body<{ id: string; issueNumber: string }>(await student.post(`${apiBase}/issues`, { data: createPayload, headers: createHeaders }));
  const replay = await body<{ id: string }>(await student.post(`${apiBase}/issues`, { data: createPayload, headers: createHeaders }));
  expect(replay.id).toBe(issue.id);

  const evidence = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x65, 0x32, 0x65]);
  const signed = await body<{ storageKey: string; uploadUrl: string; requiredHeaders: Record<string, string> }>(await student.post(`${apiBase}/issues/${issue.id}/attachments/presign`, {
    headers: studentHeaders,
    data: { fileName: "evidence.png", mimeType: "image/png", sizeBytes: evidence.length, purpose: "ISSUE_REPORT" },
  }));
  await bodyless(await student.put(signed.uploadUrl, { data: evidence, headers: signed.requiredHeaders }));
  await body(await student.post(`${apiBase}/issues/${issue.id}/attachments/complete`, {
    headers: studentHeaders,
    data: { fileName: "evidence.png", mimeType: "image/png", sizeBytes: evidence.length, purpose: "ISSUE_REPORT", storageKey: signed.storageKey },
  }));

  const detail = await body<{ assignedTo: { fullName: string }; team: { name: string }; attachments: unknown[] }>(await student.get(`${apiBase}/issues/${issue.id}`));
  expect(detail.assignedTo.fullName).toBe("Manoj Electrical");
  expect(detail.team.name).toBe("Electrical Maintenance");
  expect(detail.attachments).toHaveLength(1);
  expect((await student.get(`${apiBase}/users`)).status()).toBe(403);
  expect((await student.post(`${apiBase}/attendance/sessions`, { headers: studentHeaders, data: {} })).status()).toBe(403);

  const electrician = await login("electrician@college.local");
  const electricianHeaders = await csrfHeaders(electrician);
  expect((await body<{ status: string }>(await electrician.post(`${apiBase}/issues/${issue.id}/acknowledge`, { headers: electricianHeaders }))).status).toBe("ACKNOWLEDGED");
  expect((await body<{ status: string }>(await electrician.post(`${apiBase}/issues/${issue.id}/start`, { headers: electricianHeaders }))).status).toBe("IN_PROGRESS");
  expect((await body<{ status: string }>(await electrician.post(`${apiBase}/issues/${issue.id}/resolve`, { headers: electricianHeaders, data: { body: "Replaced the regulator and tested the fan under load." } }))).status).toBe("RESOLVED");

  const closed = await body<{ status: string }>(await student.post(`${apiBase}/issues/${issue.id}/verify`, { headers: studentHeaders, data: { accepted: true, comment: "The fan is operating normally." } }));
  expect(closed.status).toBe("CLOSED");
  const final = await body<{ status: string; statusHistory: unknown[] }>(await student.get(`${apiBase}/issues/${issue.id}`));
  expect(final.status).toBe("CLOSED");
  expect(final.statusHistory).toHaveLength(6);
  await Promise.all([student.dispose(), electrician.dispose()]);
});

async function bodyless(response: APIResponse): Promise<void> {
  expect(response.ok(), await response.text()).toBeTruthy();
}
