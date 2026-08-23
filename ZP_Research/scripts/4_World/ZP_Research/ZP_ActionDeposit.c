// ЗДАЧА ЗАГОТОВКИ НА ТЕРМІНАЛІ — остання ланка ланцюжка: сировина -> зразок -> заготовка ->
// БАЛИ в пул фракції. Утримання F із заготовкою в руках, ціль — свій термінал.
//
// Прилади балів не дають узагалі (рішення власника): єдине джерело балів у пулі — саме ця
// дія. Через це носій і не є зайвою ланкою — він те, що фізично несуть до термінала.
//
// ЧУЖІ ДАНІ ЗДАВАТИ МОЖНА, і це навмисно (спека §5c): термінал приймає будь-який супертип,
// бали йдуть у пул того, ХТО ЗДАЄ. Дефіцит створюється гейтом на ВИРОБНИЦТВІ — бойові дані
// фізично роблять лише на бойових станціях, — а не забороною на здачу. Інакше трофейна
// заготовка була б сміттям, і обміну між угрупованнями не виникло б.

class ZP_Deposit
{
    // Скільки триває здача. Не миттєво — щоб дія читалась як передача, а не як клік.
    static const float TIME_SEC = 3.0;

    // ЄДИНА умова здачі, спільна для обох дій. ZP_ActionDeposit повертає її як є, а
    // ZP_ActionOpenTree — заперечує: із заготовкою в руках F означає здачу, без неї —
    // дерево. Так дві дії на одній цілі й одній клавіші розходяться детерміновано, а не
    // за порядком реєстрації.
    static bool CanDeposit(PlayerBase player, Object obj, ItemBase item)
    {
        if (!player || !obj || !item)
            return false;
        EntityAI ent = EntityAI.Cast(obj);
        if (!ent || ent.IsDamageDestroyed())
            return false;                       // знищений термінал не працює
        if (item.IsRuined())
            return false;                       // зруйнована заготовка нічого не варта
        // Два види предметів: носій (ZP_Carrier_Base, рядок стану — спека 2026-08-23) і
        // явна заготовка (ZP_Data_Base, бали з DataItems.json). Гейти термінала спільні.
        bool isCarrier = GetGame().IsKindOf(item.GetType(), "ZP_Carrier_Base");
        if (!isCarrier && !GetGame().IsKindOf(item.GetType(), "ZP_Data_Base"))
            return false;

        if (GetGame().IsDedicatedServer())
        {
            ZP_ConfigService svc = ZP_ConfigService.Get();
            if (!svc)
                return false;
            string fc = ZP_Factions.GetFactionClass(player);
            if (!svc.IsTerminalFor(fc, obj.GetType()))
                return false;
            if (isCarrier)
            {
                string why;
                return CarrierAccepted(item, fc, svc, why);
            }
            // НЕОПИСАНА заготовка не здається: балів за неї немає, і мовчазне зникнення
            // предмета виглядало б як крадіжка. Гравець тоді просто відкриє дерево.
            ZP_DataDef def = svc.GetDataItems().Find(item.GetType());
            return ZP_DataItemsConfig.CountGrantable(def, svc.GetPointTypes()) > 0;
        }

        // клієнт: термінали й перелік заготовок він має з синхронізації
        ZP_ClientState st = ZP_ClientState.Get();
        if (!st.m_ConfigReceived || !st.m_Config)
            return false;
        bool isTerminal = false;
        foreach (string term : st.m_Config.TreeTerminalClasses)
        {
            if (ZP_ProcessingRules.MatchClass(obj.GetType(), term))
            {
                isTerminal = true;
                break;
            }
        }
        if (!isTerminal)
            return false;
        if (isCarrier)
            return true;   // стан носія клієнт не бачить за задумом — останнє слово за сервером
        // Прапорець рахує СЕРВЕР і надсилає готовим: сам клієнт балів не бачить, а без
        // цього його умова розходилася б із серверною — промпт обіцяв би здачу, сервер
        // відмовляв, і підказка дерева була б уже погашена (термінал ставав би мертвим).
        return ZP_DataInfo.IsDepositable(item.GetType());
    }

