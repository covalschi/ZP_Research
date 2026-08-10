// Фракційний стан: пул балів + прогрес дерева + активні проєкти.
// $profile:ZP_Research\FactionData\<factionClass>.json. Проєкти — timestamp
// (переживають перезапуск і завершуються «офлайн»), таймер опитування 10 c лише звіряється.

class ZP_ActiveProject
{
    string NodeId;
    string StarterUid;
    int EndSec;
}

class ZP_FactionData
{
    int ConfigVersion = 1;
    ref map<string, int> Points = new map<string, int>();          // пул фракції
    ref array<string> CompletedNodes = new array<string>();
    ref array<ref ZP_ActiveProject> ActiveProjects = new array<ref ZP_ActiveProject>();
}

class ZP_FactionDB
{
    static ref ZP_FactionDB s_Instance;

    ref map<string, ref ZP_FactionData> m_Cache = new map<string, ref ZP_FactionData>();
    ref Timer m_ProjectTimer;

    static ZP_FactionDB Get()
    {
        if (!s_Instance)
            s_Instance = new ZP_FactionDB();
        return s_Instance;
    }

    static void Reset()
    {
        if (s_Instance && s_Instance.m_ProjectTimer)
            s_Instance.m_ProjectTimer.Stop();
        s_Instance = null;
    }

    protected string Path(string factionClass)
    {
        return ZP_Const.FACTIONDATA_DIR + "\\" + factionClass + ".json";
    }

    void ServerInit()
    {
        if (!FileExist(ZP_Const.FACTIONDATA_DIR))
            MakeDirectory(ZP_Const.FACTIONDATA_DIR);

        // прогрів кешу з диска: PollProjects обходить лише m_Cache — без цього проєкти
        // фракцій без онлайну не завершувалися б після перезапуску (рев'ю M3)
        ref array<string> files = new array<string>();
        string fileName;
        FileAttr attr;
        FindFileHandle h = FindFile(ZP_Const.FACTIONDATA_DIR + "\\*.json", fileName, attr, FindFileFlags.ALL);
        if (h)
        {
            if (fileName != "")
                files.Insert(fileName);
            while (FindNextFile(h, fileName, attr))
            {
                if (fileName != "")
                    files.Insert(fileName);
            }
            CloseFindFile(h);
        }
        foreach (string f : files)
        {
            if (f.Length() <= 5)
                continue;
            string fc = f.Substring(0, f.Length() - 5);   // зріз '.json'
            if (!ZP_Uid.IsPathSafe(fc))
            {
                // НЕ викликати Load(): він звів би ім'я до 'default' і створив фантомний кеш-запис
                ZP_Log.Warn("FactionDB: пропущено файл із небезпечним іменем: '" + f + "'");
                continue;
            }
            Load(fc);
        }

        if (!m_ProjectTimer)
            m_ProjectTimer = new Timer(CALL_CATEGORY_SYSTEM);
        if (!m_ProjectTimer.IsRunning())
            m_ProjectTimer.Run(10, this, "PollProjects", null, true);
    }

    // небезпечне ім'я фракції (шляхи!) зводиться до 'default' ОДНАКОВО в Load і Save:
    // асиметрія мовчки втрачала б мутації — Save не знаходив би кеш-запис Load'а
    static string SanitizeKey(string factionClass)
    {
        if (ZP_Uid.IsPathSafe(factionClass))
            return factionClass;
        ZP_Log.Warn("FactionDB: небезпечне ім'я фракції '" + factionClass + "' — замінено на default");
        return "default";
    }

    ZP_FactionData Load(string factionClass)
    {
        factionClass = SanitizeKey(factionClass);
        ZP_FactionData d = m_Cache.Get(factionClass);
        if (d)
            return d;
        d = new ZP_FactionData();
        string path = Path(factionClass);
        if (FileExist(path))
        {
            string err;
            if (!JsonFileLoader<ZP_FactionData>.LoadFile(path, d, err))
            {
                CopyFile(path, path + ".broken");
                d = new ZP_FactionData();
                ZP_Log.Err("FactionData " + factionClass + " битий (копія в .broken, працюємо з нулями): " + err);
            }
        }
        m_Cache.Insert(factionClass, d);
        return d;
    }

