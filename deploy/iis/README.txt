LINE PULSE ON 192.168.2.162 (IIS + PHP)                                   26-11-2026
=====================================================================================

INSTALL (once)
  1. Copy LinePulse_162.zip to 192.168.2.162 (Remote Desktop: copy on this PC, paste there), e.g. to C:\Setup
  2. Right-click the zip > Extract All
  3. Start > PowerShell > right-click > Run as Administrator, then:
        cd C:\Setup\LinePulse_162
        powershell -ExecutionPolicy Bypass -File .\setup.ps1
     If Git for Windows is installed, setup clones the software from GitHub (a GitHub sign-in window may
     open - sign in with the account that owns line_pulse). Without Git it uses the copy inside the package.
  4. Open  http://192.168.2.162/ems-dashboard/frontend/dist/   (same logins as 192.168.2.111)
  5. Delete LinePulse_162.zip and the extracted folder (they hold the database password and the logins).

  setup.ps1 prints a list of anything still missing. The usual one: "ODBC Driver 18 for SQL Server" (x64)
  from Microsoft - install it and run setup.ps1 again (running it again is safe, data is never overwritten).

UPDATE (every new version)
  The software and the built app (frontend\dist) are in GitHub: Akash140605/line_pulse, branch main.
  Push there, then on 192.168.2.162:
        powershell -ExecutionPolicy Bypass -File C:\LinePulse\app\deploy\iis\update.ps1
  Only the software changes. Database settings (backend\config\db.php) and data (backend\data: users,
  settings, entries) are not in git and are never touched.

WHERE THINGS ARE
  C:\LinePulse\app     the software (git copy)        C:\LinePulse\php    PHP 8.2 (same build as .111)
  C:\LinePulse\logs    php_error.log                  C:\LinePulse\tmp    PHP temp / sessions
  IIS: app pool "LinePulse", application /ems-dashboard under "Default Web Site" (port 80).
  The site that was already on port 80 is not changed.

GOOD TO KNOW
  - 192.168.2.111 keeps running as it is. Each server keeps its OWN settings and entries from the day of the
    copy: an entry made on one is not seen on the other. Use one of them for data entry.
  - Settings database: like .111 the software first tries the SQL Server on its own PC (EMS_LinePulse_App,
    Windows login of the web server). If that is not possible it keeps the settings in backend\data (JSON),
    which works the same.
  - The line databases must be reachable from 192.168.2.162 (same addresses as in db.php).
