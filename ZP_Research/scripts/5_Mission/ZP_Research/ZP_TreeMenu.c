// M4: дерево досліджень для гравців. Нативний UIScriptedMenu: вузли — інстанси
// zp_tree_node.layout у контейнері зі скролом, лінії батько→нащадок — CanvasWidget
// (Clear+redraw щокадру, §7 gui-layouts). Дані: структура дерева з ZP_ClientConfig
// (M4-синк), статуси/проєкти/пул — з пофракційного RPC_ZP_SyncTree. Сервер авторитетний:
// кнопка «Дослідити» надсилає RPC_ZP_Research, усі гейти — у ZP_ResearchFlow.
#ifndef NO_GUI

class ZP_TreeMenuBridge
{
    static ref ZP_TreeMenuBridge s_Instance;

    ref ZP_TreeMenu m_Menu;

    static ZP_TreeMenuBridge Get()
    {
        if (!s_Instance)
            s_Instance = new ZP_TreeMenuBridge();
        return s_Instance;
    }

    static void Reset()
    {
        s_Instance = null;
    }

    void RegisterRPCs()
    {
        GetRPCManager().AddRPC(ZP_Const.MOD, ZP_Const.RPC_OPEN_TREE, this, SingleplayerExecutionType.Client);
    }

    void RPC_ZP_OpenTree(CallType type, ParamsReadContext ctx, PlayerIdentity sender, Object target)
    {
        if (type != CallType.Client)
            return;
        // ВІДКЛАДАЄМО НА КАДР. Причина знайдена живим тестом: якщо команду набрано в чаті,
        // у мить приходу RPC ванільне вікно вводу чату (MENU_CHAT_INPUT=17) ще володіє
        // стеком меню, і EnterScriptedMenu мовчки віддає NULL — відкрити щось поверх
        // чужого меню рушій не дає. Через дію F чат не задіяний і все працювало завжди;
        // саме тому «раніше працювало, а тепер ні» — змінився шлях виклику, не вікно.
        GetGame().GetCallQueue(CALL_CATEGORY_GUI).CallLater(ZP_OpenDeferred, 100, false);
    }

    void ZP_OpenDeferred()
    {
        if (GetGame().GetUIManager().FindMenu(ZP_Const.MENU_TREE))
            return;
        // Штатний шлях: сам кличе Mission.CreateScriptedMenu, Init(), OnShow() і кладе
        // вікно у стек меню — звідти працюють курсор, фокус і Close.
        m_Menu = ZP_TreeMenu.Cast(GetGame().GetUIManager().EnterScriptedMenu(ZP_Const.MENU_TREE, NULL));
        if (m_Menu)
            return;
        // Запасний шлях, якщо стек усе одно зайнятий: будуємо вікно самі (як ваніль із
        // LoginQueueStatic, dayzgame.c:203-210) і ВРУЧНУ робимо те, що зробив би Enter.
        ZP_Log.Warn("дерево: EnterScriptedMenu віддав NULL — відкриваю запасним шляхом");
        ZP_TreeMenu menu = new ZP_TreeMenu();
        menu.SetID(ZP_Const.MENU_TREE);
        if (!menu.Init())
        {
            ZP_Log.Err("вікно дерева: Init() не побудував розмітку");
            return;
        }
        m_Menu = menu;
        GetGame().GetUIManager().ShowScriptedMenu(menu, NULL);
        menu.OnShow();
    }
}

class ZP_TreeMenu extends UIScriptedMenu
{
    static const int COLOR_COMPLETED   = 0xFF2E7D32;
    static const int COLOR_AVAILABLE   = 0xFFA08220;
    static const int COLOR_RESEARCHING = 0xFF1976D2;
    static const int COLOR_LOCKED      = 0xFF46464B;
    static const int COLOR_LINE        = 0xFF808080;
    // ширина TreeContent, як вона оголошена в zp_tree.layout (`size 700 2000`)
    static const float TREECONTENT_UNITS = 700.0;

    int m_SeenTreeCounter = -1;
    int m_SeenOpCounter = -1;
    int m_SeenConfigRevision = -1;
    ZP_ClientConfig m_SeenConfig;   // рев'ю M6: дубль-синк з тією ж ревізією замінює об'єкт —
                                    // ловимо заміну за посиланням, інакше m_ShownNodes тримає мертві об'єкти
    int m_SelectedIdx = -1;

    ref array<ref ZP_ClientBranch> m_SortedBranches = new array<ref ZP_ClientBranch>();
    ref array<ZP_ClientNode> m_ShownNodes = new array<ZP_ClientNode>();
    ref array<Widget> m_NodeWidgets = new array<Widget>();
    ref array<float> m_NodeX = new array<float>();
    ref array<float> m_NodeY = new array<float>();
    ref array<float> m_NodeH = new array<float>();

    Widget m_TreeContent;
    CanvasWidget m_Canvas;
    TextWidget m_PoolLine;
    TextWidget m_NodeNameW;
    ref array<TextWidget> m_DescLines = new array<TextWidget>();
    ref array<TextWidget> m_PointLines = new array<TextWidget>();
    MultilineTextWidget m_NodeCostW;
    TextWidget m_NodeStatusW;
    TextWidget m_Status;
    TextWidget m_Legend;
    ref map<string, int> m_Depth = new map<string, int>();      // вузол -> рівень від кореня
    ref map<string, bool> m_Visible = new map<string, bool>();  // вузол -> показувати
    ButtonWidget m_BtnResearch;
    ButtonWidget m_BtnClose;
    // Коефіцієнти переводу «реальні пікселі -> одиниці Set*-методів» (див. Calibrate)
    float m_SizeK = 1.0;
    float m_PosK = 1.0;
    float m_PosB = 0.0;
    float m_PosBY = 0.0;
    // Екранних пікселів на ОДИНИЦЮ .layout. Заміряно: TreeContent оголошений 700x2000,
    // а GetScreenSize віддає 1037x2963 -> 1.481. Set*/Get* між собою узгоджені (DBG:
    // просили 260x104, отримали 260x104), а от GetTextSize міряє в одиницях layout —
    // саме тому текст виходив за картку рівно в 1.48 раза.
    float m_TextK = 1.0;

