// НАЧИНКА РЕДАКТОРА КОНФІГІВ, відокремлена від вікна.
//
// Господарів у неї двоє й вони НЕСУМІСНІ між собою: власне вікно мода (UIScriptedMenu,
// відкривається командою) і підменю всередині VPP AdminTools (ScriptedWidgetEventHandler,
// відкривається кнопкою в чужому вікні). Спільного предка в них немає, тому логіка не може
// жити в жодному з них — інакше довелося б тримати дві копії, які розійдуться першою ж
// правкою. Контролер не знає про вікно нічого: йому дають КОРІНЬ розмітки, а події
// (клік, вибір рядка, тік) господар просто переадресовує.
//
// Дані — адмін-знімок (повні правила/вузли/типи/фракції JSON-рядками, IsAdmin-гейт на
// сервері); правки — наявним RPC_ZP_AdminOp (сервер валідує, ops транзакційні).
// Увесь файл під NO_GUI-гардом: дедик компілюється без GUI-простору (ванільна практика).
#ifndef NO_GUI

class ZP_EditorController
{
    // Підтвердження видалення робить ГОСПОДАР: ванільний ShowDialog вимагає UIScriptedMenu,
    // а всередині VPP його немає — там своя система діалогів. Контролер лише каже, ЩО
    // питати (AskDelete повертає текст) і виконує рішення (ConfirmDelete).
    Widget m_Root;
    protected string m_PendingQuestion;
    protected bool m_ConfirmArmed;

    // Питання, яке господар має показати діалогом (і потім кликнути ConfirmDelete або
    // CancelDelete). Забирається один раз: повторний виклик поверне порожньо.
    string TakePendingQuestion()
    {
        string q = m_PendingQuestion;
        m_PendingQuestion = "";
        return q;
    }
    static const int DIALOG_DELETE = 777001;

    int m_Section = ZP_Snap.RULES;
    int m_SeenSnapCounter = -1;
    int m_SeenOpCounter = -1;
    int m_SeenConfigRevision = -1;

    ref ZP_SnapRules m_SnapRules;
    ref ZP_SnapNodes m_SnapNodes;
    ref ZP_PointTypesConfig m_SnapTypes;
    ref ZP_FactionsConfig m_SnapFactions;
    ref ZP_DataItemsConfig m_SnapData;
    ref ZP_ModulesConfig m_SnapModules;
    string m_SettingsJson;

    // фаза 2: ціль для НОВОГО елемента (шаблон із «Створити») та відкладене видалення
    string m_PendingFile;
    string m_PendingBranch;
    string m_PendingDeleteId;
    int m_PendingDeleteSection;

    TextListboxWidget m_List;
    MultilineEditBoxWidget m_Edit;
    TextWidget m_Meta;
    TextWidget m_Status;
    ButtonWidget m_BtnSecRules;
    ButtonWidget m_BtnSecNodes;
    ButtonWidget m_BtnSecTypes;
    ButtonWidget m_BtnSecSettings;
    ButtonWidget m_BtnSecFactions;
    ButtonWidget m_BtnSecData;
    ButtonWidget m_BtnSecModules;
    ButtonWidget m_BtnApply;
    ButtonWidget m_BtnToggle;
    ButtonWidget m_BtnRefresh;
    ButtonWidget m_BtnReload;
    ButtonWidget m_BtnClose;
    ButtonWidget m_BtnNew;
    ButtonWidget m_BtnDelete;

    // ---- ФОРМА ----
    // JSON лишається як експертний режим: він працює, і відмовлятись від нього немає
    // причин. Типово показуємо форму.
    ref ZP_EditorForm m_Form = new ZP_EditorForm();
    bool m_JsonMode;
    ButtonWidget m_BtnJson;
    Widget m_FormScroll;
    Widget m_FormContent;

    // Робоча копія редагованого елемента. Форма пише в НЕЇ, а вже вона серіалізується в
    // JsonEdit — так наявний шлях збереження (ops, валідація на сервері) лишається тим самим.
    ref ZP_Rule m_WorkRule;
    ref ZP_TreeNode m_WorkNode;
    ref ZP_PointType m_WorkType;
    ref ZP_FactionDef m_WorkFaction;
    ref ZP_SettingsConfig m_WorkSettings;
    ref ZP_DataDef m_WorkData;
    ref ZP_ModuleDef m_WorkModule;

    // ---- ВИБІР КЛАСУ ----
    Widget m_Picker;
    EditBoxWidget m_PickerFilter;
    ButtonWidget m_PickerFind;
    TextListboxWidget m_PickerList;
    ButtonWidget m_PickerOk;
    ButtonWidget m_PickerCancel;
    ref array<string> m_PickerItems = new array<string>();
    // куди покласти обране (рядок форми знайдемо за цими трьома ознаками, а не за
    // покажчиком: між відкриттям переліку й вибором форма могла перемалюватись)
    protected string m_PickArrayKey;
    protected int m_PickIndex;
    protected string m_PickKey;

    void RequestSnapshot()
    {
        ZP_ClientState.Get().RequestAdminSnapshot();
        SetStatus("запитано знімок конфігів...");
    }

    protected void ReparseSnapshot()
    {
        ZP_ClientState st = ZP_ClientState.Get();
        string json;
        string err;
        ZP_Log.Dbg("editor: розбираю знімок, секцій отримано=" + st.m_AdminSnap.Count() + " лічильник=" + st.m_SnapCounter);
        if (st.m_AdminSnap.Find(ZP_Snap.RULES, json))
        {
            ZP_SnapRules sr = new ZP_SnapRules();
            if (JsonFileLoader<ZP_SnapRules>.LoadData(json, sr, err))
                m_SnapRules = sr;
            else
                ZP_Log.Err("парсинг знімка правил: " + err);
        }
        if (st.m_AdminSnap.Find(ZP_Snap.NODES, json))
        {
            ZP_SnapNodes sn = new ZP_SnapNodes();
            if (JsonFileLoader<ZP_SnapNodes>.LoadData(json, sn, err))
                m_SnapNodes = sn;
            else
                ZP_Log.Err("парсинг знімка вузлів: " + err);
        }
        if (st.m_AdminSnap.Find(ZP_Snap.POINTTYPES, json))
        {
            ZP_PointTypesConfig pt = new ZP_PointTypesConfig();
            if (JsonFileLoader<ZP_PointTypesConfig>.LoadData(json, pt, err))
                m_SnapTypes = pt;
            else
                ZP_Log.Err("парсинг знімка типів: " + err);
        }
        if (st.m_AdminSnap.Find(ZP_Snap.SETTINGS, json))
            m_SettingsJson = json;
        if (st.m_AdminSnap.Find(ZP_Snap.FACTIONS, json))
        {
            ZP_FactionsConfig fc = new ZP_FactionsConfig();
            if (JsonFileLoader<ZP_FactionsConfig>.LoadData(json, fc, err))
                m_SnapFactions = fc;
            else
                ZP_Log.Err("парсинг знімка фракцій: " + err);
        }
        if (st.m_AdminSnap.Find(ZP_Snap.DATAITEMS, json))
        {
            ZP_DataItemsConfig dc = new ZP_DataItemsConfig();
            if (JsonFileLoader<ZP_DataItemsConfig>.LoadData(json, dc, err))
                m_SnapData = dc;
            else
                ZP_Log.Err("парсинг знімка заготовок: " + err);
        }
        if (st.m_AdminSnap.Find(ZP_Snap.MODULES, json))
        {
            ZP_ModulesConfig mc = new ZP_ModulesConfig();
            if (JsonFileLoader<ZP_ModulesConfig>.LoadData(json, mc, err))
                m_SnapModules = mc;
            else
                ZP_Log.Err("парсинг знімка модулів: " + err);
        }
        RebuildList();
    }

