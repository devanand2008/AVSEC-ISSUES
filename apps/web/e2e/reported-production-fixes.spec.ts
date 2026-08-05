import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from "@playwright/test";
import { getE2EConfig } from "./config";

const {
  apiBase,
  webBase: webOrigin,
  collegeCode,
  adminEmail,
  adminPassword,
  studentEmail,
  studentPassword,
} = getE2EConfig();

interface TestHierarchy {
  campusName: string;
  blockName: string;
  alternateBlockName: string;
  floorName: string;
  roomName: string;
  areaName: string;
  roomAssetName: string;
}

async function responseBody<T>(response: APIResponse): Promise<T> {
  const text = await response.text();
  expect(response.ok(), text).toBeTruthy();
  return JSON.parse(text) as T;
}

async function loginApi(identifier: string, password: string): Promise<APIRequestContext> {
  const context = await playwrightRequest.newContext({
    extraHTTPHeaders: { origin: webOrigin },
  });
  await responseBody(await context.post(`${apiBase}/auth/login`, {
    data: { identifier, password, collegeCode },
  }));
  return context;
}

async function csrfHeaders(context: APIRequestContext): Promise<Record<string, string>> {
  const state = await context.storageState();
  const token = state.cookies.find((cookie) => cookie.name === "college_csrf")?.value;
  expect(token).toBeTruthy();
  return { origin: webOrigin, "x-csrf-token": token! };
}

async function createTestHierarchy(): Promise<TestHierarchy> {
  const admin = await loginApi(adminEmail, adminPassword);
  try {
    const headers = await csrfHeaders(admin);
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
    const campusName = `E2E Campus ${suffix}`;
    const blockName = `E2E Block A ${suffix}`;
    const alternateBlockName = `E2E Block B ${suffix}`;
    const floorName = `E2E First Floor ${suffix}`;
    const roomName = `E2E Lab ${suffix}`;
    const areaName = `E2E Corridor ${suffix}`;
    const roomAssetName = `E2E Projector ${suffix}`;

    const campus = await responseBody<{ id: string }>(await admin.post(`${apiBase}/admin/campuses`, {
      headers,
      data: { code: `EC${suffix}`.slice(0, 30), name: campusName, isActive: true },
    }));
    const block = await responseBody<{ id: string }>(await admin.post(`${apiBase}/admin/blocks`, {
      headers,
      data: { campusId: campus.id, code: `EA${suffix}`.slice(0, 30), name: blockName, isActive: true },
    }));
    await responseBody(await admin.post(`${apiBase}/admin/blocks`, {
      headers,
      data: { campusId: campus.id, code: `EB${suffix}`.slice(0, 30), name: alternateBlockName, isActive: true },
    }));
    const floor = await responseBody<{ id: string }>(await admin.post(`${apiBase}/admin/floors`, {
      headers,
      data: { blockId: block.id, code: `EF${suffix}`.slice(0, 30), name: floorName, level: 1, isActive: true },
    }));
    const room = await responseBody<{ id: string }>(await admin.post(`${apiBase}/admin/rooms`, {
      headers,
      data: { floorId: floor.id, code: `ER${suffix}`.slice(0, 40), name: roomName, roomType: "LABORATORY", isActive: true },
    }));
    const area = await responseBody<{ id: string }>(await admin.post(`${apiBase}/locations/areas`, {
      headers,
      data: { floorId: floor.id, code: `EX${suffix}`.slice(0, 40), name: areaName, isActive: true },
    }));
    const categories = await responseBody<Array<{ id: string; name: string }>>(await admin.get(`${apiBase}/admin/asset-categories`));
    expect(categories.length).toBeGreaterThan(0);
    const categoryId = categories[0]!.id;
    await responseBody(await admin.post(`${apiBase}/admin/assets`, {
      headers,
      data: { roomId: room.id, categoryId, code: `ERP${suffix}`.slice(0, 60), name: roomAssetName },
    }));
    await responseBody(await admin.post(`${apiBase}/admin/assets`, {
      headers,
      data: { areaId: area.id, categoryId, code: `EAL${suffix}`.slice(0, 60), name: `E2E Corridor Light ${suffix}` },
    }));
    return { campusName, blockName, alternateBlockName, floorName, roomName, areaName, roomAssetName };
  } finally {
    await admin.dispose();
  }
}

