# ZP_Research — дизайн: очки исследований, дерево технологий, веб-редактор

Версия 0.2 (2026-07-31; после адверсарного ревью — устранены двойственность гейтинга,
недостижимые узлы в примерах, несинхронизируемые механики). Основано на исследовании
60+ модов (см. `.claude/skills/dayz-modding/references/patterns-cookbook.md` и
`mods-catalog.md`). Проверенный факт: **на воркшопе DayZ нет ни одного мода с деревом
технологий** — ниша свободна; ближайшие аналоги — перк-деревья (TerjeMods, ZenSkills) и
токен-гейтинг рецептов (чертежи Namalsk/NCPR).

> **Про JSON в этом документе**: примеры ниже — JSONC (с комментариями) для читаемости.
> Реальные файлы в `$profile:` — **строго чистый JSON**: без комментариев и висячих
> запятых. DayZ-парсер не принимает JSONC, а старый `JsonLoadFile` при битом JSON
> **молча** подставляет дефолты. Поэтому мод обязан парсить через обёртку над
> `JsonSerializer.ReadFromString` с выводом имени битого файла и ошибки в лог (паттерн
> InediaInfectedAI, cookbook §2), а веб-редактор всегда экспортирует чистый JSON.

## 1. Принципы

1. Мод — **фреймворк без контента**: предметы, приборы, правила, очки и дерево описывает
   админ в JSON (`$profile:ZP_Research\`). Ничего не хардкодим.
2. Код только additive (`modded class` + super), префикс `ZP_`, зависимость — CF (LGPL).
   Сервер-авторитарность: очки, шансы, разблокировки считаются только на сервере.
3. Совместимость с сервером Zone Protocol: фракции через Expansion AI
   (`eAIFactionEcologist` = Учёные, `eAIFactionClearSky` = Чистое небо), НЕ трогаем
   PlayerStats (конфликт с KK_SkillFramework), не копируем код обфусцированных модов.
4. Каждая схема несёт `ConfigVersion` + миграции + `Validate()` с внятными ошибками в лог
   (сервер не падает от битого конфига), бэкапы перед регенерацией. Классы предметов
   проверяются `ConfigIsExisting`; **исключение — фракции**: это скрипт-классы без
   config-записи, их валидируем перебором `eAIRegisterFaction.s_FactionTypes` под
   `#ifdef EXPANSIONMODAI`; если Expansion AI не загружен — предупреждение в лог и
   фракционные гейты отключаются (а не ломают всё).

## 2. Модель очков исследований

Очки — **настраиваемый набор типов** (`PointTypes.json`), не одна валюта. Админ решает,
сколько их и как они называются.

```jsonc
// $profile:ZP_Research\PointTypes.json
{
  "ConfigVersion": 1,
  "PointTypes": [
    { "Id": "field",  "Name": "Полевые данные",         "Icon": "zp_icon_field", "Color": "#7CB342", "SortOrder": 1 },
    { "Id": "lab",    "Name": "Лабораторные результаты", "Icon": "zp_icon_lab",   "Color": "#29B6F6", "SortOrder": 2 },
    { "Id": "break",  "Name": "Прорывные открытия",      "Icon": "zp_icon_break", "Color": "#AB47BC", "SortOrder": 3 }
  ]
}
```

`SortOrder` (как и `Tier` у узлов) — **только отображение/сортировка**, механики не
несёт. Единственный механизм доступа к приборам/правилам — узлы дерева (см. §4).

Рекомендуемая схема для сервера — три «тира» по редкости источников:

| Очко | Откуда берётся | Что покупает (через узлы дерева) |
|---|---|---|
| Полевые данные | простая переработка (часть мутанта → чашка Петри) | базовые узлы; узлы, дающие доступ к приборам T2 |
| Лабораторные результаты | глубокие ступени цепочек на приборах T2 + расходники | средние узлы; узлы, открывающие статичные станции |
| Прорывные открытия | финальные ступени (боссовые трофеи BurerHand/ControllerHand, артефакты) на станциях T3, дорогие расходники, низкий Chance | вершина дерева |

**«Дорогое» исследование = стоимость в очках высоких тиров**, которые физически нельзя
нафармить на дешёвых входах: тип очка задаётся правилом переработки, а правила высоких
тиров требуют редких входов, приборов высокого тира и расходников.

**Хранение и синхронизация** (гибрид: живой синк — по образцу Expansion Hardline;
формат файлов — JSON-per-UID, cookbook §3b; ключ файла — **Steam64 через
`identity.GetPlainId()`**, как у Hardline/PersonalChestWT — админу видно, чей файл):

- `PlayerData\<steam64>.json` — личный вклад:
  `{ "Points": {...}, "Contributed": {...}, "AntiFarm": {...}, "Stats": {...} }`.
- `FactionData\<factionClass>.json` — пул фракции + **прогресс дерева фракции**
  (`CompletedNodes`, `ActiveProjects`).
- `PointsOwnership` в Settings: `"faction"` (default) | `"player"` | `"both"` — влияет
  **только на балансы очков** (кто копит и кто платит: фракционный пул, личный счёт или
  личный счёт с зачислением доли в пул). **Состояние дерева в v1 всегда фракционное**;
  все проверки RequiredNode идут по дереву фракции игрока. (Персональные деревья —
  возможное v2; для них в PlayerData зарезервируем CompletedNodes.)
- **Синк на клиент — только явными RPC по dirty-флагу**, никаких netsync-переменных для
  очков: их набор задаётся админом в JSON, а `RegisterNetSyncVariable*` регистрируется
  статически при инициализации класса — динамический набор так не синхронизировать.
- **Правило сериализации**: `map<>` не переживает RPC-сериализацию целым объектом
  (cookbook §1). Все RPC-payload'ы моделируют словари как `array<ref ZP_KV>`
  (пары ключ-значение) либо count + поэлементный Write/Read. JSON-файлы могут хранить
  map-форму — JsonFileLoader с ней работает.

### Анти-фарм (схема, не только прозой)

Пер-правило (см. поля в §3): `Cooldown {PerPlayerSec, PerDeviceSec}`,
`DailyCap {PerPlayer, PerFaction}` (0 = выкл), `DiminishGroup` — правила с одной группой
делят счётчик убывания. Кривая убывания и окно сброса — в Settings.json. Счётчики
персистятся в PlayerData (**обязаны переживать рестарт**, иначе мета — фарм после
рестарта). Прецедент анти-фарма в диких модах — ZenExpNerfDef.c (ZenSkills, код
свободный): там нерф за «зависание в одной области» (анти-AFK); наш DiminishingReturns
по типу входа — собственная механика, Zen берём как разрешённый референс кода.

## 3. Получение очков: правила переработки

```jsonc
// $profile:ZP_Research\ProcessingRules\bio_chain.json (папка = группа правил)
{
  "ConfigVersion": 1,
  "Rules": [
    {
      "Id": "psydog_tail_sample",
      "Device": "ZP_PetriDishKit",             // матчится через IsKindOf (можно базовый класс);
                                               // суффикс "|1" = только точное совпадение
      "MinDeviceTier": 1,
      "Mode": "action",                        // "action" (удерживаемое действие) | "background" (станция)
      "Input": { "Classname": "Satoshi_Skinning_PsyDog_Tail", "Quantity": 1, "ConsumeInput": true },
      "Consumables": [ { "Classname": "ZP_Reagent_Basic", "Quantity": 1 } ],
      "RequiredInHands": "",                   // опц.: протокол/документ в руках (паттерн BBP)
      "TimeSec": 45,
      "Outputs": [ { "Classname": "ZP_Sample_Mutagen", "Quantity": 1, "Chance": 1.0 } ],
      "Points": [ { "Type": "field", "Amount": 2, "Chance": 0.6 } ],
      "BonusOutputs": [ { "Classname": "ZP_Sample_Pure", "Quantity": 1, "Chance": 0.05 } ],
      "RequiredFactions": ["eAIFactionEcologist", "eAIFactionClearSky"],
      "RequiredNode": "",                      // "" = доступно с самого начала
      "Cooldown": { "PerPlayerSec": 0, "PerDeviceSec": 0 },
      "DailyCap": { "PerPlayer": 0, "PerFaction": 0 },
      "DiminishGroup": "psy_parts",
      "Notes": "хвост псевдособаки → образец мутагена"
    },
    {
      "Id": "mutagen_microscopy",
      "Device": "ZP_Microscope",
      "MinDeviceTier": 2,
      "Mode": "background",                    // длинный процесс — фоновый режим станции
      "EnergyPerCycle": 5,                     // только для background
      "InterruptPolicy": "refund_input",       // refund_input | lose_input — села батарея/сломали прибор
      "Input": { "Classname": "ZP_Sample_Mutagen", "Quantity": 2, "ConsumeInput": true },
      "Consumables": [ { "Classname": "ZP_SlideGlass", "Quantity": 1 }, { "Classname": "ZP_Reagent_Adv", "Quantity": 1 } ],
      "TimeSec": 180,
      "Outputs": [ { "Classname": "ZP_ResearchNotes_Bio", "Quantity": 1, "Chance": 1.0 } ],
      "Points": [ { "Type": "lab", "Amount": 3, "Chance": 0.5 } ],
      "RequiredNode": "bio_t2_anatomy",        // ЕДИНСТВЕННЫЙ источник истины для гейтинга правила
      "DiminishGroup": "psy_parts"
    }
  ]
}
```

Семантика:

- **Гейтинг правила — только `RequiredNode`** (обратная ссылка на узел). У узлов НЕТ
  списка «что я открываю» — его выводят UI и веб-редактор сканированием правил.
  Валидация при загрузке: каждый непустой RequiredNode ссылается на существующий узел.
- **`Mode`**: `action` = ActionContinuousBase на приборе (вход в слоте/в руках, проверка
  в ActionCondition, работа в OnFinishProgressServer); `background` = станция по
  паттерну CP_Workbench (слоты блокируются, цикл на сервере). Если Mode не указан:
  `action` при `TimeSec <= Settings.MaxActionTimeSec` (default 60), иначе `background`.
  Персистентность background-процессов — **timestamp завершения**, не таймер (таймеры
  умирают при рестарте — проверенный баг CannabisPlus; движковые таймеры деградируют
  после ~4ч аптайма).
- **RequiredFactions на правиле** = кто может выполнять переработку; **на узле** = кто
  может исследовать узел. Проверяются независимо, деревья у фракций свои. Итоговая
  формула доступности правила: фракция игрока ∈ RequiredFactions правила **И** узел
  RequiredNode выполнен **в дереве фракции игрока**. Следствие: правило, общее для двух
  фракций, но запертое за узлом, который может исследовать только одна из них
  (RequiredFactions узла), для второй фракции недостижимо — валидатор редактора должен
  подсвечивать такие комбинации как вероятную ошибку конфига.
- Цепочка = данные: выход шага N — вход шага N+1. Фреймворк цепочек «не знает», их
  визуализирует и валидирует редактор (недостижимые входы, циклы, вход без источника).
- Выдача выходов: probe + `FindFreeLocationFor` + `LocationCreateEntity` (учёт поворота,
  паттерн TraderInventoryRotationFix), fallback — на землю.

## 4. Дерево технологий

```jsonc
// $profile:ZP_Research\TechTree\bio.json (файл = ветка)
{
  "ConfigVersion": 1,
  "Branch": { "Id": "bio", "Name": "Биология мутантов", "Icon": "zp_branch_bio", "SortOrder": 1 },
  "Nodes": [
    {
      "Id": "bio_t1_sampling",
      "Name": "Отбор образцов",
      "Tier": 1,                                // отображение/раскладка, не механика
      "Parents": [], "ParentsMode": "all",
      "Cost": [ { "Type": "field", "Amount": 15 } ],
      "ItemCost": [],
      "ResearchTimeSec": 0,
      "RequiredFactions": ["eAIFactionEcologist", "eAIFactionClearSky"]
    },
    {
      "Id": "bio_t2_anatomy",
      "Name": "Анатомия мутантов",
      "Description": "Систематическое изучение тканей...",
      "Icon": "zp_node_anatomy",
      "Tier": 2,
      "Parents": ["bio_t1_sampling"],
      "ParentsMode": "all",                     // all | any
      // ВАЖНО (урок ревью): стоимость узла — только из источников, доступных ДО него:
      // field-очки и образцы даёт правило psydog_tail_sample (RequiredNode: ""),
      // а lab-очки появятся из mutagen_microscopy уже ПОСЛЕ этого узла.
      "Cost": [ { "Type": "field", "Amount": 50 } ],
      "ItemCost": [ { "Classname": "ZP_Sample_Mutagen", "Quantity": 3 } ],
      "ResearchTimeSec": 3600,
      "ResearchDevice": "ZP_ScienceComputer",
      "RequiredFactions": ["eAIFactionEcologist"]
    }
  ]
}
```

- **Статусы**: locked → available (родители готовы + фракция) → researching → completed.
  Состояние — в FactionData (v1: дерево фракционное, см. §2).
- **Что открывает узел** — нигде не перечисляется в самом узле: правила ссылаются на него
  через RequiredNode, приборы — через RequiredNode в Devices.json, рецепты — через
  проверку узла в CanDo. UI собирает список «узел X открывает…» автоматически.
- **Проекты**: `ResearchTimeSec > 0` — исследование запускается на `ResearchDevice`,
  списывает Cost/ItemCost при старте, идёт реальное время (timestamp; завершается и
  оффлайн — паттерн CraftSystem), RP-событие для фракции. `ResearchTimeSec = 0` —
  мгновенно: **ItemCost изымается из инвентаря игрока, инициирующего исследование**, в
  месте взаимодействия (UI дерева на приборе); Cost — из пула согласно PointsOwnership.
- **Repeatable отложен до v2** (в v1 узел одноразовый): у узла нет наград кроме
  разблокировок, повтор бессмыслен; в v2 добавим CompletionRewards для узлов-конвертеров.

## 5. Оборудование

### Тиры приборов

| Тир | Пример | Форм-фактор | Питание |
|---|---|---|---|
| 1 | полевой набор (чашки Петри, пробирки) | переносной предмет | нет |
| 2 | микроскоп, центрифуга | переносной/настольный (kit) | батарея (EnergyManager) |
| 3 | научный компьютер, лабораторный комплекс | статичный | батарея/генератор |

Доступ к приборам тира N дают **узлы дерева** (Devices.json → RequiredNode), не «тир
очков».

```jsonc
// $profile:ZP_Research\Devices.json (фрагмент)
{
  "ConfigVersion": 1,
  "Devices": [
    { "Classname": "ZP_Microscope", "Tier": 2, "SlotMode": "attachments",
      "Slots": { "Input": 2, "Consumables": 2, "Tool": 1, "Battery": 1, "Output": 2 },
      "EnergyPerCycle": 3, "IsStatic": false, "RequiredNode": "bio_t1_sampling",
      "RequiredWorn": [] },
    { "Classname": "Land_pult", "Tier": 3, "SlotMode": "handsOnly",
      "IsStatic": true, "RequiredNode": "eng_t2_terminals",
      "RequiredWorn": ["SGE_SSP_99M"] }                    // гейт экипировкой (паттерн WTHealth)
  ]
}
```

- **Матчинг прибора в правилах**: `Device` матчится `GetGame().IsKindOf` (суффикс `|1` —
  точное совпадение). **Эффективный тир** = `Tier` инстанса из StaticDevices.json, если
  задан, иначе `Tier` класса из Devices.json. Правило срабатывает при
  `эффективный тир >= MinDeviceTier`. Валидация при загрузке: правило, чья пара
  Device+MinDeviceTier не матчит ни один настроенный прибор, — предупреждение в лог.
- **`SlotMode`**: `attachments` — наши классы приборов со слотами
  (GUIInventoryAttachmentsProps: секции Input/Consumables/Output); `handsOnly` — для
  **чужих статиков** (пульты NewHorizon, лаборатории X-12 — у них нет наших слотов, а
  добавлять attachments чужому классу = жёсткая зависимость от чужого мода): вход
  берётся из рук игрока (паттерн-катализатор BBP), расходники — из инвентаря, выход —
  в инвентарь через FindFreeLocationFor / на землю. Состояние чужого статика — не в
  ModStorage (нельзя без зависимости), а в позиционном реестре JSON (паттерн CBD:
  ключ = позиция с допуском 1 м).
- **Переносные приборы**: Inventory_Base + EnergyManager (батарея-attachment, OnWork) —
  канон SF_Detector_Base/PDA_WT; свой слот игрока при желании (квартет DLCSlots).
- **Статичные**: вариант А — kit → hologram → OnPlacementComplete (MMG/CannabisPlus),
  апгрейд тира заменой объекта (MMG); вариант Б — админ ставит через DayZ Editor
  (Editor Loader на сервере: `$mission:\EditorFiles\*.dze`) или `StaticDevices.json`
  (`{Classname, Position, Orientation, Tier, Flags}` — паттерн Enhanced Banking), а
  фреймворк вешает интерактив на классы из конфига. Модели уже в модпаке: консоли
  Land_pult / Land_mtl_pult1 / Land_prop_pult4, стойки приборов Land_prop_pribori_02/03,
  весы Land_mtl_vesa, интерьер Land_int_bunker_laba (NewHorizon), лаборатории X-12 (GSC).
  Двойной класс (портатив+статик на одной модели) — паттерн Yanova.

### Расходники

Обычные предметы (`ZP_Reagent_*`, `ZP_SlideGlass`, фильтры): спавн через types.xml
(шаблон nominal=0 в комплекте), трейдер, крафт. Высокие тиры требуют больше и реже
встречающихся расходников — второй рычаг «дороговизны» после очков; батареи — третий.

## 6. Файлы конфигурации (сводно)

```
$profile:ZP_Research\
├── Settings.json            PointsOwnership, MaxActionTimeSec, кривая DiminishGroup,
│                            окна сброса капов, ревизия конфига, дебаг
├── PointTypes.json          типы очков
├── Devices.json             приборы (тир, слоты, SlotMode, RequiredNode, RequiredWorn)
├── StaticDevices.json       админ-размещённые статичные станции (per-instance Tier)
├── ProcessingRules\*.json   правила переработки (папка, hot-reload)
├── TechTree\*.json          ветки дерева
├── PlayerData\<steam64>.json личные очки/вклад/анти-фарм-счётчики
├── FactionData\<f>.json     пулы очков + CompletedNodes/ActiveProjects фракций
├── ConfigBackup\            автобэкапы при миграции
└── explanation.txt          автоген-справка для админа
```

**Hot-reload**: перезагрузка ProcessingRules/TechTree по админ-команде (и/или
poll-таймеру, паттерн CraftSystem) обязана **разослать обновлённый конфиг всем
подключённым клиентам** (тот же путь, что и синк при коннекте) и инкрементировать
`ConfigRevision`, чтобы клиенты сбрасывали устаревшее состояние — иначе до реконнекта
экшены у игроков показываются/прячутся неправильно.

**Канон схем**: JSON Schema — канонический контракт, версионируется в репо мода рядом
со скрипт-классами, **по файлу на ConfigVersion** (`pointtypes.v1.schema.json`, …).
Веб-редактор импортирует эти схемы на сборке (не переопределяет!) и отказывается
открывать файл с незнакомым ConfigVersion, предлагая миграцию модом. Правило релиза:
бамп ConfigVersion = скрипт-миграция + новый schema-файл + релиз редактора одним
изменением (пункт роадмапа M6+).

## 7. UI

- **Дерево**: вкладка в Expansion Book (проверенный tab API; пример — вкладка Factions
  у Hardline) ИЛИ отдельное меню на Dabs MVC. Узлы — динамическая инстанциация мелких
  .layout на узел (подход Terje, масштабируется на конфиг-деревья); иконки — свой
  imageset (+ FontAwesome-набор Dabs по ссылке).
- **Прибор**: слоты с секциями + прогресс; научный компьютер — меню в духе PDA
  (singleton-клиент + RPC enum). Тултипы «исследовательской ценности» предметов —
  инъекция в ItemManager (паттерн Delta/WTHealth).
- **Админ**: полный внутриигровой редактор (решение 2026-07-31, спек
  `docs/superpowers/specs/2026-07-31-zp-research-m0-design.md`): фаза 1 (M3.5) — формы
  правки значений узлов/правил, вкл/выкл, hot-reload; фаза 2 (M6) — создание/удаление
  узлов и правил в игре. Все правки — через серверный контракт **ZP_ConfigOp** (RPC:
  UpsertNode/DeleteNode/UpsertRule/DeleteRule/SetSetting/UpsertPointType/ReloadAll;
  право → Validate() как при загрузке → применить → сохранить с бэкапом →
  ConfigRevision++ → ребродкаст; ошибки — ответным RPC инициатору). Права — VPP
  permission string `"ZP.Research.Admin"` под `#ifdef VPPADMINTOOLS` (VPP есть в
  модпаке) + fallback `AdminIds[]` в Settings.json. Веб-редактор — второй клиент того
  же контракта (пишет те же JSON).

## 8. Веб-редактор дерева

Прототипы изучены (DZPage, DZconfig, TraderPlusEditor, DayZMod.tools — см. каталог):
вывод — формы-над-JSON с валидацией и экспортом точных файлов; граф-редактор — наше
уникальное дополнение.

- **Статический SPA без бэкенда** (GitHub Pages / локальный файл): React + React Flow
  (или Svelte + Svelte Flow): ветки-дорожки, узлы-карточки, рёбра-зависимости,
  drag-n-drop, мини-карта. Экспорт — zip со структурой `$profile:ZP_Research\`
  один-в-один, чистый JSON без комментариев.
- **Item DB**: импорт списка классов (текст/types.xml/дамп модпака — каталог классов
  сервера уже собран) → автокомплит с подсветкой несуществующих.
- **Валидация = канонические JSON Schema + правила целостности**: циклы, недостижимые
  узлы, RequiredNode на несуществующий узел, разрывы цепочек (вход без источника), очки,
  которые негде заработать до узла (bootstrap-проверка стоимостей — урок ревью v0.1),
  правила без матчащихся приборов, битые классы. Ошибки — списком, с путём к файлу
  (UX DZPage).
- **Этапы**: MVP = TechTree + PointTypes (граф, валидация, экспорт); v2 =
  ProcessingRules + визуализация цепочек «предмет → правило → предмет»; v3 = Devices /
  StaticDevices + калькулятор гринда (сколько переработок до узла).

## 9. Модули мода

| Модуль | Тир | Ответственность | Паттерн-источник |
|---|---|---|---|
| ZP_Settings | 3_Game | загрузка/валидация/миграция JSON, синк при коннекте, hot-reload + ребродкаст + ConfigRevision | Expansion Settings, cookbook §1–2 |
| ZP_PointsDB | 3_Game (CF module) | очки per-player/per-faction, анти-фарм-счётчики, персист, RPC-on-dirty (KV-пары) | Hardline + cookbook §3 |
| ZP_TechTree | 3_Game | фракционные деревья, проекты (timestamps), применение разблокировок | Expansion Quests persistence |
| ZP_Processing | 4_World | правила, экшены (Mode=action), фоновые процессы (Mode=background), выдача | CP_Workbench + cookbook §4 |
| ZP_DeviceBase | 4_World | классы приборов, SlotMode, энергия, позиционный реестр чужих статиков | SF_Detector/PDA/Yanova/CBD |
| ZP_UI | 5_Mission | дерево (Book tab/Dabs), меню приборов, тултипы | cookbook §10 |
| ZP_AdminBridge | 4_World/5_Mission | админ-команды, VPP-права, COT-меню (#ifdef-опционально) | cookbook §2/§13 |

## 10. Дорожная карта

1. **M0**: скелет мода (assets/mod-template), Settings + PointTypes + PlayerData,
   чит-команды, **фундамент редактора**: ZP_ConfigOp (SetSetting/UpsertPointType/
   ReloadAll), права VPP+fallback; пак Addon Builder'ом, запуск на DayZDiag. ← в работе
2. **M1**: ZP_Processing MVP — одно action-правило, один переносной прибор, очки, шанс,
   нотификация (CF NotificationSystem).
3. **M2**: цепочки + расходники + background-режим с timestamp-персистентностью +
   анти-фарм-поля.
4. **M3**: дерево (данные + гейтинг без UI), фракционные пулы, проекты, hot-reload с
   ребродкастом.
5. **M3.5**: внутриигровой редактор, фаза 1 — формы правки значений узлов/правил,
   вкл/выкл правил, hot-reload из меню (админ-права VPP).
6. **M4**: UI дерева (Book tab), UI приборов, тултипы.
7. **M5**: статичные станции (kit + StaticDevices.json + .dze), SlotMode=handsOnly для
   чужих статиков, тиры, гейт экипировкой.
8. **M6**: JSON Schema (канон) + веб-редактор MVP + **редактор фаза 2** (создание/
   удаление узлов и правил в игре) + автоген explanation.txt.
9. **M7**: полировка: калькулятор баланса, подпись, публикация.

## Открытые вопросы к админам сервера

1. Какие классы артефактов реально в игре (AnomalySystemWT их не содержит — детекторы
   только ищут; кандидаты: SFP, @STALKER Equipment)?
2. Какая карта сейчас живая (ExclusionZone по мониторингу vs @Alteria в паке)?
3. Фракционная прогрессия ок для RP (наш default), или нужна личная?
4. Есть ли доступ к их серверному AI-фреймворку (@StalkerAI* — битые junction'ы)?
