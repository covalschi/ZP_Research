// Права доступу адміна: union — Steam64-список із Settings.json АБО VPP-permission "ZP_Research:Admin".
//
// Компайл-гард: VPP НЕ експортує defines[] — символу VPPADMINTOOLS не існує.
// ЕМПІРИЧНО ДОВЕДЕНО (smoke-тест 2026-07-31, 1.29 diag): рушій авто-дефайнить імена
// CfgMods-класів завантажених модів (JM_CommunityFramework є в рантайм-дефайнах, водночас
// в defines[] CF його НЕМАЄ; CfgPatches-ім'я JM_CF_Scripts НЕ дефайниться). CfgMods-клас VPP =
// AVPPAdminTools — це і є гард. Фінальний рантайм-проб — рядок "VPP integration: ..."
// у логу під час бута з @VPPAdminTools (тест-план M0).
class ZP_AdminAuth
{
    static bool IsAdmin(PlayerIdentity identity)
    {
        if (!identity)
            return false;

        string plainId = identity.GetPlainId();

        ZP_SettingsConfig s = ZP_ConfigService.Get().GetSettings();
        if (s && s.AdminIds && s.AdminIds.Find(plainId) > -1)
            return true;

#ifdef AVPPAdminTools
        if (GetGame().IsDedicatedServer())
        {
            PermissionManager pm = GetPermissionManager();
            if (pm && pm.VerifyPermission(plainId, ZP_Const.PERM_ADMIN, "", false))
                return true;
        }
#endif

        return false;
    }

    // Сервер, кожен бут, ДО першої перевірки (VerifyPermission відхиляє незареєстровані рядки
    // навіть для SuperAdmins; реєстрація лише в пам'яті).
    static void RegisterPermissions()
    {
#ifdef AVPPAdminTools
        PermissionManager pm = GetPermissionManager();
        if (pm)
        {
            // Друге право — для КНОПКИ вкладки. Реєструємо тут, а не в окремому PBO
            // вкладки: там лише клієнтський UI, а VerifyPermission відхиляє незареєстровані
            // рядки навіть суперадміну, тож реєстрація мусить статися на сервері незалежно
            // від того, чи стоїть у гравця PBO вкладки.
            pm.AddPermissionType({ZP_Const.PERM_ADMIN, ZP_Const.PERM_VPP_TAB});
            ZP_Log.Info("VPP integration: ACTIVE, permissions registered: " + ZP_Const.PERM_ADMIN + ", " + ZP_Const.PERM_VPP_TAB);
        }
        else
        {
            ZP_Log.Warn("VPP integration: compiled, but PermissionManager is null (не dedicated-сервер?)");
        }
#else
        ZP_Log.Info("VPP integration: NOT COMPILED — лише AdminIds-fallback із Settings.json");
#endif

        // інформаційні проби інших кандидатів авто-дефайна (для тест-плану M0)
#ifdef DZM_VPPAdminToolsScripts
        ZP_Log.Info("probe: define DZM_VPPAdminToolsScripts активний");
#endif
#ifdef DZM_VPPAdminTools
        ZP_Log.Info("probe: define DZM_VPPAdminTools активний");
#endif
    }
}
