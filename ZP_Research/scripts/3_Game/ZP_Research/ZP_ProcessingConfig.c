// Правила переробки: $profile:ZP_Research\ProcessingRules\*.json (тека = групи правил).
// M1: лише Mode="action", Input.Quantity=1; решта парситься, але пропускається з warning
// (форвард-сумісність схеми з дизайном §3). Шанси/вихідні предмети клієнту НЕ надсилаються.

class ZP_RuleInput
{
    string Classname;
    int Quantity = 1;
    bool ConsumeInput = true;
    // ДРУГЕ ВИМІРЯННЯ СПІВСТАВЛЕННЯ. Порожньо = вимоги немає (правило бере предмет за
    // класом, як і раніше). Непорожньо = вхід мусить бути ЗРАЗКОМ саме з таким вмістом.
    // Клас при цьому все одно перевіряється: одного вмісту мало, бо вміст є лише у зразка.
    string Content = "";
}

class ZP_RuleOutput
{
    string Classname;
    int Quantity = 1;
    float Chance = 1.0;
    // Що записати у ВИРОБЛЕНИЙ зразок. Саме це робить правило пакувальником:
    // сировина (чужий мод) -> зразок із вмістом -> станція аналізу -> заготовка.
    string Content = "";
}

// Бали приладами НЕ нараховуються (рішення власника). Прилад виробляє НОСІЙ дослідження,
// і бали в пул фракції дає лише здача носія на терміналі — інакше носій був би зайвою
// ланкою, а супертип не мав би на чому «висіти».

class ZP_RuleConsumable
{
    string Classname;
    int Quantity = 1;
    string Content = "";      // те саме друге вимірювання, що й у входу
}

// Відкатів і добових лімітів НЕМАЄ (рішення власника). Обмежувач — ЗАЙНЯТІСТЬ станції:
// поки вона працює, другу партію не прийме, а тривалість задає саме правило, тобто
// залежить від сировини. Кіготь химери й хвіст щура на одному приладі — це два різні
// правила з різним TimeSec. Старі ключі Cooldown/DailyCap у JSON ігноруються завантажувачем.
//
// Наслідок, ухвалений свідомо: у режимі «в руках» (hold-F) зайнятості немає, тож туди
// ставимо лише дешеву й швидку сировину, а все цінне — через фонові станції.

class ZP_Rule
{
    string Id;
    bool Enabled = true;               // M3.5: вимкнено = валідується й живе в агрегаті, але не матчиться і не надсилається клієнтам
    string Device;                     // classname (IsKindOf); суфікс "|1" = точний збіг
    // Режим лишився ОДИН — фонова станція. Поле збережено, щоб наявні конфіги читались і
    // адмін бачив зрозумілу відмову, а не мовчазне зникнення правила; типове значення
    // змінено, щоб правило без цього рядка працювало.
    string Mode = "background";
    // назва InputItem, а не Input — конфлікт із рушійним class Input (перевірено компілятором)
    ref ZP_RuleInput InputItem = new ZP_RuleInput();
    // БАЗОВА ЧИСТОТА правила-пакувальника: частка, яку дає ідеальна сировина на голому
    // приладі. Навмисно МЕНША за одиницю — інакше бездоганний матеріал одразу давав би
    // максимум, і модулі були б непотрібні саме там, де гравець приніс добрий зразок.
    // Стеля відсутня свідомо (рішення власника): з добрими модулями вихід можна зробити
    // гарантованим, обмежена лише підсумкова ЙМОВІРНІСТЬ.
    //
    // ДІАПАЗОН, А НЕ ЧИСЛО (рішення власника 2026-08-03): кожен цикл кидає своє значення
    // між Min і Max. Рівні кінці = фіксована чистота, тож «просто число» описується
    // тим самим полем. Кидок робиться ОДИН раз при старті циклу й заморожується разом
    // з рештою — інакше результат залежав би від того, коли саме на нього подивитись.
    float BasePurityMin = 0.5;
    float BasePurityMax = 0.5;
    float TimeSec = 10;
    ref array<ref ZP_RuleConsumable> Consumables = new array<ref ZP_RuleConsumable>();
    ref array<ref ZP_RuleOutput> Outputs = new array<ref ZP_RuleOutput>();
    string RequiredNode = "";                                 // ЄДИНИЙ гейт правила деревом (дизайн §3)
    ref array<string> RequiredFactions = new array<string>();   // хто може виконувати (порожньо = усі)
    ref array<string> RequiredWorn = new array<string>();       // M5b: одягнено ВСЕ зі списку (IsKindOf, "|1" = точний клас)
    // M8: у СЛОТАХ ПРИЛАДУ стоять усі названі інструменти. Не витрачаються — це гейт
    // можливості переробки, а не витратний матеріал (модулі чистоти — окреме поняття).
    ref array<string> RequiredTools = new array<string>();
    string Notes;
}

