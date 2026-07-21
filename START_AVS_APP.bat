@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"
title AVS Engineering College Management System

echo =============================================
echo  AVS ENGINEERING COLLEGE MANAGEMENT SYSTEM
echo =============================================
echo.

:: 1. Check Dependencies
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not in PATH.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm is not installed or not in PATH.
  pause
  exit /b 1
)

:: 2. Check Directories
if not exist "apps\api\package.json" (
  echo [ERROR] Backend folder apps\api missing or invalid.
  pause
  exit /b 1
)
if not exist "apps\web\package.json" (
  echo [ERROR] Frontend folder apps\web missing or invalid.
  pause
  exit /b 1
)

:: 3. Check Environment Files
if not exist ".env" (
  if exist ".env.example" (
    copy ".env.example" ".env" >nul
    echo [INFO] Created .env from .env.example.
  ) else (
    echo [ERROR] .env is missing and .env.example was not found.
    pause
    exit /b 1
  )
)

:: 4. Check PostgreSQL Connectivity (Fallback from MongoDB prompt)
echo Checking PostgreSQL connectivity (via docker if running)...
docker compose ps postgres >nul 2>&1
if errorlevel 1 (
  echo [INFO] Docker not available or postgres not running via docker. We will assume local or remote DB is available.
)

:: 5. Detect LAN IP
for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$ip = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | ForEach-Object { $_.IPv4Address.IPAddress } | Where-Object { $_ -and $_ -notlike '169.254*' -and $_ -ne '127.0.0.1' } | Select-Object -First 1; if (-not $ip) { $ip = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '169.254*' -and $_.IPAddress -ne '127.0.0.1' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -ExpandProperty IPAddress -First 1 }; if ($ip) { $ip } else { 'localhost' }"`) do set "LAN_IP=%%I"
if not defined LAN_IP set "LAN_IP=localhost"

:: 6. Offer HTTP or HTTPS
set "USE_HTTPS=0"
if exist "certs\local\avs-localhost.pem" (
  if exist "certs\local\avs-localhost-key.pem" (
    echo Local certificates found in certs\local\
    choice /C YN /M "Start frontend in HTTPS mode for QR camera testing?"
    if not errorlevel 2 set "USE_HTTPS=1"
  )
)

:: 7. Start Services (using concurrently or separate windows)
echo.
echo Starting Database, Redis, MinIO (Docker)...
docker compose up -d postgres redis minio minio-init >nul 2>&1

echo.
echo Starting Backend...
start "AVS Backend" cmd /c "npm run dev:api"

echo Waiting for backend health check (/api/v1/health/ready/dependencies)...
:wait_backend
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -UseBasicParsing 'http://localhost:4000/api/v1/health/ready/dependencies' -TimeoutSec 3; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { exit 0 } } catch {}; exit 1" >nul 2>nul
if errorlevel 1 (
  timeout /t 2 /nobreak >nul
  goto wait_backend
)
echo Backend is ready!

echo.
if "%USE_HTTPS%"=="1" (
  echo Starting Frontend in HTTPS mode...
  start "AVS Frontend" cmd /c "npm run dev:web -- --experimental-https --experimental-https-key ../../certs/local/avs-localhost-key.pem --experimental-https-cert ../../certs/local/avs-localhost.pem"
  set "WEB_PROTO=https"
) else (
  echo Starting Frontend in HTTP mode...
  start "AVS Frontend" cmd /c "npm run dev:web"
  set "WEB_PROTO=http"
)

echo.
echo =============================================
echo  Desktop URL: %WEB_PROTO%://localhost:3000
echo  Mobile URL:  %WEB_PROTO%://%LAN_IP%:3000
echo =============================================
echo.

start "" "%WEB_PROTO%://localhost:3000"

pause