    override Widget Init()
    {
        layoutRoot = GetGame().GetWorkspace().CreateWidgets("ZP_Research/gui/layouts/zp_tree.layout");
        if (!layoutRoot)
        {
            ZP_Log.Err("zp_tree.layout не завантажився (шлях/пак?)");
            return null;
        }
        m_TreeContent = layoutRoot.FindAnyWidget("TreeContent");
        m_Canvas = CanvasWidget.Cast(layoutRoot.FindAnyWidget("TreeCanvas"));
        m_PoolLine = TextWidget.Cast(layoutRoot.FindAnyWidget("PoolLine"));
        m_NodeNameW = TextWidget.Cast(layoutRoot.FindAnyWidget("NodeName"));
        for (int dl = 0; dl < 7; dl++)
        {
            TextWidget dw = TextWidget.Cast(layoutRoot.FindAnyWidget("NodeDesc" + dl));
            if (dw)
                m_DescLines.Insert(dw);
        }
        for (int pl = 0; pl < 24; pl++)
        {
            TextWidget pw = TextWidget.Cast(layoutRoot.FindAnyWidget("PointLine" + pl));
            if (pw)
                m_PointLines.Insert(pw);
        }
        m_NodeCostW = MultilineTextWidget.Cast(layoutRoot.FindAnyWidget("NodeCost"));
        EnableWrap(m_NodeCostW);
        m_NodeStatusW = TextWidget.Cast(layoutRoot.FindAnyWidget("NodeStatus"));
        m_Status = TextWidget.Cast(layoutRoot.FindAnyWidget("StatusLine"));
        m_BtnResearch = ButtonWidget.Cast(layoutRoot.FindAnyWidget("BtnResearch"));
        m_BtnClose = ButtonWidget.Cast(layoutRoot.FindAnyWidget("BtnClose"));
        m_Legend = TextWidget.Cast(layoutRoot.FindAnyWidget("LegendLine"));
        layoutRoot.Update();   // перерахунок екранних прямокутників (ванільний mapmenu.c:72)
        return layoutRoot;
    }

    override void OnShow()
    {
        super.OnShow();
        // база має ранній вихід у LockControls — курсор і блокування ставимо явно,
        // як це роблять ванільні меню й перевірені моди модпаку
        GetGame().GetUIManager().ShowUICursor(true);
        GetGame().GetMission().AddActiveInputExcludes({"menu"});
        GetGame().GetMission().AddActiveInputRestriction(EInputRestrictors.INVENTORY);
        if (GetGame().GetMission().GetHud())
            GetGame().GetMission().GetHud().Show(false);
        SetFocus(layoutRoot);
        RefreshAll();
    }

    // Закриття, що працює обома шляхами відкриття: Close() діє лише для вікна у стеку
    // меню (ванільний Enter), а показане через ShowScriptedMenu треба ховати явно.
    void ZP_CloseSelf()
    {
        if (GetGame().GetUIManager().FindMenu(ZP_Const.MENU_TREE))
        {
            Close();
            return;
        }
        OnHide();
        GetGame().GetUIManager().HideScriptedMenu(this);
    }

    override void OnHide()
    {
        super.OnHide();
        GetGame().GetUIManager().ShowUICursor(false);
        GetGame().GetMission().RemoveActiveInputExcludes({"menu"}, true);
        GetGame().GetMission().RemoveActiveInputRestriction(EInputRestrictors.INVENTORY);
        if (GetGame().GetMission().GetHud())
            GetGame().GetMission().GetHud().Show(true);
        if (ZP_TreeMenuBridge.s_Instance)
            ZP_TreeMenuBridge.s_Instance.m_Menu = null;
    }

    override void Update(float timeslice)
    {
        super.Update(timeslice);
        if (GetUApi().GetInputByID(UAUIBack).LocalPress())
        {
            Close();
            return;
        }
        ZP_ClientState st = ZP_ClientState.Get();
        bool needRefresh = false;
        if (st.m_TreeCounter != m_SeenTreeCounter)
        {
            m_SeenTreeCounter = st.m_TreeCounter;
            needRefresh = true;
        }
        if (st.m_Config && (st.m_Config.Revision != m_SeenConfigRevision || st.m_Config != m_SeenConfig))
        {
            m_SeenConfigRevision = st.m_Config.Revision;
            m_SeenConfig = st.m_Config;
            needRefresh = true;
        }
        if (needRefresh)
            RefreshAll();
        if (st.m_LastOpCounter != m_SeenOpCounter)
        {
            m_SeenOpCounter = st.m_LastOpCounter;
            if (st.m_LastOpResult != "")
            {
                string pfx = "";
                if (!st.m_LastOpOk)
                    pfx = "ПОМИЛКА: ";
                SetStatus(pfx + st.m_LastOpResult);
            }
        }
        DrawLines();
    }

    protected void RefreshAll()
    {
        BuildBranchList();
        RebuildTree();
        UpdatePoolLine();
        UpdatePointsColumn();
        UpdateDetail();
    }

