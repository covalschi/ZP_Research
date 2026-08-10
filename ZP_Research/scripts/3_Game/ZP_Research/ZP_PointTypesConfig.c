// ПІДПИСИ ВИМІРІВ. Категорія («біологія», «бойові») і вид («польові», «лабораторні») —
// це рядки АДМІНА, а не мода: він вигадує їх сам, і жодного зашитого переліку бути не може.
// Раніше переклад лежав таблицею в клієнтському вікні (bio -> «Біологія» і т. д.), тож
// будь-яка нова категорія показувалась сирим ідентифікатором — і полагодити це адмін не міг
// ніяк, бо таблиця була в скомпільованому коді.
//
// SortOrder тут визначає ПОРЯДОК БЛОКІВ у колонці балів: без нього блоки йшли в порядку
// першої появи типу, тобто залежали від того, як адмін перетасував записи у файлі.
class ZP_PointDimension
{
    string Id;
    string Name;
    int SortOrder;
}

class ZP_PointTypesConfig
{
    int ConfigVersion = 1;
    ref array<ref ZP_PointType> PointTypes = new array<ref ZP_PointType>();
    ref array<ref ZP_PointDimension> Categories = new array<ref ZP_PointDimension>();
    ref array<ref ZP_PointDimension> Kinds = new array<ref ZP_PointDimension>();

