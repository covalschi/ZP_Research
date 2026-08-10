# Генератор дев'яноста заготовок результату (ZP_Data_01 .. ZP_Data_90).
#
# ЧОМУ ГЕНЕРАТОР, А НЕ РУКИ: FileBank не рапіфікує config.cpp — він потрапляє в PBO текстом
# і розбирається аж при завантаженні мода. Друкарська помилка в одному з дев'яноста класів
# не зупинить збірку: вона вилізе в грі як мовчазно відсутній предмет. Механічну частину
# краще не писати руками взагалі.
#
# Що переписує (три файли, кожен — свій шматок):
#   ZP_Research\config.cpp      — між маркерами ZP_DATA_GENERATED
#   ZP_Research\zp_types.xml    — між маркерами ZP_DATA_GENERATED
#   ZP_Research\stringtable.csv — рядки str_zp_data_NN / str_zp_data_NN_desc (решта не чіпається)
#
# Запасні назви навмисно НУМЕРОВАНІ («Біодані 07»): поки заготовку не описано в
# DataItems.json, гравець і адмін мають бачити, ЯКА саме це заготовка, інакше повний рюкзак
# ненастроєних носіїв нерозрізненний. Головна назва все одно приходить з DataItems.json
# (ZP_Data_Base.GetDisplayName), ці — запасний шлях із config.cpp.
#
# ТРИ ГРУПИ ПО ТРИДЦЯТЬ (стенд, 2026-08-09, замовлення власника: «щоб відрізнялися по типу
# балів, які несуть»). Група — це УМОВНІСТЬ КОНТЕНТУ, а не механіка: жоден рядок коду мода
# не знає про групи, бали заготовці призначає адмін у DataItems.json. Модель — єдине, що
# робить групу видимою, тому вона тут і задається:
#   01-30 біологічні дані, 31-60 аномальні дані, 61-90 технічні (електронні) дані.
#
# МОДЕЛІ — ТИМЧАСОВІ, ванільні (план стенду це фіксує окремо). Кожен шлях — model=
# РЕАЛЬНОГО класу ваніли, який гравці роками носять в інвентарі й тримають у руках, тобто
# з готовим інвентарним виглядом (це і є доказ придатності, сильніший за будь-який грep):
# перевірено декомпіляцією config.bin відповідного PBO (CfgConvert -txt), наявністю шляху в
# таблиці імен PBO і розбором самого p3d (ODOL: повний набір LOD-ів Geometry/ViewGeometry/
# FireGeometry/Memory + габарити «в руку»).
#
# ПРО hiddenSelections. ZP_Data_Base оголошує пару camoGround + текстура книжки — це вірно
# рівно для моделі книжки (Book_kniga.p3d СПРАВДІ має селекшн camoGround, перевірено рядками
# в самому p3d). Дві з трьох групових моделей такого селекшна НЕ мають (перевірено так само),
# тож успадкована текстура книжки була б посиланням у нікуди — тому групи, яким нема куди її
# класти, глушать ОБИДВА ключі порожнім масивом, а група-фільтр (модель має camoGround)
# перевизначає текстуру на СВОЮ, ванільну для цієї ж моделі. Жодна група не лишає чужої.
$dataGroups = @(
    @{
        From = 1; To = 30;
        # клас BloodBagFull (gear_medical.pbo), itemSize {2,2} — рівно наш розмір; 0.24x0.32x0.45 м.
        # Селекшна camoGround у моделі немає; текстура запечена в самому p3d (bloodbag_full_ca.paa).
        Model = '\dz\gear\medical\BloodBag_Full.p3d'
        Sel = @(); Tex = @()
        UaName = 'Біодані'; EnName = 'Bio data'
        UaDesc = "Заготовка носія біологічних даних. Назва, опис і бали з'являться, коли адміністратор опише її в DataItems.json."
        EnDesc = 'A blank carrier of biological data. Its name, description and points appear once an administrator defines it in DataItems.json.'
    }
    @{
        From = 31; To = 60;
        # клас GasMask_Filter (gear_consumables.pbo), itemSize {2,2}; 0.29x0.14x0.14 м.
        # Модель МАЄ camoGround, і ваніль сама подає туди текстуру — повторюємо ту саму.
        Model = '\DZ\gear\consumables\GasMask_filter.p3d'
        Sel = @('camoGround'); Tex = @('\dz\gear\consumables\data\gasmask_filter_co.paa')
        UaName = 'Аномальні дані'; EnName = 'Anomaly data'
        UaDesc = "Заготовка носія даних про аномалії. Назва, опис і бали з'являться, коли адміністратор опише її в DataItems.json."
        EnDesc = 'A blank carrier of anomaly data. Its name, description and points appear once an administrator defines it in DataItems.json.'
    }
    @{
        From = 61; To = 90;
        # клас ElectronicRepairKit (gear_tools.pbo), itemSize {2,3}; 0.30x0.27x0.58 м.
        # Селекшна camoGround немає; текстура запечена в p3d (electricianrepairkit_co.paa).
        Model = '\dz\gear\tools\electronicCase.p3d'
        Sel = @(); Tex = @()
        UaName = 'Технічні дані'; EnName = 'Technical data'
        UaDesc = "Заготовка носія технічних даних. Назва, опис і бали з'являться, коли адміністратор опише її в DataItems.json."
        EnDesc = 'A blank carrier of technical data. Its name, description and points appear once an administrator defines it in DataItems.json.'
    }
)