    protected void BuildBranchList()
    {
        m_SortedBranches.Clear();
        ZP_ClientConfig cfg = ZP_ClientState.Get().m_Config;
        if (!cfg)
            return;
        foreach (ZP_ClientBranch b : cfg.Branches)
        {
            m_SortedBranches.Insert(b);
        }
        // сортування за SortOrder (бульбашкою — гілок одиниці)
        for (int i = 0; i < m_SortedBranches.Count(); i++)
        {
            for (int j = 0; j < m_SortedBranches.Count() - 1 - i; j++)
            {
                if (m_SortedBranches[j].SortOrder > m_SortedBranches[j + 1].SortOrder)
                {
                    ZP_ClientBranch tmp = m_SortedBranches[j];
                    m_SortedBranches[j] = m_SortedBranches[j + 1];
                    m_SortedBranches[j + 1] = tmp;
                }
            }
        }
    }

    // Глибина вузла = найдовший шлях від кореня (вузол без батьків = 0). Фікспойнт,
    // бо порядок вузлів у конфігу довільний, а батьки можуть бути з іншої гілки.
    protected void ComputeDepths(ZP_ClientConfig cfg)
    {
        m_Depth.Clear();
        foreach (ZP_ClientNode n0 : cfg.Nodes)
        {
            if (n0.Parents.Count() == 0)
                m_Depth.Set(n0.Id, 0);
        }
        bool changed = true;
        int guard = 0;
        while (changed && guard < 64)
        {
            changed = false;
            guard++;
            foreach (ZP_ClientNode n : cfg.Nodes)
            {
                if (n.Parents.Count() == 0)
                    continue;
                int best = -1;
                foreach (string par : n.Parents)
                {
                    int pd = -1;
                    if (!m_Depth.Find(par, pd))
                        continue;
                    if (pd > best)
                        best = pd;
                }
                if (best < 0)
                    continue;   // жоден батько ще не порахований (або батьків немає в дереві)
                int cur = -1;
                bool has = m_Depth.Find(n.Id, cur);
                if (!has || cur != best + 1)
                {
                    m_Depth.Set(n.Id, best + 1);
                    changed = true;
                }
            }
        }
        // вузли з битими батьками все одно показуємо — інакше вони зникнуть безслідно
        foreach (ZP_ClientNode n2 : cfg.Nodes)
        {
            if (!m_Depth.Contains(n2.Id))
                m_Depth.Set(n2.Id, 0);
        }
    }

    // Видимість: усе досліджене/доступне видно завжди, а далі — ще N рівнів «туману»
    // (Settings.TreeVisibilityDepth, типово 1: бачиш, що можна взяти, і куди це веде).
    protected void ComputeVisibility(ZP_ClientConfig cfg, ZP_ClientState st)
    {
        m_Visible.Clear();
        int depthLimit = cfg.TreeVisibilityDepth;
        if (depthLimit < 0)
            depthLimit = 0;
        ref array<string> frontier = new array<string>();
        foreach (ZP_ClientNode n : cfg.Nodes)
        {
            string status = st.GetNodeStatusClient(n);
            if (status != "locked")
            {
                m_Visible.Set(n.Id, true);
                frontier.Insert(n.Id);
            }
        }
        for (int step = 0; step < depthLimit; step++)
        {
            ref array<string> next = new array<string>();
            foreach (ZP_ClientNode child : cfg.Nodes)
            {
                if (m_Visible.Contains(child.Id))
                    continue;
                foreach (string p : child.Parents)
                {
                    if (frontier.Find(p) > -1)
                    {
                        m_Visible.Set(child.Id, true);
                        next.Insert(child.Id);
                        break;
                    }
                }
            }
            frontier = next;
            if (frontier.Count() == 0)
                break;
        }
    }

    // Один пробний віджет — і ми знаємо, як Set*-методи трактують свої аргументи.
    // Живий замір показав: SetScreenSize(260, 92) дає віджет 385x136 на екрані, тобто
    // Set* приймає НЕмасштабовані одиниці, а Get* повертає справжні пікселі. Зашивати
    // 1.48 не можна (залежить від роздільної здатності й UI scale гравця), тому міряємо
    // двома точками — так знаходимо і масштаб, і можливе зміщення.
    protected void Calibrate()
    {
        m_SizeK = 1.0;
        m_PosK = 1.0;
        m_PosB = 0.0;
        m_PosBY = 0.0;
        m_TextK = 1.0;
        if (!m_TreeContent)
            return;
        Widget probe = GetGame().GetWorkspace().CreateWidgets("ZP_Research/gui/layouts/zp_tree_node.layout", m_TreeContent);
        if (!probe)
            return;
        float w1, h1, w2, h2, x1, y1, x2, y2;
        // Update() після кожного Set — інакше Get віддасть розмір із .layout, обидва
        // заміри збіжаться і калібрування тихо виродиться в 1.0 (ванільний mapmenu.c:72)
        probe.SetScreenSize(200, 100);
        probe.Update();
        probe.GetScreenSize(w1, h1);
        probe.SetScreenSize(400, 100);
        probe.Update();
        probe.GetScreenSize(w2, h2);
        if (w1 > 1 && w2 > w1)
            m_SizeK = (w2 - w1) / 200;

        probe.SetScreenPos(100, 100);
        probe.Update();
        probe.GetScreenPos(x1, y1);
        probe.SetScreenPos(300, 100);
        probe.Update();
        probe.GetScreenPos(x2, y2);
        if (x2 > x1)
        {
            m_PosK = (x2 - x1) / 200;
            // зміщення рахуємо ОКРЕМО по осях: якщо Set* виявиться відносним до
            // батька, offset дорівнює екранній позиції контейнера, а вона по X і Y різна
            m_PosB = x1 - m_PosK * 100;
            m_PosBY = y1 - m_PosK * 100;
        }
        probe.Unlink();

        // Масштаб «одиниця layout -> піксель екрана». Рахуємо від ОГОЛОШЕНОЇ ширини
        // TreeContent у zp_tree.layout (TREECONTENT_UNITS): міряний варіант через GetSize
        // не працює — для віджета з hexactsize 1 GetSize повертає те саме, що GetScreenSize,
        // і коефіцієнт вироджувався в 1.0. Живий замір: 700 одиниць -> 1037 пікселів.
        // МІНЯЄШ size у TreeContent — міняй і константу.
        // m_TextK == 1: GetTextSize ВІДДАЄ ЕКРАННІ ПІКСЕЛІ, як і документовано
        // (enwidgets.c:209). Раніше тут стояв масштаб інтерфейсу (1.48), і причина була не
        // в одиницях, а у ВІДСУТНЬОМУ Update() між SetText і заміром: віджет віддавав
        // розмір ПОПЕРЕДНЬОГО тексту, заміри «плавали», і множник маскував це. Update()
        // додано — множник став зайвим і почав різати те, що вміщується: «лабораторні T1: 5»
        // міряло 258 проти боксу 255, тобто на волосок, і хвіст зникав без потреби.
        m_TextK = 1.0;

        // захист від безглуздих замірів (віджет ще не розкладено тощо)
        if (m_SizeK < 0.2 || m_SizeK > 6)
            m_SizeK = 1.0;
        if (m_PosK < 0.2 || m_PosK > 6)
        {
            m_PosK = 1.0;
            m_PosB = 0.0;
            m_PosBY = 0.0;
        }
    }

