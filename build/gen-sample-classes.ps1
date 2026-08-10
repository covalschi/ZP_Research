# Генератор тридцяти класів-заготовок зразків (ZP_Sample_01 .. ZP_Sample_30).
# Дзеркало build\gen-data-classes.ps1 — та сама причина існування генератора: FileBank НЕ
# рапіфікує config.cpp, друкарська помилка в одному з тридцяти класів не зупинить збірку,
# а вилізе в грі як мовчазно відсутній предмет.
#
# ВІДМІННІСТЬ ВІД ZP_Data: там усі 90 класів мають ОДНАКОВУ модель (книга) — різницю несе
# лише назва/опис. Тут навпаки: Content і Purity лишаються прихованими полями сутності
# (як і раніше), а різні КЛАСИ потрібні заради РІЗНИХ МОДЕЛЕЙ (адмін обирає клас у
# ProcessingRules Outputs.Classname — саме клас визначає, як зразок виглядає в грі).
#
# Що переписує (три файли, кожен — свій шматок):
#   ZP_Research\config.cpp      — між маркерами ZP_SAMPLE_GENERATED
#   ZP_Research\zp_types.xml    — між маркерами ZP_SAMPLE_GENERATED
#   ZP_Research\stringtable.csv — рядки str_zp_sample_NN / str_zp_sample_NN_desc (решта не чіпається)
#
# Запасні назви навмисно НУМЕРОВАНІ («Зразок №07») — той самий принцип, що й у ZP_Data:
# поки тип зразка не описано в SampleTypes.json (W2.5 T2), гравець і адмін мають бачити,
# ЯКИЙ саме це зразок, інакше повний рюкзак ненастроєних зразків нерозрізненний.
#
# ДОНОРИ МОДЕЛЕЙ (ваніль gear_medical.pbo, requiredAddons не потрібен — PBO базової гри):
# кожен шлях перевірено декомпіляцією gear_medical.pbo\config.bin (CfgConvert -txt) — це
# model= РЕАЛЬНОГО, зараз чинного класу ваніли (InjectionVial/BloodTestKit/Syringe/
# ClearSyringe/BloodSyringe/IodineTincture/VitaminBottle), а не голий грep рядка
# "componentNN": той трюк дав хибне спрацювання навіть на lab_petri_dish.p3d (задокументований
# у CLAUDE.md приклад БЕЗ Geometry LOD) — одним "component01", тобто ненадійний на дрібних
# стиснутих item-p3d. Факт, що шлях — model= предмета, який рушій роками віддає гравцям у
# руки/на землю/в інвентар, доводить фізику сильніше за рядковий пошук.
$donorGroups = @(
    @{ From = 1;  To = 5;  Model = '\dz\gear\medical\InjectionVial.p3d' }   # клас InjectionVial — запаяний флакон
    @{ From = 6;  To = 10; Model = '\dz\gear\medical\BloodTest_Kit.p3d' }   # клас BloodTestKit — набір аналізу крові
    @{ From = 11; To = 15; Model = '\dz\gear\medical\syringe_empty.p3d' }  # клас Syringe — медичний шприц
    @{ From = 16; To = 20; Model = '\dz\gear\medical\syringe_Full.p3d' }   # класи ClearSyringe/BloodSyringe — наповнений шприц
    @{ From = 21; To = 25; Model = '\dz\gear\medical\IodineTincture.p3d' } # клас IodineTincture — флакон реагенту
    @{ From = 26; To = 30; Model = '\dz\gear\medical\VitaminBottle.p3d' }  # клас VitaminBottle — баночка з пігулками
)

function Get-DonorModel {
    param([int]$index)
    foreach ($g in $donorGroups) {
        if ($index -ge $g.From -and $index -le $g.To) { return $g.Model }
    }
    throw "немає донора моделі для індексу $index — поповніть `$donorGroups"
}

$ErrorActionPreference = 'Stop'
$root    = Split-Path $PSScriptRoot -Parent
$cfgPath = Join-Path $root 'ZP_Research\config.cpp'
$xmlPath = Join-Path $root 'ZP_Research\zp_types.xml'
$strPath = Join-Path $root 'ZP_Research\stringtable.csv'
$count   = 30

function Replace-Between {
    param([string]$text, [string]$beginMark, [string]$endMark, [string]$payload)
    $bi = $text.IndexOf($beginMark)
    $ei = $text.IndexOf($endMark)
    if ($bi -lt 0 -or $ei -lt 0 -or $ei -lt $bi) { throw "маркери '$beginMark' не знайдені або переплутані" }
    $head = $text.Substring(0, $bi + $beginMark.Length)
    $tail = $text.Substring($ei)
    return $head + $payload + $tail
}

