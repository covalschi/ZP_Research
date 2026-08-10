class ZP_Const
{
    static const string MOD             = "ZP_Research";
    static const string PROFILE_DIR     = "$profile:ZP_Research";
    static const string SETTINGS_PATH   = "$profile:ZP_Research\\Settings.json";
    static const string POINTTYPES_PATH = "$profile:ZP_Research\\PointTypes.json";
    static const string FACTIONS_PATH   = "$profile:ZP_Research\\Factions.json";
    static const string DATAITEMS_PATH  = "$profile:ZP_Research\\DataItems.json";
    static const string MODULES_PATH    = "$profile:ZP_Research\\Modules.json";
    static const string SAMPLETYPES_PATH = "$profile:ZP_Research\\SampleTypes.json";
    static const string BACKUP_DIR      = "$profile:ZP_Research\\ConfigBackup";
    static const string RULES_DIR       = "$profile:ZP_Research\\ProcessingRules";
    static const string TECHTREE_DIR    = "$profile:ZP_Research\\TechTree";
    static const string FACTIONDATA_DIR = "$profile:ZP_Research\\FactionData";

    static const string RPC_SYNC_CONFIG      = "RPC_ZP_SyncConfig";
    static const string RPC_SYNC_TREE        = "RPC_ZP_SyncTree";
    static const string RPC_REQUEST_SYNC     = "RPC_ZP_RequestSync";
    static const string RPC_ADMIN_OP         = "RPC_ZP_AdminOp";
    static const string RPC_OP_RESULT        = "RPC_ZP_OpResult";
    static const string RPC_REQUEST_SNAPSHOT = "RPC_ZP_RequestSnapshot";   // клієнт-адмін просить повний знімок (M3.5)
    static const string RPC_ADMIN_SNAPSHOT   = "RPC_ZP_AdminSnapshot";     // ШМАТОК секції знімка клієнту

    // РОЗМІР ШМАТКА ЗНІМКА. Цілим рядком конфіг переслати НЕ МОЖНА: клієнт ловив
    // «Virtual Machine Exception / String CORRUPTED - FIX OnStoreLoad()» на самому ctx.Read,
    // і секція просто зникала. Доходили лише Налаштування (218 символів) — решта чотири
    // (типи очок, правила, вузли, фракції — кілька кілобайт кожна) не доходили ЖОДНОГО разу,
    // тому в редакторі всі списки, крім Налаштувань, були порожні від народження.
    // Так само влаштований і сам VPP: його редактор XML ніколи не шле файл одним рядком,
    // а лише масиви коротких (xmleditor.c:63,155,253).
    // 512 — свідомо з великим запасом: точну стелю міряє '!zp rpcprobe' і друкує в лог.
    static const int SNAP_CHUNK = 512;
    static const string RPC_OPEN_EDITOR      = "RPC_ZP_OpenEditor";        // сервер наказує клієнту відкрити редактор
    static const string RPC_OPEN_TREE        = "RPC_ZP_OpenTree";          // сервер наказує клієнту відкрити дерево (M4)
    static const string RPC_RESEARCH         = "RPC_ZP_Research";          // клієнт просить дослідити вузол (M4 UI)
    static const string RPC_PROBE            = "RPC_ZP_RpcProbe";          // замір стелі рядка ('!zp rpcprobe')

    static const string CHAT_PREFIX = "!zp";
    static const string PERM_ADMIN  = "ZP_Research:Admin";
    // Право ВКЛАДКИ у VPP. Мусить збігатися з іменем класу підменю (ZP_ResearchMenu):
    // VPP бере перший аргумент InsertButton і як ім'я права, і як тип підменю
    // (vppadminhud.c:113, vppbutton.c:70). Розбіжність = кнопка мовчки не відкривається.
    static const string PERM_VPP_TAB = "ZP_ResearchMenu";

    // MenuID для EnterScriptedMenu: мусять бути > 46 (останній ванільний, constants.c:216).
    // ShowScriptedMenu НЕ використовувати — меню позначається як «створене приховано»
    // (IsCreatedHidden), і LockControls тихо не спрацьовує: немає курсора й фокуса.
    // Id власних вікон. ЧОМУ ТАКІ МАЛІ: рушій відкидає завеликий id ще ДО того, як
    // спитати місію — EnterScriptedMenu просто повертає NULL, а Mission.CreateScriptedMenu
    // навіть не викликається (доведено діагностикою: у логу є виклики з ванільними 11 і 17,
    // а з нашим 774101 — жодного). Ванільні id закінчуються на 46 (constants.c), тож
    // беремо трохи вище з запасом на майбутні ванільні вікна.
    static const int MENU_TREE   = 121;
    static const int MENU_EDITOR = 122;
}

