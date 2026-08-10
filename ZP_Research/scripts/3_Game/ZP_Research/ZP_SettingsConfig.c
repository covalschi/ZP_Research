class ZP_SettingsConfig
{
    int ConfigVersion = 1;
    bool DebugMode = true;                                 // M0: докладні логи, вимикається !zp set debug false
                                                           // (ім'я не "Debug" — конфлікт із ванільним class Debug)
    ref array<string> AdminIds = new array<string>();      // fallback-список Steam64; працює й поруч із VPP (union)
                                                           // 'both': накопичує І гравцю, І в пул, платить ПУЛ; зміна режиму
                                                           // на живому сервері легалізує накопичені особисті баланси —
                                                           // змінювати свідомо або з вайпом балів
    string DefaultFaction = "default";                     // фракція без Expansion AI (стенд/чужі сервери)
    // прилади-термінали, на яких з'являється дія «Відкрити дерево досліджень» (IsKindOf,
    // суфікс "|1" = точний клас). Порожній список = дерево з UI недоступне взагалі
    ref array<string> TreeTerminalClasses = new array<string>();
    // скільки рівнів дерева видно ПІСЛЯ доступних вузлів (0 = лише доступні; 1 = типово:
    // бачиш, що можна дослідити, і куди це веде далі)
    int TreeVisibilityDepth = 1;
    // фон вікна дерева: шлях до .edds/.paa у PBO (напр. "ZP_Research/gui/textures/tree_bg.edds").
    // Порожньо = суцільний темний фон. Іконка кожного вузла — поле Icon самого вузла.
    string TreeBackgroundImage = "";

    void SetDefaults()
    {
        DebugMode = true;
        AdminIds.Insert("76561190000000000");              // зразок формату (невалідний steam64 — замінити)
        DefaultFaction = "default";
        TreeTerminalClasses.Insert("ZP_LabComputer");      // науковий комп'ютер — стаціонарний термінал дерева
        TreeVisibilityDepth = 1;
        TreeBackgroundImage = "";
    }

    // чи є цей клас терміналом дерева досліджень
    bool IsTreeTerminal(string classname)
    {
        foreach (string t : TreeTerminalClasses)
        {
            if (ZP_ProcessingRules.MatchClass(classname, t))
                return true;
        }
        return false;
    }

    bool Validate(out string problems)
    {
        problems = "";
        for (int i = 0; i < AdminIds.Count(); i++)
        {
            string id = AdminIds[i];
            if (!ZP_Uid.IsSteam64(id))
                problems += "AdminIds[" + i + "] не схожий на Steam64: '" + id + "'; ";
        }
        if (DefaultFaction == "" || !ZP_Uid.IsPathSafe(DefaultFaction))
            problems += "DefaultFaction небезпечний для імені файлу — у рантаймі буде замінений на 'default'; ";
        for (int t = 0; t < TreeTerminalClasses.Count(); t++)
        {
            string cls = TreeTerminalClasses[t];
            if (cls == "")
                problems += "TreeTerminalClasses[" + t + "] порожній; ";
        }
        if (TreeVisibilityDepth < 0 || TreeVisibilityDepth > 10)
            problems += "TreeVisibilityDepth поза межами [0..10]; ";
        if (TreeTerminalClasses.Count() == 0)
            problems += "TreeTerminalClasses порожній — дерево досліджень не відкриється жодним приладом; ";
        // зауваження щодо формату AdminIds не фатальні — конфіг застосовуємо
        if (problems != "")
            ZP_Log.Warn("Settings: " + problems);
        problems = "";
        return true;
    }
}
