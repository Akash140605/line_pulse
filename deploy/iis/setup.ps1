# Line Pulse - first install on an IIS server (made for 192.168.2.162, 26-11-2026).
#
# Run ONCE, on the server, in PowerShell "Run as Administrator", from the unpacked package folder:
#     powershell -ExecutionPolicy Bypass -File .\setup.ps1
#
# What it does (it never touches the Apache server 192.168.2.111 or any database):
#   1. IIS features: web server, CGI (FastCGI), static compression, request filtering
#   2. PHP 8.2 (the same build as 192.168.2.111) into C:\LinePulse\php with php.ini for IIS
#   3. The software into C:\LinePulse\app - a git clone of github.com/Akash140605/line_pulse when Git is installed
#      (then update.ps1 brings every new version), otherwise the snapshot in this package
#   4. Settings and data copied from 192.168.2.111 (config_data.zip) - only when this server has none yet
#   5. IIS: app pool "LinePulse", application /ems-dashboard under "Default Web Site", PHP handler, permissions
#   6. Checks: the page, PHP, and that code / settings / data are NOT served
#
# Running it again is safe: what is already there is kept (data is never overwritten).

param(
  [string]$Root = 'C:\LinePulse',
  [string]$Site = 'Default Web Site',
  [string]$AppName = 'ems-dashboard',
  [string]$Pool = 'LinePulse',
  [string]$Repo = 'https://github.com/Akash140605/line_pulse.git'
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$appcmd = Join-Path $env:windir 'system32\inetsrv\appcmd.exe'
$App = Join-Path $Root 'app'
$Php = Join-Path $Root 'php'
$cgi = Join-Path $Php 'php-cgi.exe'
$problems = @()

function Step($t) { Write-Host ""; Write-Host "== $t" -ForegroundColor Cyan }
function Ok($t) { Write-Host "   OK   $t" -ForegroundColor Green }
function Warn($t) { Write-Host "   !!   $t" -ForegroundColor Yellow; $script:problems += $t }
function AppCmd { $out = & $appcmd @args 2>&1; if ($LASTEXITCODE -ne 0) { throw "appcmd $($args -join ' ') -> $out" }; $out }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Write-Host 'Please run this in PowerShell "Run as Administrator".' -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------- 1. IIS
Step '1. IIS features'
if (Get-Command Install-WindowsFeature -ErrorAction SilentlyContinue) {
  $r = Install-WindowsFeature Web-Server, Web-CGI, Web-Stat-Compression, Web-Filtering, Web-Http-Errors, Web-Static-Content, Web-Default-Doc
  Ok "Windows Server features ready (restart needed: $($r.RestartNeeded))"
} else {
  foreach ($f in 'IIS-WebServerRole', 'IIS-WebServer', 'IIS-CGI', 'IIS-HttpCompressionStatic', 'IIS-RequestFiltering', 'IIS-StaticContent', 'IIS-DefaultDocument') {
    Enable-WindowsOptionalFeature -Online -FeatureName $f -All -NoRestart | Out-Null
  }
  Ok 'Windows features ready'
}
if (-not (Test-Path $appcmd)) { throw 'IIS is not installed (appcmd.exe missing).' }

# ---------------------------------------------------------------- 2. PHP
Step '2. PHP 8.2 for IIS'
foreach ($d in $Root, "$Root\tmp", "$Root\logs") { New-Item -ItemType Directory -Force -Path $d | Out-Null }
if (-not (Test-Path "$here\php\php-cgi.exe")) { throw "php\php-cgi.exe is missing in the package folder $here" }
robocopy "$here\php" $Php /E /NFL /NDL /NJH /NJS /NP /XF php.ini | Out-Null
if ($LASTEXITCODE -ge 8) { throw "copying PHP failed (robocopy $LASTEXITCODE)" }
(Get-Content "$here\php.ini.template" -Raw).Replace('__ROOT__', $Root) | Set-Content -Path "$Php\php.ini" -Encoding ASCII
$mods = & "$Php\php.exe" -c "$Php\php.ini" -m 2>&1
foreach ($m in 'sqlsrv', 'pdo_sqlsrv', 'Zend OPcache', 'mbstring', 'openssl') {
  if ($mods -contains $m) { Ok "PHP module $m" } else { Warn "PHP module $m did not load (php.exe -m: $($mods -join ', '))" }
}
$odbc = @(Get-OdbcDriver -Platform 64-bit -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'ODBC Driver (17|18) for SQL Server' })
if ($odbc.Count) { Ok "SQL Server driver: $($odbc[0].Name)" }
else { Warn 'Microsoft ODBC Driver 17 or 18 for SQL Server is NOT installed - the line databases cannot be read. Install "ODBC Driver 18 for SQL Server" (x64) from https://learn.microsoft.com/sql/connect/odbc/download-odbc-driver-for-sql-server and run setup.ps1 again.' }

