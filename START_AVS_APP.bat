@echo off
setlocal EnableExtensions

cd /d "%~dp0"
title AVS Engineering College Management System

echo =============================================
echo  AVS ENGINEERING COLLEGE MANAGEMENT SYSTEM
echo =============================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-avs-docker.ps1"
set "START_EXIT=%ERRORLEVEL%"

echo.
if not "%START_EXIT%"=="0" (
  echo [ERROR] AVS could not be started. Review the message above.
)
pause
exit /b %START_EXIT%
