// ПРОМІЖНИЙ ПРЕДМЕТ ЛАНЦЮЖКА — зразок. ОДИН скрипт-клас із прихованими полями (спека §4a, §4b).
//
// Усі зразки з однаковим Content однаково поводяться: різницю несуть два поля на самій
// сутності — Content (що саме запаковано) і Purity (наскільки добре взято). Гравцеві їх не
// показують і показувати нема потреби: зразок читає МАШИНА, тобто прилад, який бачить поле
// напряму. Тому в зразка немає ані дії «визначити», ані видимого імені вмісту.
//
// ЧОМУ ОДИН СКРИПТ-КЛАС, А НЕ БАГАТО: чистота — величина КІЛЬКІСНА, класами вона не
// виражається; і адмін мусить додавати нові види вмісту правкою конфігу, а не випуском
// нової збірки мода.
//
// W2.5 T1 (2026-08-07): раніше цей файл визначав єдиний клас ZP_Sample. Тепер увесь код і
// сторадж живуть у ZP_SAMPLE_BASE, а ZP_Sample — порожній сумісний нащадок: рушій шукає
// скрипт-клас, підіймаючись CONFIG-ієрархією (той самий алгоритм, що і для ZP_Data_07 ->
// ZP_Data_Base), тож config-класи ZP_Sample_01..30 (немає власного скрипт-класу) так само
// доїдуть до ZP_Sample_Base, як і раніше довозили до ZP_Sample. Для конфіг-класу "ZP_Sample"
// (старі сейви й сумісний клас у config.cpp) рушій і далі знаходить скрипт-клас "ZP_Sample"
// САМЕ ТУТ — він порожній і успадковує все від ZP_Sample_Base без жодної зміни поведінки чи
// порядку CF-запису, тож старі збережені зразки лишаються читаними без міграції.
class ZP_Sample_Base : ItemBase
{
    // ---- читання полів БУДЬ-ЯКОГО предмета (єдиний міст 4_World -> 3_Game) ----
    //
    // Співставлення живе в 3_Game (ZP_ProcessingRules.MatchInput), а зразок — у 4_World,
    // тож вміст туди передається параметром. Ці два хелпери — єдине місце, де робиться каст:
    // звичайний предмет чесно віддає "" і 0, тобто «вмісту не має». Каст — саме на БАЗУ:
    // предмет із config-класом "ZP_Sample_07" ніколи не буде інстансом скрипт-класу
    // "ZP_Sample" (той — окремий нащадок ZP_Sample_Base, а не предок), тож каст на похідний
    // клас тут мовчки провалював би розпізнавання вмісту для всіх тридцяти нових класів.
    static string ContentOf(EntityAI e)
    {
        ZP_Sample_Base s = ZP_Sample_Base.Cast(e);
        if (!s)
            return "";
        return s.ZP_GetContent();
    }

    // Записати приховані поля у щойно створений предмет. Не зразок (жодного класу родини
    // ZP_Sample_Base) — тихо нічого: правило може видавати і зразок, і звичайну заготовку
    // одним переліком виходів.
    static void ApplyFields(EntityAI created, string content, float purity)
    {
        if (content == "")
            return;
        ZP_Sample_Base s = ZP_Sample_Base.Cast(created);
        if (!s)
            return;
        s.ZP_SetContent(content, purity);
    }

    // ІСТИНА — РЯДОК. Він і зберігається; хеш існує лише в пам'яті та в мережі, бо рушій
    // рядки не синхронізує. Зворотний порядок (зберігати число) зробив би колізію хешу
    // втратою вмісту предмета, а так вона зіпсує щонайбільше відображення.
    protected string m_ZP_Content;
    // Чистота записується в момент пакування й далі не змінюється. НЕ здоров'я предмета:
    // ванільний показник стану видно в інвентарі, і всі зразки миттю перестали б виглядати
    // однаково. Формула чистоти — наступний підкрок; тут поле лише живе й зберігається.
    protected float m_ZP_Purity;
    // Похідне від рядка число, синхронізоване клієнту (RegisterNetSyncVariableInt без
    // діапазону — увесь 32-бітний знаковий діапазон, від'ємні значення хешу теж проходять).
    //
    // Сьогодні його споживають лише діагностика (`!zp sampleinfo` і рядок DBG в
    // OnVariablesSynchronized — саме ним перевіряли, що поле долітає до клієнта).
    // Тримаємо, бо це ЄДИНИЙ місток до клієнта: рядки рушій не синхронізує, і будь-яке
    // майбутнє клієнтське відображення зразка спиратиметься на нього. Зберігати число не
    // можна й не треба — воно рахується з рядка при кожному завантаженні.
    protected int m_ZP_ContentId;