# ---------------------------------------------------------------- 3. the software
Step '3. The software'
$git = Get-Command git -ErrorAction SilentlyContinue
if (Test-Path "$App\.git") {
  Ok "git copy already there ($App) - use update.ps1 for new versions"
} elseif ($git -and -not (Test-Path $App)) {
  Write-Host '   Cloning from GitHub (a GitHub sign-in window may open: sign in with the account that owns line_pulse)...'
  & git clone $Repo $App
  if ($LASTEXITCODE -ne 0) { throw 'git clone failed - check the GitHub sign-in, then run setup.ps1 again' }
  Ok "cloned $Repo"
} elseif (-not (Test-Path "$App\index.html")) {
  if (-not (Test-Path "$here\app_snapshot.zip")) { throw 'app_snapshot.zip is missing in the package folder' }
  Expand-Archive -Path "$here\app_snapshot.zip" -DestinationPath $App -Force
  if ($git) { Ok 'snapshot unpacked' } else { Warn 'Git is not installed: the snapshot of this package was unpacked. Install Git for Windows (https://git-scm.com/download/win), then update.ps1 links this folder to GitHub.' }
} else {
  Ok "software already there ($App)"
}
$build = try { (Get-Content "$App\frontend\dist\version.json" -Raw | ConvertFrom-Json).build } catch { '?' }
Ok "build $build"

# ---------------------------------------------------------------- 4. settings and data
Step '4. Settings and data from 192.168.2.111'
$cfgZip = Join-Path $here 'config_data.zip'
if (Test-Path "$App\backend\config\db.php") {
  Ok 'database settings already there - kept'
} elseif (Test-Path $cfgZip) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $z = [IO.Compression.ZipFile]::OpenRead($cfgZip)
  $n = 0
  try {
    foreach ($e in $z.Entries) {
      if (-not $e.Name) { continue }
      $t = Join-Path "$App\backend" ($e.FullName -replace '/', '\')
      if (Test-Path $t) { continue }
      New-Item -ItemType Directory -Force -Path (Split-Path $t) | Out-Null
      [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $t, $false); $n++
    }
  } finally { $z.Dispose() }
  Ok "$n files of settings and data copied (users, logins, settings, entries)"
  Write-Host '   config_data.zip holds the database password and the logins: delete it from this folder and from the copy you made.' -ForegroundColor Yellow
} else {
  Warn 'config_data.zip not found and no database settings yet: copy backend\config\db.php from 192.168.2.111 to C:\LinePulse\app\backend\config\db.php'
}
New-Item -ItemType Directory -Force -Path "$App\backend\data" | Out-Null

# ---------------------------------------------------------------- 5. IIS site
Step '5. IIS: app pool, /ems-dashboard, PHP'
if (-not ((& $appcmd list apppool /name:$Pool 2>$null) -match $Pool)) { AppCmd add apppool /name:$Pool | Out-Null }
AppCmd set apppool $Pool /managedRuntimeVersion:"" /managedPipelineMode:Integrated /startMode:AlwaysRunning /processModel.idleTimeout:00:00:00 /recycling.periodicRestart.time:00:00:00 | Out-Null
Ok "app pool $Pool (no .NET, always running)"

$appPath = "$Site/$AppName"
if ((& $appcmd list app "$appPath" 2>$null) -match [regex]::Escape($AppName)) {
  AppCmd set app "$appPath" /applicationPool:$Pool | Out-Null
  AppCmd set vdir "$appPath/" /physicalPath:$App | Out-Null
} else {
  AppCmd add app /site.name:"$Site" /path:/$AppName /physicalPath:$App /applicationPool:$Pool | Out-Null
}
Ok "http://<this server>/$AppName -> $App"

