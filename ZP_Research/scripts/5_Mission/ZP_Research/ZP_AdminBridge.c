// Серверна сторона контракту ZP_ConfigOp: цим самим RPC користуватиметься UI-редактор M3.5.
class ZP_AdminBridge
{
    static ref ZP_AdminBridge s_Instance;

    // рев'ю M6: дешеве пер-identity обмеження частоти публічних RPC (RequestSync — ампліфікація
    // розміром конфігу; Research — обхід інвентаря на кожен виклик)
    ref map<string, int> m_LastSyncReq = new map<string, int>();
    ref map<string, int> m_LastResearchReq = new map<string, int>();

    protected bool Throttled(map<string, int> track, string plainId, int minIntervalSec)
    {
        int nowSec = ZP_Now.EpochSec();
        int last = 0;
        if (track.Find(plainId, last) && nowSec - last < minIntervalSec)
            return true;
        track.Set(plainId, nowSec);
        return false;
    }

    static ZP_AdminBridge Get()
    {
        if (!s_Instance)
            s_Instance = new ZP_AdminBridge();
        return s_Instance;
    }

    static void Reset()
    {
        s_Instance = null;
    }

    void RegisterRPCs()
    {
        GetRPCManager().AddRPC(ZP_Const.MOD, ZP_Const.RPC_ADMIN_OP, this, SingleplayerExecutionType.Server);
        GetRPCManager().AddRPC(ZP_Const.MOD, ZP_Const.RPC_REQUEST_SYNC, this, SingleplayerExecutionType.Server);
        GetRPCManager().AddRPC(ZP_Const.MOD, ZP_Const.RPC_REQUEST_SNAPSHOT, this, SingleplayerExecutionType.Server);
        GetRPCManager().AddRPC(ZP_Const.MOD, ZP_Const.RPC_RESEARCH, this, SingleplayerExecutionType.Server);
    }

    // M4: дослідження з UI дерева — ПУБЛІЧНИЙ RPC (не адмінський): той самий серверний
    // ZP_ResearchFlow.StartResearch, що й у '!zp research' (усі гейти всередині)
    void RPC_ZP_Research(CallType type, ParamsReadContext ctx, PlayerIdentity sender, Object target)
    {
        if (type != CallType.Server)
            return;
        if (!sender)
            return;
        Param1<string> p = new Param1<string>("");
        if (!ctx.Read(p))
            return;
        if (Throttled(m_LastResearchReq, sender.GetPlainId(), 1))
        {
            GetRPCManager().SendRPC(ZP_Const.MOD, ZP_Const.RPC_OP_RESULT, new Param2<bool, string>(false, "не так швидко"), true, sender);
            return;
        }
        PlayerBase pb = FindPlayerByIdentity(sender);
        if (!pb)
        {
            ZP_Log.Warn("research '" + p.param1 + "': гравця для identity " + sender.GetPlainId() + " не знайдено");
            return;
        }
        string msg;
        bool ok = ZP_ResearchFlow.StartResearch(pb, p.param1, msg);
        ZP_Log.Info("research '" + p.param1 + "' від " + sender.GetPlainId() + ": ok=" + ok + " msg=" + msg);
        if (msg == "")
            msg = "готово";
        GetRPCManager().SendRPC(ZP_Const.MOD, ZP_Const.RPC_OP_RESULT, new Param2<bool, string>(ok, msg), true, sender);
        if (ok)
            ZP_Factions.SyncTreeTo(pb);
    }

    // Порівнюємо за Steam64, а НЕ за вказівником PlayerIdentity: обгортки різні
    // (саме через це кнопка «Дослідити» мовчки не спрацьовувала, хоча чат працював).
    protected PlayerBase FindPlayerByIdentity(PlayerIdentity identity)
    {
        if (!identity)
            return null;
        string wanted = identity.GetPlainId();
        array<Man> players = new array<Man>();
        GetGame().GetPlayers(players);
        foreach (Man m : players)
        {
            PlayerBase pb = PlayerBase.Cast(m);
            if (pb && pb.GetIdentity() && pb.GetIdentity().GetPlainId() == wanted)
                return pb;
        }
        return null;
    }

    void RPC_ZP_AdminOp(CallType type, ParamsReadContext ctx, PlayerIdentity sender, Object target)
    {
        if (type != CallType.Server)
            return;
        if (!sender)
            return;
        Param2<int, string> p = new Param2<int, string>(0, "");
        if (!ctx.Read(p))
            return;
        string message;
        bool ok = false;
        if (ZP_AdminAuth.IsAdmin(sender))
        {
            ok = ZP_ConfigService.Get().ApplyOp(p.param1, p.param2, message);
        }
        else
        {
            message = "немає прав доступу ZP Research Admin";
            ZP_Log.Warn("admin op від " + sender.GetPlainId() + " відхилено: немає прав доступу");
        }
        GetRPCManager().SendRPC(ZP_Const.MOD, ZP_Const.RPC_OP_RESULT, new Param2<bool, string>(ok, message), true, sender);
    }

