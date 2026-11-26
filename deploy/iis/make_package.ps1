# Line Pulse - make the install package for the IIS server, ON THE APACHE SERVER (192.168.2.111).
#
#     powershell -ExecutionPolicy Bypass -File make_package.ps1
#
# Out: C:\LinePulse_Deploy162\LinePulse_162.zip  - copy it to 192.168.2.162 (Remote Desktop copy/paste), unpack, run setup.ps1
# The settings and data (database password, logins, entries) go into config_data.zip inside it, copied as they are:
# this script never opens or shows them. Delete the package everywhere once setup is done.

param(
  [string]$Src = 'C:\xampp\htdocs\ems-dashboard',
  [string]$PhpSrc = 'C:\xampp\php',
  [string]$Out = 'C:\LinePulse_Deploy162'
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$pkg = Join-Path $Out 'LinePulse_162'
if (Test-Path $pkg) { $old = "$Out\_old_$(Get-Date -Format yyyyMMdd_HHmmss)"; Move-Item $pkg $old; Write-Host "earlier package moved to $old" }
New-Item -ItemType Directory -Force -Path "$pkg\php\ext" | Out-Null

# 1. PHP: the program, its DLLs and the extensions php.ini loads (not XAMPP's docs, PEAR, samples)
Get-ChildItem $PhpSrc -File | Where-Object { $_.Extension -in '.exe', '.dll' } | Copy-Item -Destination "$pkg\php"
$ext = 'php_bz2', 'php_curl', 'php_fileinfo', 'php_gettext', 'php_mbstring', 'php_exif', 'php_mysqli', 'php_pdo_mysql', 'php_pdo_sqlite', 'php_openssl', 'php_ftp', 'php_opcache', 'php_sqlsrv_82_ts_x64', 'php_pdo_sqlsrv_82_ts_x64'
foreach ($e in $ext) { Copy-Item "$PhpSrc\ext\$e.dll" "$pkg\php\ext\" }
# the Visual C++ runtime PHP needs, next to php-cgi.exe (works even when the server has no VC++ redistributable)
foreach ($d in 'vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll') { $p = Join-Path $env:windir "System32\$d"; if (Test-Path $p) { Copy-Item $p "$pkg\php\" } }

# 2. scripts
foreach ($f in 'setup.ps1', 'update.ps1', 'php.ini.template', 'README.txt') { Copy-Item "$here\$f" $pkg }
Copy-Item "$here\app_snapshot.zip" $pkg

# 3. settings and data, copied unopened (lock files left out: they belong to this server's running PHP)
$cfg = Join-Path $pkg 'config_data.zip'
$z = [IO.Compression.ZipFile]::Open($cfg, 'Create')
$n = 0
try {
  foreach ($f in @(Get-Item "$Src\backend\config\db.php") + @(Get-ChildItem "$Src\backend\config" -Filter *.ini -File) + @(Get-ChildItem "$Src\backend\data" -Recurse -File -Force | Where-Object { $_.Extension -ne '.lock' })) {
    $rel = $f.FullName.Substring("$Src\backend\".Length) -replace '\\', '/'
    try { [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z, $f.FullName, $rel, 'Optimal') | Out-Null; $n++ }
    catch { $tmp = [IO.Path]::GetTempFileName(); Copy-Item $f.FullName $tmp -Force; [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z, $tmp, $rel, 'Optimal') | Out-Null; Remove-Item $tmp; $n++ }
  }
} finally { $z.Dispose() }
Write-Host "settings and data: $n files"

# 4. one zip to carry
$zip = Join-Path $Out 'LinePulse_162.zip'
if (Test-Path $zip) { Move-Item $zip "$Out\_old_LinePulse_162_$(Get-Date -Format yyyyMMdd_HHmmss).zip" }
[IO.Compression.ZipFile]::CreateFromDirectory($pkg, $zip, 'Optimal', $false)
$mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host "Package: $zip ($mb MB)" -ForegroundColor Green
