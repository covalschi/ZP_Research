// Забір готового результату фонової станції (рішення власника: результат не видається сам,
// по нього треба прийти й провзаємодіяти ще раз).
// CCINone, НЕ CCIDummy: у CCIDummy Can() = (item != null), тож промпт не з'являвся б із
// порожніми руками — а по результат приходять саме з порожніми (перевірено ccidummy.c:5).
class ZP_ActionCollectResult : ActionInteractBase
{
    void ZP_ActionCollectResult()
    {
        m_CommandUID = DayZPlayerConstants.CMD_ACTIONMOD_INTERACTONCE;
        m_Text = "#str_zp_action_collect";
    }

    override void CreateConditionComponents()
    {
        m_ConditionItem = new CCINone();
        m_ConditionTarget = new CCTObject(UAMaxDistances.DEFAULT);
    }

    override bool ActionCondition(PlayerBase player, ActionTarget target, ItemBase item)
    {
        if (!target)
            return false;
        ZP_Device_Base dev = ZP_Device_Base.Cast(target.GetObject());
        if (!dev)
            return false;
        // Стан приладу нетсинчиться, тож клієнт гейтить промпт тим самим полем, що й сервер —
        // ані конфіг, ані правила для цього не потрібні: результат уже заморожено.
        if (dev.ZP_GetState() != ZP_Device_Base.ZP_STATE_DONE)
            return false;
        if (GetGame().IsDedicatedServer())
            return ZP_ConfigService.Get().IsDeviceFor(ZP_Factions.GetFactionClass(player), dev.GetType());
        return ZP_ClientState.Get().ClientDeviceAllowed(dev.GetType());
    }

    override void OnExecuteServer(ActionData action_data)
    {
        ZP_Device_Base dev = ZP_Device_Base.Cast(action_data.m_Target.GetObject());
        if (!dev)
            return;
        ZP_Log.Dbg("CollectResult.OnExecuteServer: " + dev.GetType());
        string msg;
        dev.ZP_CollectResult(action_data.m_Player, msg);
        action_data.m_Player.MessageStatus("[ZP] " + msg);
    }
}
