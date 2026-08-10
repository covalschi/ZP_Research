// Реєстр фракцій: $profile:ZP_Research\Factions.json.
//
// Фракція гравця визначається НАШИВКОЮ у слоті Armband. Це першорівневе вкладення, тож
// дістається без рекурсії; воно фізично одне на персонажа, тож фракція не може вийти
// подвійною; і його видно іншим гравцям — сервер бачить рівно те, що бачать вони.
//
// Id фракції — це водночас ім'я файлу пулу (FactionData\<Id>.json), ключ гілки дерева і
// значення в RequiredFactions[]. Тому він мусить бути безпечним для імені файлу.
//
// Супертип групує споріднені фракції (наукові/бойові/сталкерські) і НЕ зобов'язаний бути
// парою: бойових три, решта по дві.

class ZP_FactionDef
{
    string Id;                                              // ecolog | clearsky | duty | freedom | sop | bandit | loner
    string DisplayName;
    // Групувальна мітка фракції (наукові / бойові / сталкерські). ЖОДНОГО гейта на ній не
    // висить: показується в `!zp faction`, щоб адмін бачив, як поділено фракції. Заготовки
    // супертипу НЕ мають — хто виробляє задає RequiredFactions правила.
    string Supertype;
    ref array<string> Armbands = new array<string>();       // класи нашивок (MatchClass, суфікс "|1" = точний клас)
    // Термінали ЦІЄЇ фракції. Порожньо = береться загальний Settings.TreeTerminalClasses
    // (сумісність із наявними налаштуваннями). Клієнту йдуть лише свої — інакше гравець
    // бачив би підказку F на чужому приладі й дізнавався, де стоять чужі термінали.
    ref array<string> TerminalClasses = new array<string>();
    // Прилади-станції ЦІЄЇ фракції. Те саме правило, що й для терміналів: порожньо =
    // береться загальний доступ, ПОКИ жодна фракція не оголосила своїх. Щойно поділ
    // почався, чужий прилад не дає гравцеві ЖОДНОЇ взаємодії — ні запуску, ні забору,
    // ні обробки з рук. Гейт правила (RequiredFactions) лишається, але він про ІНШЕ:
    // хто може виконати конкретну переробку, а не кому належить сам прилад.
    ref array<string> DeviceClasses = new array<string>();
}

class ZP_FactionsConfig
{
    int ConfigVersion = 1;
    ref array<ref ZP_FactionDef> Factions = new array<ref ZP_FactionDef>();

    // Класнейми звірені розпакуванням @protocol\Addons\Ex_Shevrons.pbo і
    // StalkerFactionFlagsArmbands.pbo — обидва кладуть свої предмети у слот Armband.
    // У СОП власної пов'язки немає, лише шеврони — тому перелік довший.
    void SetDefaults()
    {
        Add("ecolog",   "Вчені",       "science", {"Ex_Shevrons_Science1", "Ex_Shevrons_Science2", "Ex_Shevrons_Science3", "Ex_Shevrons_NII1", "armband_ecologist"});
        Add("clearsky", "Чисте небо",  "science", {"Ex_Shevrons_CS1", "Ex_Shevrons_CS2", "Ex_Shevrons_CS3", "armband_clearsky"});
        Add("duty",     "Долг",        "combat",  {"Ex_Shevrons_Dolg1", "Ex_Shevrons_Dolg2", "Ex_Shevrons_Dolg3", "armband_duty"});
        Add("freedom",  "Воля",        "combat",  {"Ex_Shevrons_Freedom1", "Ex_Shevrons_Freedom2", "Ex_Shevrons_Freedom3", "armband_freedom"});
        Add("sop",      "СОП",         "combat",  {"Ex_Shevrons_SOP1", "Ex_Shevrons_SOP2", "Ex_Shevrons_SOP3", "Ex_Shevrons_sop_ua"});
        Add("bandit",   "Бандити",     "stalker", {"Ex_Shevrons_bratva1", "Ex_Shevrons_bratva2", "Ex_Shevrons_bratva3", "armband_bandit"});
        Add("loner",    "Нейтрали",    "stalker", {"Ex_Shevrons_Neutral1", "Ex_Shevrons_Neutral2", "Ex_Shevrons_Neutral3", "armband_loner"});
    }

