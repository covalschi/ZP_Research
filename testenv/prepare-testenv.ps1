#requires -Version 5.1
<#
.SYNOPSIS
    Prepares a local DayZ test server for ZP_Research: server config, mission, profile.

.DESCRIPTION
    Run once. It:
      1. finds the DayZ client (needs DayZDiag_x64.exe, installed with DayZ Tools)
         and, if present, the free DayZ Server app;
      2. writes testenv\serverDZ.cfg — a COPY of the stock DayZ Server config with
         three edits (see below). It never ships Bohemia's file: it copies yours;
      3. makes sure <DayZ>\mpmissions\<template> exists (the CLIENT install has no
         mpmissions at all — it is copied from the DayZ Server app);
      4. optionally seeds testenv\profiles\ZP_Research from examples\<pack>.

    WHY A COPIED CONFIG AND NOT A HAND-WRITTEN ONE
    A minimal hand-written serverDZ.cfg makes a 1.29 server hang FOREVER after the
    World module compiles: one core pinned, no mission, and not one line of error in
    the RPT. It is indistinguishable from a slow first boot. Starting from the stock
    file is the only reliable cure. The three edits are:
        verifySignatures = 2 -> 0    our locally built PBO is unsigned (no private key)
        BattlEye = 0                 no BE on a local box
        allowFilePatching = 1        DayZDiag clients use -filePatching

.EXAMPLE
    .\testenv\prepare-testenv.ps1
    .\testenv\prepare-testenv.ps1 -Example minimal
    .\testenv\prepare-testenv.ps1 -DayzRoot 'D:\Steam\steamapps\common\DayZ' -Example test-stand
