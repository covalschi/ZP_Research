class ZP_ConfigService
{
    static ref ZP_ConfigService s_Instance;

    ref ZP_SettingsConfig m_Settings;
    ref ZP_PointTypesConfig m_PointTypes;
    ref ZP_FactionsConfig m_Factions;
    ref ZP_ProcessingRules m_Rules;
    ref ZP_TechTreeConfig m_TechTree;
    ref ZP_DataItemsConfig m_DataItems;
    ref ZP_ModulesConfig m_Modules;
    ref ZP_SampleTypesConfig m_SampleTypes;
    int m_Revision;

    static ZP_ConfigService Get()
    {
        if (!s_Instance)
            s_Instance = new ZP_ConfigService();
        return s_Instance;
    }

    static void Reset()
    {
        s_Instance = null;
    }

    void ZP_ConfigService()
    {
        m_Settings = new ZP_SettingsConfig();
        m_PointTypes = new ZP_PointTypesConfig();
        m_Factions = new ZP_FactionsConfig();
        m_Rules = new ZP_ProcessingRules();
        m_TechTree = new ZP_TechTreeConfig();
        m_DataItems = new ZP_DataItemsConfig();
        m_Modules = new ZP_ModulesConfig();
        m_SampleTypes = new ZP_SampleTypesConfig();
        m_Revision = 0;
    }

    ZP_ProcessingRules GetRules()
    {
        return m_Rules;
    }

    ZP_TechTreeConfig GetTechTree()
    {
        return m_TechTree;
    }

    ZP_SettingsConfig GetSettings()
    {
        return m_Settings;
    }

    ZP_PointTypesConfig GetPointTypes()
    {
        return m_PointTypes;
    }

    ZP_FactionsConfig GetFactions()
    {
        return m_Factions;
    }

    ZP_DataItemsConfig GetDataItems()
    {
        return m_DataItems;
    }

    ZP_ModulesConfig GetModules()
    {
        return m_Modules;
    }

    ZP_SampleTypesConfig GetSampleTypes()
    {
        return m_SampleTypes;
    }

    int GetRevision()
    {
        return m_Revision;
    }

    bool IsDebug()
    {
        return m_Settings && m_Settings.DebugMode;
    }

    // ---------- server load ----------

    void ServerLoad()
    {
        if (!FileExist(ZP_Const.PROFILE_DIR))
            MakeDirectory(ZP_Const.PROFILE_DIR);
        if (!FileExist(ZP_Const.BACKUP_DIR))
            MakeDirectory(ZP_Const.BACKUP_DIR);
        string err;
        if (!LoadSettings(err))
            ZP_Log.Err(err);
        if (!LoadPointTypes(err))
            ZP_Log.Err(err);
        if (!LoadFactions(err))
            ZP_Log.Err(err);
        if (!LoadTechTree(err))
            ZP_Log.Err(err);
        if (!LoadRules(err))
            ZP_Log.Err(err);
        if (!LoadDataItems(err))
            ZP_Log.Err(err);
        if (!LoadModules(err))
            ZP_Log.Err(err);
        if (!LoadSampleTypes(err))
            ZP_Log.Err(err);
        WarnRulesVsTree();

        m_Revision = 1;
        InvalidateClientCache();
        string dbgState = "off";
        if (m_Settings.DebugMode)
            dbgState = "on";
        // ДВА рядки, а не один довгий ланцюжок +: компілятор Enforce впав на «Formula too
        // complex», щойно додався восьмий доданок (sampleTypes) — ланцюжок конкатенацій
        // має межу складності, знайдену емпірично саме тут.
        string summary = "configs loaded: factions=" + m_Factions.Factions.Count() + " pointTypes=" + m_PointTypes.PointTypes.Count() + " rules=" + m_Rules.Rules.Count() + " treeNodes=" + m_TechTree.Nodes.Count() + " dataItems=" + m_DataItems.Items.Count() + " modules=" + m_Modules.Modules.Count();
        summary += " sampleTypes=" + m_SampleTypes.Items.Count() + " adminIds=" + m_Settings.AdminIds.Count() + " debug=" + dbgState;
        ZP_Log.Info(summary);
    }

    // Двофазне завантаження: Try* завантажує та валідує БЕЗ застосування (члени й файли не чіпаються),
    // Load* комітить. Це дає атомарний OpReloadAll: невдалий reload не змінює НІЧОГО —
    // ні пам'ять, ні файли адміна.

    protected bool TryLoadSettings(out ZP_SettingsConfig fresh, out bool created, out string err)
    {
        err = "";
        created = false;
        fresh = new ZP_SettingsConfig();
        if (!FileExist(ZP_Const.SETTINGS_PATH))
        {
            fresh.SetDefaults();
            created = true;
            return true;
        }
        string loadErr;
        if (!JsonFileLoader<ZP_SettingsConfig>.LoadFile(ZP_Const.SETTINGS_PATH, fresh, loadErr))
        {
            err = "Settings.json пошкоджений, працюємо на попередніх значеннях: " + loadErr;
            return false;
        }
        string problems;
        if (!fresh.Validate(problems))
        {
            err = "Settings.json не пройшов валідацію: " + problems;
            return false;
        }
        return true;
    }

    protected bool TryLoadPointTypes(out ZP_PointTypesConfig fresh, out bool created, out string err)
    {
        err = "";
        created = false;
        fresh = new ZP_PointTypesConfig();
        if (!FileExist(ZP_Const.POINTTYPES_PATH))
        {
            fresh.SetDefaults();
            created = true;
            return true;
        }
        string loadErr;
        if (!JsonFileLoader<ZP_PointTypesConfig>.LoadFile(ZP_Const.POINTTYPES_PATH, fresh, loadErr))
        {
            err = "PointTypes.json пошкоджений, працюємо на попередніх значеннях: " + loadErr;
            return false;
        }
        string problems;
        if (!fresh.Validate(problems))
        {
            err = "PointTypes.json не пройшов валідацію: " + problems;
            return false;
        }
        return true;
    }

    bool LoadSettings(out string err)
    {
        ZP_SettingsConfig fresh;
        bool created;
        if (!TryLoadSettings(fresh, created, err))
            return false;
        m_Settings = fresh;
        SaveSettings();          // load-then-save: дописує нові поля після оновлень мода
        if (created)
            ZP_Log.Info("Settings.json створено з типовими значеннями — пропишіть AdminIds");
        return true;
    }

    protected bool TryLoadFactions(out ZP_FactionsConfig fresh, out bool created, out string err)
    {
        err = "";
        created = false;
        fresh = new ZP_FactionsConfig();
        if (!FileExist(ZP_Const.FACTIONS_PATH))
        {
            fresh.SetDefaults();
            created = true;
        }
        else
        {
            string loadErr;
            if (!JsonFileLoader<ZP_FactionsConfig>.LoadFile(ZP_Const.FACTIONS_PATH, fresh, loadErr))
            {
                err = "Factions.json пошкоджений, працюємо на попередніх значеннях: " + loadErr;
                return false;
            }
        }
        string problems;
        // Валідуємо ЗАВЖДИ, у тому числі щойно створені дефолти: перевірка існування класів
        // залежить від оточення, і на сервері без мода з нашивками адмін мусить це побачити
        // одразу, а не гадати, чому фракція не визначається. Невдала валідація НЕ фатальна:
        // краще працювати з рештою фракцій, ніж не працювати зовсім.
        fresh.Validate(problems);
        return true;
    }

    bool LoadFactions(out string err)
    {
        ZP_FactionsConfig fresh;
        bool created;
        if (!TryLoadFactions(fresh, created, err))
            return false;
        m_Factions = fresh;
        SaveFactions();
        if (created)
            ZP_Log.Info("Factions.json створено з типовими значеннями (7 фракцій)");
        return true;
    }

    void SaveFactions()
    {
        string err;
        if (!JsonFileLoader<ZP_FactionsConfig>.SaveFile(ZP_Const.FACTIONS_PATH, m_Factions, err))
            ZP_Log.Err("не вдалося зберегти Factions.json: " + err);
    }

    bool LoadPointTypes(out string err)
    {
        ZP_PointTypesConfig fresh;
        bool created;
        if (!TryLoadPointTypes(fresh, created, err))
            return false;
        m_PointTypes = fresh;
        SavePointTypes();
        if (created)
            ZP_Log.Info("PointTypes.json створено з типовими значеннями (field/lab/break)");
        return true;
    }

    // Заготовки результату. Валідується проти ПЕРЕДАНИХ типів балів і фракцій — під час
    // атомарного reload проти щойно завантажених, інакше нові типи балів вважалися б
    // невідомими лише тому, що їх ще не закомічено в пам'ять.
    // Невалідні записи просто випадають з набору (Validate їх вирізає), тож пошкодженим
    // вважається лише нечитабельний JSON.
    protected bool TryLoadDataItems(ZP_PointTypesConfig pointTypes, out ZP_DataItemsConfig fresh, out bool created, out string err)
    {
        err = "";
        created = false;
        fresh = new ZP_DataItemsConfig();
        if (!FileExist(ZP_Const.DATAITEMS_PATH))
        {
            fresh.SetDefaults();
            created = true;
            return true;
        }
        string loadErr;
        if (!JsonFileLoader<ZP_DataItemsConfig>.LoadFile(ZP_Const.DATAITEMS_PATH, fresh, loadErr))
        {
            err = "DataItems.json пошкоджений, працюємо на попередніх значеннях: " + loadErr;
            return false;
        }
        string problems;
        fresh.Validate(pointTypes, problems);
        return true;
    }

    bool LoadDataItems(out string err)
    {
        ZP_DataItemsConfig fresh;
        bool created;
        if (!TryLoadDataItems(m_PointTypes, fresh, created, err))
            return false;
        m_DataItems = fresh;
        SaveDataItems();
        if (created)
            ZP_Log.Info("DataItems.json створено порожнім — опишіть заготовки самі (ZP_Data_01 .. ZP_Data_90)");
        return true;
    }

    void SaveDataItems()
    {
        string err;
        if (!JsonFileLoader<ZP_DataItemsConfig>.SaveFile(ZP_Const.DATAITEMS_PATH, m_DataItems, err))
            ZP_Log.Err("не вдалося зберегти DataItems.json: " + err);
    }

    // Модулі чистоти. Реєстр невеликий і не залежить від інших конфігів, тож завантаження
    // просте: биті записи Validate вирізає, нечитабельний JSON = відмова.
    protected bool TryLoadModules(out ZP_ModulesConfig fresh, out bool created, out string err)
    {
        err = "";
        created = false;
        fresh = new ZP_ModulesConfig();
        if (!FileExist(ZP_Const.MODULES_PATH))
        {
            fresh.SetDefaults();
            created = true;
            return true;
        }
        string loadErr;
        if (!JsonFileLoader<ZP_ModulesConfig>.LoadFile(ZP_Const.MODULES_PATH, fresh, loadErr))
        {
            err = "Modules.json пошкоджений, працюємо на попередніх значеннях: " + loadErr;
            return false;
        }
        string problems;
        fresh.Validate(problems);
        return true;
    }

    bool LoadModules(out string err)
    {
        ZP_ModulesConfig fresh;
        bool created;
        if (!TryLoadModules(fresh, created, err))
            return false;
        m_Modules = fresh;
        SaveModules();
        if (created)
            ZP_Log.Info("Modules.json створено з типовими бонусами трьох інструментів");
        return true;
    }

    void SaveModules()
    {
        string err;
        if (!JsonFileLoader<ZP_ModulesConfig>.SaveFile(ZP_Const.MODULES_PATH, m_Modules, err))
            ZP_Log.Err("не вдалося зберегти Modules.json: " + err);
    }

    // Імена/описи типів зразків. Реєстр не залежить від інших конфігів (Points у зразка
    // немає), тож завантаження просте, як у модулів: биті записи Validate вирізає,
    // нечитабельний JSON = відмова.
    protected bool TryLoadSampleTypes(out ZP_SampleTypesConfig fresh, out bool created, out string err)
    {
        err = "";
        created = false;
        fresh = new ZP_SampleTypesConfig();
        if (!FileExist(ZP_Const.SAMPLETYPES_PATH))
        {
            fresh.SetDefaults();
            created = true;
            return true;
        }
        string loadErr;
        if (!JsonFileLoader<ZP_SampleTypesConfig>.LoadFile(ZP_Const.SAMPLETYPES_PATH, fresh, loadErr))
        {
            err = "SampleTypes.json пошкоджений, працюємо на попередніх значеннях: " + loadErr;
            return false;
        }
        string problems;
        fresh.Validate(problems);
        return true;
    }

    bool LoadSampleTypes(out string err)
    {
        ZP_SampleTypesConfig fresh;
        bool created;
        if (!TryLoadSampleTypes(fresh, created, err))
            return false;
        m_SampleTypes = fresh;
        SaveSampleTypes();
        if (created)
            ZP_Log.Info("SampleTypes.json створено порожнім — опишіть типи зразків самі (ZP_Sample_01 .. ZP_Sample_30)");
        return true;
    }

    void SaveSampleTypes()
    {
        string err;
        if (!JsonFileLoader<ZP_SampleTypesConfig>.SaveFile(ZP_Const.SAMPLETYPES_PATH, m_SampleTypes, err))
            ZP_Log.Err("не вдалося зберегти SampleTypes.json: " + err);
    }

    // Правила: тека per-file. Завантаження та валідація БЕЗ застосування; ПЕРЕВІРКА йде проти
    // переданого pointTypes (під час атомарного reload — проти щойно завантажених типів!).
    // Пошкоджений JSON будь-якого файлу або дубль Id = усе завантаження правил відхилено.
    // validate-only фаза НІЧОГО не пише на диск (атомарність reload).
    // created = теки правил не існувало (справжній перший запуск);
    // порожня тека = валідний ПОРОЖНІЙ набір правил (адмін навмисно все вимкнув).
    protected bool TryLoadRules(ZP_PointTypesConfig pointTypes, out ZP_ProcessingRules fresh, out bool created, out string err)
    {
        err = "";
        created = false;
        fresh = new ZP_ProcessingRules();
        if (!FileExist(ZP_Const.RULES_DIR))
        {
            MakeDirectory(ZP_Const.RULES_DIR);
            created = true;   // demo.json створить LoadRules у фазі коміту
        }

        ref array<string> files = new array<string>();
        string fileName;
        FileAttr attr;
        FindFileHandle h = FindFile(ZP_Const.RULES_DIR + "\\*.json", fileName, attr, FindFileFlags.ALL);
        if (h)
        {
            // NB: FileAttr.DIRECTORY == 0, бітовий тест марний (та сама прихована вада в CF) —
            // каталог з іменем *.json відсіється помилкою парсингу JSON
            if (fileName != "")
                files.Insert(fileName);
            while (FindNextFile(h, fileName, attr))
            {
                if (fileName != "")
                    files.Insert(fileName);
            }
            CloseFindFile(h);
        }
        // ПОРЯДОК ФАЙЛІВ МУСИТЬ БУТИ СТАЛИЙ. Порядок правил у нас — це їхній ПРІОРИТЕТ
        // (FindStartableBackgroundRule бере перше придатне), а FindFile віддає імена в
        // порядку каталогу, який змінюється після перезапису будь-якого файлу. Спіймано
        // живим тестом: після збереження одного правила перелік у редакторі перемішався,
        // тобто разом із ним мовчки перемішався і пріоритет.
        SortFileNames(files);

        foreach (string f : files)
        {
            string path = ZP_Const.RULES_DIR + "\\" + f;
            ZP_RulesFile rf = new ZP_RulesFile();
            string loadErr;
            if (!JsonFileLoader<ZP_RulesFile>.LoadFile(path, rf, loadErr))
            {
                err = "ProcessingRules\\" + f + " пошкоджений, правила не перезавантажено: " + loadErr;
                return false;
            }
            string hardErr;
            if (!fresh.AddFileRules(rf, "ProcessingRules\\" + f, f, pointTypes, hardErr))
            {
                err = hardErr;
                return false;
            }
        }
        return true;
    }

    // ---- дерево технологій: TechTree\*.json (файл = гілка); та сама двофазність ----

    protected bool TryLoadTechTree(ZP_PointTypesConfig pointTypes, out ZP_TechTreeConfig fresh, out bool created, out string err)
    {
        err = "";
        created = false;
        fresh = new ZP_TechTreeConfig();
        if (!FileExist(ZP_Const.TECHTREE_DIR))
        {
            MakeDirectory(ZP_Const.TECHTREE_DIR);
            created = true;
        }

        ref array<string> files = new array<string>();
        string fileName;
        FileAttr attr;
        FindFileHandle h = FindFile(ZP_Const.TECHTREE_DIR + "\\*.json", fileName, attr, FindFileFlags.ALL);
        if (h)
        {
            if (fileName != "")
                files.Insert(fileName);
            while (FindNextFile(h, fileName, attr))
            {
                if (fileName != "")
                    files.Insert(fileName);
            }
            CloseFindFile(h);
        }
        SortFileNames(files);   // гілки дерева — та сама вимога сталого порядку, що й у правил

        foreach (string f : files)
        {
            string path = ZP_Const.TECHTREE_DIR + "\\" + f;
            ZP_TechTreeFile tf = new ZP_TechTreeFile();
            string loadErr;
            if (!JsonFileLoader<ZP_TechTreeFile>.LoadFile(path, tf, loadErr))
            {
                err = "TechTree\\" + f + " пошкоджений, дерево не перезавантажено: " + loadErr;
                return false;
            }
            string hardErr;
            if (!fresh.AddFileNodes(tf, "TechTree\\" + f, f, pointTypes, hardErr))
            {
                err = hardErr;
                return false;
            }
        }
        fresh.ValidateGraph();
        return true;
    }

    bool LoadTechTree(out string err)
    {
        ZP_TechTreeConfig fresh;
        bool created;
        if (!TryLoadTechTree(m_PointTypes, fresh, created, err))
            return false;
        if (created)
        {
            // ВБУДОВАНОГО ДЕРЕВА НЕМАЄ (рішення власника). Раніше тут створювалася демо-гілка
            // bio.json із двома вузлами. Прибрано: мод — фреймворк, а не набір контенту, і
            // демо-вузли лише плутали — їхні вимоги не збігалися з реальним конфігом стенда.
            ZP_Log.Info("TechTree порожня — опишіть гілки самі (файл = гілка)");
        }
        m_TechTree = fresh;
        return true;
    }

    // правила, що посилаються на неіснуючі вузли — попередження (правило лишається,
    // але фактично замкнене назавжди — адмін має це побачити)
    protected void WarnRulesVsTree()
    {
        foreach (ZP_Rule r : m_Rules.Rules)
        {
            if (r.RequiredNode != "" && !m_TechTree.FindNode(r.RequiredNode))
                ZP_Log.Warn("правило '" + r.Id + "': RequiredNode '" + r.RequiredNode + "' не існує в дереві — правило недосяжне");
        }
    }

    // збереження однієї гілки з ПЕРЕДАНОГО дерева: ops зберігають із candidate-агрегату
    // ДО коміту в m_TechTree — відмова запису не чіпає живий стан (рев'ю M3)
    protected bool SaveBranch(ZP_TechTreeConfig tree, string branchId, out string err)
    {
        err = "";
        ZP_TechTreeFile tf = tree.Branches.Get(branchId);
        string fileName;
        if (!tf || !tree.BranchFiles.Find(branchId, fileName))
        {
            err = "гілку '" + branchId + "' не знайдено";
            return false;
        }
        string path = ZP_Const.TECHTREE_DIR + "\\" + fileName;
        if (FileExist(path))
            CopyFile(path, ZP_Const.BACKUP_DIR + "\\" + fileName + ".bak");
        if (!JsonFileLoader<ZP_TechTreeFile>.SaveFile(path, tf, err))
            return false;
        return true;
    }

    // shallow-копія файлу гілки: новий масив Nodes, самі вузли та Branch-інфо спільні
    // (ops змінюють лише склад масиву). Живий файл не мутується до коміту.
    protected ZP_TechTreeFile CloneBranchFile(ZP_TechTreeFile src)
    {
        ZP_TechTreeFile copy = new ZP_TechTreeFile();
        copy.ConfigVersion = src.ConfigVersion;
        copy.Branch = src.Branch;
        foreach (ZP_TreeNode n : src.Nodes)
        {
            copy.Nodes.Insert(n);
        }
        return copy;
    }

    // агрегат із живих гілок із підстановкою candidate замість branchId; живий стан не зачеплено
    protected bool BuildTreeWithCandidate(string branchId, ZP_TechTreeFile candidate, out ZP_TechTreeConfig fresh, out string err)
    {
        err = "";
        fresh = new ZP_TechTreeConfig();
        // Та сама причина, що й у правил: обхід карти не має визначеного порядку, і кожне
        // збереження вузла перетасовувало гілки — у переліку редактора й у порядку колонок.
        ref array<string> branchIds = new array<string>();
        foreach (string bId, ZP_TechTreeFile tf : m_TechTree.Branches)
            branchIds.Insert(bId);
        SortFileNames(branchIds);

        foreach (string id : branchIds)
        {
            ZP_TechTreeFile use = m_TechTree.Branches.Get(id);
            if (id == branchId)
                use = candidate;
            string fileName;
            m_TechTree.BranchFiles.Find(id, fileName);
            string hardErr;
            if (!fresh.AddFileNodes(use, "TechTree\\" + fileName, fileName, m_PointTypes, hardErr))
            {
                err = hardErr;
                return false;
            }
        }
        fresh.ValidateGraph();
        return true;
    }

    bool LoadRules(out string err)
    {
        ZP_ProcessingRules fresh;
        bool created;
        if (!TryLoadRules(m_PointTypes, fresh, created, err))
            return false;
        if (created)
        {
            // перший запуск: сіємо демо-правило у фазі КОМІТУ (не у validate-фазі)
            ZP_RulesFile demo = new ZP_RulesFile();
            demo.SetDefaults();
            string saveErr;
            if (!JsonFileLoader<ZP_RulesFile>.SaveFile(ZP_Const.RULES_DIR + "\\demo.json", demo, saveErr))
            {
                ZP_Log.Err("не вдалося створити demo.json: " + saveErr);
            }
            else
            {
                string hardErr;
                if (!fresh.AddFileRules(demo, "ProcessingRules\\demo.json", "demo.json", m_PointTypes, hardErr))
                    ZP_Log.Warn(hardErr);
                ZP_Log.Info("ProcessingRules\\demo.json створено з демо-правилом (яблуко -> папір + бали)");
            }
        }
        m_Rules = fresh;
        return true;
    }

    void SaveSettings()
    {
        if (FileExist(ZP_Const.SETTINGS_PATH))
            CopyFile(ZP_Const.SETTINGS_PATH, ZP_Const.BACKUP_DIR + "\\Settings.json.bak");
        string err;
        if (!JsonFileLoader<ZP_SettingsConfig>.SaveFile(ZP_Const.SETTINGS_PATH, m_Settings, err))
            ZP_Log.Err("не вдалося зберегти Settings.json: " + err);
    }

    void SavePointTypes()
    {
        if (FileExist(ZP_Const.POINTTYPES_PATH))
            CopyFile(ZP_Const.POINTTYPES_PATH, ZP_Const.BACKUP_DIR + "\\PointTypes.json.bak");
        string err;
        if (!JsonFileLoader<ZP_PointTypesConfig>.SaveFile(ZP_Const.POINTTYPES_PATH, m_PointTypes, err))
            ZP_Log.Err("не вдалося зберегти PointTypes.json: " + err);
    }

    // ---------- ZP_ConfigOp: єдиний шлях мутацій (чат зараз, UI-редактор у M3.5) ----------

    bool ApplyOp(int opType, string payloadJson, out string message)
    {
        message = "";
        bool ok = false;

        if (opType == ZP_Op.SET_SETTING)
        {
            ok = OpSetSetting(payloadJson, message);
        }
        else if (opType == ZP_Op.UPSERT_POINTTYPE)
        {
            ok = OpUpsertPointType(payloadJson, message);
        }
        else if (opType == ZP_Op.RELOAD_ALL)
        {
            ok = OpReloadAll(message);
        }
        else if (opType == ZP_Op.UPSERT_NODE)
        {
            ok = OpUpsertNode(payloadJson, message);
        }
        else if (opType == ZP_Op.DELETE_NODE)
        {
            ok = OpDeleteNode(payloadJson, message);
        }
        else if (opType == ZP_Op.UPSERT_RULE)
        {
            ok = OpUpsertRule(payloadJson, message);
        }
        else if (opType == ZP_Op.DELETE_RULE)
        {
            ok = OpDeleteRule(payloadJson, message);
        }
        else if (opType == ZP_Op.RESET_FACTION)
        {
            ok = OpResetFaction(payloadJson, message);
        }
        else if (opType == ZP_Op.UPSERT_FACTION)
        {
            ok = OpUpsertFaction(payloadJson, message);
        }
        else if (opType == ZP_Op.DELETE_FACTION)
        {
            ok = OpDeleteFaction(payloadJson, message);
        }
        else if (opType == ZP_Op.UPSERT_DATAITEM)
        {
            ok = OpUpsertDataItem(payloadJson, message);
        }
        else if (opType == ZP_Op.UPSERT_MODULE)
        {
            ok = OpUpsertModule(payloadJson, message);
        }
        else if (opType == ZP_Op.DELETE_MODULE)
        {
            ok = OpDeleteModule(payloadJson, message);
        }
        else
        {
            message = "невідома операція: " + opType;
        }

        if (ok)
        {
            m_Revision++;
            // кеш скидається РАЗОМ із ревізією і строго ДО розсилки — інакше клієнти
            // отримали б нову ревізію зі старим вмістом
            InvalidateClientCache();
            BroadcastConfig();
            ZP_Log.Info("op " + opType + " applied, revision=" + m_Revision + ": " + message);
        }
        else
        {
            ZP_Log.Warn("op " + opType + " rejected: " + message);
        }
        return ok;
    }

    // Сортування імен файлів. Свій прохід, а не рушійний Sort: масив рядків у Enforce його
    // не має, а список тут — одиниці елементів, тож найпростіший вибір цілком доречний.
    // Порівнюємо в нижньому регістрі, щоб порядок не залежав від того, як адмін назвав файл.
    protected void SortFileNames(array<string> files)
    {
        for (int i = 1; i < files.Count(); i++)
        {
            string cur = files[i];
            string curLow = cur;
            curLow.ToLower();
            int j = i - 1;
            while (j >= 0)
            {
                string prevLow = files[j];
                prevLow.ToLower();
                if (prevLow <= curLow)
                    break;
                files.Set(j + 1, files[j]);
                j--;
            }
            files.Set(j + 1, cur);
        }
    }

    protected bool OpSetSetting(string payloadJson, out string message)
    {
        ZP_Op_SetSetting op = new ZP_Op_SetSetting();
        string err;
        if (!JsonFileLoader<ZP_Op_SetSetting>.LoadData(payloadJson, op, err))
        {
            message = "пошкоджений payload: " + err;
            return false;
        }
        string key = op.Key;
        key.ToLower();
        string val = op.Value;
        val.ToLower();
        if (key == "debug")
        {
            m_Settings.DebugMode = (val == "true" || val == "1");
            SaveSettings();
            if (m_Settings.DebugMode)
                message = "DebugMode = on";
            else
                message = "DebugMode = off";
            return true;
        }
        if (key == "treedepth")
        {
            int td = op.Value.ToInt();
            if (td < 0 || td > 10 || (td == 0 && op.Value != "0"))
            {
                message = "TreeVisibilityDepth: ціле [0..10]";
                return false;
            }
            m_Settings.TreeVisibilityDepth = td;
            SaveSettings();
            message = "TreeVisibilityDepth = " + td;
            return true;
        }
        if (key == "treeterminal")
        {
            // Перелік класів через кому замінює список цілком. Сенс: терміналом можна
            // призначити БУДЬ-ЯКИЙ об'єкт світу, а не лише наш ZP_LabComputer — на
            // сталкерському сервері це лабораторні пульти Land_Furniture_radiostation1..16
            // (@Area Of Decay Building / @GSC Gameworld Assets). Залежності в PBO не треба:
            // ZP_ActionOpenTree цілиться по CCTObject і звіряє клас із цим списком.
            array<string> parts = new array<string>();
            op.Value.Split(",", parts);
            array<string> cleaned = new array<string>();
            string bad = "";
            foreach (string raw : parts)
            {
                string one = raw;
                one.Trim();
                if (one == "")
                    continue;
                // "|1" — суфікс точного збігу класу, у ConfigIsExisting його передавати не можна
                string probe = one;
                int sep = probe.IndexOf("|");
                if (sep > -1)
                    probe = probe.Substring(0, sep);
                if (!ZP_ProcessingRules.ClassExists(probe))
                {
                    bad += one + " ";
                    continue;
                }
                cleaned.Insert(one);
            }
            if (bad != "")
            {
                message = "невідомі класи: " + bad;
                return false;
            }
            if (cleaned.Count() == 0)
            {
                message = "порожній список — дерево не відкрилось би жодним приладом";
                return false;
            }
            m_Settings.TreeTerminalClasses = cleaned;
            SaveSettings();
            message = "TreeTerminalClasses = " + cleaned.Count() + " кл.";
            return true;
        }
        message = "налаштування '" + op.Key + "' не редагується у грі (debug | treedepth | treeterminal)";
        return false;
    }

    // Скидання прогресу фракції. Тонка обгортка: увесь стан належить ZP_FactionDB,
    // а ConfigService дає спільний контракт — аудит-лог, ревізію і доступ з RPC-моста.
    // Правити FactionData\*.json руками на живому сервері НЕ можна: кеш у пам'яті
    // виграє при читанні й затирає файл найближчим Save — саме тому потрібна операція.
    // Створення/зміна фракції. Транзакція та сама, що й у вузлів та правил: мутуємо КОПІЮ,
    // пишемо на диск, і лише після успішного запису комітимо в пам'ять. Інакше відмова
    // запису лишила б живий конфіг і файл розшарованими.
    protected bool OpUpsertFaction(string payloadJson, out string message)
    {
        ZP_FactionDef incoming = new ZP_FactionDef();
        string err;
        if (!JsonFileLoader<ZP_FactionDef>.LoadData(payloadJson, incoming, err))
        {
            message = "пошкоджений payload: " + err;
            return false;
        }
        string softWarn;
        string hard = m_Factions.ValidateFaction(incoming, softWarn);
        if (hard != "")
        {
            message = "фракція '" + incoming.Id + "': " + hard;
            return false;
        }
        ZP_FactionsConfig work = m_Factions.CloneForEdit();
        bool replaced = false;
        for (int i = 0; i < work.Factions.Count(); i++)
        {
            if (work.Factions[i] && work.Factions[i].Id == incoming.Id)
            {
                work.Factions[i] = incoming;
                replaced = true;
                break;
            }
        }
        if (!replaced)
            work.Factions.Insert(incoming);
        if (!JsonFileLoader<ZP_FactionsConfig>.SaveFile(ZP_Const.FACTIONS_PATH, work, err))
        {
            message = "не вдалося зберегти Factions.json: " + err;
            return false;
        }
        m_Factions = work;
        if (replaced)
            message = "фракцію '" + incoming.Id + "' оновлено";
        else
            message = "фракцію '" + incoming.Id + "' створено";
        if (softWarn != "")
            message += " (увага: " + softWarn + ")";
        return true;
    }

    protected bool OpDeleteFaction(string payloadJson, out string message)
    {
        ZP_Op_DeleteFaction op = new ZP_Op_DeleteFaction();
        string err;
        if (!JsonFileLoader<ZP_Op_DeleteFaction>.LoadData(payloadJson, op, err))
        {
            message = "пошкоджений payload: " + err;
            return false;
        }
        ZP_FactionsConfig work = m_Factions.CloneForEdit();
        int idx = -1;
        for (int i = 0; i < work.Factions.Count(); i++)
        {
            if (work.Factions[i] && work.Factions[i].Id == op.FactionId)
            {
                idx = i;
                break;
            }
        }
        if (idx < 0)
        {
            message = "фракцію '" + op.FactionId + "' не знайдено";
            return false;
        }
        work.Factions.RemoveOrdered(idx);
        if (!JsonFileLoader<ZP_FactionsConfig>.SaveFile(ZP_Const.FACTIONS_PATH, work, err))
        {
            message = "не вдалося зберегти Factions.json: " + err;
            return false;
        }
        m_Factions = work;
        // Пул і прогрес видаленої фракції на диску ЛИШАЮТЬСЯ. Це навмисно: видалення
        // фракції з реєстру — часто помилка або тимчасова правка, і мовчки знищити
        // напрацьоване було б непоправно. Файл підхопиться, щойно фракцію повернуть.
        message = "фракцію '" + op.FactionId + "' видалено; FactionData\\" + op.FactionId + ".json лишився на диску, гравці з її нашивкою тепер потраплять у '" + m_Settings.DefaultFaction + "'";
        return true;
    }

    protected bool OpResetFaction(string payloadJson, out string message)
    {
        ZP_Op_ResetFaction op = new ZP_Op_ResetFaction();
        string err;
        if (!JsonFileLoader<ZP_Op_ResetFaction>.LoadData(payloadJson, op, err))
        {
            message = "пошкоджений payload: " + err;
            return false;
        }
        string fc = op.FactionClass;
        if (fc == "")
            fc = m_Settings.DefaultFaction;
        return ZP_FactionDB.Get().ResetFaction(fc, message);
    }

    protected bool OpUpsertNode(string payloadJson, out string message)
    {
        ZP_Op_UpsertNode op = new ZP_Op_UpsertNode();
        string err;
        if (!JsonFileLoader<ZP_Op_UpsertNode>.LoadData(payloadJson, op, err))
        {
            message = "пошкоджений payload: " + err;
            return false;
        }
        if (!op.NodeData || op.NodeData.Id == "")
        {
            message = "немає NodeData.Id";
            return false;
        }
        // валідація вузла ДО мутації: інакше невалідний вузол мовчки skip'ається перезбіркою,
        // але пишеться на диск із відповіддю «вузол створено» (рев'ю M3)
        string nodeErr = m_TechTree.ValidateNode(op.NodeData, m_PointTypes);
        if (nodeErr != "")
        {
            message = "вузол '" + op.NodeData.Id + "': " + nodeErr;
            return false;
        }
        ZP_TechTreeFile branch = m_TechTree.Branches.Get(op.BranchId);
        if (!branch)
        {
            message = "гілку '" + op.BranchId + "' не знайдено";
            return false;
        }
        // вузол із цим Id може жити лише в цій самій гілці (інакше дубль між файлами)
        string existingBranch;
        if (m_TechTree.NodeBranch.Find(op.NodeData.Id, existingBranch) && existingBranch != op.BranchId)
        {
            message = "вузол '" + op.NodeData.Id + "' уже є в гілці '" + existingBranch + "'";
            return false;
        }
        // транзакція: мутуємо КОПІЮ гілки, m_TechTree комітиться строго після успішного
        // запису на диск — відмова перезбірки/запису не клинить і не розшаровує стан
        array<string> unreachBefore = new array<string>();
        m_TechTree.GetUnreachable(unreachBefore);
        ZP_TechTreeFile work = CloneBranchFile(branch);
        bool replaced = false;
        for (int i = 0; i < work.Nodes.Count(); i++)
        {
            if (work.Nodes[i] && work.Nodes[i].Id == op.NodeData.Id)
            {
                work.Nodes[i] = op.NodeData;
                replaced = true;
                break;
            }
        }
        if (!replaced)
            work.Nodes.Insert(op.NodeData);
        ZP_TechTreeConfig fresh;
        if (!BuildTreeWithCandidate(op.BranchId, work, fresh, message))
            return false;
        array<string> unreachAfter = new array<string>();
        fresh.GetUnreachable(unreachAfter);
        string newUnreach = "";
        foreach (string uid : unreachAfter)
        {
            if (unreachBefore.Find(uid) < 0)
                newUnreach += uid + " ";
        }
        if (newUnreach != "")
        {
            message = "відхилено: вузли стануть недосяжними (цикл або хибний батьківський вузол): " + newUnreach;
            return false;
        }
        string saveErr;
        if (!SaveBranch(fresh, op.BranchId, saveErr))
        {
            message = saveErr;
            return false;
        }
        m_TechTree = fresh;
        if (replaced)
            message = "вузол '" + op.NodeData.Id + "' оновлено";
        else
            message = "вузол '" + op.NodeData.Id + "' створено у гілці '" + op.BranchId + "'";
        return true;
    }

    protected bool OpDeleteNode(string payloadJson, out string message)
    {
        ZP_Op_DeleteNode op = new ZP_Op_DeleteNode();
        string err;
        if (!JsonFileLoader<ZP_Op_DeleteNode>.LoadData(payloadJson, op, err))
        {
            message = "пошкоджений payload: " + err;
            return false;
        }
        string branchId;
        if (!m_TechTree.NodeBranch.Find(op.NodeId, branchId))
        {
            message = "вузол '" + op.NodeId + "' не знайдено";
            return false;
        }
        ZP_TechTreeFile branch = m_TechTree.Branches.Get(branchId);
        array<string> unreachBefore = new array<string>();
        m_TechTree.GetUnreachable(unreachBefore);
        ZP_TechTreeFile work = CloneBranchFile(branch);
        for (int i = work.Nodes.Count() - 1; i >= 0; i--)
        {
            if (work.Nodes[i] && work.Nodes[i].Id == op.NodeId)
                work.Nodes.RemoveOrdered(i);
        }
        ZP_TechTreeConfig fresh;
        if (!BuildTreeWithCandidate(branchId, work, fresh, message))
            return false;
        // видалення батьківського вузла не має мовчки осиротити нащадків — видаляти знизу вгору
        array<string> unreachAfter = new array<string>();
        fresh.GetUnreachable(unreachAfter);
        string newUnreach = "";
        foreach (string uid : unreachAfter)
        {
            if (unreachBefore.Find(uid) < 0)
                newUnreach += uid + " ";
        }
        if (newUnreach != "")
        {
            message = "відхилено: вузли осиротіють (спершу видаліть/перепідвісьте нащадків): " + newUnreach;
            return false;
        }
        string saveErr;
        if (!SaveBranch(fresh, branchId, saveErr))
        {
            message = saveErr;
            return false;
        }
        m_TechTree = fresh;
        message = "вузол '" + op.NodeId + "' видалено (правила з RequiredNode на нього стануть недосяжними — див. warnings)";
        WarnRulesVsTree();
        return true;
    }

    // ---- M3.5: транзакційні ops правил (дзеркало UPSERT_NODE/DELETE_NODE) ----

    // збереження одного файлу правил із ПЕРЕДАНОГО агрегату (до коміту в m_Rules)
    protected bool SaveRulesFile(ZP_ProcessingRules rules, string fileName, out string err)
    {
        err = "";
        ZP_RulesFile rf = rules.RuleFiles.Get(fileName);
        if (!rf)
        {
            err = "файл правил '" + fileName + "' не знайдено";
            return false;
        }
        string path = ZP_Const.RULES_DIR + "\\" + fileName;
        if (FileExist(path))
            CopyFile(path, ZP_Const.BACKUP_DIR + "\\" + fileName + ".bak");
        if (!JsonFileLoader<ZP_RulesFile>.SaveFile(path, rf, err))
            return false;
        return true;
    }

    // shallow-копія файлу правил: новий масив Rules, самі правила спільні
    protected ZP_RulesFile CloneRulesFile(ZP_RulesFile src)
    {
        ZP_RulesFile copy = new ZP_RulesFile();
        copy.ConfigVersion = src.ConfigVersion;
        foreach (ZP_Rule r : src.Rules)
        {
            copy.Rules.Insert(r);
        }
        return copy;
    }

    // агрегат правил із живих файлів із підстановкою candidate замість fileName
    protected bool BuildRulesWithCandidate(string fileName, ZP_RulesFile candidate, out ZP_ProcessingRules fresh, out string err)
    {
        err = "";
        fresh = new ZP_ProcessingRules();
        // Обхід КАРТИ не має визначеного порядку, а порядок правил — це їхній ПРІОРИТЕТ.
        // Через це кожне збереження мовчки перетасовувало пріоритет: у редакторі перелік
        // після «Застосувати» ставав іншим, хоча в конфігах нічого не рухалось. Тому
        // спершу впорядковуємо імена файлів — так само, як при завантаженні з диска.
        ref array<string> names = new array<string>();
        foreach (string fn, ZP_RulesFile rf : m_Rules.RuleFiles)
            names.Insert(fn);
        SortFileNames(names);

        foreach (string name : names)
        {
            ZP_RulesFile use = m_Rules.RuleFiles.Get(name);
            if (name == fileName)
                use = candidate;
            string hardErr;
            if (!fresh.AddFileRules(use, "ProcessingRules\\" + name, name, m_PointTypes, hardErr))
            {
                err = hardErr;
                return false;
            }
        }
        return true;
    }

    protected bool OpUpsertRule(string payloadJson, out string message)
    {
        ZP_Op_UpsertRule op = new ZP_Op_UpsertRule();
        string err;
        if (!JsonFileLoader<ZP_Op_UpsertRule>.LoadData(payloadJson, op, err))
        {
            message = "пошкоджений payload: " + err;
            return false;
        }
        if (!op.RuleData || op.RuleData.Id == "")
        {
            message = "немає RuleData.Id";
            return false;
        }
        if (!ZP_Uid.IsPathSafe(op.FileName) || op.FileName.IndexOf(".json") < 0)
        {
            message = "неприпустиме ім'я файлу: '" + op.FileName + "'";
            return false;
        }
        // валідація ДО мутації: невалідне правило не пишеться на диск із відповіддю OK
        string ruleErr = m_Rules.ValidateRule(op.RuleData, m_PointTypes);
        if (ruleErr != "")
        {
            message = "правило '" + op.RuleData.Id + "': " + ruleErr;
            return false;
        }
        ZP_RulesFile target = m_Rules.RuleFiles.Get(op.FileName);
        if (!target)
        {
            message = "файл '" + op.FileName + "' не знайдено в ProcessingRules (створення файлів — фаза 2)";
            return false;
        }
        // правило з цим Id може жити лише в цьому самому файлі (інакше дубль між файлами)
        string existingFile;
        if (m_Rules.RuleFileOf.Find(op.RuleData.Id, existingFile) && existingFile != op.FileName)
        {
            message = "правило '" + op.RuleData.Id + "' уже є у файлі '" + existingFile + "'";
            return false;
        }
        // транзакція: мутуємо КОПІЮ файлу, m_Rules комітиться після запису на диск
        ZP_RulesFile work = CloneRulesFile(target);
        bool replaced = false;
        for (int i = 0; i < work.Rules.Count(); i++)
        {
            if (work.Rules[i] && work.Rules[i].Id == op.RuleData.Id)
            {
                work.Rules[i] = op.RuleData;
                replaced = true;
                break;
            }
        }
        if (!replaced)
            work.Rules.Insert(op.RuleData);
        ZP_ProcessingRules fresh;
        if (!BuildRulesWithCandidate(op.FileName, work, fresh, message))
            return false;
        string saveErr;
        if (!SaveRulesFile(fresh, op.FileName, saveErr))
        {
            message = saveErr;
            return false;
        }
        m_Rules = fresh;
        WarnRulesVsTree();
        string state = "увімкнено";
        if (!op.RuleData.Enabled)
            state = "ВИМКНЕНО";
        if (replaced)
            message = "правило '" + op.RuleData.Id + "' оновлено (" + state + ")";
        else
            message = "правило '" + op.RuleData.Id + "' створено в '" + op.FileName + "' (" + state + ")";
        return true;
    }

    protected bool OpDeleteRule(string payloadJson, out string message)
    {
        ZP_Op_DeleteRule op = new ZP_Op_DeleteRule();
        string err;
        if (!JsonFileLoader<ZP_Op_DeleteRule>.LoadData(payloadJson, op, err))
        {
            message = "пошкоджений payload: " + err;
            return false;
        }
        string fileName;
        if (!m_Rules.RuleFileOf.Find(op.RuleId, fileName))
        {
            message = "правило '" + op.RuleId + "' не знайдено";
            return false;
        }
        ZP_RulesFile target = m_Rules.RuleFiles.Get(fileName);
        ZP_RulesFile work = CloneRulesFile(target);
        for (int i = work.Rules.Count() - 1; i >= 0; i--)
        {
            if (work.Rules[i] && work.Rules[i].Id == op.RuleId)
                work.Rules.RemoveOrdered(i);
        }
        ZP_ProcessingRules fresh;
        if (!BuildRulesWithCandidate(fileName, work, fresh, message))
            return false;
        string saveErr;
        if (!SaveRulesFile(fresh, fileName, saveErr))
        {
            message = saveErr;
            return false;
        }
        m_Rules = fresh;
        message = "правило '" + op.RuleId + "' видалено з '" + fileName + "'";
        return true;
    }

    protected bool OpUpsertPointType(string payloadJson, out string message)
    {
        ZP_PointType incoming = new ZP_PointType();
        string err;
        if (!JsonFileLoader<ZP_PointType>.LoadData(payloadJson, incoming, err))
        {
            message = "пошкоджений payload: " + err;
            return false;
        }
        // атомарність: збираємо новий конфіг, валідуємо, підміняємо лише в разі успіху
        ZP_PointTypesConfig next = new ZP_PointTypesConfig();
        next.ConfigVersion = m_PointTypes.ConfigVersion;
        next.PointTypes.Clear();
        bool replaced = false;
        foreach (ZP_PointType pt : m_PointTypes.PointTypes)
        {
            if (pt.Id == incoming.Id)
            {
                next.PointTypes.Insert(incoming);
                replaced = true;
            }
            else
            {
                next.PointTypes.Insert(pt);
            }
        }
        if (!replaced)
        {
            if (incoming.SortOrder == 0)
                incoming.SortOrder = next.PointTypes.Count() + 1;
            next.PointTypes.Insert(incoming);
        }
        string problems;
        if (!next.Validate(problems))
        {
            message = problems;
            return false;
        }
        m_PointTypes = next;
        SavePointTypes();
        if (replaced)
            message = "тип балів '" + incoming.Id + "' оновлено";
        else
            message = "тип балів '" + incoming.Id + "' створено";
        return true;
    }

    // ЗАГОТОВКИ ЛИШЕ ОНОВЛЮЮТЬСЯ. Їхні Id — це класи предметів зі збірки (ZP_Data_01..90),
    // тож «створити» заготовку через редактор неможливо в принципі, а «видалити» означало б
    // залишити в світі предмети без опису. Прибирання робиться галочкою Enabled.
    //
    // Транзакція та сама, що й у типів балів: збираємо НОВИЙ конфіг, валідуємо цілком і
    // підміняємо живий лише після успіху — інакше відмова валідації лишила б у пам'яті
    // напівзастосовану правку.
    protected bool OpUpsertDataItem(string payloadJson, out string message)
    {
        ZP_DataDef incoming = new ZP_DataDef();
        string err;
        if (!JsonFileLoader<ZP_DataDef>.LoadData(payloadJson, incoming, err))
        {
            message = "пошкоджений payload: " + err;
            return false;
        }
        if (!incoming || incoming.Id == "")
        {
            message = "немає Id заготовки";
            return false;
        }
        string softWarn;
        string hard = m_DataItems.ValidateItem(incoming, m_PointTypes, softWarn);
        if (hard != "")
        {
            message = "заготовка '" + incoming.Id + "': " + hard;
            return false;
        }

        ZP_DataItemsConfig next = new ZP_DataItemsConfig();
        next.ConfigVersion = m_DataItems.ConfigVersion;
        next.Items.Clear();
        bool replaced = false;
        foreach (ZP_DataDef d : m_DataItems.Items)
        {
            if (d && d.Id == incoming.Id)
            {
                next.Items.Insert(incoming);
                replaced = true;
            }
            else
            {
                next.Items.Insert(d);
            }
        }
        if (!replaced)
        {
            message = "заготовки '" + incoming.Id + "' немає в DataItems.json — нові додаються файлом";
            return false;
        }

        string problems;
        if (!next.Validate(m_PointTypes, problems))
        {
            message = problems;
            return false;
        }
        m_DataItems = next;
        SaveDataItems();
        message = "заготовку '" + incoming.Id + "' оновлено";
        if (softWarn != "")
            message += " (увага: " + softWarn + ")";
        return true;
    }

    // ІНСТРУМЕНТИ ПРИЛАДІВ (Modules.json): і «куди підходить» (Devices), і «скільки дає»
    // (PurityBonus) — в одному записі. На відміну від заготовок, це записи реєстру, а не
    // класи зі збірки, тож їх можна і створювати, і видаляти.
    //
    // Транзакція та сама, що всюди: збираємо НОВИЙ конфіг, валідуємо цілком і підміняємо
    // живий лише після успіху. Валідація тут ще й ЧИСТИТЬ (викидає биті записи), тож
    // застосувати її до живого конфігу означало б мовчки втратити чужі рядки при
    // невдалій правці.
    protected bool OpUpsertModule(string payloadJson, out string message)
    {
        ZP_ModuleDef incoming = new ZP_ModuleDef();
        string err;
        if (!JsonFileLoader<ZP_ModuleDef>.LoadData(payloadJson, incoming, err))
        {
            message = "пошкоджений payload: " + err;
            return false;
        }
        if (!incoming || incoming.Classname == "")
        {
            message = "немає Classname інструмента";
            return false;
        }

        ZP_ModulesConfig next = new ZP_ModulesConfig();
        next.ConfigVersion = m_Modules.ConfigVersion;
        next.Modules.Clear();
        bool replaced = false;
        foreach (ZP_ModuleDef md : m_Modules.Modules)
        {
            if (md && md.Classname == incoming.Classname)
            {
                next.Modules.Insert(incoming);
                replaced = true;
            }
            else
            {
                next.Modules.Insert(md);
            }
        }
        if (!replaced)
            next.Modules.Insert(incoming);

        string problems;
        // Validate чистить биті записи й повертає false — для нас це відмова цілком.
        if (!next.Validate(problems))
        {
            message = problems;
            return false;
        }
        m_Modules = next;
        SaveModules();
        if (replaced)
            message = "інструмент '" + incoming.Classname + "' оновлено";
        else
            message = "інструмент '" + incoming.Classname + "' створено";
        return true;
    }

    protected bool OpDeleteModule(string payloadJson, out string message)
    {
        ZP_Op_DeleteModule op = new ZP_Op_DeleteModule();
        string err;
        if (!JsonFileLoader<ZP_Op_DeleteModule>.LoadData(payloadJson, op, err))
        {
            message = "пошкоджений payload: " + err;
            return false;
        }
        ZP_ModulesConfig next = new ZP_ModulesConfig();
        next.ConfigVersion = m_Modules.ConfigVersion;
        next.Modules.Clear();
        bool found = false;
        foreach (ZP_ModuleDef md : m_Modules.Modules)
        {
            if (md && md.Classname == op.Classname)
            {
                found = true;
                continue;
            }
            next.Modules.Insert(md);
        }
        if (!found)
        {
            message = "інструмента '" + op.Classname + "' немає в реєстрі";
            return false;
        }
        m_Modules = next;
        SaveModules();
        // Правила з цим класом у RequiredTools лишаються дійсними: гейт перевіряє вкладення
        // приладу, а не реєстр. Зникає лише бонус до чистоти — саме це й попереджаємо.
        message = "інструмент '" + op.Classname + "' видалено (правила з ним у RequiredTools працюють далі, але бонусу він більше не дає)";
        return true;
    }

    protected bool OpReloadAll(out string message)
    {
        message = "";
        string e1;
        string e2;
        string e3;
        string e4;
        string e5;
        string e6;
        string e7;
        string e8;
        ZP_SettingsConfig freshS;
        ZP_PointTypesConfig freshP;
        ZP_ProcessingRules freshR;
        ZP_TechTreeConfig freshT;
        ZP_FactionsConfig freshF;
        ZP_DataItemsConfig freshD;
        ZP_ModulesConfig freshM;
        ZP_SampleTypesConfig freshSamp;
        bool createdS;
        bool createdP;
        bool createdR;
        bool createdT;
        bool createdF;
        bool createdD;
        bool createdM;
        bool createdSamp;
        bool okSettings = TryLoadSettings(freshS, createdS, e1);
        bool okPoints = TryLoadPointTypes(freshP, createdP, e2);
        // правила й дерево валідуються проти СВІЖИХ типів балів (якщо ті завантажилися)
        ZP_PointTypesConfig ptForRules = m_PointTypes;
        if (okPoints)
            ptForRules = freshP;
        bool okTree = TryLoadTechTree(ptForRules, freshT, createdT, e4);
        bool okRules = TryLoadRules(ptForRules, freshR, createdR, e3);
        bool okFactions = TryLoadFactions(freshF, createdF, e5);
        bool okData = TryLoadDataItems(ptForRules, freshD, createdD, e6);
        bool okModules = TryLoadModules(freshM, createdM, e7);
        // типи зразків не залежать від жодного іншого конфігу (Points у зразка немає)
        bool okSampleTypes = TryLoadSampleTypes(freshSamp, createdSamp, e8);
        if (!okSettings)
            message += e1 + " ";
        if (!okPoints)
            message += e2 + " ";
        if (!okTree)
            message += e4 + " ";
        if (!okRules)
            message += e3 + " ";
        if (!okFactions)
            message += e5 + " ";
        if (!okData)
            message += e6 + " ";
        if (!okModules)
            message += e7 + " ";
        if (!okSampleTypes)
            message += e8;
        if (!okSettings || !okPoints || !okTree || !okRules || !okFactions || !okData || !okModules || !okSampleTypes)
            return false;        // атомарність: нічого не застосовано, жоден файл не перезаписано
        m_Settings = freshS;
        m_PointTypes = freshP;
        m_TechTree = freshT;
        m_Rules = freshR;
        m_Factions = freshF;
        m_DataItems = freshD;
        m_Modules = freshM;
        m_SampleTypes = freshSamp;
        SaveSettings();
        SavePointTypes();
        SaveFactions();
        SaveDataItems();
        SaveModules();
        SaveSampleTypes();
        WarnRulesVsTree();
        message = "конфіги перечитано з диска (правил: " + m_Rules.Rules.Count() + ", вузлів: " + m_TechTree.Nodes.Count() + ", фракцій: " + m_Factions.Factions.Count() + ", заготовок: " + m_DataItems.Items.Count() + ", типів зразків: " + m_SampleTypes.Items.Count() + ")";
        return true;
    }

    // ---------- sync ----------

    // Кеш пофракційних збірок. Збірка — чиста функція від (ревізія, фракція), тож достатньо
    // скидати кеш там само, де росте ревізія: максимум стільки збірок, скільки фракцій.
    // Без кешу пофракційність коштувала б збірки на КОЖНОГО гравця при кожному пересинку.
    protected ref map<string, ref ZP_ClientConfig> m_ClientCache = new map<string, ref ZP_ClientConfig>();

    void InvalidateClientCache()
    {
        m_ClientCache.Clear();
    }

    // Термінали ФРАКЦІЇ: власний перелік фракції, а якщо його немає — загальний із Settings.
    // Єдине місце істини: цим користуються і збірка клієнтського конфігу, і серверна
    // перевірка дії відкриття дерева, тож розійтися вони не можуть.
    // ТЕРМІНАЛ НАЛЕЖИТЬ РІВНО ОДНІЙ ФРАКЦІЇ (рішення власника: «ЧН не повинен мати змоги
    // відкрити своє дерево на комп'ютері вчених»). Тому правило «не оголосила своїх —
    // не має жодного», а НЕ відкат на спільний перелік: спільний перелік означав би, що
    // всі фракції без власних налаштувань користуються одним і тим самим приладом.
    //
    // Загальний Settings.TreeTerminalClasses лишається лише для конфігурації з ОДНІЄЮ
    // фракцією (і як старт для новачка): він діє, поки жодна фракція не оголосила своїх.
    // Порожній перелік тримаємо ПОЛЕМ, а не створюємо на місці: `return new array<string>()`
    // у функції, що повертає не-ref, віддає масив без жодного власника — його одразу
    // прибирає підрахунок посилань, і викликач отримує сміття.
    protected ref array<string> m_NoTerminals = new array<string>();

    array<string> TerminalsFor(string factionClass)
    {
        ZP_FactionDef fdef = m_Factions.Find(factionClass);
        if (fdef && fdef.TerminalClasses.Count() > 0)
            return fdef.TerminalClasses;
        if (m_Factions.AnyFactionDeclaresTerminals())
            return m_NoTerminals;   // хтось уже поділив термінали — мовчазного доступу немає
        return m_Settings.TreeTerminalClasses;
    }

    // Прилад-станція фракції. Та сама логіка, що й для терміналів: поки НІХТО не поділив
    // прилади — доступні всі (сумісність і простий старт); щойно поділ почався, фракція
    // без власного переліку не має жодного приладу.
    array<string> DevicesFor(string factionClass)
    {
        ZP_FactionDef fdef = m_Factions.Find(factionClass);
        if (fdef && fdef.DeviceClasses.Count() > 0)
            return fdef.DeviceClasses;
        if (m_Factions.AnyFactionDeclaresDevices())
            return m_NoTerminals;
        return null;   // null = поділу немає, прилад доступний усім
    }

    bool IsDeviceFor(string factionClass, string classname)
    {
        array<string> list = DevicesFor(factionClass);
        if (!list)
            return true;   // поділу приладів немає
        foreach (string d : list)
        {
            if (ZP_ProcessingRules.MatchClass(classname, d))
                return true;
        }
        return false;
    }

    bool IsTerminalFor(string factionClass, string classname)
    {
        foreach (string term : TerminalsFor(factionClass))
        {
            if (ZP_ProcessingRules.MatchClass(classname, term))
                return true;
        }
        return false;
    }

    ZP_ClientConfig GetClientConfigFor(string factionClass)
    {
        ZP_ClientConfig cached;
        if (m_ClientCache.Find(factionClass, cached) && cached)
            return cached;
        ZP_ClientConfig built = BuildClientConfig(factionClass);
        m_ClientCache.Set(factionClass, built);
        return built;
    }

    ZP_ClientConfig BuildClientConfig(string factionClass)
    {
        ZP_ClientConfig cc = new ZP_ClientConfig();
        cc.Revision = m_Revision;
        cc.DebugMode = m_Settings.DebugMode;
        foreach (ZP_PointType pt : m_PointTypes.PointTypes)
        {
            // глибока копія: клієнтський знімок не має аліасити живий конфіг
            ZP_PointType copy = new ZP_PointType();
            copy.Id = pt.Id;
            copy.Name = pt.Name;
            copy.Icon = pt.Icon;
            copy.Color = pt.Color;
            copy.SortOrder = pt.SortOrder;
            copy.Category = pt.Category;
            copy.Kind = pt.Kind;
            copy.Tier = pt.Tier;
            cc.PointTypes.Insert(copy);
        }
        foreach (ZP_PointDimension pcat : m_PointTypes.Categories)
        {
            ZP_PointDimension ccat = new ZP_PointDimension();
            ccat.Id = pcat.Id;
            ccat.Name = pcat.Name;
            ccat.SortOrder = pcat.SortOrder;
            cc.PointCategories.Insert(ccat);
        }
        foreach (ZP_PointDimension pk : m_PointTypes.Kinds)
        {
            ZP_PointDimension ck = new ZP_PointDimension();
            ck.Id = pk.Id;
            ck.Name = pk.Name;
            ck.SortOrder = pk.SortOrder;
            cc.PointKinds.Insert(ck);
        }
        // Заготовки — ВСІМ, без фракційного фільтра: назву предмета в чужому рюкзаку однаково
        // видно, а без цього рядка трофейна заготовка виглядала б у чужинця як «не налаштовано».
        foreach (ZP_DataDef dd : m_DataItems.Items)
        {
            if (!dd || !dd.Enabled)
                continue;
            ZP_ClientDataItem cdi = new ZP_ClientDataItem();
            cdi.Id = dd.Id;
            cdi.Name = dd.Name;
            cdi.Description = dd.Description;
            // ЧИ Є ЩО НАРАХУВАТИ — рахує сервер і надсилає готову відповідь. Клієнт сам
            // цього не знає (бали йому не йдуть), а без прапорця його умова здачі
            // розходилася б із серверною: промпт обіцяв би здачу, сервер відмовляв, і при
            // цьому підказка дерева була б уже погашена — термінал ставав би мертвим.
            cdi.Depositable = ZP_DataItemsConfig.CountGrantable(dd, m_PointTypes) > 0;
            cc.DataItems.Insert(cdi);
        }
        // Типи зразків — та сама логіка й те саме обґрунтування, що й у заготовок вище:
        // усім без фракційного фільтра, назву в інвентарі й так видно. Depositable тут не
        // потрібен — зразок не здається напряму, Points у типу немає взагалі.
        foreach (ZP_SampleTypeDef sd : m_SampleTypes.Items)
        {
            if (!sd || !sd.Enabled)
                continue;
            ZP_ClientSampleType cst = new ZP_ClientSampleType();
            cst.Id = sd.Id;
            cst.Name = sd.Name;
            cst.Description = sd.Description;
            cc.SampleTypes.Insert(cst);
        }
        foreach (ZP_Rule r : m_Rules.Rules)
        {
            if (!r.Enabled)
                continue;   // вимкнені правила клієнтам не йдуть — промпти гаснуть (M3.5)
            // чужі правила клієнтові не йдуть узагалі: інакше він бачить, які прилади й
            // сировину використовує інша фракція, навіть не маючи змоги ними скористатись
            if (r.RequiredFactions.Count() > 0 && r.RequiredFactions.Find(factionClass) < 0)
                continue;
            ZP_ClientRule cr = new ZP_ClientRule();
            cr.Id = r.Id;
            cr.Device = r.Device;
            cr.Mode = r.Mode;
            cr.TimeSec = r.TimeSec;
            cr.RequiredNode = r.RequiredNode;
            foreach (string rf : r.RequiredFactions)
            {
                cr.RequiredFactions.Insert(rf);
            }
            foreach (string rw : r.RequiredWorn)
            {
                cr.RequiredWorn.Insert(rw);
            }
            foreach (string rt : r.RequiredTools)
            {
                cr.RequiredTools.Insert(rt);
            }
            cc.Rules.Insert(cr);
        }
        // M4: структура дерева клієнтам (глибокі копії; статуси — пофракційним SyncTree).
        // M8: лише СВОЇ вузли — чуже дерево клієнтові не надсилається взагалі.
        foreach (ZP_TreeNode tn : m_TechTree.Nodes)
        {
            if (!m_TechTree.NodeBelongsTo(tn, factionClass))
                continue;
            ZP_ClientNode cn = new ZP_ClientNode();
            cn.Id = tn.Id;
            cn.Name = tn.Name;
            cn.Description = tn.Description;
            cn.Icon = tn.Icon;
            cn.Tier = tn.Tier;
            string cnBranch;
            m_TechTree.NodeBranch.Find(tn.Id, cnBranch);
            cn.BranchId = cnBranch;
            foreach (string tnp : tn.Parents)
            {
                cn.Parents.Insert(tnp);
            }
            cn.ParentsMode = tn.ParentsMode;
            foreach (ZP_TreeCost tnc : tn.Cost)
            {
                cn.Cost.Insert(new ZP_KV(tnc.Type, tnc.Amount));
            }
            foreach (ZP_TreeItemCost tni : tn.ItemCost)
            {
                ZP_RuleConsumable icc = new ZP_RuleConsumable();
                icc.Classname = tni.Classname;
                icc.Quantity = tni.Quantity;
                cn.ItemCost.Insert(icc);
            }
            cn.ResearchTimeSec = tn.ResearchTimeSec;
            foreach (string tnf : tn.RequiredFactions)
            {
                cn.RequiredFactions.Insert(tnf);
            }
            cc.Nodes.Insert(cn);
        }
        foreach (string brId, ZP_TechTreeFile brFile : m_TechTree.Branches)
        {
            if (!m_TechTree.BranchBelongsTo(brId, factionClass))
                continue;
            ZP_ClientBranch cb = new ZP_ClientBranch();
            cb.Id = brId;
            if (brFile.Branch)
            {
                cb.Name = brFile.Branch.Name;
                cb.SortOrder = brFile.Branch.SortOrder;
            }
            cc.Branches.Insert(cb);
        }
        // термінали — лише свої (те саме джерело, що й у серверній перевірці дії)
        foreach (string term : TerminalsFor(factionClass))
        {
            cc.TreeTerminalClasses.Insert(term);
        }
        // прилади: порожній перелік у клієнта = поділу немає (див. DevicesFor)
        array<string> devList = DevicesFor(factionClass);
        if (devList)
        {
            cc.DeviceClassesSplit = true;
            foreach (string dv : devList)
            {
                cc.DeviceClasses.Insert(dv);
            }
        }
        cc.TreeVisibilityDepth = m_Settings.TreeVisibilityDepth;
        cc.TreeBackgroundImage = m_Settings.TreeBackgroundImage;
        return cc;
    }

    void SyncTo(PlayerIdentity identity, string factionClass)
    {
        if (!identity)
            return;
        if (!GetRPCManager())
            return;   // CF ще не піднявся — краще пропустити синк, ніж упасти
        GetRPCManager().SendRPC(ZP_Const.MOD, ZP_Const.RPC_SYNC_CONFIG, new Param1<ref ZP_ClientConfig>(GetClientConfigFor(factionClass)), true, identity);
    }

    // Широкомовний RPC (identity NULL) більше НЕ використовується: він фізично не може бути
    // пофракційним. Замість нього — адресна розсилка кожному онлайн-гравцеві збіркою його
    // фракції.
    //
    // Сам обхід гравців тут зробити НЕ МОЖНА: цей файл у 3_Game, а PlayerBase і резолв
    // фракції — у 4_World, і нижній рівень скриптів верхнього не бачить. Тому кидаємо
    // подію, а розсилає підписник у 5_Mission — той самий приймач, що вже розсилає
    // пересинк дерева.
    //
    // Реєстру «фракція -> гравці» свідомо НЕМАЄ: фракція визначається нашивкою і
    // змінюється в будь-яку мить, тож реєстр протухав би саме тоді, коли це найнебезпечніше —
    // одразу після зміни нашивки. Резолв на місці завжди правдивий і коштує одного пошуку
    // вкладення; важку частину — збірку конфігу — знімає кеш.
    void BroadcastConfig()
    {
        ZP_ConfigEvents.s_OnConfigChanged.Invoke();
    }
}