function Get-DataGroup {
    param([int]$index)
    foreach ($g in $dataGroups) {
        if ($index -ge $g.From -and $index -le $g.To) { return $g }
    }
    throw "немає групи для індексу $index — поповніть `$dataGroups"
}

# У шрифті UI немає великої «І» (U+0406): CAPS-текст із нею дає квадратики (урок живого
# UI-тесту 2026-08-01). Мала «і» — нормально. Ловимо тут, а не очима в грі.
function Assert-NoCapitalI {
    param([string]$text, [string]$where)
    if ($text.IndexOf([char]0x0406) -ge 0) {
        throw "«$where»: у тексті є велика «І» (U+0406), якої немає у шрифті UI: $text"
    }
}

$ErrorActionPreference = 'Stop'
$root    = Split-Path $PSScriptRoot -Parent
$cfgPath = Join-Path $root 'ZP_Research\config.cpp'
$xmlPath = Join-Path $root 'ZP_Research\zp_types.xml'
$strPath = Join-Path $root 'ZP_Research\stringtable.csv'
$count   = 90

function Replace-Between {
    param([string]$text, [string]$beginMark, [string]$endMark, [string]$payload)
    $bi = $text.IndexOf($beginMark)
    $ei = $text.IndexOf($endMark)
    if ($bi -lt 0 -or $ei -lt 0 -or $ei -lt $bi) { throw "маркери '$beginMark' не знайдені або переплутані" }
    $head = $text.Substring(0, $bi + $beginMark.Length)
    $tail = $text.Substring($ei)
    return $head + $payload + $tail
}

# Порожній масив пишемо саме як {} — так само, як це робить сама ваніль
# (hiddenSelectionsTextures[]={} у gear_camping/gear_consumables).
function Format-CfgArray {
    param([string[]]$items)
    if ($null -eq $items -or $items.Count -eq 0) { return '{}' }
    return '{' + (($items | ForEach-Object { '"' + $_ + '"' }) -join ', ') + '}'
}