async function loginStudent(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/college id or email|email or college id/i).fill(studentEmail);
  await page.getByLabel(/College code/i).fill(collegeCode);
  await page.locator("#password").fill(studentPassword);
  await page.getByRole("button", { name: /login|secure sign in/i }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
}

async function chooseBaseLocation(page: Page, hierarchy: TestHierarchy) {
  await page.getByLabel("Campus").selectOption({ label: hierarchy.campusName });
  await page.getByLabel("Block").selectOption({ label: hierarchy.blockName });
  await page.getByLabel("Floor").selectOption({ label: hierarchy.floorName });

  await page.getByLabel("Block").selectOption({ label: hierarchy.alternateBlockName });
  await expect(page.getByLabel("Floor")).toHaveValue("");
  await page.getByLabel("Block").selectOption({ label: hierarchy.blockName });
  await page.getByLabel("Floor").selectOption({ label: hierarchy.floorName });
}

async function completeIssueDetails(page: Page, title: string) {
  await page.getByRole("button", { name: /Electrical/ }).click();
  await expect(page.getByRole("heading", { name: "What is happening?" })).toBeVisible();
  await page.getByRole("radio", { name: /Light not working/ }).check();
  await page.getByLabel("Short title").fill(title);
  await page.getByLabel("Description").fill(`${title} requires inspection by the responsible campus team.`);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Add a photo" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Review your report" })).toBeVisible();
  await page.getByRole("button", { name: "Submit issue" }).click();
  await expect(page.getByText("Issue submitted", { exact: true })).toBeVisible({ timeout: 30_000 });
}

test("Issue Reporting supports rooms, areas, registered/custom/no assets and guarded continuation", async ({ page }) => {
  test.setTimeout(180_000);
  const hierarchy = await createTestHierarchy();
  await loginStudent(page);
  await page.goto("/report-issue");

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Select a campus.", { exact: true })).toBeVisible();
  await chooseBaseLocation(page, hierarchy);
  await page.getByRole("radio", { name: /^Room/ }).check();
  await page.getByLabel("Room").selectOption({ label: hierarchy.roomName });
  await page.locator("#assetMode select").selectOption("REGISTERED");
  const registeredAsset = page.getByLabel("Registered asset");
  const registeredOption = registeredAsset.locator("option").filter({ hasText: hierarchy.roomAssetName });
  await expect(registeredOption).toHaveCount(1);
  await registeredAsset.selectOption((await registeredOption.getAttribute("value"))!);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Choose a category" })).toBeVisible();
  await completeIssueDetails(page, `Registered room asset ${Date.now()}`);

  await page.getByRole("button", { name: "Report another" }).click();
  await chooseBaseLocation(page, hierarchy);
  await page.getByRole("radio", { name: /^Area/ }).check();
  await page.getByLabel("Or custom area").fill(`West staircase ${Date.now()}`);
  await page.locator("#assetMode select").selectOption("CUSTOM");
  await page.getByLabel("Custom asset name").fill("Temporary pump motor");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Choose a category" })).toBeVisible();
  await completeIssueDetails(page, `Custom area asset ${Date.now()}`);

  await page.getByRole("button", { name: "Report another" }).click();
  await chooseBaseLocation(page, hierarchy);
  await page.getByRole("radio", { name: /^Area/ }).check();
  await page.getByLabel("Existing area").selectOption({ label: hierarchy.areaName });
  await expect(page.locator("#assetMode select")).toHaveValue("NONE");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Choose a category" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
});

