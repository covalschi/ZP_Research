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
$ErrorActionPreference = 'Stop'
$fb      = 'E:\Programs\Steam\steamapps\common\DayZ Tools\Bin\PboUtils\FileBank.exe'
$signer  = 'E:\Programs\Steam\steamapps\common\DayZ Tools\Bin\DsUtils\DSSignFile.exe'
$privKey = 'E:\dayzmod\keys\ZP_Research.biprivatekey'
$pubKey  = 'E:\dayzmod\keys\ZP_Research.bikey'

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

    if (Test-Path $privKey) {
        Get-ChildItem "$outDir\$Name.pbo.*.bisign" -ErrorAction SilentlyContinue | Remove-Item -Force
        & $signer $privKey $pbo | Write-Output
        $keysDir = Join-Path $ModDir 'keys'
        New-Item -ItemType Directory -Force $keysDir | Out-Null
        Copy-Item $pubKey $keysDir -Force
        if (-not (Get-ChildItem "$outDir\$Name.pbo.*.bisign" -ErrorAction SilentlyContinue)) { throw "FAIL: підпис $Name не створено" }
    } else {
        Write-Warning "ключ $privKey не знайдено — $Name не підписано"
    }
    Write-Output ("OK: {0} ({1} bytes)" -f $pbo, (Get-Item $pbo).Length)
}

Build-ZpMod -Name 'ZP_Research'     -Src 'E:\dayzmod\ZP_Research'     -ModDir 'E:\dayzmod\@ZP_Research'
Build-ZpMod -Name 'ZP_Research_VPP' -Src 'E:\dayzmod\ZP_Research_VPP' -ModDir 'E:\dayzmod\@ZP_Research_VPP'