    void Save(string factionClass)
    {
        factionClass = SanitizeKey(factionClass);
        ZP_FactionData d = m_Cache.Get(factionClass);
        if (!d)
            return;
        if (!FileExist(ZP_Const.FACTIONDATA_DIR))
            MakeDirectory(ZP_Const.FACTIONDATA_DIR);
        string err;
        if (!JsonFileLoader<ZP_FactionData>.SaveFile(Path(factionClass), d, err))
            ZP_Log.Err("не вдалося зберегти FactionData " + factionClass + ": " + err);
    }

    void SaveAll()
    {
        foreach (string fc, ZP_FactionData d : m_Cache)
        {
            Save(fc);
        }
    }

    // Скидання прогресу фракції: пул, досліджені вузли й активні проєкти — з нуля.
    // Порядок «диск -> пам'ять», як в UPSERT_NODE: якщо запис упаде, кеш лишається
    // цілим, інакше найближчий сторонній Save (GrantPool/PollProjects/SaveAll) затер би
    // файл уже без бекапу й без повідомлення адміну.
    bool ResetFaction(string factionClass, out string message)
    {
        // НЕ SanitizeKey: він мовчки зводить будь-яке кривоє ім'я до 'default',
        // тобто одруківка адміна вайпнула б ЧУЖУ фракцію. Тут — тільки відмова.
        if (!ZP_Uid.IsPathSafe(factionClass))
        {
            message = "небезпечне ім'я фракції: '" + factionClass + "'";
            return false;
        }
        string path = Path(factionClass);
        // Load() створює запис на промаху кешу, тож без цієї перевірки «скидання»
        // неіснуючої фракції породило б фантомний запис і фантомний файл
        if (!m_Cache.Contains(factionClass) && !FileExist(path))
        {
            message = "у фракції '" + factionClass + "' немає збереженого стану";
            return false;
        }

        ZP_FactionData fresh = new ZP_FactionData();
        ZP_FactionData old = m_Cache.Get(factionClass);
        if (old)
            fresh.ConfigVersion = old.ConfigVersion;

        // Бекап обов'язковий: операція незворотно нищить живий прогрес, а Save()
        // фракцій бекапів не робить (на відміну від усіх шляхів ZP_ConfigService).
        // Префікс FactionData_ — бо ConfigBackup\ пласка, і фракція 'bio' інакше
        // перетерла б бекап однойменної гілки дерева.
        if (FileExist(path))
        {
            if (!FileExist(ZP_Const.BACKUP_DIR))
                MakeDirectory(ZP_Const.BACKUP_DIR);
            CopyFile(path, ZP_Const.BACKUP_DIR + "\\FactionData_" + factionClass + ".json.bak");
        }

        if (!FileExist(ZP_Const.FACTIONDATA_DIR))
            MakeDirectory(ZP_Const.FACTIONDATA_DIR);
        string err;
        // саме SaveFile із кандидатом, а не Save(): той пише З КЕШУ, тобто вимагав би
        // закомітити пам'ять до диска і зламав би порядок
        if (!JsonFileLoader<ZP_FactionData>.SaveFile(path, fresh, err))
        {
            message = "не вдалося записати FactionData: " + err;
            return false;
        }

        m_Cache.Set(factionClass, fresh);   // коміт пам'яті — строго після успішного запису
        message = "фракцію '" + factionClass + "' скинуто (пул, вузли, проєкти)";
        if (ZP_TreeEvents.s_OnFactionReset)
            ZP_TreeEvents.s_OnFactionReset.Invoke(factionClass);
        return true;
    }

    // ---- пул балів ----

    // save=false — коли нараховуємо кілька типів балів поспіль: інакше файл фракції
    // переписувався б на КОЖЕН тип (правило з трьома типами × 20 завершень = 60 записів
    // замість 20). Викликач робить один Save наприкінці.
    bool GrantPool(string factionClass, string typeId, int amount, out string message, bool save = true)
    {
        message = "";
        if (!ZP_ConfigService.Get().GetPointTypes().Find(typeId))
        {
            message = "немає такого типу балів: '" + typeId + "'";
            return false;
        }
        if (amount == 0)
        {
            message = "amount = 0";
            return false;
        }
        ZP_FactionData d = Load(factionClass);
        int cur = 0;
        d.Points.Find(typeId, cur);
        int next = cur + amount;
        if (next < 0)
            next = 0;
        d.Points.Set(typeId, next);
        if (save)
            Save(factionClass);
        message = "пул " + factionClass + " " + typeId + ": " + cur + " -> " + next;
        return true;
    }

