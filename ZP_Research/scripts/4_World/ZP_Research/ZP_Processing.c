// Серверне виконання правил переробки. ШЛЯХ ОДИН: фонова станція (сировина в карго,
// запуск дією, робота за timestamp). Переробку «в руках» прибрано разом із дією
// (рішення власника 2026-08-03): польових інструментів, що переробляють утриманням F,
// у моді не буде, а другий шлях виконання дублював співставлення входу й мусив би
// окремо тягнути чистоту, інструменти й усе наступне.
// Контракт атомарності: СПОЧАТКУ весь план (вхід + витратні матеріали) без змін,
// ПОТІМ усі списання.
class ZP_Processing
{
    // сумарно вже заброньовано по предмету в планах входу та витратних матеріалів
    protected static int PlannedFor(ItemBase ib, array<ItemBase> p1, array<int> q1, array<ItemBase> p2, array<int> q2)
    {
        int total = 0;
        int i1 = p1.Find(ib);
        if (i1 > -1)
            total += q1[i1];
        int i2 = p2.Find(ib);
        if (i2 > -1)
            total += q2[i2];
        return total;
    }

    // кандидат вкладений в уже запланований предмет або є предком запланованого —
    // виключаємо: залишок стака всередині видаленого батька тихо гине (емпірика: карго
    // гине разом із контейнером наприкінці кадру) = прихована переплата гравця
    protected static bool IsNestedConflict(ItemBase ib, array<ItemBase> p1, array<ItemBase> p2)
    {
        EntityAI par = ib.GetHierarchyParent();
        while (par)
        {
            ItemBase parIb = ItemBase.Cast(par);
            if (parIb)
            {
                if (p1.Find(parIb) > -1 || p2.Find(parIb) > -1)
                    return true;
            }
            par = par.GetHierarchyParent();
        }
        for (int pj = 0; pj < p1.Count(); pj++)
        {
            if (IsAncestorOf(ib, p1[pj]))
                return true;
        }
        for (int pk = 0; pk < p2.Count(); pk++)
        {
            if (IsAncestorOf(ib, p2[pk]))
                return true;
        }
        return false;
    }

    protected static bool IsAncestorOf(ItemBase candidate, ItemBase child)
    {
        EntityAI par = child.GetHierarchyParent();
        while (par)
        {
            if (par == candidate)
                return true;
            par = par.GetHierarchyParent();
        }
        return false;
    }

    // доступна кількість одиниці предмета: стак = quantity, інакше 1.
    // Магазини/набої розсипом (CfgMagazines) відхиляються валідацією правил.
    protected static int AvailOf(ItemBase ib)
    {
        if (ib.ConfigGetBool("canBeSplit"))
            return ib.GetQuantity();
        return 1;
    }



    // перше background-правило цього приладу, ДОЗВОЛЕНЕ гравцю (фракція/RequiredNode),
    // чий ПОВНИЙ план (вхід + витратні матеріали) збирається по карго. Ітерація по правилах
    // у порядку конфіга — детермінований адмін-пріоритет.
    static ZP_Rule FindStartableBackgroundRule(EntityAI device, PlayerBase player, out string err)
    {
        return FindStartableCore(device, player, "", null, null, err);
    }

    // Пошук правила для АВТОПРОДОВЖЕННЯ: гравця немає, фракція взята заморожена (стартувальник),
    // exclude* — щойно вироблене цим приладом. Останнє страхує від самопідживлення, якщо адмін
    // помилково опише правило, чий вхід збігається з чиїмось виходом на тому ж приладі.
    //
    // ВИКЛЮЧАЄМО ПАРУ «клас + вміст», а не самий клас. Відколи зразки — один клас на всі види,
    // виключення за класом означало б: станція, яка щойно спакувала зразок, більше не візьме
    // В РОБОТУ ЖОДНОГО зразка — навіть чужого вмісту, покладеного гравцем. Конвеєр ставав би
    // після кожного пакування, і причина була б невидима.
    static ZP_Rule FindAutoContinueRule(EntityAI device, string factionClass, array<string> exclClasses, array<string> exclContents, out string err)
    {
        return FindStartableCore(device, null, factionClass, exclClasses, exclContents, err);
    }

