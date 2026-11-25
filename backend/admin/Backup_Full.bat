@echo off
REM Line Pulse: COMPLETE backup - all data of every line (local backup copies) + software database + complete software, as one zip.
REM Output: C:\EMS_Backups\LinePulse_Full_Backup_<date>.zip   (another drive:  Backup_Full.bat D:\EMS_Backups)
set OUT=%~1
if "%OUT%"=="" set OUT=C:\EMS_Backups
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0full_backup.ps1" -Mode Full -Out "%OUT%"
pause
