<#
  Line Pulse - complete backup (24-11-2026)

  Full      : all production data of every line (the local backup copies EMS_Backup_Line<N> on this PC, which hold
              everything since the first copy) + the software's own database + the complete software, in one zip.
  Software  : only the complete software (with its settings and saved entries) + setup files, to run it on another PC.

  The line servers are only READ (and only by the normal backup copy run, before the backup, unless -SkipSync).
  Nothing is changed or deleted: the databases are saved with COPY_ONLY (does not touch the normal backup chain).

  Run (double-click):  Backup_Full.bat   or   Backup_Software.bat     (both in this folder)
  Or:  powershell -ExecutionPolicy Bypass -File full_backup.ps1 -Mode Full -Out D:\EMS_Backups
       -SkipSync  do not bring the backup copies up to date first
       -NoCsv     no CSV files (only the .bak database files) - much faster for very large lines
       -Lines 1,2,3,4
#>
param(
  [ValidateSet('Full', 'Software')][string]$Mode = 'Full',
  [string]$Out = 'C:\EMS_Backups',
  [switch]$SkipSync,
  [switch]$NoCsv,
  [int[]]$Lines = @(1, 2, 3, 4),
  [string]$Sql = 'localhost',
  [int]$SplitRows = 200000
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$App = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)          # ...\htdocs\ems-dashboard
$Xampp = Split-Path -Parent (Split-Path -Parent $App)                  # ...\xampp
$stamp = Get-Date -Format 'yyyy-MM-dd_HHmm'
$name = "LinePulse_${Mode}_Backup_$stamp"
$root = Join-Path $Out $name
New-Item -ItemType Directory -Force -Path $root | Out-Null
$log = Join-Path $root 'backup_log.txt'
$manifest = New-Object System.Collections.Generic.List[string]

function Log([string]$m) {
  $l = '[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $m
  Write-Host $l
  Add-Content -Path $log -Value $l -Encoding UTF8
}
function Md5([string]$p) { (Get-FileHash -Algorithm MD5 -Path $p).Hash.ToLower() }
function Size([long]$b) { if ($b -ge 1GB) { '{0:N2} GB' -f ($b / 1GB) } elseif ($b -ge 1MB) { '{0:N1} MB' -f ($b / 1MB) } else { '{0:N0} KB' -f ($b / 1KB) } }

# ───────────────────────── SQL Server (this PC, Windows login) ─────────────────────────
function Open-Sql([string]$db) {
  $cs = "Server=$Sql;Database=$db;Integrated Security=SSPI;TrustServerCertificate=True;Connect Timeout=15"
  $c = New-Object System.Data.SqlClient.SqlConnection $cs
  $c.Open(); return $c
}
function Q($c, [string]$sql) {
  $cmd = $c.CreateCommand(); $cmd.CommandText = $sql; $cmd.CommandTimeout = 0
  $t = New-Object System.Data.DataTable
  $r = $cmd.ExecuteReader(); try { $t.Load($r) } finally { $r.Close() }
  return , $t
}
function X($c, [string]$sql) { $cmd = $c.CreateCommand(); $cmd.CommandText = $sql; $cmd.CommandTimeout = 0; [void]$cmd.ExecuteNonQuery() }
function N($v) { if ($null -eq $v -or $v -is [DBNull]) { [long]0 } else { [long]$v } }
function QName([string]$n) { '[' + $n.Replace(']', ']]') + ']' }
function Esc([string]$s) { if ($s.IndexOfAny([char[]]@(',', '"', "`r", "`n")) -ge 0) { '"' + $s.Replace('"', '""') + '"' } else { $s } }

