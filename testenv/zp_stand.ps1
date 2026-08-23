# Повний цикл самоперевірки UI: підняти стенд, зайти в гру, відкрити редактор, зняти екран.
# Потрібен, бо кожна ітерація по інтерфейсу — це той самий десяток кроків, і збирати їх
# руками щоразу означає плутатись у затримках, а не в дефектах.
#
#   .\zp_stand.ps1                     # усе з нуля
#   .\zp_stand.ps1 -SkipBoot -Shot x   # стенд уже працює, лише знімок
param(
    [switch]$SkipBoot,
    [string]$Shot = 'E:\TMP\claude\E--dayzmod\b4f0654d-284c-4e63-b7de-0e0420141e73\scratchpad\stand.png',
    [string[]]$Chat = @('!zp editor'),
    [int[]]$Click
)

$dayz = 'E:\Programs\Steam\steamapps\common\DayZ'
$mods = "$dayz\!Workshop\@CF;$dayz\!Workshop\@VPPAdminTools;E:\dayzmod\@ZP_Research;E:\dayzmod\@ZP_Research_VPP"
$ui   = 'E:\dayzmod\testserver\zp_ui.ps1'

function Wait-For([string]$dir, [string]$pattern, [int]$sec) {
    $end = (Get-Date).AddSeconds($sec)
    while ((Get-Date) -lt $end) {
        $f = Get-ChildItem $dir -Filter 'script_*.log' -ErrorAction SilentlyContinue
        if ($f -and (Select-String -Path $f.FullName -Pattern $pattern -Quiet -ErrorAction SilentlyContinue)) { return $true }
        Start-Sleep -Seconds 5
    }
    return $false
}

if (-not $SkipBoot) {
    Get-Process DayZDiag_x64 -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
    Get-ChildItem 'E:\dayzmod\testserver\profiles' -Filter 'script_*.log' -ErrorAction SilentlyContinue | Remove-Item -Force
    $srv = Start-Process -FilePath "$dayz\DayZDiag_x64.exe" -WorkingDirectory $dayz -PassThru -ArgumentList `
        '-server', '-config=E:\dayzmod\testserver\serverDZ_full.cfg', '-port=2302', "-mod=$mods", '-profiles=E:\dayzmod\testserver\profiles'
    $srv.Id | Set-Content 'E:\dayzmod\testserver\server_pid.txt'
    if (-not (Wait-For 'E:\dayzmod\testserver\profiles' 'configs loaded' 300)) { throw 'сервер не піднявся за 5 хв' }

    Get-ChildItem 'E:\dayzmod\testserver\clientprofile' -Filter 'script_*.log' -ErrorAction SilentlyContinue | Remove-Item -Force
    Start-Process -FilePath "$dayz\DayZDiag_x64.exe" -WorkingDirectory $dayz -ArgumentList `
        '-connect=127.0.0.1:2302', '-name=ZoneProtocol', "-mod=$mods", '-profiles=E:\dayzmod\testserver\clientprofile', '-nolauncher', '-noPause', '-window' | Out-Null
    if (-not (Wait-For 'E:\dayzmod\testserver\clientprofile' 'config synced' 300)) { throw 'клієнт не зайшов у гру за 5 хв' }
    Start-Sleep -Seconds 3
}

foreach ($cmd in $Chat) {
    & $ui -Key enter -Delay 800 | Out-Null
    & $ui -Type $cmd -Enter -Delay 1800 | Out-Null
}
if ($Click) { & $ui -Click $Click -Delay 900 | Out-Null }
& $ui -Shot $Shot
