// ФОРМА РЕДАКТОРА: поля замість тексту JSON.
//
// Рефлексії в Enforce немає, тож опис полів пишеться руками для кожного класу конфіга.
// Зате прив'язка ТИПІЗОВАНА — усе перевіряє компілятор, і власного парсера JSON не треба:
// знімок і так приходить розібраним на об'єкти.
//
// Форма — ПЛОСКИЙ список рядків. Поля об'єкта йдуть з відступом 0, поля елемента масиву —
// з відступом 1 під заголовком елемента. Плоский список замість вкладених контейнерів
// обраний свідомо: координати рахуються самим кодом, а не чужою системою розкладки, де
// пікселі вже одного разу перемножились на масштаб і текст поїхав упоперек вікна.
#ifndef NO_GUI

class ZP_FK
{
    static const int HEADER   = 0;   // заголовок групи (+ кнопка «додати»)
    static const int TEXT     = 1;
    static const int INT      = 2;
    static const int FLOAT    = 3;
    static const int BOOL     = 4;
    static const int COMBO    = 5;   // вибір із готового переліку
    static const int CLASS    = 6;   // ім'я класу предмета (+ кнопка вибору)
    static const int READONLY = 7;   // видно, але не редагується (правиться лише файлом)
    static const int TEXTAREA = 8;   // довгий текст: багаторядкове поле у високому рядку
}

// Один рядок форми: що показуємо, звідки взялось, куди покласти назад.
class ZP_FormRow
{
    int Kind;
    string Key;        // ім'я поля у своєму об'єкті
    string Label;
    string ArrayKey;   // до якого масиву належить рядок ("" = поле кореневого об'єкта)
    int Index = -1;    // індекс елемента масиву (-1 = не елемент)
    int Indent;

    string ValStr;
    // Що поле ПОКАЗАЛО після SetText. Може відрізнятись від ValStr: рушій розбирає текст,
    // який починається з '#', як ключ stringtable і підставляє переклад — колір "#7CB342"
    // ставав "7CB342" ПРОСТО ВІД ВІДОБРАЖЕННЯ, і «Застосувати» без єдиної правки псувало
    // конфіг. Порівняння з цим знімком відрізняє «користувач правив» від «рушій зіпсував».
    string ShownStr;
    bool ValBool;
    ref array<string> Options;   // для COMBO

    Widget W;
    TextWidget WLbl;
    Widget WBg;
    EditBoxWidget WEdit;
    MultilineEditBoxWidget WEditBig;
    ButtonWidget WValue;   // вибір із переліку: кнопка (без підпису — його малює WValueTxt)
    TextWidget WValueTxt;
    CheckBoxWidget WCheck;
    ButtonWidget WAdd;
    ButtonWidget WDel;
}

class ZP_EditorForm
{
    static const int ROW_H = 26;
    static const int ROW_H_BIG = 96;   // рядок із багаторядковим полем (опис)
    static const int ROW_W = 700;
    static const string ROW_LAYOUT = "ZP_Research/gui/layouts/zp_form_row.layout";

    ref array<ref ZP_FormRow> m_Rows = new array<ref ZP_FormRow>();
    protected Widget m_Content;

    void SetContent(Widget content)
    {
        m_Content = content;
    }

    void Clear()
    {
        for (int i = 0; i < m_Rows.Count(); i++)
        {
            if (m_Rows[i].W)
                m_Rows[i].W.Unlink();
        }
        m_Rows.Clear();
    }

    // ---- складання опису рядків ----

    protected ZP_FormRow Add(int kind, string key, string label, int indent, string arrayKey, int index)
    {
        ZP_FormRow r = new ZP_FormRow();
        r.Kind = kind;
        r.Key = key;
        r.Label = label;
        r.Indent = indent;
        r.ArrayKey = arrayKey;
        r.Index = index;
        m_Rows.Insert(r);
        return r;
    }

    protected void AddText(string key, string label, string value, int indent, string arrayKey, int index)
    {
        ZP_FormRow r = Add(ZP_FK.TEXT, key, label, indent, arrayKey, index);
        r.ValStr = value;
    }

    protected void AddInt(string key, string label, int value, int indent, string arrayKey, int index)
    {
        ZP_FormRow r = Add(ZP_FK.INT, key, label, indent, arrayKey, index);
        r.ValStr = value.ToString();
    }

    protected void AddFloat(string key, string label, float value, int indent, string arrayKey, int index)
    {
        ZP_FormRow r = Add(ZP_FK.FLOAT, key, label, indent, arrayKey, index);
        r.ValStr = value.ToString();
    }