    // Ідентифікатор вибраного елемента. Тримати НОМЕР РЯДКА не можна: після «Застосувати»
    // сервер надсилає новий знімок, у якому порядок правил інший (агрегат перезбирається
    // обходом файлів), і той самий номер вказує вже на інше правило. Спіймано живим тестом:
    // «Увімк/Вимк» перемішав список, наступне «Застосувати» пішло в СУСІДНЄ правило — тобто
    // адмін мовчки правив не те, що бачив.
    protected string m_SelectedId;

    protected void RebuildList()
    {
        if (!m_List)
            return;
        m_List.ClearItems();
        int restore = -1;
        int n = 0;
        if (m_Section == ZP_Snap.RULES && m_SnapRules)
        {
            foreach (ZP_SnapRuleEntry re : m_SnapRules.Entries)
            {
                string label = re.Rule.Id;
                if (!re.Rule.Enabled)
                    label += "  [ВИМК]";
                m_List.AddItem(label, NULL, 0);
                if (re.Rule.Id == m_SelectedId)
                    restore = n;
                n++;
            }
        }
        if (m_Section == ZP_Snap.NODES && m_SnapNodes)
        {
            foreach (ZP_SnapNodeEntry ne : m_SnapNodes.Entries)
            {
                m_List.AddItem(ne.Node.Id + "  (" + ne.BranchId + ")", NULL, 0);
                if (ne.Node.Id == m_SelectedId)
                    restore = n;
                n++;
            }
        }
        if (m_Section == ZP_Snap.POINTTYPES && m_SnapTypes)
        {
            foreach (ZP_PointType pt : m_SnapTypes.PointTypes)
            {
                m_List.AddItem(pt.Id + "  — " + pt.Name, NULL, 0);
                if (pt.Id == m_SelectedId)
                    restore = n;
                n++;
            }
        }
        if (m_Section == ZP_Snap.SETTINGS)
            m_List.AddItem("Settings.json", NULL, 0);
        if (m_Section == ZP_Snap.FACTIONS && m_SnapFactions)
        {
            foreach (ZP_FactionDef fd : m_SnapFactions.Factions)
            {
                if (!fd)
                    continue;
                m_List.AddItem(fd.Id + "  — " + fd.DisplayName, NULL, 0);
                if (fd.Id == m_SelectedId)
                    restore = n;
                n++;
            }
        }
        if (m_Section == ZP_Snap.DATAITEMS && m_SnapData)
        {
            foreach (ZP_DataDef dd : m_SnapData.Items)
            {
                if (!dd)
                    continue;
                string dlabel = dd.Id + "  — " + dd.Name;
                if (!dd.Enabled)
                    dlabel += "  [ВИМК]";
                m_List.AddItem(dlabel, NULL, 0);
                if (dd.Id == m_SelectedId)
                    restore = n;
                n++;
            }
        }
        if (m_Section == ZP_Snap.MODULES && m_SnapModules)
        {
            foreach (ZP_ModuleDef mm : m_SnapModules.Modules)
            {
                if (!mm)
                    continue;
                m_List.AddItem(mm.Classname + "   +" + mm.PurityBonus, NULL, 0);
                if (mm.Classname == m_SelectedId)
                    restore = n;
                n++;
            }
        }
        // Повертаємо виділення на ТОЙ САМИЙ елемент, а не на той самий номер рядка.
        if (restore >= 0)
        {
            m_List.SelectRow(restore);
            m_List.EnsureVisible(restore);
        }
    }

    // Прив'язка до вже створеної розмітки. Створює її ГОСПОДАР: власне вікно робить це в
    // Init(), підменю VPP — у OnCreate, і шлях до layout у них різний бути не може лише
    // тому, що обидва беруть ту саму розмітку.
    bool Attach(Widget root)
    {
        if (!root)
            return false;
        m_Root = root;
        m_List = TextListboxWidget.Cast(root.FindAnyWidget("ItemList"));
        m_Edit = MultilineEditBoxWidget.Cast(root.FindAnyWidget("JsonEdit"));
        m_Meta = TextWidget.Cast(root.FindAnyWidget("MetaLabel"));
        m_Status = TextWidget.Cast(root.FindAnyWidget("StatusLine"));
        m_BtnSecRules = ButtonWidget.Cast(root.FindAnyWidget("BtnSecRules"));
        m_BtnSecNodes = ButtonWidget.Cast(root.FindAnyWidget("BtnSecNodes"));
        m_BtnSecTypes = ButtonWidget.Cast(root.FindAnyWidget("BtnSecTypes"));
        m_BtnSecSettings = ButtonWidget.Cast(root.FindAnyWidget("BtnSecSettings"));
        m_BtnSecFactions = ButtonWidget.Cast(root.FindAnyWidget("BtnSecFactions"));
        m_BtnSecData = ButtonWidget.Cast(root.FindAnyWidget("BtnSecData"));
        m_BtnSecModules = ButtonWidget.Cast(root.FindAnyWidget("BtnSecModules"));
        m_BtnApply = ButtonWidget.Cast(root.FindAnyWidget("BtnApply"));
        m_BtnToggle = ButtonWidget.Cast(root.FindAnyWidget("BtnToggle"));
        m_BtnRefresh = ButtonWidget.Cast(root.FindAnyWidget("BtnRefresh"));
        m_BtnReload = ButtonWidget.Cast(root.FindAnyWidget("BtnReload"));
        m_BtnClose = ButtonWidget.Cast(root.FindAnyWidget("BtnClose"));
        m_BtnNew = ButtonWidget.Cast(root.FindAnyWidget("BtnNew"));
        m_BtnDelete = ButtonWidget.Cast(root.FindAnyWidget("BtnDelete"));

        m_BtnJson = ButtonWidget.Cast(root.FindAnyWidget("BtnJson"));
        m_FormScroll = root.FindAnyWidget("FormScroll");
        m_FormContent = root.FindAnyWidget("FormContent");
        m_Form.SetContent(m_FormContent);

        m_Picker = root.FindAnyWidget("PickerPanel");
        m_PickerFilter = EditBoxWidget.Cast(root.FindAnyWidget("PickerFilter"));
        m_PickerFind = ButtonWidget.Cast(root.FindAnyWidget("PickerFind"));
        m_PickerList = TextListboxWidget.Cast(root.FindAnyWidget("PickerList"));
        m_PickerOk = ButtonWidget.Cast(root.FindAnyWidget("PickerOk"));
        m_PickerCancel = ButtonWidget.Cast(root.FindAnyWidget("PickerCancel"));
        if (m_Picker)
            m_Picker.Show(false);
        return true;
    }

    protected void ApplyMode()
    {
        if (m_Edit)
            m_Edit.Show(m_JsonMode);
        if (m_FormScroll)
            m_FormScroll.Show(!m_JsonMode);
    }

    // Чи це кнопка закриття: закриває вікно ГОСПОДАР — способи в них різні.
    bool IsCloseButton(Widget w)
    {
        return w == m_BtnClose;
    }

    // Тік: оновлення знімка, відповіді сервера, підказка про чужу правку.
    void OnUpdate()
    {
        // Фокус у поле пошуку ставимо КІЛЬКА ТІКІВ ПОСПІЛЬ, а не один раз при показі:
        // у тому ж кадрі, де віджет щойно показали, SetFocus не тримається, і набране
        // йшло в гру замість поля. Перевірено на місці: з повтором GetFocus() повертає
        // саме поле пошуку, і перелік звужується просто під час набору.
        if (m_PickFocusPending > 0)
        {
            m_PickFocusPending--;
            SetFocus(m_PickerFilter);
        }
        ZP_ClientState st = ZP_ClientState.Get();
        if (st.m_SnapCounter != m_SeenSnapCounter)
        {
            m_SeenSnapCounter = st.m_SnapCounter;
            ReparseSnapshot();
        }
        if (st.m_LastOpCounter != m_SeenOpCounter)
        {
            // ПЕРШИЙ погляд — не подія. Лічильник відповідей стартує з 0, а «бачив» з -1,
            // тож на першому ж тіку вони розходились і редактор вітав адміна порожньою
            // «ПОМИЛКА:» — це був стан «жодної операції ще не було», а не збій.
            bool first = m_SeenOpCounter == -1;
            m_SeenOpCounter = st.m_LastOpCounter;
            if (!first)
            {
                if (st.m_LastOpOk)
                    ZP_ClientState.Get().RequestAdminSnapshot();   // оновлення після власної успішної операції
                string pfx = "OK: ";
                if (!st.m_LastOpOk)
                    pfx = "ПОМИЛКА: ";
                SetStatus(pfx + st.m_LastOpResult);
            }
        }
        // чужа правка (інший адмін/чат): не затираємо набране — лише підказка
        if (st.m_Config && st.m_Config.Revision != m_SeenConfigRevision)
        {
            if (m_SeenConfigRevision != -1)
                SetStatus("конфіг змінився (ревізія " + st.m_Config.Revision + ") — натисніть «Оновити»");
            m_SeenConfigRevision = st.m_Config.Revision;
        }
    }

