// Чат-команди "!zp ...". Сервер отримує з ChatMessageEventParams лише НІК відправника —
// команда виконується тільки за рівно одного збігу ніка серед онлайну (анти-спуфінг);
// права доступу далі перевіряються за identity знайденого гравця (ZP_AdminAuth).
class ZP_ChatCommands
{
    static void OnChatMessage(int channel, string senderName, string text)
    {
        if (text.IndexOf(ZP_Const.CHAT_PREFIX) != 0)
            return;

        TStringArray tokens = new TStringArray;
        text.Split(" ", tokens);
        if (tokens.Count() == 0 || tokens[0] != ZP_Const.CHAT_PREFIX)
            return;

        int matches;
        PlayerBase sender = FindUniquePlayerByName(senderName, matches);
        if (!sender || !sender.GetIdentity())
        {
            ZP_Log.Warn("чат-команду від '" + senderName + "' проігноровано: " + matches + " збігів ніка");
            return;
        }

        if (tokens.Count() < 2)
        {
            Reply(sender, "використання: !zp tree | pool | faction | research <вузол> | set <ключ> <значення> | reload | help");
            return;
        }

        string cmd = tokens[1];
        cmd.ToLower();

        if (cmd == "help")
        {
            Reply(sender, "!zp tree/pool/faction/research <вузол> (візуальне дерево — дія F на науковому комп'ютері); адмін: editor/treeui/static*/set/pointtype/reload/spawn*/start|fill|cancelstation/probe/collect/grantpool/completenode/resetfaction/upsertnode/deletenode/deleterule/datalist/sample/sampleinfo/fillsample/modules/deposit");
            Reply(sender, "зразки: !zp sample [клас] <вміст> [чистота] | !zp fillsample [клас] <вміст> [чистота] [к-сть] [прилад]; клас — із родини ZP_Sample_Base (ZP_Sample_01..30), без нього береться сумісний ZP_Sample, якого не бере жодне правило стенду");
            return;
        }
        if (cmd == "tree")
        {
            CmdTree(sender);
            return;
        }
        if (cmd == "pool")
        {
            Reply(sender, "пул " + ZP_Factions.GetFactionClass(sender) + ": " + ZP_FactionDB.Get().DescribePool(ZP_Factions.GetFactionClass(sender)));
            return;
        }
        if (cmd == "faction")
        {
            // показуємо і ДЖЕРЕЛО: без нього «чому я не тієї фракції» не діагностується —
            // нашивки може не бути зовсім, або вона є, але її класу немає в реєстрі
            string myFc = ZP_Factions.GetFactionClass(sender);
            string src = "за замовчуванням (нашивки немає або її клас невідомий)";
            EntityAI myBand = sender.FindAttachmentBySlotName("Armband");
            if (myBand)
            {
                if (ZP_ConfigService.Get().GetFactions().FindByArmband(myBand.GetType()))
                    src = "нашивка " + myBand.GetType();
                else
                    src = "нашивка " + myBand.GetType() + " НЕ в реєстрі фракцій";
            }
            string sup = ZP_ConfigService.Get().GetFactions().SupertypeOf(myFc);
            if (sup == "")
                sup = "—";
            // термінали показуємо тут само: «чому не відкривається дерево» без цього
            // не діагностується — видно лише те, що підказки немає
            string terms = "";
            foreach (string tcls : ZP_ConfigService.Get().TerminalsFor(myFc))
            {
                if (terms != "")
                    terms += ", ";
                terms += tcls;
            }
            if (terms == "")
                terms = "НЕМАЄ (дерево не відкриється жодним приладом)";
            Reply(sender, "фракція: " + ZP_Factions.GetDisplayName(myFc) + " [" + myFc + "], супертип: " + sup + "; джерело: " + src);
            Reply(sender, "термінали фракції: " + terms);
            string devs = "";
            array<string> devList = ZP_ConfigService.Get().DevicesFor(myFc);
            if (!devList)
            {
                devs = "поділу немає — доступні всі";
            }
            else
            {
                foreach (string dcls : devList)
                {
                    if (devs != "")
                        devs += ", ";
                    devs += dcls;
                }
                if (devs == "")
                    devs = "НЕМАЄ (жодна станція не спрацює)";
            }
            Reply(sender, "прилади фракції: " + devs);
            return;
        }
        if (cmd == "research")
        {
            if (tokens.Count() < 3)
            {
                Reply(sender, "використання: !zp research <id вузла>");
                return;
            }
            string rmsg;
            bool rok = ZP_ResearchFlow.StartResearch(sender, tokens[2], rmsg);
            Reply(sender, ReplyPrefix(rok) + rmsg);
            if (rok)
                ZP_Factions.SyncTreeTo(sender);
            return;
        }

        // усе далі — тільки адмін
        if (!ZP_AdminAuth.IsAdmin(sender.GetIdentity()))
        {
            Reply(sender, "немає прав доступу ZP Research Admin");
            return;
        }

        if (cmd == "set")
        {
            CmdSet(sender, tokens);
            return;
        }
        if (cmd == "pointtype")
        {
            CmdPointType(sender, tokens);
            return;
        }
        if (cmd == "reload")
        {
            string message;
            bool ok = ZP_ConfigService.Get().ApplyOp(ZP_Op.RELOAD_ALL, "", message);
            Reply(sender, ReplyPrefix(ok) + message);
            return;
        }
        if (cmd == "spawn")
        {
            CmdSpawn(sender, tokens);
            return;
        }
        if (cmd == "spawnground")
        {
            CmdSpawnGround(sender, tokens);
            return;
        }
        if (cmd == "spawnhere")
        {
            CmdSpawnHere(sender, tokens);
            return;
        }
        if (cmd == "spawnhands")
        {
            CmdSpawnHands(sender, tokens);
            return;
        }
        if (cmd == "startstation")
        {
            CmdStartStation(sender, tokens);
            return;
        }
        if (cmd == "fillstation")
        {
            CmdFillStation(sender, tokens);
            return;
        }
        if (cmd == "probe")
        {
            CmdProbe(sender, tokens);
            return;
        }
        if (cmd == "rpcprobe")
        {
            CmdRpcProbe(sender);
            return;
        }
        if (cmd == "collect")
        {
            CmdCollect(sender, tokens);
            return;
        }
        if (cmd == "cancelstation")
        {
            string csFilter = "";
            if (tokens.Count() >= 3)
                csFilter = tokens[2];
            ZP_Device_Base csDev = FindNearestStation(sender, csFilter);
            if (!csDev)
            {
                Reply(sender, "поруч (3 м) немає придатного приладу ZP");
                return;
            }
            string csMsg;
            bool csOk = csDev.ZP_AdminCancel("адмін-команда", csMsg);
            Reply(sender, ReplyPrefix(csOk) + csDev.GetType() + ": " + csMsg);
            return;
        }
        if (cmd == "grantpool")
        {
            if (tokens.Count() < 4)
            {
                Reply(sender, "використання: !zp grantpool <типБалів> <к-сть>");
                return;
            }
            int pamount = tokens[3].ToInt();
            if (pamount == 0 && tokens[3] != "0")
            {
                Reply(sender, "не число: '" + tokens[3] + "'");
                return;
            }
            string pfc = ZP_Factions.GetFactionClass(sender);
            string pmsg;
            bool pok = ZP_FactionDB.Get().GrantPool(pfc, tokens[2], pamount, pmsg);
            Reply(sender, ReplyPrefix(pok) + pmsg);
            return;
        }
        if (cmd == "staticadd")
        {
            if (tokens.Count() < 3)
            {
                Reply(sender, "використання: !zp staticadd <classname> [id] — статик за 1.5 м перед вами, запис у StaticDevices.json");
                return;
            }
            string saId = "";
            if (tokens.Count() >= 4)
                saId = tokens[3];
            string saMsg;
            bool saOk = ZP_StaticSpawner.AddAt(sender, tokens[2], saId, saMsg);
            Reply(sender, ReplyPrefix(saOk) + saMsg);
            return;
        }
        if (cmd == "staticrespawn")
        {
            if (tokens.Count() < 3)
            {
                Reply(sender, "використання: !zp staticrespawn <id запису>");
                return;
            }
            string srMsg;
            bool srOk = ZP_StaticSpawner.RespawnEntry(tokens[2], srMsg);
            Reply(sender, ReplyPrefix(srOk) + srMsg);
            return;
        }
        if (cmd == "statics")
        {
            Reply(sender, "статики: " + ZP_StaticSpawner.DescribeEntries());
            return;
        }
        if (cmd == "treeui")
        {
            // дебаг-шлях для адміна; штатно дерево відкривається дією F на терміналі
            // (ZP_ActionOpenTree, Settings.TreeTerminalClasses)
            ZP_Log.Dbg("server: надсилаю RPC відкриття дерева -> " + sender.GetIdentity().GetPlainId());
            GetRPCManager().SendRPC(ZP_Const.MOD, ZP_Const.RPC_OPEN_TREE, new Param1<bool>(true), true, sender.GetIdentity());
            return;
        }
        if (cmd == "editor")
        {
            // UI відкривається на клієнті; права адміна вже перевірено вище
            GetRPCManager().SendRPC(ZP_Const.MOD, ZP_Const.RPC_OPEN_EDITOR, new Param1<bool>(true), true, sender.GetIdentity());
            return;
        }
        if (cmd == "upsertnode")
        {
            CmdUpsertNode(sender, tokens);
            return;
        }
        if (cmd == "deletenode")
        {
            CmdDeleteNode(sender, tokens);
            return;
        }
        if (cmd == "deleterule")
        {
            CmdDeleteRule(sender, tokens);
            return;
        }
        if (cmd == "completenode")
        {
            if (tokens.Count() < 3)
            {
                Reply(sender, "використання: !zp completenode <id вузла>");
                return;
            }
            ZP_TreeNode cnode = ZP_ConfigService.Get().GetTechTree().FindNode(tokens[2]);
            if (!cnode)
            {
                Reply(sender, "вузол '" + tokens[2] + "' не знайдено");
                return;
            }
            string cfc = ZP_Factions.GetFactionClass(sender);
            ZP_FactionDB.Get().CompleteNode(cfc, cnode.Id);
            ZP_TreeEvents.OnNodeCompleted(cfc, cnode);
            Reply(sender, "OK: вузол '" + cnode.Id + "' завершено для " + cfc + " (чит)");
            return;
        }
        if (cmd == "resetfaction")
        {
            CmdResetFaction(sender, tokens);
            return;
        }

        if (cmd == "datalist")
        {
            CmdDataList(sender);
            return;
        }
        if (cmd == "sample")
        {
            CmdSample(sender, tokens);
            return;
        }
        if (cmd == "sampleinfo")
        {
            CmdSampleInfo(sender);
            return;
        }
        if (cmd == "fillsample")
        {
            CmdFillSample(sender, tokens);
            return;
        }
        if (cmd == "modules")
        {
            CmdModules(sender, tokens);
            return;
        }
        if (cmd == "deposit")
        {
            CmdDeposit(sender);
            return;
        }

        Reply(sender, "невідома команда: " + cmd + " (див. !zp help)");
    }

