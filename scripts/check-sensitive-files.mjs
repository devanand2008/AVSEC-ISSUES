import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

let rootDir = process.cwd();

try {
  rootDir = execSync("git rev-parse --show-toplevel", {
    encoding: "utf8",
    cwd: rootDir,
  }).trim();
} catch {
  // The repository check below prints the user-facing failure.
}

function getTrackedAndStagedFiles() {
  const files = new Set();
  let insideGitRepo = false;
  try {
    insideGitRepo = execSync("git rev-parse --is-inside-work-tree", { encoding: "utf8", cwd: rootDir }).trim() === "true";
  } catch {
    console.error("SECURITY CHECK FAILED\n");
    console.error("This folder is not a Git repository, so tracked/staged files cannot be audited.");
    console.error("Run git init and configure the private remote before using the safe push workflow.");
    process.exit(1);
  }
  if (!insideGitRepo) {
    console.error("SECURITY CHECK FAILED\n");
    console.error("This folder is not a Git repository.");
    process.exit(1);
  }
  try {
    const lsFiles = execSync("git ls-files", { encoding: "utf8", cwd: rootDir });
    lsFiles.split(/\r?\n/).forEach((f) => f && files.add(f.trim()));
  } catch {
    // If git ls-files fails, fall back or continue
  }
  try {
    const stagedFiles = execSync("git diff --cached --name-only", { encoding: "utf8", cwd: rootDir });
    stagedFiles.split(/\r?\n/).forEach((f) => f && files.add(f.trim()));
  } catch {
    // If git diff fails, continue
  }
  return Array.from(files);
}

function checkSensitiveFiles() {
  const files = getTrackedAndStagedFiles();
  const violations = new Set();

  const forbiddenPathPatterns = [
    /\.(xlsx?|csv|ods|numbers)$/i,
    /(^|\/)\.env($|\..*)/i,
    /(^|\/)certs\/.*\.((key)|(pem)|(crt)|(cer)|(p12)|(pfx)|(jks)|(keystore))$/i,
    /(^|\/)mkcert-master\/.*\.((key)|(pem)|(crt)|(cer)|(p12)|(pfx))$/i,
    /(^|\/).*\.((key)|(pem)|(crt)|(cer)|(p12)|(pfx)|(jks)|(keystore))$/i,
    /(^|\/)rootCA.*$/i,
    /(^|\/)(credential-exports|import-results|failed-imports|exports)\//i,
    /(^|\/).*(credential|password|private|secret|token).*\.(xlsx?|csv|ods|numbers|txt|json)$/i,
    /(^|\/)(github|render|vercel|netlify|aws|firebase|smtp).*token/i,
  ];

  const allowedExceptions = [
    /^\.env\.example$/i,
    /^user_data\/\.gitkeep$/i,
    /^user_data\/README_SECURITY\.txt$/i,
    /^user_data\/templates\/student-import-template\.xlsx$/i,
    /^user_data\/templates\/avs-user-import-template\.xlsx$/i,
  ];

  const secretPatterns = [
    /(mongodb(?:\+srv)?:\/\/(?!\$\{)(?![^:\s]+:(?:build|validation|test|password|strong-password|example|placeholder|ci-[^@\s]+)@)[^:\s]+:[^@\s]+@)/i,
    /(postgres(?:ql)?:\/\/(?!\$\{)(?![^:\s]+:(?:build|validation|test|password|strong-password|example|placeholder|ci-[^@\s]+)@)[^:\s]+:[^@\s]+@)/i,
    /(ghp_[a-zA-Z0-9]{36})/i,
    /(github_pat_[a-zA-Z0-9_]{22,})/i,
    /(rnd_[a-zA-Z0-9]{24,})/i,
    /(JWT_(?:ACCESS|REFRESH)_SECRET|CSRF_SECRET|SMTP_PASSWORD|S3_SECRET_KEY|WHATSAPP_ACCESS_TOKEN|WHATSAPP_APP_SECRET|RENDER_API_KEY|GITHUB_TOKEN|FIREBASE_PRIVATE_KEY|DEVICE_TOKEN_ENCRYPTION_KEY|PASSWORD_PEPPER|FEEDBACK_SUBMISSION_SECRET)[ \t]*[:=](?!-)[ \t]*["']?(?!\$\{?|REPLACE|replace|change-this|ci-|example|placeholder|access-secret|refresh-secret|csrf-secret|smtp-password|production-storage-secret|z\.|optional|environment\.|process\.|config\.|Boolean\(|String\(|Number\()[^"'\s#]{16,}/i,
    /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
  ];

  for (const file of files) {
    const normalizedPath = file.replace(/\\/g, "/");
    const isAllowed = allowedExceptions.some((regex) => regex.test(normalizedPath));
    if (isAllowed) continue;

    if (forbiddenPathPatterns.some((regex) => regex.test(normalizedPath))) {
      violations.add(normalizedPath);
      continue;
    }

    const fullPath = path.join(rootDir, normalizedPath);
    if (
      fs.existsSync(fullPath) &&
      fs.statSync(fullPath).isFile() &&
      !/\.(spec|test)\.[cm]?[tj]sx?$/i.test(normalizedPath)
    ) {
      try {
        const content = fs.readFileSync(fullPath, "utf8");
        for (const pattern of secretPatterns) {
          if (pattern.test(content)) {
            violations.add(`${normalizedPath} (contains embedded secret or private key material)`);
            break;
          }
        }
      } catch {
        // Binary files that are not caught by path patterns
      }
    }
  }

  if (violations.size > 0) {
    console.error("SECURITY CHECK FAILED\n");
    console.error("Sensitive files were detected:");
    for (const v of Array.from(violations).sort()) {
      console.error(`- ${v}`);
    }
    console.error("\nThese files must not be committed or pushed.");
    process.exit(1);
  }

  console.log("Security preflight passed.");
  console.log("No sensitive student data, secrets or private keys are tracked.");
}

checkSensitiveFiles();
