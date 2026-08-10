// Спавнер стаціонарних приладів (M5a): $profile:ZP_Research\StaticDevices.json.
// ItemBase-статик спавниться ОДИН раз і далі живе в хайві (доведено тестом перезапуску M2b).
// Дедуп НЕ через реєстр живих об'єктів: entity-storage вантажиться ПІСЛЯ MissionServer.OnInit
// (доведено M2b), на буті реєстр порожній — тому персистентний стейт-файл SpawnedIds.
// Видалив прилад руками — поверни його командою !zp staticrespawn <id>.

class ZP_StaticDeviceEntry
{
    string Id;                                    // унікальний ід запису (стейт/респавн)
    string Classname;
    ref array<float> Pos = new array<float>();    // [x, y, z]
    float Yaw;                                    // орієнтація в градусах
    string Notes;
}

class ZP_StaticDevicesConfig
{
    int ConfigVersion = 1;
    ref array<ref ZP_StaticDeviceEntry> Entries = new array<ref ZP_StaticDeviceEntry>();
}

class ZP_StaticSpawnState
{
    int ConfigVersion = 1;
    ref array<string> SpawnedIds = new array<string>();
}

class ZP_StaticSpawner
{
    static ref ZP_StaticDevicesConfig s_Config;
    static ref ZP_StaticSpawnState s_State;

    static void Reset()
    {
        s_Config = null;
        s_State = null;
    }

    protected static string ConfigPath()
    {
        return ZP_Const.PROFILE_DIR + "\\StaticDevices.json";
    }

    protected static string StatePath()
    {
        return ZP_Const.PROFILE_DIR + "\\StaticDevicesState.json";
    }

    protected static void LoadAll()
    {
        string err;
        s_Config = new ZP_StaticDevicesConfig();
        if (FileExist(ConfigPath()))
        {
            if (!JsonFileLoader<ZP_StaticDevicesConfig>.LoadFile(ConfigPath(), s_Config, err))
            {
                CopyFile(ConfigPath(), ConfigPath() + ".broken");
                s_Config = new ZP_StaticDevicesConfig();
                ZP_Log.Err("StaticDevices.json пошкоджений (копія в .broken, статики не спавняться): " + err);
            }
        }
        else
        {
            SaveConfig();
            ZP_Log.Info("StaticDevices.json створено порожнім — додавайте записи '!zp staticadd <клас>' або файлом");
        }
        s_State = new ZP_StaticSpawnState();
        if (FileExist(StatePath()))
        {
            if (!JsonFileLoader<ZP_StaticSpawnState>.LoadFile(StatePath(), s_State, err))
            {
                // стейт втрачено = ризик дублів; НЕ спавнимо нічого до втручання адміна
                CopyFile(StatePath(), StatePath() + ".broken");
                s_State = null;
                ZP_Log.Err("StaticDevicesState.json пошкоджений — автоспавн статиків ЗУПИНЕНО (ризик дублів): " + err);
            }
        }
    }

    protected static void SaveConfig()
    {
        string err;
        if (!JsonFileLoader<ZP_StaticDevicesConfig>.SaveFile(ConfigPath(), s_Config, err))
            ZP_Log.Err("не збережено StaticDevices.json: " + err);
    }

    protected static void SaveState()
    {
        string err;
        if (!JsonFileLoader<ZP_StaticSpawnState>.SaveFile(StatePath(), s_State, err))
            ZP_Log.Err("не збережено StaticDevicesState.json: " + err);
    }

    // MissionServer.OnInit: спавнимо лише записи, яких ще немає у стейті
    static void ServerSpawnAll()
    {
        LoadAll();
        if (!s_State)
            return;   // пошкоджений стейт — стоїмо
        int spawned = 0;
        ref map<string, bool> seenIds = new map<string, bool>();
        foreach (ZP_StaticDeviceEntry e : s_Config.Entries)
        {
            if (!e || e.Id == "")
            {
                ZP_Log.Warn("StaticDevices: запис без Id пропущено");
                continue;
            }
            if (seenIds.Contains(e.Id))
            {
                ZP_Log.Warn("StaticDevices: дубль Id '" + e.Id + "' пропущено");
                continue;
            }
            seenIds.Set(e.Id, true);
            if (s_State.SpawnedIds.Find(e.Id) > -1)
                continue;   // вже в хайві
            if (SpawnEntry(e))
                spawned++;
        }
        if (spawned > 0)
            SaveState();
        ZP_Log.Info("статики: записів " + s_Config.Entries.Count() + ", нових заспавнено " + spawned);
    }