    // Виконати відкладене видалення (господар спитав і отримав «так»)
    void ConfirmDelete()
    {
        if (m_PendingDeleteId == "")
            return;
        string payload;
        string err;
        if (m_PendingDeleteSection == ZP_Snap.RULES)
        {
            ZP_Op_DeleteRule opDR = new ZP_Op_DeleteRule();
            opDR.RuleId = m_PendingDeleteId;
            if (JsonFileLoader<ZP_Op_DeleteRule>.MakeData(opDR, payload, err, false))
                SendOp(ZP_Op.DELETE_RULE, payload);
        }
        else if (m_PendingDeleteSection == ZP_Snap.MODULES)
        {
            ZP_Op_DeleteModule opDM = new ZP_Op_DeleteModule();
            opDM.Classname = m_PendingDeleteId;
            if (JsonFileLoader<ZP_Op_DeleteModule>.MakeData(opDM, payload, err, false))
                SendOp(ZP_Op.DELETE_MODULE, payload);
        }
        else if (m_PendingDeleteSection == ZP_Snap.FACTIONS)
        {
            ZP_Op_DeleteFaction opDF = new ZP_Op_DeleteFaction();
            opDF.FactionId = m_PendingDeleteId;
            if (JsonFileLoader<ZP_Op_DeleteFaction>.MakeData(opDF, payload, err, false))
                SendOp(ZP_Op.DELETE_FACTION, payload);
        }
        else
        {
            ZP_Op_DeleteNode opDN = new ZP_Op_DeleteNode();
            opDN.NodeId = m_PendingDeleteId;
            if (JsonFileLoader<ZP_Op_DeleteNode>.MakeData(opDN, payload, err, false))
                SendOp(ZP_Op.DELETE_NODE, payload);
        }
        m_PendingDeleteId = "";
    }

    void CancelDelete()
    {
        m_PendingDeleteId = "";
        m_ConfirmArmed = false;
    }

    // ПІДТВЕРДЖЕННЯ БЕЗ МОДАЛЬНОГО ВІКНА: господар, у якого модалки немає (вкладка VPP),
    // взводить очікування другого натискання. Другий клік по «Видалити» виконує операцію.
    void ArmConfirm(string question)
    {
        m_ConfirmArmed = true;
        SetStatus(question + "   [натисніть «Видалити» ще раз, щоб підтвердити]");
    }

    bool IsConfirmArmed()
    {
        return m_ConfirmArmed;
    }

    bool HandleItemSelected(Widget w, int row)
    {
        if (w == m_List)
        {
            LoadSelection(row);
            return true;
        }
        return false;
    }

    // Переліки для випадних списків беруться з ТОГО САМОГО знімка, що й самі елементи:
    // це прибирає другу за частотою причину мертвого правила після опечатки в класі —
    // посилання на вузол або тип балів, якого немає.
    protected void NodeIds(out array<string> ids)
    {
        ids.Clear();
        if (!m_SnapNodes)
            return;
        foreach (ZP_SnapNodeEntry ne : m_SnapNodes.Entries)
            ids.Insert(ne.Node.Id);
    }

    protected void FactionIds(out array<string> ids)
    {
        ids.Clear();
        if (!m_SnapFactions)
            return;
        foreach (ZP_FactionDef fd : m_SnapFactions.Factions)
        {
            if (fd)
                ids.Insert(fd.Id);
        }
    }

    protected void PointTypeIds(out array<string> ids)
    {
        ids.Clear();
        if (!m_SnapTypes)
            return;
        foreach (ZP_PointType pt : m_SnapTypes.PointTypes)
            ids.Insert(pt.Id);
    }

    protected void DimIds(array<ref ZP_PointDimension> dims, out array<string> ids)
    {
        ids.Clear();
        if (!dims)
            return;
        foreach (ZP_PointDimension d : dims)
        {
            if (d)
                ids.Insert(d.Id);
        }
    }

    // Перемальовує ОБИДВА подання з робочої копії. JSON лишається живим навіть у режимі
    // форми: саме його читає «Застосувати», тож розходження між тим, що видно, і тим, що
    // піде на сервер, тут неможливе за побудовою.
    protected void RefreshEditor()
    {
        string pretty;
        string err;
        m_Form.Clear();
        array<string> nodes = new array<string>();
        array<string> factions = new array<string>();
        array<string> types = new array<string>();

        if (m_Section == ZP_Snap.RULES && m_WorkRule)
        {
            NodeIds(nodes);
            FactionIds(factions);
            m_Form.BuildRule(m_WorkRule, nodes, factions);
            if (JsonFileLoader<ZP_Rule>.MakeData(m_WorkRule, pretty, err, true))
                m_Edit.SetText(pretty);
        }
        else if (m_Section == ZP_Snap.NODES && m_WorkNode)
        {
            PointTypeIds(types);
            NodeIds(nodes);
            FactionIds(factions);
            m_Form.BuildNode(m_WorkNode, types, nodes, factions);
            if (JsonFileLoader<ZP_TreeNode>.MakeData(m_WorkNode, pretty, err, true))
                m_Edit.SetText(pretty);
        }
        else if (m_Section == ZP_Snap.POINTTYPES && m_WorkType)
        {
            array<string> cats = new array<string>();
            array<string> kinds = new array<string>();
            if (m_SnapTypes)
            {
                DimIds(m_SnapTypes.Categories, cats);
                DimIds(m_SnapTypes.Kinds, kinds);
            }
            m_Form.BuildPointType(m_WorkType, cats, kinds);
            if (JsonFileLoader<ZP_PointType>.MakeData(m_WorkType, pretty, err, true))
                m_Edit.SetText(pretty);
        }
        else if (m_Section == ZP_Snap.FACTIONS && m_WorkFaction)
        {
            m_Form.BuildFaction(m_WorkFaction);
            if (JsonFileLoader<ZP_FactionDef>.MakeData(m_WorkFaction, pretty, err, true))
                m_Edit.SetText(pretty);
        }
        else if (m_Section == ZP_Snap.SETTINGS && m_WorkSettings)
        {
            m_Form.BuildSettings(m_WorkSettings);
            if (JsonFileLoader<ZP_SettingsConfig>.MakeData(m_WorkSettings, pretty, err, true))
                m_Edit.SetText(pretty);
        }
        else if (m_Section == ZP_Snap.DATAITEMS && m_WorkData)
        {
            PointTypeIds(types);
            m_Form.BuildDataItem(m_WorkData, types);
            if (JsonFileLoader<ZP_DataDef>.MakeData(m_WorkData, pretty, err, true))
                m_Edit.SetText(pretty);
        }
        else if (m_Section == ZP_Snap.MODULES && m_WorkModule)
        {
            m_Form.BuildModule(m_WorkModule);
            if (JsonFileLoader<ZP_ModuleDef>.MakeData(m_WorkModule, pretty, err, true))
                m_Edit.SetText(pretty);
        }
        m_Form.Render();
    }

