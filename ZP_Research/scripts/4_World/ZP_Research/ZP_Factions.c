// Резолв фракції гравця — за НАШИВКОЮ у слоті Armband (реєстр: Factions.json).
//
// Чому саме цей слот: він першорівневий, тож дістається без рекурсії по вкладеннях;
// нашивка фізично одна на персонажа, тож фракція не може вийти подвійною; і її видно
// іншим гравцям — сервер бачить рівно те, що бачать вони.
//
// Expansion AI лишається СПЛЯЧОЮ гілкою під #ifdef: на цільовому сервері його немає
// (перевірено власником), але якщо колись повернуть — резолв підхопиться без правок.
// Порядок навмисний: нашивка головує, бо вона є завжди, а eAI — ні.
class ZP_Factions
{
    static string GetFactionClass(PlayerBase player)
    {
        if (!player)
            return ZP_ConfigService.Get().GetSettings().DefaultFaction;

        EntityAI armband = player.FindAttachmentBySlotName("Armband");
        if (armband)
        {
            ZP_FactionDef def = ZP_ConfigService.Get().GetFactions().FindByArmband(armband.GetType());
            if (def)
                return def.Id;
        }
#ifdef EXPANSIONMODAI
        int fid = player.eAI_GetFactionTypeID();
        typename ft = eAIFaction.GetTypeByID(fid);
        if (ft)
            return ft.ToString();
#endif
        return ZP_ConfigService.Get().GetSettings().DefaultFaction;
    }

    // Супертип фракції: наукові/бойові/сталкерські. Порожньо = фракції немає в реєстрі
    // (наприклад DefaultFaction) — такий супертип не збігається ні з чим.
    // Людська назва для повідомлень; для фракції поза реєстром повертаємо сам Id.
    static string GetDisplayName(string factionId)
    {
        ZP_FactionDef def = ZP_ConfigService.Get().GetFactions().Find(factionId);
        if (def && def.DisplayName != "")
            return def.DisplayName;
        return factionId;
    }

    // серверний пуш фракційного стану дерева клієнтові (для клієнтської сторони гейтів)
    static void SyncTreeTo(PlayerBase player)
    {
        if (!player || !player.GetIdentity())
            return;
        string fc = GetFactionClass(player);
        ZP_FactionData d = ZP_FactionDB.Get().Load(fc);
        ZP_TreeSync ts = new ZP_TreeSync();
        ts.FactionClass = fc;
        foreach (string n : d.CompletedNodes)
        {
            ts.CompletedNodes.Insert(n);
        }
        foreach (ZP_ActiveProject ap : d.ActiveProjects)
        {
            if (!ap)
                continue;
            ts.ResearchingNodes.Insert(ap.NodeId);
            ts.ResearchingEnds.Insert(ap.EndSec);
        }
        foreach (string ptId, int ptVal : d.Points)
        {
            ts.PoolPoints.Insert(new ZP_KV(ptId, ptVal));
        }
        GetRPCManager().SendRPC(ZP_Const.MOD, ZP_Const.RPC_SYNC_TREE, new Param1<ref ZP_TreeSync>(ts), true, player.GetIdentity());
    }

    // перевірка допуску правила для гравця: фракція + RequiredNode (єдиний гейт правил)
    static bool RuleAllowedFor(PlayerBase player, ZP_Rule rule, out string denyReason)
    {
        denyReason = "";
        string fc = GetFactionClass(player);
        if (rule.RequiredFactions.Count() > 0 && rule.RequiredFactions.Find(fc) < 0)
        {
            denyReason = "правило недоступне вашій фракції";
            return false;
        }
        if (rule.RequiredNode != "" && !ZP_FactionDB.Get().IsNodeCompleted(fc, rule.RequiredNode))
        {
            denyReason = "потрібне дослідження: " + DescribeRequiredNode(fc, rule.RequiredNode);
            return false;
        }
        string missingWorn;
        if (!ZP_Gear.WearsAll(player, rule.RequiredWorn, missingWorn))
        {
            denyReason = "потрібно вдягнути: " + missingWorn;
            return false;
        }
        return true;
    }

    // Гейт правила для АВТОПРОДОВЖЕННЯ станції: гравця поруч немає, перевіряються лише
    // умови, прив'язані до фракції. Вимога екіпірування свідомо не діє — її сенс у тому,
    // хто ЗАПУСКАЄ прилад, і вона вже спрацювала на першому циклі; інакше конвеєр
    // зупинявся б щоразу, коли гравець відійшов і зняв костюм.
    static bool RuleAllowedForFaction(string factionClass, ZP_Rule rule, out string denyReason)
    {
        denyReason = "";
        if (rule.RequiredFactions.Count() > 0 && rule.RequiredFactions.Find(factionClass) < 0)
        {
            denyReason = "правило недоступне фракції";
            return false;
        }
        if (rule.RequiredNode != "" && !ZP_FactionDB.Get().IsNodeCompleted(factionClass, rule.RequiredNode))
        {
            denyReason = "потрібне дослідження: " + DescribeRequiredNode(factionClass, rule.RequiredNode);
            return false;
        }
        return true;
    }

