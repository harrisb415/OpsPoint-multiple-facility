@echo off
:: OpsPoint — restore the most recent pre-update code backup.
:: Use this only if an update left the server unable to start.
:: The database is NOT touched (migrations are additive); a pre-update DB copy
:: is preserved separately under data\backups\ if you ever need it.
setlocal
cd /d "%~dp0"

set "PTR=data\updates\last-backup.txt"
if not exist "%PTR%" (
  echo No backup pointer found ^(%PTR%^). Nothing to restore.
  pause & exit /b 1
)
set /p BACKUP=<"%PTR%"
if not exist "%BACKUP%" (
  echo Recorded backup folder is missing:
  echo   %BACKUP%
  pause & exit /b 1
)

echo Restoring code from:
echo   %BACKUP%
echo.
copy /y "%BACKUP%\server.js"          server.js          >nul 2>&1
copy /y "%BACKUP%\updater.js"         updater.js         >nul 2>&1
copy /y "%BACKUP%\db.js"              db.js              >nul 2>&1
copy /y "%BACKUP%\package.json"       package.json       >nul 2>&1
copy /y "%BACKUP%\package-lock.json"  package-lock.json  >nul 2>&1
robocopy "%BACKUP%\migrations"   migrations    /MIR >nul 2>&1
robocopy "%BACKUP%\client\dist"  client\dist   /MIR >nul 2>&1

echo.
echo Done. Start the server again with run.bat
pause
