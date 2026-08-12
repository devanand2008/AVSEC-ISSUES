#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "Usage: scripts/test-sql-restore.sh ENCRYPTED_SQL_GZ SOURCE_DATABASE_URL [RESTORED_METADATA_JSON]" >&2
  exit 64
fi

encrypted_file="$1"
source_url="$2"
metadata_output="${3:-}"
work_dir="$(mktemp -d)"
temp_database="avs_backup_verify_$(date +%s)_${RANDOM}${RANDOM}"
[[ "$temp_database" =~ ^avs_backup_verify_[a-zA-Z0-9_]+$ ]]

source_base="${source_url%%\?*}"
source_query=""
if [[ "$source_url" == *"?"* ]]; then
  source_query="?${source_url#*\?}"
fi
url_without_path="${source_base%/*}"
maintenance_url="${url_without_path}/postgres${source_query}"
temp_url="${url_without_path}/${temp_database}${source_query}"
created_database=false

cleanup() {
  if [[ "$created_database" == true ]]; then
    dropdb --if-exists --force --maintenance-db="$maintenance_url" "$temp_database" >/dev/null 2>&1 || true
  fi
  find "$work_dir" -type f -exec shred -u {} \; 2>/dev/null || true
  rm -rf -- "$work_dir"
}
trap cleanup EXIT

gzip_file="$work_dir/restore.sql.gz"
sql_file="$work_dir/restore.sql"

node scripts/backup-crypto.mjs decrypt "$encrypted_file" "$gzip_file"
gzip -dc "$gzip_file" > "$sql_file"
test -s "$sql_file"
grep -Eq 'CREATE (TABLE|SCHEMA)' "$sql_file"

createdb --maintenance-db="$maintenance_url" "$temp_database"
created_database=true
psql --no-psqlrc --set ON_ERROR_STOP=on --single-transaction "$temp_url" --file="$sql_file" >/dev/null
psql --no-psqlrc --set ON_ERROR_STOP=on --tuples-only --no-align "$temp_url" --command='SELECT count(*) FROM "_prisma_migrations"' | grep -Eq '^[1-9][0-9]*$'
for table in users colleges campuses audit_logs database_backups; do
  psql --no-psqlrc --set ON_ERROR_STOP=on --tuples-only --no-align "$temp_url" --command="SELECT to_regclass('public.$table') IS NOT NULL" | grep -qx t
done

restored_metadata="$work_dir/restored-metadata.json"
psql --no-psqlrc --quiet --tuples-only --no-align --set ON_ERROR_STOP=on "$temp_url" > "$restored_metadata" <<'SQL'
SELECT json_build_object(
  'prismaMigrationVersion', (
    SELECT migration_name
    FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    ORDER BY finished_at DESC, migration_name DESC
    LIMIT 1
  ),
  'tableCounts', (
    SELECT json_object_agg(tablename, row_count ORDER BY tablename)
    FROM (
      SELECT
        tablename,
        ((xpath(
          '/row/row_count/text()',
          query_to_xml(
            format('SELECT count(*) AS row_count FROM %I.%I', schemaname, tablename),
            false,
            true,
            ''
          )
        ))[1]::text)::bigint AS row_count
      FROM pg_tables
      WHERE schemaname = 'public'
    ) AS table_counts
  )
)::text;
SQL
test -s "$restored_metadata"

node - "$restored_metadata" "$metadata_output" <<'NODE'
const fs = require("node:fs");

const restored = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const output = process.argv[3];

function validateCounts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Restored table counts are invalid.");
  }
  const entries = Object.entries(value);
  if (entries.length === 0) throw new Error("Restored table counts are empty.");
  for (const [table, count] of entries) {
    if (
      !table ||
      /[\r\n]/u.test(table) ||
      !Number.isSafeInteger(count) ||
      count < 0
    ) {
      throw new Error(`Restored table count is invalid for ${table || "<empty>"}.`);
    }
  }
  if (!Number.isSafeInteger(value._prisma_migrations) || value._prisma_migrations < 1) {
    throw new Error("Restored migration count is invalid.");
  }
}

const restoredMigration = restored.prismaMigrationVersion;
if (
  typeof restoredMigration !== "string" ||
  restoredMigration.length === 0 ||
  restoredMigration.length > 500 ||
  /[\r\n]/u.test(restoredMigration)
) {
  throw new Error("Restored Prisma migration state is invalid.");
}

validateCounts(restored.tableCounts);
if (output) {
  fs.writeFileSync(output, `${JSON.stringify(restored)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
}
NODE
echo "Isolated SQL restore test passed."
