// Вкладка ZP Research у вікні VPP AdminTools.
//
// УВЕСЬ файл під #ifdef AVPPAdminTools. Гард потрібен не «про всяк випадок»: modded class
// VPPAdminHud без завантаженого VPP не скомпілюється, і разом із ним упаде весь модуль
// Mission — тобто мод без VPP не працював би зовсім.
//
// ЯК ЦЕ ВЛАШТОВАНО У VPP (звірено по розпакованих скриптах VPPAdminTools):
//   vppadminhud.c:113  private void InsertButton(string permissionType, string displayName, ...)
//                      -> ПЕРШИЙ аргумент є ОДНОЧАСНО іменем права й іменем класу підменю;
//   vppbutton.c:70-85  typename btnType = ButtonType.ToType(); ... root.CreateSubMenu(btnType)
//                      -> кнопка створює підменю САМЕ ЦЬОГО типу, і лише якщо m_PermissionActive;
//   vppadminhud.c:230  CreateSubMenu -> subMenuType.Spawn() -> menu.OnCreate(layoutRoot);
//   vppadminhud.c:51-55 клієнт збирає імена прав своїх кнопок і шле їх серверу, а той
//                      відповідає картою «право -> дозволено» (permissionmanager.c:145).
// Тому право мусить називатися РІВНО ZP_ResearchMenu і бути зареєстрованим на сервері
// (це робить ZP_AdminAuth.RegisterPermissions в основному моді, під тим самим гардом).
//
// Підменю VPP — це НЕ UIScriptedMenu, а ScriptedWidgetEventHandler усередині вікна VPP.
// Саме тому воно й обране замість «відкрити своє вікно поверх»: власний EnterScriptedMenu
// мовчки повертає NULL, поки стеком меню володіє чуже вікно (наша перевірена пастка), а тут
// стеком володіє VPP і віддавати його нікому не треба.
// ДРУГИЙ ГАРД, NO_GUI, ОБОВ'ЯЗКОВИЙ. Сервер компілює модуль Mission із визначеним NO_GUI,
// і весь UI мода — разом із ZP_EditorController — там просто не існує. Без цього рядка
// сервер падав із «Bad type 'ZP_EditorController'» ще до завантаження світу: гард VPP
// сам по собі нічого не рятує, бо VPP на сервері теж завантажений.
// Вкладка — суто клієнтський UI, на сервері їй робити нічого.
#ifdef AVPPAdminTools
#ifndef NO_GUI

modded class VPPAdminHud
{
    override void DefineButtons()
    {
        super.DefineButtons();   // без super зникли б УСІ штатні кнопки VPP
        InsertButton("ZP_ResearchMenu", "ZP Research", "set:dayz_gui_vpp image:vpp_icon_xml_editor", "Правила переробки, дерево досліджень, фракції");
    }
}

class ZP_ResearchMenu extends AdminHudSubMenu
{
    // Та САМА начинка, що й у власному вікні мода. Дві копії логіки розійшлися б першою ж
    // правкою, тож спільним є контролер, а різним — лише обв'язка вікна.
    protected ref ZP_EditorController m_Ctl = new ZP_EditorController();

    // Жива вкладка. Потрібна тому, що прибирати віджет доводиться ЗЗОВНІ (див. ZP_VppWatch).
    static ZP_ResearchMenu s_Instance;