    // Знімає набране з віджетів у робочу копію й одразу оновлює JSON.
    protected void SyncFromForm()
    {
        if (m_JsonMode)
            return;   // у режимі JSON істина — сам текст
        string pretty;
        string err;
        if (m_Section == ZP_Snap.RULES && m_WorkRule)
        {
            m_Form.CollectRule(m_WorkRule);
            if (JsonFileLoader<ZP_Rule>.MakeData(m_WorkRule, pretty, err, true))
                m_Edit.SetText(pretty);
        }
        else if (m_Section == ZP_Snap.NODES && m_WorkNode)
        {
            m_Form.CollectNode(m_WorkNode);
            if (JsonFileLoader<ZP_TreeNode>.MakeData(m_WorkNode, pretty, err, true))
                m_Edit.SetText(pretty);
        }
        else if (m_Section == ZP_Snap.POINTTYPES && m_WorkType)
        {
            m_Form.CollectPointType(m_WorkType);
            if (JsonFileLoader<ZP_PointType>.MakeData(m_WorkType, pretty, err, true))
                m_Edit.SetText(pretty);
        }
        else if (m_Section == ZP_Snap.FACTIONS && m_WorkFaction)
        {
            m_Form.CollectFaction(m_WorkFaction);
            if (JsonFileLoader<ZP_FactionDef>.MakeData(m_WorkFaction, pretty, err, true))
                m_Edit.SetText(pretty);
        }
        else if (m_Section == ZP_Snap.DATAITEMS && m_WorkData)
        {
            m_Form.CollectDataItem(m_WorkData);
            if (JsonFileLoader<ZP_DataDef>.MakeData(m_WorkData, pretty, err, true))
                m_Edit.SetText(pretty);
        }
        else if (m_Section == ZP_Snap.MODULES && m_WorkModule)
        {
            m_Form.CollectModule(m_WorkModule);
            if (JsonFileLoader<ZP_ModuleDef>.MakeData(m_WorkModule, pretty, err, true))
                m_Edit.SetText(pretty);
        }
        else if (m_Section == ZP_Snap.SETTINGS && m_WorkSettings)
        {
            // Налаштування збираються як «ключ+значення» (такий у них контракт), але в
            // робочу копію їх усе одно треба покласти — інакше «+»/«-» у списку терміналів
            // перемальовували б форму зі СТАРОГО стану й губили щойно набране.
            array<string> keys = new array<string>();
            array<string> vals = new array<string>();
            m_Form.CollectSettings(keys, vals);
            for (int i = 0; i < keys.Count(); i++)
            {
                if (keys[i] == "debug")
                    m_WorkSettings.DebugMode = vals[i] == "true";
                else if (keys[i] == "treedepth")
                    m_WorkSettings.TreeVisibilityDepth = vals[i].ToInt();
                else if (keys[i] == "treeterminal")
                {
                    m_WorkSettings.TreeTerminalClasses.Clear();
                    vals[i].Split(",", m_WorkSettings.TreeTerminalClasses);
                }
            }
            if (JsonFileLoader<ZP_SettingsConfig>.MakeData(m_WorkSettings, pretty, err, true))
                m_Edit.SetText(pretty);
        }
    }

    // Повернення з експертного режиму: текст міг бути змінений руками, і форма мусить
    // показати саме його, а не те, що було до перемикання.
    protected void LoadWorkFromJson()
    {
        string text;
        string err;
        m_Edit.GetText(text);
        if (text == "")
            return;
        if (m_Section == ZP_Snap.RULES)
        {
            ZP_Rule r = new ZP_Rule();
            if (JsonFileLoader<ZP_Rule>.LoadData(text, r, err))
                m_WorkRule = r;
            else
                SetStatus("JSON не парситься, форма лишилась попередньою: " + err);
            return;
        }
        if (m_Section == ZP_Snap.NODES)
        {
            ZP_TreeNode n = new ZP_TreeNode();
            if (JsonFileLoader<ZP_TreeNode>.LoadData(text, n, err))
                m_WorkNode = n;
            else
                SetStatus("JSON не парситься, форма лишилась попередньою: " + err);
            return;
        }
        if (m_Section == ZP_Snap.POINTTYPES)
        {
            ZP_PointType p = new ZP_PointType();
            if (JsonFileLoader<ZP_PointType>.LoadData(text, p, err))
                m_WorkType = p;
            else
                SetStatus("JSON не парситься, форма лишилась попередньою: " + err);
            return;
        }
        if (m_Section == ZP_Snap.FACTIONS)
        {
            ZP_FactionDef f = new ZP_FactionDef();
            if (JsonFileLoader<ZP_FactionDef>.LoadData(text, f, err))
                m_WorkFaction = f;
            else
                SetStatus("JSON не парситься, форма лишилась попередньою: " + err);
            return;
        }
        if (m_Section == ZP_Snap.SETTINGS)
        {
            ZP_SettingsConfig s = new ZP_SettingsConfig();
            if (JsonFileLoader<ZP_SettingsConfig>.LoadData(text, s, err))
                m_WorkSettings = s;
            else
                SetStatus("JSON не парситься, форма лишилась попередньою: " + err);
            return;
        }
        if (m_Section == ZP_Snap.DATAITEMS)
        {
            ZP_DataDef d = new ZP_DataDef();
            if (JsonFileLoader<ZP_DataDef>.LoadData(text, d, err))
                m_WorkData = d;
            else
                SetStatus("JSON не парситься, форма лишилась попередньою: " + err);
            return;
        }
        if (m_Section == ZP_Snap.MODULES)
        {
            ZP_ModuleDef md = new ZP_ModuleDef();
            if (JsonFileLoader<ZP_ModuleDef>.LoadData(text, md, err))
                m_WorkModule = md;
            else
                SetStatus("JSON не парситься, форма лишилась попередньою: " + err);
        }
    }

    // Глибока копія через JSON: правити об'єкт знімка не можна — при відмові сервера
    // список показував би вже змінене, хоча на сервері нічого не сталось.
    protected bool CloneRule(ZP_Rule src, out ZP_Rule dst)
    {
        string json;
        string err;
        dst = new ZP_Rule();
        return JsonFileLoader<ZP_Rule>.MakeData(src, json, err, false) && JsonFileLoader<ZP_Rule>.LoadData(json, dst, err);
    }

    protected bool CloneNode(ZP_TreeNode src, out ZP_TreeNode dst)
    {
        string json;
        string err;
        dst = new ZP_TreeNode();
        return JsonFileLoader<ZP_TreeNode>.MakeData(src, json, err, false) && JsonFileLoader<ZP_TreeNode>.LoadData(json, dst, err);
    }

    protected bool CloneType(ZP_PointType src, out ZP_PointType dst)
    {
        string json;
        string err;
        dst = new ZP_PointType();
        return JsonFileLoader<ZP_PointType>.MakeData(src, json, err, false) && JsonFileLoader<ZP_PointType>.LoadData(json, dst, err);
    }

    protected bool CloneFaction(ZP_FactionDef src, out ZP_FactionDef dst)
    {
        string json;
        string err;
        dst = new ZP_FactionDef();
        return JsonFileLoader<ZP_FactionDef>.MakeData(src, json, err, false) && JsonFileLoader<ZP_FactionDef>.LoadData(json, dst, err);
    }

