@echo off
setlocal

cd /d "%~dp0"

echo ==============================================
echo  AVS COLLEGE MANAGEMENT - SAFE GIT PUSH
echo ==============================================

where git >nul 2>&1
if errorlevel 1 (
    echo Git is not installed or is not in PATH.
    pause
    exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
    echo Node.js is not installed or is not in PATH.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass ^
  -File "%~dp0scripts\safe-git-push.ps1" %*

if errorlevel 1 (
    echo.
    echo Push stopped because a check failed.
    pause
    exit /b 1
)

echo.
echo Safe Git push completed.
pause