    protected void Add(string id, string name, string supertype, array<string> armbands)
    {
        ZP_FactionDef f = new ZP_FactionDef();
        f.Id = id;
        f.DisplayName = name;
        f.Supertype = supertype;
        foreach (string a : armbands)
        {
            f.Armbands.Insert(a);
        }
        Factions.Insert(f);
    }

    // Фракція за класом нашивки. null = нашивка нам невідома (або її немає).
    ZP_FactionDef FindByArmband(string classname)
    {
        if (classname == "")
            return null;
        foreach (ZP_FactionDef f : Factions)
        {
            if (!f)
                continue;
            foreach (string a : f.Armbands)
            {
                if (ZP_ProcessingRules.MatchClass(classname, a))
                    return f;
            }
        }
        return null;
    }

    ZP_FactionDef Find(string id)
    {
        foreach (ZP_FactionDef f : Factions)
        {
            if (f && f.Id == id)
                return f;
        }
        return null;
    }

    // Чи хоч одна фракція оголосила власні термінали. Якщо так, спільний перелік із
    // Settings більше не роздається «за замовчуванням» — інакше фракції без власного
    // налаштування ділили б один прилад, і ізоляція дерев ламалася б тихо.
    bool AnyFactionDeclaresDevices()
    {
        foreach (ZP_FactionDef fd : Factions)
        {
            if (fd && fd.DeviceClasses.Count() > 0)
                return true;
        }
        return false;
    }

    bool AnyFactionDeclaresTerminals()
    {
        foreach (ZP_FactionDef f : Factions)
        {
            if (f && f.TerminalClasses.Count() > 0)
                return true;
        }
        return false;
    }

    // Один клас терміналу — одна фракція. Спільний клас означає спільне дерево.
    void WarnSharedTerminals()
    {
        for (int i = 0; i < Factions.Count(); i++)
        {
            ZP_FactionDef a = Factions[i];
            if (!a)
                continue;
            for (int j = i + 1; j < Factions.Count(); j++)
            {
                ZP_FactionDef b = Factions[j];
                if (!b)
                    continue;
                foreach (string t : a.TerminalClasses)
                {
                    if (b.TerminalClasses.Find(t) > -1)
                        ZP_Log.Warn("Factions: термінал '" + t + "' оголошено і в '" + a.Id + "', і в '" + b.Id + "' — вони бачитимуть дерева одне одного");
                }
            }
        }
        foreach (ZP_FactionDef f2 : Factions)
        {
            if (f2 && f2.TerminalClasses.Count() == 0)
                ZP_Log.Warn("Factions: фракція '" + f2.Id + "' не має власних терміналів — її гравці не відкриють дерево жодним приладом");
        }
    }

    // Один клас приладу — одна фракція (дзеркало WarnSharedTerminals)
    void WarnSharedDevices()
    {
        for (int i = 0; i < Factions.Count(); i++)
        {
            ZP_FactionDef a = Factions[i];
            if (!a)
                continue;
            for (int j = i + 1; j < Factions.Count(); j++)
            {
                ZP_FactionDef b = Factions[j];
                if (!b)
                    continue;
                foreach (string dcls : a.DeviceClasses)
                {
                    if (b.DeviceClasses.Find(dcls) > -1)
                        ZP_Log.Warn("Factions: прилад '" + dcls + "' оголошено і в '" + a.Id + "', і в '" + b.Id + "' — вони користуватимуться ним спільно");
                }
            }
        }
        foreach (ZP_FactionDef f3 : Factions)
        {
            if (f3 && f3.DeviceClasses.Count() == 0)
                ZP_Log.Warn("Factions: фракція '" + f3.Id + "' не має власних приладів — її гравці не скористаються жодною станцією");
        }
    }

    string SupertypeOf(string factionId)
    {
        ZP_FactionDef f = Find(factionId);
        if (f)
            return f.Supertype;
        return "";
    }