    // Задати позицію/розмір у РЕАЛЬНИХ пікселях екрана, чого Set* напряму не вміє.
    protected void SetPosPx(Widget w, float x, float y)
    {
        if (w)
            w.SetScreenPos((x - m_PosB) / m_PosK, (y - m_PosBY) / m_PosK);
    }

    protected void SetSizePx(Widget w, float sw, float sh)
    {
        if (w)
            w.SetScreenSize(sw / m_SizeK, sh / m_SizeK);
    }

    // Переносить назву вузла у два рядки так, щоб ОБИДВА влізли у ширину availPx.
    // Міряємо через GetTextSize (документовано: пікселі, enwidgets.c:209). Якщо віджет
    // ще не розкладений і міряти нічим — оцінка по символах від ширини картки.
    protected void WrapName(TextWidget probe, string src, float availPx, out string ln1, out string ln2)
    {
        ln1 = src;
        ln2 = "";
        if (src == "" || availPx < 20)
            return;
        if (MeasurePx(probe, src) <= availPx)
            return;

        TStringArray words = new TStringArray();
        src.Split(" ", words);
        if (words.Count() < 2)
        {
            ln1 = Ellipsize(probe, src, availPx);
            return;
        }
        // жадібно набираємо перший рядок, решта — у другий
        string cur = "";
        int wi = 0;
        for (wi = 0; wi < words.Count(); wi++)
        {
            string probeStr = cur;
            if (probeStr != "")
                probeStr = probeStr + " ";
            probeStr = probeStr + words[wi];
            if (cur != "" && MeasurePx(probe, probeStr) > availPx)
                break;
            cur = probeStr;
        }
        ln1 = Ellipsize(probe, cur, availPx);   // одне довжелезне слово теж треба вкоротити
        string rest = "";
        for (int wj = wi; wj < words.Count(); wj++)
        {
            if (rest != "")
                rest = rest + " ";
            rest = rest + words[wj];
        }
        ln2 = Ellipsize(probe, rest, availPx);
    }

    // Ширина тексту в тих самих одиницях, що й cardWpx (реальні пікселі екрана).
    // GetTextSize міряє в НЕмасштабованих одиницях — тих самих, які приймають Set*-методи,
    // а на екрані рушій множить усе на UI scale. Без множення на m_SizeK замір давав
    // ~1.5x заниження, і текст рівно на стільки вилазив за картку.
    protected float MeasurePx(TextWidget probe, string s)
    {
        if (!probe)
            return EstimatePx(s);
        int tw, th;
        probe.SetText(s);
        // Update() ОБОВ'ЯЗКОВИЙ між SetText і GetTextSize: без нього замір повертає розмір
        // ПОПЕРЕДНЬОГО тексту, бо розкладку віджета ще не перераховано. Наслідок було видно
        // як «підписи вузлів обрізаються сильніше з кожною перемальовкою»: кожен вимір
        // відставав на один рядок, і різалось за чужою шириною. Величини розкладки при цьому
        // не рухались зовсім (contSW і коефіцієнти однакові в обох проходах) — тобто шукати
        // причину в них було марно.
        probe.Update();
        probe.GetTextSize(tw, th);
        if (tw <= 0)
            return EstimatePx(s);
        return tw * m_TextK;   // m_TextK див. Calibrate: після Update() він дорівнює 1
    }

    // Запасна оцінка: кегль 12 одиниць layout, середня ширина гліфа ≈ 0.62 кегля
    protected float EstimatePx(string s)
    {
        return s.Length() * 12 * 0.62 * m_TextK;
    }

    protected string Ellipsize(TextWidget probe, string s, float availPx)
    {
        // спершу перевіряємо сам рядок: інакше «...» додало б ширини і різало б те,
        // що насправді вміщується
        if (s == "" || MeasurePx(probe, s) <= availPx)
            return s;
        string cut = s;
        int guard = 0;
        while (cut.Length() > 4 && guard < 64 && MeasurePx(probe, cut + "...") > availPx)
        {
            guard++;
            cut = cut.Substring(0, cut.Length() - 1);
        }
        return cut + "...";
    }

