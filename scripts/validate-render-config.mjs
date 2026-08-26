import fs from "node:fs";
import path from "node:path";

const renderPath = path.join(process.cwd(), "render.yaml");
if (!fs.existsSync(renderPath)) throw new Error("render.yaml is missing.");
const content = fs.readFileSync(renderPath, "utf8");
const required = [
  "name: avs-college-portal",
  "runtime: docker",
  "plan: free",
  "dockerfilePath: ./Dockerfile",
  "dockerContext: .",
  "healthCheckPath: /health",
  "autoDeployTrigger: checksPass",
  "DATABASE_MODE",
  "EXTERNAL_PERSISTENT",
  "DATABASE_URL",
  "MIGRATION_BACKUP_REQUIRED",
  "MIGRATION_BACKUP_WAIT_SECONDS",
  "name: avs-college-redis",
  "type: keyvalue",
  "property: connectionString",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "CSRF_SECRET",
  "generateValue: true",
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
  "DEVELOPMENT_ADMIN_EMAIL",
  "DEVELOPMENT_ADMIN_PASSWORD",
  "sync: false",
];
const missing = required.filter((value) => !content.includes(value));
if (missing.length) {
  throw new Error(`render.yaml is missing: ${missing.join(", ")}`);
}
const serviceCount = (content.match(/^  - type: web$/gmu) ?? []).length;
if (serviceCount !== 1)
  throw new Error("render.yaml must declare exactly one web service.");
const keyValueCount = (content.match(/^  - type: keyvalue$/gmu) ?? []).length;
if (keyValueCount !== 1) {
  throw new Error("render.yaml must declare exactly one key-value service.");
}
if (/^databases:/mu.test(content)) {
  throw new Error(
    "render.yaml must not auto-provision an expiring Render database.",
  );
}
if (!/^    autoDeployTrigger: checksPass$/mu.test(content)) {
  throw new Error("Render deploys must wait for CI checks to pass.");
}
if (
  !/^      - key: MIGRATION_BACKUP_REQUIRED\r?\n        value: "true"$/mu.test(
    content,
  )
) {
  throw new Error("The production migration backup gate must remain enabled.");
}
const migrationWait = content.match(
  /^      - key: MIGRATION_BACKUP_WAIT_SECONDS\r?\n        value: "(\d+)"$/mu,
);
if (
  !migrationWait ||
  Number(migrationWait[1]) < 0 ||
  Number(migrationWait[1]) > 120
) {
  throw new Error(
    "MIGRATION_BACKUP_WAIT_SECONDS must be an integer between 0 and 120.",
  );
}
if (/postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/iu.test(content)) {
  throw new Error("render.yaml contains a database credential.");
}
process.stdout.write(
  "Render Docker Blueprint configuration validation passed.\n",
);