    override void OnCreate(Widget RootW)
    {
        super.OnCreate(RootW);
        s_Instance = this;

        // Розмітка ТА САМА, що й у власного вікна: один опис віджетів на обидва господарі.
        //
        // Створюємо на КОРЕНІ робочої області, а НЕ базовим CreateWidgets. Базовий метод
        // (adminhudsubmenu.c:114) вкладає розмітку всередину панелі вмісту VPP, а та
        // масштабована — і наші розміри в ПІКСЕЛЯХ (діалог 1100x640, кеглі тексту)
        // множаться на її масштаб. У грі це виглядало як список із велетенськими літерами
        // впоперек вікна: розмітка малювалась, але в чужій системі координат.
        M_SUB_WIDGET = GetGame().GetWorkspace().CreateWidgets("ZP_Research/gui/layouts/zp_editor.layout");
        if (!M_SUB_WIDGET)
        {
            // CreateWidgets на хибному шляху повертає NULL МОВЧКИ — без цієї перевірки
            // кнопка просто нічого не робила б, і причину не було б де побачити
            Print("[ZP_Research] VPP: не вдалося створити zp_editor.layout");
            return;
        }
        M_SUB_WIDGET.SetHandler(this);

        // Затемнення на весь екран прибираємо: воно існує для ОКРЕМОГО вікна, а тут
        // сховало б саме вікно VPP, з якого нас відкрили.
        Widget backdrop = M_SUB_WIDGET.FindAnyWidget("Backdrop");
        if (backdrop)
            backdrop.Show(false);

        // Перетягування VPP НЕ підключаємо: воно рухає M_SUB_WIDGET, а в нас це
        // повноекранний корінь — вікно поїхало б за межі екрана. Діалог і так по центру.
        m_TitlePanel  = null;
        m_closeButton = ButtonWidget.Cast(M_SUB_WIDGET.FindAnyWidget("BtnClose"));

        m_Ctl.Attach(M_SUB_WIDGET);
    }

    override void OnMenuShow()
    {
        super.OnMenuShow();
        // Заявляємо себе передніми самі: VPP кличе HideBrokenWidgets лише коли порядок
        // МІНЯЄТЬСЯ (vppadminhud.c:212 — «if index != 0»), тож на відкритті вкладки, яка
        // вже перша, повідомлення не буде взагалі.
        if (M_SUB_WIDGET)
            M_SUB_WIDGET.SetSort(1000);
        m_Ctl.RequestSnapshot();
    }

    override void OnUpdate(float timeslice)
    {
        super.OnUpdate(timeslice);
        if (!M_SUB_WIDGET || !IsSubMenuVisible())
            return;
        m_Ctl.OnUpdate();
    }

    // Сховати вкладку ззовні, коли панелі VPP уже нема на екрані.
    void ZP_HideOrphan()
    {
        if (!M_SUB_WIDGET || !M_SUB_WIDGET.IsVisible())
            return;
        M_SUB_WIDGET.Show(false);
        m_IsVisible = false;   // база сама не дізнається, що вкладку сховали
        m_Ctl.CancelDelete();
    }

    // Панель VPP може бути знищена разом із підменю — тоді віджет лишився б висіти в
    // робочій області назавжди, бо його ніхто не тримає.
    void ~ZP_ResearchMenu()
    {
        if (M_SUB_WIDGET)
            M_SUB_WIDGET.Unlink();
        if (s_Instance == this)
            s_Instance = null;
    }

    override bool OnClick(Widget w, int x, int y, int button)
    {
        // Хрестик обробляє база (HideSubMenu) — у неї свій спосіб ховати вікно.
        if (m_Ctl.IsCloseButton(w))
            return super.OnClick(w, x, y, button);

        if (m_Ctl.HandleClick(w))
        {
            // ПІДТВЕРДЖЕННЯ — ДРУГИМ НАТИСКАННЯМ, БЕЗ МОДАЛЬНОГО ВІКНА.
            //
            // Спершу тут був діалог VPP, і він робив інтерфейс глухим: VPPDialogBox ставить
            // своєму кореню SetSort(1024) (vppdialogbox.c:51), тобто кладеться поверх усього,
            // а наш редактор — повноекранний корінь із високим priority. Діалог опинявся ЗА
            // ним: невидимий, але ввід перехоплював, і після одного «Видалити» перестава-
            // ли натискатися геть усі кнопки. Ванільний ShowDialog тут теж не варіант — він
            // приймає лише UIScriptedMenu, якого в підменю VPP немає в принципі.
            //
            // Два натискання нічого не перехоплюють і не залежать від порядку відмальовки.
            string question = m_Ctl.TakePendingQuestion();
            if (question != "")
                m_Ctl.ArmConfirm(question);
            return true;
        }
        return super.OnClick(w, x, y, button);
    }

