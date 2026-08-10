// Заготовки результату досліджень: $profile:ZP_Research\DataItems.json.
//
// ДВІ РІЗНІ СУТНОСТІ ЛАНЦЮЖКА (спека §4a) — не плутати:
//   ЗРАЗОК (ZP_Sample)   — проміжна ступінь, ОДИН клас із прихованими полями. Читає МАШИНА.
//   ЗАГОТОВКА (ZP_Data_*) — кінець ланцюжка, по класу на вид даних. Читає ЛЮДИНА.
// Тут описана друга: у заготовки немає ані прихованих полів, ані чистоти, ані дії
// «визначити» — назва каже все. Ім'я, опис і бали при здачі беруться з цього конфігу
// й змінюються на льоту (клас несе лише модель і розмір).
//
// ПАСТКА ПЕРЕПРИЗНАЧЕННЯ (задокументовано свідомо): перейменувати заготовку можна вільно,
// а от перепрофілювати ту, що вже в обігу, — ні. Якщо в гравців на руках сорок «наукових
// даних», а адмін переозначив цей клас на щось інше, вміст їхніх рюкзаків мовчки змінив
// сенс. Новому сенсу — чиста заготовка з невикористаного номера.

class ZP_DataReward
{
    string Type;          // Id типу балів (PointTypes.json)
    int Amount = 0;
}

// СУПЕРТИПУ В ЗАГОТОВКИ НЕМАЄ (рішення власника 2026-08-03). Він був потрібен, поки
// результатом був ОДИН прихований носій на супертип: тоді клас предмета і БУВ супертипом,
// той висів на речі фізично й був єдиним, що видно оком. Відколи результат — дев'яносто
// звичайних класів із назвами з конфігу, підстава зникла: видно все, і видно точніше.
// Кожна його можлива робота виражається ближче до справи — хто виробляє задає
// RequiredFactions правила, які бали дає заготовка написано тут же, а вигляд (якщо
// знадобиться) — колір самої заготовки. Третє джерело правди, з яким усі мусили б
// узгоджуватись, прибрано.
class ZP_DataDef
{
    string Id;            // класнейм заготовки: ZP_Data_01 .. ZP_Data_90
    bool Enabled = true;
    string Name;          // видима назва (українською; чужих ключів stringtable тут не буває)
    string Description;   // видимий опис (підказка наведення)
    ref array<ref ZP_DataReward> Points = new array<ref ZP_DataReward>();
}

class ZP_DataItemsConfig
{
    int ConfigVersion = 1;
    ref array<ref ZP_DataDef> Items = new array<ref ZP_DataDef>();

    // Вбудованих заготовок за замовчуванням НЕМАЄ — так само, як і вбудованого дерева.
    // Порожній файл означає «жодна заготовка не налаштована», і всі 90 класів показують
    // запасну назву з config.cpp. Це чесно: ненастроєна заготовка так і виглядає.
    void SetDefaults()
    {
    }