    protected void LoadSelection(int row)
    {
        // вибір наявного елемента скасовує «новий» контекст
        m_PendingFile = "";
        m_PendingBranch = "";
        string pretty;
        string err;
        if (m_Section == ZP_Snap.RULES)
        {
            if (!m_SnapRules || row < 0 || row >= m_SnapRules.Entries.Count())
                return;
            ZP_SnapRuleEntry re = m_SnapRules.Entries[row];
            m_SelectedId = re.Rule.Id;
            CloneRule(re.Rule, m_WorkRule);
            RefreshEditor();
            m_Meta.SetText("файл: ProcessingRules\\" + re.FileName + " — зміна Id створить НОВЕ правило в цьому файлі");
            return;
        }
        if (m_Section == ZP_Snap.NODES)
        {
            if (!m_SnapNodes || row < 0 || row >= m_SnapNodes.Entries.Count())
                return;
            ZP_SnapNodeEntry ne = m_SnapNodes.Entries[row];
            m_SelectedId = ne.Node.Id;
            CloneNode(ne.Node, m_WorkNode);
            RefreshEditor();
            m_Meta.SetText("гілка: " + ne.BranchId + " (TechTree)");
            return;
        }
        if (m_Section == ZP_Snap.POINTTYPES)
        {
            if (!m_SnapTypes || row < 0 || row >= m_SnapTypes.PointTypes.Count())
                return;
            m_SelectedId = m_SnapTypes.PointTypes[row].Id;
            CloneType(m_SnapTypes.PointTypes[row], m_WorkType);
            RefreshEditor();
            m_Meta.SetText("PointTypes.json");
            return;
        }
        if (m_Section == ZP_Snap.FACTIONS)
        {
            if (!m_SnapFactions || row < 0 || row >= m_SnapFactions.Factions.Count())
                return;
            m_SelectedId = m_SnapFactions.Factions[row].Id;
            CloneFaction(m_SnapFactions.Factions[row], m_WorkFaction);
            RefreshEditor();
            m_Meta.SetText("Factions.json");
            return;
        }
        if (m_Section == ZP_Snap.DATAITEMS)
        {
            if (!m_SnapData || row < 0 || row >= m_SnapData.Items.Count())
                return;
            ZP_DataDef src = m_SnapData.Items[row];
            m_SelectedId = src.Id;
            string dj;
            ZP_DataDef dcopy = new ZP_DataDef();
            if (JsonFileLoader<ZP_DataDef>.MakeData(src, dj, err, false) && JsonFileLoader<ZP_DataDef>.LoadData(dj, dcopy, err))
                m_WorkData = dcopy;
            RefreshEditor();
            m_Meta.SetText("DataItems.json — клас предмета не змінюється; прибрати з обігу = зняти «Увімкнено»");
            return;
        }
        if (m_Section == ZP_Snap.MODULES)
        {
            if (!m_SnapModules || row < 0 || row >= m_SnapModules.Modules.Count())
                return;
            ZP_ModuleDef msrc = m_SnapModules.Modules[row];
            m_SelectedId = msrc.Classname;
            string mj;
            ZP_ModuleDef mcopy = new ZP_ModuleDef();
            if (JsonFileLoader<ZP_ModuleDef>.MakeData(msrc, mj, err, false) && JsonFileLoader<ZP_ModuleDef>.LoadData(mj, mcopy, err))
                m_WorkModule = mcopy;
            RefreshEditor();
            m_Meta.SetText("Modules.json — «куди підходить» (перелік приладів) і «скільки дає» (бонус до чистоти)");
            return;
        }
        if (m_Section == ZP_Snap.SETTINGS)
        {
            ZP_SettingsConfig sc = new ZP_SettingsConfig();
            if (m_SettingsJson != "" && JsonFileLoader<ZP_SettingsConfig>.LoadData(m_SettingsJson, sc, err))
                m_WorkSettings = sc;
            RefreshEditor();
            m_Meta.SetText("Settings.json — правляться debug, глибина дерева і спільні термінали");
        }
    }

    // ПЕРЕЛІК З ПОШУКОМ — один на всі поля вибору.
    //
    // Штатний XComboBoxWidget тут не годиться: він не вміє шукати, а найбільший з наших
    // переліків — класи предметів усіх модів — це десятки тисяч рядків. Тому вигляд той
    // самий, що й у менеджера предметів VPP: поле пошуку + список, який звужується просто
    // під час набору.
    //
    // Джерело залежить від поля: для класу — індекс конфігів, для решти — перелік, який
    // зібрала сама форма зі знімка (вузли, типи балів, фракції).
    protected bool m_PickFromClasses;
    protected ref array<string> m_PickSource = new array<string>();

    protected void OpenPicker(ZP_FormRow r)
    {
        if (!m_Picker)
            return;
        m_PickArrayKey = r.ArrayKey;
        m_PickIndex = r.Index;
        m_PickKey = r.Key;
        m_PickFromClasses = r.Kind == ZP_FK.CLASS;

        m_PickSource.Clear();
        if (!m_PickFromClasses && r.Options)
        {
            for (int i = 0; i < r.Options.Count(); i++)
                m_PickSource.Insert(r.Options[i]);
        }

        // Пошук починаємо з ЧИСТОГО поля, а не з поточного значення: інакше перелік одразу
        // звузився б до одного рядка — того самого, який хочуть замінити.
        m_PickerFilter.SetText("");
        FillPicker("");
        m_Picker.Show(true);
        // Фокус ставимо НАСТУПНИМ тіком, а не тут: у кадрі, де віджет щойно показали,
        // SetFocus не спрацьовує — перевірено на місці (поле лишалось без фокуса, і набране
        // йшло в гру). Той самий за природою випадок, що й відкриття вікна в кадрі, де
        // стеком меню ще володіє інше.
        m_PickFocusPending = 5;
    }

    protected int m_PickFocusPending;

    protected void FillPicker(string filter)
    {
        if (m_PickFromClasses)
        {
            ZP_ClassIndex.Find(filter, 300, m_PickerItems);
            SetStatus("класів: " + m_PickerItems.Count() + " (не більше 300 з " + ZP_ClassIndex.Total() + ")");
        }
        else
        {
            m_PickerItems.Clear();
            string needle = filter;
            needle.ToLower();
            for (int i = 0; i < m_PickSource.Count(); i++)
            {
                string v = m_PickSource[i];
                if (needle != "")
                {
                    string low = v;
                    low.ToLower();
                    if (low.IndexOf(needle) < 0)
                        continue;
                }
                m_PickerItems.Insert(v);
            }
            SetStatus("варіантів: " + m_PickerItems.Count());
        }
        m_PickerList.ClearItems();
        foreach (string item : m_PickerItems)
        {
            string shown = item;
            if (shown == "")
                shown = "( порожньо — немає вимоги )";
            m_PickerList.AddItem(shown, NULL, 0);
        }
    }

    // Живий пошук: господар переадресовує сюди зміну тексту в полі фільтра.
    bool HandleChange(Widget w)
    {
        if (m_Picker && m_Picker.IsVisible() && w == m_PickerFilter)
        {
            FillPicker(m_PickerFilter.GetText());
            return true;
        }
        return false;
    }

    protected void ClosePicker(bool take)
    {
        if (!m_Picker)
            return;
        if (take)
        {
            bool got = false;
            string value = "";
            int sel = m_PickerList.GetSelectedRow();
            if (sel >= 0 && sel < m_PickerItems.Count())
            {
                value = m_PickerItems[sel];
                got = true;
            }
            else if (m_PickFromClasses)
            {
                // Нічого не обрано, але щось набрано — беремо набране. Це єдиний шлях
                // задати клас із мода, якого зараз немає на стенді, або точний збіг «|1».
                value = m_PickerFilter.GetText();
                got = value != "";
            }
            if (got)
            {
                // ЧИТАЄМО форму ДО підстановки: інакше набране в інших полях зникло б,
                // бо перемальовка бере значення з опису рядків, а не з віджетів.
                m_Form.ReadWidgets();
                ZP_FormRow target = m_Form.FindRow(m_PickArrayKey, m_PickIndex, m_PickKey);
                if (target)
                    target.ValStr = value;
                RenderFromRows();
            }
        }
        m_Picker.Show(false);
    }

    // Перемалювати форму з ОПИСУ рядків (не з робочої копії): потрібно там, де змінилось
    // одне значення, а решту набраного втрачати не можна.
    protected void RenderFromRows()
    {
        for (int i = 0; i < m_Form.m_Rows.Count(); i++)
        {
            if (m_Form.m_Rows[i].W)
                m_Form.m_Rows[i].W.Unlink();
            m_Form.m_Rows[i].W = null;
        }
        m_Form.Render();
    }