    protected void AddBool(string key, string label, bool value, int indent, string arrayKey, int index)
    {
        ZP_FormRow r = Add(ZP_FK.BOOL, key, label, indent, arrayKey, index);
        r.ValBool = value;
    }

    protected void AddBigText(string key, string label, string value, int indent)
    {
        ZP_FormRow r = Add(ZP_FK.TEXTAREA, key, label, indent, "", -1);
        r.ValStr = value;
    }

    protected void AddClass(string key, string label, string value, int indent, string arrayKey, int index)
    {
        ZP_FormRow r = Add(ZP_FK.CLASS, key, label, indent, arrayKey, index);
        r.ValStr = value;
    }

    // Порожній варіант СВІДОМО перший у переліку: більшість гейтів типово «немає вимоги»,
    // і адмін мусить бачити це як окреме значення, а не як відсутність вибору.
    protected void AddCombo(string key, string label, string value, array<string> options, bool allowEmpty, int indent, string arrayKey, int index)
    {
        ZP_FormRow r = Add(ZP_FK.COMBO, key, label, indent, arrayKey, index);
        r.ValStr = value;
        r.Options = new array<string>();
        if (allowEmpty)
            r.Options.Insert("");
        for (int i = 0; i < options.Count(); i++)
            r.Options.Insert(options[i]);
        // Значення, якого вже немає в переліку (тип балів видалили, вузол перейменували),
        // додаємо окремим пунктом. Інакше комбо мовчки підмінило б його першим у списку —
        // тобто правка НАЗВИ зіпсувала б чуже поле, до якого адмін не торкався.
        if (value != "" && r.Options.Find(value) < 0)
            r.Options.Insert(value + "   (немає в переліку)");
    }

    // ---- ПРАВИЛА ----

    void BuildRule(ZP_Rule r, array<string> nodeIds, array<string> factionIds)
    {
        Clear();
        AddText("Id", "Код (Id)", r.Id, 0, "", -1);
        AddBool("Enabled", "Увімкнено", r.Enabled, 0, "", -1);
        AddClass("Device", "Прилад (клас)", r.Device, 0, "", -1);
        AddFloat("TimeSec", "Тривалість, с", r.TimeSec, 0, "", -1);
        AddFloat("BasePurityMin", "Базова чистота, від", r.BasePurityMin, 0, "", -1);
        AddFloat("BasePurityMax", "Базова чистота, до", r.BasePurityMax, 0, "", -1);

        Add(ZP_FK.HEADER, "", "Вхід", 0, "", -1);
        AddClass("InputItem.Classname", "Клас сировини", r.InputItem.Classname, 1, "", -1);
        AddInt("InputItem.Quantity", "Кількість", r.InputItem.Quantity, 1, "", -1);
        AddText("InputItem.Content", "Вміст зразка", r.InputItem.Content, 1, "", -1);
        AddBool("InputItem.ConsumeInput", "Витрачати вхід", r.InputItem.ConsumeInput, 1, "", -1);

        Add(ZP_FK.HEADER, "", "Виходи", 0, "Outputs", -1);
        for (int o = 0; o < r.Outputs.Count(); o++)
        {
            ZP_RuleOutput ro = r.Outputs[o];
            Add(ZP_FK.HEADER, "", "вихід " + (o + 1), 1, "Outputs", o);
            AddClass("Classname", "Клас", ro.Classname, 1, "Outputs", o);
            AddInt("Quantity", "Кількість", ro.Quantity, 1, "Outputs", o);
            AddFloat("Chance", "Шанс (0..1)", ro.Chance, 1, "Outputs", o);
            AddText("Content", "Вміст зразка", ro.Content, 1, "Outputs", o);
        }

        Add(ZP_FK.HEADER, "", "Розхідники", 0, "Consumables", -1);
        for (int c = 0; c < r.Consumables.Count(); c++)
        {
            ZP_RuleConsumable cn = r.Consumables[c];
            Add(ZP_FK.HEADER, "", "розхідник " + (c + 1), 1, "Consumables", c);
            AddClass("Classname", "Клас", cn.Classname, 1, "Consumables", c);
            AddInt("Quantity", "Кількість", cn.Quantity, 1, "Consumables", c);
            AddText("Content", "Вміст зразка", cn.Content, 1, "Consumables", c);
        }

        AddCombo("RequiredNode", "Потрібен вузол", r.RequiredNode, nodeIds, true, 0, "", -1);

        Add(ZP_FK.HEADER, "", "Доступно фракціям (порожньо = всім)", 0, "RequiredFactions", -1);
        for (int f = 0; f < r.RequiredFactions.Count(); f++)
            AddCombo("", "фракція " + (f + 1), r.RequiredFactions[f], factionIds, false, 1, "RequiredFactions", f);

        Add(ZP_FK.HEADER, "", "Потрібні інструменти (у слотах приладу)", 0, "RequiredTools", -1);
        for (int t = 0; t < r.RequiredTools.Count(); t++)
            AddClass("", "інструмент " + (t + 1), r.RequiredTools[t], 1, "RequiredTools", t);

        Add(ZP_FK.HEADER, "", "Потрібно одягнено", 0, "RequiredWorn", -1);
        for (int w = 0; w < r.RequiredWorn.Count(); w++)
            AddClass("", "одяг " + (w + 1), r.RequiredWorn[w], 1, "RequiredWorn", w);

        AddBigText("Notes", "Нотатки", r.Notes, 0);
    }

