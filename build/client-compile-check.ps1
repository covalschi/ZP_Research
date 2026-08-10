# Компіляція КЛІЄНТСЬКИХ скриптів (5_Mission під #ifndef NO_GUI).
# Потрібно окремо від сервера: сервер піднімається з NO_GUI і файли меню не компілює,
# тож помилка в ZP_TreeMenu на серверному буті НЕ видно. Виводить CLIENT_COMPILE_OK/FAIL.
#
# ПЕРЕНОСНІСТЬ (2026-08-10): шляхи більше не зашиті. Корінь гри шукається так само, як у
# build.ps1 (параметр -> DAYZ_ROOT -> реєстр Steam -> бібліотеки Steam), профіль за
# замовчуванням — тимчасова тека в корені репозиторію, зібрані моди — з <repo>.
param(
    [int]$WaitSeconds = 90,
    [string]$DayzRoot,
    [string]$Profiles
)

$RepoRoot = Split-Path -Parent $PSScriptRoot

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

$dayz = Find-SteamApp -Explicit $DayzRoot -EnvValue $env:DAYZ_ROOT -Leaf 'DayZ' -Probe 'DayZDiag_x64.exe'
if (-not $dayz) {
    throw @'
Не знайдено DayZ із DayZDiag_x64.exe (потрібен діаг-виконуваний файл із DayZ Tools).
Вкажіть шлях: .\build\client-compile-check.ps1 -DayzRoot "D:\Steam\steamapps\common\DayZ"
'@
}
if (-not $Profiles) { $Profiles = Join-Path $RepoRoot '.compile-check-profile' }
New-Item -ItemType Directory -Force $Profiles | Out-Null
$profiles = $Profiles
# VPP тут ОБОВ'ЯЗКОВИЙ, і разом із ним @ZP_Research_VPP. Без них вкладка редактора не
# компілюється зовсім (весь її файл під #ifdef AVPPAdminTools), і перевірка друкувала б
# зелене, не глянувши на половину клієнтського коду. Саме так проґавили падіння
# «Bad type 'ZP_EditorController'» — воно виявилось аж на буті з VPP.
$mods     = "$dayz\!Workshop\@CF;$dayz\!Workshop\@VPPAdminTools;$RepoRoot\@ZP_Research;$RepoRoot\@ZP_Research_VPP"

# НЕ вбивати всі DayZDiag_x64: під тим самим ім'ям працює і тестовий СЕРВЕР, і клієнт
# користувача — гуртова зупинка роняла живу сесію посеред тесту. Зупиняємо лише свій
# процес (нижче, за PID), а чужі не чіпаємо.
$srvPidFile = Join-Path $RepoRoot 'testserver\server_pid.txt'
if (Test-Path $srvPidFile) {
    $srvPid = Get-Content $srvPidFile
    if (Get-Process -Id $srvPid -ErrorAction SilentlyContinue) {
        Write-Output "УВАГА: тестовий сервер (pid $srvPid) працює — перевірка його не чіпає"
    }
}
Get-ChildItem $profiles -Filter "script_*.log" -ErrorAction SilentlyContinue | Remove-Item -Force

$p = Start-Process -FilePath "$dayz\DayZDiag_x64.exe" `
    -ArgumentList "-mod=$mods", "-profiles=$profiles", "-nolauncher" -PassThru
Start-Sleep -Seconds $WaitSeconds

$rpt = Get-ChildItem $profiles -Filter "*.RPT" -ErrorAction SilentlyContinue |
       Sort-Object LastWriteTime -Descending | Select-Object -First 1
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue

if (-not $rpt) {
    Write-Output "CLIENT_COMPILE_FAIL: RPT не з'явився за $WaitSeconds с"
    exit 1
}

# Фільтр НАВМИСНО вузький. Ловити всі "SCRIPT (E)" не можна: діаг-клієнт у головному меню
# завжди друкує стек PluginItemDiagnostic (pluginmanager.c:339) — це рантайм ванілли,
# а не наша помилка компіляції, і широкий фільтр давав хибний FAIL.
$fatal = Select-String -Path $rpt.FullName -Pattern "Can't compile|Compiling .* failed"
$mine  = Select-String -Path $rpt.FullName -Pattern "SCRIPT\s+\(E\).*ZP_"
if ($fatal -or $mine) {
    Write-Output "CLIENT_COMPILE_FAIL"
    @($fatal) + @($mine) | Where-Object { $_ } | Select-Object -First 25 |
        ForEach-Object { Write-Output $_.Line }
    exit 1
}
# Позитивне підтвердження: модуль Mission СКОМПІЛЮВАВСЯ (на клієнті він містить наші
# вікна, бо NO_GUI не визначено). Раніше тут чекали на CreateMission — але це подія
# набагато пізніша (клієнт устигає завантажити світ), і перевірка падала в UNKNOWN на
# повільному завантаженні, хоча компіляція давно пройшла.
$slog = Get-ChildItem $profiles -Filter "script_*.log" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $slog -or -not (Select-String -Path $slog.FullName -Pattern "Module: Mission")) {
    # Модуль Mission компілюється ОСТАННІМ, тож його відсутність означає або що не встигли,
    # або що впав ПОПЕРЕДНІЙ модуль (Game/World) — а це вже справжня помилка. Друкуємо все,
    # що схоже на неї: інакше єдиним свідченням лишається модальне вікно в грі, якого
    # автоматика не бачить, і причина виглядає як «просто не встигло».
    $err = Select-String -Path $slog.FullName -Pattern "Can't compile|Compiling .* failed|zp_.*\.c\(\d+\)" -ErrorAction SilentlyContinue
    if ($err) {
        Write-Output "CLIENT_COMPILE_FAIL: помилка компіляції ДО модуля Mission"
        $err | Select-Object -First 10 | ForEach-Object { Write-Output $_.Line }
        exit 1
    }
    Write-Output "CLIENT_COMPILE_UNKNOWN: модуль Mission не встиг скомпілюватись — подовжіть -WaitSeconds"
    exit 1
}
Write-Output "CLIENT_COMPILE_OK"