# ---- config.cpp ----
$cls = New-Object System.Text.StringBuilder
[void]$cls.Append("`r`n")
for ($i = 1; $i -le $count; $i++) {
    $n = '{0:D2}' -f $i
    $g = Get-DataGroup $i
    $model = $g.Model
    $sel = Format-CfgArray $g.Sel
    $tex = Format-CfgArray $g.Tex
    [void]$cls.Append("    class ZP_Data_$n : ZP_Data_Base { scope = 2; displayName = `"`$STR_zp_data_$n`"; descriptionShort = `"`$STR_zp_data_${n}_desc`"; model = `"$model`"; hiddenSelections[] = $sel; hiddenSelectionsTextures[] = $tex; };`r`n")
}
$cfg = [System.IO.File]::ReadAllText($cfgPath)
$cfg = Replace-Between $cfg '// <<< ZP_DATA_GENERATED: блок нижче створює build\gen-data-classes.ps1 — руками не правити' '    // >>> ZP_DATA_GENERATED' $cls.ToString()
[System.IO.File]::WriteAllText($cfgPath, $cfg, (New-Object System.Text.UTF8Encoding($false)))

# ---- zp_types.xml ----
# lifetime як у стаціонарних приладів: заготовку носять і здають, а не лишають на землі.
$types = New-Object System.Text.StringBuilder
[void]$types.Append("`r`n")
for ($i = 1; $i -le $count; $i++) {
    $n = '{0:D2}' -f $i
    [void]$types.Append("    <type name=`"ZP_Data_$n`">`r`n")
    [void]$types.Append("        <nominal>0</nominal>`r`n")
    [void]$types.Append("        <min>0</min>`r`n")
    [void]$types.Append("        <lifetime>3888000</lifetime>`r`n")
    [void]$types.Append("        <restock>1800</restock>`r`n")
    [void]$types.Append("        <cost>100</cost>`r`n")
    [void]$types.Append("        <flags count_in_cargo=`"0`" count_in_hoarder=`"0`" count_in_map=`"1`" count_in_player=`"0`" crafted=`"0`" deloot=`"0`"/>`r`n")
    [void]$types.Append("        <category name=`"tools`"/>`r`n")
    [void]$types.Append("    </type>`r`n")
}
$xml = [System.IO.File]::ReadAllText($xmlPath)
$xml = Replace-Between $xml '<!-- <<< ZP_DATA_GENERATED: блок нижче створює build\gen-data-classes.ps1 — руками не правити -->' '    <!-- >>> ZP_DATA_GENERATED -->' $types.ToString()
[System.IO.File]::WriteAllText($xmlPath, $xml, (New-Object System.Text.UTF8Encoding($false)))

# ---- stringtable.csv ----
# Формат еталона @Trader: 14 мовних колонок, КОЖЕН рядок закінчується комою, CRLF, без BOM.
# Українська йде в 'original' (фолбек для будь-якої локалі) і в усі колонки, крім english;
# колонки 'ukrainian' у рушія 1.29 немає.
#
# Рядки вставляються НА ТЕ САМЕ МІСЦЕ, де стояли (а не в кінець файлу): порядок рядків
# рушієві байдужий, але стабільне місце тримає diff читабельним і не переставляє блок
# заготовок із блоком зразків при кожному перезапуску генератора.
$lines = [System.IO.File]::ReadAllText($strPath) -split "`r`n"
$kept = New-Object System.Collections.Generic.List[string]
$insertAt = -1
foreach ($l in $lines) {
    if ($l -match '^"str_zp_data_\d\d(_desc)?"') {
        if ($insertAt -lt 0) { $insertAt = $kept.Count }
        continue
    }
    if ($l.Trim() -eq '') { continue }
    $kept.Add($l)
}
if ($insertAt -lt 0) { $insertAt = $kept.Count }   # перший запуск: таких рядків ще не було
function New-Row {
    param([string]$key, [string]$ua, [string]$en)
    $cols = @($key, $ua, $en) + (1..12 | ForEach-Object { $ua })
    return '"' + ($cols -join '","') + '",'
}
$rows = New-Object System.Collections.Generic.List[string]
for ($i = 1; $i -le $count; $i++) {
    $n = '{0:D2}' -f $i
    $g = Get-DataGroup $i
    $ua = "$($g.UaName) $n (не налаштовано)"
    $en = "$($g.EnName) $n (not configured)"
    Assert-NoCapitalI $ua "str_zp_data_$n"
    Assert-NoCapitalI $g.UaDesc "str_zp_data_${n}_desc"
    $rows.Add((New-Row "str_zp_data_$n" $ua $en))
    $rows.Add((New-Row "str_zp_data_${n}_desc" $g.UaDesc $g.EnDesc))
}
$kept.InsertRange($insertAt, $rows)
[System.IO.File]::WriteAllText($strPath, (($kept -join "`r`n") + "`r`n"), (New-Object System.Text.UTF8Encoding($false)))
# дзеркало в languagecore\ мусить лишатися байт-у-байт тим самим файлом
Copy-Item $strPath (Join-Path $root 'ZP_Research\languagecore\stringtable.csv') -Force

$groupInfo = ($dataGroups | ForEach-Object { "$($_.From)-$($_.To) $($_.Model)" }) -join '; '
Write-Output ("OK: {0} класів у config.cpp, {0} записів у zp_types.xml, {1} рядків stringtable.csv" -f $count, $kept.Count)
Write-Output ("групи: {0}" -f $groupInfo)
