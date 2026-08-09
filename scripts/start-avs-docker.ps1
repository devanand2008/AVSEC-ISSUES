$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

function Test-DockerEngine {
  $docker = (Get-Command docker -ErrorAction Stop).Source
  $process = Start-Process `
    -FilePath $docker `
    -ArgumentList @("info", "--format={{.ServerVersion}}") `
    -PassThru `
    -WindowStyle Hidden

  if (-not $process.WaitForExit(8000)) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    return $false
  }

  return $process.ExitCode -eq 0
}

function Wait-ForUrl {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Url,
    [int] $TimeoutSeconds = 240
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return $true
      }
    } catch {
      Start-Sleep -Seconds 2
    }
  } while ((Get-Date) -lt $deadline)

  return $false
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker Desktop is not installed or docker.exe is not in PATH."
}

try {
  & docker compose version *> $null
} catch {
  throw "Docker Compose is unavailable. Install or update Docker Desktop."
}
if ($LASTEXITCODE -ne 0) {
  throw "Docker Compose is unavailable. Install or update Docker Desktop."
}

if (-not (Test-Path -LiteralPath ".env")) {
  if (-not (Test-Path -LiteralPath ".env.example")) {
    throw ".env and .env.example are both missing."
  }
  Copy-Item -LiteralPath ".env.example" -Destination ".env"
  Write-Host "[INFO] Created .env from .env.example."
}

$lanIp = Get-NetIPConfiguration |
  Where-Object {
    $_.IPv4DefaultGateway -and
    $_.NetAdapter.Status -eq "Up"
  } |
  ForEach-Object { $_.IPv4Address.IPAddress } |
  Where-Object {
    $_ -and
    $_ -notlike "169.254*" -and
    $_ -ne "127.0.0.1"
  } |
  Select-Object -First 1

if (-not $lanIp) {
  $lanIp = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object {
      $_.IPAddress -notlike "169.254*" -and
      $_.IPAddress -ne "127.0.0.1" -and
      $_.PrefixOrigin -ne "WellKnown"
    } |
    Select-Object -ExpandProperty IPAddress -First 1
}

if (-not $lanIp) {
  throw "No active LAN IPv4 address was found. Connect this computer to Wi-Fi or Ethernet."
}

$env:WEB_BIND_ADDRESS = "0.0.0.0"
$env:API_BIND_ADDRESS = "0.0.0.0"
$env:WEB_HOST_PORT = "3000"
$env:API_HOST_PORT = "4000"
$env:WEB_URL = "http://${lanIp}:3000"
$env:CORS_ALLOWED_ORIGINS = @(
  "http://localhost:3000"
  "http://127.0.0.1:3000"
  "http://${lanIp}:3000"
  "http://localhost:8080"
  "http://127.0.0.1:8080"
  "http://${lanIp}:8080"
) -join ","
$env:NEXT_PUBLIC_API_URL = "http://localhost:4000/api/v1"
$env:NEXT_PUBLIC_SOCKET_URL = "http://localhost:4000/realtime"

Write-Host "[INFO] Computer LAN address: $lanIp"

if (-not (Test-DockerEngine)) {
  Write-Host "[INFO] Docker Engine is not responding. Restarting Docker Desktop..."
  & docker desktop restart --timeout 120
  if ($LASTEXITCODE -ne 0) {
    & docker desktop start --timeout 120
  }
}

$engineDeadline = (Get-Date).AddSeconds(120)
while (-not (Test-DockerEngine)) {
  if ((Get-Date) -ge $engineDeadline) {
    throw "Docker Engine did not become ready within two minutes."
  }
  Start-Sleep -Seconds 3
}

Write-Host "[INFO] Building the API image..."
& docker compose --profile full build api
if ($LASTEXITCODE -ne 0) {
  throw "Docker Compose failed to build the API image."
}

Write-Host "[INFO] Building the web image..."
& docker compose --profile full build web
if ($LASTEXITCODE -ne 0) {
  throw "Docker Compose failed to build the web image."
}

Write-Host "[INFO] Starting the complete Docker application..."
& docker compose --profile full up -d --no-build --remove-orphans
if ($LASTEXITCODE -ne 0) {
  throw "Docker Compose failed to start the application."
}

$apiReadyUrl = "http://localhost:4000/health/ready/dependencies"
$learnHealthUrl = "http://localhost:4000/api/v1/learn/health"
$webUrl = "http://localhost:3000/login"
$mobileWebUrl = "http://${lanIp}:3000/login"

Write-Host "[INFO] Waiting for the API, AVS Learn, and web application..."
if (-not (Wait-ForUrl -Url $apiReadyUrl)) {
  & docker compose --profile full ps
  & docker compose logs --tail 100 api
  throw "The API did not become ready."
}
if (-not (Wait-ForUrl -Url $learnHealthUrl -TimeoutSeconds 60)) {
  throw "The AVS Learn API health check failed."
}
if (-not (Wait-ForUrl -Url $webUrl)) {
  & docker compose --profile full ps
  & docker compose logs --tail 100 web
  throw "The web application did not become ready."
}
if (-not (Wait-ForUrl -Url $mobileWebUrl -TimeoutSeconds 30)) {
  throw "The web application is not reachable through the LAN address."
}

Write-Host ""
Write-Host "============================================="
Write-Host " AVS is running in Docker"
Write-Host " Desktop:  http://localhost:3000"
Write-Host " Mobile:   http://${lanIp}:3000"
Write-Host " AVS Learn: http://${lanIp}:3000/learn"
Write-Host " Flutter Web (after START_AVS_FLUTTER.bat): http://${lanIp}:8080"
Write-Host " API:      http://${lanIp}:4000/api/v1"
Write-Host "============================================="
Write-Host ""
Write-Host "Connect the phone to the same Wi-Fi network as this computer."

Start-Process -FilePath "http://localhost:3000" -WindowStyle Hidden
