@echo off
echo Stopping ShiftPoint server...
schtasks /end /tn "ShiftPointServer" >nul 2>&1
taskkill /f /im node.exe >nul 2>&1
echo Done.
pause