    // Питання тут РІВНО ТЕ САМЕ, що ставить план карго: «чи взяло б це правило те, що ми
    // щойно виробили?». Тому й запитувати треба тією самою функцією.
    //
    // Спершу тут стояли два звичайні порівняння рядків — і це був дефект. Правило з
    // порожнім Content означає «будь-який зразок»: MatchInput його бере, а порівняння
    // «вироблений вміст == порожньо» — ні. Станція з'їдала б власний щойно спакований
    // зразок за секунду після виробництва, і гравець ніколи б його не побачив; правило,
    // що бере будь-який зразок і видає зразок, крутилося б вічно на одному предметі.
    // Побічно виправляється й давніша дірка: клас звірявся дослівно, тож правило з
    // InputItem "ZP_Data_Base" не виключалося після виробництва "ZP_Data_01".
    protected static bool IsExcluded(ZP_Rule r, array<string> exclClasses, array<string> exclContents)
    {
        if (!exclClasses)
            return false;
        for (int i = 0; i < exclClasses.Count(); i++)
        {
            string producedContent = "";
            if (exclContents && i < exclContents.Count())
                producedContent = exclContents[i];
            if (ZP_ProcessingRules.MatchInput(exclClasses[i], producedContent, r.InputItem.Classname, r.InputItem.Content))
                return true;
        }
        return false;
    }

    protected static ZP_Rule FindStartableCore(EntityAI device, PlayerBase player, string factionClass, array<string> exclClasses, array<string> exclContents, out string err)
    {
        err = "немає background-правил для цього приладу";
        bool sawRule = false;
        foreach (ZP_Rule r : ZP_ConfigService.Get().GetRules().Rules)
        {
            if (!r.Enabled)
                continue;   // вимкнені правила не стартують (M3.5)
            string m = r.Mode;
            m.ToLower();
            if (m != "background")
                continue;
            if (!ZP_ProcessingRules.MatchClass(device.GetType(), r.Device))
                continue;
            if (IsExcluded(r, exclClasses, exclContents))
                continue;
            // ФРАКЦІЙНИЙ ВІДСІВ — ПЕРШИМ і МОВЧКИ, ще до sawRule і до будь-яких повідомлень.
            // Інакше текст відмови називав би id чужого правила («'combat_x': правило
            // недоступне вашій фракції»), і запуск власної станції ставав би довідником
            // чужих правил. Для гравця чужого правила просто НЕ ІСНУЄ.
            string fc = factionClass;
            if (player)
                fc = ZP_Factions.GetFactionClass(player);
            if (r.RequiredFactions.Count() > 0 && r.RequiredFactions.Find(fc) < 0)
                continue;
            sawRule = true;
            string denyReason;
            bool allowed;
            if (player)
                allowed = ZP_Factions.RuleAllowedFor(player, r, denyReason);
            else
                allowed = ZP_Factions.RuleAllowedForFaction(fc, r, denyReason);
            if (!allowed)
            {
                // сюди доходять лише СВОЇ правила — назвати їх можна
                err = "'" + r.Id + "': " + denyReason;
                continue;
            }
            // інструменти в слотах приладу — гейт можливості переробки (директива власника)
            string missingTool;
            if (!ZP_Gear.DeviceHasTools(device, r.RequiredTools, missingTool))
            {
                err = "'" + r.Id + "': потрібен інструмент у приладі: " + missingTool;
                continue;
            }
            ref array<ItemBase> planItems = new array<ItemBase>();
            ref array<int> planAmounts = new array<int>();
            ref array<int> planInputs = new array<int>();
            string planErr;
            if (BuildCargoPlan(device, r, planItems, planAmounts, planInputs, planErr))
                return r;
            err = "'" + r.Id + "': " + planErr;
        }
        if (!sawRule)
            err = "немає background-правил для цього приладу";
        return null;
    }

    // Бали приладами не нараховуються: єдине джерело балів у пулі — здача НОСІЯ дослідження
    // на терміналі. Прилад лише виробляє носій.

