# Керування вікном клієнта DayZ для САМОПЕРЕВІРКИ інтерфейсу: фокус, клік, ввід, знімок.
#
# Дозволено власником 2026-08-05 («я снимаю правило, можешь кликать и тестировать сам»).
# Пастка, через яку заборона вводилась, лишилась: SetForegroundWindow із фонового процесу
# Windows блокує, тож БУДЬ-ЯКИЙ ввід без успішного фокуса піде в чуже вікно користувача.
# Тому кожна дія спершу забирає фокус і ПЕРЕВІРЯЄ, що він справді наш; інакше — відмова.
#
#   .\zp_ui.ps1 -Shot out.png
#   .\zp_ui.ps1 -Click 640,400
#   .\zp_ui.ps1 -Type "!zp reload" -Enter
param(
    [string]$Shot,
    [int[]]$Click,
    [int[]]$Wheel,      # x,y,кроки (додатні — вгору, від'ємні — вниз)
    [string]$Type,
    [switch]$Enter,
    [string]$Key,
    [int]$Delay = 250
)

Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class ZpWin {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
    [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] i, int size);
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
    public struct RECT { public int Left, Top, Right, Bottom; }
    public struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Explicit)] public struct INPUT {
        [FieldOffset(0)] public uint type;
        [FieldOffset(8)] public MOUSEINPUT mi;
        [FieldOffset(8)] public KEYBDINPUT ki;
    }

    // Складання INPUT мусить бути ТУТ, а не в PowerShell. Там `$inp.ki.wScan = 0x1C`
    // пише у КОПІЮ вкладеної структури (властивість value-типу повертає копію), присвоєння
    // мовчки губиться, і SendInput відправляє порожню подію: жодної помилки, просто нічого
    // не відбувається. Саме на цьому спершу «не працював» ввід у гру.
    // ext == true для клавіш редагування (Home/End/стрілки): у них скан-код збігається з
    // цифровою клавіатурою, і без прапорця EXTENDEDKEY гра приймає їх за цифри.
    public static uint Key(ushort scan, bool up, bool ext) {
        INPUT[] i = new INPUT[1];
        i[0].type = 1;
        i[0].ki.wScan = scan;
        uint f = 0x0008;
        if (ext) f |= 0x0001;
        if (up) f |= 0x0002;
        i[0].ki.dwFlags = f;
        return SendInput(1, i, Marshal.SizeOf(typeof(INPUT)));
    }
    public static uint Key(ushort scan, bool up) { return Key(scan, up, false); }
    public static uint Wheel(int delta) {
        INPUT[] i = new INPUT[1];
        i[0].type = 0;
        i[0].mi.dwFlags = 0x0800;   // MOUSEEVENTF_WHEEL
        i[0].mi.mouseData = (uint)delta;
        return SendInput(1, i, Marshal.SizeOf(typeof(INPUT)));
    }
    public static uint Mouse(uint flags, int ax, int ay) {
        INPUT[] i = new INPUT[1];
        i[0].type = 0;
        i[0].mi.dx = ax;
        i[0].mi.dy = ay;
        i[0].mi.dwFlags = flags;
        return SendInput(1, i, Marshal.SizeOf(typeof(INPUT)));
    }
}
'@

function Get-Client {
    $p = Get-Process DayZDiag_x64 -ErrorAction SilentlyContinue |
         Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne '' } |
         Sort-Object StartTime -Descending | Select-Object -First 1
    if (-not $p) { throw 'вікно клієнта DayZ не знайдено' }
    return $p
}