test("class-session attendance persists a half-day correction and exposes it to the student", async ({}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The API workflow is exercised once; the affected PWA flow is covered by the mobile project above.");
  test.setTimeout(120_000);
  const faculty = await loginApi("faculty@college.local", studentPassword);
  const admin = await loginApi(adminEmail, adminPassword);
  const student = await loginApi(studentEmail, studentPassword);
  try {
    const facultyHeaders = await csrfHeaders(faculty);
    const adminHeaders = await csrfHeaders(admin);
    const sessions = await responseBody<{
      data: Array<{ academicYearId: string; sectionId: string; subjectId: string; sessionDate: string; periodNumber: number }>;
    }>(await faculty.get(`${apiBase}/attendance/sessions`, { params: { page: "1", pageSize: "100" } }));
    expect(sessions.data.length).toBeGreaterThan(0);
    const template = sessions.data[0]!;
    const used = new Set(sessions.data.map((item) => `${item.sessionDate.slice(0, 10)}:${item.periodNumber}`));
    let slot: { sessionDate: string; periodNumber: number } | undefined;
    for (let day = 1; day <= 28 && !slot; day += 1) {
      for (let periodNumber = 1; periodNumber <= 20; periodNumber += 1) {
        const sessionDate = `2099-12-${String(day).padStart(2, "0")}`;
        if (!used.has(`${sessionDate}:${periodNumber}`)) {
          slot = { sessionDate, periodNumber };
          break;
        }
      }
    }
    expect(slot).toBeTruthy();

    const created = await responseBody<{ id: string; sessionType: string }>(await faculty.post(`${apiBase}/attendance/sessions`, {
      headers: facultyHeaders,
      data: {
        academicYearId: template.academicYearId,
        sectionId: template.sectionId,
        subjectId: template.subjectId,
        sessionDate: slot!.sessionDate,
        periodNumber: slot!.periodNumber,
        sessionType: "LAB",
        startTime: "10:00",
        endTime: "11:40",
      },
    }));
    expect(created.sessionType).toBe("LAB");
    const roster = await responseBody<{
      session: { version: number };
      students: Array<{ userId: string; fullName: string }>;
    }>(await faculty.get(`${apiBase}/attendance/sessions/${created.id}/roster`));
    expect(roster.students.length).toBeGreaterThan(0);
    const records = roster.students.map((entry) => ({ studentUserId: entry.userId, status: "PRESENT" }));
    const draft = await responseBody<{ version: number }>(await faculty.put(`${apiBase}/attendance/sessions/${created.id}/draft`, {
      headers: facultyHeaders,
      data: { expectedVersion: roster.session.version, records },
    }));
    const submitted = await responseBody<{ version: number; status: string }>(await faculty.post(`${apiBase}/attendance/sessions/${created.id}/submit`, {
      headers: { ...facultyHeaders, "idempotency-key": crypto.randomUUID() },
      data: { expectedVersion: draft.version, records },
    }));
    expect(submitted.status).toBe("SUBMITTED");

    const submittedRoster = await responseBody<{
      students: Array<{ recordId: string; fullName: string; status: string }>;
    }>(await faculty.get(`${apiBase}/attendance/sessions/${created.id}/roster`));
    const target = submittedRoster.students.find((entry) => entry.fullName.startsWith("Aarav")) ?? submittedRoster.students[0]!;
    const correction = await responseBody<{ id: string; status: string }>(await faculty.post(`${apiBase}/attendance/corrections`, {
      headers: facultyHeaders,
      data: {
        recordId: target.recordId,
        requestedStatus: "HALF_DAY_PRESENT",
        reason: "Student attended the morning lab and took approved afternoon leave.",
      },
    }));
    expect(correction.status).toBe("PENDING");
    const approved = await responseBody<{ status: string }>(await admin.post(`${apiBase}/attendance/corrections/${correction.id}/approve`, {
      headers: adminHeaders,
      data: { comment: "Approved by the E2E academic reviewer." },
    }));
    expect(approved.status).toBe("APPROVED");

    const correctedRoster = await responseBody<{
      students: Array<{ recordId: string; status: string; morningStatus: string; afternoonStatus: string; effectiveAttendanceValue: number }>;
    }>(await faculty.get(`${apiBase}/attendance/sessions/${created.id}/roster`));
    expect(correctedRoster.students.find((entry) => entry.recordId === target.recordId)).toEqual(expect.objectContaining({
      status: "HALF_DAY_PRESENT",
      morningStatus: "PRESENT",
      afternoonStatus: "ABSENT",
      effectiveAttendanceValue: 0.5,
    }));
    const visibleCorrections = await responseBody<Array<{ id: string; status: string }>>(await faculty.get(`${apiBase}/attendance/corrections`, { params: { status: "APPROVED" } }));
    expect(visibleCorrections).toEqual(expect.arrayContaining([expect.objectContaining({ id: correction.id, status: "APPROVED" })]));

    if (target.fullName.startsWith("Aarav")) {
      const ownSummary = await responseBody<{ subjects: Array<{ attended: number; total: number }> }>(await student.get(`${apiBase}/attendance/students/me`));
      expect(ownSummary.subjects.some((subject) => subject.attended % 1 === 0.5 && subject.total >= 1)).toBeTruthy();
    }
  } finally {
    await Promise.all([faculty.dispose(), admin.dispose(), student.dispose()]);
  }
});
