// НОСІЙ ДОСЛІДЖЕННЯ — один предмет на супертип (наукові / бойові / сталкерські) з
// ПРИХОВАНИМ рядком стану (спека 2026-08-23, відновлення «носія, скритого наполовину» з M8).
//
// Видно лише супертип: клас предмета і є супертип, тож правило «чуже не здаси» перевіряється
// тривіально. Категорія, вид (польове/лабораторне), тир і кількість балів — у рядку стану
// ZP_CarrierState ("bio_lab_t2:3"), який читає термінал, а не людина. Назва й опис —
// статичні ключі stringtable з config.cpp: носій повертає ОДНУ Й ТУ САМУ назву незалежно
// від вмісту — інакше приховування не мало б сенсу.
//
// ОДИН скрипт-клас на три config-класи: рушій шукає скрипт-клас, підіймаючись
// конфіг-ієрархією (ZP_Carrier_Science -> ZP_Carrier_Base), як і в заготовок.
//
// Заготовки ZP_Data_01..90 лишаються: вони — «явні носії» для чужих модів, що спавнять за
// класнеймом і не можуть проставити рядок стану (квести, польові бали).
class ZP_Carrier_Base : ItemBase
{
    // ---- хелпери для будь-якого предмета (єдиний міст для станції та дій) ----

    static string StateOf(EntityAI e)
    {
        ZP_Carrier_Base c = ZP_Carrier_Base.Cast(e);
        if (!c)
            return "";
        return c.ZP_GetState();
    }

    // Записати стан у щойно створений предмет. Не носій — тихо нічого: станція викликає це
    // на кожен вихід поруч із ZP_Sample_Base.ApplyFields, і обидва ігнорують чужі класи.
    static void ApplyState(EntityAI created, string state)
    {
        if (state == "")
            return;
        ZP_Carrier_Base c = ZP_Carrier_Base.Cast(created);
        if (!c)
            return;
        c.ZP_SetState(state);
    }

    // ІСТИНА — РЯДОК; синхронізувати клієнту його не треба: клієнт про вміст не знає за
    // задумом, а все, що треба показати, повідомляє сервер текстом.
    protected string m_ZP_State;

    void ZP_SetState(string state)
    {
        m_ZP_State = state;
        ZP_Log.Dbg("carrier " + GetType() + ": state='" + m_ZP_State + "'");
    }

    string ZP_GetState()
    {
        return m_ZP_State;
    }

    // Нестакуваність у ті самі чотири шари, що й у зразка: два носії з різним станом не
    // можна злити в один стак, бо стан лишився б лише в одного.
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

    // Власний CF-потік сутності. storageVersion мода НЕ піднімаємо: ключ CF_ModStorageMap —
    // ім'я CfgMods-класу, а записи сутностей незалежні одна від одної (доведено для
    // ZP_Sample_Base у W2.5); новий тип сутності починає свій потік з нуля.
    override void CF_OnStoreSave(CF_ModStorageMap storage)
    {
        super.CF_OnStoreSave(storage);
        auto ctx = storage["ZP_Research"];
        if (!ctx)
            return;
        ctx.Write(m_ZP_State);
    }

    override bool CF_OnStoreLoad(CF_ModStorageMap storage)
    {
        if (!super.CF_OnStoreLoad(storage))
            return false;
        auto ctx = storage["ZP_Research"];
        if (!ctx)
            return true;   // сейв старіший за мод
        if (!ctx.Read(m_ZP_State))
        {
            m_ZP_State = "";
            return false;
        }
        return true;
    }
}