# Фокус треба ПІДТВЕРДИТИ. SetForegroundWindow фоновому процесу Windows зазвичай відмовляє
# мовчки (повертає false або навіть true, нічого не зробивши), тому обхід через
# AttachThreadInput і обов'язкова перевірка GetForegroundWindow після.
function Focus-Client($p) {
    $h = $p.MainWindowHandle
    # Примусова EN-розкладка: клієнт стартує з української, і скан-код літери дав би
    # кирилицю. Просимо ЩОРАЗУ — гра може перемкнути розкладку назад.
    [void][ZpWin]::PostMessage($h, 0x0050, [IntPtr]::Zero, [IntPtr]0x04090409)
    if ([ZpWin]::GetForegroundWindow() -eq $h) { return $true }
    [void][ZpWin]::ShowWindow($h, 9)   # SW_RESTORE
    $target = [ZpWin]::GetWindowThreadProcessId($h, [IntPtr]::Zero)
    $mine = [ZpWin]::GetCurrentThreadId()
    [void][ZpWin]::AttachThreadInput($mine, $target, $true)
    [void][ZpWin]::SetForegroundWindow($h)
    [void][ZpWin]::AttachThreadInput($mine, $target, $false)
    Start-Sleep -Milliseconds 400
    return ([ZpWin]::GetForegroundWindow() -eq $h)
}

$proc = Get-Client
$hwnd = $proc.MainWindowHandle

# Клієнтська область, а не рамка вікна: координати віджетів рахуються від неї.
$cr = New-Object ZpWin+RECT
[void][ZpWin]::GetClientRect($hwnd, [ref]$cr)
$origin = New-Object ZpWin+POINT
[void][ZpWin]::ClientToScreen($hwnd, [ref]$origin)
$cw = $cr.Right - $cr.Left
$ch = $cr.Bottom - $cr.Top

if ($Click -or $Type -or $Enter -or $Key -or $Wheel) {
    if (-not (Focus-Client $proc)) {
        throw 'ВІДМОВА: не вдалося зробити вікно клієнта активним. Ввід пішов би в чуже вікно.'
    }
}

if ($Click) {
    $sx = $origin.X + $Click[0]
    $sy = $origin.Y + $Click[1]
    $vw = [ZpWin]::GetSystemMetrics(78)   # SM_CXVIRTUALSCREEN
    $vh = [ZpWin]::GetSystemMetrics(79)
    $vx = [ZpWin]::GetSystemMetrics(76)
    $vy = [ZpWin]::GetSystemMetrics(77)
    $ax = [int](($sx - $vx) * 65535 / ($vw - 1))
    $ay = [int](($sy - $vy) * 65535 / ($vh - 1))
    # MOVE окремим повідомленням і з паузою: гра читає позицію курсора не в тому ж кадрі,
    # що й натискання, і «клік у нікуди» — типовий наслідок склеєних подій.
    [void][ZpWin]::Mouse(0x8001, $ax, $ay)   # ABSOLUTE|MOVE
    Start-Sleep -Milliseconds 150
    [void][ZpWin]::Mouse(0x0002, 0, 0)       # LEFTDOWN
    Start-Sleep -Milliseconds 60
    [void][ZpWin]::Mouse(0x0004, 0, 0)       # LEFTUP
    Start-Sleep -Milliseconds $Delay
}

if ($Wheel) {
    # Колесо треба крутити ПІД КУРСОРОМ у потрібному місці, тож спершу переносимо курсор.
    $sx = $origin.X + $Wheel[0]
    $sy = $origin.Y + $Wheel[1]
    $vw = [ZpWin]::GetSystemMetrics(78); $vh = [ZpWin]::GetSystemMetrics(79)
    $vx = [ZpWin]::GetSystemMetrics(76); $vy = [ZpWin]::GetSystemMetrics(77)
    [void][ZpWin]::Mouse(0x8001, [int](($sx - $vx) * 65535 / ($vw - 1)), [int](($sy - $vy) * 65535 / ($vh - 1)))
    Start-Sleep -Milliseconds 150
    $steps = $Wheel[2]
    $dir = 1; if ($steps -lt 0) { $dir = -1; $steps = -$steps }
    for ($i = 0; $i -lt $steps; $i++) {
        [void][ZpWin]::Wheel(120 * $dir)
        Start-Sleep -Milliseconds 90
    }
    Start-Sleep -Milliseconds $Delay
}