// Формат одного файлу в теці ProcessingRules
class ZP_RulesFile
{
    int ConfigVersion = 1;
    ref array<ref ZP_Rule> Rules = new array<ref ZP_Rule>();

    void SetDefaults()
    {
        // Демо-правило-ПАКУВАЛЬНИК: сировина з карго станції -> зразок із вмістом.
        // Саме такий вигляд має перша ланка ланцюжка; аналіз зразка описує вже наступне
        // правило, вхід якого вимагає того самого Content.
        ZP_Rule r = new ZP_Rule();
        r.Id = "demo_pack_apple";
        r.Device = "ZP_SampleFridge";
        r.Mode = "background";
        r.InputItem.Classname = "Apple";
        r.InputItem.Quantity = 1;
        r.InputItem.ConsumeInput = true;
        r.TimeSec = 10;

        ZP_RuleOutput o = new ZP_RuleOutput();
        o.Classname = "ZP_Sample";
        o.Quantity = 1;
        o.Chance = 1.0;
        o.Content = "demo_apple";
        r.Outputs.Insert(o);

        r.Notes = "демо-пакувальник: яблуко з карго -> зразок із вмістом demo_apple; замініть своїм контентом. Бали дає не прилад, а здача заготовки на терміналі";
        Rules.Insert(r);
    }
}

// Агрегат усіх правил у пам'яті (runtime, не серіалізується цілком)
class ZP_ProcessingRules
{
    // Нижня межа тривалості циклу (рішення власника). Захищає і від миттєвої переробки,
    // і від навантаження: конвеєр перезапускається сам, тож правило на частку секунди
    // крутило б станцію з частотою підлоги таймера. Діє і як відмова у валідації, і як
    // затискач у рантаймі — щоб жоден шлях (редактор, правка JSON на живому сервері) не
    // проліз повз.
    static const float MIN_TIME_SEC = 5;

    // єдине місце, що вирішує фактичну тривалість циклу
    static float EffectiveTimeSec(float configured)
    {
        if (configured < MIN_TIME_SEC)
            return MIN_TIME_SEC;
        return configured;
    }

    ref array<ref ZP_Rule> Rules = new array<ref ZP_Rule>();
    ref map<string, ref ZP_RulesFile> RuleFiles = new map<string, ref ZP_RulesFile>();   // fileName -> файл (M3.5 ops)
    ref map<string, string> RuleFileOf = new map<string, string>();                       // ruleId -> fileName (лише валідні)

    // матчинг classname за конфіг-записом: IsKindOf, суфікс "|1" = лише точний збіг
    static bool MatchClass(string actualType, string configured)
    {
        if (configured == "")
            return false;
        int sep = configured.IndexOf("|");
        if (sep > -1)
        {
            // кейс-інсенситив, як і всі config-lookup'и (інакше правило з хибним
            // регістром пройшло б валідацію, але ніколи б не спрацювало)
            string exact = configured.Substring(0, sep);
            exact.ToLower();
            string actual = actualType;
            actual.ToLower();
            return actual == exact;
        }
        return GetGame().IsKindOf(actualType, configured);
    }

