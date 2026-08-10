#requires -Version 5.1
<#
.SYNOPSIS
    Starts the local ZP_Research test server and waits for proof that the mod loaded.

.DESCRIPTION
    Waits for the line "configs loaded" in <profiles>\script_*.log instead of sleeping a
    fixed time: the FIRST boot of a diag server takes minutes (world preparation), later
    ones reach mod init in ~15 seconds. Killing a healthy-but-slow server and concluding
    "the mod is broken" is the single most common false alarm here.

    Prints the mod's own summary line, every ZP warning, and any compile error.
    Load @ZP_Research_VPP only together with @VPPAdminTools: a missing dependency is a
    BLOCKING "Addon 'X' requires addon 'Y'" dialog before load, not a silent skip.

.EXAMPLE
    .\testenv\run-server.ps1
    .\testenv\run-server.ps1 -WithVpp -Port 2402
#>
param(
    [string]$DayzRoot,
    [string]$Config,
    [string]$Profiles,
    [int]$Port = 2302,
    [int]$TimeoutMinutes = 6,
    [switch]$WithVpp,
    [switch]$Fresh
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$TestEnv  = Join-Path $RepoRoot 'testenv'

. (Join-Path $PSScriptRoot 'find-dayz.ps1')
$dayz = Find-DayzRoot -Explicit $DayzRoot

if (-not $Config)   { $Config   = Join-Path $TestEnv 'serverDZ.cfg' }
if (-not $Profiles) { $Profiles = Join-Path $TestEnv 'profiles' }
if (-not (Test-Path $Config)) { throw "no $Config — run .\testenv\prepare-testenv.ps1 first" }
New-Item -ItemType Directory -Force $Profiles | Out-Null

if ($Fresh) {
    # Wipes the mod's configs so the next boot recreates defaults. The world (persistence)
    # lives in the mission's storage_<instanceId>, not here, and is NOT touched.
    Remove-Item (Join-Path $Profiles 'ZP_Research') -Recurse -Force -ErrorAction SilentlyContinue
    Write-Output 'profile ZP_Research wiped — defaults will be recreated'
}

$mods = "$dayz\!Workshop\@CF;$RepoRoot\@ZP_Research"
if ($WithVpp) { $mods = "$dayz\!Workshop\@CF;$dayz\!Workshop\@VPPAdminTools;$RepoRoot\@ZP_Research;$RepoRoot\@ZP_Research_VPP" }
foreach ($m in $mods -split ';') {
    if (-not (Test-Path $m)) { throw "mod folder not found: $m" }
}
if (-not (Test-Path "$RepoRoot\@ZP_Research\addons\ZP_Research.pbo")) { throw "no PBO — run .\build\build.ps1 first" }

Get-ChildItem $Profiles -Filter 'script_*.log' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

$srv = Start-Process -FilePath "$dayz\DayZDiag_x64.exe" -WorkingDirectory $dayz -PassThru -ArgumentList `
    '-server', "-config=$Config", "-port=$Port", "-mod=$mods", "-profiles=$Profiles"
$srv.Id | Set-Content (Join-Path $TestEnv 'server_pid.txt')
Write-Output "server pid $($srv.Id), port $Port — waiting for 'configs loaded' (first boot takes minutes)"

$deadline = (Get-Date).AddMinutes($TimeoutMinutes)
$log = $null
while ((Get-Date) -lt $deadline) {
    if ($srv.HasExited) { throw "server exited early (code $($srv.ExitCode)) — check $Profiles\*.RPT. Missing instanceId in serverDZ.cfg causes exactly this." }
    $log = Get-ChildItem $Profiles -Filter 'script_*.log' -ErrorAction SilentlyContinue |
           Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($log -and (Select-String -Path $log.FullName -Pattern 'configs loaded' -Quiet -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Seconds 5
}
if (-not $log -or -not (Select-String -Path $log.FullName -Pattern 'configs loaded' -Quiet -EA SilentlyContinue)) {
    throw "no 'configs loaded' within $TimeoutMinutes min. A server that hangs here with no RPT error usually means a hand-written serverDZ.cfg — regenerate it with prepare-testenv.ps1 -Force."
}

Write-Output ''
Select-String -Path $log.FullName -Pattern '\[ZP_Research\]' |
    ForEach-Object { ($_.Line -replace '^.*SCRIPT\s*:\s*', '') } |
    Where-Object { $_ -notmatch 'заспавнено @' } |
    ForEach-Object { Write-Output $_ }

$rpt = Get-ChildItem $Profiles -Filter '*.RPT' -EA SilentlyContinue | Sort-Object LastWriteTime -Desc | Select-Object -First 1
if ($rpt) {
    $errs = Select-String -Path $rpt.FullName -Pattern "Bad type|Can't compile" -EA SilentlyContinue
    if ($errs) { Write-Warning "compile errors: $($errs.Count) — see $($rpt.Name)" }
}
Write-Output ''
Write-Output "running. stop it with:  .\testenv\stop-server.ps1"
