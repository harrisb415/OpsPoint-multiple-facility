@echo off
title OpsPoint v2.5.0
cd /d "%~dp0"

echo.
echo  Checking for Node.js...
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
  echo.
  echo  ERROR: Node.js is not installed.
  echo  Download from https://nodejs.org  ^(click "LTS"^)
  echo  Run the installer with all defaults, then try again.
  echo.
  pause
  exit /b 1
)
echo  Node.js found.

if not exist node_modules\ (
  echo  First-time setup: installing packages...
  npm install
  if %ERRORLEVEL% neq 0 (
    echo  ERROR: npm install failed.
    pause
    exit /b 1
  )
  echo  Packages installed.
)

if not exist data\ mkdir data
if not exist data\photos\ mkdir data\photos

:: ── Detect TLS ────────────────────────────────────────────────────
set "_proto=http"
set "_ws=ws"
if exist data\cert.pem if exist data\key.pem (
  set "_proto=https"
  set "_ws=wss"
)

:: ── Get LAN IP ────────────────────────────────────────────────────
for /f %%a in ('powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch '^127\.' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -First 1 -ExpandProperty IPAddress)"') do set "_ip=%%a"
if "%_ip%"=="" set "_ip=[YOUR-IP]"

:: ── Record start time ─────────────────────────────────────────────
for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "Get-Date -Format 'MM/dd/yyyy  HH:mm:ss'"`) do set "_startStr=%%a"
for /f %%a in ('powershell -NoProfile -Command "([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"') do set "_t0=%%a"

echo.
echo  ================================================
echo   OpsPoint v2.5.0
echo  ================================================
echo   Desktop : %_proto%://localhost:3000
echo   Mobile  : %_proto%://%_ip%:3000
echo   Admin   : %_proto%://localhost:3000/admin
echo  ------------------------------------------------
echo   Started : %_startStr%
echo  ================================================

echo.

:: ── Live uptime ticker in the window title bar ────────────────────
set "_ticker=%TEMP%\sp_ticker_%RANDOM%.stop"
del "%_ticker%" 2>nul
start /b powershell -NoProfile -Command "& { $s=Get-Date; $f='%_ticker%'; while (-not (Test-Path $f)) { $e=(Get-Date)-$s; [Console]::Title='OpsPoint v2.5.0   Up: '+$e.ToString('hh\:mm\:ss'); Start-Sleep 1 } }"

:: bootstrap.js supervises server.js — health-checks updates and auto-rolls-back
:: a failed boot. It stays running across in-app restarts/updates.
node bootstrap.js
if %ERRORLEVEL% neq 0 (
  echo.
  echo  Server stopped unexpectedly. See error above.
)

:: ── Stop the ticker and show final uptime ─────────────────────────
echo.>"%_ticker%"
for /f %%a in ('powershell -NoProfile -Command "([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"') do set "_t1=%%a"
set /a "_sec=%_t1% - %_t0%"
set /a "_upH=%_sec% / 3600"
set /a "_upM=%_sec% / 60 - %_upH% * 60"
set /a "_upS=%_sec% - %_upH% * 3600 - %_upM% * 60"
del "%_ticker%" 2>nul
title OpsPoint v2.5.0  ^|  Stopped
echo.
echo  ================================================
echo   Server offline.
echo   Started : %_startStr%
echo   Runtime : %_upH%h %_upM%m %_upS%s
echo  ================================================
echo.
pause