    // «+» у заголовку групи і «−» на елементі. Обидві дії міняють ДОВЖИНУ масиву, тож
    // форму треба перебудувати повністю — але спершу забрати з віджетів усе набране.
    protected bool HandleFormButton(Widget w)
    {
        int what;
        ZP_FormRow r = m_Form.RowOf(w, what);
        if (!r)
            return false;

        if (what == 1)
        {
            OpenPicker(r);
            return true;
        }

        SyncFromForm();   // усе набране -> робоча копія
        if (what == 2)
            ArrayAdd(r.ArrayKey);
        else if (what == 3)
            ArrayRemove(r.ArrayKey, r.Index);
        RefreshEditor();
        return true;
    }

    protected void ArrayAdd(string key)
    {
        if (m_Section == ZP_Snap.RULES && m_WorkRule)
        {
            if (key == "Outputs") m_WorkRule.Outputs.Insert(new ZP_RuleOutput());
            else if (key == "Consumables") m_WorkRule.Consumables.Insert(new ZP_RuleConsumable());
            else if (key == "RequiredFactions") m_WorkRule.RequiredFactions.Insert("");
            else if (key == "RequiredTools") m_WorkRule.RequiredTools.Insert("");
            else if (key == "RequiredWorn") m_WorkRule.RequiredWorn.Insert("");
            return;
        }
        if (m_Section == ZP_Snap.NODES && m_WorkNode)
        {
            if (key == "Parents") m_WorkNode.Parents.Insert("");
            else if (key == "Cost") m_WorkNode.Cost.Insert(new ZP_TreeCost());
            else if (key == "ItemCost") m_WorkNode.ItemCost.Insert(new ZP_TreeItemCost());
            else if (key == "RequiredFactions") m_WorkNode.RequiredFactions.Insert("");
            return;
        }
        if (m_Section == ZP_Snap.FACTIONS && m_WorkFaction)
        {
            if (key == "Armbands") m_WorkFaction.Armbands.Insert("");
            else if (key == "TerminalClasses") m_WorkFaction.TerminalClasses.Insert("");
            else if (key == "DeviceClasses") m_WorkFaction.DeviceClasses.Insert("");
            return;
        }
        if (m_Section == ZP_Snap.SETTINGS && m_WorkSettings)
        {
            if (key == "TreeTerminalClasses") m_WorkSettings.TreeTerminalClasses.Insert("");
            return;
        }
        if (m_Section == ZP_Snap.DATAITEMS && m_WorkData)
        {
            if (key == "Points") m_WorkData.Points.Insert(new ZP_DataReward());
            return;
        }
        if (m_Section == ZP_Snap.MODULES && m_WorkModule)
        {
            if (key == "Devices") m_WorkModule.Devices.Insert("");
        }
    }

    protected void ArrayRemove(string key, int index)
    {
        if (index < 0)
            return;
        if (m_Section == ZP_Snap.RULES && m_WorkRule)
        {
            if (key == "Outputs" && index < m_WorkRule.Outputs.Count()) m_WorkRule.Outputs.Remove(index);
            else if (key == "Consumables" && index < m_WorkRule.Consumables.Count()) m_WorkRule.Consumables.Remove(index);
            else if (key == "RequiredFactions" && index < m_WorkRule.RequiredFactions.Count()) m_WorkRule.RequiredFactions.Remove(index);
            else if (key == "RequiredTools" && index < m_WorkRule.RequiredTools.Count()) m_WorkRule.RequiredTools.Remove(index);
            else if (key == "RequiredWorn" && index < m_WorkRule.RequiredWorn.Count()) m_WorkRule.RequiredWorn.Remove(index);
            return;
        }
        if (m_Section == ZP_Snap.NODES && m_WorkNode)
        {
            if (key == "Parents" && index < m_WorkNode.Parents.Count()) m_WorkNode.Parents.Remove(index);
            else if (key == "Cost" && index < m_WorkNode.Cost.Count()) m_WorkNode.Cost.Remove(index);
            else if (key == "ItemCost" && index < m_WorkNode.ItemCost.Count()) m_WorkNode.ItemCost.Remove(index);
            else if (key == "RequiredFactions" && index < m_WorkNode.RequiredFactions.Count()) m_WorkNode.RequiredFactions.Remove(index);
            return;
        }
        if (m_Section == ZP_Snap.FACTIONS && m_WorkFaction)
        {
            if (key == "Armbands" && index < m_WorkFaction.Armbands.Count()) m_WorkFaction.Armbands.Remove(index);
            else if (key == "TerminalClasses" && index < m_WorkFaction.TerminalClasses.Count()) m_WorkFaction.TerminalClasses.Remove(index);
            else if (key == "DeviceClasses" && index < m_WorkFaction.DeviceClasses.Count()) m_WorkFaction.DeviceClasses.Remove(index);
            return;
        }
        if (m_Section == ZP_Snap.SETTINGS && m_WorkSettings)
        {
            if (key == "TreeTerminalClasses" && index < m_WorkSettings.TreeTerminalClasses.Count())
                m_WorkSettings.TreeTerminalClasses.Remove(index);
            return;
        }
        if (m_Section == ZP_Snap.DATAITEMS && m_WorkData)
        {
            if (key == "Points" && index < m_WorkData.Points.Count())
                m_WorkData.Points.Remove(index);
            return;
        }
        if (m_Section == ZP_Snap.MODULES && m_WorkModule)
        {
            if (key == "Devices" && index < m_WorkModule.Devices.Count())
                m_WorkModule.Devices.Remove(index);
        }
    }

    bool HandleClick(Widget w)
    {
        // Поки відкрито перелік класів, він і тільки він приймає кліки: інакше клік по
        // формі під ним поміняв би те, для чого перелік і відкривали.
        if (m_Picker && m_Picker.IsVisible())
        {
            if (w == m_PickerFind)
            {
                FillPicker(m_PickerFilter.GetText());
                return true;
            }
            if (w == m_PickerOk)
            {
                ClosePicker(true);
                return true;
            }
            if (w == m_PickerCancel)
            {
                ClosePicker(false);
                return true;
            }
            return true;
        }

        if (w == m_BtnJson)
        {
            // З форми в JSON переносимо набране, назад — перечитуємо форму з копії:
            // у режимі JSON істина в тексті, і мовчки її загубити не можна.
            if (!m_JsonMode)
                SyncFromForm();
            else
                LoadWorkFromJson();
            m_JsonMode = !m_JsonMode;
            ApplyMode();
            if (!m_JsonMode)
                RefreshEditor();
            return true;
        }

        if (!m_JsonMode && HandleFormButton(w))
            return true;

        if (w == m_BtnSecRules)
        {
            SwitchSection(ZP_Snap.RULES);
            return true;
        }
        if (w == m_BtnSecNodes)
        {
            SwitchSection(ZP_Snap.NODES);
            return true;
        }
        if (w == m_BtnSecTypes)
        {
            SwitchSection(ZP_Snap.POINTTYPES);
            return true;
        }
        if (w == m_BtnSecSettings)
        {
            SwitchSection(ZP_Snap.SETTINGS);
            return true;
        }
        if (w == m_BtnSecFactions)
        {
            SwitchSection(ZP_Snap.FACTIONS);
            return true;
        }
        if (w == m_BtnSecData)
        {
            SwitchSection(ZP_Snap.DATAITEMS);
            return true;
        }
        if (w == m_BtnSecModules)
        {
            SwitchSection(ZP_Snap.MODULES);
            return true;
        }
        if (w == m_BtnNew)
        {
            NewTemplate();
            return true;
        }
        if (w == m_BtnDelete)
        {
            // взведене підтвердження (господар без модалок) — другий клік виконує
            if (m_ConfirmArmed)
            {
                m_ConfirmArmed = false;
                ConfirmDelete();
                return true;
            }
            m_PendingQuestion = AskDelete();   // господар прочитає TakePendingQuestion()
            return true;
        }
        if (w == m_BtnApply)
        {
            ApplyCurrent();
            return true;
        }
        if (w == m_BtnToggle)
        {
            ToggleCurrent();
            return true;
        }
        if (w == m_BtnRefresh)
        {
            RequestSnapshot();
            return true;
        }
        if (w == m_BtnReload)
        {
            SendOp(ZP_Op.RELOAD_ALL, "");
            return true;
        }
        // m_BtnClose навмисно НЕ тут: закриття — справа господаря (див. IsCloseButton)
        return false;
    }

