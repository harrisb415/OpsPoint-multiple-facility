@echo off
title OpsPoint Central
cd /d "%~dp0"

echo.
echo  Checking for Node.js...
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
  echo  ERROR: Node.js is not installed. Download the LTS from https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules\ (
  echo  First-time setup: installing packages...
  npm install
  if %ERRORLEVEL% neq 0 ( echo  ERROR: npm install failed. & pause & exit /b 1 )
)

if not exist data\ mkdir data

set "_proto=http"
if exist data\cert.pem if exist data\key.pem set "_proto=https"

echo.
echo  ================================================
echo   OpsPoint Central (HQ)
echo   Console : %_proto%://localhost:4000
echo  ================================================
echo.

:: bootstrap.js supervises server.js — health-checks self-updates and
:: auto-rolls-back a failed boot. It stays running across restarts/updates.
node bootstrap.js
if %ERRORLEVEL% neq 0 (
  echo.
  echo  Central stopped unexpectedly. See error above.
)
echo.
pause