    void CollectRule(ZP_Rule r)
    {
        ReadWidgets();
        r.Outputs.Clear();
        r.Consumables.Clear();
        r.RequiredFactions.Clear();
        r.RequiredTools.Clear();
        r.RequiredWorn.Clear();

        for (int i = 0; i < m_Rows.Count(); i++)
        {
            ZP_FormRow row = m_Rows[i];
            if (row.Kind == ZP_FK.HEADER)
                continue;

            if (row.ArrayKey == "Outputs")
            {
                while (r.Outputs.Count() <= row.Index)
                    r.Outputs.Insert(new ZP_RuleOutput());
                ZP_RuleOutput o = r.Outputs[row.Index];
                if (row.Key == "Classname") o.Classname = row.ValStr;
                else if (row.Key == "Quantity") o.Quantity = row.ValStr.ToInt();
                else if (row.Key == "Chance") o.Chance = row.ValStr.ToFloat();
                else if (row.Key == "Content") o.Content = row.ValStr;
                continue;
            }
            if (row.ArrayKey == "Consumables")
            {
                while (r.Consumables.Count() <= row.Index)
                    r.Consumables.Insert(new ZP_RuleConsumable());
                ZP_RuleConsumable c = r.Consumables[row.Index];
                if (row.Key == "Classname") c.Classname = row.ValStr;
                else if (row.Key == "Quantity") c.Quantity = row.ValStr.ToInt();
                else if (row.Key == "Content") c.Content = row.ValStr;
                continue;
            }
            if (row.ArrayKey == "RequiredFactions") { r.RequiredFactions.Insert(CleanCombo(row.ValStr)); continue; }
            if (row.ArrayKey == "RequiredTools")    { r.RequiredTools.Insert(row.ValStr); continue; }
            if (row.ArrayKey == "RequiredWorn")     { r.RequiredWorn.Insert(row.ValStr); continue; }

            if (row.Key == "Id") r.Id = row.ValStr;
            else if (row.Key == "Enabled") r.Enabled = row.ValBool;
            else if (row.Key == "Device") r.Device = row.ValStr;
            else if (row.Key == "TimeSec") r.TimeSec = row.ValStr.ToFloat();
            else if (row.Key == "BasePurityMin") r.BasePurityMin = row.ValStr.ToFloat();
            else if (row.Key == "BasePurityMax") r.BasePurityMax = row.ValStr.ToFloat();
            else if (row.Key == "InputItem.Classname") r.InputItem.Classname = row.ValStr;
            else if (row.Key == "InputItem.Quantity") r.InputItem.Quantity = row.ValStr.ToInt();
            else if (row.Key == "InputItem.Content") r.InputItem.Content = row.ValStr;
            else if (row.Key == "InputItem.ConsumeInput") r.InputItem.ConsumeInput = row.ValBool;
            else if (row.Key == "RequiredNode") r.RequiredNode = CleanCombo(row.ValStr);
            else if (row.Key == "Notes") r.Notes = row.ValStr;
        }
    }

    // ---- ВУЗЛИ ДЕРЕВА ----

