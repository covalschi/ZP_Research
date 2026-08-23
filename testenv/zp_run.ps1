# Підняти тестовий стенд і НІЧОГО більше: ані вводу, ані знімків.
# Для ручної роботи — на відміну від zp_stand.ps1, який ще й друкує команди в чат.
#
#   .\testenv\zp_run.ps1              # сервер + клієнт
#   .\testenv\zp_run.ps1 -ServerOnly  # лише сервер (клієнт запустите самі або з лаунчера)
#
# ПЕРЕНОСНІСТЬ: жодного шляху конкретної машини. Корінь репозиторію береться від
# розташування скрипта, DayZ шукається find-dayz.ps1, робоче середовище стенда
# задається -StandRoot, а чужі моди — через -ExtraMods (наприклад @AKM_Forte, який
# живе у власному репозиторії; цей мод про нього нічого не знає).
param(
    [switch]$ServerOnly,
    [switch]$NoBuild,
    [string]$StandRoot,
    [string]$ExtraMods,
    [string]$DayzRoot
)

$RepoRoot = Split-Path -Parent $PSScriptRoot
if (-not $StandRoot) { $StandRoot = $PSScriptRoot }

. (Join-Path $PSScriptRoot 'find-dayz.ps1')
$dayz = Find-DayzRoot -Explicit $DayzRoot

$mods = "$dayz\!Workshop\@CF;$dayz\!Workshop\@VPPAdminTools;$RepoRoot\@ZP_Research;$RepoRoot\@ZP_Research_VPP"
if ($ExtraMods) { $mods = "$mods;$ExtraMods" }

$profiles      = Join-Path $StandRoot 'profiles'
$clientProfile = Join-Path $StandRoot 'clientprofile'

# Конфіг беремо зі стенда, а якщо його там немає — еталонний із репозиторію.
$cfg = Join-Path $StandRoot 'serverDZ_full.cfg'
if (-not (Test-Path $cfg)) { $cfg = Join-Path $PSScriptRoot 'serverDZ_full.cfg' }

if (-not $NoBuild) {
    # Збірка відмовляється працювати, поки PBO тримає запущений стенд, тому спершу глушимо.
    Get-Process DayZDiag_x64 -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
    & (Join-Path $RepoRoot 'build\build.ps1')
}

Get-ChildItem $profiles -Filter 'script_*.log' -ErrorAction SilentlyContinue | Remove-Item -Force
$srv = Start-Process -FilePath "$dayz\DayZDiag_x64.exe" -WorkingDirectory $dayz -PassThru -ArgumentList `
    '-server', "-config=$cfg", '-port=2302', "-mod=$mods", "-profiles=$profiles"
$srv.Id | Set-Content (Join-Path $StandRoot 'server_pid.txt')
Write-Output "сервер запущено (pid $($srv.Id)), чекаю на завантаження світу..."

# Перший бут довгий (готування світу), тому чекаємо саме на рядок готовності, а не на час.
$end = (Get-Date).AddMinutes(6)
$ready = $false
while ((Get-Date) -lt $end) {
    $f = Get-ChildItem $profiles -Filter 'script_*.log' -ErrorAction SilentlyContinue
    if ($f -and (Select-String -Path $f.FullName -Pattern 'configs loaded' -Quiet -ErrorAction SilentlyContinue)) { $ready = $true; break }
    Start-Sleep -Seconds 5
}
if (-not $ready) { throw "сервер не піднявся за 6 хв — дивіться $profiles\*.RPT" }

$rpt = Get-ChildItem $profiles -Filter '*.RPT' | Sort-Object LastWriteTime -Desc | Select-Object -First 1
$errs = Select-String -Path $rpt.FullName -Pattern "Bad type|Can't compile" -ErrorAction SilentlyContinue
if ($errs) { Write-Warning "помилки компіляції на сервері: $($errs.Count) — див. $($rpt.Name)" }
else { Write-Output 'сервер готовий, помилок компіляції немає' }

if ($ServerOnly) { return }

Get-ChildItem $clientProfile -Filter 'script_*.log' -ErrorAction SilentlyContinue | Remove-Item -Force
Start-Process -FilePath "$dayz\DayZDiag_x64.exe" -WorkingDirectory $dayz -ArgumentList `
    '-connect=127.0.0.1:2302', '-name=ZoneProtocol', "-mod=$mods", `
    "-profiles=$clientProfile", '-nolauncher', '-noPause', '-window' | Out-Null
Write-Output 'клієнт запущено — заходить сам, чекайте появи персонажа'
