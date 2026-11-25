@echo off
REM Line Pulse: the complete SOFTWARE (with its settings and entries) as one zip, to run it on any PC.
REM Output: C:\EMS_Backups\LinePulse_Software_Backup_<date>.zip
set OUT=%~1
if "%OUT%"=="" set OUT=C:\EMS_Backups
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0full_backup.ps1" -Mode Software -Out "%OUT%"
pause