    // Як назвати потрібний вузол у тексті відмови. Свій — людською назвою (id гравцеві
    // ні про що не каже). ЧУЖИЙ — ніяк: інакше правило-гейт стає щілиною, крізь яку видно
    // ідентифікатори чужого дерева, повз усю пофракційність.
    static string DescribeRequiredNode(string factionClass, string nodeId)
    {
        ZP_TechTreeConfig tree = ZP_ConfigService.Get().GetTechTree();
        ZP_TreeNode n = tree.FindNode(nodeId);
        if (!n || !tree.NodeBelongsTo(n, factionClass))
            return "недоступне вашій фракції";
        if (n.Name != "")
            return n.Name;
        return nodeId;
    }
}

// Запуск дослідження вузла (миттєво або проєктом). SERVER ONLY.
class ZP_ResearchFlow
{
    static bool StartResearch(PlayerBase player, string nodeId, out string msg)
    {
        msg = "";
        if (!player || !player.GetIdentity())
        {
            msg = "немає identity";
            return false;
        }
        ZP_TreeNode node = ZP_ConfigService.Get().GetTechTree().FindNode(nodeId);
        string fc = ZP_Factions.GetFactionClass(player);
        // ОРАКУЛ: чужий вузол мусить відповідати РІВНО ТАК САМО, як неіснуючий. Інакше
        // різниця відповідей («не ваша фракція» проти «не знайдено») перетворює команду
        // на довідник чужого дерева: перебором id можна вивідати, які вузли існують.
        if (!node || !ZP_ConfigService.Get().GetTechTree().NodeBelongsTo(node, fc))
        {
            msg = "вузол '" + nodeId + "' не знайдено";
            return false;
        }
        string status = ZP_FactionDB.Get().GetNodeStatus(fc, node);
        if (status == "completed")
        {
            msg = "уже досліджено";
            return false;
        }
        if (status == "researching")
        {
            msg = "уже досліджується";
            return false;
        }
        if (status == "locked")
        {
            msg = "вузол заблоковано (батьківські вузли не досліджені або не ваша фракція)";
            return false;
        }
        // ТЕРМІНАЛ СВОЄЇ ФРАКЦІЇ ПОРУЧ — і саме в його карго мають лежати матеріали.
        // Перевірку «клас приладу поруч» (ResearchDevice) скасовано за рішенням власника:
        // вона зараховувала й ЧУЖИЙ прилад (FindNearbyDeviceOfClass звіряв лише клас), а
        // головне — вимога «принеси матеріали у свій комп'ютер» виразніша й перевіряється
        // однією сутністю замість двох.
        EntityAI terminal = FindOwnTerminalNearby(player, fc);
        if (!terminal)
        {
            msg = "потрібен ваш термінал поруч (3 м)";
            return false;
        }
        // ItemCost з інвентаря ініціатора (дизайн §4): план до будь-яких списань
        ref array<ItemBase> icPlan = new array<ItemBase>();
        ref array<int> icAmounts = new array<int>();
        string icErr;
        if (!BuildItemCostPlan(terminal, node.ItemCost, icPlan, icAmounts, icErr))
        {
            msg = icErr;
            return false;
        }
        string spendErr;
        if (!ZP_FactionDB.TrySpendCost(fc, node.Cost, spendErr))
        {
            msg = spendErr;
            return false;
        }
        ZP_Processing.ConsumePlan(icPlan, icAmounts);
        if (node.ResearchTimeSec <= 0)
        {
            ZP_FactionDB.Get().CompleteNode(fc, node.Id);
            ZP_TreeEvents.OnNodeCompleted(fc, node);
            msg = "досліджено: " + node.Name;
            return true;
        }
        int endSec = ZP_Now.EpochSec() + node.ResearchTimeSec;
        ZP_FactionDB.Get().AddProject(fc, node.Id, player.GetIdentity().GetPlainId(), endSec);
        msg = "проєкт запущено: " + node.Name + " (~" + node.ResearchTimeSec + " с)";
        return true;
    }

    // Термінал ВЛАСНОЇ фракції в радіусі 3 м. Клас звіряється тим самим джерелом істини,
    // що й дія відкриття дерева (ZP_ConfigService.IsTerminalFor), тож чужий комп'ютер сюди
    // не потрапляє — на відміну від скасованої перевірки за класом приладу.
    static EntityAI FindOwnTerminalNearby(PlayerBase player, string factionClass)
    {
        array<Object> objects = new array<Object>();
        array<CargoBase> proxyCargos = new array<CargoBase>();
        GetGame().GetObjectsAtPosition3D(player.GetPosition(), 3.0, objects, proxyCargos);
        foreach (Object o : objects)
        {
            if (o == player)
                continue;
            EntityAI e = EntityAI.Cast(o);
            if (!e || e.IsDamageDestroyed())
                continue;
            if (ZP_ConfigService.Get().IsTerminalFor(factionClass, o.GetType()))
                return e;
        }
        return null;
    }

