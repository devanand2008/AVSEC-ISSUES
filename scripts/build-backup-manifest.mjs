import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat, writeFile } from "node:fs/promises";

const [fullSql, encrypted, schemaSql, checksumFile, manifestFile] =
  process.argv.slice(2);
if (!manifestFile) {
  throw new Error(
    "Usage: node scripts/build-backup-manifest.mjs FULL_SQL ENCRYPTED SCHEMA CHECKSUM MANIFEST",
  );
}
const databaseUrl = process.env.BACKUP_DATABASE_URL;
if (!databaseUrl) throw new Error("BACKUP_DATABASE_URL is required.");
const url = new URL(databaseUrl);
const createdAt = new Date();
const files = await Promise.all(
  [fullSql, encrypted, schemaSql, checksumFile].map(async (path) => ({
    fileName: path.split(/[\\/]/).pop(),
    bytes: (await stat(path)).size,
    sha256: await sha256(path),
  })),
);
const tableCounts = parseJson(process.env.BACKUP_TABLE_COUNTS_JSON, {});
const backupType = allowedValue(
  process.env.BACKUP_TYPE ?? "DAILY",
  ["DAILY", "PRE_MIGRATION", "PRE_DELETION"],
  "BACKUP_TYPE",
);
const backupStatus = allowedValue(
  process.env.BACKUP_STATUS ?? "COMPLETED",
  ["COMPLETED", "RESTORE_TESTED"],
  "BACKUP_STATUS",
);
const manifest = {
  backupId: process.env.BACKUP_ID,
  backupDate: new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(createdAt),
  backupTime: new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(createdAt),
  timezone: "Asia/Kolkata",
  databaseHostHash: createHash("sha256")
    .update(url.hostname.toLowerCase())
    .digest("hex"),
  databaseName: decodeURIComponent(url.pathname.replace(/^\/+/, "")),
  applicationCommit: process.env.GITHUB_SHA ?? null,
  prismaMigrationVersion: process.env.PRISMA_MIGRATION_VERSION || null,
  fullSqlFileName: files[0].fileName,
  encryptedFullBackupFileName: files[1].fileName,
  schemaSqlFileName: files[2].fileName,
  checksumFileName: files[3].fileName,
  files,
  tableCounts,
  sqlFormat: "PLAIN",
  encryption: "AES-256-GCM",
  backupType,
  backupStatus,
  uploadStatus: "READY_FOR_UPLOAD",
  restoreTestStatus:
    backupStatus === "RESTORE_TESTED" ? "PASSED" : "NOT_TESTED",
};
await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, {
  flag: "wx",
  mode: 0o600,
});

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("BACKUP_TABLE_COUNTS_JSON is invalid.");
  }
  return parsed;
}

function allowedValue(value, allowed, name) {
  if (!allowed.includes(value)) throw new Error(`${name} is invalid.`);
  return value;
}