    // Пошук за класнеймом. Регістр не важливий: класнейми в конфігах пишуть як заманеться,
    // а рушій усі config-lookup'и робить кейс-інсенситивно — розходження тут означало б
    // «у грі предмет є, а в конфігу його ніби нема».
    ZP_DataDef Find(string classname)
    {
        if (classname == "")
            return null;
        string want = classname;
        want.ToLower();
        foreach (ZP_DataDef d : Items)
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

    // Причина відмови або "" — той самий код для завантаження і для майбутніх ops редактора.
    // М'які проблеми (невідомий тип балів) НЕ відкидають запис: назва й опис мають
    // показуватись навіть у напівналаштованої заготовки, інакше адмін бачить
    // «не налаштовано» й гадає, чи то файл не прочитався, чи то одне поле не те.
    string ValidateItem(ZP_DataDef d, ZP_PointTypesConfig pointTypes, out string softWarn)
    {
        softWarn = "";
        if (!d)
            return "порожній запис";
        if (d.Id == "")
            return "запис без Id";
        // тільки наші заготовки: інакше адмін повісив би назву на чужий клас і зламав
        // чужий предмет у всіх гравців
        if (!GetGame().ConfigIsExisting("CfgVehicles " + d.Id))
            return "класу '" + d.Id + "' немає в грі";
        if (!GetGame().IsKindOf(d.Id, "ZP_Data_Base"))
            return "'" + d.Id + "' не є заготовкою ZP_Data_*";
        if (d.Name == "")
            return "заготовка '" + d.Id + "' без Name";
        foreach (ZP_DataReward r : d.Points)
        {
            if (!r || r.Type == "")
            {
                softWarn += "порожній запис балів; ";
                continue;
            }
            if (pointTypes && !pointTypes.Find(r.Type))
                softWarn += "невідомий тип балів '" + r.Type + "'; ";
            if (r.Amount < 0 || r.Amount > 1000000)
                softWarn += "Amount '" + r.Amount + "' поза межами [0..1000000]; ";
        }
        return "";
    }

    // Валідація всього файлу. Невалідні записи ВИКИДАЮТЬСЯ з набору (живучість: одна
    // помилка адміна не має гасити всі інші заготовки), дублі Id — теж.
    bool Validate(ZP_PointTypesConfig pointTypes, out string problems)
    {
        problems = "";
        ref array<string> seen = new array<string>();
        for (int i = Items.Count() - 1; i >= 0; i--)
        {
            ZP_DataDef d = Items[i];
            string softWarn;
            string hard = ValidateItem(d, pointTypes, softWarn);
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
                ZP_Log.Warn("DataItems: '" + d.Id + "': " + softWarn);
        }
        if (problems != "")
            ZP_Log.Warn("DataItems: " + problems);
        return problems == "";
    }

    // Скільки нагород заготовки СПРАВДІ можна нарахувати. Тип балів міг зникнути з
    // PointTypes.json уже після того, як заготовку описали: валідація про це лише
    // попереджає (щоб не гасити назву предмета через одне поле), а нарахування невідомий
    // тип відхиляє. Живе ТУТ, а не в дії здачі, бо цю ж відповідь треба покласти в
    // клієнтський зріз — інакше промпт обіцяв би те, чого сервер не зробить.
    static int CountGrantable(ZP_DataDef def, ZP_PointTypesConfig pointTypes)
    {
        if (!def)
            return 0;
        int n = 0;
        foreach (ZP_DataReward r : def.Points)
        {
            if (!r || r.Type == "" || r.Amount <= 0)
                continue;
            if (pointTypes && !pointTypes.Find(r.Type))
                continue;
            n++;
        }
        return n;
    }
}

// Довідка про заготовку для ОБОХ сторін. Сервер бере з живого конфігу, клієнт — із
// присланого зрізу; більше ніде цих рядків немає, тож і розійтися їм ніде.
class ZP_DataInfo
{
    // Чи можна здати цю заготовку (є хоч один чинний тип балів). Сервер питає живий
    // конфіг, клієнт — прапорець зі зрізу; питання одне, тож відповіді розійтися ніде.
    static bool IsDepositable(string classname)
    {
        if (ZP_ConfigService.s_Instance)
        {
            ZP_DataItemsConfig cfg = ZP_ConfigService.s_Instance.GetDataItems();
            if (!cfg)
                return false;
            return ZP_DataItemsConfig.CountGrantable(cfg.Find(classname), ZP_ConfigService.s_Instance.GetPointTypes()) > 0;
        }
        if (ZP_ClientState.s_Instance && ZP_ClientState.s_Instance.m_Config)
        {
            string want = classname;
            want.ToLower();
            foreach (ZP_ClientDataItem ci : ZP_ClientState.s_Instance.m_Config.DataItems)
            {
                if (!ci)
                    continue;
                string have = ci.Id;
                have.ToLower();
                if (have == want)
                    return ci.Depositable;
            }
        }
        return false;
    }

    // false = про цей клас ми нічого не знаємо (клієнт ще не отримав конфіг, заготовка не
    // налаштована або це взагалі не наш предмет) — викликач має лишити ванільну назву.
    static bool Lookup(string classname, out string name, out string description)
    {
        name = "";
        description = "";
        if (classname == "")
            return false;
        // сервер: істина в конфіг-сервісі
        if (ZP_ConfigService.s_Instance)
        {
            ZP_DataItemsConfig cfg = ZP_ConfigService.s_Instance.GetDataItems();
            if (cfg)
            {
                ZP_DataDef d = cfg.Find(classname);
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
            foreach (ZP_ClientDataItem ci : ZP_ClientState.s_Instance.m_Config.DataItems)
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
