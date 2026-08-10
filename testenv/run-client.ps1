#requires -Version 5.1
<#
.SYNOPSIS
    Starts a DayZ client that connects to the local test server.

.DESCRIPTION
    The client must load EXACTLY the same -mod list as the server: this mod adds items,
    actions and a GUI, so it is not a server-only mod.

    -Name matters. All !zp chat commands are keyed by player name, and a duplicate name
    makes the server drop every command from both players with no in-game reply at all.
    Never leave the DayZ default "Survivor" when two clients are connected.

.EXAMPLE
    .\testenv\run-client.ps1
    .\testenv\run-client.ps1 -Name Tester2 -WithVpp
#>
param(
    [string]$DayzRoot,
    [string]$Name = 'Tester',
    [string]$Connect = '127.0.0.1:2302',
    [string]$Profiles,
    [switch]$WithVpp,
    [switch]$Fullscreen
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$TestEnv  = Join-Path $RepoRoot 'testenv'

. (Join-Path $PSScriptRoot 'find-dayz.ps1')
$dayz = Find-DayzRoot -Explicit $DayzRoot

if (-not $Profiles) { $Profiles = Join-Path $TestEnv 'clientprofile' }
New-Item -ItemType Directory -Force $Profiles | Out-Null

$mods = "$dayz\!Workshop\@CF;$RepoRoot\@ZP_Research"
if ($WithVpp) { $mods = "$dayz\!Workshop\@CF;$dayz\!Workshop\@VPPAdminTools;$RepoRoot\@ZP_Research;$RepoRoot\@ZP_Research_VPP" }

$args = @("-connect=$Connect", "-name=$Name", "-mod=$mods", "-profiles=$Profiles", '-nolauncher', '-noPause')
if (-not $Fullscreen) { $args += '-window' }

Start-Process -FilePath "$dayz\DayZDiag_x64.exe" -WorkingDirectory $dayz -ArgumentList $args | Out-Null
Write-Output "client '$Name' launched -> $Connect (same -mod list as the server)"
