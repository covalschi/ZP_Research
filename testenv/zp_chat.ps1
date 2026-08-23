# Автоматизация чата DayZ: EN-раскладка + SendInput сканкодами.
# Использование: zp_chat.ps1 -ClientPid 123 -Commands "!zp pool","!zp tree" [-DelayMs 1500]
param(
    [Parameter(Mandatory=$true)][int]$ClientPid,
    [Parameter(Mandatory=$true)][string[]]$Commands,
    [int]$DelayMs = 1800
)

Add-Type @'
using System;
using System.Runtime.InteropServices;
public class ZpInput {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT { public uint type; public KEYBDINPUT ki; public ulong pad1; public ulong pad2; }
    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
    public static void Key(ushort scan, bool up) {
        INPUT[] inp = new INPUT[1];
        inp[0].type = 1;
        inp[0].ki.wScan = scan;
        inp[0].ki.dwFlags = (uint)(0x0008 | (up ? 0x0002 : 0));
        SendInput(1, inp, Marshal.SizeOf(typeof(INPUT)));
    }
}
'@

$proc = Get-Process -Id $ClientPid -ErrorAction Stop
$hwnd = $proc.MainWindowHandle
if ($hwnd -eq [IntPtr]::Zero) { throw "client window not found" }

# примусовий EN (клієнт стартує з UA-розкладкою)
[ZpInput]::PostMessage($hwnd, 0x0050, [IntPtr]::Zero, [IntPtr]0x04090409) | Out-Null
[ZpInput]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 800

# ЗАПОБІЖНИК: Windows блокує зміну фокуса з фонового процесу, і тоді SendInput друкує
# в ЧУЖЕ активне вікно користувача. Перед будь-яким натисканням переконуємось, що
# на передньому плані справді вікно гри; інакше — відмова, а не сліпий ввід.
$fg = [ZpInput]::GetForegroundWindow()
$fgPid = 0
[ZpInput]::GetWindowThreadProcessId($fg, [ref]$fgPid) | Out-Null
if ($fgPid -ne $ClientPid) {
    throw "ВІДМОВА: на передньому плані вікно pid=$fgPid, а не клієнт DayZ (pid=$ClientPid). Клацніть по вікну гри й повторіть — інакше клавіші пішли б у чуже вікно."
}

$map = @{
    'a'=0x1E;'b'=0x30;'c'=0x2E;'d'=0x20;'e'=0x12;'f'=0x21;'g'=0x22;'h'=0x23;'i'=0x17;'j'=0x24;
    'k'=0x25;'l'=0x26;'m'=0x32;'n'=0x31;'o'=0x18;'p'=0x19;'q'=0x10;'r'=0x13;'s'=0x1F;'t'=0x14;
    'u'=0x16;'v'=0x2F;'w'=0x11;'x'=0x2D;'y'=0x15;'z'=0x2C;
    '1'=0x02;'2'=0x03;'3'=0x04;'4'=0x05;'5'=0x06;'6'=0x07;'7'=0x08;'8'=0x09;'9'=0x0A;'0'=0x0B;
    ' '=0x39;'-'=0x0C;'.'=0x34;','=0x33
}

function Press([int]$scan) {
    [ZpInput]::Key($scan, $false); Start-Sleep -Milliseconds 25
    [ZpInput]::Key($scan, $true);  Start-Sleep -Milliseconds 35
}
function PressShifted([int]$scan) {
    [ZpInput]::Key(0x2A, $false); Start-Sleep -Milliseconds 25
    [ZpInput]::Key($scan, $false); Start-Sleep -Milliseconds 25
    [ZpInput]::Key($scan, $true);  Start-Sleep -Milliseconds 25
    [ZpInput]::Key(0x2A, $true);  Start-Sleep -Milliseconds 35
}

foreach ($cmdText in $Commands) {
    Press 0x1C                       # Enter: открыть чат
    Start-Sleep -Milliseconds 600
    foreach ($ch in $cmdText.ToCharArray()) {
        $c = [string]$ch
        if ($c -eq '!') { PressShifted 0x02; continue }
        if ($c -eq '_') { PressShifted 0x0C; continue }
        $lower = $c.ToLower()
        if ($map.ContainsKey($lower)) { Press $map[$lower] } else { Write-Warning "no scancode for '$c'" }
    }
    Start-Sleep -Milliseconds 300
    Press 0x1C                       # Enter: отправить
    Write-Output ("sent: " + $cmdText)
    Start-Sleep -Milliseconds $DelayMs
}