    // ---- команди ----

    // Перелік налаштованих заготовок. Без нього «чому предмет називається не так» не
    // діагностується: видно лише те, що назва не та, а чи прочитався конфіг — ні.
    protected static void CmdDataList(PlayerBase sender)
    {
        ZP_DataItemsConfig cfg = ZP_ConfigService.Get().GetDataItems();
        if (!cfg || cfg.Items.Count() == 0)
        {
            Reply(sender, "DataItems.json порожній — жодної заготовки не описано (усі 90 покажуть запасну назву)");
            return;
        }
        Reply(sender, "заготовок описано: " + cfg.Items.Count());
        int shown = 0;
        foreach (ZP_DataDef d : cfg.Items)
        {
            if (!d)
                continue;
            if (shown >= 12)
            {
                Reply(sender, "... решта " + (cfg.Items.Count() - shown) + " — у DataItems.json");
                break;
            }
            string pts = "";
            foreach (ZP_DataReward r : d.Points)
            {
                if (!r)
                    continue;
                if (pts != "")
                    pts += ", ";
                pts += r.Type + " x" + r.Amount;
            }
            if (pts == "")
                pts = "балів немає";
            string state = "";
            if (!d.Enabled)
                state = " [ВИМКНЕНО]";
            Reply(sender, d.Id + state + ": «" + d.Name + "» " + pts);
            shown++;
        }
    }