    void BuildNode(ZP_TreeNode n, array<string> pointTypeIds, array<string> nodeIds, array<string> factionIds)
    {
        Clear();
        AddText("Id", "Код (Id)", n.Id, 0, "", -1);
        AddText("Name", "Назва", n.Name, 0, "", -1);
        AddBigText("Description", "Опис", n.Description, 0);
        AddText("Icon", "Значок", n.Icon, 0, "", -1);
        AddInt("Tier", "Тир (колонка в дереві)", n.Tier, 0, "", -1);
        AddInt("ResearchTimeSec", "Час проєкту, с (0 = миттєво)", n.ResearchTimeSec, 0, "", -1);

        array<string> modes = {"all", "any"};
        AddCombo("ParentsMode", "Батьки потрібні", n.ParentsMode, modes, false, 0, "", -1);

        Add(ZP_FK.HEADER, "", "Батьківські вузли", 0, "Parents", -1);
        for (int p = 0; p < n.Parents.Count(); p++)
            AddCombo("", "батько " + (p + 1), n.Parents[p], nodeIds, false, 1, "Parents", p);

        Add(ZP_FK.HEADER, "", "Вартість у балах", 0, "Cost", -1);
        for (int c = 0; c < n.Cost.Count(); c++)
        {
            ZP_TreeCost tc = n.Cost[c];
            AddCombo("Type", "тип " + (c + 1), tc.Type, pointTypeIds, false, 1, "Cost", c);
            AddInt("Amount", "кількість", tc.Amount, 1, "Cost", c);
        }

        Add(ZP_FK.HEADER, "", "Вартість у предметах (з карго терміналу)", 0, "ItemCost", -1);
        for (int ic = 0; ic < n.ItemCost.Count(); ic++)
        {
            ZP_TreeItemCost tic = n.ItemCost[ic];
            AddClass("Classname", "клас " + (ic + 1), tic.Classname, 1, "ItemCost", ic);
            AddInt("Quantity", "кількість", tic.Quantity, 1, "ItemCost", ic);
            AddText("Content", "вміст зразка", tic.Content, 1, "ItemCost", ic);
        }

        Add(ZP_FK.HEADER, "", "Доступно фракціям (порожньо = всім)", 0, "RequiredFactions", -1);
        for (int f = 0; f < n.RequiredFactions.Count(); f++)
            AddCombo("", "фракція " + (f + 1), n.RequiredFactions[f], factionIds, false, 1, "RequiredFactions", f);
    }

    void CollectNode(ZP_TreeNode n)
    {
        ReadWidgets();
        n.Parents.Clear();
        n.Cost.Clear();
        n.ItemCost.Clear();
        n.RequiredFactions.Clear();

        for (int i = 0; i < m_Rows.Count(); i++)
        {
            ZP_FormRow row = m_Rows[i];
            if (row.Kind == ZP_FK.HEADER)
                continue;

            if (row.ArrayKey == "Parents")          { n.Parents.Insert(CleanCombo(row.ValStr)); continue; }
            if (row.ArrayKey == "RequiredFactions") { n.RequiredFactions.Insert(CleanCombo(row.ValStr)); continue; }
            if (row.ArrayKey == "Cost")
            {
                while (n.Cost.Count() <= row.Index)
                    n.Cost.Insert(new ZP_TreeCost());
                ZP_TreeCost tc = n.Cost[row.Index];
                if (row.Key == "Type") tc.Type = CleanCombo(row.ValStr);
                else if (row.Key == "Amount") tc.Amount = row.ValStr.ToInt();
                continue;
            }
            if (row.ArrayKey == "ItemCost")
            {
                while (n.ItemCost.Count() <= row.Index)
                    n.ItemCost.Insert(new ZP_TreeItemCost());
                ZP_TreeItemCost tic = n.ItemCost[row.Index];
                if (row.Key == "Classname") tic.Classname = row.ValStr;
                else if (row.Key == "Quantity") tic.Quantity = row.ValStr.ToInt();
                else if (row.Key == "Content") tic.Content = row.ValStr;
                continue;
            }

            if (row.Key == "Id") n.Id = row.ValStr;
            else if (row.Key == "Name") n.Name = row.ValStr;
            else if (row.Key == "Description") n.Description = row.ValStr;
            else if (row.Key == "Icon") n.Icon = row.ValStr;
            else if (row.Key == "Tier") n.Tier = row.ValStr.ToInt();
            else if (row.Key == "ResearchTimeSec") n.ResearchTimeSec = row.ValStr.ToInt();
            else if (row.Key == "ParentsMode") n.ParentsMode = CleanCombo(row.ValStr);
        }
    }

    // ---- ТИПИ БАЛІВ ----

    void BuildPointType(ZP_PointType p, array<string> categories, array<string> kinds)
    {
        Clear();
        AddText("Id", "Код (Id)", p.Id, 0, "", -1);
        AddText("Name", "Назва", p.Name, 0, "", -1);
        AddText("Icon", "Значок", p.Icon, 0, "", -1);
        AddText("Color", "Колір (#RRGGBB)", p.Color, 0, "", -1);
        AddInt("SortOrder", "Порядок", p.SortOrder, 0, "", -1);
        AddCombo("Category", "Категорія", p.Category, categories, false, 0, "", -1);
        AddCombo("Kind", "Вид здобуття", p.Kind, kinds, false, 0, "", -1);
        AddInt("Tier", "Тир", p.Tier, 0, "", -1);
    }

