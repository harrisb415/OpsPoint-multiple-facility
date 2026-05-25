@echo off
title OpsPoint — Generate HTTPS Certificate
cd /d "%~dp0"

echo.
echo  ================================================
echo   OpsPoint — Self-Signed Certificate Setup
echo  ================================================
echo.

:: ── Check for Node.js ─────────────────────────────────────────────
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
  echo  ERROR: Node.js is not installed.
  echo  Download from https://nodejs.org  ^(click "LTS"^)
  echo.
  pause
  exit /b 1
)

:: ── Already have certs? ───────────────────────────────────────────
if exist data\cert.pem if exist data\key.pem (
  echo  Certificate files already exist:
  echo    data\cert.pem
  echo    data\key.pem
  echo.
  set /p _overwrite=" Overwrite existing certificate? (y/N): "
  if /i not "%_overwrite%"=="y" (
    echo  Skipped. Existing certificate kept.
    echo.
    goto :install_cert
  )
  echo.
)

:: ── Install selfsigned package if missing ─────────────────────────
if not exist node_modules\selfsigned\ (
  echo  Installing selfsigned package...
  npm install selfsigned --no-audit --no-fund
  if %ERRORLEVEL% neq 0 (
    echo.
    echo  ERROR: npm install failed.
    echo.
    pause
    exit /b 1
  )
  echo  Package installed.
  echo.
)

:: ── Generate the certificate ──────────────────────────────────────
echo  Generating self-signed certificate ^(10-year validity^)...
node generate_cert.js
if %ERRORLEVEL% neq 0 (
  echo.
  echo  ERROR: Certificate generation failed. See message above.
  echo.
  pause
  exit /b 1
)

echo.
echo  ================================================
echo   Certificate files created:
echo     data\cert.pem
echo     data\key.pem
echo  ================================================
echo.

::─────────────────────────────────────────────────────────────────
:install_cert
:: ── Install cert into Windows Trust Store ─────────────────────────
echo  Installing certificate to Windows Trusted Root CA store...
echo  ^(This lets Chrome trust the certificate and save passwords^)
echo.

:: Write a small helper script so the elevated process has the exact path
echo certutil -addstore -f Root "%CD%\data\cert.pem" > "%TEMP%\sp_certinstall.bat"

net session >nul 2>&1
if %ERRORLEVEL% equ 0 (
  :: Already running as administrator — run directly
  call "%TEMP%\sp_certinstall.bat" >nul 2>&1
  if %ERRORLEVEL% equ 0 (
    echo  Certificate trusted successfully.
  ) else (
    echo  WARNING: certutil failed. Try running this file as Administrator.
  )
) else (
  :: Not admin — a UAC prompt will appear, click Yes
  echo  A UAC prompt will appear ^(click Yes^)...
  echo.
  powershell -Command "Start-Process cmd -ArgumentList '/c ""%TEMP%\sp_certinstall.bat""' -Verb RunAs -Wait"
  if %ERRORLEVEL% equ 0 (
    echo  Certificate trusted successfully.
  ) else (
    echo  WARNING: Could not install certificate automatically.
    echo  To install manually, right-click this file and choose
    echo  "Run as administrator".
  )
)

del "%TEMP%\sp_certinstall.bat" >nul 2>&1

echo.
echo  ================================================
echo   All done!
echo.
echo   NEXT STEPS:
echo    1. Restart Chrome completely ^(close all windows^)
echo    2. Run OpsPoint ^(run.bat^)
echo    3. Chrome will trust the site and offer to save
echo       your password when you log in
echo  ================================================
echo.
pause
