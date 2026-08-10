// ОКРЕМИЙ НЕОБОВ'ЯЗКОВИЙ PBO: вкладка ZP Research у вікні VPP AdminTools.
//
// Чому окремо, а не в основному моді: залежність на скрипти VPP тут ЖОРСТКА
// (requiredAddons), і якби вона стояла в основному PBO, мод без VPP не запускався б узагалі.
// Емпірично перевірено 2026-08-04: відсутня залежність — це не «тихо пропущений PBO», як
// вважалося раніше, а БЛОКУЮЧЕ вікно «Addon 'X' requires addon 'Y'» ще до завантаження;
// у RPT сервера при цьому лишається сам заголовок і жодного рядка далі.
//
// Тому теку @ZP_Research_VPP адмін підключає ЛИШЕ разом із VPP. Якщо підключить без нього —
// побачить те саме вікно з прямим поясненням, що краще за мовчазно відсутню кнопку.
//
// Залежність названо по CfgPatches VPP (DZM_VPPAdminToolsScripts) — саме вона впорядковує
// компіляцію скриптів, а modded class VPPAdminHud вимагає, щоб клас VPP уже існував.
// Гард у КОДІ при цьому інший — #ifdef AVPPAdminTools: рушій авто-дефайнить імена
// CfgMods-класів, а не CfgPatches (перевірено бутом у M0).
class CfgPatches
{
    class ZP_Research_VPP
    {
        units[] = {};
        weapons[] = {};
        requiredVersion = 0.1;
        requiredAddons[] =
        {
            "DZ_Data",
            "DZ_Scripts",
            "JM_CF_Scripts",
            "ZP_Research",
            "DZM_VPPAdminToolsScripts"
        };
    };
};

class CfgMods
{
    class ZP_Research_VPP
    {
        dir = "ZP_Research_VPP";
        name = "ZP Research: VPP";
        author = "Zone Protocol";
        version = "0.1.0";
        type = "mod";
        dependencies[] = {"Mission"};

        class defs
        {
            // Лише місія: уся вкладка — це клієнтський UI поверх вікна VPP.
            // Права реєструє основний мод (він і так робить це під тим самим гардом).
            class missionScriptModule { value = ""; files[] = {"ZP_Research_VPP/scripts/5_Mission"}; };
        };
    };
};