    // ЄДИНА ТОЧКА СПІВСТАВЛЕННЯ ВХОДУ. Класів матчингу два: клас предмета і вміст зразка,
    // і розійтися вони не можуть, бо місце одне. Аудит нарахував ВІСІМ місць, де раніше
    // дивилися лише на клас; пропуск будь-якого означав би «станція з'їла не той зразок».
    //
    // actualContent приходить ПАРАМЕТРОМ, а не читається з предмета: ZP_Sample живе в
    // 4_World, а цей файл — у 3_Game, і знизу вгору видимості немає. Викликач (він завжди
    // у 4_World) робить один каст.
    static bool MatchInput(string actualType, string actualContent, string configuredClass, string configuredContent)
    {
        if (!MatchClass(actualType, configuredClass))
            return false;
        if (configuredContent == "")
            return true;        // вимоги до вмісту немає — правило бере предмет за класом
        string want = configuredContent;
        want.ToLower();
        string have = actualContent;
        have.ToLower();
        return have == want;
    }

    // чи існує клас у БУДЬ-ЯКОМУ з п'яти config-коренів, які бачить IsKindOf
    // (game.c:1412: CfgVehicles, CfgAmmo, CfgMagazines, cfgWeapons, CfgNonAIVehicles)
    static bool ClassExists(string cls)
    {
        if (GetGame().ConfigIsExisting("CfgVehicles " + cls))
            return true;
        if (GetGame().ConfigIsExisting("CfgAmmo " + cls))
            return true;
        if (GetGame().ConfigIsExisting("CfgMagazines " + cls))
            return true;
        if (GetGame().ConfigIsExisting("cfgWeapons " + cls))
            return true;
        if (GetGame().ConfigIsExisting("CfgNonAIVehicles " + cls))
            return true;
        return false;
    }

    ZP_Rule FindById(string id)
    {
        foreach (ZP_Rule r : Rules)
        {
            if (r.Id == id)
                return r;
        }
        return null;
    }

    // Додає валідні правила файлу. skip+warn: невідомі класи/тип балів, TimeSec<=0,
    // Quantity!=1, Mode!="action" (живучість: правило під чужий мод не валить конфіг).
    // Жорстка помилка (false, reload відхиляється): дубль Id.
    bool AddFileRules(ZP_RulesFile f, string fileLabel, string fileName, ZP_PointTypesConfig pointTypes, out string hardErr)
    {
        hardErr = "";
        if (RuleFiles.Contains(fileName))
        {
            hardErr = fileLabel + ": файл '" + fileName + "' вже зареєстровано";
            return false;
        }
        RuleFiles.Set(fileName, f);
        foreach (ZP_Rule r : f.Rules)
        {
            if (!r)
                continue;
            if (r.Id == "")
            {
                ZP_Log.Warn(fileLabel + ": правило без Id пропущено");
                continue;
            }
            // ЧИСТОТА 0 = ПРАВИЛО МЕРТВЕ, І ЦЕ МАЙЖЕ ЗАВЖДИ НЕ НАВМИСНО.
            //
            // Типове значення поля (0.5) НЕ переживає розбір JSON: якщо ключа у файлі немає,
            // завантажувач лишає нуль, а не ініціалізатор класу. Живий тест: у test_micro.json
            // ключів BasePurity ніколи не було, і всі три правила приїхали з 0.0 — тобто
            // пакувальник робив би зразки нульової чистоти, а аналіз із них не давав би нічого
            // взагалі (шанс множиться на чистоту входу). На місці це виглядає як «правило є,
            // станція крутиться, результату немає».
            //
            // Тому нуль трактуємо як «не задано» й підставляємо типове, але ГУЧНО: інакше
            // тиха підміна ховала б від адміна те, що його файл застарів.
            if (r.BasePurityMax <= 0)
            {
                ZP_Log.Warn(fileLabel + ": правило '" + r.Id + "' без BasePurity — узято типове 0.5 (нуль означав би, що правило нічого не дає)");
                r.BasePurityMin = 0.5;
                r.BasePurityMax = 0.5;
            }
            bool dup = false;
            foreach (ZP_Rule existing : Rules)
            {
                if (existing.Id == r.Id)
                    dup = true;
            }
            if (dup)
            {
                hardErr = fileLabel + ": дубль Id правила '" + r.Id + "'";
                return false;
            }
            string skipReason = ValidateRule(r, pointTypes);
            if (skipReason != "")
            {
                ZP_Log.Warn(fileLabel + ": правило '" + r.Id + "' пропущено: " + skipReason);
                continue;
            }
            Rules.Insert(r);
            RuleFileOf.Set(r.Id, fileName);
        }
        return true;
    }