    void CollectPointType(ZP_PointType p)
    {
        ReadWidgets();
        for (int i = 0; i < m_Rows.Count(); i++)
        {
            ZP_FormRow row = m_Rows[i];
            if (row.Key == "Id") p.Id = row.ValStr;
            else if (row.Key == "Name") p.Name = row.ValStr;
            else if (row.Key == "Icon") p.Icon = row.ValStr;
            else if (row.Key == "Color") p.Color = row.ValStr;
            else if (row.Key == "SortOrder") p.SortOrder = row.ValStr.ToInt();
            else if (row.Key == "Category") p.Category = CleanCombo(row.ValStr);
            else if (row.Key == "Kind") p.Kind = CleanCombo(row.ValStr);
            else if (row.Key == "Tier") p.Tier = row.ValStr.ToInt();
        }
    }

    // ---- ЗАГОТОВКИ ----
    //
    // Id тут НЕ редагується: це класнейм предмета зі збірки (ZP_Data_01..90), а не вигадане
    // ім'я. Змінити його в редакторі означало б «перейменувати» предмет, якого в грі немає.
    // Прибирання заготовки з обігу — це галочка «Увімкнено», а не видалення.
    void BuildDataItem(ZP_DataDef d, array<string> pointTypeIds)
    {
        Clear();
        AddRO("Клас предмета", d.Id);
        AddBool("Enabled", "Увімкнено", d.Enabled, 0, "", -1);
        AddText("Name", "Назва в грі", d.Name, 0, "", -1);
        AddBigText("Description", "Опис (підказка наведення)", d.Description, 0);

        Add(ZP_FK.HEADER, "", "Бали за здачу на терміналі", 0, "Points", -1);
        for (int p = 0; p < d.Points.Count(); p++)
        {
            ZP_DataReward rw = d.Points[p];
            AddCombo("Type", "тип " + (p + 1), rw.Type, pointTypeIds, false, 1, "Points", p);
            AddInt("Amount", "кількість", rw.Amount, 1, "Points", p);
        }
    }

    void CollectDataItem(ZP_DataDef d)
    {
        ReadWidgets();
        d.Points.Clear();
        for (int i = 0; i < m_Rows.Count(); i++)
        {
            ZP_FormRow row = m_Rows[i];
            if (row.Kind == ZP_FK.HEADER || row.Kind == ZP_FK.READONLY)
                continue;
            if (row.ArrayKey == "Points")
            {
                while (d.Points.Count() <= row.Index)
                    d.Points.Insert(new ZP_DataReward());
                ZP_DataReward rw = d.Points[row.Index];
                if (row.Key == "Type") rw.Type = CleanCombo(row.ValStr);
                else if (row.Key == "Amount") rw.Amount = row.ValStr.ToInt();
                continue;
            }
            if (row.Key == "Enabled") d.Enabled = row.ValBool;
            else if (row.Key == "Name") d.Name = row.ValStr;
            else if (row.Key == "Description") d.Description = row.ValStr;
        }
    }

    // ---- МОДУЛІ (інструменти приладів) ----
    //
    // Один запис відповідає на обидва питання адміна: КУДИ підходить (перелік приладів;
    // порожньо = приймають усі) і СКІЛЬКИ дає (бонус до чистоти). Гейт «без цього
    // інструмента правило не запускається» живе не тут, а в самому правилі
    // (RequiredTools) — це різні речі на одній фізиці.
    void BuildModule(ZP_ModuleDef m)
    {
        Clear();
        AddClass("Classname", "Клас вкладення", m.Classname, 0, "", -1);
        AddFloat("PurityBonus", "Бонус до чистоти (0..2)", m.PurityBonus, 0, "", -1);

        Add(ZP_FK.HEADER, "", "Приймають прилади (порожньо = всі)", 0, "Devices", -1);
        for (int d = 0; d < m.Devices.Count(); d++)
            AddClass("", "прилад " + (d + 1), m.Devices[d], 1, "Devices", d);

        AddBigText("Notes", "Нотатки", m.Notes, 0);
    }

    void CollectModule(ZP_ModuleDef m)
    {
        ReadWidgets();
        m.Devices.Clear();
        for (int i = 0; i < m_Rows.Count(); i++)
        {
            ZP_FormRow row = m_Rows[i];
            if (row.Kind == ZP_FK.HEADER)
                continue;
            if (row.ArrayKey == "Devices")
            {
                m.Devices.Insert(row.ValStr);
                continue;
            }
            if (row.Key == "Classname") m.Classname = row.ValStr;
            else if (row.Key == "PurityBonus") m.PurityBonus = row.ValStr.ToFloat();
            else if (row.Key == "Notes") m.Notes = row.ValStr;
        }
    }

