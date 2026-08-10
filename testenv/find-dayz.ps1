# Shared DayZ lookup, dot-sourced by run-server.ps1 / run-client.ps1.
# Order: explicit parameter -> DAYZ_ROOT env var -> Steam registry -> every Steam library.
# A candidate counts only if DayZDiag_x64.exe is actually there.

function Find-DayzRoot {
    param([string]$Explicit)

    $cands = New-Object System.Collections.Generic.List[string]
    if ($Explicit)      { $cands.Add($Explicit) }
    if ($env:DAYZ_ROOT) { $cands.Add($env:DAYZ_ROOT) }

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
    foreach ($sp in $steam) { $cands.Add((Join-Path $sp 'steamapps\common\DayZ')) }

    foreach ($c in $cands) {
        if ($c -and (Test-Path (Join-Path $c 'DayZDiag_x64.exe'))) { return $c }
    }
    throw @'
DayZDiag_x64.exe not found. It comes with DayZ Tools and lives inside the DayZ CLIENT folder.
Install DayZ Tools (Steam -> Library -> Tools) and launch it once, or pass -DayzRoot explicitly.
'@
}