    // Типи балів: КАТЕГОРІЯ (біологія / аномалії / електроніка) x ВИД (польове / лабораторне)
    // x ТИР (1..3). Адмін може додати власні типи — це лише типові значення першого запуску.
    void SetDefaults()
    {
        ZP_PointType p1 = new ZP_PointType();
        p1.Id = "bio_field_t1";
        p1.Name = "Польове дослідження біології 1 тиру";
        p1.Icon = "";
        p1.Color = "#7CB342";
        p1.SortOrder = 1;
        p1.Category = "bio";
        p1.Kind = "field";
        p1.Tier = 1;
        PointTypes.Insert(p1);
        ZP_PointType p2 = new ZP_PointType();
        p2.Id = "bio_field_t2";
        p2.Name = "Польове дослідження біології 2 тиру";
        p2.Icon = "";
        p2.Color = "#7CB342";
        p2.SortOrder = 2;
        p2.Category = "bio";
        p2.Kind = "field";
        p2.Tier = 2;
        PointTypes.Insert(p2);
        ZP_PointType p3 = new ZP_PointType();
        p3.Id = "bio_field_t3";
        p3.Name = "Польове дослідження біології 3 тиру";
        p3.Icon = "";
        p3.Color = "#7CB342";
        p3.SortOrder = 3;
        p3.Category = "bio";
        p3.Kind = "field";
        p3.Tier = 3;
        PointTypes.Insert(p3);
        ZP_PointType p4 = new ZP_PointType();
        p4.Id = "bio_lab_t1";
        p4.Name = "Лабораторне дослідження біології 1 тиру";
        p4.Icon = "";
        p4.Color = "#7CB342";
        p4.SortOrder = 4;
        p4.Category = "bio";
        p4.Kind = "lab";
        p4.Tier = 1;
        PointTypes.Insert(p4);
        ZP_PointType p5 = new ZP_PointType();
        p5.Id = "bio_lab_t2";
        p5.Name = "Лабораторне дослідження біології 2 тиру";
        p5.Icon = "";
        p5.Color = "#7CB342";
        p5.SortOrder = 5;
        p5.Category = "bio";
        p5.Kind = "lab";
        p5.Tier = 2;
        PointTypes.Insert(p5);
        ZP_PointType p6 = new ZP_PointType();
        p6.Id = "bio_lab_t3";
        p6.Name = "Лабораторне дослідження біології 3 тиру";
        p6.Icon = "";
        p6.Color = "#7CB342";
        p6.SortOrder = 6;
        p6.Category = "bio";
        p6.Kind = "lab";
        p6.Tier = 3;
        PointTypes.Insert(p6);
        ZP_PointType p7 = new ZP_PointType();
        p7.Id = "anomaly_field_t1";
        p7.Name = "Польове дослідження аномалій 1 тиру";
        p7.Icon = "";
        p7.Color = "#AB47BC";
        p7.SortOrder = 7;
        p7.Category = "anomaly";
        p7.Kind = "field";
        p7.Tier = 1;
        PointTypes.Insert(p7);
        ZP_PointType p8 = new ZP_PointType();
        p8.Id = "anomaly_field_t2";
        p8.Name = "Польове дослідження аномалій 2 тиру";
        p8.Icon = "";
        p8.Color = "#AB47BC";
        p8.SortOrder = 8;
        p8.Category = "anomaly";
        p8.Kind = "field";
        p8.Tier = 2;
        PointTypes.Insert(p8);
        ZP_PointType p9 = new ZP_PointType();
        p9.Id = "anomaly_field_t3";
        p9.Name = "Польове дослідження аномалій 3 тиру";
        p9.Icon = "";
        p9.Color = "#AB47BC";
        p9.SortOrder = 9;
        p9.Category = "anomaly";
        p9.Kind = "field";
        p9.Tier = 3;
        PointTypes.Insert(p9);
        ZP_PointType p10 = new ZP_PointType();
        p10.Id = "anomaly_lab_t1";
        p10.Name = "Лабораторне дослідження аномалій 1 тиру";
        p10.Icon = "";
        p10.Color = "#AB47BC";
        p10.SortOrder = 10;
        p10.Category = "anomaly";
        p10.Kind = "lab";
        p10.Tier = 1;
        PointTypes.Insert(p10);
        ZP_PointType p11 = new ZP_PointType();
        p11.Id = "anomaly_lab_t2";
        p11.Name = "Лабораторне дослідження аномалій 2 тиру";
        p11.Icon = "";
        p11.Color = "#AB47BC";
        p11.SortOrder = 11;
        p11.Category = "anomaly";
        p11.Kind = "lab";
        p11.Tier = 2;
        PointTypes.Insert(p11);
        ZP_PointType p12 = new ZP_PointType();
        p12.Id = "anomaly_lab_t3";
        p12.Name = "Лабораторне дослідження аномалій 3 тиру";
        p12.Icon = "";
        p12.Color = "#AB47BC";
        p12.SortOrder = 12;
        p12.Category = "anomaly";
        p12.Kind = "lab";
        p12.Tier = 3;
        PointTypes.Insert(p12);
        ZP_PointType p13 = new ZP_PointType();
        p13.Id = "electronics_field_t1";
        p13.Name = "Польове дослідження електроніки 1 тиру";
        p13.Icon = "";
        p13.Color = "#29B6F6";
        p13.SortOrder = 13;
        p13.Category = "electronics";
        p13.Kind = "field";
        p13.Tier = 1;
        PointTypes.Insert(p13);
        ZP_PointType p14 = new ZP_PointType();
        p14.Id = "electronics_field_t2";
        p14.Name = "Польове дослідження електроніки 2 тиру";
        p14.Icon = "";
        p14.Color = "#29B6F6";
        p14.SortOrder = 14;
        p14.Category = "electronics";
        p14.Kind = "field";
        p14.Tier = 2;
        PointTypes.Insert(p14);
        ZP_PointType p15 = new ZP_PointType();
        p15.Id = "electronics_field_t3";
        p15.Name = "Польове дослідження електроніки 3 тиру";
        p15.Icon = "";
        p15.Color = "#29B6F6";
        p15.SortOrder = 15;
        p15.Category = "electronics";
        p15.Kind = "field";
        p15.Tier = 3;
        PointTypes.Insert(p15);
        ZP_PointType p16 = new ZP_PointType();
        p16.Id = "electronics_lab_t1";
        p16.Name = "Лабораторне дослідження електроніки 1 тиру";
        p16.Icon = "";
        p16.Color = "#29B6F6";
        p16.SortOrder = 16;
        p16.Category = "electronics";
        p16.Kind = "lab";
        p16.Tier = 1;
        PointTypes.Insert(p16);
        ZP_PointType p17 = new ZP_PointType();
        p17.Id = "electronics_lab_t2";
        p17.Name = "Лабораторне дослідження електроніки 2 тиру";
        p17.Icon = "";
        p17.Color = "#29B6F6";
        p17.SortOrder = 17;
        p17.Category = "electronics";
        p17.Kind = "lab";
        p17.Tier = 2;
        PointTypes.Insert(p17);
        ZP_PointType p18 = new ZP_PointType();
        p18.Id = "electronics_lab_t3";
        p18.Name = "Лабораторне дослідження електроніки 3 тиру";
        p18.Icon = "";
        p18.Color = "#29B6F6";
        p18.SortOrder = 18;
        p18.Category = "electronics";
        p18.Kind = "lab";
        p18.Tier = 3;
        PointTypes.Insert(p18);

        // Підписи вимірів — теж ДАНІ, а не код: адмін їх правитиме разом із рештою.
        AddCategory("bio", "Біологія", 1);
        AddCategory("anomaly", "Аномалії", 2);
        AddCategory("electronics", "Електроніка", 3);
        AddKind("field", "польові", 1);
        AddKind("lab", "лабораторні", 2);
    }

