// РЕЗУЛЬТАТ ДОСЛІДЖЕННЯ — звичайна заготовка (рішення власника 2026-08-02).
//
// Жодних прихованих полів, жодної чистоти, жодної дії «визначити»: усе, що треба знати,
// написано в назві. Класів дев'яносто (ZP_Data_01 .. ZP_Data_90, по тридцять на супертип),
// імена нейтральні й наскрізні — супертип є властивістю КОНФІГУ, тож ім'я на кшталт
// ZP_Data_Sci_07 почало б брехати того дня, коли адмін переозначить заготовку бойовою.
//
// Один скриптовий клас на всі 90: рушій шукає скриптовий клас, піднімаючись конфіг-ієрархією
// (ZP_Data_07 -> ZP_Data_Base), тому окремих класів на кожен номер не потрібно.
//
// Назва й опис беруться з DataItems.json і змінюються НА ЛЬОТУ — інтерфейс не читає конфіг
// предмета напряму, а питає в самого предмета (object.c:482 GetDisplayName,
// inventoryitem.c:52 GetTooltip -> DescriptionOverride).
class ZP_Data_Base : ItemBase
{
    // Готовність ВЛАСНОГО конструктора. GetDisplayName рушій зве вже з конструктора
    // EntityAI (entityai.c:241 -> :428-433, кеш назв зон ушкодження) — тобто ДО того, як
    // виконається тіло цього конструктора. Примітив тут безпечний (нулюється до базового
    // ctor), а от лізти в цей момент по синглтони конфігу не варто: одного дня хтось
    // додасть туди ref-поле, і кожен спавн предмета почне падати без сліду в логах.
    protected bool m_ZP_Ready;

    void ZP_Data_Base()
    {
        m_ZP_Ready = true;
    }

    // Перевизначено САМЕ GetDisplayName, а не NameOverride: рушій проганяє результат
    // NameOverride через Widget.TranslateString (object.c:487), а ваніль подає туди ЛИШЕ
    // ключі stringtable — поведінка на звичайному тексті недоведена. Наша назва приходить
    // із JSON адміна, тож обходимо переклад узагалі. Прецедент такого перевизначення в
    // ванілі є: ContaminatedTrigger.GetDisplayName (contaminatedtrigger.c:6).
    override string GetDisplayName()
    {
        if (m_ZP_Ready)
        {
            string name;
            string desc;
            if (ZP_DataInfo.Lookup(GetType(), name, desc) && name != "")
                return name;
        }
        return super.GetDisplayName();   // запасний шлях: displayName із config.cpp
    }

    // Вихід DescriptionOverride через TranslateString НЕ проходить (inventoryitem.c:56),
    // тож звичайний текст тут безпечний за побудовою.
    override bool DescriptionOverride(out string output)
    {
        if (!m_ZP_Ready)
            return false;
        string name;
        string desc;
        if (ZP_DataInfo.Lookup(GetType(), name, desc) && desc != "")
        {
            output = desc;
            return true;
        }
        return false;                    // запасний шлях: descriptionShort із config.cpp
    }
}
