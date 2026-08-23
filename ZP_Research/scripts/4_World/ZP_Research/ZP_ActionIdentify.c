// «ВИЗНАЧИТИ ДАНІ» — коротке F на СВОЄМУ терміналі з носієм у руках (спека 2026-08-23).
//
// Єдине місце, де гравець дізнається, що саме в носії: категорію, вид (польове /
// лабораторне), тир і кількість балів. Відповідь — текстом від сервера (MessageStatus),
// як і решта дій мода; клієнтові вміст не синхронізується за задумом.
//
// Поруч живе «Здати дані» (утримання F, ZP_ActionDeposit): обидві дії на одній цілі з тим
// самим предметом у руках — коротке натискання визначає, утримання здає.
class ZP_Identify
{
    static bool CanIdentify(PlayerBase player, Object obj, ItemBase item)
    {
        if (!player || !obj || !item)
            return false;
        EntityAI ent = EntityAI.Cast(obj);
        if (!ent || ent.IsDamageDestroyed())
            return false;                       // знищений термінал не працює
        if (!GetGame().IsKindOf(item.GetType(), "ZP_Carrier_Base"))
            return false;

        if (GetGame().IsDedicatedServer())
        {
            ZP_ConfigService svc = ZP_ConfigService.Get();
            if (!svc)
                return false;
            return svc.IsTerminalFor(ZP_Factions.GetFactionClass(player), obj.GetType());
        }

        // клієнт: той самий гейт терміналів, що й у здачі (ZP_Deposit.CanDeposit)
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

    // Сервер: людський опис стану носія для гравця цієї фракції.
    static string Describe(ItemBase item, string playerFaction)
    {
        string label = ZP_CarrierState.CarrierLabel(item.GetType());
        string state = ZP_Carrier_Base.StateOf(item);
        string ptId;
        int amount;
        if (!ZP_CarrierState.Parse(state, ptId, amount))
            return label + ": носій порожній — стан не записано";

        ZP_ConfigService svc = ZP_ConfigService.Get();
        ZP_PointTypesConfig pts = svc.GetPointTypes();
        ZP_PointType pt = pts.Find(ptId);
        if (!pt)
            return label + ": невідомий тип балів '" + ptId + "' (немає в PointTypes.json)";

        string cat = ZP_PointTypesConfig.DimensionName(pts.Categories, pt.Category);
        string kind = ZP_PointTypesConfig.DimensionName(pts.Kinds, pt.Kind);
        // Супертип носія здачу не обмежує (рішення власника 2026-08-23): будь-який свій термінал
        // приймає будь-які дані, тож і попереджати нема про що.
        return label + ": " + cat + " · " + kind + ", T" + pt.Tier + " — " + amount + " бал.";
    }
}

class ZP_ActionIdentify : ActionInteractBase
{
    void ZP_ActionIdentify()
    {
        m_CommandUID = DayZPlayerConstants.CMD_ACTIONMOD_INTERACTONCE;
        m_StanceMask = DayZPlayerConstants.STANCEMASK_ERECT | DayZPlayerConstants.STANCEMASK_CROUCH;
        m_Text = "#str_zp_action_identify";
    }

    override void CreateConditionComponents()
    {
        m_ConditionItem = new CCINonRuined();   // носій у руках обов'язковий: без нього — дерево
        m_ConditionTarget = new CCTObject(UAMaxDistances.DEFAULT);
    }

    override bool ActionCondition(PlayerBase player, ActionTarget target, ItemBase item)
    {
        if (!target)
            return false;
        return ZP_Identify.CanIdentify(player, target.GetObject(), item);
    }

    // Ціль у цю мить може бути порожньою (урок 2026-08-02: виконання йде з події анімації),
    // але вона тут і не потрібна: Can() уже пройшов на сервері, а відповідь залежить лише
    // від предмета в руках і фракції гравця.
    override void OnExecuteServer(ActionData action_data)
    {
        if (!action_data)
            return;
        PlayerBase player = action_data.m_Player;
        ItemBase item = action_data.m_MainItem;
        if (!player || !item)
            return;
        player.MessageStatus("[ZP] " + ZP_Identify.Describe(item, ZP_Factions.GetFactionClass(player)));
    }
}
