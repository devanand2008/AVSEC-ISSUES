import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const renderPath = path.join(rootDir, "render.yaml");

function validateRenderConfig() {
  if (!fs.existsSync(renderPath)) {
    console.error("ERROR: render.yaml not found at project root.");
    process.exit(1);
  }

  const content = fs.readFileSync(renderPath, "utf8");
  
  const requiredKeys = [
    "services:",
    "avs-college-api",
    "avs-college-web",
    "runtime: node",
    "rootDir: apps/api",
    "rootDir: apps/web",
    "healthCheckPath: /api/v1/health/ready/dependencies",
    "buildCommand:",
    "startCommand:",
    "CSRF_SECRET",
    "TRUST_PROXY",
    "DATABASE_URL",
    "MONGODB_URI",
    "REDIS_URL",
    "S3_ENDPOINT",
    "S3_SECRET_KEY",
    "JWT_ACCESS_SECRET",
    "JWT_REFRESH_SECRET",
    "FRONTEND_URL",
    "CORS_ALLOWED_ORIGINS",
    "NEXT_PUBLIC_API_URL",
    "VITE_API_BASE_URL",
    "sync: false"
  ];

  const missing = requiredKeys.filter((key) => !content.includes(key));
  if (missing.length > 0) {
    console.error("ERROR: render.yaml is missing required configuration elements:");
    missing.forEach((k) => console.error(`  - ${k}`));
    process.exit(1);
  }

  // Check that no real secrets or passwords are embedded
  const forbidden = [
    /mongodb(?:\+srv)?:\/\/[^:\s]+:[^@\s]+@/i,
    /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/i,
    /(JWT_(?:ACCESS|REFRESH)_SECRET|CSRF_SECRET|SMTP_PASSWORD|S3_SECRET_KEY|RENDER_API_KEY)\s*:\s*(?!\s*$|\s*sync:|\s*generateValue:)/i
  ];

  for (const regex of forbidden) {
    if (regex.test(content)) {
      console.error("ERROR: render.yaml contains what appears to be plaintext secrets or connection strings.");
      process.exit(1);
    }
  }

  console.log("Render configuration validation passed.");
  console.log("Services configured:");
  console.log("  - avs-college-api (rootDir: apps/api)");
  console.log("  - avs-college-web (rootDir: apps/web)");
}

validateRenderConfig();