    void RPC_ZP_RequestSync(CallType type, ParamsReadContext ctx, PlayerIdentity sender, Object target)
    {
        if (type != CallType.Server)
            return;
        if (!sender)
            return;
        // подвійний синк підключення (InvokeOnConnect + страхувальний pull) рознесений у часі
        // та ідемпотентний; частіше ніж раз на 5 с — лише модифікований клієнт
        if (Throttled(m_LastSyncReq, sender.GetPlainId(), 5))
            return;
        // фракція резолвиться від ГРАВЦЯ, а не з запиту: інакше модифікований клієнт
        // попросив би собі конфіг чужої фракції
        PlayerBase syncPb = FindPlayerByIdentity(sender);
        ZP_ConfigService.Get().SyncTo(sender, ZP_Factions.GetFactionClass(syncPb));
    }

    // M3.5: повний (необрізаний) знімок конфігів для редактора — ЛИШЕ адмінам
    void RPC_ZP_RequestSnapshot(CallType type, ParamsReadContext ctx, PlayerIdentity sender, Object target)
    {
        if (type != CallType.Server)
            return;
        if (!sender)
            return;
        if (!ZP_AdminAuth.IsAdmin(sender))
        {
            ZP_Log.Warn("snapshot-запит від " + sender.GetPlainId() + " відхилено: немає прав доступу");
            return;
        }
        SendSnapshotTo(sender);
    }

    protected void SendSnapshotTo(PlayerIdentity identity)
    {
        ZP_ConfigService svc = ZP_ConfigService.Get();
        string json;
        string err;

        if (JsonFileLoader<ZP_SettingsConfig>.MakeData(svc.GetSettings(), json, err, false))
            SendSection(ZP_Snap.SETTINGS, json, identity);
        else
            ZP_Log.Err("snapshot Settings: " + err);

        if (JsonFileLoader<ZP_PointTypesConfig>.MakeData(svc.GetPointTypes(), json, err, false))
            SendSection(ZP_Snap.POINTTYPES, json, identity);
        else
            ZP_Log.Err("snapshot PointTypes: " + err);

        ZP_SnapRules snapRules = new ZP_SnapRules();
        foreach (ZP_Rule r : svc.GetRules().Rules)
        {
            ZP_SnapRuleEntry re = new ZP_SnapRuleEntry();
            re.Rule = r;
            string ruleFile;
            svc.GetRules().RuleFileOf.Find(r.Id, ruleFile);
            re.FileName = ruleFile;
            snapRules.Entries.Insert(re);
        }
        if (JsonFileLoader<ZP_SnapRules>.MakeData(snapRules, json, err, false))
            SendSection(ZP_Snap.RULES, json, identity);
        else
            ZP_Log.Err("snapshot Rules: " + err);

        ZP_SnapNodes snapNodes = new ZP_SnapNodes();
        foreach (ZP_TreeNode n : svc.GetTechTree().Nodes)
        {
            ZP_SnapNodeEntry ne = new ZP_SnapNodeEntry();
            ne.Node = n;
            string nodeBranch;
            svc.GetTechTree().NodeBranch.Find(n.Id, nodeBranch);
            ne.BranchId = nodeBranch;
            snapNodes.Entries.Insert(ne);
        }
        if (JsonFileLoader<ZP_SnapNodes>.MakeData(snapNodes, json, err, false))
            SendSection(ZP_Snap.NODES, json, identity);
        else
            ZP_Log.Err("snapshot Nodes: " + err);

        // Фракції йдуть цілим конфігом: у них немає ані розкладки по файлах, ані гілок,
        // тож обгортка зі службовими полями була б зайвою.
        if (JsonFileLoader<ZP_FactionsConfig>.MakeData(svc.GetFactions(), json, err, false))
            SendSection(ZP_Snap.FACTIONS, json, identity);
        else
            ZP_Log.Err("snapshot Factions: " + err);

        if (JsonFileLoader<ZP_DataItemsConfig>.MakeData(svc.GetDataItems(), json, err, false))
            SendSection(ZP_Snap.DATAITEMS, json, identity);
        else
            ZP_Log.Err("snapshot DataItems: " + err);

        if (JsonFileLoader<ZP_ModulesConfig>.MakeData(svc.GetModules(), json, err, false))
            SendSection(ZP_Snap.MODULES, json, identity);
        else
            ZP_Log.Err("snapshot Modules: " + err);
    }

    // Секція йде ШМАТКАМИ по ZP_Const.SNAP_CHUNK символів. Цілим рядком її не передати:
    // клієнт валився на ctx.Read із «String CORRUPTED», і секція зникала мовчки — саме
    // тому в редакторі всі списки, крім Налаштувань (218 символів), були порожні.
    // Порожня секція теж шле один шматок: інакше клієнт чекав би на неї вічно.
    protected void SendSection(int section, string json, PlayerIdentity identity)
    {
        int len = json.Length();
        int total = 1;
        if (len > 0)
            total = Math.Ceil(len / (float)ZP_Const.SNAP_CHUNK);

        for (int i = 0; i < total; i++)
        {
            int from = i * ZP_Const.SNAP_CHUNK;
            int take = ZP_Const.SNAP_CHUNK;
            if (from + take > len)
                take = len - from;
            string part = "";
            if (take > 0)
                part = json.Substring(from, take);
            GetRPCManager().SendRPC(ZP_Const.MOD, ZP_Const.RPC_ADMIN_SNAPSHOT,
                new Param4<int, int, int, string>(section, i, total, part), true, identity);
        }
        ZP_Log.Dbg("знімок: секція=" + section + " довжина=" + len + " -> шматків " + total);
    }
}
