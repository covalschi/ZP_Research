modded class MissionGameplay
{
    // Реєстрація власних меню: EnterScriptedMenu(id) створює меню саме тут
    // (ванільний шлях; ShowScriptedMenu позначив би меню як «створене приховано»
    // і LockControls мовчки не спрацював би — ні курсора, ні блокування керування)
    override UIScriptedMenu CreateScriptedMenu(int id)
    {
        UIScriptedMenu menu = super.CreateScriptedMenu(id);
        if (menu)
            return menu;
#ifndef NO_GUI
        if (id == ZP_Const.MENU_TREE)
        {
            menu = new ZP_TreeMenu();
            menu.SetID(id);
        }
        else if (id == ZP_Const.MENU_EDITOR)
        {
            menu = new ZP_EditorMenu();
            menu.SetID(id);
        }
#endif
        return menu;
    }

    override void OnInit()
    {
        super.OnInit();
        if (!GetGame().IsDedicatedServer())
        {
            ZP_ClientState.Get().RegisterRPCs();
#ifndef NO_GUI
            ZP_EditorBridge.Get().RegisterRPCs();
            ZP_TreeMenuBridge.Get().RegisterRPCs();
#else
#endif
            // страхувальний pull: сервер і сам пушить у InvokeOnConnect, але порядок подій
            // клієнтського завантаження не гарантований — подвійний синк ідемпотентний
            if (GetGame().IsMultiplayer())
                GetRPCManager().SendRPC(ZP_Const.MOD, ZP_Const.RPC_REQUEST_SYNC, NULL, true, NULL);
        }
    }

    override void OnMissionFinish()
    {
#ifndef NO_GUI
        ZP_EditorBridge.Reset();
        ZP_TreeMenuBridge.Reset();
#endif
        ZP_ClientState.Reset();
        super.OnMissionFinish();
    }
}