    protected void RebuildTree()
    {
        foreach (Widget old : m_NodeWidgets)
        {
            if (old)
                old.Unlink();
        }
        m_NodeWidgets.Clear();
        m_ShownNodes.Clear();
        m_NodeX.Clear();
        m_NodeY.Clear();
        m_NodeH.Clear();
        m_SelectedIdx = -1;

        ZP_ClientState st = ZP_ClientState.Get();
        ZP_ClientConfig cfg = st.m_Config;
        if (!cfg)
            return;

        ComputeDepths(cfg);
        ComputeVisibility(cfg, st);

        // фонова картинка дерева (Settings.TreeBackgroundImage; порожньо = просто темний фон)
        ImageWidget bgImg = ImageWidget.Cast(layoutRoot.FindAnyWidget("TreeBgImage"));
        if (bgImg)
        {
            if (cfg.TreeBackgroundImage != "")
            {
                bgImg.LoadImageFile(0, cfg.TreeBackgroundImage);
                // ПРИГЛУШИТИ ЦЮ КАРТИНКУ НЕ ВДАЛОСЯ. Перевірено три шляхи, жоден не діє:
                // `color` у розмітці, SetColor після LoadImageFile і SetAlpha. Тло лишається
                // таким, яким його дав адмін, тож вибирати треба спокійне зображення —
                // читабельність підписів тримається на непрозорих картках вузлів, а не на тлі.
                bgImg.Show(true);
            }
            else
            {
                bgImg.Show(false);
            }
        }

        // ОДНЕ спільне дерево: колонка = глибина від кореня, рядок = порядок у колонці.
        // Гілки конфігу тут не розділяють дерево — вони лише групують вузли у файлах.
        // 1) розкладка рахується наперед: скільки вузлів на кожному рівні і яка ширина
        //    кожного — щоб рівні можна було ВІДЦЕНТРУВАТИ, а вузли не злипалися
        ref map<int, int> levelCount = new map<int, int>();
        ref array<ZP_ClientNode> visNodes = new array<ZP_ClientNode>();
        int hidden = 0;
        foreach (ZP_ClientNode nv : cfg.Nodes)
        {
            if (!m_Visible.Contains(nv.Id))
            {
                hidden++;
                continue;
            }
            visNodes.Insert(nv);
            int dv = 0;
            m_Depth.Find(nv.Id, dv);
            int cv = 0;
            levelCount.Find(dv, cv);
            levelCount.Set(dv, cv + 1);
        }

        // РОЗКЛАДКА В ЕКРАННИХ ПІКСЕЛЯХ: SetPos/SetSize у layout-одиницях дають
        // непередбачуваний крок (перевірено живим тестом), тому працюємо через
        // GetScreenSize/SetScreenPos/SetScreenSize — це реальні пікселі екрана.
        float contPX, contPY, contSW, contSH;
        m_TreeContent.GetScreenPos(contPX, contPY);
        m_TreeContent.GetScreenSize(contSW, contSH);
        if (contSW < 100)
            contSW = 900;
        int maxPerRow = 1;
        foreach (int lvlCnt : levelCount)
        {
            if (lvlCnt > maxPerRow)
                maxPerRow = lvlCnt;
        }
        // КАЛІБРУВАННЯ. Set*-методи приймають НЕ ті самі одиниці, що повертають Get*:
        // живий замір показав картку 385x136 після SetScreenSize(260, 92) — рівно та
        // причина, чому вузли злипалися й текст вилазив (реальна картка ширша за слот,
        // на який ми її рахували). Замість того щоб зашивати 1.48, міряємо коефіцієнт
        // на місці: працює на будь-якій роздільній здатності й будь-якому UI scale.
        Calibrate();

        // РОЗМІР КАРТКИ ЙДЕ ВІД ВМІСТУ, А НЕ ВІД ФІКСОВАНИХ ЧИСЕЛ.
        //
        // Ширину задають дві вимоги, і перемагає менша: вмістити найдовше СЛОВО назви
        // (переносити всередині слова нікуди) і влізти в свій слот поруч із сусідами.
        // Раніше ширина була просто часткою слота зі стелею 300 — і будь-яка назва, довша
        // за неї, різалась: «Мутагенні сполуки» ставало «Мутагенн сполуки».
        float slotW = contSW / maxPerRow;
        float probeW = LongestWordPx(visNodes);          // скільки треба текстовій колонці
        float wantW = probeW / TEXT_COL + 12 * m_SizeK;  // + поля; решта картки — ніша під іконку
        float cardWpx = slotW * 0.86;
        if (wantW < cardWpx)
            cardWpx = wantW;                             // назви короткі — картку не роздуваємо
        if (cardWpx < 120 * m_SizeK)
            cardWpx = 120 * m_SizeK;                     // нижче вже нечитабельно
        float gapPx = slotW - cardWpx;

        // ВИСОТА — ЗА КІЛЬКІСТЮ РЯДКІВ, які займе найдовша назва в цій ширині. Рахуємо
        // ділянням виміряної довжини на ширину колонки: рушій переносить сам, нам треба
        // лише дати картці стільки місця, скільки він попросить.
        float lineH = 17 * m_SizeK;
        int maxLines = NameLines(visNodes, cardWpx * TEXT_COL, lineH);
        float cardHpx = 40 * m_SizeK + maxLines * lineH;
        if (cardHpx < 80 * m_SizeK)
            cardHpx = 80 * m_SizeK;
        // Квадратність ніші під іконку: надто висока картка при вузькій ширині розтягує її
        // в смужку, тому висоту обмежуємо шириною.
        if (cardHpx > cardWpx * 0.75)
            cardHpx = cardWpx * 0.75;
        float rowStepY = cardHpx + 62 * m_SizeK;

        // ВЕРТИКАЛЬ ТЕЖ АДАПТИВНА: дерево мусить уміщатись у видиму частину полотна.
        // Вузли розставляються в ЕКРАННИХ координатах, тому прокрутка полотна їх не
        // рухала б — замість неї стискаємо крок і картку, поки останній рівень не влізе.
        // Раніше нижній ряд («Протокол Зони») просто йшов за нижній край без жодної ознаки,
        // що там ще щось є.
        int levels = levelCount.Count();
        if (levels > 0)
        {
            // Міряємо ВИДИМУ частину (прокрутку), а не полотно: полотно оголошене на 2000
            // одиниць і завжди більше за потребу, тож обмеження за ним не спрацьовувало
            // жодного разу — саме тому нижній ряд і далі йшов за край.
            float viewH = contSH;
            Widget scroll = m_TreeContent.GetParent();
            if (scroll)
            {
                float vw;
                float vh;
                scroll.GetScreenSize(vw, vh);
                if (vh > 1)
                    viewH = vh;
            }
            float needH = 24 * m_SizeK + levels * rowStepY;
            if (needH > viewH && viewH > 0)
            {
                float k = (viewH - 28 * m_SizeK) / (levels * rowStepY);
                if (k < 0.55)
                    k = 0.55;          // нижче картка стає нечитабельною смужкою
                rowStepY = rowStepY * k;
                cardHpx = cardHpx * k;
                if (cardHpx < 54 * m_SizeK)
                    cardHpx = 54 * m_SizeK;
            }
        }
        ref map<int, int> depthRows = new map<int, int>();
        int shown = 0;
        foreach (ZP_ClientNode n3 : visNodes)
        {
            int d = 0;
            m_Depth.Find(n3.Id, d);
            int row = 0;
            depthRows.Find(d, row);
            depthRows.Set(d, row + 1);

            // 2) центрування рівня в екранних пікселях
            int cnt = 1;
            levelCount.Find(d, cnt);
            float rowW = cnt * cardWpx + (cnt - 1) * gapPx;
            float startX = (contSW - rowW) / 2;
            if (startX < 8 * m_SizeK)
                startX = 8 * m_SizeK;
            float px = startX + row * (cardWpx + gapPx);
            float py = 24 * m_SizeK + d * rowStepY;

            Widget nodeWdg = GetGame().GetWorkspace().CreateWidgets("ZP_Research/gui/layouts/zp_tree_node.layout", m_TreeContent);
            if (!nodeWdg)
            {
                ZP_Log.Err("zp_tree_node.layout не завантажився");
                return;
            }
            SetPosPx(nodeWdg, contPX + px, contPY + py);
            SetSizePx(nodeWdg, cardWpx, cardHpx);
            MultilineTextWidget nameW = MultilineTextWidget.Cast(nodeWdg.FindAnyWidget("NodeName"));
            TextWidget subW = TextWidget.Cast(nodeWdg.FindAnyWidget("NodeSub"));
            string status2 = st.GetNodeStatusClient(n3);
            // Назву більше не ріжемо й не ділимо руками: перенос робить рушій, а картці
            // вище вже дано стільки висоти, скільки він попросить.
            if (nameW)
            {
                EnableWrap(nameW);
                nameW.SetText(n3.Name);
            }
            // Статус НЕ обрізаємо: словник із чотирьох коротких слів, і будь-яке з них
            // вужче за колонку. Зайва підгонка тут лише з'їдала останню літеру
            // («дослідже» замість «досліджено»).
            if (subW)
                subW.SetText(StatusText(status2, n3.Id));
            ImageWidget iconW = ImageWidget.Cast(nodeWdg.FindAnyWidget("NodeIcon"));
            if (iconW)
            {
                if (n3.Icon != "")
                {
                    iconW.LoadImageFile(0, n3.Icon);
                    iconW.Show(true);
                }
                else
                {
                    iconW.Show(false);
                }
            }
            ButtonWidget nodeBtn = ButtonWidget.Cast(nodeWdg);
            if (nodeBtn)
                nodeBtn.SetColor(StatusColor(status2));   // рамка забарвлена за статусом

            m_ShownNodes.Insert(n3);
            m_NodeWidgets.Insert(nodeWdg);
            m_NodeX.Insert(px + cardWpx / 2);   // центр вузла — щоб лінії йшли рівно
            m_NodeY.Insert(py);
            m_NodeH.Insert(cardHpx);
            shown++;
        }
        if (m_Legend)
            m_Legend.SetText("зелений — досліджено · жовтий — доступно · синій — у роботі · сірий — закрито");
    }