    // Сервер: чи приймає термінал фракції цей носій. Дві причини відмови, кожна названа:
    // порожній/битий стан і невідомий тип балів. СУПЕРТИП НЕ ГЕЙТИТЬСЯ (рішення власника
    // 2026-08-23): будь-який свій термінал приймає будь-який носій, бали йдуть у пул фракції
    // того, хто здає — трофейні дані теж чогось варті.
    static bool CarrierAccepted(ItemBase item, string faction, ZP_ConfigService svc, out string why)
    {
        why = "";
        string ptId;
        int amount;
        if (!ZP_CarrierState.Parse(ZP_Carrier_Base.StateOf(item), ptId, amount))
        {
            why = "носій порожній — стан не записано";
            return false;
        }
        if (!svc.GetPointTypes().Find(ptId))
        {
            why = "носій обіцяє тип балів '" + ptId + "', якого немає в PointTypes.json";
            return false;
        }
        return true;
    }

    // Серверне виконання: списання і зарахування НЕРОЗРИВНІ. Спершу читаємо все, що треба,
    // потім видаляємо предмет, і лише потім нараховуємо — так жоден порядок не дає ані
    // подвоєння балів, ані зникнення заготовки без нарахування.
    static bool Execute(PlayerBase player, Object obj, ItemBase item, out string msg)
    {
        msg = "";
        if (!GetGame().IsDedicatedServer())
        {
            msg = "лише сервер";
            return false;
        }
        if (!CanDeposit(player, obj, item))
        {
            msg = "здати цю заготовку тут не можна";
            string why0;
            if (GetGame().IsKindOf(item.GetType(), "ZP_Carrier_Base") && !CarrierAccepted(item, ZP_Factions.GetFactionClass(player), ZP_ConfigService.Get(), why0) && why0 != "")
                msg = why0;
            return false;
        }
        if (GetGame().IsKindOf(item.GetType(), "ZP_Carrier_Base"))
            return ZP_DepositCarrier.Run(player, item, msg);
        ZP_DataDef def = ZP_ConfigService.Get().GetDataItems().Find(item.GetType());
        if (!def)
        {
            msg = "заготовку '" + item.GetType() + "' не описано в DataItems.json";
            return false;
        }
        string faction = ZP_Factions.GetFactionClass(player);
        string itemType = item.GetType();

        // Знімок нагороди ДО видалення предмета — і одразу ЛИШЕ те, що справді нарахується.
        // Порядок тут і є гарантією нерозривності: якщо нараховувати нічого, предмет ще
        // цілий і ми просто відмовляємо; видалення йде тільки після того, як відомо, що
        // нагорода існує.
        ref array<string> types = new array<string>();
        ref array<int> amounts = new array<int>();
        ZP_PointTypesConfig ptCfg = ZP_ConfigService.Get().GetPointTypes();
        foreach (ZP_DataReward r : def.Points)
        {
            if (!r || r.Type == "" || r.Amount <= 0)
                continue;
            if (ptCfg && !ptCfg.Find(r.Type))
            {
                ZP_Log.Warn("deposit: заготовка '" + itemType + "' обіцяє тип балів '" + r.Type + "', якого немає в PointTypes.json — пропущено");
                continue;
            }
            types.Insert(r.Type);
            amounts.Insert(r.Amount);
        }
        if (types.Count() == 0)
        {
            msg = "за цю заготовку немає жодного чинного типу балів — здачу скасовано, предмет лишився";
            return false;
        }

        GetGame().ObjectDelete(item);

        string granted = "";
        for (int i = 0; i < types.Count(); i++)
        {
            string gmsg;
            // save=false: одна фіксація файлу фракції на всю здачу, а не на кожен тип балів
            ZP_FactionDB.Get().GrantPool(faction, types[i], amounts[i], gmsg, false);
            if (granted != "")
                granted += ", ";
            granted += types[i] + " +" + amounts[i];
        }
        ZP_FactionDB.Get().Save(faction);

        msg = "здано '" + def.Name + "': " + granted + " у пул " + faction;
        ZP_Log.Dbg("deposit: " + player.GetIdentity().GetPlainId() + " " + itemType + " -> " + faction + ": " + granted);
        return true;
    }
}