    // ---- НАЛАШТУВАННЯ ----
    //
    // Тут інший контракт: не «цілий об'єкт одним upsert», а операція SET_SETTING «ключ +
    // значення», і ключів вона знає рівно три (ZP_ConfigService.OpSetSetting). Решту полів
    // усе одно показуємо — інакше адмін не бачив би, що взагалі є в Settings.json, — але
    // підписуємо як «лише файл» і на збереженні не чіпаємо.
    void BuildSettings(ZP_SettingsConfig s)
    {
        Clear();
        AddBool("debug", "Докладні логи (debug)", s.DebugMode, 0, "", -1);
        AddInt("treedepth", "Глибина видимості дерева", s.TreeVisibilityDepth, 0, "", -1);

        Add(ZP_FK.HEADER, "", "Термінали дерева (спільні)", 0, "TreeTerminalClasses", -1);
        for (int t = 0; t < s.TreeTerminalClasses.Count(); t++)
            AddClass("", "термінал " + (t + 1), s.TreeTerminalClasses[t], 1, "TreeTerminalClasses", t);

        Add(ZP_FK.HEADER, "", "Нижче — лише через файл + «Перечитати»", 0, "", -1);
        AddRO("Фракція за замовчуванням", s.DefaultFaction);
        AddRO("Тло дерева", s.TreeBackgroundImage);
        for (int a = 0; a < s.AdminIds.Count(); a++)
            AddRO("адмін " + (a + 1), s.AdminIds[a]);
    }

    // Рядок «лише подивитись»: підпис і значення, без поля вводу. Ключ порожній, тож
    // збирач його не побачить у жодному разі.
    protected void AddRO(string label, string value)
    {
        ZP_FormRow r = Add(ZP_FK.READONLY, "", label, 1, "", -1);
        r.ValStr = value;
    }

    // Повертає ключі й значення для SET_SETTING. Список терміналів іде одним рядком через
    // кому — саме так його розбирає операція.
    void CollectSettings(out array<string> keys, out array<string> values)
    {
        ReadWidgets();
        keys.Clear();
        values.Clear();
        string terminals = "";
        for (int i = 0; i < m_Rows.Count(); i++)
        {
            ZP_FormRow row = m_Rows[i];
            if (row.ArrayKey == "TreeTerminalClasses" && row.ValStr != "")
            {
                if (terminals != "")
                    terminals += ",";
                terminals += row.ValStr;
                continue;
            }
            if (row.Key == "debug")
            {
                keys.Insert("debug");
                if (row.ValBool)
                    values.Insert("true");
                else
                    values.Insert("false");
            }
            else if (row.Key == "treedepth")
            {
                keys.Insert("treedepth");
                values.Insert(row.ValStr);
            }
        }
        if (terminals != "")
        {
            keys.Insert("treeterminal");
            values.Insert(terminals);
        }
    }

    // ---- ФРАКЦІЇ ----

    void BuildFaction(ZP_FactionDef f)
    {
        Clear();
        AddText("Id", "Код (Id)", f.Id, 0, "", -1);
        AddText("DisplayName", "Назва", f.DisplayName, 0, "", -1);
        AddText("Supertype", "Супертип", f.Supertype, 0, "", -1);

        Add(ZP_FK.HEADER, "", "Нашивки (за ними визначається фракція)", 0, "Armbands", -1);
        for (int a = 0; a < f.Armbands.Count(); a++)
            AddClass("", "нашивка " + (a + 1), f.Armbands[a], 1, "Armbands", a);

        Add(ZP_FK.HEADER, "", "Термінали дерева", 0, "TerminalClasses", -1);
        for (int t = 0; t < f.TerminalClasses.Count(); t++)
            AddClass("", "термінал " + (t + 1), f.TerminalClasses[t], 1, "TerminalClasses", t);

        Add(ZP_FK.HEADER, "", "Прилади фракції", 0, "DeviceClasses", -1);
        for (int d = 0; d < f.DeviceClasses.Count(); d++)
            AddClass("", "прилад " + (d + 1), f.DeviceClasses[d], 1, "DeviceClasses", d);
    }

