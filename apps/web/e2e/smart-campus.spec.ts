import { expect, test, type Page, type Route } from "@playwright/test";

type MockUser = {
  id: string;
  fullName: string;
  email: string;
  status: "ACTIVE";
  mustChangePassword: false;
  firstLoginCompletedAt: string;
  roles: string[];
  permissions: string[];
};

type ApiHandler = (
  route: Route,
  path: string,
  url: URL,
) => boolean | Promise<boolean>;

const student: MockUser = {
  id: "10000000-0000-4000-8000-000000000001",
  fullName: "Aarav Student",
  email: "aarav.student@college.test",
  status: "ACTIVE",
  mustChangePassword: false,
  firstLoginCompletedAt: "2026-07-01T08:00:00.000Z",
  roles: ["STUDENT"],
  permissions: ["feedback.scan", "feedback.submit", "feedback.read_own"],
};

const admin: MockUser = {
  id: "10000000-0000-4000-8000-000000000002",
  fullName: "Maya Administrator",
  email: "maya.admin@college.test",
  status: "ACTIVE",
  mustChangePassword: false,
  firstLoginCompletedAt: "2026-07-01T08:00:00.000Z",
  roles: ["MAIN_ADMIN"],
  permissions: [
    "feedback.read_college",
    "feedback.qr.manage",
    "feedback.qr.download",
  ],
};

const department = {
  id: "20000000-0000-4000-8000-000000000001",
  code: "CSE",
  name: "Computer Science",
};

const staffTarget = {
  id: "30000000-0000-4000-8000-000000000001",
  targetType: "STAFF",
  targetName: "Dr Ada Lovelace",
  description: null,
  serviceCode: null,
  staff: {
    publicId: "40000000-0000-4000-8000-000000000001",
    staffId: "FAC-0042",
    name: "Dr Ada Lovelace",
    designation: "Associate Professor",
    department,
    profilePhotoKey: null,
  },
  department,
  campus: null,
  block: null,
  floor: null,
  room: null,
};

const questions = [
  {
    id: "50000000-0000-4000-8000-000000000001",
    category: "Teaching clarity",
    questionText: "How clearly were concepts explained?",
    questionType: "RATING",
    displayOrder: 1,
    isRequired: true,
  },
  {
    id: "50000000-0000-4000-8000-000000000002",
    category: "Student support",
    questionText: "How supportive was the faculty member?",
    questionType: "RATING",
    displayOrder: 2,
    isRequired: true,
  },
];

const submissionTicket =
  "mock-signed-feedback-submission-ticket-which-is-long-enough-for-the-contract";

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function mockApi(page: Page, user: MockUser, handler?: ApiHandler) {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api\/v1/, "");

    if (path === "/auth/me") {
      await fulfillJson(route, user);
      return;
    }

    if (handler && (await handler(route, path, url))) return;

    await fulfillJson(
      route,
      { error: { message: `Unhandled mocked API route: ${path}` } },
      404,
    );
  });
}

async function gotoPortal(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded", timeout: 60_000 });
}

test.describe.configure({ timeout: 90_000 });
test.use({ serviceWorkers: "block" });

