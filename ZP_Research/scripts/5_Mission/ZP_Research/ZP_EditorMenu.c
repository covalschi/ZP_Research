// ВЛАСНЕ ВІКНО РЕДАКТОРА — тонка обгортка над ZP_EditorController.
//
// Уся начинка (секції, знімок, операції) живе в контролері, бо господарів у неї двоє:
// це вікно і підменю всередині VPP AdminTools. Тут лишилося рівно те, що є справою ВІКНА:
// створити розмітку, забрати/віддати курсор і керування, закритися, показати діалог
// підтвердження — і переадресувати події контролеру.
//
// Вікно потрібне й далі, коли є VPP: без VPP це єдиний шлях до редактора.
#ifndef NO_GUI

// Клієнтський бридж: відкриття редактора за командою сервера (!zp editor уже перевірив права адміна)
class ZP_EditorBridge
{
    static ref ZP_EditorBridge s_Instance;

    ref ZP_EditorMenu m_Menu;

    static ZP_EditorBridge Get()
    {
        if (!s_Instance)
            s_Instance = new ZP_EditorBridge();
        return s_Instance;
    }

    static void Reset()
    {
        s_Instance = null;
    }

    void RegisterRPCs()
    {
        GetRPCManager().AddRPC(ZP_Const.MOD, ZP_Const.RPC_OPEN_EDITOR, this, SingleplayerExecutionType.Client);
    }

    void RPC_ZP_OpenEditor(CallType type, ParamsReadContext ctx, PlayerIdentity sender, Object target)
    {
        if (type != CallType.Client)
            return;
        // відкладання на кадр — див. пояснення в ZP_TreeMenu (вікно вводу чату тримає стек)
        GetGame().GetCallQueue(CALL_CATEGORY_GUI).CallLater(ZP_OpenDeferred, 100, false);
    }

    void ZP_OpenDeferred()
    {
        if (GetGame().GetUIManager().FindMenu(ZP_Const.MENU_EDITOR))
            return;
        m_Menu = ZP_EditorMenu.Cast(GetGame().GetUIManager().EnterScriptedMenu(ZP_Const.MENU_EDITOR, NULL));
        if (m_Menu)
            return;
        ZP_Log.Warn("редактор: EnterScriptedMenu віддав NULL — відкриваю запасним шляхом");
        ZP_EditorMenu emenu = new ZP_EditorMenu();
        emenu.SetID(ZP_Const.MENU_EDITOR);
        if (!emenu.Init())
        {
            ZP_Log.Err("вікно редактора: Init() не побудував розмітку");
            return;
        }
        m_Menu = emenu;
        GetGame().GetUIManager().ShowScriptedMenu(emenu, NULL);
        emenu.OnShow();
    }
}

class ZP_EditorMenu extends UIScriptedMenu
{
    protected ref ZP_EditorController m_Ctl = new ZP_EditorController();

    override Widget Init()
    {
        layoutRoot = GetGame().GetWorkspace().CreateWidgets("ZP_Research/gui/layouts/zp_editor.layout");
        if (!layoutRoot)
        {
            ZP_Log.Err("zp_editor.layout не завантажився (шлях/пак?)");
            return null;
        }
        if (!m_Ctl.Attach(layoutRoot))
        {
            ZP_Log.Err("редактор: контролер не прив'язався до розмітки");
            return null;
        }
        layoutRoot.Update();
        // SetHandler НЕ потрібен: рушій сам маршрутизує події віджетів у OnClick/OnItemSelected
        // АКТИВНОГО UIScriptedMenu (він не ScriptedWidgetEventHandler — SetHandler(this) не скомпілювався б)
        return layoutRoot;
    }

    override void OnShow()
    {
        super.OnShow();
        GetGame().GetUIManager().ShowUICursor(true);
        GetGame().GetMission().AddActiveInputExcludes({"menu"});
        GetGame().GetMission().AddActiveInputRestriction(EInputRestrictors.INVENTORY);
        if (GetGame().GetMission().GetHud())
            GetGame().GetMission().GetHud().Show(false);
        SetFocus(layoutRoot);
        m_Ctl.RequestSnapshot();
    }

    // працює обома шляхами відкриття — див. ZP_TreeMenu.ZP_CloseSelf
    void ZP_CloseSelf()
    {
        if (GetGame().GetUIManager().FindMenu(ZP_Const.MENU_EDITOR))
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
        if (ZP_EditorBridge.s_Instance)
            ZP_EditorBridge.s_Instance.m_Menu = null;
    }

    override void Update(float timeslice)
    {
        super.Update(timeslice);
        if (GetUApi().GetInputByID(UAUIBack).LocalPress())
        {
            ZP_CloseSelf();
            return;
        }
        m_Ctl.OnUpdate();
    }

    override bool OnItemSelected(Widget w, int x, int y, int row, int column, int oldRow, int oldColumn)
    {
        if (m_Ctl.HandleItemSelected(w, row))
            return true;
        return super.OnItemSelected(w, x, y, row, column, oldRow, oldColumn);
    }

    // Живий пошук у переліку значень: рушій шле зміну тексту сюди.
    override bool OnChange(Widget w, int x, int y, bool finished)
    {
        if (m_Ctl.HandleChange(w))
            return true;
        return super.OnChange(w, x, y, finished);
    }

    override bool OnClick(Widget w, int x, int y, int button)
    {
        if (m_Ctl.IsCloseButton(w))
        {
            ZP_CloseSelf();
            return true;
        }
        if (m_Ctl.HandleClick(w))
        {
            // ПІДТВЕРДЖЕННЯ — ДРУГИМ НАТИСКАННЯМ, а не модальним вікном.
            //
            // Ванільний ShowDialog тут не працює: перевірено живцем — на «YES» відповідь до
            // OnModalResult не доходила ЗОВСІМ (жодної операції на сервері), а сам редактор
            // закривався. Найімовірніше, закриття діалогу віддає той самий «назад», який
            // ловить наш Update і закриває вікно, — і разом із вікном гине обробник відповіді.
            // Механізм узятий той самий, що вже працює у вкладці VPP: дві реалізації
            // підтвердження розійшлися б першою ж правкою.
            string question = m_Ctl.TakePendingQuestion();
            if (question != "")
                m_Ctl.ArmConfirm(question);
            return true;
        }
        return super.OnClick(w, x, y, button);
    }
}

#endif
