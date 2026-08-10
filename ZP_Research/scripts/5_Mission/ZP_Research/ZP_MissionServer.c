modded class MissionServer
{
    override void OnInit()
    {
        super.OnInit();
        ZP_ConfigService.Get().ServerLoad();
        ZP_AdminAuth.RegisterPermissions();
        ZP_AdminBridge.Get().RegisterRPCs();
        ZP_FactionDB.Get().ServerInit();
        ZP_StaticSpawner.ServerSpawnAll();
        ZP_TreeEvents.s_OnNodeCompleted.Insert(ZP_OnTreeNodeCompleted);
        ZP_TreeEvents.s_OnFactionReset.Insert(ZP_OnFactionReset);
        ZP_ConfigEvents.s_OnConfigChanged.Insert(ZP_OnConfigChanged);
        ZP_Log.Info("M0 initialized, revision=" + ZP_ConfigService.Get().GetRevision());
    }

    // Скидання фракції: спершу глушимо станції цієї фракції, потім пересинкаємо клієнтів.
    // Без зупинки станцій «скидання» розповзлося б через хвилини: ZP_Complete не
    // переперевіряє ані RequiredNode, ані фракцію — станція, запущена ДО скидання,
    // доробить і заллє бали в обнулений пул.
    void ZP_OnFactionReset(string factionClass)
    {
        int stopped = 0;
        foreach (ZP_Device_Base dev : ZP_Device_Base.s_ZP_Devices)
        {
            // ЛИШЕ РОБОЧІ. Станцію, що стоїть із незакладеним виходом, не чіпаємо: бали
            // прилади не нараховують ВЗАГАЛІ (їх дає здача носія на терміналі), тож привід
            // «інакше заллє щойно обнулений пул» зник разом із балами на приладах. Нищити
            // за нього готові предмети — це просто втрата чужої роботи при адмінській
            // операції над ДЕРЕВОМ.
            if (!dev || dev.ZP_GetState() != ZP_Device_Base.ZP_STATE_RUNNING)
                continue;
            if (dev.ZP_GetStarterFaction() != factionClass)
                continue;
            string cancelMsg;
            // false тут не помилка операції: стан міг змінитись між перевіркою і викликом
            if (dev.ZP_AdminCancel("скидання прогресу фракції", cancelMsg))
                stopped++;
        }
        ZP_Log.Info("reset фракції '" + factionClass + "': зупинено станцій " + stopped);
        ZP_OnTreeNodeCompleted(factionClass);   // той самий пофракційний пересинк дерева
    }

    // Адресна розсилка конфігу: кожному онлайн-гравцеві — збірка ЙОГО фракції.
    // Фракція резолвиться на місці (нашивка може змінитись будь-коли), а важку частину —
    // саму збірку — знімає кеш у ZP_ConfigService: не більше однієї збірки на фракцію.
    void ZP_OnConfigChanged()
    {
        if (!GetGame().IsDedicatedServer())
            return;
        array<Man> players = new array<Man>();
        GetGame().GetPlayers(players);
        foreach (Man cm : players)
        {
            PlayerBase cpb = PlayerBase.Cast(cm);
            if (!cpb || !cpb.GetIdentity())
                continue;
            ZP_ConfigService.Get().SyncTo(cpb.GetIdentity(), ZP_Factions.GetFactionClass(cpb));
            // І СТАН ДЕРЕВА ТЕЖ. Фракція приїжджає на клієнт саме цим синком, а не конфігом,
            // тож без нього правка Factions.json або DefaultFaction не доходила до гравця
            // взагалі: сервер уже рахував його вченим, а вікно дерева показувало 'default'
            // і порожнє полотно — до перезаходу. Спіймано живим тестом.
            ZP_Factions.SyncTreeTo(cpb);
        }
    }

    // пересинк дерева онлайн-гравцям фракції після завершення вузла (підписка знімається в OnMissionFinish)
    void ZP_OnTreeNodeCompleted(string factionClass)
    {
        array<Man> players = new array<Man>();
        GetGame().GetPlayers(players);
        foreach (Man m : players)
        {
            PlayerBase pb = PlayerBase.Cast(m);
            if (!pb || !pb.GetIdentity())
                continue;
            if (ZP_Factions.GetFactionClass(pb) == factionClass)
                ZP_Factions.SyncTreeTo(pb);
        }
    }

    override void InvokeOnConnect(PlayerBase player, PlayerIdentity identity)
    {
        super.InvokeOnConnect(player, identity);
        if (!identity)
            return;
        // player МОЖЕ БУТИ NULL. InvokeOnConnect кличеться з двох подій (ClientNew і
        // ClientReady, missionserver.c:346), і на ранній із них сутність персонажа ще не
        // готова. Без цієї перевірки виняток «NULL pointer to instance» летів на КОЖНОМУ
        // конекті й обривав усе, що нижче: синк дерева і відкладений пересинк фракції
        // не виконувались ніколи (мод жив на страхувальному pull-запиті з клієнта).
        if (!player)
            return;
        // Може спрацювати двічі за сесію (ClientNew + ClientReady) — усе ідемпотентно.
        // На цей момент нашивка може бути ще не вдягнена (спорядження вантажиться пізніше),
        // тож перший синк іде за тим, що резолвиться зараз — типово за фракцією за
        // замовчуванням. Щойно нашивку вдягнуть, EEItemAttached пересинкає (ZP_Factions).
        ZP_ConfigService.Get().SyncTo(identity, ZP_Factions.GetFactionClass(player));
        ZP_Factions.SyncTreeTo(player);
        // ВІДКЛАДЕНИЙ ПЕРЕСИНК. При завантаженні персонажа нашивка ВІДНОВЛЮЄТЬСЯ вже
        // вдягненою, а не вдягається, тож подія EEItemAttached, на якій тримається наш
        // пересинк, може не спрацювати. Наслідок був спійманий у логу: перші кілька
        // натискань F сервер бачив фракцію 'default' і відмовляв («прилад не ваш»), а
        // за десяток секунд усе оживало. CallLaterByName — бо ціль виклику інший об'єкт.
        GetGame().GetCallQueue(CALL_CATEGORY_SYSTEM).CallLaterByName(player, "ZP_ResyncFaction", 4000, false);
    }

    override void PlayerDisconnected(PlayerBase player, PlayerIdentity identity, string uid)
    {
        super.PlayerDisconnected(player, identity, uid);
    }

    override void OnEvent(EventType eventTypeId, Param params)
    {
        super.OnEvent(eventTypeId, params);
        if (eventTypeId == ChatMessageEventTypeID)
        {
            ChatMessageEventParams cp = ChatMessageEventParams.Cast(params);
            if (cp)
                ZP_ChatCommands.OnChatMessage(cp.param1, cp.param2, cp.param3);
        }
    }

    override void OnMissionFinish()
    {
        // статики переживають перезапуск місії без перезапуску процесу — чистимо ДО super
        if (ZP_TreeEvents.s_OnNodeCompleted)
            ZP_TreeEvents.s_OnNodeCompleted.Remove(ZP_OnTreeNodeCompleted);
        if (ZP_TreeEvents.s_OnFactionReset)
            ZP_TreeEvents.s_OnFactionReset.Remove(ZP_OnFactionReset);
        if (ZP_ConfigEvents.s_OnConfigChanged)
            ZP_ConfigEvents.s_OnConfigChanged.Remove(ZP_OnConfigChanged);
        ZP_FactionDB.Get().SaveAll();
        ZP_FactionDB.Reset();
        ZP_ConfigService.Reset();
        ZP_AdminBridge.Reset();
        ZP_StaticSpawner.Reset();
        super.OnMissionFinish();
    }
}
