// Миттєвий F-екшен «Відкрити дерево досліджень» на стаціонарному науковому терміналі.
// Дерево — окреме вікно (ZP_TreeMenu), і відкривається САМЕ так: підійшов до приладу,
// навівся, натиснув F. Чат-команда `!zp treeui` лишається адмінським дебаг-шляхом.
// Класи-термінали налаштовуються: Settings.TreeTerminalClasses (типово ZP_LabComputer).
class ZP_ActionOpenTree : ActionInteractBase
{
    void ZP_ActionOpenTree()
    {
        m_CommandUID = DayZPlayerConstants.CMD_ACTIONMOD_INTERACTONCE;
        m_Text = "#str_zp_action_opentree";
    }

    override void CreateConditionComponents()
    {
        // CCINone.Can() = true завжди. НЕ CCIDummy: у нього Can() = (item != null),
        // тобто промпт з'являвся б ЛИШЕ з предметом у руках (перевірено по ccidummy.c:5)
        m_ConditionItem = new CCINone();
        m_ConditionTarget = new CCTObject(UAMaxDistances.DEFAULT);
    }

    override bool ActionCondition(PlayerBase player, ActionTarget target, ItemBase item)
    {
        if (!target)
            return false;
        Object obj = target.GetObject();
        if (!obj)
            return false;
        EntityAI ent = EntityAI.Cast(obj);
        if (!ent || ent.IsDamageDestroyed())
            return false;   // знищений термінал не працює
        // Із ЗАГОТОВКОЮ В РУКАХ та сама клавіша означає ЗДАЧУ. Дві дії на одній цілі й
        // одному вводі мусять розходитись УМОВОЮ, а не порядком реєстрації: інакше вибір
        // залежав би від того, яку з них рушій перебере першою, і міг би змінитися сам собою.
        // Умова тут рівно одна на обидві дії (ZP_Deposit.CanDeposit), тож «дірки», де не
        // спрацьовує жодна, не буває: неописана заготовка здачу не проходить — і тоді
        // працює дерево.
        if (ZP_Deposit.CanDeposit(player, obj, item))
            return false;
        if (GetGame().IsDedicatedServer())
        {
            string sfc = ZP_Factions.GetFactionClass(player);
            bool sok = ZP_ConfigService.Get().IsTerminalFor(sfc, obj.GetType());
            ZP_Log.Dbg("OpenTree.Can СЕРВЕР: obj=" + obj.GetType() + " фракція=" + sfc + " -> " + sok);
            return sok;
        }
        ZP_ClientState st = ZP_ClientState.Get();
        if (!st.m_ConfigReceived || !st.m_Config)
            return false;
        foreach (string term : st.m_Config.TreeTerminalClasses)
        {
            if (ZP_ProcessingRules.MatchClass(obj.GetType(), term))
                return true;
        }
        return false;
    }

    override void OnExecuteServer(ActionData action_data)
    {
        if (!action_data)
            return;
        PlayerBase player = action_data.m_Player;
        if (!player || !player.GetIdentity())
            return;

        // Повторна серверна перевірка (клієнту не довіряємо) — і саме ПОФРАКЦІЙНА:
        // чужий термінал не відкриває дерево навіть модифікованому клієнту.
        //
        // АЛЕ ціль тут може бути вже недоступна. Цей метод кличеться з події анімації
        // (animatedactionbase.c:197 OnAnimationEvent), а не з того ж кадру, де діяло
        // ActionCondition, і m_Target на цей момент буває порожнім — саме на цьому мод
        // падав «NULL pointer to instance» і дерево не відкривалось.
        //
        // Втрата цілі НЕ послаблює перевірку: рушій уже прогнав Can() на сервері
        // (actionmanagerserver.c:142) з нашим ActionCondition, тож термінал звірено.
        // Тому кожен крок розбито окремо й захищено — і кожен звіряється, ЯКЩО є з чим.
        if (action_data.m_Target)
        {
            Object obj = action_data.m_Target.GetObject();
            if (obj)
            {
                ZP_ConfigService svc = ZP_ConfigService.Get();
                if (!svc)
                    return;
                if (!svc.IsTerminalFor(ZP_Factions.GetFactionClass(player), obj.GetType()))
                    return;
            }
        }
        ZP_Log.Dbg("OpenTree.OnExecuteServer: відкриваю дерево");
        // спершу свіжий стан дерева фракції, потім наказ відкрити вікно —
        // інакше гравець побачив би застарілі статуси вузлів
        ZP_Factions.SyncTreeTo(player);
        GetRPCManager().SendRPC(ZP_Const.MOD, ZP_Const.RPC_OPEN_TREE, new Param1<bool>(true), true, player.GetIdentity());
    }
}