    // Частка ширини картки, віддана під текст (решта — ніша з іконкою зліва). Мусить
    // збігатися з розміткою zp_tree_node.layout: рахувати від ПОВНОЇ ширини не можна.
    static const float TEXT_COL = 0.62;

    // Найдовше СЛОВО серед назв, у пікселях. Саме воно задає нижню межу ширини картки:
    // усередині слова рушій не переносить, тож вужча колонка обріже його в будь-якому разі.
    protected float LongestWordPx(array<ZP_ClientNode> nodes)
    {
        float best = 0;
        TextWidget probe = m_NodeCostW;   // будь-який живий текстовий віджет як лінійка
        foreach (ZP_ClientNode n : nodes)
        {
            array<string> words = new array<string>();
            n.Name.Split(" ", words);
            foreach (string w : words)
            {
                float wpx = MeasurePx(probe, w);
                if (wpx > best)
                    best = wpx;
            }
        }
        return best;
    }

    // Скільки рядків займе найдовша назва в колонці такої ширини. Точного переносу рушія
    // ми не знаємо, тож рахуємо за довжиною й додаємо один рядок запасу на розрив по слову:
    // зайвий порожній рядок у картці не шкодить, а обрізана назва — шкодить.
    protected int NameLines(array<ZP_ClientNode> nodes, float colW, float lineH)
    {
        if (colW < 1)
            return 2;
        int best = 1;
        TextWidget probe = m_NodeCostW;
        foreach (ZP_ClientNode n : nodes)
        {
            float total = MeasurePx(probe, n.Name);
            int lines = Math.Ceil(total / colW);
            if (total > colW)
                lines++;                  // запас на перенос по межі слова
            if (lines > best)
                best = lines;
        }
        if (best > 4)
            best = 4;                     // далі картка перетворюється на стовп
        return best;
    }