test.describe("student feedback on a phone", () => {
  test.use({ viewport: { width: 412, height: 915 }, hasTouch: true });

  test("finds a staff target, rates every question, confirms, and receives a reference", async ({
    page,
  }) => {
    let submittedBody: Record<string, unknown> | undefined;

    await mockApi(page, student, async (route, path) => {
      if (path === "/feedback/targets" && route.request().method() === "GET") {
        await fulfillJson(route, [staffTarget]);
        return true;
      }
      if (
        path === `/feedback/targets/${staffTarget.id}` &&
        route.request().method() === "GET"
      ) {
        await fulfillJson(route, {
          target: staffTarget,
          questions,
          submissionTicket,
          submissionTicketExpiresInSeconds: 600,
        });
        return true;
      }
      if (path === "/feedback/submit" && route.request().method() === "POST") {
        submittedBody = route.request().postDataJSON() as Record<
          string,
          unknown
        >;
        await fulfillJson(route, {
          referenceNumber: "FB-2026-0001",
          status: "SUBMITTED",
          priority: "NORMAL",
          submittedAt: "2026-07-19T09:30:00.000Z",
          message: "Feedback submitted successfully.",
        });
        return true;
      }
      return false;
    });

    await gotoPortal(page, "/feedback/scanner");
    await expect(
      page.getByRole("heading", { name: "Scan QR code" }),
    ).toBeVisible({ timeout: 30_000 });

    await page.getByLabel("Search", { exact: true }).fill("Ada");
    await page.getByRole("link", { name: /Dr Ada Lovelace/ }).click();

    await expect(
      page.getByRole("heading", { name: "Dr Ada Lovelace" }),
    ).toBeVisible({ timeout: 30_000 });

    const fiveStarButtons = page.getByRole("button", { name: "5 star" });
    await expect(fiveStarButtons).toHaveCount(questions.length);
    for (let index = 0; index < questions.length; index += 1) {
      await fiveStarButtons.nth(index).click();
    }
    await page
      .getByLabel("Positive feedback")
      .fill("Clear explanations and helpful examples.");

    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toBe("Submit this feedback now?");
      await dialog.accept();
    });
    await page.getByRole("button", { name: "Submit feedback" }).click();

    await expect(page).toHaveURL(
      /\/student\/feedback\/success\/FB-2026-0001$/,
      { timeout: 30_000 },
    );
    await expect(
      page.getByRole("heading", { name: "FB-2026-0001" }),
    ).toBeVisible();
    await expect(
      page.getByText("Your feedback has been recorded."),
    ).toBeVisible();

    expect(submittedBody).toMatchObject({
      submissionTicket,
      targetId: staffTarget.id,
      ratings: [
        { questionId: questions[0]!.id, rating: 5 },
        { questionId: questions[1]!.id, rating: 5 },
      ],
      positiveComment: "Clear explanations and helpful examples.",
      isAnonymous: true,
    });
    expect(submittedBody).not.toHaveProperty("overallRating");
  });

  test("shows the server reason for a disabled scan token", async ({
    page,
  }) => {
    await mockApi(page, student, async (route, path) => {
      if (path === "/feedback/qr/DISABLED_TOKEN/resolve") {
        await fulfillJson(
          route,
          { error: { message: "This QR code is disabled." } },
          410,
        );
        return true;
      }
      return false;
    });

    await gotoPortal(page, "/feedback/scan/DISABLED_TOKEN");

    await expect(page.getByText("This QR code is disabled.")).toBeVisible({
      timeout: 30_000,
    });
  });

  test("explains how to recover when camera permission is denied", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const mediaDevices = {
        enumerateDevices: async () => [
          {
            deviceId: "mock-camera",
            groupId: "mock-group",
            kind: "videoinput",
            label: "Mock camera",
            toJSON: () => ({}),
          },
        ],
        getSupportedConstraints: () => ({}),
        getUserMedia: async () => {
          throw new DOMException("Permission denied", "NotAllowedError");
        },
      };
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: mediaDevices,
      });
    });
    await mockApi(page, student);

    await gotoPortal(page, "/feedback/scanner");
    await page.getByRole("button", { name: "Start camera" }).click();

    const guidance = page.locator(".camera-guidance");
    await expect(guidance.getByText("Camera access is blocked")).toBeVisible({
      timeout: 30_000,
    });
    await expect(guidance).toContainText(
      "site controls beside the address bar",
    );
    await expect(
      guidance.getByRole("button", { name: "Try again" }),
    ).toBeVisible();
  });
});

test("redirects a student who opens the admin QR route directly", async ({
  page,
}) => {
  await mockApi(page, student);

  await gotoPortal(page, "/admin/feedback/qr-management");

  await expect(page).toHaveURL(/\/unauthorized$/, { timeout: 30_000 });
  await expect(
    page.getByRole("heading", { name: "Access denied" }),
  ).toBeVisible();
});

