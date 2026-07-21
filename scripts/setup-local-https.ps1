$ErrorActionPreference = "Stop"

$rootDir = [System.IO.Path]::GetFullPath("$PSScriptRoot\..")
$certsDir = [System.IO.Path]::Combine($rootDir, "certs", "local")
$mkcertLocalPath = [System.IO.Path]::Combine($rootDir, "mkcert-master", "mkcert.exe")

Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  AVS LOCAL HTTPS & MKCERT SETUP" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ""

$mkcertCmd = $null
if (Test-Path -Path $mkcertLocalPath) {
    $mkcertCmd = $mkcertLocalPath
    Write-Host "Found local mkcert binary at: $mkcertCmd" -ForegroundColor Green
} elseif (Get-Command "mkcert" -ErrorAction SilentlyContinue) {
    $mkcertCmd = (Get-Command "mkcert").Source
    Write-Host "Found system mkcert binary at: $mkcertCmd" -ForegroundColor Green
} else {
    Write-Error "mkcert binary was not found in PATH or mkcert-master folder. Please install mkcert first."
    exit 1
}

$lanIp = "localhost"
try {
    $ipObj = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
        $_.IPAddress -notlike "169.254*" -and $_.IPAddress -ne "127.0.0.1" -and $_.PrefixOrigin -ne "WellKnown"
    } | Select-Object -First 1
    if ($ipObj -and $ipObj.IPAddress) {
        $lanIp = $ipObj.IPAddress
    }
} catch {
    $lanIp = "localhost"
}

Write-Host "Detected LAN IPv4: $lanIp" -ForegroundColor Yellow
Write-Host "Target Certificate Directory: $certsDir" -ForegroundColor Yellow
Write-Host ""
Write-Host "NOTE: mkcert generates development-only certificates. Never deploy these to production!" -ForegroundColor Magenta

if (-not (Test-Path -Path $certsDir)) {
    New-Item -ItemType Directory -Path $certsDir -Force | Out-Null
}

$confirm = Read-Host "Do you want to run 'mkcert -install' and generate certificates for localhost, 127.0.0.1, ::1, and $lanIp? (Y/N)"
if ($confirm -ne "Y" -and $confirm -ne "y") {
    Write-Host "Setup cancelled by user." -ForegroundColor Yellow
    exit 0
}

Write-Host "Installing local CA root certificate..." -ForegroundColor Cyan
& $mkcertCmd -install

$certFile = [System.IO.Path]::Combine($certsDir, "avs-localhost.pem")
$keyFile = [System.IO.Path]::Combine($certsDir, "avs-localhost-key.pem")

Write-Host "Generating local certificates..." -ForegroundColor Cyan
& $mkcertCmd -cert-file $certFile -key-file $keyFile "localhost" "127.0.0.1" "::1" $lanIp

if ($LASTEXITCODE -eq 0 -and (Test-Path -Path $certFile) -and (Test-Path -Path $keyFile)) {
    Write-Host ""
    Write-Host "==============================================" -ForegroundColor Green
    Write-Host "  Local HTTPS certificates successfully generated!" -ForegroundColor Green
    Write-Host "  Cert: certs/local/avs-localhost.pem" -ForegroundColor Green
    Write-Host "  Key:  certs/local/avs-localhost-key.pem (PRIVATE - Do not share or commit)" -ForegroundColor Green
    Write-Host "==============================================" -ForegroundColor Green
} else {
    Write-Error "Certificate generation failed."
    exit 1
}
