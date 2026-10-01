@echo off
rem OpsPoint Setup (the Start menu entry): the maintenance menu, or the command line
rem when given a command, e.g.  opspoint doctor
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0opspoint.ps1" %*