    // НЕОБОВ'ЯЗКОВИЙ КЛАС ЗРАЗКА на початку аргументів (2026-08-09).
    //
    // Навіщо: раніше `!zp sample` і `!zp fillsample` створювали захардкожений клас
    // "ZP_Sample", а це СУМІСНИЙ клас-мостик — у config-ієрархії він БРАТ класів
    // ZP_Sample_01..30, а не предок (config.cpp: усі вони : ZP_Sample_Base). Правила стенду
    // чекають конкретний ZP_Sample_01/03/17, а співставлення входу йде через
    // MatchClass -> IsKindOf (ZP_ProcessingConfig.c:150), тож "ZP_Sample" не збігався з
    // жодним із них: зразок лягав у карго, і станція МОВЧКИ не стартувала.
    //
    // Розпізнавання: перший токен, що починається на "zp_" (регістр байдужий), читається як
    // КЛАС, решта аргументів зсувається. Мітки вмісту на стенді ("eco_bio", "sky_anom",
    // "Apple", "zapys_detektora") на "zp_" не починаються, тож старий виклик
    // `!zp sample eco_bio 0.9` працює як і раніше (сумісність збережено — клас за
    // замовчуванням лишається "ZP_Sample"). Класоподібний токен, якого немає в родині
    // ZP_Sample_Base, — це ВІДМОВА з поясненням, а не тиха мітка вмісту: інакше друкарська
    // помилка в класі перетворилась би на зразок із вмістом "ZP_Sample_99".
    protected static bool TakeSampleClass(TStringArray tokens, int at, out string cls, out int next, out string err)
    {
        cls = "ZP_Sample";
        next = at;
        err = "";
        if (tokens.Count() <= at)
            return true;
        string tok = tokens[at];
        string low = tok;
        low.ToLower();
        if (low.IndexOf("zp_") != 0)
            return true;                  // це мітка вмісту, а не клас
        if (!ZP_ProcessingRules.IsSampleClass(tok))
        {
            err = "'" + tok + "' не є класом зразка: потрібен нащадок ZP_Sample_Base (ZP_Sample_01..30 або сумісний ZP_Sample)";
            return false;
        }
        cls = tok;
        next = at + 1;
        return true;
    }

    // Попередження про клас за замовчуванням. "ZP_Sample" створюється, але його не бере
    // ЖОДНЕ правило стенду — краще сказати це одразу, ніж лишити адміна зі станцією,
    // яка «чомусь не стартує».
    protected static void WarnCompatSampleClass(PlayerBase sender, string cls)
    {
        if (cls != "ZP_Sample")
            return;
        Reply(sender, "УВАГА: клас не вказано -> ZP_Sample (сумісний клас-мостик, брат ZP_Sample_01..30, а не предок).");
        Reply(sender, "Правила стенду чекають ZP_Sample_01 / ZP_Sample_03 / ZP_Sample_17 — вкажіть клас першим аргументом.");
    }

    // Зразок із проставленими прихованими полями. Це діагностичний шлях: штатно зразок
    // створює правило-пакувальник (наступний підкрок).
    protected static void CmdSample(PlayerBase sender, TStringArray tokens)
    {
        string cls;
        int at;
        string err;
        if (!TakeSampleClass(tokens, 2, cls, at, err))
        {
            Reply(sender, err);
            return;
        }
        if (tokens.Count() <= at)
        {
            Reply(sender, "використання: !zp sample [клас зразка] <вміст> [чистота 0..N]");
            Reply(sender, "напр.: !zp sample ZP_Sample_01 eco_bio 0.9");
            return;
        }
        string content = tokens[at];
        float purity = 1.0;
        if (tokens.Count() > at + 1)
            purity = tokens[at + 1].ToFloat();
        EntityAI created = sender.CreateInInventory(cls);
        if (!created)
            created = sender.SpawnEntityOnGroundOnCursorDir(cls, 0.5);
        // каст САМЕ на базу родини: предмет із config-класом ZP_Sample_07 ніколи не буде
        // інстансом скрипт-класу ZP_Sample (той — окремий нащадок ZP_Sample_Base)
        ZP_Sample_Base smp = ZP_Sample_Base.Cast(created);
        if (!smp)
        {
            Reply(sender, "не вдалося створити " + cls);
            return;
        }
        smp.ZP_SetContent(content, purity);
        Reply(sender, "OK: " + cls + " вміст '" + content + "' чистота " + purity + ", id=" + smp.ZP_GetContentId());
        WarnCompatSampleClass(sender, cls);
    }