    void CollectFaction(ZP_FactionDef f)
    {
        ReadWidgets();
        f.Armbands.Clear();
        f.TerminalClasses.Clear();
        f.DeviceClasses.Clear();
        for (int i = 0; i < m_Rows.Count(); i++)
        {
            ZP_FormRow row = m_Rows[i];
            if (row.Kind == ZP_FK.HEADER)
                continue;
            if (row.ArrayKey == "Armbands")        { f.Armbands.Insert(row.ValStr); continue; }
            if (row.ArrayKey == "TerminalClasses") { f.TerminalClasses.Insert(row.ValStr); continue; }
            if (row.ArrayKey == "DeviceClasses")   { f.DeviceClasses.Insert(row.ValStr); continue; }
            if (row.Key == "Id") f.Id = row.ValStr;
            else if (row.Key == "DisplayName") f.DisplayName = row.ValStr;
            else if (row.Key == "Supertype") f.Supertype = row.ValStr;
        }
    }

    // ---- малювання ----

    // Пункт «(немає в переліку)» ми ж і дописали, показуючи значення, якого немає серед
    // варіантів. Назад мусить піти саме значення, без нашої примітки.
    protected string CleanCombo(string v)
    {
        int mark = v.IndexOf("   (немає в переліку)");
        if (mark < 0)
            return v;
        return v.Substring(0, mark);
    }

    int Render()
    {
        if (!m_Content)
            return 0;
        int y = 0;
        for (int i = 0; i < m_Rows.Count(); i++)
        {
            ZP_FormRow r = m_Rows[i];
            r.W = GetGame().GetWorkspace().CreateWidgets(ROW_LAYOUT, m_Content);
            if (!r.W)
                continue;
            // Позиції НЕ ставимо: рядки складає сітка-полотно (Columns 1). Раніше вони
            // розкладались руками, і саме тому прокрутка не працювала — висота полотна
            // лишалась тією, що в розмітці, скільки б рядків туди не додали.
            int rowH = ROW_H;
            if (r.Kind == ZP_FK.TEXTAREA)
                rowH = ROW_H_BIG;
            r.W.SetSize(ROW_W, rowH, true);
            y += rowH;

            r.WLbl   = TextWidget.Cast(r.W.FindAnyWidget("Lbl"));
            r.WBg    = r.W.FindAnyWidget("ValueBg");
            r.WEdit  = EditBoxWidget.Cast(r.W.FindAnyWidget("Edit"));
            r.WEditBig = MultilineEditBoxWidget.Cast(r.W.FindAnyWidget("EditBig"));
            r.WValue = ButtonWidget.Cast(r.W.FindAnyWidget("BtnValue"));
            r.WValueTxt = TextWidget.Cast(r.W.FindAnyWidget("ValueTxt"));
            r.WCheck = CheckBoxWidget.Cast(r.W.FindAnyWidget("Check"));
            r.WAdd   = ButtonWidget.Cast(r.W.FindAnyWidget("BtnAdd"));
            r.WDel   = ButtonWidget.Cast(r.W.FindAnyWidget("BtnDel"));

            // Відступ роблю зсувом ПІДПИСУ, а не всього рядка: поля мусять лишатись на
            // одній вертикалі, інакше вкладені елементи «сходинкою» читаються гірше.
            float lx;
            float ly;
            r.WLbl.GetPos(lx, ly);
            r.WLbl.SetPos(lx + r.Indent * 14, ly, true);

            r.WEdit.Show(false);
            r.WEditBig.Show(false);
            r.WValue.Show(false);
            r.WValueTxt.Show(false);
            r.WCheck.Show(false);
            r.WAdd.Show(false);
            r.WDel.Show(false);
            r.WBg.Show(false);
            r.WBg.SetSize(360, 22, true);   // висоту міг збільшити попередній «великий» рядок
            r.WLbl.SetText(r.Label);

            // Прибрати елемент масиву можна і з його заголовка, і з єдиного рядка простого
            // списку — залежить від того, чи має елемент власний заголовок.
            bool removable = r.ArrayKey != "" && r.Index >= 0;

            if (r.Kind == ZP_FK.HEADER)
            {
                r.WLbl.SetColor(ARGB(255, 214, 192, 120));
                if (r.ArrayKey != "" && r.Index < 0)
                    r.WAdd.Show(true);              // заголовок групи — «додати елемент»
                else if (removable)
                    r.WDel.Show(true);              // заголовок елемента — «прибрати його»
                continue;
            }
            if (r.Kind == ZP_FK.BOOL)
            {
                r.WBg.Show(true);
                r.WCheck.Show(true);
                r.WCheck.SetChecked(r.ValBool);
                if (removable)
                    r.WDel.Show(true);
                continue;
            }
            if (r.Kind == ZP_FK.READONLY)
            {
                r.WValueTxt.Show(true);
                r.WValueTxt.SetText(r.ValStr);
                r.WValueTxt.SetColor(ARGB(255, 140, 148, 140));   // приглушено: правити тут не можна
                continue;
            }
            if (r.Kind == ZP_FK.COMBO || r.Kind == ZP_FK.CLASS)
            {
                // Значення показує КНОПКА, а не поле вводу: набирати вручну нічого не
                // треба, а перелік відкривається з пошуком (класів — тисячі, гортати їх
                // штатним випадним списком неможливо).
                r.WValue.Show(true);
                r.WValueTxt.Show(true);
                string shown = r.ValStr;
                if (shown == "")
                    shown = "( не задано )";
                r.WValueTxt.SetText(shown);
                if (removable && r.Key == "")
                    r.WDel.Show(true);
                continue;
            }

            if (r.Kind == ZP_FK.TEXTAREA)
            {
                // Підкладку розтягуємо на всю висоту рядка: інакше під високим полем
                // лишалась би смуга порожнього тла й поле виглядало б обрізаним.
                r.WBg.SetSize(360, rowH - 4, true);
                r.WBg.Show(true);
                r.WEditBig.Show(true);
                r.WEditBig.SetText(r.ValStr);
                string shownBig;
                r.WEditBig.GetText(shownBig);   // у Multiline GetText через out-параметр
                r.ShownStr = shownBig;
                continue;
            }

            r.WBg.Show(true);
            r.WEdit.Show(true);
            r.WEdit.SetText(r.ValStr);
            r.ShownStr = r.WEdit.GetText();   // те, що поле дійсно показало (див. ShownStr)
            if (removable && r.Key == "")
                r.WDel.Show(true);
        }
        m_Content.SetSize(700, y, true);
        return y;
    }