test("previews, regenerates, disables, and requests official QR downloads", async ({
  page,
}) => {
  const qrRecordId = "60000000-0000-4000-8000-000000000001";
  let qrStatus = "ACTIVE";
  let regenerated = false;
  const requestedFormats: string[] = [];
  const patchedStatuses: string[] = [];

  const qrRow = () => ({
    id: qrRecordId,
    qrId: "70000000-0000-4000-8000-000000000001",
    target: staffTarget,
    status: qrStatus,
    expiryDate: "2027-07-19T00:00:00.000Z",
    scanCount: 12,
    feedbackCount: 5,
    lastScannedAt: "2026-07-18T10:15:00.000Z",
    createdAt: "2026-06-01T08:00:00.000Z",
    createdBy: "Maya Administrator",
    secureUrl: "https://college.test/feedback/scan/mock-secure-token",
  });

  await mockApi(page, admin, async (route, path, url) => {
    if (path === "/admin/feedback/qr" && route.request().method() === "GET") {
      await fulfillJson(route, {
        data: [qrRow()],
        meta: { page: 1, pageSize: 25, total: 1, pageCount: 1 },
      });
      return true;
    }
    if (
      path === `/admin/feedback/qr/${qrRecordId}/regenerate` &&
      route.request().method() === "POST"
    ) {
      regenerated = true;
      await fulfillJson(route, { ...qrRow(), secureTokenRegenerated: true });
      return true;
    }
    if (
      path === `/admin/feedback/qr/${qrRecordId}/status` &&
      route.request().method() === "PATCH"
    ) {
      const body = route.request().postDataJSON() as { status: string };
      patchedStatuses.push(body.status);
      qrStatus = body.status;
      await fulfillJson(route, qrRow());
      return true;
    }
    if (
      path === `/admin/feedback/qr/${qrRecordId}/download` &&
      route.request().method() === "GET"
    ) {
      const format = url.searchParams.get("format") ?? "";
      requestedFormats.push(format);
      const isPdf = format === "pdf";
      await route.fulfill({
        status: 200,
        contentType: isPdf ? "application/pdf" : "image/svg+xml",
        body: isPdf
          ? "%PDF-1.4\n% mocked official QR poster"
          : '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1018"><rect width="100%" height="100%" fill="white"/></svg>',
      });
      return true;
    }
    return false;
  });

  await gotoPortal(page, "/admin/feedback/qr-management");
  await expect(
    page.getByRole("heading", { name: "QR code management" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByText("Dr Ada Lovelace", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Preview" }).click();
  const preview = page.getByRole("dialog", { name: "Dr Ada Lovelace" });
  await expect(preview).toBeVisible();
  expect(requestedFormats).toContain("poster");
  await page.getByRole("button", { name: "Close poster preview" }).click();

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Existing posters will stop working");
    await dialog.accept();
  });
  await page.getByRole("button", { name: "Regenerate" }).click();
  await expect(page.getByRole("status")).toContainText(
    "The secure QR token was regenerated.",
  );
  expect(regenerated).toBe(true);

  await page.getByRole("button", { name: "Disable" }).click();
  await expect(page.getByRole("status")).toContainText(
    "QR code status changed to disabled.",
  );
  await expect(page.getByRole("cell", { name: "DISABLED" })).toBeVisible();
  expect(patchedStatuses).toEqual(["DISABLED"]);

  await page.getByRole("button", { name: "SVG" }).click();
  await expect(page.getByRole("status")).toContainText(
    "SVG download prepared for Dr Ada Lovelace.",
  );
  await page.getByRole("button", { name: "PDF" }).click();
  await expect(page.getByRole("status")).toContainText(
    "PDF download prepared for Dr Ada Lovelace.",
  );
  expect(requestedFormats).toEqual(
    expect.arrayContaining(["poster", "svg", "pdf"]),
  );
});