# Скан-коди, а не віртуальні клавіші: клієнт стартує з української розкладки, і VK-код
# літери дав би зовсім інший символ (перевірено ще на автоматизації чату).
$SCAN = @{
 'a'=0x1E;'b'=0x30;'c'=0x2E;'d'=0x20;'e'=0x12;'f'=0x21;'g'=0x22;'h'=0x23;'i'=0x17;'j'=0x24
 'k'=0x25;'l'=0x26;'m'=0x32;'n'=0x31;'o'=0x18;'p'=0x19;'q'=0x10;'r'=0x13;'s'=0x1F;'t'=0x14
 'u'=0x16;'v'=0x2F;'w'=0x11;'x'=0x2D;'y'=0x15;'z'=0x2C
 '0'=0x0B;'1'=0x02;'2'=0x03;'3'=0x04;'4'=0x05;'5'=0x06;'6'=0x07;'7'=0x08;'8'=0x09;'9'=0x0A
 ' '=0x39;'-'=0x0C;'='=0x0D;'.'=0x34;','=0x33;'/'=0x35;';'=0x27;'_'=0x0C;'!'=0x02
 'enter'=0x1C;'esc'=0x01;'tab'=0x0F;'back'=0x0E;'del'=0x53
}
# Клавіші редагування рядка. Саме ними чистять поле: забій від початку рядка нічого не
# робить, і набране просто дописується попереду (спіймано на собі: 5 стало 75).
$EXT = @{ 'home'=0x47; 'end'=0x4F; 'left'=0x4B; 'right'=0x4D; 'del'=0x53 }

function Send-Scan([int]$scan, [bool]$shift, [bool]$ext = $false) {
    if ($shift) { [void][ZpWin]::Key(0x2A, $false, $false); Start-Sleep -Milliseconds 25 }
    [void][ZpWin]::Key($scan, $false, $ext); Start-Sleep -Milliseconds 30
    [void][ZpWin]::Key($scan, $true, $ext);  Start-Sleep -Milliseconds 35
    if ($shift) { [void][ZpWin]::Key(0x2A, $true, $false); Start-Sleep -Milliseconds 25 }
}

# Символи, які набираються з Shift. Без цього '_' ішов як '-', і команда «!zp staticadd
# ZP_LabComputer» приїжджала на сервер як «ZP-LabComputer» — тобто тест провалювався не
# через мод, а через ввід.
$SHIFTED = @{ '_'=0x0C; '!'=0x02; ':'=0x27; '+'=0x0D; '('=0x0A; ')'=0x0B; '?'=0x35; '"'=0x28 }

if ($Type) {
    foreach ($ch in $Type.ToCharArray()) {
        $c = [string]$ch
        if ($SHIFTED.ContainsKey($c)) { Send-Scan $SHIFTED[$c] $true; continue }
        $lower = $c.ToLower()
        $shift = ($ch -cmatch '[A-Z]')
        if ($SCAN.ContainsKey($lower)) { Send-Scan $SCAN[$lower] $shift }
    }
    Start-Sleep -Milliseconds 150
}

if ($Key) {
    $k = $Key.ToLower()
    if ($EXT.ContainsKey($k)) { Send-Scan $EXT[$k] $false $true }
    elseif ($SCAN.ContainsKey($k)) { Send-Scan $SCAN[$k] $false }
    else { throw "невідома клавіша '$Key'" }
    Start-Sleep -Milliseconds $Delay
}
if ($Enter) { Send-Scan $SCAN['enter'] $false; Start-Sleep -Milliseconds $Delay }

if ($Shot) {
    # Знімок бере те, що ФІЗИЧНО зверху на екрані, а не вікно за хендлом: якщо клієнт не
    # активний, у файлі буде чуже вікно. Тому спершу фокус.
    if (-not (Focus-Client $proc)) { throw 'ВІДМОВА: клієнт не активний — знімок був би чужого вікна.' }
    Start-Sleep -Milliseconds 300
    $bmp = New-Object System.Drawing.Bitmap $cw, $ch
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($origin.X, $origin.Y, 0, 0, $bmp.Size)
    $g.Dispose()
    $bmp.Save($Shot, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output "знімок ${cw}x${ch} -> $Shot"
}
