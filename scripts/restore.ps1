param([Parameter(Mandatory=$true)][string]$BackupFile, [switch]$ConfirmRestore)
$ErrorActionPreference = "Stop"
if (-not $ConfirmRestore) { throw "Restoration is destructive. Re-run with -ConfirmRestore after approval and a current backup." }
$resolved = (Resolve-Path -LiteralPath $BackupFile).Path
if (Get-Command pg_restore -ErrorAction SilentlyContinue) {
  if (-not $env:DATABASE_URL) { throw "DATABASE_URL is required when using the local pg_restore executable." }
  & pg_restore --clean --if-exists --no-owner --no-acl --dbname=$env:DATABASE_URL $resolved
  if ($LASTEXITCODE -ne 0) { throw "pg_restore failed with exit code $LASTEXITCODE." }
} elseif (Get-Command docker -ErrorAction SilentlyContinue) {
  $database = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { "college_management" }
  $user = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { "college_app" }
  $containerSource = "/tmp/college-restore.dump"
  & docker compose cp $resolved "postgres:$containerSource"
  if ($LASTEXITCODE -ne 0) { throw "Could not copy the backup into the PostgreSQL container." }
  & docker compose exec -T postgres pg_restore --clean --if-exists --no-owner --no-acl -U $user -d $database $containerSource
  $restoreExit = $LASTEXITCODE
  & docker compose exec -T postgres rm -f $containerSource
  if ($restoreExit -ne 0) { throw "Container pg_restore failed with exit code $restoreExit." }
} else {
  throw "Install PostgreSQL client tools or Docker to restore a backup."
}