# the software's web.config files remove WebDAV and set handlers: allow that below the server level
AppCmd unlock config /section:system.webServer/handlers | Out-Null
AppCmd unlock config /section:system.webServer/modules | Out-Null

$fcgi = & $appcmd list config /section:system.webServer/fastCgi
if (-not ($fcgi -match [regex]::Escape($cgi))) {
  AppCmd set config /section:system.webServer/fastCgi "/+[fullPath='$cgi',maxInstances='8',instanceMaxRequests='10000',activityTimeout='300',requestTimeout='300',idleTimeout='600']" /commit:apphost | Out-Null
  AppCmd set config /section:system.webServer/fastCgi "/+[fullPath='$cgi'].environmentVariables.[name='PHPRC',value='$Php']" /commit:apphost | Out-Null
  AppCmd set config /section:system.webServer/fastCgi "/+[fullPath='$cgi'].environmentVariables.[name='PHP_FCGI_MAX_REQUESTS',value='10000']" /commit:apphost | Out-Null
}
Ok 'FastCGI: php-cgi.exe'
$h = & $appcmd list config "$appPath" /section:system.webServer/handlers
if (-not ($h -match 'PHP_LinePulse')) {
  AppCmd set config "$appPath" /section:system.webServer/handlers "/+[@start,name='PHP_LinePulse',path='*.php',verb='GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS',modules='FastCgiModule',scriptProcessor='$cgi',resourceType='Either',requireAccess='Script']" /commit:apphost | Out-Null
}
Ok '*.php -> PHP (only under /ems-dashboard)'
# static files are read as the app pool too (not IUSR), so one set of rights is enough
AppCmd set config "$appPath" /section:system.webServer/security/authentication/anonymousAuthentication /userName:"" /commit:apphost | Out-Null

$who = "IIS AppPool\$Pool"
icacls $Root /grant "${who}:(OI)(CI)RX" /T /C /Q | Out-Null
foreach ($d in "$App\backend\data", "$Root\tmp", "$Root\logs") { icacls $d /grant "${who}:(OI)(CI)M" /T /C /Q | Out-Null }
Ok "rights: $who reads the software, writes backend\data, tmp, logs"

AppCmd recycle apppool /apppool.name:$Pool | Out-Null
Start-Sleep -Seconds 2

# ---------------------------------------------------------------- 6. checks
Step '6. Checks'
$base = "http://localhost/$AppName"
function Code($u) { try { (Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 60 -MaximumRedirection 0).StatusCode } catch { $r = $_.Exception.Response; if ($r) { [int]$r.StatusCode } else { -1 } } }
$c = Code "$base/frontend/dist/"; if ($c -eq 200) { Ok "page $c" } else { Warn "page frontend/dist/ answered $c" }
$c = Code "$base/frontend/dist/version.json"; if ($c -eq 200) { Ok "version.json $c" } else { Warn "version.json answered $c" }
$c = Code "$base/backend/api/server_time.php"; if ($c -in 200, 401, 403) { Ok "PHP answers ($c)" } else { Warn "PHP: backend/api/server_time.php answered $c (500 = see $Root\logs\php_error.log)" }
foreach ($p in 'backend/config/db.php', 'backend/data/users.json', 'backend/data/auth_secret.key', 'backend/lib/store.php', 'backend/tests/', '.git/config', 'frontend/src/App.jsx', 'deploy/iis/setup.ps1', 'frontend/package.json') {
  $c = Code "$base/$p"
  if ($c -in 403, 404) { Ok "blocked: $p ($c)" } else { Warn "NOT blocked: $p answered $c" }
}

$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -like '192.168.*' } | Select-Object -First 1).IPAddress
Write-Host ""
if ($problems.Count) {
  Write-Host "Finished with $($problems.Count) thing(s) to look at:" -ForegroundColor Yellow
  $problems | ForEach-Object { Write-Host " - $_" -ForegroundColor Yellow }
} else {
  Write-Host 'All done.' -ForegroundColor Green
}
Write-Host "Open: http://$ip/$AppName/frontend/dist/" -ForegroundColor Green
Write-Host "New versions later: powershell -ExecutionPolicy Bypass -File $App\deploy\iis\update.ps1"