    // Списання вартості вузла з ПУЛУ фракції (особистих балів у гравців немає).
    // Спочатку ВСІ перевірки, потім ВСІ списання (атомарність).
    static bool TrySpendCost(string factionClass, array<ref ZP_TreeCost> cost, out string err)
    {
        err = "";
        if (!cost || cost.Count() == 0)
            return true;
        // дублі Type агрегуються: інакше кожен запис перевірявся б проти того самого
        // балансу і списання завело б його в мінус (рев'ю M3)
        ref map<string, int> total = new map<string, int>();
        foreach (ZP_TreeCost c : cost)
        {
            if (!c)
                continue;
            int acc = 0;
            total.Find(c.Type, acc);
            total.Set(c.Type, acc + c.Amount);
        }
        ZP_FactionData fd = Get().Load(factionClass);
        foreach (string fChkT, int fChkA : total)
        {
            int fcur = 0;
            fd.Points.Find(fChkT, fcur);
            if (fcur < fChkA)
            {
                err = "у пулі фракції бракує: " + fChkT + " (" + fcur + "/" + fChkA + ")";
                return false;
            }
        }
        foreach (string fPayT, int fPayA : total)
        {
            int fcur2 = 0;
            fd.Points.Find(fPayT, fcur2);
            fd.Points.Set(fPayT, fcur2 - fPayA);
        }
        Get().Save(factionClass);
        return true;
    }

    string DescribePool(string factionClass)
    {
        ZP_FactionData d = Load(factionClass);
        string s = "";
        foreach (ZP_PointType pt : ZP_ConfigService.Get().GetPointTypes().PointTypes)
        {
            int v = 0;
            d.Points.Find(pt.Id, v);
            s += pt.Id + "=" + v + " ";
        }
        if (s == "")
            s = "(типи балів не налаштовано)";
        return s;
    }

    // ---- статуси дерева ----

    bool IsNodeCompleted(string factionClass, string nodeId)
    {
        ZP_FactionData d = Load(factionClass);
        return d.CompletedNodes.Find(nodeId) > -1;
    }

    bool IsNodeResearching(string factionClass, string nodeId)
    {
        ZP_FactionData d = Load(factionClass);
        foreach (ZP_ActiveProject p : d.ActiveProjects)
        {
            if (p && p.NodeId == nodeId)
                return true;
        }
        return false;
    }

    // locked | available | researching | completed
    string GetNodeStatus(string factionClass, ZP_TreeNode node)
    {
        if (IsNodeCompleted(factionClass, node.Id))
            return "completed";
        if (IsNodeResearching(factionClass, node.Id))
            return "researching";
        if (!FactionAllowedForNode(factionClass, node))
            return "locked";
        if (ParentsSatisfied(factionClass, node))
            return "available";
        return "locked";
    }

    bool ParentsSatisfied(string factionClass, ZP_TreeNode node)
    {
        if (node.Parents.Count() == 0)
            return true;
        string pm = node.ParentsMode;
        pm.ToLower();
        int okCount = 0;
        foreach (string p : node.Parents)
        {
            if (IsNodeCompleted(factionClass, p))
                okCount++;
        }
        if (pm == "any")
            return okCount > 0;
        return okCount == node.Parents.Count();
    }

    static bool FactionAllowedForNode(string factionClass, ZP_TreeNode node)
    {
        if (node.RequiredFactions.Count() == 0)
            return true;
        return node.RequiredFactions.Find(factionClass) > -1;
    }

    void CompleteNode(string factionClass, string nodeId)
    {
        ZP_FactionData d = Load(factionClass);
        if (d.CompletedNodes.Find(nodeId) > -1)
            return;
        d.CompletedNodes.Insert(nodeId);
        // зняти однойменний активний проєкт, якщо він був
        for (int i = d.ActiveProjects.Count() - 1; i >= 0; i--)
        {
            if (d.ActiveProjects[i] && d.ActiveProjects[i].NodeId == nodeId)
                d.ActiveProjects.RemoveOrdered(i);
        }
        Save(factionClass);
    }

