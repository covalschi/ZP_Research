# Пак модів ZP_Research.
#
# Два ОКРЕМІ моди, а не два PBO в одній теці:
#   @ZP_Research      — сам мод, без жодної згадки про VPP у залежностях;
#   @ZP_Research_VPP  — вкладка у VPP AdminTools, ЖОРСТКО залежить від скриптів VPP.
# Друга тека підключається лише разом із VPP. Причина — емпірична (2026-08-04): відсутня
# залежність із requiredAddons дає БЛОКУЮЧЕ вікно «Addon 'X' requires addon 'Y'» ще до
# завантаження, а не тихий пропуск PBO, як вважалося раніше. Тримати таку залежність в
# основному моді означало б, що без VPP гра не стартує взагалі.
#
# Пакувальник — FileBank (PboUtils): не потребує Steam. AddonBuilder на цій машині падає з
# "Error during Steam initialization" ([API loaded no]) навіть при запущеному Steam —
# повернутись до нього можна, якщо знадобиться binarize/include-фільтри.
#
# ПЕРЕНОСНІСТЬ (2026-08-10): жодного абсолютного шляху. Корінь репозиторію береться від
# розташування самого скрипта, DayZ Tools шукаються (параметр -> змінна оточення ->
# реєстр Steam -> бібліотеки Steam), ключ підпису — з <repo>\keys. Без приватного ключа
# збірка ПРОХОДИТЬ, просто не підписує: чужа людина не має нашого ключа й підписує своїм.
#
# Приклади:
#   .\build\build.ps1
#   .\build\build.ps1 -ToolsRoot 'D:\Steam\steamapps\common\DayZ Tools'
#   $env:DAYZ_TOOLS = 'D:\...\DayZ Tools'; .\build\build.ps1
param(
    [string]$ToolsRoot,
    [string]$OutRoot
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutRoot) { $OutRoot = $RepoRoot }

