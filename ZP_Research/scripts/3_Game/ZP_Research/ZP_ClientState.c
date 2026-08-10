// Клієнтський синглтон: отримана конфігурація + власні бали. Дані дійсні лише після першої синхронізації.
class ZP_ClientState
{
    static ref ZP_ClientState s_Instance;

    ref ZP_ClientConfig m_Config;
    bool m_ConfigReceived;
    string m_FactionClass;
    ref array<string> m_CompletedNodes = new array<string>();

    // M3.5: адмін-снапшот для редактора (секція -> JSON) + лічильники для опитування меню
    ref map<int, string> m_AdminSnap = new map<int, string>();
    int m_SnapCounter;
    // Недозібрані секції: шматки лежать тут, доки не прийде останній. У m_AdminSnap секція
    // потрапляє ЛИШЕ цілою — інакше редактор спробував би розібрати обрізаний JSON і
    // показав би порожній список замість помилки.
    ref map<int, ref array<string>> m_SnapParts = new map<int, ref array<string>>();
    string m_LastOpResult;
    bool m_LastOpOk;
    int m_LastOpCounter;

    // M4: фракційний стан дерева для UI
    ref array<string> m_ResearchingNodes = new array<string>();
    ref array<int> m_ResearchingEnds = new array<int>();
    ref map<string, int> m_PoolPoints = new map<string, int>();
    int m_TreeCounter;

    static ZP_ClientState Get()
    {
        if (!s_Instance)
            s_Instance = new ZP_ClientState();
        return s_Instance;
    }

    static void Reset()
    {
        s_Instance = null;
    }

    // клієнтська сторона ActionCondition: збіг за урізаними правилами із синхронізації (лише режим action)
    // чи доступний гравцеві сам прилад (дзеркало серверного IsDeviceFor)
    bool ClientDeviceAllowed(string deviceType)
    {
        if (!m_Config || !m_Config.DeviceClassesSplit)
            return true;
        foreach (string d : m_Config.DeviceClasses)
        {
            if (ZP_ProcessingRules.MatchClass(deviceType, d))
                return true;
        }
        return false;
    }

    // чи є ДОЗВОЛЕНЕ гравцеві background-правило для типу приладу (гейт промпту «Запустити аналіз»)
    bool HasBackgroundRuleForDevice(string deviceType)
    {
        if (!m_Config)
            return false;
        foreach (ZP_ClientRule r : m_Config.Rules)
        {
            string m = r.Mode;
            m.ToLower();
            if (m != "background")
                continue;
            if (!ZP_ProcessingRules.MatchClass(deviceType, r.Device))
                continue;
            if (RuleAllowedClient(r))
                return true;
        }
        return false;
    }

    void RegisterRPCs()
    {
        GetRPCManager().AddRPC(ZP_Const.MOD, ZP_Const.RPC_SYNC_CONFIG, this, SingleplayerExecutionType.Client);
        GetRPCManager().AddRPC(ZP_Const.MOD, ZP_Const.RPC_SYNC_TREE, this, SingleplayerExecutionType.Client);
        GetRPCManager().AddRPC(ZP_Const.MOD, ZP_Const.RPC_OP_RESULT, this, SingleplayerExecutionType.Client);
        GetRPCManager().AddRPC(ZP_Const.MOD, ZP_Const.RPC_ADMIN_SNAPSHOT, this, SingleplayerExecutionType.Client);
        GetRPCManager().AddRPC(ZP_Const.MOD, ZP_Const.RPC_PROBE, this, SingleplayerExecutionType.Client);
    }

    // ЗАМІР СТЕЛІ РЯДКА В RPC ('!zp rpcprobe'). Друкує лише УСПІХИ: коли рядок завеликий,
    // ctx.Read не повертає false, а кидає виняток рушія («String CORRUPTED») і обриває
    // функцію — тож найбільший надрукований розмір і є межею.
    void RPC_ZP_RpcProbe(CallType type, ParamsReadContext ctx, PlayerIdentity sender, Object target)
    {
        if (type != CallType.Client)
            return;
        Param2<int, string> p = new Param2<int, string>(0, "");
        if (!ctx.Read(p))
        {
            ZP_Log.Info("проба RPC: читання повернуло false");
            return;
        }
        ZP_Log.Info("проба RPC: заявлено " + p.param1 + ", прийшло " + p.param2.Length());
    }

    void RPC_ZP_SyncConfig(CallType type, ParamsReadContext ctx, PlayerIdentity sender, Object target)
    {
        if (type != CallType.Client)
            return;
        Param1<ref ZP_ClientConfig> p = new Param1<ref ZP_ClientConfig>(new ZP_ClientConfig());
        if (!ctx.Read(p))
        {
            ZP_Log.Err("SyncConfig: не читається payload");
            return;
        }
        m_Config = p.param1;
        m_ConfigReceived = true;
        Print("[ZP_Research] client: config synced, revision=" + m_Config.Revision + ", pointTypes=" + m_Config.PointTypes.Count() + ", rules=" + m_Config.Rules.Count() + ", dataItems=" + m_Config.DataItems.Count() + ", sampleTypes=" + m_Config.SampleTypes.Count());
    }

