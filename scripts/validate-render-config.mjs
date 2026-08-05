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
  "DATABASE_MODE",
  "EXTERNAL_PERSISTENT",
  "DATABASE_URL",
  "DIRECT_DATABASE_URL",
  "PUBLIC_APP_URL",
  "GOOGLE_DRIVE_OWNER_EMAIL",
  "devanand.s2008@gmail.com",
  "BACKUP_ENCRYPTION_KEY",
  "sync: false",
];
const missing = required.filter((value) => !content.includes(value));
if (missing.length) {
  throw new Error(`render.yaml is missing: ${missing.join(", ")}`);
}
const serviceCount = (content.match(/^  - type: web$/gmu) ?? []).length;
if (serviceCount !== 1) throw new Error("render.yaml must declare exactly one web service.");
if (/^databases:/mu.test(content) || /^  - type: keyvalue$/mu.test(content)) {
  throw new Error("render.yaml must not auto-provision Render database or key-value resources.");
}
if (/postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/iu.test(content)) {
  throw new Error("render.yaml contains a database credential.");
}
process.stdout.write("Render single-service configuration validation passed.\n");