    // Знімає значення з віджетів у опис рядків. Викликається ПЕРЕД будь-якою дією, що
    // перебудовує форму або зберігає: EditBoxWidget не повідомляє про зміни, тож єдиний
    // надійний момент прочитати набране — саме перед тим, як воно знадобиться.
    void ReadWidgets()
    {
        for (int i = 0; i < m_Rows.Count(); i++)
        {
            ZP_FormRow r = m_Rows[i];
            if (r.Kind == ZP_FK.BOOL)
            {
                if (r.WCheck)
                    r.ValBool = r.WCheck.IsChecked();
                continue;
            }
            // Вибрані з переліку значення вже лежать у ValStr — їх кладе туди сам перелік,
            // читати з кнопки нічого не треба (та й у ній лежить підпис «( не задано )»).
            if (r.Kind == ZP_FK.COMBO || r.Kind == ZP_FK.CLASS || r.Kind == ZP_FK.READONLY)
                continue;
            if (r.Kind == ZP_FK.TEXTAREA)
            {
                if (r.WEditBig)
                {
                    string big;
                    r.WEditBig.GetText(big);
                    if (big != r.ShownStr)
                        r.ValStr = big;
                }
                continue;
            }
            // EditBoxWidget.GetText ПОВЕРТАЄ рядок (enwidgets.c:349), на відміну від
            // MultilineEditBoxWidget, у якого він через out-параметр. Переплутати легко.
            //
            // Беремо набране ЛИШЕ якщо воно відрізняється від того, що поле показало саме.
            // Інакше значення, яке рушій зіпсував при відображенні (рядок із '#'), поїхало б
            // назад у конфіг зіпсованим — і саме це псувало колір типу балів при кожному
            // «Застосувати», навіть коли адмін нічого не чіпав.
            if (r.WEdit)
            {
                string t = r.WEdit.GetText();
                if (t != r.ShownStr)
                    r.ValStr = t;
            }
        }
    }

    // Рядок, якому належить натиснута кнопка (і яка саме) — щоб господар знав, що робити.
    ZP_FormRow RowOf(Widget w, out int what)
    {
        what = 0;   // 1 = відкрити перелік, 2 = додати, 3 = прибрати
        for (int i = 0; i < m_Rows.Count(); i++)
        {
            ZP_FormRow r = m_Rows[i];
            if (w == r.WValue) { what = 1; return r; }
            if (w == r.WAdd)  { what = 2; return r; }
            if (w == r.WDel)  { what = 3; return r; }
        }
        return null;
    }

    // Куди покласти обраний у переліку клас (запам'ятовується на час показу переліку).
    ZP_FormRow FindRow(string arrayKey, int index, string key)
    {
        for (int i = 0; i < m_Rows.Count(); i++)
        {
            ZP_FormRow r = m_Rows[i];
            if (r.ArrayKey == arrayKey && r.Index == index && r.Key == key)
                return r;
        }
        return null;
    }
}

#endif
