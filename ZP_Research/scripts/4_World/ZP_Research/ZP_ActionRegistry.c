// Реєстрація дій мода. ОБОВ'ЯЗКОВА в конструкторі екшенів: без неї AddAction кидає
// стек-трейс 'Function AddAction' — екшен не відомий ActionManager'у (перевірено рантаймом).
//
// ПЕРЕРОБКИ «В РУКАХ» БІЛЬШЕ НЕМАЄ (рішення власника 2026-08-03): польових інструментів,
// які щось переробляють утриманням F із предметом у руках, у моді не буде — уся переробка
// йде через СТАНЦІЮ (сировина в карго, запуск дією, робота в фоні). Разом із дією прибрано
// й другий шлях виконання правил: він дублював співставлення входу й мусив би окремо
// тягнути чистоту, інструменти та все наступне.
modded class ActionConstructor
{
    override void RegisterActions(TTypenameArray actions)
    {
        super.RegisterActions(actions);
        actions.Insert(ZP_ActionStartStation);
        actions.Insert(ZP_ActionCollectResult);
        actions.Insert(ZP_ActionOpenTree);
        actions.Insert(ZP_ActionDeposit);
    }
}

modded class PlayerBase
{
    override void SetActions(out TInputActionMap InputActionMap)
    {
        super.SetActions(InputActionMap);
        AddAction(ZP_ActionStartStation, InputActionMap);
        AddAction(ZP_ActionCollectResult, InputActionMap);
        AddAction(ZP_ActionOpenTree, InputActionMap);
        AddAction(ZP_ActionDeposit, InputActionMap);
    }
}