    static Object FindNearbyDeviceOfClass(PlayerBase player, string cls)
    {
        array<Object> objects = new array<Object>();
        array<CargoBase> proxyCargos = new array<CargoBase>();
        GetGame().GetObjectsAtPosition3D(player.GetPosition(), 3.0, objects, proxyCargos);
        foreach (Object obj : objects)
        {
            if (obj == player)
                continue;
            // спалений прилад не рахується (симетрія з CCINonRuined на шляху екшену)
            EntityAI ent = EntityAI.Cast(obj);
            if (!ent || ent.IsDamageDestroyed())
                continue;
            if (ZP_ProcessingRules.MatchClass(obj.GetType(), cls))
                return obj;
        }
        return null;
    }

    // план ItemCost за інвентарем гравця (патерн планів M2a: AvailOf/резерв, без вкладених конфліктів
    // не потрібен — плануються лише незалежні предмети гравця, контейнерні випадки для ItemCost рідкісні)
    static bool BuildItemCostPlan(EntityAI holder, array<ref ZP_TreeItemCost> itemCost, out array<ItemBase> planItems, out array<int> planAmounts, out string err)
    {
        err = "";
        if (!itemCost || itemCost.Count() == 0)
            return true;
        foreach (ZP_TreeItemCost ic : itemCost)
        {
            int remaining = ic.Quantity;
            array<EntityAI> invItems = new array<EntityAI>();
            holder.GetInventory().EnumerateInventory(InventoryTraversalType.PREORDER, invItems);
            foreach (EntityAI e : invItems)
            {
                if (remaining <= 0)
                    break;
                ItemBase ib = ItemBase.Cast(e);
                if (!ib)
                    continue;
                if (!ZP_ProcessingRules.MatchInput(ib.GetType(), ZP_Sample_Base.ContentOf(ib), ic.Classname, ic.Content))
                    continue;
                int already = 0;
                int idx = planItems.Find(ib);
                if (idx > -1)
                    already = planAmounts[idx];
                int avail = 1;
                if (ib.ConfigGetBool("canBeSplit"))
                    avail = ib.GetQuantity();
                avail = avail - already;
                if (avail <= 0)
                    continue;
                int take = avail;
                if (take > remaining)
                    take = remaining;
                if (idx > -1)
                {
                    planAmounts[idx] = already + take;
                }
                else
                {
                    planItems.Insert(ib);
                    planAmounts.Insert(take);
                }
                remaining -= take;
            }
            if (remaining > 0)
            {
                err = "бракує для дослідження: " + ic.Classname + " x " + remaining;
                return false;
            }
        }
        return true;
    }
}

// Пересинк при зміні фракції.
//
// Фракція визначається НАШИВКОЮ, тож ловимо ванільні хуки вкладення в слот Armband:
// EEItemAttached/EEItemDetached оголошені в entityai.c:1138/1178 і вже перекриті у
// ванільному PlayerBase, тож modded-ланцюг працює. Це важливо саме тут: старий хук
// пересинку сидів під #ifdef EXPANSIONMODAI, а Expansion AI на сервері НЕМАЄ — виходило,
// що зміна нашивки не пересинкувала нічого до релогу.
//
// Пересинкуємо і КОНФІГ, і дерево: після кроку 3 конфіг пофракційний, тож зі старою
// збіркою гравець бачив би підказки чужих правил і чужі термінали.
modded class PlayerBase
{
    void ZP_ResyncFaction()
    {
        if (!GetGame() || !GetGame().IsDedicatedServer())
            return;
        if (!GetIdentity())
            return;
        string fc = ZP_Factions.GetFactionClass(this);
        ZP_ConfigService.Get().SyncTo(GetIdentity(), fc);
        ZP_Factions.SyncTreeTo(this);
    }

    override void EEItemAttached(EntityAI item, string slot_name)
    {
        super.EEItemAttached(item, slot_name);
        if (slot_name == "Armband")
            ZP_ResyncFaction();
    }

    override void EEItemDetached(EntityAI item, string slot_name)
    {
        super.EEItemDetached(item, slot_name);
        if (slot_name == "Armband")
            ZP_ResyncFaction();
    }

#ifdef EXPANSIONMODAI
    // Гілка Expansion лишається сплячою: якщо мод колись з'явиться, зміна його фракції
    // теж має пересинкувати. Хук eAI_OnFactionChange(int,int) звірено за сирими байтами
    // ai_scripts.pbo модпака: порожній віртуальний метод, кличеться з eAI_SetFactionTypeID.
    override void eAI_OnFactionChange(int oldFactionTypeID, int newFactionTypeID)
    {
        super.eAI_OnFactionChange(oldFactionTypeID, newFactionTypeID);
        ZP_ResyncFaction();
    }
#endif
}
