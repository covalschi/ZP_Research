// Перевірка вдягненого спорядження. Після M8 це ядро моделі: саме нашивкою у слоті
// Armband визначається фракція гравця, і тим самим механізмом гейтяться прилади.
// (Раніше файл звався ZP_Energy і містив ще пошук генератора — механіку енергії скасовано.)
class ZP_Gear
{
    // У ПРИЛАДІ стоять УСІ названі інструменти (директива власника: переробка частини
    // предметів доступна лише за наявності інструментів у слотах). Дзеркало WearsAll,
    // але по вкладеннях ПРИЛАДУ, а не гравця. Інструменти не витрачаються — лише гейт.
    //
    // Годиться для обох боків: вкладення приладу клієнту видно, тож підказка не бреше.
    static bool DeviceHasTools(EntityAI device, array<string> required, out string missing)
    {
        missing = "";
        if (!required || required.Count() == 0)
            return true;
        if (!device || !device.GetInventory())
            return false;
        foreach (string req : required)
        {
            bool found = false;
            int count = device.GetInventory().AttachmentCount();
            for (int i = 0; i < count; i++)
            {
                EntityAI att = device.GetInventory().GetAttachmentFromIndex(i);
                if (att && ZP_ProcessingRules.MatchClass(att.GetType(), req))
                {
                    found = true;
                    break;
                }
            }
            if (!found)
            {
                missing = req;
                return false;
            }
        }
        return true;
    }

    // Сумарний бонус чистоти від МОДУЛІВ, що стоять у слотах приладу. Обхід вкладень тут,
    // а таблиця бонусів — у 3_Game: реєстр модулів не знає про сутності, а цей файл не знає
    // про числа.
    static float DeviceModuleBonus(EntityAI device)
    {
        if (!device || !device.GetInventory())
            return 0;
        ref array<string> classes = new array<string>();
        int count = device.GetInventory().AttachmentCount();
        for (int i = 0; i < count; i++)
        {
            EntityAI att = device.GetInventory().GetAttachmentFromIndex(i);
            if (!att)
                continue;
            // зруйнований модуль не працює: інакше «поставив і забув» було б завжди вигідно
            if (att.IsRuined())
                continue;
            classes.Insert(att.GetType());
        }
        return ZP_ConfigService.Get().GetModules().SumBonus(classes);
    }

    // вдягнено ВСЕ зі списку (MatchClass за attachments гравця: IsKindOf + суфікс "|1")
    static bool WearsAll(PlayerBase player, array<string> required, out string missing)
    {
        missing = "";
        if (!required || required.Count() == 0)
            return true;
        if (!player)
            return false;
        foreach (string req : required)
        {
            bool found = false;
            int count = player.GetInventory().AttachmentCount();
            for (int i = 0; i < count; i++)
            {
                EntityAI att = player.GetInventory().GetAttachmentFromIndex(i);
                if (att && ZP_ProcessingRules.MatchClass(att.GetType(), req))
                {
                    found = true;
                    break;
                }
            }
            if (!found)
            {
                missing = req;
                return false;
            }
        }
        return true;
    }
}