# ---- пошук DayZ Tools --------------------------------------------------------------------
# Порядок: явний параметр -> змінна оточення -> реєстр Steam (SteamPath) -> усі бібліотеки
# Steam із libraryfolders.vdf. Кандидат вважається придатним, лише якщо в ньому Є FileBank.
function Find-DayZTools {
    param([string]$Explicit)

    $candidates = New-Object System.Collections.Generic.List[string]
    if ($Explicit)         { $candidates.Add($Explicit) }
    if ($env:DAYZ_TOOLS)   { $candidates.Add($env:DAYZ_TOOLS) }

    $steamPaths = New-Object System.Collections.Generic.List[string]
    try {
        $sp = (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction Stop).SteamPath
        if ($sp) { $steamPaths.Add($sp.Replace('/', '\')) }
    } catch { }
    foreach ($p in @("${env:ProgramFiles(x86)}\Steam", "$env:ProgramFiles\Steam")) {
        if ($p -and (Test-Path $p)) { $steamPaths.Add($p) }
    }

    # libraryfolders.vdf: інші диски, куди Steam ставить ігри
    foreach ($sp in @($steamPaths)) {
        $vdf = Join-Path $sp 'steamapps\libraryfolders.vdf'
        if (Test-Path $vdf) {
            foreach ($m in [regex]::Matches((Get-Content $vdf -Raw), '"path"\s*"([^"]+)"')) {
                $steamPaths.Add($m.Groups[1].Value.Replace('\\', '\'))
            }
        }
    }
    foreach ($sp in $steamPaths) { $candidates.Add((Join-Path $sp 'steamapps\common\DayZ Tools')) }

    foreach ($c in $candidates) {
        if ($c -and (Test-Path (Join-Path $c 'Bin\PboUtils\FileBank.exe'))) { return $c }
    }
    return $null
}

$tools = Find-DayZTools -Explicit $ToolsRoot
if (-not $tools) {
    throw @'
Не знайдено DayZ Tools (шукали: параметр -ToolsRoot, змінна DAYZ_TOOLS, реєстр Steam,
бібліотеки Steam). Встановіть «DayZ Tools» у Steam (Library -> Tools) або вкажіть шлях:
    .\build\build.ps1 -ToolsRoot "D:\Steam\steamapps\common\DayZ Tools"
'@
}

$fb     = Join-Path $tools 'Bin\PboUtils\FileBank.exe'
$signer = Join-Path $tools 'Bin\DsUtils\DSSignFile.exe'

# ---- ключ підпису ------------------------------------------------------------------------
# Приватний ключ у репозиторій НЕ входить (див. .gitignore) — він лише у власника мода.
# Свій ключ робиться так:  DSCreateKey.exe MyMod   (Bin\DsUtils), далі покласти обидва
# файли в <repo>\keys. Без ключа PBO збереться непідписаним — для локального тесту цього
# досить, для публічного сервера з перевіркою підписів потрібен підпис.
$keysDir = Join-Path $RepoRoot 'keys'
$privKey = $null
$pubKey  = $null
if (Test-Path $keysDir) {
    $privKey = Get-ChildItem $keysDir -Filter '*.biprivatekey' -ErrorAction SilentlyContinue |
               Select-Object -First 1 -ExpandProperty FullName
    $pubKey  = Get-ChildItem $keysDir -Filter '*.bikey' -ErrorAction SilentlyContinue |
               Select-Object -First 1 -ExpandProperty FullName
}

function Build-ZpMod {
    param([string]$Name, [string]$Src, [string]$ModDir)

    $outDir = Join-Path $ModDir 'addons'
    New-Item -ItemType Directory -Force $outDir | Out-Null
    & $fb -dst $outDir -property "prefix=$Name" $Src | Write-Output
    if ($LASTEXITCODE -ne 0) { throw "FAIL: FileBank exit code $LASTEXITCODE ($Name)" }

    $pbo = Join-Path $outDir "$Name.pbo"
    if (-not (Test-Path $pbo)) { throw "FAIL: $pbo not produced" }

    # Критерій свіжості — НЕ час старту збірки: FileBank не переписує PBO, якщо вміст не
    # змінився (тоді дата лишається старою, і перевірка по часу старту хибно падає).
    # Правильний критерій: PBO не старіший за найновіший вихідний файл.
    $newestSrc = Get-ChildItem $Src -Recurse -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ((Get-Item $pbo).LastWriteTime -lt $newestSrc.LastWriteTime) {
        throw ("FAIL: stale PBO $Name — старіший за " + $newestSrc.Name + " (запущений сервер тримає файл?)")
    }

    if ($privKey -and (Test-Path $signer)) {
        Get-ChildItem "$outDir\$Name.pbo.*.bisign" -ErrorAction SilentlyContinue | Remove-Item -Force
        & $signer $privKey $pbo | Write-Output
        if ($pubKey) {
            $modKeys = Join-Path $ModDir 'keys'
            New-Item -ItemType Directory -Force $modKeys | Out-Null
            Copy-Item $pubKey $modKeys -Force
        }
        if (-not (Get-ChildItem "$outDir\$Name.pbo.*.bisign" -ErrorAction SilentlyContinue)) { throw "FAIL: підпис $Name не створено" }
    } else {
        Write-Warning "приватного ключа в $keysDir немає — $Name не підписано (для локального тесту це нормально)"
    }
    Write-Output ("OK: {0} ({1} bytes)" -f $pbo, (Get-Item $pbo).Length)
}

Write-Output "DayZ Tools: $tools"
Write-Output "repo: $RepoRoot"
Build-ZpMod -Name 'ZP_Research'     -Src (Join-Path $RepoRoot 'ZP_Research')     -ModDir (Join-Path $OutRoot '@ZP_Research')
Build-ZpMod -Name 'ZP_Research_VPP' -Src (Join-Path $RepoRoot 'ZP_Research_VPP') -ModDir (Join-Path $OutRoot '@ZP_Research_VPP')