// Здача носія: рядок стану -> бали одного типу в пул фракції гравця. Сам носій зникає.
class ZP_DepositCarrier
{
    static bool Run(PlayerBase player, ItemBase item, out string msg)
    {
        ZP_ConfigService svc = ZP_ConfigService.Get();
        string faction = ZP_Factions.GetFactionClass(player);
        string ptId;
        int amount;
        ZP_CarrierState.Parse(ZP_Carrier_Base.StateOf(item), ptId, amount);   // CanDeposit уже перевірив
        string label = ZP_CarrierState.CarrierLabel(item.GetType());
        ZP_PointTypesConfig pts = svc.GetPointTypes();
        ZP_PointType pt = pts.Find(ptId);
        string human = ptId;
        if (pt)
            human = ZP_PointTypesConfig.DimensionName(pts.Categories, pt.Category) + " · " + ZP_PointTypesConfig.DimensionName(pts.Kinds, pt.Kind) + " T" + pt.Tier;

        GetGame().ObjectDelete(item);
        string gmsg;
        ZP_FactionDB.Get().GrantPool(faction, ptId, amount, gmsg, false);
        ZP_FactionDB.Get().Save(faction);
        msg = "здано «" + label + "»: " + human + " +" + amount + " у пул " + faction;
        ZP_Log.Dbg("deposit carrier: " + player.GetIdentity().GetPlainId() + " " + item.GetType() + " " + ptId + ":" + amount + " -> " + faction);
        return true;
    }
}

class ZP_ActionDepositCB : ActionContinuousBaseCB
{
    override void CreateActionComponent()
    {
        m_ActionData.m_ActionComponent = new CAContinuousTime(ZP_Deposit.TIME_SEC);
    }
}

class ZP_ActionDeposit : ActionContinuousBase
{
    void ZP_ActionDeposit()
    {
        m_CallbackClass = ZP_ActionDepositCB;
        m_CommandUID = DayZPlayerConstants.CMD_ACTIONFB_INTERACT;
        m_FullBody = true;
        m_StanceMask = DayZPlayerConstants.STANCEMASK_ERECT | DayZPlayerConstants.STANCEMASK_CROUCH;
        m_Text = "#str_zp_action_deposit";
    }

    // БЕЗ ЦЬОГО ДІЯ ВИСИТЬ НА ІНШІЙ КЛАВІШІ. ActionContinuousBase за замовчуванням
    // повертає ContinuousDefaultActionInput (actioncontinuousbase.c:179-182) — це ЛКМ, а не F;
    // на F сидить InteractActionInput (actioninteractbase.c:61-64). Тобто здача не ділила б
    // клавішу з деревом, а мовчки жила б окремо — при цьому дерево вона все одно гасила б
    // своєю умовою, і термінал із заготовкою в руках ставав би повністю мертвим.
    // Ваніль розв'язує це саме так: десятки continuous-дій перевизначають вхід
    // (actionactivatetrap.c:38, actionbuildpart.c:228 та ін.).
    override typename GetInputType()
    {
        return ContinuousInteractActionInput;
    }

    override void CreateConditionComponents()
    {
        m_ConditionItem = new CCINonRuined();
        m_ConditionTarget = new CCTObject(UAMaxDistances.DEFAULT);
    }

    override bool ActionCondition(PlayerBase player, ActionTarget target, ItemBase item)
    {
        if (!target)
            return false;
        return ZP_Deposit.CanDeposit(player, target.GetObject(), item);
    }

    override void OnFinishProgressServer(ActionData action_data)
    {
        if (!action_data || !action_data.m_Target)
            return;
        string msg;
        ZP_Deposit.Execute(action_data.m_Player, action_data.m_Target.GetObject(), action_data.m_MainItem, msg);
        // Відповідь гравцеві — і про успіх, і про відмову: раніше текст із дії губився, і
        // здача «мовчала», хоч пул мінявся (знайдено при відновленні носіїв 2026-08-23).
        if (msg != "" && action_data.m_Player)
            action_data.m_Player.MessageStatus("[ZP] " + msg);
    }
}