    // Готовність ВЛАСНОГО конструктора — той самий примітив-прапорець, що й у
    // ZP_Data_Base (4_World/ZP_DataItem.c), і з тієї самої причини: рушій зве
    // GetDisplayName уже з конструктора EntityAI (entityai.c:241 -> :428-433, кеш назв
    // зон ушкодження), тобто ДО того, як виконається тіло ЦЬОГО конструктора. Примітив
    // тут безпечний (нулюється до базового ctor), а от читати в цей момент синглтони
    // конфігу не варто — одного дня хтось додасть туди ref-поле, і кожен спавн зразка
    // почне падати без сліду в логах.
    protected bool m_ZP_Ready;

    void ZP_Sample_Base()
    {
        // реєстрація ЛИШЕ в конструкторі — пізніша мовчки не працює
        RegisterNetSyncVariableInt("m_ZP_ContentId");
        m_ZP_Ready = true;
    }

    // Перевизначено САМЕ GetDisplayName, а не NameOverride — та сама причина, що й у
    // ZP_Data_Base: рушій проганяє результат NameOverride через Widget.TranslateString
    // (object.c:487), а ваніль подає туди ЛИШЕ ключі stringtable. Назва зразка приходить
    // із JSON адміна (SampleTypes.json), тож обходимо переклад узагалі. Content і Purity
    // тут НЕ читаються і НЕ показуються — людині досить назви типу, вміст читає машина.
    override string GetDisplayName()
    {
        if (m_ZP_Ready)
        {
            string name;
            string desc;
            if (ZP_SampleInfo.Lookup(GetType(), name, desc) && name != "")
                return name;
        }
        return super.GetDisplayName();   // запасний шлях: displayName із config.cpp (T1 stringtable-фолбек)
    }

    // Вихід DescriptionOverride через TranslateString НЕ проходить (inventoryitem.c:56),
    // тож звичайний текст тут безпечний за побудовою.
    override bool DescriptionOverride(out string output)
    {
        if (!m_ZP_Ready)
            return false;
        string name;
        string desc;
        if (ZP_SampleInfo.Lookup(GetType(), name, desc) && desc != "")
        {
            output = desc;
            return true;
        }
        return false;                    // запасний шлях: descriptionShort із config.cpp
    }

    // ---- ЗРАЗОК НЕ ЗЛИВАЄТЬСЯ І НЕ ДІЛИТЬСЯ ----
    //
    // Рушій зливає стек одного КОНФІГ-класу, не дивлячись на скриптові поля: два зразки
    // одного класу з різним вмістом злиплися б в один, і вміст другого зник би МОВЧКИ.
    // Жоден з тридцяти config-класів не оголошує ані canBeSplit, ані varQuantityMax, але
    // покладатися лише на це не можна: рішення ухвалює скриптове поле can_this_be_combined
    // (itembase.c:2212), і вісім ванільних класів виставляють його руками в обхід конфігу
    // (matchbox.c:6 та ін.).
    override void InitItemVariables()
    {
        super.InitItemVariables();
        can_this_be_combined = false;
        m_CanThisBeSplit = false;
    }

    override bool CanBeCombined(EntityAI other_item, bool reservation_check = true, bool stack_max_limit = false)
    {
        return false;
    }

    override bool CanBeSplit()
    {
        return false;
    }

    override bool IsSplitable()
    {
        return false;
    }

    // ---- приховані поля ----

