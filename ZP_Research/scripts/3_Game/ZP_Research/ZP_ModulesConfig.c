// Модулі чистоти: $profile:ZP_Research\Modules.json.
//
// ДВА РІЗНІ ПОНЯТТЯ НА ОДНІЙ ФІЗИЦІ (спека §4b). І модуль, і інструмент — це вкладення в
// слоті приладу; різниця лише в тому, як правило їх використовує:
//   ІНСТРУМЕНТ (ZP_Rule.RequiredTools) — ГЕЙТ: без нього правило взагалі не запускається;
//   МОДУЛЬ (цей файл)                  — ЧИСЛО: додає бонус до чистоти виробленого зразка.
// Один і той самий клас може бути і тим, і тим — це нормально й навмисно.
//
// Бонус належить МОДУЛЮ, а не правилу: модуль стоїть у приладі й покращує все, що той
// пакує. Тому реєстр один на сервер, а не поле в кожному правилі.
//
// Модулі НЕ витрачаються: працюють, доки стоять у слоті.

class ZP_ModuleDef
{
    string Classname;         // клас вкладення (MatchClass, суфікс "|1" = точний клас)
    float PurityBonus = 0;    // додається до чистоти ОДИН раз, скільки б однакових не стояло
    // ІНСТРУМЕНТИ НЕ УНІВЕРСАЛЬНІ (директива власника): у кожного приладу свої. Тут
    // перелічено класи приладів, які цей інструмент ПРИЙМАЮТЬ; порожньо = приймають усі.
    //
    // Прив'язка живе в КОНФІГУ, а не в config.cpp через окремі слоти на прилад: спека
    // прямо цього вимагає — «комбінація, які інструменти потрібні на якому приладі,
    // повністю конфігурована», а фіксованою на етапі збірки лишається тільки фізична
    // кількість слотів. Окремі CfgSlots заморозили б пари назавжди, і додати інструмент
    // чужого мода стало б неможливо.
    ref array<string> Devices = new array<string>();
    string Notes;
}

class ZP_ModulesConfig
{
    int ConfigVersion = 1;
    ref array<ref ZP_ModuleDef> Modules = new array<ref ZP_ModuleDef>();

    // Типові значення описують рівно ті три інструменти, які мод уже постачає. Адмін може
    // дописати свої класи (у тому числі з чужих модів) або обнулити бонуси.
    void SetDefaults()
    {
        Add("ZP_Tool_Optics", 0.2, {"ZP_Microscope"}, "оптика: тільки мікроскоп");
        Add("ZP_Tool_Centrifuge", 0.3, {"ZP_SampleFridge"}, "центрифуга: тільки холодильник зразків");
        Add("ZP_Tool_Reagents", 0.25, {"ZP_ChemBench"}, "реагенти: тільки хімічний стенд");
    }

    protected void Add(string cls, float bonus, array<string> devices, string notes)
    {
        ZP_ModuleDef m = new ZP_ModuleDef();
        m.Classname = cls;
        m.PurityBonus = bonus;
        foreach (string d : devices)
        {
            m.Devices.Insert(d);
        }
        m.Notes = notes;
        Modules.Insert(m);
    }

    // Чи приймає цей прилад такий інструмент. НЕВІДОМИЙ клас (немає в реєстрі) приймається:
    // це просто вкладення без бонусу, і забороняти його — означало б мовчки відмовляти
    // адмінові, який щойно додав інструмент чужого мода й ще не описав його тут.
    bool AllowedOn(string attachmentClass, string deviceClass)
    {
        foreach (ZP_ModuleDef m : Modules)
        {
            if (!m || !ZP_ProcessingRules.MatchClass(attachmentClass, m.Classname))
                continue;
            if (m.Devices.Count() == 0)
                return true;          // інструмент без обмеження — приймають усі
            foreach (string dev : m.Devices)
            {
                if (ZP_ProcessingRules.MatchClass(deviceClass, dev))
                    return true;
            }
            return false;
        }
        return true;
    }

    // Сумарний бонус за переліком класів вкладень приладу.
    // ОДНАКОВІ МОДУЛІ НЕ СКЛАДАЮТЬСЯ: три однакові лінзи в трьох слотах дали б потрійний
    // бонус, і єдиною стратегією стало б «напхати три однакові». Кожен клас враховується
    // один раз, тож вигідно ставити РІЗНЕ — саме цього хотів власник від слотів.
    float SumBonus(array<string> attachmentClasses)
    {
        float total = 0;
        ref array<string> counted = new array<string>();
        foreach (ZP_ModuleDef m : Modules)
        {
            if (!m || m.Classname == "")
                continue;
            if (counted.Find(m.Classname) > -1)
                continue;
            foreach (string att : attachmentClasses)
            {
                if (!ZP_ProcessingRules.MatchClass(att, m.Classname))
                    continue;
                total += m.PurityBonus;
                counted.Insert(m.Classname);
                break;
            }
        }
        return total;
    }

    bool Validate(out string problems)
    {
        problems = "";
        ref array<string> seen = new array<string>();
        for (int i = Modules.Count() - 1; i >= 0; i--)
        {
            ZP_ModuleDef m = Modules[i];
            if (!m || m.Classname == "")
            {
                problems += "модуль без Classname; ";
                Modules.RemoveOrdered(i);
                continue;
            }
            if (!ZP_ProcessingRules.ClassExists(ZP_ProcessingRules.StripExact(m.Classname)))
            {
                problems += "класу '" + m.Classname + "' немає в грі; ";
                Modules.RemoveOrdered(i);
                continue;
            }
            // Межа НЕ про баланс, а про друкарську помилку: зайвий нуль у бонусі зробив би
            // будь-який шанс достовірністю, і зрозуміти це в грі було б нічим.
            if (m.PurityBonus < 0 || m.PurityBonus > 2)
            {
                problems += "PurityBonus '" + m.PurityBonus + "' у '" + m.Classname + "' поза межами [0..2]; ";
                Modules.RemoveOrdered(i);
                continue;
            }
            foreach (string dv : m.Devices)
            {
                if (dv == "" || !ZP_ProcessingRules.ClassExists(ZP_ProcessingRules.StripExact(dv)))
                    problems += "невідомий клас приладу '" + dv + "' у модулі '" + m.Classname + "'; ";
            }
            if (seen.Find(m.Classname) > -1)
            {
                problems += "дубль класу '" + m.Classname + "'; ";
                Modules.RemoveOrdered(i);
                continue;
            }
            seen.Insert(m.Classname);
        }
        if (problems != "")
            ZP_Log.Warn("Modules: " + problems);
        return problems == "";
    }
}
