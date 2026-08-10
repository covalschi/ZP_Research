# Компіляція КЛІЄНТСЬКИХ скриптів (5_Mission під #ifndef NO_GUI).
# Потрібно окремо від сервера: сервер піднімається з NO_GUI і файли меню не компілює,
# тож помилка в ZP_TreeMenu на серверному буті НЕ видно. Виводить CLIENT_COMPILE_OK/FAIL.
param(
    [int]$WaitSeconds = 90
)

$dayz     = "E:\Programs\Steam\steamapps\common\DayZ"
$profiles = "E:\dayzmod\testserver\profiles_client"
# VPP тут ОБОВ'ЯЗКОВИЙ, і разом із ним @ZP_Research_VPP. Без них вкладка редактора не
# компілюється зовсім (весь її файл під #ifdef AVPPAdminTools), і перевірка друкувала б
# зелене, не глянувши на половину клієнтського коду. Саме так проґавили падіння
# «Bad type 'ZP_EditorController'» — воно виявилось аж на буті з VPP.
$mods     = "$dayz\!Workshop\@CF;$dayz\!Workshop\@VPPAdminTools;E:\dayzmod\@ZP_Research;E:\dayzmod\@ZP_Research_VPP"

# НЕ вбивати всі DayZDiag_x64: під тим самим ім'ям працює і тестовий СЕРВЕР, і клієнт
# користувача — гуртова зупинка роняла живу сесію посеред тесту. Зупиняємо лише свій
# процес (нижче, за PID), а чужі не чіпаємо.
$srvPidFile = "E:\dayzmod\testserver\server_pid.txt"
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