    void AddProject(string factionClass, string nodeId, string starterUid, int endSec)
    {
        ZP_FactionData d = Load(factionClass);
        ZP_ActiveProject p = new ZP_ActiveProject();
        p.NodeId = nodeId;
        p.StarterUid = starterUid;
        p.EndSec = endSec;
        d.ActiveProjects.Insert(p);
        Save(factionClass);
    }

    // ---- проєкти: завершення за timestamp ----

    void PollProjects()
    {
        if (!ZP_ConfigService.s_Instance)
            return;   // вікно перезапуску місії
        if (ZP_ConfigService.Get().GetRevision() == 0)
            return;   // конфіг ще не завантажено
        int nowSec = ZP_Now.EpochSec();
        foreach (string fc, ZP_FactionData d : m_Cache)
        {
            for (int i = d.ActiveProjects.Count() - 1; i >= 0; i--)
            {
                ZP_ActiveProject p = d.ActiveProjects[i];
                if (!p)
                {
                    d.ActiveProjects.RemoveOrdered(i);
                    continue;
                }
                if (nowSec < p.EndSec)
                    continue;
                // вузол міг зникнути з конфіга — проєкт знімаємо, лог
                ZP_TreeNode node = ZP_ConfigService.Get().GetTechTree().FindNode(p.NodeId);
                d.ActiveProjects.RemoveOrdered(i);
                if (!node)
                {
                    ZP_Log.Warn("проєкт '" + p.NodeId + "' (" + fc + "): вузол зник із конфіга — проєкт знято");
                    Save(fc);
                    continue;
                }
                if (d.CompletedNodes.Find(p.NodeId) < 0)
                    d.CompletedNodes.Insert(p.NodeId);
                Save(fc);
                ZP_Log.Info("проєкт завершено: '" + p.NodeId + "' фракції " + fc);
                ZP_TreeEvents.OnNodeCompleted(fc, node);
            }
        }
    }
}

// Події дерева. Сповіщення — з 3_Game (широкомовно, RP-подія для сервера);
// пофракційний пересинк клієнтських CompletedNodes робить 5_Mission через ScriptInvoker
// (резолв фракції гравця — 4_World; підписку обов'язково знімати в OnMissionFinish, §14).
// Конфіг змінився і його треба розіслати. Обхід гравців робить підписник у 5_Mission:
// ZP_ConfigService лежить у 3_Game і PlayerBase звідти не видно.
class ZP_ConfigEvents
{
    static ref ScriptInvoker s_OnConfigChanged = new ScriptInvoker();   // ()
}

class ZP_TreeEvents
{
    static ref ScriptInvoker s_OnNodeCompleted = new ScriptInvoker();   // (string factionClass)
    // Окремий інвокер, а НЕ повторне використання s_OnNodeCompleted: той розсилає всім
    // гравцям нотифікацію «Дослідження завершено», що для скидання є брехнею.
    static ref ScriptInvoker s_OnFactionReset = new ScriptInvoker();    // (string factionClass)

    static void OnNodeCompleted(string factionClass, ZP_TreeNode node)
    {
        // СПОВІЩЕННЯ ПРИБРАНО. Було: попап «Дослідження завершено: <назва>» усім онлайн-
        // гравцям без розбору фракції. Це зводило нанівець усю ізоляцію дерев — сидячи в
        // грі, чужа фракція за кілька вечорів знала поіменно все дерево вчених, темп
        // прогресу й точний момент завершення довгих проєктів. Причому решта коду ту саму
        // назву ховає: клієнтський конфіг ріже чужі вузли, !zp tree фільтрує, а на чужий
        // id дослідження відповідає «не знайдено».
        //
        // Своїм теж не шлемо: рішення власника — сповіщень немає взагалі, уся інформація
        // йде при взаємодії з приладом. Пересинк дерева СВОЇЙ фракції робить підписник
        // ZP_OnTreeNodeCompleted у 5_Mission (там видно PlayerBase, тут — ні).
        if (s_OnNodeCompleted)
            s_OnNodeCompleted.Invoke(factionClass);
    }
}
