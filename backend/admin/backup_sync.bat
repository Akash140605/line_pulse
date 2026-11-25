@echo off
REM Keeps the local backup copies (EMS_Backup_Line1..4 on this PC) up to date.
REM Only new scans are copied, so a run normally takes a few seconds. Lines that are offline are skipped.
REM Run it every 5 minutes with Windows Task Scheduler (see README / command below).
REM   schtasks /create /tn "EMS Backup Sync" /sc minute /mo 5 /tr "C:\xampp\htdocs\ems-dashboard\backend\admin\backup_sync.bat"
for %%L in (1 2 3 4) do (
  curl -s -m 170 "http://localhost:8080/ems-dashboard/backend/admin/mirror_sync.php?line=%%L&budget=120" > "%TEMP%\ems_backup_sync_line%%L.json"
)
