param(
  [string]$OutputDirectory = "$(Split-Path $PSScriptRoot -Parent)\backups",
  [switch]$UseDocker
)
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$target = Join-Path $OutputDirectory "college-$stamp.dump"
if (-not $UseDocker -and (Get-Command pg_dump -ErrorAction SilentlyContinue)) {
  if (-not $env:DATABASE_URL) { throw "DATABASE_URL is required when using the local pg_dump executable." }
  & pg_dump --format=custom --no-owner --no-acl --file=$target $env:DATABASE_URL
  if ($LASTEXITCODE -ne 0) { throw "pg_dump failed with exit code $LASTEXITCODE." }
} elseif (Get-Command docker -ErrorAction SilentlyContinue) {
  $database = (& docker compose exec -T postgres printenv POSTGRES_DB | Select-Object -First 1).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $database) { $database = $env:POSTGRES_DB }
  if (-not $database) { $database = "college_management" }
  $user = (& docker compose exec -T postgres printenv POSTGRES_USER | Select-Object -First 1).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $user) { $user = $env:POSTGRES_USER }
  if (-not $user) { $user = "college_app" }
  $containerTarget = "/tmp/college-$stamp.dump"
  & docker compose exec -T postgres pg_dump --format=custom --no-owner --no-acl --file=$containerTarget -U $user -d $database
  if ($LASTEXITCODE -ne 0) { throw "Container pg_dump failed with exit code $LASTEXITCODE." }
  & docker compose cp "postgres:$containerTarget" $target
  if ($LASTEXITCODE -ne 0) { throw "Could not copy the database backup from the PostgreSQL container." }
  & docker compose exec -T postgres rm -f $containerTarget
} else {
  throw "Install PostgreSQL client tools or Docker to create a backup."
}
$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $target
Set-Content -LiteralPath "$target.sha256" -Value "$($hash.Hash)  $([IO.Path]::GetFileName($target))"
Write-Output $target