#>
param(
    [string]$DayzRoot,
    [string]$ServerRoot,
    [ValidateSet('none', 'minimal', 'test-stand')]
    [string]$Example = 'none',
    [string]$Template = 'dayzOffline.chernarusplus',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$TestEnv  = Join-Path $RepoRoot 'testenv'

function Find-SteamApp {
    param([string]$Explicit, [string]$EnvValue, [string]$Leaf, [string]$Probe)
    $cands = New-Object System.Collections.Generic.List[string]
    if ($Explicit) { $cands.Add($Explicit) }
    if ($EnvValue) { $cands.Add($EnvValue) }
    $steam = New-Object System.Collections.Generic.List[string]
    try {
        $sp = (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction Stop).SteamPath
        if ($sp) { $steam.Add($sp.Replace('/', '\')) }
    } catch { }
    foreach ($p in @("${env:ProgramFiles(x86)}\Steam", "$env:ProgramFiles\Steam")) {
        if ($p -and (Test-Path $p)) { $steam.Add($p) }
    }
    foreach ($sp in @($steam)) {
        $vdf = Join-Path $sp 'steamapps\libraryfolders.vdf'
        if (Test-Path $vdf) {
            foreach ($m in [regex]::Matches((Get-Content $vdf -Raw), '"path"\s*"([^"]+)"')) {
                $steam.Add($m.Groups[1].Value.Replace('\\', '\'))
            }
        }
    }
    foreach ($sp in $steam) { $cands.Add((Join-Path $sp "steamapps\common\$Leaf")) }
    foreach ($c in $cands) { if ($c -and (Test-Path (Join-Path $c $Probe))) { return $c } }
    return $null
}

# ---- 1. the two Steam apps ---------------------------------------------------------------
$dayz = Find-SteamApp -Explicit $DayzRoot -EnvValue $env:DAYZ_ROOT -Leaf 'DayZ' -Probe 'DayZDiag_x64.exe'
if (-not $dayz) {
    throw @'
DayZDiag_x64.exe not found. It ships with DayZ Tools and lives in the DayZ CLIENT folder.
  - install DayZ (Steam app 221100) and DayZ Tools (Steam -> Library -> Tools), launch the tools once;
  - or pass the path:  .\testenv\prepare-testenv.ps1 -DayzRoot "D:\Steam\steamapps\common\DayZ"
'@
}
$server = Find-SteamApp -Explicit $ServerRoot -EnvValue $env:DAYZ_SERVER_ROOT -Leaf 'DayZServer' -Probe 'serverDZ.cfg'

Write-Output "DayZ client : $dayz"
Write-Output "DayZ Server : $(if ($server) { $server } else { '<not installed>' })"

New-Item -ItemType Directory -Force $TestEnv | Out-Null

# ---- 2. serverDZ.cfg ---------------------------------------------------------------------
$cfg = Join-Path $TestEnv 'serverDZ.cfg'
if ((Test-Path $cfg) -and -not $Force) {
    Write-Output "config      : $cfg (already exists, keeping it; -Force to regenerate)"
} elseif (-not $server) {
    throw @'
No stock serverDZ.cfg to copy: the free "DayZ Server" Steam app (223350) is not installed.
Install it (Steam -> Library -> Tools -> DayZ Server, or SteamCMD +login anonymous +app_update 223350),
or pass -ServerRoot. Do NOT hand-write a minimal config: a 1.29 server hangs forever on one.
'@
} else {
    $text = Get-Content (Join-Path $server 'serverDZ.cfg') -Raw
    $text = $text -replace '(?m)^\s*verifySignatures\s*=\s*2\s*;', 'verifySignatures = 0;   // locally built PBO is unsigned'
    if ($text -notmatch '(?m)^\s*BattlEye\s*=') { $text += "`r`nBattlEye = 0;`r`n" }
    if ($text -notmatch '(?m)^\s*allowFilePatching\s*=') { $text += "allowFilePatching = 1;`r`n" }
    Set-Content -Path $cfg -Value $text -Encoding UTF8 -NoNewline
    Write-Output "config      : $cfg (stock config + 3 edits)"
}
if ((Get-Content $cfg -Raw) -notmatch '(?m)^\s*instanceId\s*=') {
    throw "serverDZ.cfg has no instanceId — without it the server silently self-terminates. Add: instanceId = 1;"
}

# ---- 3. mission --------------------------------------------------------------------------
# The mission MUST live next to the game binary: -mission=<abs path> does not work.
$missionDir = Join-Path $dayz "mpmissions\$Template"
if (Test-Path $missionDir) {
    Write-Output "mission     : $missionDir (present)"
} elseif ($server -and (Test-Path (Join-Path $server "mpmissions\$Template"))) {
    New-Item -ItemType Directory -Force (Join-Path $dayz 'mpmissions') | Out-Null
    Copy-Item (Join-Path $server "mpmissions\$Template") (Join-Path $dayz 'mpmissions') -Recurse
    Write-Output "mission     : $missionDir (copied from the DayZ Server app)"
} else {
    throw "No mission '$Template'. Install the DayZ Server app, or clone BohemiaInteractive/DayZ-Central-Economy into $missionDir"
}

# ---- 4. profile + example content ---------------------------------------------------------
$profiles = Join-Path $TestEnv 'profiles'
New-Item -ItemType Directory -Force $profiles | Out-Null
if ($Example -ne 'none') {
    $src = Join-Path $RepoRoot "examples\$Example"
    if (-not (Test-Path $src)) { throw "no example pack '$Example' in $RepoRoot\examples" }
    $dst = Join-Path $profiles 'ZP_Research'
    if ((Test-Path $dst) -and -not $Force) {
        Write-Warning "profile already has ZP_Research — example NOT copied (-Force to overwrite)"
    } else {
        New-Item -ItemType Directory -Force $dst | Out-Null
        Copy-Item "$src\*" $dst -Recurse -Force -Exclude 'README.md'
        Write-Output "content     : examples\$Example -> $dst"
    }
}
Write-Output "profiles    : $profiles"
Write-Output ''
Write-Output 'Next:  .\build\build.ps1   then   .\testenv\run-server.ps1'
