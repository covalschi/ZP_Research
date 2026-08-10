// Імена та описи типів зразків: $profile:ZP_Research\SampleTypes.json.
//
// ДЗЕРКАЛО ZP_DataItemsConfig (заготовки), АЛЕ без Points: зразок — ПРОМІЖНА ступінь
// ланцюжка (спека §4a), його не здають напряму, тож нагороди тут бути не може. Конфіг
// лише називає людською мовою те, що вже лежить у прихованому Content зразка
// (ZP_Sample_Base.m_ZP_Content) — інвентарний рядок, тултип, і нічого більше.
//
// Той самий трюк із класами, що й у заготовок: тридцять config-класів (ZP_Sample_01..30,
// плюс сумісний ZP_Sample) розрізняються лише моделлю в config.cpp, а видиме ім'я й опис
// беруться звідси і змінюються на льоту.

class ZP_SampleTypeDef
{
    string Id;            // класнейм зразка: ZP_Sample_01 .. ZP_Sample_30 (або сумісний ZP_Sample)
    bool Enabled = true;
    string Name;          // видима назва (українською; чужих ключів stringtable тут не буває)
    string Description;   // видимий опис (підказка наведення)
}

class ZP_SampleTypesConfig
{
    int ConfigVersion = 1;
    ref array<ref ZP_SampleTypeDef> Items = new array<ref ZP_SampleTypeDef>();

    // Вбудованих типів зразків за замовчуванням НЕМАЄ — та сама чесність, що й у
    // заготовок і у дерева: порожній файл означає «жоден тип не налаштований», і всі
    // тридцять класів показують запасну назву зі stringtable (config.cpp).
    void SetDefaults()
    {
    }

    // Пошук за класнеймом, кейс-інсенситивно — та сама причина, що й у DataItems.Find:
    // рушій усі config-lookup'и робить без урахування регістру.
    ZP_SampleTypeDef Find(string classname)
    {
        if (classname == "")
            return null;
        string want = classname;
        want.ToLower();
        foreach (ZP_SampleTypeDef d : Items)
        {
            if (!d || !d.Enabled)
                continue;
            string have = d.Id;
            have.ToLower();
            if (have == want)
                return d;
        }
        return null;
    }

    // Дзеркало ZP_DataItemsConfig.ValidateItem: тільки наші зразки (інакше адмін повісив
    // би назву на чужий клас), назва обов'язкова. softWarn лишається порожнім сьогодні
    // (Points немає, отже й попереджати нема про що) — параметр тримаємо заради того
    // самого контракту, яким користується ConfigService для решти конфігів.
    string ValidateItem(ZP_SampleTypeDef d, out string softWarn)
    {
        softWarn = "";
        if (!d)
            return "порожній запис";
        if (d.Id == "")
            return "запис без Id";
        if (!GetGame().ConfigIsExisting("CfgVehicles " + d.Id))
            return "класу '" + d.Id + "' немає в грі";
        if (!GetGame().IsKindOf(d.Id, "ZP_Sample_Base"))
            return "'" + d.Id + "' не є зразком ZP_Sample_*";
        if (d.Name == "")
            return "тип зразка '" + d.Id + "' без Name";
        return "";
    }

    // Валідація всього файлу. Невалідні записи ВИКИДАЮТЬСЯ з набору (одна помилка адміна
    // не має гасити всі інші типи), дублі Id — теж. Обхід ЗВОРОТНИЙ (від кінця до
    // початку): перше зустрінуте входження дубля — останнє за порядком у файлі, воно й
    // лишається в "seen"; попередні (нижчі індекси) відсіюються як дублі. Так дубль Id
    // вирішується на користь ОСТАННЬОГО запису у файлі (last-wins) — точно так само, як у
    // DataItems.Validate.
    bool Validate(out string problems)
    {
        problems = "";
        ref array<string> seen = new array<string>();
        for (int i = Items.Count() - 1; i >= 0; i--)
        {
            ZP_SampleTypeDef d = Items[i];
            string softWarn;
            string hard = ValidateItem(d, softWarn);
            if (hard != "")
            {
                problems += hard + "; ";
                Items.RemoveOrdered(i);
                continue;
            }
            string key = d.Id;
            key.ToLower();
            if (seen.Find(key) > -1)
            {
                problems += "дубль Id '" + d.Id + "'; ";
                Items.RemoveOrdered(i);
                continue;
            }
            seen.Insert(key);
            if (softWarn != "")
                ZP_Log.Warn("SampleTypes: '" + d.Id + "': " + softWarn);
        }
        if (problems != "")
            ZP_Log.Warn("SampleTypes: " + problems);
        return problems == "";
    }
}

// Довідка про тип зразка для ОБОХ сторін — дзеркало ZP_DataInfo.Lookup. Сервер бере з
// живого конфігу, клієнт — із присланого зрізу (ZP_ClientConfig.SampleTypes); більше
// ніде цих рядків немає, тож і розійтися їм ніде.
//
// IsDepositable тут НЕМАЄ — на відміну від заготовок, зразок не можна здати напряму
// (Points у типу немає взагалі), тож питання «чи є за що нарахувати» для нього не стоїть.
class ZP_SampleInfo
{
    // false = про цей клас ми нічого не знаємо (клієнт ще не отримав конфіг, тип не
    // налаштований або це взагалі не наш предмет) — викликач має лишити ванільну назву.
    static bool Lookup(string classname, out string name, out string description)
    {
        name = "";
        description = "";
        if (classname == "")
            return false;
        // сервер: істина в конфіг-сервісі
        if (ZP_ConfigService.s_Instance)
        {
            ZP_SampleTypesConfig cfg = ZP_ConfigService.s_Instance.GetSampleTypes();
            if (cfg)
            {
                ZP_SampleTypeDef d = cfg.Find(classname);
                if (d)
                {
                    name = d.Name;
                    description = d.Description;
                    return true;
                }
            }
            return false;
        }
        // клієнт: зріз із RPC_ZP_SyncConfig
        if (ZP_ClientState.s_Instance && ZP_ClientState.s_Instance.m_Config)
        {
            string want = classname;
            want.ToLower();
            foreach (ZP_ClientSampleType ci : ZP_ClientState.s_Instance.m_Config.SampleTypes)
            {
                if (!ci)
                    continue;
                string have = ci.Id;
                have.ToLower();
                if (have == want)
                {
                    name = ci.Name;
                    description = ci.Description;
                    return true;
                }
            }
        }
        return false;
    }
}
