import { expect, test, type Page, type Route } from "@playwright/test";

const PHONE_VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 360, height: 800 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
  { width: 430, height: 932 },
] as const;

const ids = {
  be: "10000000-0000-4000-8000-000000000001",
  btech: "10000000-0000-4000-8000-000000000002",
  cse: "20000000-0000-4000-8000-000000000001",
  it: "20000000-0000-4000-8000-000000000002",
  cseProgramme: "30000000-0000-4000-8000-000000000001",
  itProgramme: "30000000-0000-4000-8000-000000000002",
  previous: "40000000-0000-4000-8000-000000000001",
  current: "40000000-0000-4000-8000-000000000002",
  future: "40000000-0000-4000-8000-000000000003",
  semester3: "50000000-0000-4000-8000-000000000003",
  semester4: "50000000-0000-4000-8000-000000000004",
  sectionA: "60000000-0000-4000-8000-000000000001",
  sectionB: "60000000-0000-4000-8000-000000000002",
};

const admin = {
  id: "00000000-0000-4000-8000-000000000001",
  fullName: "Responsive Admin",
  email: "responsive.admin@college.test",
  status: "ACTIVE",
  mustChangePassword: false,
  firstLoginCompletedAt: "2026-07-01T00:00:00.000Z",
  roles: ["MAIN_ADMIN"],
  permissions: [
    "users.create",
    "academic.manage",
    "academic.override_placement",
  ],
};

const years = [
  { id: ids.previous, name: "2025-2026", startsOn: "2025-07-01", endsOn: "2026-06-30", isCurrent: false, isActive: true, archivedAt: null },
  { id: ids.current, name: "2026-2027", startsOn: "2026-07-01", endsOn: "2027-06-30", isCurrent: true, isActive: true, archivedAt: null },
  { id: ids.future, name: "2027-2028", startsOn: "2027-07-01", endsOn: "2028-06-30", isCurrent: false, isActive: true, archivedAt: null },
];

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockRegistrationApi(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api\/v1/, "");
    if (path === "/auth/me") return json(route, admin);
    if (path === "/announcements/me/pending") return json(route, []);
    if (path === "/academic/degree-types") {
      return json(route, [
        { id: ids.be, code: "BE", name: "B.E." },
        { id: ids.btech, code: "BTECH", name: "B.Tech." },
      ]);
    }
    if (path === "/academic/departments") {
      return json(route, url.searchParams.get("degreeTypeId") === ids.be
        ? [{ id: ids.cse, code: "CSE", name: "Computer Science and Engineering" }]
        : [{ id: ids.it, code: "IT", name: "Information Technology" }]);
    }
    if (path === "/academic/programmes") {
      return json(route, url.searchParams.get("degreeTypeId") === ids.be
        ? [{ id: ids.cseProgramme, code: "CSE", name: "Computer Science and Engineering", departmentId: ids.cse, degreeTypeId: ids.be, durationYears: 4, totalSemesters: 8 }]
        : [{ id: ids.itProgramme, code: "IT", name: "Information Technology", departmentId: ids.it, degreeTypeId: ids.btech, durationYears: 4, totalSemesters: 8 }]);
    }
    if (path === "/academic/years") return json(route, years);
    if (path === "/academic/semesters") {
      return json(route, [
        { id: ids.semester3, number: 3, name: "Semester 3", programmeId: ids.cseProgramme, academicYearId: ids.current },
        { id: ids.semester4, number: 4, name: "Semester 4", programmeId: ids.cseProgramme, academicYearId: ids.current },
      ]);
    }
    if (path === "/academic/sections") {
      return json(route, [
        { id: ids.sectionA, code: "A", name: "Section A", semesterId: ids.semester3, studyYear: 2, capacity: 70, currentStudentCount: 70, availableSeats: 0, isFull: true },
        { id: ids.sectionB, code: "B", name: "Section B", semesterId: ids.semester3, studyYear: 2, capacity: 70, currentStudentCount: 42, availableSeats: 28, isFull: false },
      ]);
    }
    return json(route, { error: { message: `Unhandled mocked API route: ${path}` } }, 404);
  });
}

async function assertNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBeTruthy();
}

test.describe("Student Registration phone acceptance", () => {
  test.describe.configure({ timeout: 90_000 });
  test.use({ serviceWorkers: "block", hasTouch: true });

  for (const viewport of PHONE_VIEWPORTS) {
    test(`${viewport.width}x${viewport.height} remains usable through all five steps`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await mockRegistrationApi(page);
      await page.goto("/admin/people/new", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Student Registration" })).toBeVisible();
      await assertNoHorizontalOverflow(page);

      await page.getByLabel("Full Name *").fill("Responsive Test Student");
      await page.getByLabel("Official College Email *").fill("responsive.student@college.test");
      await page.getByLabel("College ID *").fill("TEST-RESPONSIVE");
      await page.getByLabel("Register Number *").fill("TEST-REG-RESPONSIVE");
      await page.getByRole("button", { name: "Continue" }).click();

      await expect(page.getByLabel("Degree Type *")).toHaveText(/B\.E\..*B\.Tech\./s);
      await page.getByLabel("Degree Type *").selectOption(ids.be);
      await expect(page.getByLabel("Department *")).toBeEnabled({ timeout: 30_000 });
      await page.getByLabel("Department *").selectOption(ids.cse);
      await expect(page.getByLabel("Programme *")).toBeEnabled({ timeout: 30_000 });
      await page.getByLabel("Programme *").selectOption(ids.cseProgramme);
      await page.getByRole("button", { name: "Continue" }).click();

      await expect(page.getByLabel("Academic Year *")).toHaveValue(ids.current);
      await expect(page.getByLabel("Academic Year *")).toHaveText(/2025-2026.*2026-2027.*2027-2028/s);
      await expect(page.getByLabel("Study Year *")).toHaveText(/1st Year.*2nd Year.*3rd Year.*4th Year/s);
      await page.getByLabel("Study Year *").selectOption("2");
      await expect(page.getByLabel("Semester *")).toHaveText(/Semester 3.*Semester 4/s);
      await page.getByLabel("Semester *").selectOption(ids.semester3);
      await expect(page.getByLabel("Section *").locator(`option[value="${ids.sectionA}"]`)).toHaveAttribute("disabled", "");
      await page.getByLabel("Section *").selectOption(ids.sectionB);
      await page.getByRole("button", { name: "Continue" }).click();

      await expect(page.getByLabel("Temporary Password")).not.toHaveValue("");
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByRole("heading", { name: "Student Registration Review" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Create Student" })).toBeVisible();
      await expect(page.locator(".student-registration-actions")).toHaveCSS("position", "sticky");
      await assertNoHorizontalOverflow(page);
    });
  }
});
