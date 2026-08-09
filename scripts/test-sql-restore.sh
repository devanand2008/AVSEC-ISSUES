#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: scripts/test-sql-restore.sh ENCRYPTED_SQL_GZ SOURCE_DATABASE_URL" >&2
  exit 64
fi

encrypted_file="$1"
source_url="$2"
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

table_counts() {
  local database_url="$1"
  psql --no-psqlrc --quiet --tuples-only --no-align --set ON_ERROR_STOP=on "$database_url" <<'SQL'
SELECT format(
  'SELECT %L || chr(9) || count(*)::text FROM %I.%I;',
  schemaname || '.' || tablename,
  schemaname,
  tablename
)
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename
\gexec
SQL
}

source_counts="$(table_counts "$source_url")"
restored_counts="$(table_counts "$temp_url")"
test -n "$source_counts"
test "$source_counts" = "$restored_counts"
echo "Isolated SQL restore test passed."