    // public: ops валідують правило ДО мутації (той самий код, що й завантаження — без дрейфу)
    string ValidateRule(ZP_Rule r, ZP_PointTypesConfig pointTypes)
    {
        // Режим один — фонова станція. Правила Mode="action" (переробка з рук) відхиляються:
        // дію прибрано разом із польовими інструментами (рішення власника 2026-08-03).
        // Відхиляємо з поясненням, а не мовчки: старі конфіги в адміна лишились.
        string mode = r.Mode;
        mode.ToLower();
        if (mode != "background")
            return "Mode '" + r.Mode + "' більше не підтримується: переробка йде лише через станцію (Mode=background, сировина в карго)";
        if (r.TimeSec < MIN_TIME_SEC)
            return "TimeSec менший за мінімум " + MIN_TIME_SEC + " с";
        // Межа не про баланс, а про друкарську помилку: зайвий нуль зробив би будь-який
        // шанс достовірністю, і побачити це в грі не було б як.
        if (r.BasePurityMin < 0 || r.BasePurityMin > 2)
            return "BasePurityMin поза межами [0..2]";
        if (r.BasePurityMax < 0 || r.BasePurityMax > 2)
            return "BasePurityMax поза межами [0..2]";
        // Переставляти кінці мовчки не можна: переставлений діапазон — це майже завжди
        // описка, і тихе виправлення приховало б її разом із рештою помилок у цьому правилі.
        if (r.BasePurityMax < r.BasePurityMin)
            return "BasePurityMax менший за BasePurityMin";
        if (r.TimeSec > 604800)
            return "TimeSec > 7 діб";
        foreach (string rt : r.RequiredTools)
        {
            if (rt == "" || !ClassExists(StripExact(rt)))
                return "невідомий клас у RequiredTools: '" + rt + "'";
        }
        foreach (string rw : r.RequiredWorn)
        {
            if (rw == "" || !ClassExists(StripExact(rw)))
                return "невідомий клас у RequiredWorn: '" + rw + "'";
        }
        if (!r.InputItem || r.InputItem.Classname == "")
            return "немає InputItem.Classname";
        if (r.InputItem.Quantity < 1 || r.InputItem.Quantity > 100)
            return "InputItem.Quantity поза межами [1..100]";
        string inContentErr = ValidateContent("InputItem", r.InputItem.Classname, r.InputItem.Content);
        if (inContentErr != "")
            return inContentErr;
        foreach (ZP_RuleConsumable c : r.Consumables)
        {
            if (!c || c.Classname == "" || !ClassExists(StripExact(c.Classname)))
                return "невідомий Consumable";
            if (c.Quantity < 1 || c.Quantity > 100)
                return "Consumable.Quantity поза межами [1..100]";
            string conContentErr = ValidateContent("Consumable", c.Classname, c.Content);
            if (conContentErr != "")
                return conContentErr;
            // набої розсипом зберігають лік у GetAmmoCount, а не в quantity — списання видалило б
            // усю пачку цілком; повноцінна підтримка Magazine — згодом
            if (GetGame().ConfigIsExisting("CfgMagazines " + StripExact(c.Classname)))
                return "Consumable з CfgMagazines (набої/магазини) поки не підтримується";
        }
        if (GetGame().ConfigIsExisting("CfgMagazines " + StripExact(r.InputItem.Classname)))
            return "InputItem з CfgMagazines (набої/магазини) поки не підтримується";
        string devBase = StripExact(r.Device);
        if (!ClassExists(devBase))
            return "невідомий Device '" + r.Device + "'";
        string inBase = StripExact(r.InputItem.Classname);
        if (!ClassExists(inBase))
            return "невідомий Input '" + r.InputItem.Classname + "'";
        foreach (ZP_RuleOutput o : r.Outputs)
        {
            if (!o || !ClassExists(o.Classname))
                return "невідомий Output";
            if (o.Chance < 0 || o.Chance > 1)
                return "Output.Chance поза межами [0..1]";
            if (o.Quantity < 1 || o.Quantity > 100)
                return "Output.Quantity поза межами [1..100]";
            string outContentErr = ValidateContent("Output", o.Classname, o.Content);
            if (outContentErr != "")
                return outContentErr;
            // Зразок без вмісту — глухий кут: його не візьме жодне правило з вимогою вмісту,
            // а сам він нічим не відрізняється від решти. Майже завжди це забутий рядок
            // конфігу, тож ловимо тут, а не в грі через тиждень.
            if (IsSampleClass(o.Classname) && o.Content == "")
                return "вихід '" + o.Classname + "' без Content: такий зразок не зможе прийняти жодне правило";
        }
        // ConsumeInput=false У ФОНОВОМУ РЕЖИМІ ЗАБОРОНЕНО (рішення власника).
        // Причина — автопродовження: станція сама бере наступну партію, поки сировина в
        // карго, а неспоживаний вхід із карго не зникає ніколи. Один предмет крутився б
        // вічно, видаючи вихід щоцикл, і єдиним обмежувачем лишався б час циклу.
        // У режимі «в руках» прапорець працює як задумано: там немає автоповтору, і
        // обмежувачем є сам гравець.
        if (mode == "background" && r.InputItem && !r.InputItem.ConsumeInput)
            return "ConsumeInput=false недопустимий для Mode=background (нескінченний конвеєр); приберіть прапорець або зробіть правило action";
        return "";
    }

