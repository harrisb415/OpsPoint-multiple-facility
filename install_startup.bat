@echo off
title ShiftPoint — Startup Setup
cd /d "%~dp0"

echo.
echo  ================================================
echo   ShiftPoint — Startup Installation
echo  ================================================
echo   This will register ShiftPoint to start
echo   automatically when Windows boots.
echo.
echo   Run this ONCE with administrator privileges.
echo  ================================================
echo.

:: ── Check for admin ───────────────────────────────────────────
net session >nul 2>&1
if %ERRORLEVEL% neq 0 (
  echo  ERROR: Please right-click install_startup.bat
  echo  and select "Run as administrator"
  echo.
  pause
  exit /b 1
)

set TASK_NAME=ShiftPointServer
set APP_DIR=%~dp0

:: ── Detect Node.js and npm paths ──────────────────────────────
for /f "tokens=*" %%i in ('where node 2^>nul') do (
  set NODE_EXE=%%i
  goto :found_node
)
echo  ERROR: Node.js not found. Install from https://nodejs.org and re-run.
pause
exit /b 1
:found_node

for /f "tokens=*" %%i in ('where npm 2^>nul') do (
  set NPM_CMD=%%i
  goto :found_npm
)
:found_npm

:: ── Create the silent runner batch file ───────────────────────
echo  [1/3] Creating startup runner...
set RUN_BAT=%APP_DIR%run_silent.bat
(
  echo @echo off
  echo cd /d "%APP_DIR%"
  echo if not exist data\ mkdir data
  echo if not exist data\photos\ mkdir data\photos
  echo if not exist node_modules\ "%NPM_CMD%" install --omit=dev
  echo "%NODE_EXE%" server.js
) > "%RUN_BAT%"
echo        Created: run_silent.bat
echo        Node: %NODE_EXE%

:: ── Grant NetworkService access to the app folder ─────────────
echo  [2/3] Setting folder permissions...
icacls "%APP_DIR%" /grant "NT AUTHORITY\NetworkService:(OI)(CI)F" /q >nul 2>&1
echo        Granted access to: %APP_DIR%

:: ── Register the Scheduled Task ───────────────────────────────
echo  [3/3] Registering scheduled task...

:: Remove existing task if present
schtasks /delete /tn "%TASK_NAME%" /f >nul 2>&1

:: Create task as NetworkService — low-privilege built-in account,
:: no password needed, no Group Policy conflicts, runs at boot
schtasks /create /tn "%TASK_NAME%" /tr "cmd /c \"%RUN_BAT%\"" /sc onstart /ru "NT AUTHORITY\NetworkService" /f >nul 2>&1
set TASK_ERR=%ERRORLEVEL%

if %TASK_ERR% equ 0 (
  schtasks /run /tn "%TASK_NAME%" >nul 2>&1
  timeout /t 3 /nobreak >nul
  echo.
  echo  ================================================
  echo   Installation complete.
  echo  ================================================
  echo.
  echo   Task name : %TASK_NAME%
  echo   Account   : NetworkService ^(limited privileges^)
  echo   Runs at   : System startup
  echo.
  echo   Useful commands:
  echo     Start now : schtasks /run /tn "%TASK_NAME%"
  echo     Stop      : schtasks /end /tn "%TASK_NAME%"
  echo     Remove    : schtasks /delete /tn "%TASK_NAME%" /f
  echo.
  echo   Server started. Open Chrome and go to:
  echo   http://localhost:3000
  echo.
) else (
  echo.
  echo  ERROR: Could not register the scheduled task.
  echo  This may be a Group Policy restriction on this machine.
  echo.
  echo  Alternative: place a shortcut to run.bat in your
  echo  Windows Startup folder to launch on login:
  echo    %%APPDATA%%\Microsoft\Windows\Start Menu\Programs\Startup
  echo.
)

pause