    // Здача заготовки без прицілювання: заготовка в руках + найближчий СВІЙ термінал за 3 м.
    // Штатний шлях — утримання F на терміналі; це діагностичний дубль, як і решта.
    protected static void CmdDeposit(PlayerBase sender)
    {
        ItemBase inHands = sender.GetItemInHands();
        if (!inHands)
        {
            Reply(sender, "візьміть заготовку (ZP_Data_*) у руки");
            return;
        }
        array<Object> objects = new array<Object>();
        array<CargoBase> proxyCargos = new array<CargoBase>();
        GetGame().GetObjectsAtPosition3D(sender.GetPosition(), 3.0, objects, proxyCargos);
        Object terminal = null;
        foreach (Object obj : objects)
        {
            if (obj == sender)
                continue;
            if (ZP_Deposit.CanDeposit(sender, obj, inHands))
            {
                terminal = obj;
                break;
            }
        }
        if (!terminal)
        {
            Reply(sender, "поруч (3 м) немає вашого термінала, який прийме '" + inHands.GetType() + "'");
            return;
        }
        string msg;
        bool ok = ZP_Deposit.Execute(sender, terminal, inHands, msg);
        Reply(sender, ReplyPrefix(ok) + msg);
    }

    // Реєстр модулів чистоти + що фактично стоїть у найближчому приладі. Без другої
    // половини «чому чистота не така» не діагностується: у конфігу бонус є, а в приладі
    // може стояти зруйнований модуль або взагалі не той клас.
    protected static void CmdModules(PlayerBase sender, TStringArray tokens)
    {
        ZP_ModulesConfig cfg = ZP_ConfigService.Get().GetModules();
        if (!cfg || cfg.Modules.Count() == 0)
        {
            Reply(sender, "Modules.json порожній — бонусів чистоти немає");
        }
        else
        {
            Reply(sender, "модулі чистоти (однакові НЕ складаються):");
            foreach (ZP_ModuleDef m : cfg.Modules)
            {
                if (m)
                    Reply(sender, "  " + m.Classname + " +" + m.PurityBonus);
            }
        }
        string devFilter = "";
        if (tokens.Count() >= 3)
            devFilter = tokens[2];
        ZP_Device_Base dev = FindNearestStation(sender, devFilter);
        if (!dev)
        {
            Reply(sender, "поруч (3 м) немає приладу ZP — сумарний бонус не показую");
            return;
        }
        Reply(sender, dev.GetType() + ": сумарний бонус модулів = +" + ZP_Gear.DeviceModuleBonus(dev));
    }

    // Зразки ПРЯМО В КАРГО станції: !zp fillsample [клас зразка] <вміст> [чистота] [к-сть] [клас приладу].
    // Дзеркало !zp fillstation для предмета, який не можна заспавнити самим класнеймом —
    // без вмісту зразок у карго нічого не означає.
    //
    // Клас ЗРАЗКА йде ПЕРШИМ, клас ПРИЛАДУ — останнім: обидва починаються на "ZP_", і
    // розрізняє їх лише позиція (перший токен читає TakeSampleClass, останній — фільтр
    // приладу). Ця асиметрія навмисна: фільтр приладу існував раніше й ламати його порядок
    // означало б переписати всі старі виклики.
    protected static void CmdFillSample(PlayerBase sender, TStringArray tokens)
    {
        string cls;
        int at;
        string err;
        if (!TakeSampleClass(tokens, 2, cls, at, err))
        {
            Reply(sender, err + "; клас ПРИЛАДУ — це останній аргумент, а не перший");
            return;
        }
        if (tokens.Count() <= at)
        {
            Reply(sender, "використання: !zp fillsample [клас зразка] <вміст> [чистота] [к-сть до 10] [клас приладу]");
            Reply(sender, "напр.: !zp fillsample ZP_Sample_01 eco_bio 1 1 ZP_Eco_Proc_Bio");
            return;
        }
        string content = tokens[at];
        float purity = 1.0;
        if (tokens.Count() > at + 1)
            purity = tokens[at + 1].ToFloat();
        int count = 1;
        if (tokens.Count() > at + 2)
        {
            count = tokens[at + 2].ToInt();
            if (count < 1)
                count = 1;
            if (count > 10)
                count = 10;
        }
        string devFilter = "";
        if (tokens.Count() > at + 3)
            devFilter = tokens[at + 3];
        ZP_Device_Base dev = FindNearestStation(sender, devFilter);
        if (!dev)
        {
            Reply(sender, "поруч (3 м) немає придатного приладу ZP");
            return;
        }
        int made = 0;
        for (int i = 0; i < count; i++)
        {
            EntityAI created = ZP_Processing.SpawnOneToCargo(dev, cls, content, purity);
            if (!created)
                break;
            made++;
        }
        Reply(sender, "OK: у карго " + dev.GetType() + " покладено " + cls + ": " + made + " (вміст '" + content + "', чистота " + purity + ")");
        WarnCompatSampleClass(sender, cls);
    }

