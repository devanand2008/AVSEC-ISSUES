import { expect, test } from "@playwright/test";

const email = process.env.E2E_LEARN_EMAIL || "deva1253@college.com";
const password = process.env.E2E_LEARN_PASSWORD || "deva1253";
const collegeCode = process.env.E2E_LEARN_COLLEGE_CODE || "6201";
const apiBaseUrl = process.env.E2E_API_URL || "http://localhost:4100/api/v1";
const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:3100";
const apiOrigin = new URL(apiBaseUrl).origin;

function cookieValue(header: string) {
  const pair = header.split(";")[0] ?? "";
  const index = pair.indexOf("=");
  expect(index).toBeGreaterThan(0);
  return { name: pair.slice(0, index), value: pair.slice(index + 1) };
}

test("AVS Learn supports catalog, final exam, compiler and certificate download", async ({
  context,
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  const login = await request.post(`${apiBaseUrl}/auth/login`, {
    data: { identifier: email, password, collegeCode },
    headers: { Origin: webBaseUrl },
  });
  expect(login.ok()).toBeTruthy();
  const cookies = login
    .headersArray()
    .filter((header) => header.name.toLowerCase() === "set-cookie")
    .map((header) => ({ ...cookieValue(header.value), url: apiOrigin }));
  expect(cookies.length).toBeGreaterThan(0);
  await context.addCookies(cookies);
  const csrfCookie = cookies.find((cookie) => cookie.name === "college_csrf");
  expect(csrfCookie).toBeTruthy();
  const mutationHeaders = {
    Origin: webBaseUrl,
    "x-csrf-token": decodeURIComponent(csrfCookie!.value),
  };

  const courseResponse = await request.get(`${apiBaseUrl}/learn/courses`);
  expect(courseResponse.ok()).toBeTruthy();
  const courses = (await courseResponse.json()) as Array<{ id: string; title: string }>;
  expect(courses).toHaveLength(17);
  const cCourse = courses.find((course) => course.title === "C Programming");
  expect(cCourse).toBeTruthy();

  const detailResponse = await request.get(`${apiBaseUrl}/learn/courses/${cCourse!.id}`);
  expect(detailResponse.ok()).toBeTruthy();
  const detail = (await detailResponse.json()) as {
    modules: Array<{ lessons: Array<{ id: string; title: string }> }>;
    assessments: Array<{
      id: string;
      type: string;
      questionsJson: {
        questions: Array<{ id: string; correct?: number; expectedKeyword?: string }>;
      };
    }>;
  };
  const lessons = detail.modules.flatMap((module) => module.lessons);
  expect(lessons.length).toBeGreaterThanOrEqual(10);
  expect(lessons.some((lesson) => lesson.title === "Introduction to C & First Program")).toBeTruthy();
  const exposedQuestion = detail.assessments.flatMap(
    (assessment) => assessment.questionsJson.questions,
  )[0];
  expect(exposedQuestion?.correct).toBeUndefined();
  expect(exposedQuestion?.expectedKeyword).toBeUndefined();

  for (const lesson of lessons) {
    const progress = await request.post(`${apiBaseUrl}/learn/progress`, {
      data: { courseId: cCourse!.id, lessonId: lesson.id, completed: true },
      headers: mutationHeaders,
    });
    expect(progress.ok()).toBeTruthy();
  }

  const finalExam = detail.assessments.find((assessment) => assessment.type === "EXAM");
  expect(finalExam).toBeTruthy();
  const startExam = await request.post(
    `${apiBaseUrl}/learn/assessments/${finalExam!.id}/start`,
    { headers: mutationHeaders },
  );
  expect(startExam.ok()).toBeTruthy();
  const submitExam = await request.post(
    `${apiBaseUrl}/learn/assessments/${finalExam!.id}/submit`,
    {
      data: {
        answersJson: {
          e1: 0,
          e2: 1,
          e3: 1,
          e4: 1,
          e5: 1,
          e6: 1,
          e7: 1,
          e8: 1,
          e9: 1,
          e10: 1,
          e11: '#include <stdio.h>\nint main(){ printf("Hello World\\nAVS Student\\n"); return 0; }',
          e12: "#include <stdio.h>\nint main(){ int s=0; for(int i=1;i<=10;i++){s+=i;} printf(\"%d\",s); return 0; }",
        },
      },
      headers: mutationHeaders,
    },
  );
  expect(submitExam.ok()).toBeTruthy();
  const examResult = (await submitExam.json()) as {
    score: number;
    passed: boolean;
    certificate: { id: string };
  };
  expect(examResult).toMatchObject({ score: 100, passed: true });
  expect(examResult.certificate.id).toBeTruthy();

  const certificateDownload = await request.get(
    `${apiBaseUrl}/learn/certificates/${examResult.certificate.id}/download`,
  );
  expect(certificateDownload.ok()).toBeTruthy();
  expect(certificateDownload.headers()["content-type"]).toContain("application/pdf");
  expect((await certificateDownload.body()).subarray(0, 5).toString()).toBe("%PDF-");

  await page.goto("/learn");
  await expect(page.getByRole("heading", { name: "AVS Skill Portal" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "C Programming" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Python Programming" })).toBeVisible();

  const cCard = page.locator("article").filter({ hasText: "C Programming" }).first();
  await cCard.getByRole("button", { name: /course$/i }).click();
  await expect(
    page.getByRole("button", { name: /Introduction to C & First Program/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Introduction to C & First Program/ }).click();
  await expect(
    page.getByRole("heading", { name: "Introduction to C & First Program" }),
  ).toBeVisible();
  await expect(page.getByText("Final exam").last()).toBeVisible();

  await page.getByRole("button", { name: "Compiler" }).click();
  await expect(page.getByRole("heading", { name: "Online compiler" })).toBeVisible();
  await page.getByRole("button", { name: "Run code" }).click();
  await expect(page.locator("pre").filter({ hasText: "Hello, AVS Learn!" })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole("button", { name: "Results" }).click();
  await expect(page.getByText("C Programming Certification Exam").first()).toBeVisible();
  await expect(page.getByText("AVSL-", { exact: false }).first()).toBeVisible();

  await page.goto("/academic-learn");
  await expect(
    page.getByRole("heading", {
      name: /AVS Learn Portal|No assigned subjects/,
    }),
  ).toBeVisible();

  await page.goto("/admin/imports");
  await expect(page.getByRole("heading", { name: "Bulk imports" })).toBeVisible();
  await expect(page.getByText("Upload file", { exact: true })).toBeVisible();
  expect(consoleErrors.filter((entry) => !entry.includes("favicon"))).toEqual([]);
});