    // Викликати ТІЛЬКИ на сервері (пакувальник, адмін-команда). Клієнтський виклик змінив би
    // рядок локально й розійшовся б із сервером при першому ж синхроні.
    // purity поки що нейтральна одиниця: формула чистоти — наступний підкрок (спека §4b),
    // і до неї це поле лише живе та зберігається.
    void ZP_SetContent(string content, float purity = 1.0)
    {
        m_ZP_Content = content;
        m_ZP_Purity = purity;
        m_ZP_ContentId = ZP_Hash.Of(content);
        SetSynchDirty();
        ZP_Log.Dbg("sample " + GetType() + ": content='" + m_ZP_Content + "' purity=" + m_ZP_Purity + " id=" + m_ZP_ContentId);
    }

    string ZP_GetContent()
    {
        return m_ZP_Content;
    }

    float ZP_GetPurity()
    {
        return m_ZP_Purity;
    }

    // Єдине, що є в клієнта: число. Порівнювати його клієнт може, а розшифрувати — ні,
    // і це навмисно — таблиця «номер -> вміст» йому не потрібна.
    int ZP_GetContentId()
    {
        return m_ZP_ContentId;
    }

    override void OnVariablesSynchronized()
    {
        super.OnVariablesSynchronized();
        ZP_Log.Dbg("sample " + GetType() + " netsync: contentId=" + m_ZP_ContentId);
    }

    // ---- персистентність (CF_ModStorage на самій сутності) ----
    //
    // Саме на сутності, а не в нетсинку: нетсинк — це канал, а не сховище, і після
    // перезапуску поле обнулилося б, перетворивши всі зразки у світі на цеглу.
    // Порядок запису — рядок, потім float: типи різні, тож захист CF за типом (cf_modstorage.c)
    // упіймає майбутню перестановку полів. Однотипні поля поспіль він НЕ ловить.
    //
    // Ключ сховища — "ZP_Research" (ім'я CfgMods-класу МОДА), а не назва класу сутності, і
    // виклик іде через звичайну віртуальну диспетчеризацію Enforce: для сутності з config-
    // класом "ZP_Sample" рушій знаходить скрипт-клас "ZP_Sample" (порожній нащадок нижче),
    // а виклик CF_OnStoreSave/Load резолвиться по vtable в ЦЕЙ метод базового класу — без
    // жодної зміни порядку чи формату запису. Саме тому перенесення коду сюди НЕ вимагає
    // підняття storageVersion (перевірено, деталі — у звіті W2.5 T1).
    override void CF_OnStoreSave(CF_ModStorageMap storage)
    {
        super.CF_OnStoreSave(storage);
        auto ctx = storage["ZP_Research"];
        if (!ctx)
            return;
        ctx.Write(m_ZP_Content);
        ctx.Write(m_ZP_Purity);
    }

    protected void ZP_ClearSampleRaw()
    {
        m_ZP_Content = "";
        m_ZP_Purity = 0;
        m_ZP_ContentId = 0;
    }

    override bool CF_OnStoreLoad(CF_ModStorageMap storage)
    {
        if (!super.CF_OnStoreLoad(storage))
            return false;
        auto ctx = storage["ZP_Research"];
        if (!ctx)
            return true;   // сейв старіший за мод (CF пише лише моди з даними)
        if (!ctx.Read(m_ZP_Content))
        {
            ZP_ClearSampleRaw();
            return false;
        }
        if (!ctx.Read(m_ZP_Purity))
        {
            ZP_ClearSampleRaw();
            return false;
        }
        // хеш не зберігаємо — він похідний; так він не може розійтися з рядком
        m_ZP_ContentId = ZP_Hash.Of(m_ZP_Content);
        return true;
    }

    // Стан після завантаження треба ОДИН РАЗ штовхнути клієнтам: жоден звичайний шлях коду
    // не позначає змінну брудною для щойно піднятого зі сховища предмета.
    override void EEInit()
    {
        super.EEInit();
        if (GetGame().IsDedicatedServer())
            SetSynchDirty();
    }
}

// Сумісний скрипт-клас: config-клас "ZP_Sample" (старі сейви + сумісний клас у config.cpp)
// доїжджає САМЕ СЮДИ. Порожній навмисно — усе успадковано від ZP_Sample_Base без жодного
// перевизначення, тобто жодної відмінності в поведінці для наявних у грі/на диску сутностей.
class ZP_Sample : ZP_Sample_Base
{
}