    // Предмет стоїть у СЛОТІ ВКЛАДЕННЯ приладу (інструмент), а не лежить у карго.
    // EnumerateInventory обходить і те, і те, тож без цієї перевірки правило з
    // InputItem/Consumables під клас інструмента з'їдало б власний інструмент станції.
    protected static bool IsDeviceAttachment(EntityAI device, EntityAI candidate)
    {
        if (!device || !candidate || !device.GetInventory())
            return false;
        int n = device.GetInventory().AttachmentCount();
        for (int i = 0; i < n; i++)
        {
            if (device.GetInventory().GetAttachmentFromIndex(i) == candidate)
                return true;
        }
        return false;
    }

    // Єдиний план (вхід + витратні матеріали) по КАРГО приладу; без списання.
    //
    // inputAmounts — ПАРАЛЕЛЬНИЙ до planAmounts масив: скільки з кожного запису належить
    // ВХОДУ, а не витратним матеріалам. Без цього поділу чистота рахувалася б по всьому,
    // що станція з'їла: двадцять цілих ганчірок-витратників поруч із одним зразком чистоти
    // 0.4 давали б середнє 0.97, і механіка чистоти мовчки вимикалася б у будь-якого
    // правила з витратними матеріалами. Один і той самий предмет може обслуговувати
    // обидві ролі, тож двома окремими планами тут не обійтися.
    static bool BuildCargoPlan(EntityAI device, ZP_Rule rule, out array<ItemBase> planItems, out array<int> planAmounts, out array<int> inputAmounts, out string err)
    {
        err = "";
        ref array<ItemBase> emptyPlan = new array<ItemBase>();
        ref array<int> emptyAmounts = new array<int>();

        int inRemaining = rule.InputItem.Quantity;
        array<EntityAI> cargoItems = new array<EntityAI>();
        device.GetInventory().EnumerateInventory(InventoryTraversalType.PREORDER, cargoItems);
        foreach (EntityAI e : cargoItems)
        {
            if (inRemaining <= 0)
                break;
            ItemBase ib = ItemBase.Cast(e);
            if (!ib || ib == device)
                continue;
            if (IsDeviceAttachment(device, ib))
                continue;   // інструмент у слоті — не сировина
            // ЗРУЙНОВАНЕ НЕ БЕРЕТЬСЯ. Раніше це ловив лише компонент дії (CCINonRuined) для
            // предмета в руках; відколи переробка йде тільки через карго, ловити нікому —
            // а зруйнована сировина дала б чистоту нуль і мовчки з'їла б цикл.
            if (ib.IsRuined())
                continue;
            if (!ZP_ProcessingRules.MatchInput(ib.GetType(), ZP_Sample_Base.ContentOf(ib), rule.InputItem.Classname, rule.InputItem.Content))
                continue;
            if (IsNestedConflict(ib, planItems, emptyPlan))
                continue;
            int avail = AvailOf(ib) - PlannedFor(ib, planItems, planAmounts, emptyPlan, emptyAmounts);
            if (avail <= 0)
                continue;
            int take = avail;
            if (take > inRemaining)
                take = inRemaining;
            int idx = planItems.Find(ib);
            if (idx > -1)
            {
                planAmounts[idx] = planAmounts[idx] + take;
                inputAmounts[idx] = inputAmounts[idx] + take;
            }
            else
            {
                planItems.Insert(ib);
                planAmounts.Insert(take);
                inputAmounts.Insert(take);
            }
            inRemaining -= take;
        }
        if (inRemaining > 0)
        {
            err = "потрібно " + rule.InputItem.Quantity + " x " + rule.InputItem.Classname + " у карго";
            return false;
        }

        // Обхід карго ОДИН раз на весь план, а не на кожен витратний матеріал: раніше
        // правило з двома витратними давало три повні обходи, а сама BuildCargoPlan
        // викликається по разу на КОЖНЕ кандидатне правило — множилося до десятків.
        foreach (ZP_RuleConsumable c : rule.Consumables)
        {
            int remaining = c.Quantity;
            foreach (EntityAI e2 : cargoItems)
            {
                if (remaining <= 0)
                    break;
                ItemBase ib2 = ItemBase.Cast(e2);
                if (!ib2 || ib2 == device)
                    continue;
                if (IsDeviceAttachment(device, ib2))
                    continue;   // інструмент у слоті — не витратний матеріал
                if (ib2.IsRuined())
                    continue;   // те саме, що й для сировини
                if (!ZP_ProcessingRules.MatchInput(ib2.GetType(), ZP_Sample_Base.ContentOf(ib2), c.Classname, c.Content))
                    continue;
                if (IsNestedConflict(ib2, planItems, emptyPlan))
                    continue;
                int avail2 = AvailOf(ib2) - PlannedFor(ib2, planItems, planAmounts, emptyPlan, emptyAmounts);
                if (avail2 <= 0)
                    continue;
                int take2 = avail2;
                if (take2 > remaining)
                    take2 = remaining;
                int idx2 = planItems.Find(ib2);
                if (idx2 > -1)
                {
                    planAmounts[idx2] = planAmounts[idx2] + take2;   // inputAmounts НЕ росте: це витратний матеріал
                }
                else
                {
                    planItems.Insert(ib2);
                    planAmounts.Insert(take2);
                    inputAmounts.Insert(0);
                }
                remaining -= take2;
            }
            if (remaining > 0)
            {
                err = "бракує в карго: " + c.Classname + " x " + remaining;
                return false;
            }
        }
        return true;
    }

