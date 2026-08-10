// Рев'ю M6: ZP_FieldCase config-успадковує ScientificBriefcase → кеш рецептів (за
// CONFIG-ієрархією, pluginrecipesmanager.c:204) вішає на нього ванільні Open/Close-рецепти,
// а їхні CanDo/Do кастять ingredients[0] за СКРИПТ-класом без null-чека
// (openscientificbriefcase.c:38) — NULL-виклик VM уже під час самого лише наведення з ключами.
// Гард additive: для справжнього кейса поведінка не змінюється (каст успішний → super).
modded class OpenScientificBriefcase
{
    override bool CanDo(ItemBase ingredients[], PlayerBase player)
    {
        if (!ScientificBriefcase.Cast(ingredients[0]))
            return false;
        return super.CanDo(ingredients, player);
    }

    override void Do(ItemBase ingredients[], PlayerBase player, array<ItemBase> results, float specialty_weight)
    {
        if (!ScientificBriefcase.Cast(ingredients[0]))
            return;
        super.Do(ingredients, player, results, specialty_weight);
    }
}

modded class CloseScientificBriefcase
{
    override bool CanDo(ItemBase ingredients[], PlayerBase player)
    {
        if (!ScientificBriefcase.Cast(ingredients[0]))
            return false;
        return super.CanDo(ingredients, player);
    }

    override void Do(ItemBase ingredients[], PlayerBase player, array<ItemBase> results, float specialty_weight)
    {
        if (!ScientificBriefcase.Cast(ingredients[0]))
            return;
        super.Do(ingredients, player, results, specialty_weight);
    }
}
