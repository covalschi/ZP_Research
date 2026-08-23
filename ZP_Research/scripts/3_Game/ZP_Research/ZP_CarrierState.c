// РЯДОК СТАНУ НОСІЯ ДОСЛІДЖЕННЯ: "<Id типу балів>:<кількість>", напр. "bio_lab_t2:3".
//
// Носій (ZP_Carrier_Base, 4_World) — один предмет на супертип (наукові / бойові /
// сталкерські); усе, що визначає його ЦІННІСТЬ — категорія, вид (польове/лабораторне),
// тир і кількість балів — сховано в цьому рядку. Гравець бачить лише супертип, а рядок
// читає термінал («Визначити дані») і він же його витрачає («Здати дані»).
//
// Рядок живе в полі `Content` правил і в сховищі станції БЕЗ ЗМІНИ СХЕМ: це те саме поле,
// яким зразки несуть свою мітку, — тому розбір лежить у 3_Game, де його бачать і валідація
// конфігів (ZP_ProcessingRules.ValidateContent), і 4_World (сам носій, здача, визначення).
class ZP_CarrierState
{
    static const int MAX_AMOUNT = 1000;

    static string Make(string pointType, int amount)
    {
        return pointType + ":" + amount;
    }

    // Строгий розбір: "bio_lab_t2:3" -> ("bio_lab_t2", 3). Хвіст мусить бути РІВНО числом —
    // ToInt() читає провідні цифри й мовчки з'їв би "3x"; порівняння з ToString() ловить це.
    static bool Parse(string state, out string pointType, out int amount)
    {
        pointType = "";
        amount = 0;
        if (state == "")
            return false;
        int sep = state.IndexOf(":");
        if (sep <= 0 || sep >= state.Length() - 1)
            return false;
        pointType = state.Substring(0, sep);
        string amountStr = state.Substring(sep + 1, state.Length() - sep - 1);
        amount = amountStr.ToInt();
        if (amount <= 0 || amount > MAX_AMOUNT)
            return false;
        if (amount.ToString() != amountStr)
            return false;
        return true;
    }

    // Супертип за класнеймом носія — самим КЛАСОМ, без скрипт-об'єкта: так його однаково
    // бачать і валідація в 3_Game, і чужий мод, що спавнить носій за класнеймом.
    static string SupertypeOf(string classname)
    {
        if (GetGame().IsKindOf(classname, "ZP_Carrier_Science"))
            return "science";
        if (GetGame().IsKindOf(classname, "ZP_Carrier_Combat"))
            return "combat";
        if (GetGame().IsKindOf(classname, "ZP_Carrier_Stalker"))
            return "stalker";
        return "";
    }

    // Людська назва супертипу для повідомлень сервера (ті самі слова, що в Factions.json).
    static string SupertypeLabel(string supertype)
    {
        if (supertype == "science")
            return "наукові";
        if (supertype == "combat")
            return "бойові";
        if (supertype == "stalker")
            return "сталкерські";
        return supertype;
    }

    // Видима назва носія — лише супертип, і НІЧОГО більше: саме це й ховає рядок стану.
    static string CarrierLabel(string classname)
    {
        string st = SupertypeOf(classname);
        if (st == "science")
            return "Наукові дані";
        if (st == "combat")
            return "Бойові дані";
        if (st == "stalker")
            return "Сталкерські дані";
        return "Дані";
    }
}