    // Вміст має сенс ЛИШЕ у зразка: усі інші предмети такого поля не мають, і вимога до
    // вмісту на них означала б правило, яке не спрацює ніколи й нічим цього не покаже.
    //
    // РОДИНА, А НЕ ОДИН КЛАС (W2.5 T1): IsKindOf перевіряє config-ієрархію, тож ловить
    // одразу ZP_Sample (сумісний клас) і ZP_Sample_01..30 (тридцять донорів моделі) —
    // усі вони : ZP_Sample_Base. Перевірка на "ZP_Sample" замість "ZP_Sample_Base" відхиляла
    // б Content для будь-якого з тридцяти нових класів — саме той дефект, заради якого
    // W2.5 T1 грепом шукав кожне місце «лише ZP_Sample» у моді.
    static bool IsSampleClass(string configured)
    {
        return GetGame().IsKindOf(StripExact(configured), "ZP_Sample_Base");
    }

    static string ValidateContent(string where, string classname, string content)
    {
        if (content == "")
            return "";
        if (!IsSampleClass(classname))
            return where + ": Content задано для '" + classname + "', але вміст мають лише зразки (родина ZP_Sample_Base)";
        if (content.Length() > 64)
            return where + ": Content довший за 64 символи";
        // Пробіл на краю невидимий в очі, але робить рядок іншим — правило мовчки перестало б
        // збігатися саме з тим зразком, який під нього створювали.
        string trimmed = content;
        trimmed.TrimInPlace();
        if (trimmed != content)
            return where + ": Content '" + content + "' має пробіл на початку або в кінці";
        return "";
    }

    // public: суфікс "|1" треба зрізати всюди, де класнейм іде в ConfigIsExisting —
    // не лише в правилах (реєстр модулів робить те саме)
    static string StripExact(string configured)
    {
        int sep = configured.IndexOf("|");
        if (sep > -1)
            return configured.Substring(0, sep);
        return configured;
    }
}
