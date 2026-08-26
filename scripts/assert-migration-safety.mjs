import { readdir } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";

if (process.env.MIGRATION_BACKUP_REQUIRED === "false") {
  process.stdout.write("Pre-migration backup gate explicitly disabled.\n");
  process.exit(0);
}

const maximumBackupWaitSeconds = 120;
const backupWaitSeconds = boundedNonNegativeInteger(
  process.env.MIGRATION_BACKUP_WAIT_SECONDS,
  "MIGRATION_BACKUP_WAIT_SECONDS",
  process.env.RENDER === "true" ? 60 : 0,
  maximumBackupWaitSeconds,
);
const backupPollMilliseconds = 15_000;

// Prisma's deploy command reads DATABASE_URL from prisma.config.ts. The safety
// gate must inspect that exact database instead of approving a different
// optional direct connection.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");

const localMigrations = (
  await readdir("apps/api/prisma/migrations", { withFileTypes: true })
)
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const client = new pg.Client({ connectionString });
try {
  await client.connect();
  const migrationTable = await client.query(
    "SELECT to_regclass('public._prisma_migrations')::text AS name",
  );
  if (!migrationTable.rows[0]?.name) {
    process.stdout.write(
      "New database detected; no pre-migration backup is required.\n",
    );
    process.exit(0);
  }
  const applied = await client.query(
    'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
  );
  const appliedNames = new Set(applied.rows.map((row) => row.migration_name));
  const pending = localMigrations.filter((name) => !appliedNames.has(name));
  if (pending.length === 0) {
    process.stdout.write("No pending database migrations.\n");
    process.exit(0);
  }
  process.stdout.write(`Pending database migrations: ${pending.join(", ")}\n`);
  const backupTable = await client.query(
    "SELECT to_regclass('public.database_backups')::text AS name",
  );
  if (!backupTable.rows[0]?.name) {
    throw new Error(
      "Pending migrations exist, but backup metadata is unavailable. Create and verify a pre-migration SQL backup before deployment.",
    );
  }
  const findRecentVerifiedBackup = () =>
    client.query(`SELECT id FROM database_backups
     WHERE backup_type = 'PRE_MIGRATION'
       AND status = 'RESTORE_TESTED'
       AND completed_at >= now() - interval '24 hours'
       AND deleted_at IS NULL
       AND plain_size_bytes > 0
       AND encrypted_size_bytes > 0
       AND plain_checksum_sha256 ~ '^[a-f0-9]{64}$'
       AND encrypted_checksum_sha256 ~ '^[a-f0-9]{64}$'
       AND manifest_checksum_sha256 ~ '^[a-f0-9]{64}$'
       AND jsonb_typeof(record_counts) = 'object'
       AND (SELECT count(*) FROM jsonb_object_keys(record_counts)) = (
         SELECT count(*)::integer
         FROM pg_tables
         WHERE schemaname = 'public'
       )
       AND (record_counts ->> '_prisma_migrations')::bigint = (
         SELECT count(*)
         FROM "_prisma_migrations"
       )
       AND schema_version = (
         SELECT migration_name
         FROM "_prisma_migrations"
         WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
         ORDER BY finished_at DESC, migration_name DESC
         LIMIT 1
       )
     ORDER BY completed_at DESC LIMIT 1`);
  let recent = await findRecentVerifiedBackup();
  if (recent.rowCount !== 1 && backupWaitSeconds > 0) {
    const deadline = Date.now() + backupWaitSeconds * 1_000;
    process.stdout.write(
      `Waiting up to ${backupWaitSeconds} seconds for the automatic pre-migration backup to be verified.\n`,
    );
    while (recent.rowCount !== 1) {
      const remainingMilliseconds = deadline - Date.now();
      if (remainingMilliseconds <= 0) break;
      await delay(
        Math.min(backupPollMilliseconds, remainingMilliseconds),
        undefined,
        { ref: true },
      );
      recent = await findRecentVerifiedBackup();
    }
  }
  if (recent.rowCount !== 1) {
    throw new Error(
      "Pending migrations require a verified pre-migration backup from the last 24 hours. The automatic backup did not register in time; run the manual backup workflow with purpose=pre-migration, then retry deployment.",
    );
  }
  process.stdout.write("Recent verified pre-migration backup confirmed.\n");
} finally {
  await client.end().catch(() => undefined);
}

function boundedNonNegativeInteger(value, name, fallback, maximum) {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/u.test(value)) {
    throw new Error(`${name} must be an integer between 0 and ${maximum}.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new Error(`${name} must be an integer between 0 and ${maximum}.`);
  }
  return parsed;
}