    // Перенос рядків потребує ДВОХ речей, і без будь-якої з них віджет лишається
    // однорядковим: ключа `wrap 1` у РОЗМІТЦІ й режиму розриву з КОДУ
    // (SetLineBreakingOverride, enwidgets.c:221; ваніла: mainmenupromo.c:61).
    // Попереднє твердження «вмикається єдиним методом» було НЕПОВНИМ і коштувало ітерації:
    // назва вузла обрізалась на одному рядку при цілком правильному виклику з коду.
    // SetLine тут НЕ існує (він лише у MultilineEditBoxWidget), а escape-послідовності
    // в літералах ламали парсер — обидва шляхи перевірені й відкинуті.
    static void EnableWrap(MultilineTextWidget target)
    {
        if (target)
            target.SetLineBreakingOverride(LinebreakOverrideMode.LINEBREAK_WESTERN);
    }

    // Підганяє текст під РЕАЛЬНУ ширину віджета. Обидві функції нижче більше НЕ static:
    // їм потрібен m_SizeK, бо GetTextSize міряє в одиницях Set*, а GetScreenSize віддає
    // екранні пікселі — без перерахунку заміри розходяться в ~1.5 раза й текст вилазить.
    protected void FitText(TextWidget target, string src)
    {
        if (!target)
            return;
        float boxW, boxH;
        target.GetScreenSize(boxW, boxH);
        if (boxW <= 0)
        {
            target.SetText(src);
            return;
        }
        target.SetText(Ellipsize(target, src, boxW));
    }

    // Розкладає довгий текст по кількох однорядкових віджетах, міряючи кожен рядок.
    protected void FillLines(array<TextWidget> lines, string src)
    {
        foreach (TextWidget lw : lines)
        {
            if (lw)
                lw.SetText("");
        }
        if (lines.Count() == 0)
            return;
        float boxW, boxH;
        lines[0].GetScreenSize(boxW, boxH);
        if (boxW <= 0)
            boxW = 300;
        TStringArray words = new TStringArray();
        src.Split(" ", words);
        int idx = 0;
        string cur = "";
        foreach (string w : words)
        {
            string probe = cur;
            if (probe != "")
                probe = probe + " ";
            probe = probe + w;
            if (cur != "" && MeasurePx(lines[idx], probe) > boxW)
            {
                lines[idx].SetText(cur);
                idx++;
                if (idx >= lines.Count())
                    return;
                cur = w;
                continue;
            }
            cur = probe;
        }
        if (idx < lines.Count())
            lines[idx].SetText(cur);
    }

    protected string StatusText(string status, string nodeId)
    {
        if (status == "completed")
            return "досліджено";
        if (status == "researching")
        {
            int remain = ZP_ClientState.Get().GetResearchRemaining(nodeId);
            return "досліджується (" + FormatDuration(remain) + ")";
        }
        if (status == "available")
            return "доступно";
        return "закрито";
    }

    protected string FormatDuration(int sec)
    {
        if (sec < 0)
            sec = 0;
        int h = sec / 3600;
        int m = (sec % 3600) / 60;
        int s = sec % 60;
        if (h > 0)
            return h.ToString() + " год " + m.ToString() + " хв";
        if (m > 0)
            return m.ToString() + " хв " + s.ToString() + " с";
        return s.ToString() + " с";
    }

    protected int StatusColor(string status)
    {
        if (status == "completed")
            return COLOR_COMPLETED;
        if (status == "available")
            return COLOR_AVAILABLE;
        if (status == "researching")
            return COLOR_RESEARCHING;
        return COLOR_LOCKED;
    }

    protected void DrawLines()
    {
        if (!m_Canvas)
            return;
        m_Canvas.Clear();
        for (int i = 0; i < m_ShownNodes.Count(); i++)
        {
            ZP_ClientNode child = m_ShownNodes[i];
            if (!child)
                continue;   // слабке посилання могло померти між синком і refresh
            foreach (string parId : child.Parents)
            {
                int pIdx = -1;
                for (int k = 0; k < m_ShownNodes.Count(); k++)
                {
                    if (m_ShownNodes[k].Id == parId)
                    {
                        pIdx = k;
                        break;
                    }
                }
                if (pIdx < 0)
                    continue;   // батьківський вузол в іншій гілці/відсутній — лінію не малюємо
                float ph = 92;
                if (pIdx < m_NodeH.Count())
                    ph = m_NodeH[pIdx];
                m_Canvas.DrawLine(m_NodeX[pIdx], m_NodeY[pIdx] + ph, m_NodeX[i], m_NodeY[i], 2, COLOR_LINE);
            }
        }
    }