    // Приховані поля зразка в руках. Дивимось ЗНАЧЕННЯ, за якими далі прийматимуться
    // рішення, а не факт того, що предмет знайшовся.
    protected static void CmdSampleInfo(PlayerBase sender)
    {
        ItemBase inHands = sender.GetItemInHands();
        // родина, а не один клас (W2.5 T1): у руках може бути будь-який ZP_Sample_01..30
        ZP_Sample_Base smp = ZP_Sample_Base.Cast(inHands);
        if (!smp)
        {
            Reply(sender, "візьміть зразок (родина ZP_Sample_Base) у руки");
            return;
        }
        Reply(sender, "зразок: вміст='" + smp.ZP_GetContent() + "' чистота=" + smp.ZP_GetPurity() + " id=" + smp.ZP_GetContentId());
        Reply(sender, "клієнтське число дивіться в script.log клієнта (рядок 'sample ... netsync')");
    }

    // Скидання прогресу фракції перед тестовою сесією. Через ApplyOp — заради бекапу,
    // аудит-логу й ревізії. Правити FactionData\*.json руками на живому сервері марно:
    // кеш у пам'яті виграє й затре файл найближчим збереженням.
    protected static void CmdResetFaction(PlayerBase sender, TStringArray tokens)
    {
        ZP_Op_ResetFaction op = new ZP_Op_ResetFaction();
        if (tokens.Count() >= 3)
            op.FactionClass = tokens[2];
        else
            op.FactionClass = ZP_Factions.GetFactionClass(sender);   // типово — своя фракція
        string payload;
        string err;
        if (!JsonFileLoader<ZP_Op_ResetFaction>.MakeData(op, payload, err, false))
        {
            Reply(sender, "помилка серіалізації: " + err);
            return;
        }
        string message;
        bool ok = ZP_ConfigService.Get().ApplyOp(ZP_Op.RESET_FACTION, payload, message);
        Reply(sender, ReplyPrefix(ok) + message);
        if (ok)
            Reply(sender, "увага: особисті бали й лічильники анти-фарму (кулдауни) НЕ скидаються");
    }

    protected static void CmdSet(PlayerBase sender, TStringArray tokens)
    {
        if (tokens.Count() < 4)
        {
            Reply(sender, "!zp set <ключ> <значення>: debug | pointsownership | diminishhalfafter | energyradius | treedepth | treeterminal (класи через кому, без пробілів)");
            return;
        }
        ZP_Op_SetSetting op = new ZP_Op_SetSetting();
        op.Key = tokens[2];
        op.Value = tokens[3];
        string payload;
        string err;
        if (!JsonFileLoader<ZP_Op_SetSetting>.MakeData(op, payload, err, false))
        {
            Reply(sender, "помилка серіалізації: " + err);
            return;
        }
        string message;
        bool ok = ZP_ConfigService.Get().ApplyOp(ZP_Op.SET_SETTING, payload, message);
        Reply(sender, ReplyPrefix(ok) + message);
    }

    protected static void CmdPointType(PlayerBase sender, TStringArray tokens)
    {
        if (tokens.Count() < 4)
        {
            Reply(sender, "використання: !zp pointtype <id> <назва (можна з пробілами)>");
            return;
        }
        ZP_PointType pt = new ZP_PointType();
        pt.Id = tokens[2];
        string name = "";
        for (int i = 3; i < tokens.Count(); i++)
        {
            if (name != "")
                name += " ";
            name += tokens[i];
        }
        pt.Name = name;
        ZP_PointType existing = ZP_ConfigService.Get().GetPointTypes().Find(pt.Id);
        if (existing)
        {
            pt.Icon = existing.Icon;
            pt.Color = existing.Color;
            pt.SortOrder = existing.SortOrder;
        }
        string payload;
        string err;
        if (!JsonFileLoader<ZP_PointType>.MakeData(pt, payload, err, false))
        {
            Reply(sender, "помилка серіалізації: " + err);
            return;
        }
        string message;
        bool ok = ZP_ConfigService.Get().ApplyOp(ZP_Op.UPSERT_POINTTYPE, payload, message);
        Reply(sender, ReplyPrefix(ok) + message);
    }

    protected static void CmdSpawn(PlayerBase sender, TStringArray tokens)
    {
        if (tokens.Count() < 3)
        {
            Reply(sender, "використання: !zp spawn <classname> [к-сть до 10]");
            return;
        }
        string cls = tokens[2];
        if (!ZP_ProcessingRules.ClassExists(cls))
        {
            Reply(sender, "невідомий клас: '" + cls + "'");
            return;
        }
        int count = 1;
        if (tokens.Count() >= 4)
        {
            count = tokens[3].ToInt();
            if (count < 1)
                count = 1;
            if (count > 10)
                count = 10;
        }
        int spawned = 0;
        for (int i = 0; i < count; i++)
        {
            EntityAI created = sender.CreateInInventory(cls);
            if (!created)
                created = sender.SpawnEntityOnGroundOnCursorDir(cls, 0.5);   // інвентар повний — на землю
            if (created)
                spawned++;
        }
        Reply(sender, "OK: заспавнено " + spawned + " x " + cls);
    }