    static void ConsumePlan(array<ItemBase> planItems, array<int> planAmounts)
    {
        for (int ci = 0; ci < planItems.Count(); ci++)
        {
            ItemBase pi = planItems[ci];
            int amt = planAmounts[ci];
            if (!pi)
                continue;
            if (pi.ConfigGetBool("canBeSplit") && pi.GetQuantity() > amt)
                pi.AddQuantity(-amt);
            else
                GetGame().ObjectDelete(pi);
        }
    }

    // ---------- ЧИСТОТА ----------
    //
    // Чистота існує ЛИШЕ у зразка й діє рівно один раз — у момент, коли зразок перетворюється
    // на заготовку: там вона множить ШАНС. «Наполовину чистих даних» не буває.
    //
    // Два різні числа, які легко переплутати:
    //   ЯКІСТЬ ВХОДУ (quality) — наскільки добрий матеріал з'їла станція. Для сировини це
    //     стан предмета (GetHealth01), для зразка — його власна чистота. НЕ здоров'я зразка:
    //     пакувальник створює його неушкодженим, і здоров'я там нічого не значить.
    //   ЧИСТОТА ВИХОДУ (purity) — те, що записується у ВИРОБЛЕНИЙ зразок:
    //     кидок бази між BasePurityMin і BasePurityMax * якість входу + Σ бонусів модулів,
    //     БЕЗ СТЕЛІ. Кидок один на цикл і одразу заморожується.
    //
    // Обидва числа рахуються ПРИ СТАРТІ, поки з'їдені предмети ще існують, і заморожуються
    // у сховищі станції: кидок іде наприкінці циклу — можливо, вже після перезапуску, коли
    // тих предметів давно немає. Заморожування заодно знімає питання «а що як модуль вийняли,
    // поки станція працювала».
    //
    // ПАРТІЯ З РІЗНОЮ ЯКІСТЮ усереднюється (рішення за підсумком аудиту) — але лише по
    // ВХІДНИХ предметах: витратні матеріали до якості не належать, вони не «сировина».
    // Партія фізично змішується в одному циклі й дає один вихід, тож середнє — природне
    // прочитання.
    // «За найгіршим» зробило б один недбалий зразок отрутою для всієї партії й підштовхувало
    // б обробляти по одному — рівно проти того, для чого існує конвеєр.
    static float PlanQuality(array<ItemBase> planItems, array<int> inputAmounts)
    {
        float sum = 0;
        int n = 0;
        for (int i = 0; i < planItems.Count(); i++)
        {
            ItemBase ib = planItems[i];
            if (!ib)
                continue;
            int amt = 0;
            if (i < inputAmounts.Count())
                amt = inputAmounts[i];
            if (amt < 1)
                continue;      // цей запис — витратний матеріал, до якості входу він не належить
            float q;
            ZP_Sample_Base smp = ZP_Sample_Base.Cast(ib);
            if (smp)
                q = smp.ZP_GetPurity();
            else
                q = ib.GetHealth01();
            sum += q * amt;
            n += amt;
        }
        if (n == 0)
            return 0;
        return sum / n;
    }