class ZP_Op
{
    static const int SET_SETTING      = 1;
    static const int UPSERT_POINTTYPE = 2;
    static const int RELOAD_ALL       = 3;
    static const int UPSERT_NODE      = 4;
    static const int DELETE_NODE      = 5;
    static const int UPSERT_RULE      = 6;
    static const int DELETE_RULE      = 7;
    static const int RESET_FACTION    = 8;
    static const int UPSERT_FACTION   = 9;
    static const int DELETE_FACTION   = 10;
    // Заготовки лише ОНОВЛЮЮТЬСЯ: створити чи видалити їх не можна, бо це класи предметів
    // із самої збірки (ZP_Data_01..90). «Прибрати» заготовку — це зняти галочку Enabled.
    static const int UPSERT_DATAITEM  = 11;
    // Інструменти/модулі приладів: на відміну від заготовок, їх МОЖНА створювати й
    // видаляти — це записи реєстру, а не класи предметів зі збірки.
    static const int UPSERT_MODULE    = 12;
    static const int DELETE_MODULE    = 13;
}

// секції адмін-знімка (M3.5 редактор)
class ZP_Snap
{
    static const int SETTINGS   = 1;
    static const int POINTTYPES = 2;
    static const int RULES      = 3;
    static const int NODES      = 4;
    static const int FACTIONS   = 5;
    static const int DATAITEMS  = 6;
    static const int MODULES    = 7;
}

// Steam64 = рівно 17 ASCII-цифр. Length()==17 && ToInt()!=0 цього НЕ перевіряє:
// ToInt() 32-бітний і парсить лише початкові цифри, мовчки ковтаючи хвіст
// ("12\..\..\Settings" -> 12) — це відкривало path traversal в імені файлу PlayerData.
class ZP_Uid
{
    static bool IsSteam64(string s)
    {
        if (s.Length() != 17)
            return false;
        for (int i = 0; i < 17; i++)
        {
            int c = s.Get(i).ToAscii();
            if (c < 48 || c > 57)
                return false;
        }
        return true;
    }

    // захист у глибину для всього, що потрапляє в ім'я файлу
    static bool IsPathSafe(string s)
    {
        return s != "" && s.IndexOf("\\") < 0 && s.IndexOf("/") < 0 && s.IndexOf(":") < 0 && s.IndexOf("..") < 0;
    }
}

// Числовий id рядка для СИНХРОНІЗАЦІЇ (рушій не синхронізує рядки — є лише
// RegisterNetSyncVariableBool/Int/Float/Object).
//
// Це мусить бути ДЕТЕРМІНОВАНА ФУНКЦІЯ РЯДКА, а не номер у реєстрі: правила перечитуються
// на живому сервері (op UPSERT_RULE, !zp reload), а зразки з уже проставленим числом лежать
// у світі місяцями. Індекс перенумерувався б при будь-якій правці правил, і весь світовий
// запас зразків змінив би сенс разом.
//
// Рушійний string.Hash() (enstring.c:223, 1_core — видно обом сторонам) виводиться зі
// ВМІСТУ рядка: ваніль зберігає його на диск (arrowmanagerplayer.c:55), CF — у власному
// потоці (cf_modstorage.c:199). Значення може бути ВІД'ЄМНИМ, і це нормально: netsync-int
// без діапазону передає всі 32 біти.
//
// ІСТИНА — РЯДОК, а не хеш: у сховище зразка пишеться сам рядок, хеш живе лише в пам'яті
// й у мережі. Колізія двох рядків тоді псує максимум відображення, а не вміст предмета.
class ZP_Hash
{
    static int Of(string s)
    {
        if (s == "")
            return 0;
        // нормалізація тим самим способом, що й порівняння класів у MatchClass:
        // мутатори рядка міняють НА МІСЦІ й повертають int, тому копія обов'язкова
        string k = s;
        k.ToLower();
        return k.Hash();
    }
}

