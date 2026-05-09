@echo off
schtasks /run /tn "ShiftPointServer" >nul 2>&1
if %ERRORLEVEL% equ 0 (
  echo ShiftPoint server started.
  echo Open http://localhost:3000 in Chrome.
) else (
  echo Scheduled task not found. Running directly...
  start /min cmd /c "%~dp0run.bat"
)
pause