    protected static void CmdSpawnGround(PlayerBase sender, TStringArray tokens)
    {
        if (tokens.Count() < 3)
        {
            Reply(sender, "використання: !zp spawnground <classname>");
            return;
        }
        string cls = tokens[2];
        if (!ZP_ProcessingRules.ClassExists(cls))
        {
            Reply(sender, "невідомий клас: '" + cls + "'");
            return;
        }
        sender.SpawnEntityOnGroundOnCursorDir(cls, 1.5);
        Reply(sender, "OK: " + cls + " перед вами");
    }

    // детермінований спавн: рівно за 2 м у напрямку погляду, на землю
    protected static void CmdSpawnHere(PlayerBase sender, TStringArray tokens)
    {
        if (tokens.Count() < 3)
        {
            Reply(sender, "використання: !zp spawnhere <classname>");
            return;
        }
        string cls = tokens[2];
        if (!ZP_ProcessingRules.ClassExists(cls))
        {
            Reply(sender, "невідомий клас: '" + cls + "'");
            return;
        }
        vector pos = sender.GetPosition() + sender.GetDirection() * 2;
        sender.SpawnEntityOnGroundPos(cls, pos);
        Reply(sender, "OK: " + cls + " за 2 м перед вами");
    }

    protected static void CmdSpawnHands(PlayerBase sender, TStringArray tokens)
    {
        if (tokens.Count() < 3)
        {
            Reply(sender, "використання: !zp spawnhands <classname>");
            return;
        }
        string cls = tokens[2];
        if (!ZP_ProcessingRules.ClassExists(cls))
        {
            Reply(sender, "невідомий клас: '" + cls + "'");
            return;
        }
        // зайняті руки: CreateInHands мовчки поверне null; чит-команда чистить руки сама
        // (ObjectDelete відкладено до кінця кадру — створити в тому самому виклику не можна, просимо повторити)
        EntityAI old = sender.GetHumanInventory().GetEntityInHands();
        if (old)
        {
            GetGame().ObjectDelete(old);
            Reply(sender, "руки очищено (" + old.GetType() + " видалено) — повторіть команду");
            return;
        }
        EntityAI inHands = sender.GetHumanInventory().CreateInHands(cls);
        if (inHands)
            Reply(sender, "OK: " + cls + " у руках");
        else
            Reply(sender, "ПОМИЛКА: не вдалося створити " + cls + " у руках");
    }

    // дерево своєї фракції по рядках (для двох-трьох вузлів демо нормально; повноцінний вигляд — M4 UI)
    protected static void CmdTree(PlayerBase sender)
    {
        string fc = ZP_Factions.GetFactionClass(sender);
        ZP_TechTreeConfig tree = ZP_ConfigService.Get().GetTechTree();
        if (tree.Nodes.Count() == 0)
        {
            Reply(sender, "дерево порожнє");
            return;
        }
        Reply(sender, "дерево (" + fc + "):");
        int shown = 0;
        foreach (ZP_TreeNode n : tree.Nodes)
        {
            // лише СВОЇ вузли: інакше текстовий список був би найпростішим способом
            // прочитати чуже дерево цілком, повз усю пофракційність конфігу
            if (!tree.NodeBelongsTo(n, fc))
                continue;
            shown++;
            string status = ZP_FactionDB.Get().GetNodeStatus(fc, n);
            string costStr = "";
            foreach (ZP_TreeCost c : n.Cost)
            {
                costStr += c.Type + " x" + c.Amount + " ";
            }
            foreach (ZP_TreeItemCost ic : n.ItemCost)
            {
                costStr += ic.Classname + " x" + ic.Quantity + " ";
            }
            Reply(sender, n.Id + " [" + status + "] " + costStr);
        }
        if (shown == 0)
            Reply(sender, "для вашої фракції вузлів немає");
    }

    protected static ZP_Device_Base FindNearestStation(PlayerBase sender, string devFilter = "")
    {
        array<Object> objects = new array<Object>();
        array<CargoBase> proxyCargos = new array<CargoBase>();
        GetGame().GetObjectsAtPosition3D(sender.GetPosition(), 3.0, objects, proxyCargos);
        foreach (Object obj : objects)
        {
            ZP_Device_Base dev = ZP_Device_Base.Cast(obj);
            if (!dev)
                continue;
            if (devFilter != "" && !ZP_ProcessingRules.MatchClass(dev.GetType(), devFilter))
                continue;
            return dev;
        }
        return null;
    }

    // тест фонових станцій без прицілювання: !zp startstation [клас приладу]
    protected static void CmdStartStation(PlayerBase sender, TStringArray tokens)
    {
        string devFilter = "";
        if (tokens.Count() >= 3)
            devFilter = tokens[2];
        ZP_Device_Base dev = FindNearestStation(sender, devFilter);
        if (!dev)
        {
            Reply(sender, "поруч (3 м) немає придатного приладу ZP");
            return;
        }
        string msg;
        dev.ZP_StartStation(sender, msg);
        Reply(sender, dev.GetType() + ": " + msg);
    }

