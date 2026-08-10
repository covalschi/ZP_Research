// Миттєвий F-екшен «Запустити аналіз» на фоновій станції.
// CCINone (Can() = true завжди), НЕ CCIDummy: у CCIDummy Can() = (item != null),
// тому промпт не з'являвся з порожніми руками — саме через це станцію не можна було
// запустити без предмета в руках (перевірено по ванільному ccidummy.c:5 / ccinone.c).
class ZP_ActionStartStation : ActionInteractBase
{
    void ZP_ActionStartStation()
    {
        m_CommandUID = DayZPlayerConstants.CMD_ACTIONMOD_INTERACTONCE;
        m_Text = "#str_zp_action_startstation";
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
        if (!dev || dev.IsDamageDestroyed())
            return false;
        if (dev.ZP_GetState() != ZP_Device_Base.ZP_STATE_IDLE)
            return false;
        // прилад належить фракції: чужий не дає ЖОДНОЇ взаємодії
        if (GetGame().IsDedicatedServer())
        {
            string srvFc = ZP_Factions.GetFactionClass(player);
            bool srvOwn = ZP_ConfigService.Get().IsDeviceFor(srvFc, dev.GetType());
            string bandInfo = "нашивки НЕМАЄ";
            EntityAI band = player.FindAttachmentBySlotName("Armband");
            if (band)
                bandInfo = band.GetType();
            ZP_Log.Dbg("StartStation.Can СЕРВЕР: " + dev.GetType() + " фракція=" + srvFc + " нашивка=" + bandInfo + " власний=" + srvOwn);
            if (!srvOwn)
                return false;
        }
        else if (!ZP_ClientState.Get().ClientDeviceAllowed(dev.GetType()))
        {
            return false;
        }
        if (!GetGame().IsDedicatedServer())
        {
            ZP_ClientState st = ZP_ClientState.Get();
            if (!st.m_ConfigReceived)
                return false;
            // клієнт: за типом приладу (карго клієнту не гарантовано видно) + фракція/вузол/
            // екіпірування (рев'ю M6: worn-гейт симетричний action-шляху); сервер уточнить
            foreach (ZP_ClientRule r : st.m_Config.Rules)
            {
                string m = r.Mode;
                m.ToLower();
                if (m != "background")
                    continue;
                if (!ZP_ProcessingRules.MatchClass(dev.GetType(), r.Device))
                    continue;
                if (!st.RuleAllowedClient(r))
                    continue;
                string missingWorn;
                if (!ZP_Gear.WearsAll(player, r.RequiredWorn, missingWorn))
                    continue;
                string missingTool;
                if (!ZP_Gear.DeviceHasTools(dev, r.RequiredTools, missingTool))
                    continue;
                return true;
            }
            return false;
        }
        return true;
    }

    override void OnExecuteServer(ActionData action_data)
    {
        ZP_Device_Base dev = ZP_Device_Base.Cast(action_data.m_Target.GetObject());
        if (!dev)
            return;
        ZP_Log.Dbg("StartStation.OnExecuteServer: " + dev.GetType());
        string msg;
        dev.ZP_StartStation(action_data.m_Player, msg);
        action_data.m_Player.MessageStatus("[ZP] " + msg);
    }
}
