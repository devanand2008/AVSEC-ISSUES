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

cleanup() {
  dropdb --if-exists --force --maintenance-db=postgres "$temp_database" >/dev/null 2>&1 || true
  find "$work_dir" -type f -exec shred -u {} \; 2>/dev/null || true
  rm -rf -- "$work_dir"
}
trap cleanup EXIT

url_without_path="${source_url%/*}"
maintenance_url="${url_without_path}/postgres"
gzip_file="$work_dir/restore.sql.gz"
sql_file="$work_dir/restore.sql"

node scripts/backup-crypto.mjs decrypt "$encrypted_file" "$gzip_file"
gzip -dc "$gzip_file" > "$sql_file"
test -s "$sql_file"
grep -Eq 'CREATE (TABLE|SCHEMA)' "$sql_file"

createdb --maintenance-db="$maintenance_url" "$temp_database"
temp_url="${url_without_path}/${temp_database}"
psql --no-psqlrc --set ON_ERROR_STOP=on --single-transaction "$temp_url" --file="$sql_file" >/dev/null
psql --no-psqlrc --set ON_ERROR_STOP=on --tuples-only --no-align "$temp_url" --command='SELECT count(*) FROM "_prisma_migrations"' | grep -Eq '^[1-9][0-9]*$'
for table in users colleges campuses audit_logs database_backups; do
  psql --no-psqlrc --set ON_ERROR_STOP=on --tuples-only --no-align "$temp_url" --command="SELECT to_regclass('public.$table') IS NOT NULL" | grep -qx t
done
source_users="$(psql --no-psqlrc --tuples-only --no-align "$source_url" --command='SELECT count(*) FROM users')"
restored_users="$(psql --no-psqlrc --tuples-only --no-align "$temp_url" --command='SELECT count(*) FROM users')"
test "$source_users" = "$restored_users"
echo "Isolated SQL restore test passed."