    // ЗОНД: чому на приладі немає підказки. Прогоняє ті самі перевірки, що й ActionCondition,
    // і друкує результат кожної. Без нього «підказки немає» — це один біт інформації, і
    // причину доводиться шукати перезбираннями.
    // ЗАМІР СТЕЛІ РЯДКА В RPC. Шле рядки зростаючої довжини; клієнт друкує ті, що ДІЙШЛИ.
    // Потрібен тому, що межу ніде не задокументовано, а поводиться вона підступно: завелика
    // строка не «обрізається» — рушій кидає виняток просто в ctx.Read, і повідомлення зникає
    // цілком. Саме так мовчки гинули чотири з п'яти секцій адмін-знімка.
    // Найбільший розмір, який з'явиться в клієнтському script_*.log, і є межею.
    protected static void CmdRpcProbe(PlayerBase sender)
    {
        array<int> sizes = {64, 128, 256, 512, 768, 1024, 1536, 2048, 3072, 4096, 6144, 8192};
        foreach (int n : sizes)
        {
            string s = "";
            for (int i = 0; i < n; i++)
                s += "x";
            GetRPCManager().SendRPC(ZP_Const.MOD, ZP_Const.RPC_PROBE,
                new Param2<int, string>(n, s), true, sender.GetIdentity());
        }
        Reply(sender, "проба RPC відправлена (" + sizes.Count() + " розмірів) — дивіться клієнтський script_*.log");
    }

    protected static void CmdProbe(PlayerBase sender, TStringArray tokens)
    {
        string pFilter = "";
        if (tokens.Count() >= 3)
            pFilter = tokens[2];
        ZP_Device_Base dev = FindNearestStation(sender, pFilter);
        if (!dev)
        {
            Reply(sender, "поруч (3 м) немає приладу ZP");
            return;
        }
        string fc = ZP_Factions.GetFactionClass(sender);
        string st = "вільний";
        if (dev.ZP_GetState() == ZP_Device_Base.ZP_STATE_RUNNING)
            st = "ПРАЦЮЄ (підказка запуску не показується — це нормально)";
        else if (dev.ZP_GetState() == ZP_Device_Base.ZP_STATE_DONE)
            st = "ЗУПИНЕНО з незабраним виходом";
        Reply(sender, dev.GetType() + ": стан " + st + ", фракція " + fc);
        bool own = ZP_ConfigService.Get().IsDeviceFor(fc, dev.GetType());
        Reply(sender, "прилад належить фракції: " + own);
        if (!own)
            return;
        int seen = 0;
        foreach (ZP_Rule r : ZP_ConfigService.Get().GetRules().Rules)
        {
            if (!r.Enabled)
                continue;
            string m = r.Mode;
            m.ToLower();
            if (m != "background")
                continue;
            if (!ZP_ProcessingRules.MatchClass(dev.GetType(), r.Device))
                continue;
            if (r.RequiredFactions.Count() > 0 && r.RequiredFactions.Find(fc) < 0)
                continue;   // чуже правило гравцеві не показуємо взагалі
            seen++;
            string why = "ГОТОВЕ до запуску";
            string denyReason;
            string missingTool;
            string planErr;
            ref array<ItemBase> pi = new array<ItemBase>();
            ref array<int> pa = new array<int>();
            ref array<int> pin = new array<int>();
            if (!ZP_Factions.RuleAllowedFor(sender, r, denyReason))
                why = "гейт: " + denyReason;
            else if (!ZP_Gear.DeviceHasTools(dev, r.RequiredTools, missingTool))
                why = "немає інструмента: " + missingTool;
            else if (!ZP_Processing.BuildCargoPlan(dev, r, pi, pa, pin, planErr))
                why = "сировина: " + planErr;
            else
            {
                // план зібрався — покажемо ЧИСЛА, з якими піде цикл, а не лише «готове».
                // Саме вони визначають результат, і саме їх не видно ніде інде.
                float q = ZP_Processing.PlanQuality(pi, pin);
                float lo;
                float hi;
                ZP_Processing.PurityRange(r, dev, q, lo, hi);
                // конкатенація в Enforce вимагає РЯДКА ЗЛІВА: `lo + ".."` не компілюється
                string purityText = "" + lo;
                if (hi > lo)
                    purityText = "" + lo + ".." + hi;   // база правила задана діапазоном
                why = "ГОТОВЕ до запуску (якість входу " + q + ", чистота виходу " + purityText;
                if (ZP_Processing.PlanHasSample(pi, pin))
                    why += ", шанс x" + q;
                why += ")";
            }
            // вхід друкуємо З ВМІСТОМ: відколи зразки — один клас на всі види, рядок
            // «потрібен ZP_Sample» більше нічого не пояснює
            string inDesc = r.InputItem.Classname;
            if (r.InputItem.Content != "")
                inDesc += " [вміст: " + r.InputItem.Content + "]";
            Reply(sender, "  '" + r.Id + "' (вхід " + inDesc + " x" + r.InputItem.Quantity + ") -> " + why);
        }
        if (seen == 0)
            Reply(sender, "  для цього приладу немає жодного доступного вам background-правила");
    }

    // забір результату без прицілювання: !zp collect [клас приладу].
    // Штатний шлях — промпт F «Забрати результат» на приладі; це діагностичний дубль.
    protected static void CmdCollect(PlayerBase sender, TStringArray tokens)
    {
        string colFilter = "";
        if (tokens.Count() >= 3)
            colFilter = tokens[2];
        ZP_Device_Base dev = FindNearestStation(sender, colFilter);
        if (!dev)
        {
            Reply(sender, "поруч (3 м) немає придатного приладу ZP");
            return;
        }
        string msg;
        dev.ZP_CollectResult(sender, msg);
        Reply(sender, dev.GetType() + ": " + msg);
    }

