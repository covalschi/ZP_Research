// Дерево технологій: $profile:ZP_Research\TechTree\*.json (файл = гілка).
// Вузол ніде не перелічує «що він відкриває» — правила посилаються на нього через
// RequiredNode (дизайн §4). Стан дерева — фракційний (ZP_FactionDB).

class ZP_TreeCost
{
    string Type;       // Id типу балів
    int Amount;
}

class ZP_TreeItemCost
{
    string Classname;
    int Quantity = 1;
    // Те саме друге вимірювання, що й у правил: вузол може коштувати не «якийсь зразок»,
    // а зразок саме такого вмісту. Порожньо = вимоги немає.
    string Content = "";
}

class ZP_TreeNode
{
    string Id;
    string Name;
    string Description;
    string Icon;
    int Tier = 1;                                              // лише відображення (дизайн §4)
    ref array<string> Parents = new array<string>();
    string ParentsMode = "all";                                // all | any
    ref array<ref ZP_TreeCost> Cost = new array<ref ZP_TreeCost>();
    ref array<ref ZP_TreeItemCost> ItemCost = new array<ref ZP_TreeItemCost>();
    int ResearchTimeSec = 0;                                   // 0 = миттєво; >0 = проєкт
    // ResearchDevice СКАСОВАНО: вимога «прилад поруч» зараховувала й чужий прилад, а
    // матеріали тепер беруться з карго ВЛАСНОГО термінала (ItemCost). Поле лишається в
    // старих JSON — завантажувач його просто ігнорує.
    ref array<string> RequiredFactions = new array<string>();  // хто може досліджувати (порожньо = усі)
}

class ZP_TreeBranchInfo
{
    string Id;
    string Name;
    string Icon;
    int SortOrder;
    // Кому належить гілка. ПОРОЖНЬО = спільна для всіх (свідомий вибір адміна, напр.
    // загальні базові технології). Належність вузла визначає САМЕ гілка: вузол без
    // власного переліку фракцій успадковує перелік гілки, а не стає доступним усім.
    ref array<string> Factions = new array<string>();
}

// формат одного файлу-гілки
class ZP_TechTreeFile
{
    int ConfigVersion = 1;
    ref ZP_TreeBranchInfo Branch = new ZP_TreeBranchInfo();
    ref array<ref ZP_TreeNode> Nodes = new array<ref ZP_TreeNode>();

    // SetDefaults НЕМАЄ навмисно: вбудованого дерева мод не постачає (рішення власника).
    // Гілки описує адмін у теці TechTree, файл = гілка.
}

// агрегат дерева в пам'яті
class ZP_TechTreeConfig
{
    ref array<ref ZP_TreeNode> Nodes = new array<ref ZP_TreeNode>();
    ref map<string, string> NodeBranch = new map<string, string>();    // nodeId -> branchId
    ref map<string, ref ZP_TechTreeFile> Branches = new map<string, ref ZP_TechTreeFile>(); // branchId -> файл (для збереження)
    ref map<string, string> BranchFiles = new map<string, string>();   // branchId -> ім'я файлу

    ZP_TreeNode FindNode(string id)
    {
        foreach (ZP_TreeNode n : Nodes)
        {
            if (n.Id == id)
                return n;
        }
        return null;
    }

    // Перелік фракцій ГІЛКИ (порожньо = спільна)
    array<string> BranchFactions(string branchId)
    {
        ZP_TechTreeFile bf;
        if (Branches.Find(branchId, bf) && bf && bf.Branch)
            return bf.Branch.Factions;
        return null;
    }

    // ЄДИНЕ місце, що вирішує належність вузла фракції. Правило: спершу гілка, потім вузол.
    // Вузол без власного переліку НЕ «доступний усім» — він успадковує перелік гілки
    // (дизайн кроку 4: інакше кожен новий вузол мовчки протікав би всім фракціям).
    // Власний перелік вузла звужує ще далі, всередині гілки.
    bool NodeBelongsTo(ZP_TreeNode node, string factionClass)
    {
        if (!node)
            return false;
        string branchId;
        NodeBranch.Find(node.Id, branchId);
        array<string> bf = BranchFactions(branchId);
        if (bf && bf.Count() > 0 && bf.Find(factionClass) < 0)
            return false;
        if (node.RequiredFactions.Count() > 0 && node.RequiredFactions.Find(factionClass) < 0)
            return false;
        return true;
    }

    bool BranchBelongsTo(string branchId, string factionClass)
    {
        array<string> bf = BranchFactions(branchId);
        if (bf && bf.Count() > 0 && bf.Find(factionClass) < 0)
            return false;
        return true;
    }