    protected void SwitchSection(int section)
    {
        CancelDelete();   // зміна секції знімає взведене підтвердження
        m_Section = section;
        int nr = 0;
        int nn = 0;
        int nt = 0;
        int nf = 0;
        if (m_SnapRules)
            nr = m_SnapRules.Entries.Count();
        if (m_SnapNodes)
            nn = m_SnapNodes.Entries.Count();
        if (m_SnapTypes)
            nt = m_SnapTypes.PointTypes.Count();
        if (m_SnapFactions)
            nf = m_SnapFactions.Factions.Count();
        ZP_Log.Dbg("editor: секція=" + section + " знімок: правил=" + nr + " вузлів=" + nn + " типів=" + nt + " фракцій=" + nf + " список=" + (m_List != null));
        m_PendingFile = "";
        m_PendingBranch = "";
        m_Edit.SetText("");
        m_Meta.SetText("");
        // Робочі копії чужої секції тут не діють: лишити їх означало б, що «Застосувати»
        // після переходу надішле елемент, якого на екрані вже немає.
        m_WorkRule = null;
        m_WorkNode = null;
        m_WorkType = null;
        m_WorkFaction = null;
        m_WorkSettings = null;
        m_WorkData = null;
        m_WorkModule = null;
        m_SelectedId = "";
        m_Form.Clear();
        if (m_Picker)
            m_Picker.Show(false);
        ApplyMode();
        RebuildList();
    }

    // фаза 2: шаблон нового елемента в редактор; «Застосувати» створить його (upsert за новим Id)
    protected void NewTemplate()
    {
        string pretty;
        string err;
        if (m_Section == ZP_Snap.RULES)
        {
            string targetFile = "";
            int selR = m_List.GetSelectedRow();
            if (m_SnapRules && selR > -1 && selR < m_SnapRules.Entries.Count())
                targetFile = m_SnapRules.Entries[selR].FileName;
            else if (m_SnapRules && m_SnapRules.Entries.Count() > 0)
                targetFile = m_SnapRules.Entries[0].FileName;
            if (targetFile == "")
            {
                SetStatus("немає файлів правил (створення файлів — через диск + Перечитати)");
                return;
            }
            m_PendingFile = targetFile;
            m_PendingBranch = "";
            ZP_Rule tpl = new ZP_Rule();
            tpl.Id = "new_rule";
            tpl.Device = "ZP_PetriDishKit";
            tpl.InputItem.Classname = "Apple";
            tpl.TimeSec = 10;
            tpl.Notes = "шаблон: задайте унікальний Id та поля, потім «Застосувати»";
            m_WorkRule = tpl;
            RefreshEditor();
            m_Meta.SetText("НОВЕ правило -> ProcessingRules\\" + targetFile);
            return;
        }
        if (m_Section == ZP_Snap.NODES)
        {
            string targetBranch = "";
            int selN = m_List.GetSelectedRow();
            if (m_SnapNodes && selN > -1 && selN < m_SnapNodes.Entries.Count())
                targetBranch = m_SnapNodes.Entries[selN].BranchId;
            else if (m_SnapNodes && m_SnapNodes.Entries.Count() > 0)
                targetBranch = m_SnapNodes.Entries[0].BranchId;
            if (targetBranch == "")
            {
                SetStatus("немає гілок дерева (створення гілок — через диск + Перечитати)");
                return;
            }
            m_PendingBranch = targetBranch;
            m_PendingFile = "";
            ZP_TreeNode ntpl = new ZP_TreeNode();
            ntpl.Id = "new_node";
            ntpl.Name = "Новий вузол";
            ntpl.Description = "шаблон: задайте унікальний Id, батьківські вузли та вартість";
            m_WorkNode = ntpl;
            RefreshEditor();
            m_Meta.SetText("НОВИЙ вузол -> гілка " + targetBranch);
            return;
        }
        if (m_Section == ZP_Snap.POINTTYPES)
        {
            ZP_PointType ptpl = new ZP_PointType();
            ptpl.Id = "new_type";
            ptpl.Name = "Новий тип балів";
            m_WorkType = ptpl;
            RefreshEditor();
            m_Meta.SetText("НОВИЙ тип балів (UPSERT_POINTTYPE)");
            return;
        }
        if (m_Section == ZP_Snap.FACTIONS)
        {
            ZP_FactionDef ftpl = new ZP_FactionDef();
            ftpl.Id = "new_faction";
            ftpl.DisplayName = "Нова фракція";
            ftpl.Supertype = "stalker";
            ftpl.Armbands.Insert("Armband_White");
            m_WorkFaction = ftpl;
            RefreshEditor();
            m_Meta.SetText("НОВА фракція: Id стане іменем файлу пулу FactionData\<Id>.json");
            return;
        }
        if (m_Section == ZP_Snap.DATAITEMS)
        {
            SetStatus("нових заготовок не створити: це класи предметів зі збірки (ZP_Data_01..90)");
            return;
        }
        if (m_Section == ZP_Snap.MODULES)
        {
            ZP_ModuleDef mtpl = new ZP_ModuleDef();
            mtpl.Classname = "ZP_Tool_Optics";
            mtpl.PurityBonus = 0.2;
            mtpl.Notes = "новий модуль: оберіть клас вкладення, бонус і прилади, які його приймають";
            m_WorkModule = mtpl;
            m_SelectedId = "";
            RefreshEditor();
            m_Meta.SetText("НОВИЙ модуль -> Modules.json (ключ — клас вкладення)");
            return;
        }
        SetStatus("для налаштувань шаблону немає");
    }

    // Повертає ТЕКСТ ПИТАННЯ або "" — показати діалог і викликати ConfirmDelete/CancelDelete
    // мусить господар: ванільний ShowDialog приймає лише UIScriptedMenu, а всередині VPP
    // такого немає.
    string AskDelete()
    {
        int row = m_List.GetSelectedRow();
        if (m_Section == ZP_Snap.RULES)
        {
            if (!m_SnapRules || row < 0 || row >= m_SnapRules.Entries.Count())
            {
                SetStatus("оберіть правило");
                return "";
            }
            m_PendingDeleteId = m_SnapRules.Entries[row].Rule.Id;
            m_PendingDeleteSection = ZP_Snap.RULES;
            return "Видалити правило '" + m_PendingDeleteId + "'?";
        }
        if (m_Section == ZP_Snap.NODES)
        {
            if (!m_SnapNodes || row < 0 || row >= m_SnapNodes.Entries.Count())
            {
                SetStatus("оберіть вузол");
                return "";
            }
            m_PendingDeleteId = m_SnapNodes.Entries[row].Node.Id;
            m_PendingDeleteSection = ZP_Snap.NODES;
            return "Видалити вузол '" + m_PendingDeleteId + "'? (нащадків доведеться видаляти знизу вгору)";
        }
        if (m_Section == ZP_Snap.FACTIONS)
        {
            if (!m_SnapFactions || row < 0 || row >= m_SnapFactions.Factions.Count())
            {
                SetStatus("оберіть фракцію");
                return "";
            }
            m_PendingDeleteId = m_SnapFactions.Factions[row].Id;
            m_PendingDeleteSection = ZP_Snap.FACTIONS;
            return "Видалити фракцію '" + m_PendingDeleteId + "'? Її пул і прогрес лишаться на диску, а гравці з її нашивкою потраплять у фракцію за замовчуванням.";
        }
        if (m_Section == ZP_Snap.DATAITEMS)
        {
            SetStatus("заготовку не видаляють — зніміть «Увімкнено»: предмети з нею вже можуть бути в гравців");
            return "";
        }
        if (m_Section == ZP_Snap.MODULES)
        {
            if (!m_SnapModules || row < 0 || row >= m_SnapModules.Modules.Count())
            {
                SetStatus("оберіть модуль");
                return "";
            }
            m_PendingDeleteId = m_SnapModules.Modules[row].Classname;
            m_PendingDeleteSection = ZP_Snap.MODULES;
            return "Видалити модуль '" + m_PendingDeleteId + "'? Правила з ним у RequiredTools працюватимуть далі, але бонусу до чистоти він більше не дасть.";
        }
        SetStatus("видалення доступне для правил, вузлів і фракцій (типи балів використовуються в балансах)");
        return "";
    }