    protected void AddCategory(string id, string name, int order)
    {
        ZP_PointDimension d = new ZP_PointDimension();
        d.Id = id;
        d.Name = name;
        d.SortOrder = order;
        Categories.Insert(d);
    }

    protected void AddKind(string id, string name, int order)
    {
        ZP_PointDimension d = new ZP_PointDimension();
        d.Id = id;
        d.Name = name;
        d.SortOrder = order;
        Kinds.Insert(d);
    }

    // Підпис виміру або сам ідентифікатор, якщо адмін його не описав. Запасний шлях саме
    // такий: показати сирий рядок чесніше, ніж порожнє місце, і адмін одразу бачить, що
    // саме треба дописати.
    static string DimensionName(array<ref ZP_PointDimension> dims, string id)
    {
        foreach (ZP_PointDimension d : dims)
        {
            if (d && d.Id == id && d.Name != "")
                return d.Name;
        }
        return id;
    }

    static int DimensionOrder(array<ref ZP_PointDimension> dims, string id)
    {
        foreach (ZP_PointDimension d : dims)
        {
            if (d && d.Id == id)
                return d.SortOrder;
        }
        return 9999;   // неописаний вимір іде в кінець, але не зникає
    }

    // Заготовка переліку вимірів за наявними типами балів. Кличеться, коли адмін ще нічого
    // не описав: краще покласти йому у файл готовий кістяк із порожніми назвами, ніж лишити
    // порожню секцію, про яку він не здогадається. Назви НЕ вигадуємо — це його справа.
    protected void SeedDimensions()
    {
        if (Categories.Count() == 0)
        {
            int co = 0;
            foreach (ZP_PointType pt : PointTypes)
            {
                if (!pt || pt.Category == "" || DimensionOrder(Categories, pt.Category) != 9999)
                    continue;
                co++;
                ZP_PointDimension c = new ZP_PointDimension();
                c.Id = pt.Category;
                c.Name = pt.Category;
                c.SortOrder = co;
                Categories.Insert(c);
            }
        }
        if (Kinds.Count() == 0)
        {
            int ko = 0;
            foreach (ZP_PointType pt2 : PointTypes)
            {
                if (!pt2 || pt2.Kind == "" || DimensionOrder(Kinds, pt2.Kind) != 9999)
                    continue;
                ko++;
                ZP_PointDimension k = new ZP_PointDimension();
                k.Id = pt2.Kind;
                k.Name = pt2.Kind;
                k.SortOrder = ko;
                Kinds.Insert(k);
            }
        }
    }

    bool Validate(out string problems)
    {
        problems = "";
        SeedDimensions();
        ref array<string> seen = new array<string>();
        foreach (ZP_PointType pt : PointTypes)
        {
            if (!pt || pt.Id == "")
            {
                problems += "тип балів з порожнім Id; ";
                continue;
            }
            if (seen.Find(pt.Id) > -1)
                problems += "дублікат Id '" + pt.Id + "'; ";
            seen.Insert(pt.Id);
            if (pt.Name == "")
                problems += "тип '" + pt.Id + "' без поля Name; ";
            if (pt.Tier < 0 || pt.Tier > 10)
                problems += "тип '" + pt.Id + "': Tier поза межами [0..10]; ";
        }
        return problems == "";
    }

    ZP_PointType Find(string id)
    {
        foreach (ZP_PointType pt : PointTypes)
        {
            if (pt && pt.Id == id)
                return pt;
        }
        return null;
    }
}