    // Додає валідні вузли файлу. skip+warn: биті Cost/ItemCost/прилад;
    // жорстка помилка (false, reload відхиляється): дубль Id вузла.
    bool AddFileNodes(ZP_TechTreeFile f, string fileLabel, string fileName, ZP_PointTypesConfig pointTypes, out string hardErr)
    {
        hardErr = "";
        if (!f.Branch || f.Branch.Id == "")
        {
            hardErr = fileLabel + ": немає Branch.Id";
            return false;
        }
        if (Branches.Contains(f.Branch.Id))
        {
            hardErr = fileLabel + ": дубль гілки '" + f.Branch.Id + "'";
            return false;
        }
        Branches.Set(f.Branch.Id, f);
        BranchFiles.Set(f.Branch.Id, fileName);
        foreach (ZP_TreeNode n : f.Nodes)
        {
            if (!n)
                continue;
            if (n.Id == "")
            {
                ZP_Log.Warn(fileLabel + ": вузол без Id пропущено");
                continue;
            }
            if (FindNode(n.Id))
            {
                hardErr = fileLabel + ": дубль Id вузла '" + n.Id + "'";
                return false;
            }
            string skipReason = ValidateNode(n, pointTypes);
            if (skipReason != "")
            {
                ZP_Log.Warn(fileLabel + ": вузол '" + n.Id + "' пропущено: " + skipReason);
                continue;
            }
            Nodes.Insert(n);
            NodeBranch.Set(n.Id, f.Branch.Id);
        }
        return true;
    }

    // public: ops валідують вузол ДО мутації (той самий код, що й завантаження — без дрейфу)
    string ValidateNode(ZP_TreeNode n, ZP_PointTypesConfig pointTypes)
    {
        if (n.Name == "")
            return "немає Name";
        string pm = n.ParentsMode;
        pm.ToLower();
        if (pm != "all" && pm != "any")
            return "ParentsMode '" + n.ParentsMode + "' (all|any)";
        ref map<string, bool> seenCost = new map<string, bool>();
        foreach (ZP_TreeCost c : n.Cost)
        {
            if (!c || !pointTypes.Find(c.Type))
                return "невідомий тип балів у Cost";
            if (c.Amount < 0 || c.Amount > 1000000)
                return "Cost.Amount поза межами [0..1000000]";
            // дубль типу: кожен запис Cost перевірявся б проти того самого
            // балансу — списання завело б пул/гравця в мінус
            if (seenCost.Contains(c.Type))
                return "дубль типу '" + c.Type + "' у Cost";
            seenCost.Set(c.Type, true);
        }
        foreach (ZP_TreeItemCost ic : n.ItemCost)
        {
            if (!ic || ic.Classname == "" || !ZP_ProcessingRules.ClassExists(ZP_StripExactHelper(ic.Classname)))
                return "невідомий клас у ItemCost";
            if (ic.Quantity < 1 || ic.Quantity > 100)
                return "ItemCost.Quantity поза межами [1..100]";
            string icContentErr = ZP_ProcessingRules.ValidateContent("ItemCost", ic.Classname, ic.Content);
            if (icContentErr != "")
                return icContentErr;
        }
        if (n.ResearchTimeSec < 0 || n.ResearchTimeSec > 2592000)
            return "ResearchTimeSec поза межами [0..30 діб]";
        return "";
    }

    protected static string ZP_StripExactHelper(string configured)
    {
        int sep = configured.IndexOf("|");
        if (sep > -1)
            return configured.Substring(0, sep);
        return configured;
    }

    // пост-валідація зв'язності: Parents існують; недосяжні вузли — warn (не skip:
    // адмін може лагодити покроково, стан фракцій не повинен руйнуватися)
    void ValidateGraph()
    {
        foreach (ZP_TreeNode n : Nodes)
        {
            foreach (string p : n.Parents)
            {
                if (!FindNode(p))
                    ZP_Log.Warn("вузол '" + n.Id + "': батьківський вузол '" + p + "' не існує — вузол недосяжний");
            }
        }
        array<string> unreachable = new array<string>();
        GetUnreachable(unreachable);
        foreach (string uid : unreachable)
        {
            ZP_Log.Warn("вузол '" + uid + "' недосяжний (цикл або биті батьківські вузли)");
        }
    }

    // список недосяжних вузлів (фікспойнт). Ops порівнюють до/після мутації:
    // редактор не повинен мовчки самоблокувати дерево циклом або битим батьківським вузлом
    void GetUnreachable(out array<string> unreachable)
    {
        unreachable = new array<string>();
        ref map<string, bool> reachable = new map<string, bool>();
        bool changed = true;
        while (changed)
        {
            changed = false;
            foreach (ZP_TreeNode n2 : Nodes)
            {
                if (reachable.Contains(n2.Id))
                    continue;
                if (IsReachableGiven(n2, reachable))
                {
                    reachable.Set(n2.Id, true);
                    changed = true;
                }
            }
        }
        foreach (ZP_TreeNode n3 : Nodes)
        {
            if (!reachable.Contains(n3.Id))
                unreachable.Insert(n3.Id);
        }
    }

    protected bool IsReachableGiven(ZP_TreeNode n, map<string, bool> reachable)
    {
        if (n.Parents.Count() == 0)
            return true;
        string pm = n.ParentsMode;
        pm.ToLower();
        int okCount = 0;
        foreach (string p : n.Parents)
        {
            if (reachable.Contains(p))
                okCount++;
        }
        if (pm == "any")
            return okCount > 0;
        return okCount == n.Parents.Count();
    }
}