    // Ховаємо вкладку — знімаємо взведене підтвердження: інакше воно чекало б на другий
    // клік і спрацювало б після наступного відкриття.
    override void OnMenuHide()
    {
        super.OnMenuHide();
        m_Ctl.CancelDelete();
    }

    override bool OnItemSelected(Widget w, int x, int y, int row, int column, int oldRow, int oldColumn)
    {
        if (m_Ctl.HandleItemSelected(w, row))
            return true;
        return super.OnItemSelected(w, x, y, row, column, oldRow, oldColumn);
    }

    // Живий пошук у переліку значень.
    override bool OnChange(Widget w, int x, int y, bool finished)
    {
        if (m_Ctl.HandleChange(w))
            return true;
        return super.OnChange(w, x, y, finished);
    }

    // ПОРЯДОК ВІКОН. VPP тримає свої підменю в одному масиві й при кожному кліку роздає їм
    // sort: переднє отримує найбільший, решта — менші (vppadminhud.c:206-227). Для СВОЇХ
    // підменю це працює, бо вони сусіди в дереві. Наш віджет живе на корені робочої області,
    // і той самий маленький sort кладе нас ПІД чуже вікно: після відкриття будь-якої іншої
    // вкладки редактор переставав приймати кліки.
    //
    // HideBrokenWidgets — єдиний виклик, яким VPP повідомляє, хто зараз попереду
    // (false = це ти). Числа беремо власні, у шкалі кореня робочої області, а не в їхній.
    override void HideBrokenWidgets(bool state)
    {
        super.HideBrokenWidgets(state);
        if (!M_SUB_WIDGET)
            return;
        if (state)
            M_SUB_WIDGET.SetSort(10);     // попереду хтось інший — не заступаємо його вікно
        else
            M_SUB_WIDGET.SetSort(1000);   // попереду ми
    }
}

// СТОРОЖ ЖИТТЄВОГО ЦИКЛУ ВКЛАДКИ.
//
// Наш віджет живе на корені робочої області, а не в дереві VPP (там пікселі розмітки
// рахуються в чужій системі координат — список виходив із велетенськими літерами). Плата
// за це одна: ховати віджет мусимо самі, бо VPP ховає лише СВІЙ корінь.
//
// Перша спроба перевіряла це в OnUpdate самої вкладки — і не працювала. Ланцюг виклику:
// рушій тікає меню -> VPPAdminHud.Update (vppadminhud.c:170) -> OnUpdate кожного підменю.
// Щойно панель сховано, рушій перестає тікати ЇЇ, отже й наш OnUpdate більше не викликається —
// саме в той момент, коли треба прибрати віджет. Перевірка мусить жити там, де тік не
// припиняється, тобто в оновленні місії.
//
// ESC закриває панель штатно: VPP перехоплює клавішу у власному OnKeyPress
// (missiongameplay.c:117-134) і кличе HideMenu(), а той гасить menuStatus (vppuimanager.c:373).
// Тому menuStatus — відповідь самого VPP, а не наш здогад за видимістю віджета.
modded class MissionGameplay
{
    override void OnUpdate(float timeslice)
    {
        super.OnUpdate(timeslice);

        ZP_ResearchMenu tab = ZP_ResearchMenu.s_Instance;
        if (!tab)
            return;

        VPPAdminHud hud = VPPAdminHud.Cast(GetGame().GetUIManager().FindMenu(VPP_ADMIN_HUD));
        if (!hud || !hud.IsShowing())
            tab.ZP_HideOrphan();
    }
}

#endif
#endif