    protected static bool SpawnEntry(ZP_StaticDeviceEntry e)
    {
        if (!ZP_ProcessingRules.ClassExists(e.Classname))
        {
            ZP_Log.Warn("StaticDevices '" + e.Id + "': невідомий клас '" + e.Classname + "' — пропуск");
            return false;
        }
        if (!e.Pos || e.Pos.Count() < 3)
        {
            ZP_Log.Warn("StaticDevices '" + e.Id + "': Pos має бути [x,y,z] — пропуск");
            return false;
        }
        vector pos = Vector(e.Pos[0], e.Pos[1], e.Pos[2]);
        // ECE_NOLIFETIME: без CE-таймера очищення; плюс підстраховка types.xml lifetime=3888000
        Object obj = GetGame().CreateObjectEx(e.Classname, pos, ECE_PLACE_ON_SURFACE | ECE_CREATEPHYSICS | ECE_NOLIFETIME);
        if (!obj)
        {
            ZP_Log.Err("StaticDevices '" + e.Id + "': CreateObjectEx повернув null");
            return false;
        }
        // рев'ю M6: Land_*/House НЕ персистяться (зникли б після перезапуску при позначеному
        // стейті), звичайні предмети takeable і невидимі дедупу — лише наші статики
        if (!ZP_Device_StaticBase.Cast(obj))
        {
            GetGame().ObjectDelete(obj);
            ZP_Log.Err("StaticDevices '" + e.Id + "': клас '" + e.Classname + "' не є стаціонарним приладом ZP (потрібен нащадок ZP_Device_StaticBase — напр. ZP_Microscope, ZP_LabComputer, ZP_Eco_Pack_Bio) — спавн скасовано");
            return false;
        }
        obj.SetOrientation(Vector(e.Yaw, 0, 0));
        s_State.SpawnedIds.Insert(e.Id);
        // ФАКТИЧНА позиція, а не запрошена: рушій може посадити об'єкт інакше (ECE_PLACE_ON_SURFACE
        // по Y не рухає — зонд 2026-08-09, але це поведінка рушія, а не наша гарантія), і рядок
        // із pos.ToString() доводив би лише те, що файл розпарсився. Розбіжність друкуємо окремо,
        // щоб «прилад пішов у землю» було видно в логі, а не лише очима в грі.
        vector actual = obj.GetPosition();
        string where = actual.ToString();
        if (vector.Distance(actual, pos) > 0.01)
            where = where + " (запит " + pos.ToString() + ")";
        ZP_Log.Info("статик '" + e.Id + "' (" + e.Classname + ") заспавнено @ " + where);
        return true;
    }

    // ---- адмін-API (чат-команди) ----

    // додати запис на позиції гравця + заспавнити одразу
    static bool AddAt(PlayerBase admin, string classname, string wantedId, out string msg)
    {
        msg = "";
        if (!s_Config || !s_State)
        {
            msg = "спавнер не ініціалізовано (пошкоджений стейт? див. серверний лог)";
            return false;
        }
        if (!ZP_ProcessingRules.ClassExists(classname))
        {
            msg = "невідомий клас: '" + classname + "'";
            return false;
        }
        string id = wantedId;
        if (id == "")
            id = "zps_" + ZP_Now.EpochSec();
        foreach (ZP_StaticDeviceEntry chk : s_Config.Entries)
        {
            if (chk && chk.Id == id)
            {
                msg = "Id '" + id + "' уже зайнятий";
                return false;
            }
        }
        vector pos = admin.GetPosition() + admin.GetDirection() * 1.5;
        ZP_StaticDeviceEntry e = new ZP_StaticDeviceEntry();
        e.Id = id;
        e.Classname = classname;
        e.Pos.Insert(pos[0]);
        e.Pos.Insert(pos[1]);
        e.Pos.Insert(pos[2]);
        vector ori = admin.GetOrientation();
        e.Yaw = ori[0];
        s_Config.Entries.Insert(e);
        SaveConfig();
        if (!SpawnEntry(e))
        {
            msg = "запис '" + id + "' збережено, але спавн не вдався (див. лог)";
            return false;
        }
        SaveState();
        msg = "статик '" + id + "' (" + classname + ") створено та записано в StaticDevices.json";
        return true;
    }

    // зняти прапорець заспавненості та заспавнити заново (після ручного видалення приладу)
    static bool RespawnEntry(string id, out string msg)
    {
        msg = "";
        if (!s_Config || !s_State)
        {
            msg = "спавнер не ініціалізовано";
            return false;
        }
        ZP_StaticDeviceEntry found;
        foreach (ZP_StaticDeviceEntry e : s_Config.Entries)
        {
            if (e && e.Id == id)
                found = e;
        }
        if (!found)
        {
            msg = "запису '" + id + "' немає в StaticDevices.json";
            return false;
        }
        // поруч уже стоїть живий такий самий? (захист від дублів при помилковому respawn)
        vector pos = Vector(found.Pos[0], found.Pos[1], found.Pos[2]);
        if (ZP_Device_StaticBase.FindNear(found.Classname, pos, 2.0))
        {
            msg = "поруч із точкою вже стоїть " + found.Classname + " — спершу видаліть його";
            return false;
        }
        int idx = s_State.SpawnedIds.Find(id);
        if (idx > -1)
            s_State.SpawnedIds.RemoveOrdered(idx);
        if (!SpawnEntry(found))
        {
            SaveState();
            msg = "спавн '" + id + "' не вдався (див. лог)";
            return false;
        }
        SaveState();
        msg = "статик '" + id + "' переспавнено";
        return true;
    }

    static string DescribeEntries()
    {
        if (!s_Config)
            return "спавнер не ініціалізовано";
        if (s_Config.Entries.Count() == 0)
            return "записів немає (!zp staticadd <клас>)";
        string s = "";
        foreach (ZP_StaticDeviceEntry e : s_Config.Entries)
        {
            if (!e)
                continue;
            string flag = "очікує";
            if (s_State && s_State.SpawnedIds.Find(e.Id) > -1)
                flag = "у хайві";
            s += e.Id + "=" + e.Classname + " [" + flag + "] ";
        }
        return s;
    }
}
