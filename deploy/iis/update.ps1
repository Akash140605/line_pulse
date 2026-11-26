# Line Pulse - bring the newest version from GitHub onto this IIS server (192.168.2.162).
#
#     powershell -ExecutionPolicy Bypass -File C:\LinePulse\app\deploy\iis\update.ps1
#
# Only files that are in git change. backend\config\db.php and backend\data (users, settings, entries) are not in git,
# so they are never touched. The built app (frontend\dist) is in git: no Node.js / build is needed on this server.
# If a file of the software was changed by hand on this server, nothing is updated and the file is named.

param([string]$Root = 'C:\LinePulse', [string]$Pool = 'LinePulse', [string]$Repo = 'https://github.com/Akash140605/line_pulse.git', [string]$Branch = 'main')

$ErrorActionPreference = 'Stop'
$App = Join-Path $Root 'app'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Write-Host 'Git for Windows is not installed: https://git-scm.com/download/win' -ForegroundColor Red; exit 1 }
Set-Location $App
function Build { try { (Get-Content "$App\frontend\dist\version.json" -Raw | ConvertFrom-Json).build } catch { '?' } }

if (-not (Test-Path "$App\.git")) {
  # first time after a snapshot install: link the folder to GitHub (files not in git - settings, data - stay as they are)
  Write-Host 'Linking this folder to GitHub (a sign-in window may open)...'
  git init -q
  git remote add origin $Repo
  git fetch -q origin $Branch
  if ($LASTEXITCODE -ne 0) { Write-Host 'git fetch failed - check the GitHub sign-in' -ForegroundColor Red; exit 1 }
  git reset -q --hard "origin/$Branch"
  git branch -q -M $Branch
  git branch -q --set-upstream-to "origin/$Branch" $Branch
  Write-Host "Linked. Now on build $(Build)" -ForegroundColor Green
  exit 0
}

$before = (git rev-parse --short HEAD); $bBuild = Build
$changed = git status --porcelain --untracked-files=no
if ($changed) {
  Write-Host 'These files of the software were changed on this server, so nothing was updated:' -ForegroundColor Yellow
  $changed | ForEach-Object { Write-Host "   $_" }
  Write-Host 'Keep the change in GitHub instead, or undo it here with:  git checkout -- <file>' -ForegroundColor Yellow
  exit 1
}
git fetch -q origin $Branch
if ($LASTEXITCODE -ne 0) { Write-Host 'git fetch failed - network or GitHub sign-in' -ForegroundColor Red; exit 1 }
git merge -q --ff-only "origin/$Branch"
if ($LASTEXITCODE -ne 0) { Write-Host 'update failed (not a fast-forward) - nothing changed' -ForegroundColor Red; exit 1 }
$after = (git rev-parse --short HEAD)

if ($before -eq $after) { Write-Host "Already the newest: $after (build $bBuild)" -ForegroundColor Green; exit 0 }
git log --oneline "$before..$after" | Select-Object -First 15 | ForEach-Object { Write-Host "   $_" }
# PHP picks up changed files by itself within 2 s (OPcache); a recycle makes it at once
& (Join-Path $env:windir 'system32\inetsrv\appcmd.exe') recycle apppool /apppool.name:$Pool | Out-Null
Write-Host "Updated $before -> $after   build $bBuild -> $(Build)" -ForegroundColor Green
Write-Host 'Open screens pick up the new build by themselves (version check), or press F5.'
