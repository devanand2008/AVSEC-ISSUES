@echo off
setlocal
set "TARGET=%~1"
if "%TARGET%"=="" set "TARGET=Web"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-avs-flutter.ps1" -Target "%TARGET%"
endlocal
