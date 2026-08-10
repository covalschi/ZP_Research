class ZP_KV
{
    string K;
    int V;

    void ZP_KV(string k = "", int v = 0)
    {
        K = k;
        V = v;
    }
}

class ZP_PointType
{
    string Id;
    string Name;
    string Icon;
    string Color;
    int SortOrder;
    // Категорія напрямку: bio | anomaly | electronics (довільний рядок — адмін може додати свої)
    string Category;
    // Вид здобуття: field (польові) | lab (лабораторні)
    string Kind;
    // Тир складності: 1..3 (польові дані 1 тиру дешеві, лабораторні 3 тиру — рідкість)
    int Tier;
}

// Урізане правило для клієнта: лише те, що потрібне для промпту й тривалості.
// Шанси/вихідні предмети/бали НЕ йдуть клієнту (анти-чит).
class ZP_ClientRule
{
    string Id;
    string Device;
    string Mode;               // лишився один режим (background); поле тримаємо для сумісності знімка
    // Вхід клієнту НЕ надсилається. Промпт «Запустити аналіз» гейтиться приладом і гейтами
    // правила, а що саме лежить у карго, вирішує сервер: клієнту нема чого показувати, а
    // перелік сировини чужої фракції — зайва підказка. Вміст зразка тим паче: він прихований.
    float TimeSec;
    string RequiredNode;                                                                 // гейт деревом (клієнт перевіряє за SyncTree)
    ref array<string> RequiredFactions = new array<string>();
    ref array<string> RequiredWorn = new array<string>();
    ref array<string> RequiredTools = new array<string>();   // інструменти в слотах приладу                                // M5b: гейт спорядженням (клієнтський промпт)
}

// Заготовка результату для клієнта: лише те, що видно очима. Бали й супертип клієнту НЕ
// йдуть — нарахування рахує сервер, а супертип нічого не дає гравцеві, крім здогадів.
//
// Надсилається ВСІМ без фракційного фільтра, і це не витік: назва предмета в чужому рюкзаку
// й так видима. Навпаки, фільтр тут шкідливий — бандит із трофейними науковими даними
// побачив би «не налаштовано» і мав би повне право вважати це поломкою.
class ZP_ClientDataItem
{
    string Id;
    string Name;
    string Description;
    bool Depositable;      // чи має заготовка хоч один ЧИННИЙ тип балів (рахує сервер)
}

// Тип зразка для клієнта: лише те, що видно людині — назва й опис. Прихований Content
// (що саме запаковано) і чистота НЕ йдуть: зразок читає МАШИНА, гравцеві досить назви.
//
// Надсилається ВСІМ без фракційного фільтра — та сама причина, що й у заготовок: назву
// предмета в чужому рюкзаку і так видно, а фільтр тут лише зробив би трофейний зразок
// схожим на поламаний. Points/Depositable тут немає — зразок не здається напряму.
class ZP_ClientSampleType
{
    string Id;
    string Name;
    string Description;
}

// фракційний стан дерева для клієнта (надсилається індивідуально, не в загальному конфігу)
class ZP_TreeSync
{
    string FactionClass;
    ref array<string> CompletedNodes = new array<string>();
    // M4 UI: активні проєкти (паралельні масиви) + пул фракції для шапки дерева
    ref array<string> ResearchingNodes = new array<string>();
    ref array<int> ResearchingEnds = new array<int>();
    ref array<ref ZP_KV> PoolPoints = new array<ref ZP_KV>();
}

// вузол дерева для клієнта (M4 UI): структура не таємна — статуси все одно фракційні,
// сервер авторитетний у research
class ZP_ClientNode
{
    string Id;
    string Name;
    string Description;
    string Icon;
    int Tier;
    string BranchId;
    ref array<string> Parents = new array<string>();
    string ParentsMode;
    ref array<ref ZP_KV> Cost = new array<ref ZP_KV>();
    ref array<ref ZP_RuleConsumable> ItemCost = new array<ref ZP_RuleConsumable>();
    int ResearchTimeSec;
    ref array<string> RequiredFactions = new array<string>();
}

class ZP_ClientBranch
{
    string Id;
    string Name;
    int SortOrder;
}

// Урізана серверна конфігурація, що йде кожному клієнту (whole-object Param1 RPC).
// ЖОДНИХ map<> усередині — не переживають RPC-серіалізацію.
class ZP_ClientConfig
{
    int Revision;
    bool DebugMode;    // не "Debug" — конфлікт із ванільним class Debug (перевірено компілятором)
    ref array<ref ZP_PointType> PointTypes = new array<ref ZP_PointType>();
    // підписи й порядок вимірів: клієнт більше не знає жодної назви сам
    ref array<ref ZP_PointDimension> PointCategories = new array<ref ZP_PointDimension>();
    ref array<ref ZP_PointDimension> PointKinds = new array<ref ZP_PointDimension>();
    ref array<ref ZP_ClientRule> Rules = new array<ref ZP_ClientRule>();
    ref array<ref ZP_ClientDataItem> DataItems = new array<ref ZP_ClientDataItem>();
    ref array<ref ZP_ClientSampleType> SampleTypes = new array<ref ZP_ClientSampleType>();
    // M4 UI дерева
    ref array<ref ZP_ClientNode> Nodes = new array<ref ZP_ClientNode>();
    ref array<ref ZP_ClientBranch> Branches = new array<ref ZP_ClientBranch>();
    // класи приладів-терміналів дерева (клієнтський бік промпту «Відкрити дерево досліджень»)
    ref array<string> TreeTerminalClasses = new array<string>();
    // Прилади фракції. DeviceClassesSplit=false означає «поділу немає, доступні всі» —
    // порожній перелік сам по собі неоднозначний, тож ознака йде окремим прапорцем.
    bool DeviceClassesSplit;
    ref array<string> DeviceClasses = new array<string>();
    int TreeVisibilityDepth;
    string TreeBackgroundImage;
}

class ZP_Op_SetSetting
{
    string Key;
    string Value;
}

class ZP_Op_UpsertNode
{
    string BranchId;
    ref ZP_TreeNode NodeData = new ZP_TreeNode();
}

class ZP_Op_DeleteNode
{
    string NodeId;
}

class ZP_Op_UpsertRule
{
    string FileName;                              // наявний файл ProcessingRules\ (створення файлів — фаза 2)
    ref ZP_Rule RuleData = new ZP_Rule();
}

class ZP_Op_DeleteRule
{
    string RuleId;
}

class ZP_Op_DeleteFaction
{
    string FactionId;
}

// Ключ інструмента — його клас вкладення; окремого Id у реєстрі модулів немає.
class ZP_Op_DeleteModule
{
    string Classname;
}

class ZP_Op_ResetFaction
{
    string FactionClass;                          // порожньо = Settings.DefaultFaction
}

// ---- транспорт адмін-знімка (M3.5): JSON-рядками, map не переживає RPC ----

class ZP_SnapRuleEntry
{
    string FileName;
    ref ZP_Rule Rule = new ZP_Rule();
}

class ZP_SnapRules
{
    ref array<ref ZP_SnapRuleEntry> Entries = new array<ref ZP_SnapRuleEntry>();
}

class ZP_SnapNodeEntry
{
    string BranchId;
    ref ZP_TreeNode Node = new ZP_TreeNode();
}

class ZP_SnapNodes
{
    ref array<ref ZP_SnapNodeEntry> Entries = new array<ref ZP_SnapNodeEntry>();
}
