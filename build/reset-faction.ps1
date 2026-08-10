# Скидає прогрес фракції до еталону ПЕРЕД тестом (вимога користувача, 2026-08-01).
#
# Працює тільки з ЗУПИНЕНИМ сервером: ZP_Factions тримає стан фракцій у пам'яті й
# перезаписує FactionData\*.json під час збереження, тож правка файлу на живому сервері
# була б мовчки затерта. Якщо сервер треба скинути на льоту — це `!zp resetfaction`.
param(
    [string]$Faction = "default",
    [switch]$Force        # скинути навіть якщо DayZDiag запущений (файл усе одно затреться — лише для налагодження)
)

$dir      = "E:\dayzmod\testserver\profiles\ZP_Research\FactionData"
$baseline = Join-Path $dir "$Faction.baseline.json"
$target   = Join-Path $dir "$Faction.json"

if (-not (Test-Path $baseline)) {
    Write-Output "НЕМА ЕТАЛОНУ: $baseline"
    exit 1
}

$running = Get-Process -Name "DayZDiag_x64", "DayZServer_x64" -ErrorAction SilentlyContinue
if ($running -and -not $Force) {
    Write-Output "СЕРВЕР ЗАПУЩЕНИЙ — скидання файлу буде затерте кешем у пам'яті."
    Write-Output "Зупиніть сервер або скористайтесь '!zp resetfaction' у грі."
    exit 2
}

Copy-Item $baseline $target -Force
$data = Get-Content $target -Raw | ConvertFrom-Json
$nodes = @($data.CompletedNodes) -join ", "
Write-Output "OK: $Faction скинуто. CompletedNodes = [$nodes], проєктів: $(@($data.ActiveProjects).Count)"
