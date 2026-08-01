import path from "node:path";

let localEnvironmentLoaded = false;

function loadLocalEnvironment(): void {
  if (localEnvironmentLoaded) return;
  localEnvironmentLoaded = true;
  try {
    process.loadEnvFile(path.resolve(__dirname, "../../../.env"));
  } catch (error) {
    if (
      !error ||
      typeof error !== "object" ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
}

function isLocalUrl(value: string): boolean {
  const hostname = new URL(value).hostname;
  return ["localhost", "127.0.0.1", "::1"].includes(hostname);
}

function requireValue(value: string | undefined, name: string): string {
  if (value) return value;
  throw new Error(
    `Missing ${name}. Set the E2E variable explicitly, or configure the matching DEVELOPMENT_* value in the root .env for a local run.`,
  );
}

export function getE2EConfig() {
  loadLocalEnvironment();
  const apiBase = process.env.E2E_API_URL ?? "http://localhost:4000/api/v1";
  const webBase = process.env.E2E_BASE_URL ?? "http://localhost:3000";
  const local = isLocalUrl(apiBase) && isLocalUrl(webBase);

  if (!local && process.env.E2E_ALLOW_REMOTE_MUTATIONS !== "true") {
    throw new Error(
      "The E2E suite mutates data and is blocked for remote URLs. Use a dedicated test tenant and set E2E_ALLOW_REMOTE_MUTATIONS=true to opt in explicitly.",
    );
  }

  const localAdminEmail = local
    ? process.env.DEVELOPMENT_ADMIN_EMAIL
    : undefined;
  const localPassword = local
    ? process.env.DEVELOPMENT_ADMIN_PASSWORD
    : undefined;
  const localCollegeCode = local
    ? process.env.DEVELOPMENT_COLLEGE_CODE
    : undefined;
  const adminPassword =
    process.env.E2E_ADMIN_PASSWORD ??
    process.env.E2E_SEED_PASSWORD ??
    localPassword;

  return {
    apiBase,
    webBase,
    adminEmail: requireValue(
      process.env.E2E_ADMIN_EMAIL ?? localAdminEmail,
      "E2E_ADMIN_EMAIL",
    ),
    adminPassword: requireValue(adminPassword, "E2E_ADMIN_PASSWORD"),
    collegeCode: requireValue(
      process.env.E2E_COLLEGE_CODE ?? localCollegeCode,
      "E2E_COLLEGE_CODE",
    ),
    studentEmail:
      process.env.E2E_STUDENT_EMAIL ?? "student@college.local",
    studentPassword: requireValue(
      process.env.E2E_SEED_PASSWORD ?? localPassword,
      "E2E_SEED_PASSWORD",
    ),
    learnEmail: requireValue(
      process.env.E2E_LEARN_EMAIL ??
        process.env.E2E_ADMIN_EMAIL ??
        localAdminEmail,
      "E2E_LEARN_EMAIL",
    ),
    learnPassword: requireValue(
      process.env.E2E_LEARN_PASSWORD ?? adminPassword,
      "E2E_LEARN_PASSWORD",
    ),
    learnCollegeCode: requireValue(
      process.env.E2E_LEARN_COLLEGE_CODE ??
        process.env.E2E_COLLEGE_CODE ??
        localCollegeCode,
      "E2E_LEARN_COLLEGE_CODE",
    ),
  };
}
