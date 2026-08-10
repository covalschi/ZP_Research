#requires -Version 5.1
# Stops ONLY the server this folder started (pid from testenv\server_pid.txt).
# Deliberately not "kill every DayZDiag_x64": the same executable is also the CLIENT,
# so a blanket kill drops your own game session mid-test.
param([switch]$Quiet)

$TestEnv = $PSScriptRoot
$pidFile = Join-Path $TestEnv 'server_pid.txt'
if (-not (Test-Path $pidFile)) { if (-not $Quiet) { Write-Output 'no server_pid.txt — nothing started from here' }; return }

$serverPid = (Get-Content $pidFile).Trim()
$proc = Get-Process -Id $serverPid -ErrorAction SilentlyContinue
if (-not $proc) { if (-not $Quiet) { Write-Output "pid $serverPid is not running" }; return }

Stop-Process -Id $serverPid -Force
Start-Sleep -Seconds 2
if (Get-Process -Id $serverPid -ErrorAction SilentlyContinue) { Write-Warning "pid $serverPid still alive" }
elseif (-not $Quiet) { Write-Output "server $serverPid stopped" }