    void RPC_ZP_SyncTree(CallType type, ParamsReadContext ctx, PlayerIdentity sender, Object target)
    {
        if (type != CallType.Client)
            return;
        Param1<ref ZP_TreeSync> p = new Param1<ref ZP_TreeSync>(new ZP_TreeSync());
        if (!ctx.Read(p))
        {
            ZP_Log.Err("SyncTree: не читається payload");
            return;
        }
        m_FactionClass = p.param1.FactionClass;
        m_CompletedNodes.Clear();
        foreach (string n : p.param1.CompletedNodes)
        {
            m_CompletedNodes.Insert(n);
        }
        m_ResearchingNodes.Clear();
        m_ResearchingEnds.Clear();
        foreach (string rn : p.param1.ResearchingNodes)
        {
            m_ResearchingNodes.Insert(rn);
        }
        foreach (int re : p.param1.ResearchingEnds)
        {
            m_ResearchingEnds.Insert(re);
        }
        m_PoolPoints.Clear();
        foreach (ZP_KV pkv : p.param1.PoolPoints)
        {
            if (pkv)
                m_PoolPoints.Set(pkv.K, pkv.V);
        }
        m_TreeCounter++;
        Print("[ZP_Research] client: tree synced, faction=" + m_FactionClass + ", completed=" + m_CompletedNodes.Count());
    }

    // клієнтський статус вузла для UI (сервер авторитетний — це лише відображення)
    string GetNodeStatusClient(ZP_ClientNode node)
    {
        if (m_CompletedNodes.Find(node.Id) > -1)
            return "completed";
        if (m_ResearchingNodes.Find(node.Id) > -1)
            return "researching";
        if (node.RequiredFactions.Count() > 0 && node.RequiredFactions.Find(m_FactionClass) < 0)
            return "locked";
        if (node.Parents.Count() == 0)
            return "available";
        string pm = node.ParentsMode;
        pm.ToLower();
        int okCount = 0;
        foreach (string par : node.Parents)
        {
            if (m_CompletedNodes.Find(par) > -1)
                okCount++;
        }
        if (pm == "any" && okCount > 0)
            return "available";
        if (pm != "any" && okCount == node.Parents.Count())
            return "available";
        return "locked";
    }

    // залишок проєкту в секундах (для рядка статусу; годинник клієнта = UTC-формула ZP_Now)
    int GetResearchRemaining(string nodeId)
    {
        int idx = m_ResearchingNodes.Find(nodeId);
        if (idx < 0 || idx >= m_ResearchingEnds.Count())
            return 0;
        int remain = m_ResearchingEnds[idx] - ZP_Now.EpochSec();
        if (remain < 0)
            remain = 0;
        return remain;
    }

    // клієнтська сторона гейтів правила (фракція + RequiredNode) — для промптів екшенів
    bool RuleAllowedClient(ZP_ClientRule rule)
    {
        if (rule.RequiredFactions.Count() > 0 && rule.RequiredFactions.Find(m_FactionClass) < 0)
            return false;
        if (rule.RequiredNode != "" && m_CompletedNodes.Find(rule.RequiredNode) < 0)
            return false;
        return true;
    }

    void RPC_ZP_OpResult(CallType type, ParamsReadContext ctx, PlayerIdentity sender, Object target)
    {
        if (type != CallType.Client)
            return;
        Param2<bool, string> p = new Param2<bool, string>(false, "");
        if (!ctx.Read(p))
            return;
        // Сповіщень немає ЖОДНИХ (рішення власника). Результат адмінської операції видно
        // в рядку статусу відкритого редактора — саме для цього дзеркало нижче.
        m_LastOpOk = p.param1;
        m_LastOpResult = p.param2;
        m_LastOpCounter++;
    }

    // Шматок секції знімка: <секція, номер шматка, скільки всього, вміст>.
    void RPC_ZP_AdminSnapshot(CallType type, ParamsReadContext ctx, PlayerIdentity sender, Object target)
    {
        if (type != CallType.Client)
            return;
        Param4<int, int, int, string> p = new Param4<int, int, int, string>(0, 0, 0, "");
        if (!ctx.Read(p))
        {
            ZP_Log.Err("AdminSnapshot: не читається payload");
            return;
        }

        int section = p.param1;
        int index   = p.param2;
        int total   = p.param3;
        if (total < 1 || index < 0 || index >= total)
        {
            ZP_Log.Err("AdminSnapshot: безглузда нумерація секції " + section + ": шматок " + index + " з " + total);
            return;
        }

        // Перший шматок починає збірку заново: повторний запит (кнопка «Оновити») інакше
        // домішувався б до залишків попереднього.
        ref array<string> parts;
        if (index == 0 || !m_SnapParts.Find(section, parts) || parts.Count() != total)
        {
            parts = new array<string>();
            parts.Resize(total);
            m_SnapParts.Set(section, parts);
        }
        parts.Set(index, p.param4);

        if (index != total - 1)
            return;

        string whole;
        for (int i = 0; i < total; i++)
            whole += parts[i];
        m_SnapParts.Remove(section);

        // друкуємо ДОВЖИНУ й кількість шматків: обрив на транспорті інакше не відрізнити
        // від «секція не прийшла зовсім»
        ZP_Log.Dbg("знімок: секція=" + section + " шматків=" + total + " довжина=" + whole.Length());
        m_AdminSnap.Set(section, whole);
        m_SnapCounter++;
    }

    // запит повного снапшоту (редактор M3.5); відповідь надійде секціями в m_AdminSnap
    void RequestAdminSnapshot()
    {
        GetRPCManager().SendRPC(ZP_Const.MOD, ZP_Const.RPC_REQUEST_SNAPSHOT, new Param1<bool>(true), true, NULL);
    }
}
