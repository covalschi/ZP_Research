// ПЕРЕЛІК КЛАСІВ ПРЕДМЕТІВ для вибору в редакторі.
//
// Навіщо: опечатка в імені класу — найчастіша причина мертвого правила. Сервер її ловить
// валідацією, але вже ПІСЛЯ того, як адмін набрав і надіслав; вибір зі списку прибирає
// саму можливість помилитись.
//
// Корені беремо ТІ САМІ, які визнає наша валідація (ZP_ProcessingRules.ClassExists):
// CfgVehicles, CfgMagazines, CfgNonAIVehicles. Розбіжність тут була б підступною —
// редактор пропонував би клас, який сервер потім відхилить.
//
// Обхід конфігів із усіма модами коштує дорого (десятки тисяч записів), тому список
// будується ОДИН раз на сесію і живе в пам'яті.
#ifndef NO_GUI

class ZP_ClassIndex
{
    protected static ref array<string> s_All;

    // scope: 0 — службовий/абстрактний, 1 — не в меню спавну, 2 — повноцінний предмет.
    // Беремо від 1: ванільні статики й частина модових предметів мають саме 1, і відсікати
    // їх не можна — правило цілком законно може посилатись на такий клас.
    protected static const int MIN_SCOPE = 1;

    static void Build()
    {
        if (s_All)
            return;
        s_All = new array<string>();
        AddRoot("CfgVehicles");
        AddRoot("CfgMagazines");
        AddRoot("CfgNonAIVehicles");
        ZP_Log.Dbg("індекс класів побудовано: " + s_All.Count());
    }

    protected static void AddRoot(string root)
    {
        int n = GetGame().ConfigGetChildrenCount(root);
        for (int i = 0; i < n; i++)
        {
            string name;
            GetGame().ConfigGetChildName(root, i, name);
            if (name == "")
                continue;
            if (GetGame().ConfigGetInt(root + " " + name + " scope") < MIN_SCOPE)
                continue;
            s_All.Insert(name);
        }
    }

    // Підрядок шукаємо БЕЗ урахування регістру: адмін пам'ятає «petri», а клас зветься
    // ZP_PetriDishKit. Мутатори рядка в Enforce міняють НА МІСЦІ, тому копії обов'язкові.
    static void Find(string filter, int limit, out array<string> result)
    {
        Build();
        result.Clear();
        string needle = filter;
        needle.ToLower();
        for (int i = 0; i < s_All.Count(); i++)
        {
            string cls = s_All[i];
            if (needle != "")
            {
                string low = cls;
                low.ToLower();
                if (low.IndexOf(needle) < 0)
                    continue;
            }
            result.Insert(cls);
            if (result.Count() >= limit)
                return;
        }
    }

    static int Total()
    {
        Build();
        return s_All.Count();
    }
}

#endif
