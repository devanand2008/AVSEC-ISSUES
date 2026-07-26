param(
  [ValidateSet("Web", "Android")]
  [string]$Target = "Web"
)

$ErrorActionPreference = "Stop"
$workspace = Split-Path -Parent $PSScriptRoot

Set-Location -LiteralPath $workspace
& powershell -NoProfile -ExecutionPolicy Bypass -File (
  Join-Path $PSScriptRoot "start-avs-docker.ps1"
)

$flutter = Get-Command flutter -ErrorAction SilentlyContinue
if ($flutter) {
  $flutterExecutable = $flutter.Source
} elseif (Test-Path -LiteralPath "D:\flutter\bin\flutter.bat") {
  $flutterExecutable = "D:\flutter\bin\flutter.bat"
} else {
  throw "Flutter SDK is not installed or is not available on PATH."
}

$lanAddress = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object {
    $_.IPAddress -notmatch "^(127|169\.254)\." -and
    $_.InterfaceAlias -notmatch "Loopback|vEthernet|WSL|Docker"
  } |
  Sort-Object InterfaceMetric |
  Select-Object -First 1 -ExpandProperty IPAddress

if (-not $lanAddress) {
  throw "No LAN IPv4 address was detected."
}

$apiBaseUrl = "http://${lanAddress}:4000/api/v1"

Write-Host "AVS web: http://localhost:3000"
Write-Host "AVS mobile: http://${lanAddress}:3000"
Write-Host "Flutter API: $apiBaseUrl"

Push-Location -LiteralPath (Join-Path $workspace "apps\flutter_app")
try {
  & $flutterExecutable pub get
  if ($Target -eq "Web") {
    Write-Host "Flutter Web: http://localhost:8080"
    Write-Host "Flutter Web on phone: http://${lanAddress}:8080"
    & $flutterExecutable run `
      -d web-server `
      --web-hostname 0.0.0.0 `
      --web-port 8080
  } else {
    & $flutterExecutable run "--dart-define=AVS_API_BASE_URL=$apiBaseUrl"
  }
} finally {
  Pop-Location
}