    // Чи ніс вхід власну чистоту (тобто серед з'їденого був зразок). Саме це вирішує, чи
    // множиться шанс: пакувальник чистоту ВИРОБЛЯЄ, аналіз її ВИТРАЧАЄ, і подвійного
    // множення в ланцюжку не виникає.
    static bool PlanHasSample(array<ItemBase> planItems, array<int> inputAmounts)
    {
        for (int i = 0; i < planItems.Count(); i++)
        {
            if (i >= inputAmounts.Count() || inputAmounts[i] < 1)
                continue;      // зразок, узятий як ВИТРАТНИЙ матеріал, чистоти не витрачає
            if (ZP_Sample_Base.Cast(planItems[i]))
                return true;
        }
        return false;
    }

    // Кидок бази між Min і Max. Кличеться РІВНО ОДИН раз — при старті циклу, і результат
    // одразу заморожується у сховищі станції.
    static float ComputeOutPurity(ZP_Rule rule, EntityAI device, float quality)
    {
        float baseP = rule.BasePurityMin;
        if (rule.BasePurityMax > rule.BasePurityMin)
            baseP = Math.RandomFloatInclusive(rule.BasePurityMin, rule.BasePurityMax);
        float p = baseP * quality + ZP_Gear.DeviceModuleBonus(device);
        if (p < 0)
            p = 0;
        return p;                 // стелі немає свідомо (рішення власника)
    }

    // Межі того, що МОЖЕ випасти, без кидка — для діагностики. Показувати в !zp probe
    // одноразовий кидок було б гірше, ніж нічого: гравець побачив би число, якого при
    // запуску не буде.
    static void PurityRange(ZP_Rule rule, EntityAI device, float quality, out float lo, out float hi)
    {
        float bonus = ZP_Gear.DeviceModuleBonus(device);
        lo = rule.BasePurityMin * quality + bonus;
        hi = rule.BasePurityMax * quality + bonus;
        if (lo < 0)
            lo = 0;
        if (hi < 0)
            hi = 0;
    }

    // Розв'язання результату фонової станції. Кидки шансів робляться РІВНО ОДИН раз —
    // у момент завершення роботи, а не при заборі. Наслідки навмисні: правки правила
    // заднім числом уже виконану роботу не переписують, і гравець не може перекидати
    // невдалий шанс, відкладаючи забір.
    // Паралельні масиви, а не масив об'єктів: рівно в такому вигляді залишок лягає в
    // CF_ModStorage (контейнери CF не серіалізує), тож зайвого перетворення немає.
    static void ResolveResult(ZP_Rule rule, float chanceMul, out array<string> outItems, out array<string> outContents)
    {
        outItems = new array<string>();
        outContents = new array<string>();
        foreach (ZP_RuleOutput o : rule.Outputs)
        {
            // Обмежена лише підсумкова ЙМОВІРНІСТЬ: більшої за достовірність не буває,
            // а сама чистота стелі не має — у цьому й сенс вкладення в модулі.
            float chance = o.Chance * chanceMul;
            if (chance > 1.0)
                chance = 1.0;
            if (Math.RandomFloat01() > chance)
                continue;
            for (int i = 0; i < o.Quantity; i++)
            {
                outItems.Insert(o.Classname);
                outContents.Insert(o.Content);
            }
        }
    }

    // Видача ОДНОГО предмета в карго приладу. Скидання на землю прибрано свідомо: предмет,
    // якому не знайшлося місця, лишається незабраним у сховищі станції. Так він не падає
    // на підлогу і не залежить від чистки CE — матеріалізується лише тоді, коли є куди.
    //
    // Повертає САМУ СУТНІСТЬ, а не bool: інакше на щойно створеному зразку нема на чому
    // проставити вміст (обмеження розділу 5.0).
    static EntityAI SpawnOneToCargo(EntityAI device, string classname, string content, float purity)
    {
        EntityAI created = device.GetInventory().CreateInInventory(classname);
        ZP_Sample_Base.ApplyFields(created, content, purity);
        return created;
    }
}
