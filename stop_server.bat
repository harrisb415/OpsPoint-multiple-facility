@echo off
echo Stopping OpsPoint server...
schtasks /end /tn "OpsPointServer" >nul 2>&1
taskkill /f /im node.exe >nul 2>&1
echo Done.
pause