    // спавн предмета просто в карго станції: !zp fillstation <клас> [к-сть] [клас приладу]
    protected static void CmdFillStation(PlayerBase sender, TStringArray tokens)
    {
        if (tokens.Count() < 3)
        {
            Reply(sender, "використання: !zp fillstation <classname> [к-сть до 10] [клас приладу]");
            return;
        }
        string cls = tokens[2];
        if (!ZP_ProcessingRules.ClassExists(cls))
        {
            Reply(sender, "невідомий клас: '" + cls + "'");
            return;
        }
        // '!zp fillstation Apple ZP_Microscope' (без кількості): нечисловий 4-й токен = фільтр
        string devFilter = "";
        if (tokens.Count() >= 5)
        {
            devFilter = tokens[4];
        }
        else if (tokens.Count() >= 4 && tokens[3].ToInt() == 0 && tokens[3] != "0")
        {
            devFilter = tokens[3];
        }
        ZP_Device_Base dev = FindNearestStation(sender, devFilter);
        if (!dev)
        {
            Reply(sender, "поруч (3 м) немає придатного приладу ZP");
            return;
        }
        int count = 1;
        if (tokens.Count() >= 4)
        {
            count = tokens[3].ToInt();
            if (count < 1)
                count = 1;
            if (count > 10)
                count = 10;
        }
        int spawned = 0;
        for (int i = 0; i < count; i++)
        {
            EntityAI created = dev.GetInventory().CreateInInventory(cls);
            if (created)
                spawned++;
        }
        Reply(sender, "OK: у карго " + dev.GetType() + " додано " + spawned + " x " + cls);
    }

    // швидкий CLI-редактор вузла (проста форма: миттєвий вузол, один Cost, один батьківський вузол;
    // повний редактор — M3.5). УВАГА: ПЕРЕЗАПИСУЄ вузол цілком
    protected static void CmdUpsertNode(PlayerBase sender, TStringArray tokens)
    {
        if (tokens.Count() < 4)
        {
            Reply(sender, "використання: !zp upsertnode <гілка> <id вузла> [типБалів] [к-сть] [батьківський вузол]");
            return;
        }
        ZP_Op_UpsertNode op = new ZP_Op_UpsertNode();
        op.BranchId = tokens[2];
        op.NodeData = new ZP_TreeNode();
        op.NodeData.Id = tokens[3];
        op.NodeData.Name = tokens[3];
        if (tokens.Count() >= 5)
        {
            ZP_TreeCost ncost = new ZP_TreeCost();
            ncost.Type = tokens[4];
            ncost.Amount = 1;
            if (tokens.Count() >= 6)
            {
                ncost.Amount = tokens[5].ToInt();
                if (ncost.Amount == 0 && tokens[5] != "0")
                {
                    Reply(sender, "не число: '" + tokens[5] + "'");
                    return;
                }
            }
            op.NodeData.Cost.Insert(ncost);
        }
        if (tokens.Count() >= 7)
            op.NodeData.Parents.Insert(tokens[6]);
        string payload;
        string err;
        if (!JsonFileLoader<ZP_Op_UpsertNode>.MakeData(op, payload, err, false))
        {
            Reply(sender, "помилка серіалізації: " + err);
            return;
        }
        string message;
        bool ok = ZP_ConfigService.Get().ApplyOp(ZP_Op.UPSERT_NODE, payload, message);
        Reply(sender, ReplyPrefix(ok) + message);
    }

    protected static void CmdDeleteNode(PlayerBase sender, TStringArray tokens)
    {
        if (tokens.Count() < 3)
        {
            Reply(sender, "використання: !zp deletenode <id вузла>");
            return;
        }
        ZP_Op_DeleteNode op = new ZP_Op_DeleteNode();
        op.NodeId = tokens[2];
        string payload;
        string err;
        if (!JsonFileLoader<ZP_Op_DeleteNode>.MakeData(op, payload, err, false))
        {
            Reply(sender, "помилка серіалізації: " + err);
            return;
        }
        string message;
        bool ok = ZP_ConfigService.Get().ApplyOp(ZP_Op.DELETE_NODE, payload, message);
        Reply(sender, ReplyPrefix(ok) + message);
    }

    protected static void CmdDeleteRule(PlayerBase sender, TStringArray tokens)
    {
        if (tokens.Count() < 3)
        {
            Reply(sender, "використання: !zp deleterule <id правила>");
            return;
        }
        ZP_Op_DeleteRule op = new ZP_Op_DeleteRule();
        op.RuleId = tokens[2];
        string payload;
        string err;
        if (!JsonFileLoader<ZP_Op_DeleteRule>.MakeData(op, payload, err, false))
        {
            Reply(sender, "помилка серіалізації: " + err);
            return;
        }
        string message;
        bool ok = ZP_ConfigService.Get().ApplyOp(ZP_Op.DELETE_RULE, payload, message);
        Reply(sender, ReplyPrefix(ok) + message);
    }

    // ---- утиліти ----

    protected static string ReplyPrefix(bool ok)
    {
        if (ok)
            return "OK: ";
        return "ПОМИЛКА: ";
    }

    protected static void Reply(PlayerBase player, string text)
    {
        player.MessageStatus("[ZP] " + text);
    }

    protected static PlayerBase FindUniquePlayerByName(string name, out int matches)
    {
        matches = 0;
        PlayerBase found = null;
        array<Man> players = new array<Man>();
        GetGame().GetPlayers(players);
        foreach (Man m : players)
        {
            PlayerBase pb = PlayerBase.Cast(m);
            if (pb && pb.GetIdentity() && pb.GetIdentity().GetName() == name)
            {
                matches++;
                found = pb;
            }
        }
        if (matches != 1)
            return null;
        return found;
    }

}