# one query -> one CSV (UTF-8 with BOM, opens in Excel), streamed row by row
function Write-Csv($c, [string]$sql, [string]$path, [switch]$SkipEmpty) {
  $cmd = $c.CreateCommand(); $cmd.CommandText = $sql; $cmd.CommandTimeout = 0
  $r = $cmd.ExecuteReader()
  $w = $null
  $inv = [Globalization.CultureInfo]::InvariantCulture
  $rows = 0
  try {
    $n = $r.FieldCount
    $vals = New-Object string[] $n
    $head = New-Object string[] $n
    for ($i = 0; $i -lt $n; $i++) { $head[$i] = Esc $r.GetName($i) }
    $open = {
      $script:csvW = New-Object System.IO.StreamWriter($path, $false, (New-Object System.Text.UTF8Encoding($true)))
      $script:csvW.WriteLine([string]::Join(',', $head))
    }
    if (-not $SkipEmpty) { & $open; $w = $script:csvW }
    while ($r.Read()) {
      if ($null -eq $w) { & $open; $w = $script:csvW }
      for ($i = 0; $i -lt $n; $i++) {
        if ($r.IsDBNull($i)) { $vals[$i] = ''; continue }
        $v = $r.GetValue($i)
        if ($v -is [datetime]) { $vals[$i] = $v.ToString('yyyy-MM-dd HH:mm:ss.fff', $inv) }
        elseif ($v -is [byte[]]) { $vals[$i] = '0x' + [BitConverter]::ToString($v).Replace('-', '') }
        elseif ($v -is [IFormattable]) { $vals[$i] = Esc ($v.ToString($null, $inv)) }
        else { $vals[$i] = Esc ([string]$v) }
      }
      $w.WriteLine([string]::Join(',', $vals)); $rows++
      if (($rows % 200000) -eq 0) { Write-Host ("      ... {0:N0} rows" -f $rows) }
    }
  } finally { if ($w) { $w.Close() }; $r.Close() }
  return $rows
}

