import { readdir } from "node:fs/promises";
import pg from "pg";

if (process.env.MIGRATION_BACKUP_REQUIRED === "false") {
  process.stdout.write("Pre-migration backup gate explicitly disabled.\n");
  process.exit(0);
}

const connectionString =
  process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
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
    process.stdout.write("New database detected; no pre-migration backup is required.\n");
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
  const backupTable = await client.query(
    "SELECT to_regclass('public.database_backups')::text AS name",
  );
  if (!backupTable.rows[0]?.name) {
    throw new Error(
      "Pending migrations exist, but backup metadata is unavailable. Create and verify a pre-migration SQL backup before deployment.",
    );
  }
  const recent = await client.query(
    `SELECT id FROM database_backups
     WHERE status IN ('COMPLETED', 'RESTORE_TESTED')
       AND completed_at >= now() - interval '24 hours'
       AND deleted_at IS NULL
     ORDER BY completed_at DESC LIMIT 1`,
  );
  if (recent.rowCount !== 1) {
    throw new Error(
      "Pending migrations require a completed backup from the last 24 hours.",
    );
  }
  process.stdout.write("Recent completed backup confirmed for pending migrations.\n");
} finally {
  await client.end().catch(() => undefined);
}