    // Бали — колонкою зліва, блок на категорію, розділені порожнім рядком. Категорії й типи
    // з нулем не показуємо взагалі.
    //
    // ЖОДНИХ НАЗВ ТУТ НЕМАЄ. Категорії й види вигадує адмін, тож підписи й порядок блоків
    // приходять із конфігу разом із типами балів. Раніше переклад лежав таблицею просто в
    // цьому файлі — і будь-яка нова категорія показувалась сирим ідентифікатором, полагодити
    // що адмін не міг ніяк.
    protected void UpdatePointsColumn()
    {
        ZP_ClientState st = ZP_ClientState.Get();
        ZP_ClientConfig cfg = st.m_Config;
        int slot = 0;
        if (cfg)
        {
            // порядок блоків — за SortOrder категорії; неописані йдуть у кінець, але не зникають
            ref array<string> cats = new array<string>();
            foreach (ZP_PointType ct : cfg.PointTypes)
            {
                if (cats.Find(ct.Category) < 0)
                    cats.Insert(ct.Category);
            }
            for (int si = 1; si < cats.Count(); si++)
            {
                string key = cats[si];
                int keyOrder = ZP_PointTypesConfig.DimensionOrder(cfg.PointCategories, key);
                int sj = si - 1;
                while (sj >= 0 && ZP_PointTypesConfig.DimensionOrder(cfg.PointCategories, cats[sj]) > keyOrder)
                {
                    cats[sj + 1] = cats[sj];
                    sj--;
                }
                cats[sj + 1] = key;
            }
            foreach (string cat : cats)
            {
                // спершу перевіряємо, чи є в категорії хоч щось ненульове
                bool any = false;
                foreach (ZP_PointType chk : cfg.PointTypes)
                {
                    if (chk.Category != cat)
                        continue;
                    int cv = 0;
                    st.m_PoolPoints.Find(chk.Id, cv);
                    if (cv > 0)
                    {
                        any = true;
                        break;
                    }
                }
                if (!any)
                    continue;
                if (slot >= m_PointLines.Count())
                    break;
                TextWidget head = m_PointLines[slot];
                head.Show(true);
                head.SetColor(ARGB(255, 150, 210, 255));
                FitText(head, ZP_PointTypesConfig.DimensionName(cfg.PointCategories, cat));
                slot++;
                foreach (ZP_PointType pt : cfg.PointTypes)
                {
                    if (pt.Category != cat)
                        continue;
                    int val = 0;
                    st.m_PoolPoints.Find(pt.Id, val);
                    if (val <= 0)
                        continue;
                    if (slot >= m_PointLines.Count())
                        break;
                    TextWidget lw = m_PointLines[slot];
                    lw.Show(true);
                    lw.SetColor(ARGB(255, 220, 220, 226));
                    FitText(lw, ZP_PointTypesConfig.DimensionName(cfg.PointKinds, pt.Kind) + " T" + pt.Tier + ":  " + val);
                    slot++;
                }
                if (slot < m_PointLines.Count())
                {
                    m_PointLines[slot].Show(false);   // порожній рядок-розділювач між блоками
                    slot++;
                }
            }
        }
        for (int i = slot; i < m_PointLines.Count(); i++)
        {
            m_PointLines[i].Show(false);
        }
    }


    protected void UpdatePoolLine()
    {
        if (!m_PoolLine)
            return;
        ZP_ClientState st = ZP_ClientState.Get();
        m_PoolLine.SetText("Фракція: " + st.m_FactionClass);
    }

    protected void UpdateDetail()
    {
        if (m_SelectedIdx < 0 || m_SelectedIdx >= m_ShownNodes.Count())
        {
            if (m_NodeNameW)
                m_NodeNameW.SetText("(оберіть вузол)");
            FillLines(m_DescLines, "");
            if (m_NodeCostW)
                m_NodeCostW.SetText("");
            if (m_NodeStatusW)
                m_NodeStatusW.SetText("");
            return;
        }
        ZP_ClientState st = ZP_ClientState.Get();
        ZP_ClientNode n = m_ShownNodes[m_SelectedIdx];
        if (!n)
            return;
        FitText(m_NodeNameW, n.Name);
        FillLines(m_DescLines, n.Description);
        string cost = "";
        foreach (ZP_KV c : n.Cost)
        {
            cost += c.K + " x " + c.V + "\n";
        }
        foreach (ZP_RuleConsumable ic : n.ItemCost)
        {
            cost += ic.Classname + " x " + ic.Quantity + "\n";
        }
        if (n.ResearchTimeSec > 0)
        {
            cost += "Час: " + FormatDuration(n.ResearchTimeSec) + "\n";
        }
        if (cost == "")
            cost = "(безкоштовно)";
        if (m_NodeCostW)
            m_NodeCostW.SetText(cost);
        if (m_NodeStatusW)
            m_NodeStatusW.SetText(StatusText(st.GetNodeStatusClient(n), n.Id));
    }

    override bool OnClick(Widget w, int x, int y, int button)
    {
        if (w == m_BtnClose)
        {
            ZP_CloseSelf();
            return true;
        }
        if (w == m_BtnResearch)
        {
            if (m_SelectedIdx < 0 || m_SelectedIdx >= m_ShownNodes.Count())
            {
                SetStatus("оберіть вузол");
                return true;
            }
            GetRPCManager().SendRPC(ZP_Const.MOD, ZP_Const.RPC_RESEARCH, new Param1<string>(m_ShownNodes[m_SelectedIdx].Id), true, NULL);
            SetStatus("запит дослідження надіслано...");
            return true;
        }
        int idx = m_NodeWidgets.Find(w);
        if (idx > -1)
        {
            m_SelectedIdx = idx;
            UpdateDetail();
            return true;
        }
        return super.OnClick(w, x, y, button);
    }

    protected void SetStatus(string text)
    {
        if (m_Status)
            m_Status.SetText(text);
    }
}

#endif