    protected void ApplyCurrent()
    {
        // Форма пише в робочу копію, копія — у JsonEdit, і саме його читає цей метод.
        // Один шлях збереження на обидва режими: розходження між побаченим і надісланим
        // тут неможливе за побудовою.
        SyncFromForm();
        int row = m_List.GetSelectedRow();
        string text;
        m_Edit.GetText(text);
        if (text == "")
        {
            SetStatus("редактор порожній — оберіть елемент");
            return;
        }
        string err;
        string payload;
        if (m_Section == ZP_Snap.RULES)
        {
            string targetFile = m_PendingFile;
            if (targetFile == "")
            {
                if (!m_SnapRules || row < 0 || row >= m_SnapRules.Entries.Count())
                {
                    SetStatus("оберіть правило у списку або натисніть «Створити»");
                    return;
                }
                targetFile = m_SnapRules.Entries[row].FileName;
            }
            ZP_Rule rule = new ZP_Rule();
            if (!JsonFileLoader<ZP_Rule>.LoadData(text, rule, err))
            {
                SetStatus("JSON не парситься: " + err);
                return;
            }
            ZP_Op_UpsertRule opR = new ZP_Op_UpsertRule();
            opR.FileName = targetFile;
            opR.RuleData = rule;
            if (!JsonFileLoader<ZP_Op_UpsertRule>.MakeData(opR, payload, err, false))
            {
                SetStatus("серіалізація: " + err);
                return;
            }
            SendOp(ZP_Op.UPSERT_RULE, payload);
            return;
        }
        if (m_Section == ZP_Snap.NODES)
        {
            string targetBranch = m_PendingBranch;
            if (targetBranch == "")
            {
                if (!m_SnapNodes || row < 0 || row >= m_SnapNodes.Entries.Count())
                {
                    SetStatus("оберіть вузол у списку або натисніть «Створити»");
                    return;
                }
                targetBranch = m_SnapNodes.Entries[row].BranchId;
            }
            ZP_TreeNode node = new ZP_TreeNode();
            if (!JsonFileLoader<ZP_TreeNode>.LoadData(text, node, err))
            {
                SetStatus("JSON не парситься: " + err);
                return;
            }
            ZP_Op_UpsertNode opN = new ZP_Op_UpsertNode();
            opN.BranchId = targetBranch;
            opN.NodeData = node;
            if (!JsonFileLoader<ZP_Op_UpsertNode>.MakeData(opN, payload, err, false))
            {
                SetStatus("серіалізація: " + err);
                return;
            }
            SendOp(ZP_Op.UPSERT_NODE, payload);
            return;
        }
        if (m_Section == ZP_Snap.POINTTYPES)
        {
            ZP_PointType pt = new ZP_PointType();
            if (!JsonFileLoader<ZP_PointType>.LoadData(text, pt, err))
            {
                SetStatus("JSON не парситься: " + err);
                return;
            }
            if (!JsonFileLoader<ZP_PointType>.MakeData(pt, payload, err, false))
            {
                SetStatus("серіалізація: " + err);
                return;
            }
            SendOp(ZP_Op.UPSERT_POINTTYPE, payload);
            return;
        }
        if (m_Section == ZP_Snap.FACTIONS)
        {
            ZP_FactionDef fd = new ZP_FactionDef();
            if (!JsonFileLoader<ZP_FactionDef>.LoadData(text, fd, err))
            {
                SetStatus("JSON не парситься: " + err);
                return;
            }
            if (!JsonFileLoader<ZP_FactionDef>.MakeData(fd, payload, err, false))
            {
                SetStatus("серіалізація: " + err);
                return;
            }
            SendOp(ZP_Op.UPSERT_FACTION, payload);
            return;
        }
        if (m_Section == ZP_Snap.DATAITEMS)
        {
            if (!m_WorkData)
            {
                SetStatus("оберіть заготовку у списку");
                return;
            }
            if (!JsonFileLoader<ZP_DataDef>.MakeData(m_WorkData, payload, err, false))
            {
                SetStatus("серіалізація: " + err);
                return;
            }
            SendOp(ZP_Op.UPSERT_DATAITEM, payload);
            return;
        }
        if (m_Section == ZP_Snap.MODULES)
        {
            if (!m_WorkModule)
            {
                SetStatus("оберіть модуль у списку або натисніть «Створити»");
                return;
            }
            if (!JsonFileLoader<ZP_ModuleDef>.MakeData(m_WorkModule, payload, err, false))
            {
                SetStatus("серіалізація: " + err);
                return;
            }
            SendOp(ZP_Op.UPSERT_MODULE, payload);
            return;
        }
        if (m_Section == ZP_Snap.SETTINGS)
        {
            // Налаштування зберігаються НЕ цілим об'єктом: операція приймає «ключ+значення»
            // і кожен ключ перевіряє по-своєму (глибина — діапазон, термінали — існування
            // класів). Тому шлемо по операції на ключ; відмова одного не скасовує решту,
            // і в рядку стану видно саме ту, що не пройшла.
            array<string> keys = new array<string>();
            array<string> vals = new array<string>();
            m_Form.CollectSettings(keys, vals);
            if (keys.Count() == 0)
            {
                SetStatus("немає що зберігати");
                return;
            }
            for (int i = 0; i < keys.Count(); i++)
            {
                ZP_Op_SetSetting ss = new ZP_Op_SetSetting();
                ss.Key = keys[i];
                ss.Value = vals[i];
                if (JsonFileLoader<ZP_Op_SetSetting>.MakeData(ss, payload, err, false))
                    SendOp(ZP_Op.SET_SETTING, payload);
            }
            SetStatus("надіслано налаштувань: " + keys.Count());
            return;
        }
        SetStatus("оберіть розділ");
    }

    protected void ToggleCurrent()
    {
        if (m_Section != ZP_Snap.RULES)
        {
            SetStatus("Увімк/Вимк застосовне лише до правил");
            return;
        }
        int row = m_List.GetSelectedRow();
        if (!m_SnapRules || row < 0 || row >= m_SnapRules.Entries.Count())
        {
            SetStatus("оберіть правило у списку");
            return;
        }
        ZP_SnapRuleEntry re = m_SnapRules.Entries[row];
        // глибока копія: фліп на об'єкті знімка до відповіді сервера розсинхронив би UI
        // у разі відмови операції (рев'ю M6)
        string cloneJson;
        string err;
        if (!JsonFileLoader<ZP_Rule>.MakeData(re.Rule, cloneJson, err, false))
        {
            SetStatus("серіалізація: " + err);
            return;
        }
        ZP_Rule ruleCopy = new ZP_Rule();
        if (!JsonFileLoader<ZP_Rule>.LoadData(cloneJson, ruleCopy, err))
        {
            SetStatus("копія не розпарсилася: " + err);
            return;
        }
        ruleCopy.Enabled = !ruleCopy.Enabled;
        ZP_Op_UpsertRule op = new ZP_Op_UpsertRule();
        op.FileName = re.FileName;
        op.RuleData = ruleCopy;
        string payload;
        if (!JsonFileLoader<ZP_Op_UpsertRule>.MakeData(op, payload, err, false))
        {
            SetStatus("серіалізація: " + err);
            return;
        }
        SendOp(ZP_Op.UPSERT_RULE, payload);
    }

    protected void SendOp(int opType, string payload)
    {
        GetRPCManager().SendRPC(ZP_Const.MOD, ZP_Const.RPC_ADMIN_OP, new Param2<int, string>(opType, payload), true, NULL);
        SetStatus("операцію надіслано...");
    }

    protected void SetStatus(string text)
    {
        if (m_Status)
            m_Status.SetText(text);
    }
}

#endif