# ---- config.cpp ----
$cls = New-Object System.Text.StringBuilder
[void]$cls.Append("`r`n")
for ($i = 1; $i -le $count; $i++) {
    $n = '{0:D2}' -f $i
    $model = Get-DonorModel $i
    [void]$cls.Append("    class ZP_Sample_$n : ZP_Sample_Base { scope = 2; displayName = `"`$STR_zp_sample_$n`"; descriptionShort = `"`$STR_zp_sample_${n}_desc`"; model = `"$model`"; };`r`n")
}
$cfg = [System.IO.File]::ReadAllText($cfgPath)
$cfg = Replace-Between $cfg '// <<< ZP_SAMPLE_GENERATED: блок нижче створює build\gen-sample-classes.ps1 — руками не правити' '    // >>> ZP_SAMPLE_GENERATED' $cls.ToString()
[System.IO.File]::WriteAllText($cfgPath, $cfg, (New-Object System.Text.UTF8Encoding($false)))

# ---- zp_types.xml ----
# lifetime як у сумісного ZP_Sample: зразок носять і кладуть у прилади, а не лишають на землі.
$types = New-Object System.Text.StringBuilder
[void]$types.Append("`r`n")
for ($i = 1; $i -le $count; $i++) {
    $n = '{0:D2}' -f $i
    [void]$types.Append("    <type name=`"ZP_Sample_$n`">`r`n")
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
$xml = Replace-Between $xml '<!-- <<< ZP_SAMPLE_GENERATED: блок нижче створює build\gen-sample-classes.ps1 — руками не правити -->' '    <!-- >>> ZP_SAMPLE_GENERATED -->' $types.ToString()
[System.IO.File]::WriteAllText($xmlPath, $xml, (New-Object System.Text.UTF8Encoding($false)))

# ---- stringtable.csv ----
# Формат еталона @Trader: 14 мовних колонок, КОЖЕН рядок закінчується комою, CRLF, без BOM.
# Українська йде в 'original' (фолбек для будь-якої локалі) і в усі колонки, крім english;
# колонки 'ukrainian' у рушія 1.29 немає.
#
# ВІДОМА РОЗБІЖНІСТЬ ІЗ gen-data-classes.ps1 (ревʼю Стенд/T2, minor 2): там рядки
# ВСТАВЛЯЮТЬСЯ НА СВОЄ МІСЦЕ, а тут — дописуються в КІНЕЦЬ. Наслідок: найближчий прогін
# цього генератора перекине блок зразків у хвіст файлу і дасть шумний diff (сам вміст
# лишиться правильним — рушій читає за ключем, порядок йому байдужий). Якщо доведеться
# перегенеровувати зразки — спершу перенести сюди прийом in-place з gen-data-classes.ps1.
$lines = [System.IO.File]::ReadAllText($strPath) -split "`r`n"
$kept = @()
foreach ($l in $lines) {
    if ($l -match '^"str_zp_sample_\d\d(_desc)?"') { continue }
    if ($l.Trim() -eq '') { continue }
    $kept += $l
}
function New-Row {
    param([string]$key, [string]$ua, [string]$en)
    $cols = @($key, $ua, $en) + (1..12 | ForEach-Object { $ua })
    return '"' + ($cols -join '","') + '",'
}
for ($i = 1; $i -le $count; $i++) {
    $n = '{0:D2}' -f $i
    $kept += New-Row "str_zp_sample_$n" "Зразок №$n (не налаштовано)" "Sample #$n (not configured)"
    $kept += New-Row "str_zp_sample_${n}_desc" "Зразок, підготовлений до аналізу. Опис з'явиться, коли адміністратор опише цей тип у SampleTypes.json." "A sample prepared for analysis. Its description appears once an administrator defines this type in SampleTypes.json."
}
[System.IO.File]::WriteAllText($strPath, (($kept -join "`r`n") + "`r`n"), (New-Object System.Text.UTF8Encoding($false)))
# дзеркало в languagecore\ мусить лишатися байт-у-байт тим самим файлом
Copy-Item $strPath (Join-Path $root 'ZP_Research\languagecore\stringtable.csv') -Force

Write-Output ("OK: {0} класів у config.cpp, {0} записів у zp_types.xml, {1} рядків stringtable.csv" -f $count, $kept.Count)