    // Перевірка ОДНОГО запису для операцій редактора. Свідомо НЕ Validate(): той збирає
    // проблеми всього файлу, і на сервері без мода з нашивками (де класів нашивок просто
    // немає) будь-яка правка падала б через чужі записи. Відсутність класу нашивки тут —
    // м'яке попередження з тієї ж причини.
    string ValidateFaction(ZP_FactionDef f, out string softWarn)
    {
        softWarn = "";
        if (!f || f.Id == "")
            return "немає Id";
        if (!ZP_Uid.IsPathSafe(f.Id))
            return "Id '" + f.Id + "' небезпечний для імені файлу";
        if (f.DisplayName == "")
            return "немає DisplayName";
        if (f.Armbands.Count() == 0)
            return "жодної нашивки — фракцію не буде чим визначити";
        foreach (ZP_FactionDef other : Factions)
        {
            if (!other || other.Id == f.Id)
                continue;
            foreach (string mine : f.Armbands)
            {
                if (other.Armbands.Find(mine) > -1)
                    return "нашивка '" + mine + "' уже належить фракції '" + other.Id + "'";
            }
        }
        foreach (string a : f.Armbands)
        {
            if (a == "")
                return "порожній клас нашивки";
            if (!ZP_ProcessingRules.ClassExists(ZP_ProcessingRules.StripExact(a)))
                softWarn += "класу нашивки '" + a + "' немає в грі; ";
        }
        return "";
    }

    // Копія переліку для транзакційних операцій: мутуємо КОПІЮ, а живий конфіг комітимо
    // строго після успішного запису на диск.
    ZP_FactionsConfig CloneForEdit()
    {
        ZP_FactionsConfig c = new ZP_FactionsConfig();
        c.ConfigVersion = ConfigVersion;
        foreach (ZP_FactionDef f : Factions)
        {
            c.Factions.Insert(f);
        }
        return c;
    }

    bool Validate(out string problems)
    {
        problems = "";
        ref array<string> seenIds = new array<string>();
        ref array<string> seenArmbands = new array<string>();
        foreach (ZP_FactionDef f : Factions)
        {
            if (!f || f.Id == "")
            {
                problems += "фракція з порожнім Id; ";
                continue;
            }
            // Id стає іменем файлу пулу — небезпечний символ відкрив би path traversal
            if (!ZP_Uid.IsPathSafe(f.Id))
                problems += "Id '" + f.Id + "' небезпечний для імені файлу; ";
            if (seenIds.Find(f.Id) > -1)
                problems += "дублікат Id '" + f.Id + "'; ";
            seenIds.Insert(f.Id);
            if (f.DisplayName == "")
                problems += "фракція '" + f.Id + "' без DisplayName; ";
            if (f.Supertype == "")
                problems += "фракція '" + f.Id + "' без Supertype; ";
            if (f.Armbands.Count() == 0)
                problems += "фракція '" + f.Id + "' без нашивок — визначити її буде нічим; ";
            foreach (string a : f.Armbands)
            {
                if (a == "")
                {
                    problems += "фракція '" + f.Id + "': порожній клас нашивки; ";
                    continue;
                }
                // одна нашивка у двох фракціях = недетермінований резолв, ловимо тут
                if (seenArmbands.Find(a) > -1)
                    problems += "нашивка '" + a + "' належить більш ніж одній фракції; ";
                seenArmbands.Insert(a);
                // "|1" — суфікс точного збігу, у ConfigIsExisting його передавати не можна
                string probe = a;
                int sep = probe.IndexOf("|");
                if (sep > -1)
                    probe = probe.Substring(0, sep);
                if (!ZP_ProcessingRules.ClassExists(probe))
                    problems += "фракція '" + f.Id + "': класу нашивки '" + probe + "' немає в грі; ";
            }
        }
        if (Factions.Count() == 0)
            problems += "жодної фракції — усі гравці будуть у DefaultFaction; ";
        if (problems != "")
            ZP_Log.Warn("Factions: " + problems);
        // не помилка конфігу, а попередження про ізоляцію: перевіряємо ЗАВЖДИ, навіть коли
        // решта валідна — саме тихий спільний термінал і ламає роздільність дерев
        if (AnyFactionDeclaresTerminals())
            WarnSharedTerminals();
        if (AnyFactionDeclaresDevices())
            WarnSharedDevices();
        return problems == "";
    }
}