# BACKUP DATABASE ... COPY_ONLY: straight into the backup folder; when the SQL Server service may not write there,
# into its own backup folder first, then moved here
function Backup-Db($c, [string]$db, [string]$dir) {
  $file = Join-Path $dir "$db.bak"
  $opts = @('COPY_ONLY, INIT, CHECKSUM, COMPRESSION', 'COPY_ONLY, INIT, CHECKSUM')   # Express has no COMPRESSION
  $done = $false; $lastErr = $null
  foreach ($o in $opts) {
    try { X $c "BACKUP DATABASE $(QName $db) TO DISK = N'$($file.Replace("'", "''"))' WITH $o"; $done = $true; break } catch { $lastErr = $_ }
  }
  if (-not $done) {
    $def = (Q $c "SELECT CAST(SERVERPROPERTY('InstanceDefaultBackupPath') AS nvarchar(400)) AS p").Rows[0].p
    if (-not $def -or $def -is [DBNull]) { throw "Backup of $db failed: $lastErr" }
    $tmp = Join-Path $def "$db`_$stamp.bak"
    foreach ($o in $opts) {
      try { X $c "BACKUP DATABASE $(QName $db) TO DISK = N'$($tmp.Replace("'", "''"))' WITH $o"; $done = $true; break } catch { $lastErr = $_ }
    }
    if (-not $done) { throw "Backup of $db failed: $lastErr" }
    Move-Item -LiteralPath $tmp -Destination $file
  }
  return $file
}

# ───────────────────────── 1. software (complete) ─────────────────────────
function Copy-Software([string]$dest) {
  Log 'Copying the software ...'
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  # /E all folders, no node_modules / old file lists / lock files; nothing is removed anywhere
  & robocopy $App $dest /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP /XD (Join-Path $App '_to_delete') (Join-Path $App 'frontend\node_modules') (Join-Path $App '.git') /XF '*.lock' | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE)" }
  $files = Get-ChildItem -LiteralPath $dest -Recurse -File
  $sz = ($files | Measure-Object Length -Sum).Sum
  Log ("  software: {0:N0} files, {1}" -f $files.Count, (Size $sz))
  $manifest.Add("Software: $($files.Count) files, $(Size $sz)  (from $App)")
}

# ───────────────────────── 2. setup files for a new PC ─────────────────────────
function Write-Setup([string]$dir) {
  Log 'Writing the setup files ...'
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $ext = Join-Path $dir 'php_ext'
  New-Item -ItemType Directory -Force -Path $ext | Out-Null
  Get-ChildItem -Path (Join-Path $Xampp 'php\ext') -Filter '*sqlsrv*.dll' -ErrorAction SilentlyContinue | Copy-Item -Destination $ext
  $ini = Join-Path $Xampp 'php\php.ini'
  $phpv = ''
  try { $phpv = (& (Join-Path $Xampp 'php\php.exe') -v 2>$null | Select-Object -First 1) } catch {}
  $iniLines = @()
  if (Test-Path $ini) { $iniLines = Select-String -Path $ini -Pattern '^\s*extension\s*=.*(sqlsrv|pdo|mbstring|openssl|zip|gd|fileinfo|intl)' | ForEach-Object { $_.Line.Trim() } }
  $odbc = @()
  try { $odbc = (Get-ItemProperty 'HKLM:\SOFTWARE\ODBC\ODBCINST.INI\ODBC Drivers' -ErrorAction Stop).PSObject.Properties | Where-Object { $_.Name -like '*SQL Server*' } | ForEach-Object { $_.Name } } catch {}
  $listen = @()
  $httpd = Join-Path $Xampp 'apache\conf\httpd.conf'
  if (Test-Path $httpd) { $listen = Select-String -Path $httpd -Pattern '^\s*Listen\s' | ForEach-Object { $_.Line.Trim() }; Copy-Item $httpd (Join-Path $dir 'httpd.conf (this PC, for reference)') }
  @(
    'This PC (when the backup was made)'
    "  PHP            : $phpv"
    "  ODBC drivers   : $($odbc -join ', ')"
    "  Apache         : $($listen -join ', ')"
    '  php.ini lines  :'
  ) + ($iniLines | ForEach-Object { "      $_" }) | Set-Content -Path (Join-Path $dir 'this_pc.txt') -Encoding UTF8
  $restore = @('-- Restore the backup databases on a new PC (SQL Server Management Studio or sqlcmd -E -S localhost -i restore_databases.sql).',
    '-- Change the folder below to where the .bak files are. MOVE puts the data files in the SQL Server default folder.', '',
    "DECLARE @dir nvarchar(400) = N'C:\EMS_Restore\';", '')
  foreach ($db in $script:savedDbs) {
    $restore += "-- $db"
    $restore += "RESTORE DATABASE [$db] FROM DISK = @dir + N'$db.bak' WITH REPLACE, RECOVERY;"
    $restore += ''
  }
  $restore += '-- If the folders of the original PC do not exist, list the files first:  RESTORE FILELISTONLY FROM DISK = N''...\name.bak''  and add  MOVE ''<logical>'' TO ''<new path>''.'
  $restore | Set-Content -Path (Join-Path $dir 'restore_databases.sql') -Encoding UTF8
}

function Write-Readme([string]$path) {
  $port = '8080'
  $dataPart = ''
  $offlinePart = ''
  if ($Mode -eq 'Full') {
    $dataPart = @(
      '  1_Line_Data\Line<N>\EMS_Backup_Line<N>.bak   the complete data of the line (SQL Server backup, every table, since the first copy)'
      '  1_Line_Data\Line<N>\tables\*.csv             the same data as CSV (opens in Excel); big tables are one file per year'
      '  1_Line_Data\Line<N>\tables.txt               every table with its row count'
      '  2_App_Database\EMS_LinePulse_App.bak         the software''s own database (model master, settings, loss/OLE/RCA entries, users)'
      '  2_App_Database\stores\*.json                 the same entries as JSON'
    ) -join "`r`n"
    $offlinePart = @(
      '  6. Without the line network (or to look at old data): install SQL Server (Express is enough) on the PC, put the .bak files'
      '     in C:\EMS_Restore\ and run 4_Setup\restore_databases.sql. The screens then show the data from these copies'
      '     (marked "BACKUP") when a line cannot be reached.'
    ) -join "`r`n"
  }
  @"
LINE PULSE - $Mode backup, made $(Get-Date -Format 'dd-MM-yyyy HH:mm') on $env:COMPUTERNAME
==========================================================================================

WHAT IS INSIDE
$dataPart
  3_Software\ems-dashboard\                    the complete software, ready to run (frontend\dist = the screens, backend = PHP)
                                               backend\data = settings and entries saved by the screens
  4_Setup\                                     PHP SQL Server drivers of this PC, php.ini lines, restore_databases.sql
  manifest.txt                                 counts, sizes and MD5 of every file in this backup
  backup_log.txt                               what was done

KEEP THIS ZIP SAFE: backend\config\db.php holds the passwords of the line databases, backend\data holds the users
(password hashes) and the login key.

RUN THE SOFTWARE ON ANOTHER PC
  1. Install XAMPP (same PHP version as in 4_Setup\this_pc.txt) and the "Microsoft ODBC Driver 17 or 18 for SQL Server".
  2. Copy 4_Setup\php_ext\*.dll into xampp\php\ext and add the extension lines of 4_Setup\this_pc.txt to xampp\php\php.ini.
  3. Copy 3_Software\ems-dashboard into xampp\htdocs\  (the folder name may be changed).
  4. Start Apache and open   http://localhost:$port/ems-dashboard/frontend/dist/
     (port as set in xampp\apache\conf\httpd.conf "Listen"; other PCs: http://<this-pc-address>:<port>/ems-dashboard/frontend/dist/)
     The screens always ask the server they were opened from - no address to change.
  5. Live data: the PC needs a network path to the line SQL Servers (addresses in backend\config\db.php).
$offlinePart
"@ | Set-Content -Path $path -Encoding UTF8
}

# ───────────────────────── run ─────────────────────────
$script:savedDbs = @()
$t0 = Get-Date
Log "Line Pulse $Mode backup -> $root"
try {
  if ($Mode -eq 'Full') {
    if (-not $SkipSync) {
      Log 'Bringing the backup copies up to date (line servers only read) ...'
      foreach ($L in $Lines) {
        for ($k = 1; $k -le 40; $k++) {
          try {
            $res = Invoke-RestMethod -Uri "http://localhost:8080/ems-dashboard/backend/admin/mirror_sync.php?line=$L&budget=120" -TimeoutSec 200
            if ($res.error) { Log "  Line ${L}: $($res.error) (skipped - the backup has the data up to its last copy)"; break }
            if ($res.busy) { Log "  Line ${L}: a copy run is already working, waiting 20 s"; Start-Sleep 20; continue }
            if ($res.done) { Log "  Line ${L}: up to date"; break }
            Log "  Line ${L}: still copying (run $k) ..."
          } catch { Log "  Line ${L}: not reached ($($_.Exception.Message)) - the backup has the data up to its last copy"; break }
        }
      }
    }
    $master = Open-Sql 'master'
    $dbs = Q $master "SELECT name, (SELECT SUM(CAST(size AS bigint)) * 8192 FROM sys.master_files f WHERE f.database_id = d.database_id) AS bytes
                    FROM sys.databases d WHERE name LIKE 'EMS[_]Backup[_]Line%' OR name = 'EMS_LinePulse_App' ORDER BY name"
    if ($dbs.Rows.Count -eq 0) { throw "No EMS_Backup_Line databases found on $Sql (is the backup copy set up?)" }
    $need = (($dbs.Rows | ForEach-Object { N $_.bytes }) | Measure-Object -Sum).Sum * 2
    $free = (Get-PSDrive -Name ($root.Substring(0, 1))).Free
    Log ("Databases: {0}; space needed about {1}, free {2}" -f (($dbs.Rows | ForEach-Object { $_.name }) -join ', '), (Size $need), (Size $free))
    if ($free -lt $need) { Log 'WARNING: the drive may be too small - use -Out on another drive or -NoCsv.' }

    foreach ($row in $dbs.Rows) {
      $db = [string]$row.name
      if ($db -eq 'EMS_LinePulse_App') { $dir = Join-Path $root '2_App_Database' }
      else { $n = $db.Substring('EMS_Backup_Line'.Length); $dir = Join-Path $root "1_Line_Data\Line$n" }
      New-Item -ItemType Directory -Force -Path $dir | Out-Null
      Log "$db : database backup ..."
      $bak = Backup-Db $master $db $dir
      $script:savedDbs += $db
      $manifest.Add("$db.bak  $(Size (Get-Item $bak).Length)  md5 $(Md5 $bak)")
      $c = Open-Sql $db
      try {
        if ($db -eq 'EMS_LinePulse_App') {
          $sd = Join-Path $dir 'stores'; New-Item -ItemType Directory -Force -Path $sd | Out-Null
          try {
            foreach ($s in (Q $c 'SELECT Name, Doc FROM dbo.AppStore ORDER BY Name').Rows) {
              $f = Join-Path $sd (($s.Name -replace '[^\w\-]', '_') + '.json')
              [IO.File]::WriteAllText($f, [string]$s.Doc, (New-Object System.Text.UTF8Encoding($false)))
            }
            Log "  stores as JSON: $((Get-ChildItem $sd).Count) files"
          } catch { Log "  stores as JSON: skipped ($($_.Exception.Message))" }
          continue
        }
        $tabs = Q $c "SELECT s.name AS sch, t.name AS tbl, (SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id = t.object_id AND p.index_id IN (0, 1)) AS n
                      FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE t.is_ms_shipped = 0 ORDER BY s.name, t.name"
        $list = @("Tables of $db  (rows)")
        foreach ($t in $tabs.Rows) { $list += ('  {0}.{1}  {2:N0}' -f $t.sch, $t.tbl, (N $t.n)) }
        $list | Set-Content -Path (Join-Path $dir 'tables.txt') -Encoding UTF8
        $manifest.Add("  $($tabs.Rows.Count) tables, $(('{0:N0}' -f (($tabs.Rows | ForEach-Object { N $_.n }) | Measure-Object -Sum).Sum)) rows")
        if ($NoCsv) { continue }
        $td = Join-Path $dir 'tables'; New-Item -ItemType Directory -Force -Path $td | Out-Null
        foreach ($t in $tabs.Rows) {
          if ($t.tbl -eq '_MirrorState') { $sub = '_copy_state' } else { $sub = $t.tbl }
          $full = "$(QName $t.sch).$(QName $t.tbl)"
          $base = if ($t.sch -eq 'dbo') { $sub } else { "$($t.sch)_$sub" }
          $base = $base -replace '[^\w\-]', '_'
          $dcol = $null
          if ((N $t.n) -gt $SplitRows) {
            $dc = Q $c "SELECT TOP 1 c.name FROM sys.columns c JOIN sys.types ty ON ty.user_type_id = c.user_type_id
                        WHERE c.object_id = OBJECT_ID(N'$($full.Replace("'", "''"))') AND ty.name IN ('datetime', 'datetime2', 'smalldatetime', 'date') ORDER BY c.column_id"
            if ($dc.Rows.Count) { $dcol = [string]$dc.Rows[0].name }
          }
          if ($dcol) {
            # first and last year by MIN / MAX (no sort, so no memory grant on a busy SQL Server); a year without rows makes no file
            $mm = (Q $c "SELECT YEAR(MIN($(QName $dcol))) AS a, YEAR(MAX($(QName $dcol))) AS b FROM $full").Rows[0]
            $ys = @(); if (-not ($mm.a -is [DBNull])) { $ys = [int]$mm.a..[int]$mm.b }
            foreach ($yy in $ys) {
              Log "  $base $yy ..."
              $rows = Write-Csv $c "SELECT * FROM $full WHERE $(QName $dcol) >= '$yy-01-01' AND $(QName $dcol) < '$($yy + 1)-01-01'" (Join-Path $td "${base}_$yy.csv") -SkipEmpty
              if ($rows -gt 0) { $manifest.Add(("  {0}_{1}.csv  {2:N0} rows" -f $base, $yy, $rows)) }
            }
            $nul = [long](Q $c "SELECT COUNT_BIG(*) AS n FROM $full WHERE $(QName $dcol) IS NULL").Rows[0].n
            if ($nul -gt 0) { $rows = Write-Csv $c "SELECT * FROM $full WHERE $(QName $dcol) IS NULL" (Join-Path $td "${base}_no_date.csv"); $manifest.Add(("  {0}_no_date.csv  {1:N0} rows" -f $base, $rows)) }
          } else {
            Log "  $base ..."
            $rows = Write-Csv $c "SELECT * FROM $full" (Join-Path $td "$base.csv")
            $manifest.Add(("  {0}.csv  {1:N0} rows" -f $base, $rows))
          }
        }
      } finally { $c.Close() }
    }
    $master.Close()
  }

  Copy-Software (Join-Path $root '3_Software\ems-dashboard')
  Write-Setup (Join-Path $root '4_Setup')
  Write-Readme (Join-Path $root 'README_FIRST.txt')
  (@("Line Pulse $Mode backup  $(Get-Date -Format 'dd-MM-yyyy HH:mm')  PC $env:COMPUTERNAME", '') + $manifest) | Set-Content -Path (Join-Path $root 'manifest.txt') -Encoding UTF8

  Log 'Making the zip ...'
  $zip = "$root.zip"
  [IO.Compression.ZipFile]::CreateFromDirectory($root, $zip, [IO.Compression.CompressionLevel]::Optimal, $true)
  $zs = (Get-Item $zip).Length
  Log ("DONE in {0:N0} min:  {1}  ({2})" -f ((Get-Date) - $t0).TotalMinutes, $zip, (Size $zs))
  Log "The unzipped folder is kept next to it: $root  (can be deleted after the zip is copied somewhere safe)"
} catch {
  Log "FAILED: $($_.Exception.Message)"
  exit 1
}