// Абсолютний час для відкатів/лімітів (переживає перезапуск, на відміну від GetGame().GetTime()).
// Календарно точний псевдо-epoch (дні року + високосність): без стрибків на межах місяців.
// НЕ справжній unix; int вистачає до ~2087. ЗМІНЮВАТИ ФОРМУЛУ НЕ МОЖНА без міграції RuleLastUse
// у PlayerData (збережені мітки стануть незіставними).
class ZP_Now
{
    static int EpochSec()
    {
        int y;
        int mo;
        int d;
        int h;
        int mi;
        int s;
        GetYearMonthDayUTC(y, mo, d);
        GetHourMinuteSecondUTC(h, mi, s);
        int days = (y - 2020) * 365 + LeapsSince2020(y) + CumDays(y, mo) + (d - 1);
        return days * 86400 + h * 3600 + mi * 60 + s;
    }

    static int DayStamp()
    {
        int y;
        int mo;
        int d;
        GetYearMonthDayUTC(y, mo, d);
        return y * 10000 + mo * 100 + d;
    }

    protected static bool IsLeap(int y)
    {
        if (y % 400 == 0)
            return true;
        if (y % 100 == 0)
            return false;
        return y % 4 == 0;
    }

    protected static int LeapsSince2020(int y)
    {
        int n = 0;
        for (int i = 2020; i < y; i++)
        {
            if (IsLeap(i))
                n++;
        }
        return n;
    }

    protected static int CumDays(int y, int mo)
    {
        int cum = 0;
        if (mo > 1)
            cum += 31;
        if (mo > 2)
        {
            cum += 28;
            if (IsLeap(y))
                cum += 1;
        }
        if (mo > 3)
            cum += 31;
        if (mo > 4)
            cum += 30;
        if (mo > 5)
            cum += 31;
        if (mo > 6)
            cum += 30;
        if (mo > 7)
            cum += 31;
        if (mo > 8)
            cum += 31;
        if (mo > 9)
            cum += 30;
        if (mo > 10)
            cum += 31;
        if (mo > 11)
            cum += 30;
        return cum;
    }
}

class ZP_Log
{
    static void Info(string msg)
    {
        Print("[ZP_Research] " + msg);
    }

    static void Warn(string msg)
    {
        Print("[ZP_Research] WARNING: " + msg);
    }

    static void Err(string msg)
    {
        Error("[ZP_Research] " + msg);
    }

    // ім'я Dbg, а не Debug — ванільний class Debug конфліктує з ідентифікаторами.
    //
    // Прапорець беремо з ДВОХ джерел: на сервері це живий ZP_ConfigService, на КЛІЄНТІ
    // сервісу немає взагалі, тож там читаємо DebugMode із присланого конфігу. Без другої
    // гілки клієнтський Dbg мовчав ЗАВЖДИ, скільки б адмін не вмикав відлагодження, — це
    // з'їло цілу ітерацію діагностики вікна дерева (рядок «RPC прийшов» не друкувався, і
    // виглядало, ніби RPC не доходить).
    static void Dbg(string msg)
    {
        if (ZP_ClientState.s_Instance && ZP_ClientState.s_Instance.m_Config && ZP_ClientState.s_Instance.m_Config.DebugMode)
        {
            Print("[ZP_Research] DBG: " + msg);
            return;
        }
        if (ZP_ConfigService.s_Instance && ZP_ConfigService.s_Instance.IsDebug())
            Print("[ZP_Research] DBG: " + msg);
    }
}
