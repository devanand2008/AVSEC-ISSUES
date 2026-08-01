import { request } from "@playwright/test";
import { getE2EConfig } from "./config";

type UserList = {
  data: Array<{ publicId: string; email: string | null; status: string }>;
};

export default async function globalSetup() {
  const {
    apiBase,
    webBase,
    collegeCode,
    adminEmail,
    adminPassword,
    studentEmail,
  } = getE2EConfig();
  if (
    !studentEmail.endsWith("@college.local") &&
    !studentEmail.endsWith("@college.test")
  ) {
    throw new Error("E2E account reset is restricted to clearly fake email domains.");
  }

  const context = await request.newContext({
    extraHTTPHeaders: { origin: webBase },
  });
  try {
    const login = await context.post(`${apiBase}/auth/login`, {
      data: { identifier: adminEmail, password: adminPassword, collegeCode },
    });
    if (!login.ok()) {
      throw new Error(`E2E admin login failed (${login.status()}): ${await login.text()}`);
    }

    const listResponse = await context.get(`${apiBase}/users`, {
      params: { search: studentEmail, page: "1", pageSize: "10" },
    });
    if (!listResponse.ok()) {
      throw new Error(
        `E2E fake-user lookup failed (${listResponse.status()}): ${await listResponse.text()}`,
      );
    }
    const list = (await listResponse.json()) as UserList;
    const student = list.data.find(
      (entry) => entry.email?.toLowerCase() === studentEmail.toLowerCase(),
    );
    if (!student) throw new Error(`Fake E2E user ${studentEmail} was not found.`);
    if (student.status === "ACTIVE") return;

    const state = await context.storageState();
    const csrf = state.cookies.find(
      (cookie) => cookie.name === "college_csrf",
    )?.value;
    if (!csrf) throw new Error("E2E admin session did not provide a CSRF token.");
    const activate = await context.patch(
      `${apiBase}/users/${student.publicId}/status`,
      {
        headers: { "x-csrf-token": decodeURIComponent(csrf) },
        data: {
          status: "ACTIVE",
          reason: "Reset clearly identified fake account for automated E2E testing.",
        },
      },
    );
    if (!activate.ok()) {
      throw new Error(
        `E2E fake-user activation failed (${activate.status()}): ${await activate.text()}`,
      );
    }
  } finally {
    await context.dispose();
  }
}
