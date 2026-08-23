# Ассеты приборов ZP_Research: модели, классы, статик-паттерн

Дата: 2026-07-31. Статус: итог исследовательского свипа (ванильные PBO + модпак сервера
[UA] Stalker: Zone Protocol Ai [RP]). Все пути `model=` ниже перепроверены по plaintext-таблицам
имён PBO и по `prefix`-свойству заголовков (structures_furniture → `DZ\structures\furniture`,
gear_containers → `DZ\gear\containers`, gear_radio → `DZ\gear\radio`,
structures_specific → `DZ\structures\specific`). Директива: большинство приборов — **стационарные**;
новых 3D-моделей не делаем; репак чужих PBO запрещён.

Связанные документы: скил `references/server-zone-protocol.md` (§Station model donors),
`references/items-and-processing.md` (ECE-флаги, чек-лист статик-контейнера),
`references/patterns-cookbook.md` (§6 размещение, §12 лицензии, §14 lifecycle).

---

> **Дополнено 2026-08-09:** таблица §1 описывает только пять «старых» приборов
> (`ZP_Microscope`, `ZP_LabComputer`, `ZP_ChemBench`, `ZP_ServerRack`, `ZP_SampleFridge`)
> плюс два портатива. Двенадцать приборов фракций стенда и модели предметов цепочки
> (образцы `ZP_Sample_01..30`, заготовки `ZP_Data_01..90`) — в **§4a**.

## 1. Итоговая таблица выбора

Приоритет: **ванила > модпак-референс**. «Ваниль-канон» = референс `model="\dz\..."` из нашего
config.cpp или наследование ванильного класса — файлы не копируются, зависимостей не добавляется
(кроме requiredAddons на ванильный CfgPatches для наследования). Модпак-референсы — только через
`requiredAddons` и только в отдельном опциональном PBO `ZP_Research_NH` (см. §5).

| Прибор ZP | Основной выбор | Запасной вариант | Источник | Лицензия | Тип |
|---|---|---|---|---|---|
| **Микроскоп** (главная станция T2, `ZP_Microscope`) | `\DZ\structures\furniture\School_equipment\lab_microscope.p3d` | текущий `\dz\gear\cooking\CookingStand.p3d` (fallback, если у structure-p3d нет geometry/вида) | ваниль, structures_furniture.pbo | ваниль-канон | статик |
| **Научный компьютер** (`ZP_LabComputer`) | `\DZ\structures\furniture\Eletrical_appliances\pc\PC.p3d` (опечатка Bohemia в папке — «Eletrical» без c, путь именно такой) | T3-консоль: `\DZ\structures\furniture\radar_equipment\radar_electronics.p3d`; атмосферно: NH `Land_mtl_pult1`/`Land_pult` (опц. PBO) | ваниль, structures_furniture.pbo | ваниль-канон | статик |
| **Чашки Петри** (`ZP_PetriDishKit`, портатив-исключение) | `\DZ\structures\furniture\School_equipment\lab_petri_dish.p3d` | оставить `CookingStand.p3d`, если инвентарь-LOD/иконка structure-p3d не отрендерится | ваниль, structures_furniture.pbo | ваниль-канон | портатив |
| **Химический стенд / колбы** (`ZP_ChemBench`) | `\DZ\structures\furniture\School_equipment\lab_teacher_bench.p3d` (целый лабораторный стол с раковиной) | `lab_bench.p3d`; декор сверху: `lab_erlenmeyer_flask/lab_beaker/lab_vial/lab_bunsen.p3d` (Editor Loader); NH `Land_mtl_tubes3b` | ваниль, structures_furniture.pbo | ваниль-канон | статик |
| **Анализатор** (био/мед) | `\DZ\structures\furniture\medical\patient_monitor\patient_monitor.p3d` (+ подставка `medical\medical_table\medical_table.p3d`) | NH `Land_prop_pribori_02/03` (стойки приборов STALKER, опц. PBO) | ваниль, structures_furniture.pbo | ваниль-канон | статик |
| **Центрифуга** | рекомендация: **слить роль с анализатором** (настоящей центрифуги в ваниле нет) | если очень нужна отдельная: `\DZ\structures\furniture\Eletrical_appliances\washing_machine\washing_machine.p3d` (постирония Зоны) или NH `Land_prop_pribori_*` | ваниль / NH | ваниль-канон / референс | статик |
| **Холодильник/шкаф образцов** (`ZP_SampleFridge`) | наследование класса **`RefrigeratorMinsk`** (model `\DZ\gear\containers\fridge.p3d`; готовое карго 2x5, энергия, заморозка) | статик-модели: `kitchen\fridge\fridge.p3d`, `generalstore\icebox.p3d`; витрины `Cases\...` для «шкафа образцов» | ваниль 1.28+, gear_containers.pbo | ваниль-канон (наследование; requiredAddons `DZ_Gear_Containers`) | either → ставим как статик |
| **Сервер-стойка** (`ZP_ServerRack`) | `\DZ\structures\furniture\radar_equipment\radar_rack_quad.p3d` (блок из 4) | одиночная `radar_rack.p3d`; NH `Land_prop_el_shkaf_01..03` | ваниль, structures_furniture.pbo | ваниль-канон | статик |
| **Радиостанция / пульт связи** (T3) | наследование **`Land_Radio_PanelBig`** (structures_specific, scope=2, готовый EnergyManager 0.2/с) — единственный крупный ванильный статик-прибор с публичным классом | настольный прибор: наследование `BaseRadio` (gear_radio, model `Base_radio_station_g.p3d`, EnergyManager+CarBattery); декор: `radio_b.p3d` | ваниль, structures_specific.pbo / gear_radio.pbo | ваниль-канон (requiredAddons `DZ_Structures_Specific` / `DZ_Radio`) | статик / either |
| **Полевой научный кейс** (`ZP_FieldCase`, портатив) | наследование **`ScientificBriefcase`** (model `\DZ\gear\containers\ScientificCase.p3d`, карго 6x4 — родная научная тематика, Frostline) | `\dz\gear\tools\electronicCase.p3d` (модель ElectronicRepairKit) | ваниль, gear_containers.pbo | ваниль-канон (requiredAddons `DZ_Gear_Containers`) | портатив |
| **Весы** (бонус-прибор) | `\DZ\structures\furniture\School_equipment\lab_triplebeam.p3d` | `generalstore\scale.p3d`; NH `Land_mtl_vesa` | ваниль, structures_furniture.pbo | ваниль-канон | статик |
| **Столы/обвязка станций** | `lab_bench.p3d`, `medical_table.p3d`, `Tables\office_desk\Desk_Office.p3d` — отдельные статики через DayZ Editor Loader | NH `Land_mtl_verstak`, `Land_mtl_stol_instrum` | ваниль / NH | ваниль-канон / референс | статик (декор) |
| **Интерьер лаборатории целиком** | `Land_Underground_Storage_Laboratory` (structures_bliss, Livonia — есть у всех владельцев DayZ) | NH `Land_int_bunker_laba`, GSC `Yantar_bunker_ekologov`, `Backwater_x12lab_*` — админ-размещение через Editor Loader | ваниль / модпак | референс/размещение | статик (не прибор) |

Работоспособность structure-p3d как standalone-объектов доказана прецедентом: @BuilderItems
объявляет `bldr_lab_microscope`, `bldr_lab_petri_dish`, `bldr_radar_rack` и т.д. ровно на этих
моделях.

---

## 2. Рецепт статик-станции (выбранный подход — единственный рекомендуемый)

**Решение: статик-прибор остаётся ItemBase.** Тонкий сабкласс `ZP_Device_StaticBase : ZP_Device_Base`
с безусловными запретами взятия — БЕЗ перевода на House/Land_.

Почему (всё верифицировано по исходникам build 124708 и живым тестом M2b):

- Это канон самой Bohemia: `PowerGeneratorStatic : PowerGeneratorBase` — ItemBase в папке
  `4_world\entities\building`, IsTakeable=false + CanPutInCargo=false + CanPutIntoHands=false +
  IsActionTargetVisible=true (powergeneratorstatic.c:143–229). Тот же трюк у BaseBuildingBase и
  GardenPlot.
- Всё наше M2b-хозяйство сохраняется **без изменений**: карго (`itemsCargoSize`), локи
  `CanReleaseCargo`/`CanReceiveItemIntoCargo` при RUNNING, netsync `m_ZP_State`, экшены
  (ActionInteractBase/ActionContinuousBase), CF_ModStorage (CF вешает сторадж именно на ItemBase)
  и хайв-персистентность — рестарт-тест M2b уже доказал это вживую.
- House/Land_ состояние НЕ персистит: комментарий разработчиков BI в powergeneratorstatic.c:64 —
  состояние здания хранится в ItemBase-сущности, «building side не работает». Единственный
  OnStoreSave во всей папке building — у PowerGeneratorStatic.
- Прицел-виджет: `actiontargetscursor.c:759` прячет виджет у ItemBase с IsTakeable()=false —
  поэтому `IsActionTargetVisible()=true` ОБЯЗАТЕЛЕН (для этого он и существует, itembase.c:4405).

### 2.1 Скрипт (4_World, добавить в ZP_Devices.c)

```c
// Стационарный прибор: ItemBase (карго/netsync/CF-сторадж/хайв сохраняются),
// но взять в руки/инвентарь нельзя НИКОГДА (безусловно, не только при RUNNING).
// Канон: PowerGeneratorStatic (powergeneratorstatic.c:143-229).
class ZP_Device_StaticBase : ZP_Device_Base
{
    override bool IsTakeable()
    {
        return false;
    }

    override bool CanPutIntoHands(EntityAI parent)
    {
        return false;
    }

    override bool CanPutInCargo(EntityAI parent)
    {
        return false;
    }

    override bool CanRemoveFromCargo(EntityAI parent)
    {
        return false;
    }

    // ItemBase с IsTakeable=false прячет прицел-виджет (actiontargetscursor.c:759) —
    // возвращаем показ, иначе экшены «Запустить анализ» не видны игроку
    override bool IsActionTargetVisible()
    {
        return true;
    }

    // DisableVicinityIcon НЕ переопределять: PowerGeneratorStatic прячет себя из vicinity,
    // а нашим станциям нужен доступ игрока к карго через vicinity-панель.
}
```

Существующие условные запреты `ZP_Device_Base` (только при RUNNING) остаются для портативов;
статик-сабкласс перекрывает их безусловно. `ZP_Microscope` перевесить на `ZP_Device_StaticBase`
(имя класса НЕ менять — хайв-сейвы и storageVersion=2 сохраняются).

### 2.2 Спавн и персистентность

- **ItemBase-статик спавнится ОДИН раз** — дальше живёт в хайве (доказано M2b: объект,
  созданный CreateObjectEx, пережил graceful-рестарт вместе с CF-стораджем).
- Спавнер: `$profile:ZP_Research\StaticDevices.json` → `MissionServer.OnInit` →
  `GetGame().CreateObjectEx(classname, pos, ECE_PLACE_ON_SURFACE | ECE_CREATEPHYSICS | ECE_NOLIFETIME)`
  (+ SetOrientation по ypr из конфига). `ECE_NOLIFETIME` = без CE-таймера очистки
  (CentralEconomy.c:7-40, значение 4194304).
- **Дедуп обязателен** (иначе дубль каждый рестарт): реестр живых ZP-приборов через
  `EEInit → Register` / `EEDelete → Unregister` (static map в ZP_Device_StaticBase, паттерн
  PowerGeneratorStatic: static set инстансов + GetClosestGenerator(position, tolerance));
  на буте спавнить только записи конфига, для которых нет живого прибора того же класса в
  радиусе < 1 м.
- **Страховка от CE-чистки**: types.xml с `nominal=0, min=0, lifetime=3888000` (как у заборов) —
  И спавнить с ECE_NOLIFETIME.
- **Админ-размещение**: DayZ Editor → экспорт .dze/init.c работает из коробки — наши классы
  создаются стандартным CreateObjectEx-путём. Editor Loader-объекты (.dze в
  `$mission:EditorFiles`) — для декора/интерьеров (House-статики, спавнятся каждый бут).

### 2.3 Отвергнутые альтернативы паттерна

- **House/Land_ как носитель состояния** — не персистится никогда (пруф BI выше); годится
  только для декора и интерьеров.
- **Пара «House-здание + невидимый ItemBase-держатель по позиции»** (как
  Land_WarheadStorage_PowerStation ↔ PowerGeneratorStatic) — рабочий ванильный обход, но для
  ZP лишняя сложность: принят ItemBase-статик, вопрос закрыт.
- **Экшены на уже стоящих лаб-статиках карты** (building-side `SetActions`/`AddAction` на
  сабклассе HouseNoDestruct — маршрут подтверждён: well.c:28-33, nh_OldWell) — оставить как
  вспомогательный для будущих «якорных» точек, но карго-станции — только ItemBase.

---

## 3. config.cpp — готовые сниппеты

Дополнить `requiredAddons` (наследование классов требует гарантии порядка загрузки; для чистых
`model=`-референсов на ванильные data-PBO зависимость не нужна):

```cpp
class CfgPatches
{
    class ZP_Research
    {
        units[] = {};
        weapons[] = {};
        requiredVersion = 0.1;
        requiredAddons[] =
        {
            "DZ_Data",
            "DZ_Scripts",
            "JM_CF_Scripts",
            "DZ_Gear_Containers"     // наследование RefrigeratorMinsk / ScientificBriefcase
        };
    };
};
```

Сниппеты приборов (CfgVehicles; extern-объявления родителей обязательны):

```cpp
class CfgVehicles
{
    class Inventory_Base;
    class Container_Base;
    class RefrigeratorMinsk;        // ваниль 1.28+, gear_containers (DZ_Gear_Containers)
    class ScientificBriefcase;      // ваниль Frostline, gear_containers

    // ---- СТАТИКИ (скрипт-класс ZP_Device_StaticBase) ----

    // Микроскоп — главная станция T2 (та же, что в M2b, новая модель)
    class ZP_Microscope : Inventory_Base
    {
        scope = 2;
        displayName = "$STR_zp_microscope";
        descriptionShort = "$STR_zp_microscope_desc";
        model = "\DZ\structures\furniture\School_equipment\lab_microscope.p3d";
        weight = 12000;
        itemSize[] = {3, 3};
        itemsCargoSize[] = {4, 4};
        physLayer = "item_large";
        rotatable = 1;
    };

    // Научный компьютер (внимание: «Eletrical» — опечатка Bohemia, путь именно такой)
    class ZP_LabComputer : Inventory_Base
    {
        scope = 2;
        displayName = "$STR_zp_labcomputer";
        descriptionShort = "$STR_zp_labcomputer_desc";
        model = "\DZ\structures\furniture\Eletrical_appliances\pc\PC.p3d";
        weight = 15000;
        itemSize[] = {4, 4};
        itemsCargoSize[] = {4, 4};
        physLayer = "item_large";
        rotatable = 1;
    };

    // Химический стенд — целый лабораторный стол с раковиной
    class ZP_ChemBench : Inventory_Base
    {
        scope = 2;
        displayName = "$STR_zp_chembench";
        descriptionShort = "$STR_zp_chembench_desc";
        model = "\DZ\structures\furniture\School_equipment\lab_teacher_bench.p3d";
        weight = 80000;
        itemSize[] = {10, 5};
        itemsCargoSize[] = {6, 4};
        physLayer = "item_large";
        rotatable = 1;
    };

    // Сервер-стойка (счетверённая) — хранилище данных исследований
    class ZP_ServerRack : Inventory_Base
    {
        scope = 2;
        displayName = "$STR_zp_serverrack";
        descriptionShort = "$STR_zp_serverrack_desc";
        model = "\DZ\structures\furniture\radar_equipment\radar_rack_quad.p3d";
        weight = 120000;
        itemSize[] = {10, 10};
        itemsCargoSize[] = {6, 6};
        physLayer = "item_large";
        rotatable = 1;
    };

    // Холодильник образцов: наследование даёт карго 2x5 + энергию + заморозку бесплатно.
    // Скрипт-класс: ZP_SampleFridge : ZP_Device_StaticBase (RefrigeratorMinsk — ItemBase-семейство,
    // но в скриптах нашей станции base остаётся ZP_Device_Base-веткой — конфиг-родитель и
    // скрипт-родитель независимы; проверить, что скрипт-класс ZP_SampleFridge объявлен).
    class ZP_SampleFridge : RefrigeratorMinsk
    {
        scope = 2;
        displayName = "$STR_zp_samplefridge";
        descriptionShort = "$STR_zp_samplefridge_desc";
        weight = 90000;   // «намертво» тяжёлый + скриптовые запреты взятия
    };

    // ---- ПОРТАТИВЫ ----

    // Чашки Петри — портатив-исключение, апгрейд модели (fallback: CookingStand.p3d)
    class ZP_PetriDishKit : Inventory_Base
    {
        scope = 2;
        displayName = "$STR_zp_petridishkit";
        descriptionShort = "$STR_zp_petridishkit_desc";
        model = "\DZ\structures\furniture\School_equipment\lab_petri_dish.p3d";
        weight = 500;
        itemSize[] = {2, 2};
        rotatable = 1;
    };

    // Полевой научный кейс — переносной набор/транспорт образцов T1
    class ZP_FieldCase : ScientificBriefcase
    {
        scope = 2;
        displayName = "$STR_zp_fieldcase";
        descriptionShort = "$STR_zp_fieldcase_desc";
        weight = 4000;
    };
};
```

Обязательная проверка в игре перед принятием (structure-p3d в роли ItemBase — известный риск):

1. Спавн `!zp spawnground` каждого класса → модель видна, коллизия есть, экшен-прицел
   «Провести анализ» появляется (IsActionTargetVisible).
2. Vicinity-панель показывает прибор и открывает карго (иконка может быть generic —
   допустимо для статика, в инвентарь он не попадает).
3. `ZP_PetriDishKit` (портатив!): иконка в инвентаре и в руках — если structure-p3d без
   inventory-LOD рендерится мусором, откатить model= на CookingStand.p3d (одна строка).
4. Рестарт-тест: статик на месте, дубль не заспавнился (дедуп), RUNNING-станция возобновилась.

---

## 4. Отвергнуто и почему

| Кандидат | Причина отказа |
|---|---|
| @Radio/WT (PDAWT, AnomalySystemWT...) — модельные пути | Обфусцированный нелицензионный репак: таблицы имён содержат только декой-пути вида `\COM2.{GUID}\...\tZjHIMPL.p3d` — `model=` на них строить нельзя. Разрешены только classname'ы (SF_DETECTOR_*, PDA_WT) как входы/гейты в JSON-правилах. |
| @Last Road RP Items Pack (`ro_rp_analizator`, `ro_rp_micro`, `ro_rp_colba`...) | PBO обфусцирован (847MB, декой-имена) — модельные пути непригодны, репак запрещён. Использовать ТОЛЬКО как classname-входы/промежуточные предметы правил переработки (ConfigIsExisting). Для наследования пришлось бы сначала извлекать CfgPatches через ScanPbo.ps1 — не оправдано. |
| @DayZ-Expansion-Bundle (ExpansionPropMiniFridge, Cooler...) | CC BY-NC-ND: допустим только референс через зависимость, но ванильный RefrigeratorMinsk закрывает роль полностью — лишняя жёсткая зависимость от огромного мода. |
| @MMG Base Storage (mmg_fridge_minsk_*) | No-repack; нужен только если ванильный холодильник не подойдёт — не подтвердилось. |
| GSC Furniture_radiostation1..16 (AoD) | CC BY-NC-ND + привязка к тяжёлому паку; ванильные radar_rack/Radio_PanelBig закрывают роль. |
| Стиральная машина как «центрифуга» (основной вариант) | Оставлена лишь как запасной: роль центрифуги сливается с анализатором (patient_monitor), отдельный прибор не нужен на старте. |
| House/Land_-класс как носитель состояния станции | Не персистится движком вообще (пруф BI: powergeneratorstatic.c:64); только декор/интерьеры. |
| Перевод ZP_Device_Base на House | Потеря карго-механики M2b, CF_ModStorage-хук мёртв для скрипт-спавненных статиков, экшены пришлось бы перевешивать — отвергнуто в пользу ItemBase-статика. |
| `pressure_monitor.p3d` (gear_tools) | Класса-владельца в конфигах нет (вероятно cut-контент) — рендер не гарантирован; отложено до проверки в игре. |
| Отдельный публичный DayZ-скил StarDZ рядом | Не ассет, но напоминание: не ставить — конфликт имени; всё ценное уже влито. |

## 4a. Стендовые приборы фракций (12 штук, 2026-08-09)

Дополнение к §1: та таблица знает только пять «старых» статиков. Ниже — двенадцать
приборов стенда (2 фракции × 3 категории баллов × 2 роли). Схема имени
`ZP_<Eco|Sky>_<Pack|Proc>_<Bio|Anom|Electro>`; `Pack` — упаковщик (сырьё → образец),
`Proc` — анализатор (образец → заготовка данных). Принадлежность фракции задаёт НЕ класс,
а `Factions.json → DeviceClasses`: имя класса — только подсказка админу.

**Модели ВРЕМЕННЫЕ** (решение владельца: «потом поменяем»). Все двенадцать —
`structures_furniture.pbo` (prefix `DZ\structures\furniture`), ванильные `model=`-ссылки,
никаких зависимостей и никакого репака.

**Как проверялся каждый путь** (метод T1, сильнее грепа `componentNN` — тот дал ложное
срабатывание даже на `lab_petri_dish.p3d`): имя берётся из ТАБЛИЦЫ ИМЁН самого PBO, затем
p3d разбирается как ODOL v54 — в перечне LOD-ов должен быть **Geometry** (иначе коллизии
не будет вообще), а габариты снимаются с bounding box. Метод откалиброван на известных
случаях: `lab_teacher_bench` дал 2.55×1.17×0.84 (совпало с замером в комментарии
`ZP_ChemBench`), `radar_rack_quad` — 3.18×1.99, а `lab_petri_dish` честно показал
ОТСУТСТВУЮЩИЙ Geometry LOD — ровно то, что в M5a стоило отдельной живой проверки.

Габариты — **ширина × высота × глубина** в метрах (ось Y в движке — вверх).

| Класс | Роль | Фракция | Модель (`\DZ\structures\furniture\…`) | Габариты | itemSize | Карго | Вес |
|---|---|---|---|---|---|---|---|
| `ZP_Eco_Pack_Bio` | упаковщик био | ecolog | `medical\medical_table\medical_table.p3d` | 1.06×1.02×0.54 | {4,4} | 6×4 | 45 кг |
| `ZP_Eco_Proc_Bio` | анализатор био | ecolog | `medical\patient_monitor\patient_monitor.p3d` | 0.71×1.57×1.24 | {3,6} | 4×4 | 40 кг |
| `ZP_Eco_Pack_Anom` | упаковщик аномалий | ecolog | `School_equipment\lab_bench.p3d` | 1.70×0.95×0.77 | {7,4} | 6×4 | 60 кг |
| `ZP_Eco_Proc_Anom` | анализатор аномалий | ecolog | `generalstore\scale.p3d` | 0.41×0.97×0.80 | {2,4} | 4×4 | 30 кг |
| `ZP_Eco_Pack_Electro` | упаковщик электроники | ecolog | `School_equipment\class_case_a_open.p3d` | 0.92×1.18×0.94 | {4,5} | 6×4 | 50 кг |
| `ZP_Eco_Proc_Electro` | анализатор электроники | ecolog | `radar_equipment\radar_rack.p3d` | 0.77×1.99×0.66 | {3,8} | 4×4 | 90 кг |
| `ZP_Sky_Pack_Bio` | упаковщик био | clearsky | `generalstore\icebox.p3d` | 1.95×1.24×0.95 | {8,5} | 6×4 | 55 кг |
| `ZP_Sky_Proc_Bio` | анализатор био | clearsky | `kitchen\Kitchenstove_Elec\Kitchenstove_Elec.p3d` | 0.50×0.85×0.62 | {2,3} | 4×4 | 45 кг |
| `ZP_Sky_Pack_Anom` | упаковщик аномалий | clearsky | `Cases\locker\locker_closed_v1.p3d` | 0.40×1.90×0.55 | {2,8} | 6×4 | 50 кг |
| `ZP_Sky_Proc_Anom` | анализатор аномалий | clearsky | `Eletrical_appliances\washing_machine\washing_machine.p3d` | 0.81×1.19×0.65 | {3,5} | 4×4 | 60 кг |
| `ZP_Sky_Pack_Electro` | упаковщик электроники | clearsky | `Tables\office_desk\Desk_Office.p3d` | 1.81×0.84×0.86 | {7,3} | 6×4 | 50 кг |
| `ZP_Sky_Proc_Electro` | анализатор электроники | clearsky | `Various\Drill.p3d` | 0.76×0.83×0.41 | {3,3} | 4×4 | 40 кг |

Заметки, которые иначе теряются:

- `ZP_Eco_Proc_Electro` (`radar_rack.p3d`, одиночная стойка) — **не путать с `ZP_ServerRack`**:
  тот стоит на `radar_rack_quad.p3d`, счетверённом блоке.
- `Various\Drill.p3d` — из кандидатов брифа единственный с урезанным набором LOD-ов
  (Geometry есть, **ViewGeometry и FireGeometry отсутствуют** — пули и лучи ИИ пройдут
  насквозь). Для временной модели терпимо; полный набор есть у `radar_rack.p3d`.
- Отвергнуты по габаритам: `Various\Workbench.p3d` (высота bbox 4.87 м — стойка во всю
  стену), `Various\soustruh_proxy.p3d` (3.9 м, к тому же без FireGeometry), настольная
  лабораторная мелочь `lab_triplebeam`/`lab_bunsen`/`lab_vial`/`lab_beaker`/
  `lab_erlenmeyer_flask` (0.16–0.62 м — «станция» выглядела бы оброненным предметом; вместо
  настольных весов взяты магазинные `generalstore\scale.p3d`, 0.41×0.97×0.80, напольные).
- Общее для всех двенадцати (`physLayer=item_large`, `carveNavmesh`, `spawnDamageRange`,
  слоты инструментов, неломкость) приходит из конфиг-родителя `ZP_StaticDevice_Base` —
  в самих классах только то, чем они различаются.
- **У каждого конфиг-класса ОБЯЗАН быть скрипт-класс** (`ZP_Devices.c`, пустой
  `: ZP_Device_StaticBase`): движок ищет скрипт-класс, поднимаясь по КОНФИГ-иерархии, а у
  `ZP_StaticDevice_Base` скрипт-двойника нет. Забыть его = тихий отказ: ошибки не будет,
  прибор просто перестанет быть станцией. Кандидат на страховку в W6/W7.
- Постановка на местности: движок статик на поверхность **НЕ опускает** (`ECE_PLACE_ON_SURFACE`
  не меняет Y ни при спавне, ни через 15 с — зонд 2026-08-09), поэтому в `StaticDevices.json`
  высота записана как `поверхность + |Ymin| модели`; у пяти моделей origin внутри модели, и
  без поправки они ушли бы в землю на 9…62 см.

### Модели предметов цепочки (образцы и заготовки)

Те же правила и тот же метод проверки; дубли моделей внутри группы — намеренные (решение
владельца: реально различимых видов нужно 4–8, а не 30/90).

| Классы | Модель | Донор (ванильный класс, PBO) | Примечание |
|---|---|---|---|
| `ZP_Sample_01..05` | `\dz\gear\medical\InjectionVial.p3d` | `InjectionVial`, gear_medical | запаянный флакон |
| `ZP_Sample_06..10` | `\dz\gear\medical\BloodTest_Kit.p3d` | `BloodTestKit` | набор анализа крови |
| `ZP_Sample_11..15` | `\dz\gear\medical\syringe_empty.p3d` | `Syringe` | шприц |
| `ZP_Sample_16..20` | `\dz\gear\medical\syringe_Full.p3d` | `ClearSyringe`/`BloodSyringe` | наполненный шприц |
| `ZP_Sample_21..25` | `\dz\gear\medical\IodineTincture.p3d` | `IodineTincture` | флакон реагента |
| `ZP_Sample_26..30` | `\dz\gear\medical\VitaminBottle.p3d` | `VitaminBottle` | баночка |
| `ZP_Data_01..30` | `\dz\gear\medical\BloodBag_Full.p3d` | `BloodBagFull` | биоданные; itemSize донора {2,2} — ровно наш |
| `ZP_Data_31..60` | `\DZ\gear\consumables\GasMask_filter.p3d` | `GasMask_Filter` | аномальные данные; сохранён слот перекраски `camoGround` |
| `ZP_Data_61..90` | `\dz\gear\tools\electronicCase.p3d` | `ElectronicRepairKit` | технические данные |

- **`electronicCase.p3d` натурально 2×3, а `itemSize` заготовки — 2×2**: модель
  отрисуется в слот 2×2 масштабированием. Принято с прецедентом: `ZP_Sample_Base` ({1,1})
  использует доноров `syringe_empty.p3d`/`VitaminBottle.p3d`, чьи ванильные классы {1,2} —
  это отгружено ещё в W2.5. Менять `itemSize` заготовки нельзя (2×2 — контракт
  `ZP_Data_Base`), а альтернативы с натуральным 2×2 на «электронику» в ваниле нет
  (ближайшая `\dz\gear\optics\Rangefinder.p3d`, 2×1, но силуэт «кейс с электроникой»
  читается лучше).
- `Chemlight` отвергнут как «аномальная» модель, хотя он самый сталкерский: цвет там
  делается `hiddenSelectionsMaterials`, а в самой модели селекшн `camo` без своей текстуры —
  пришлось бы тащить чужую цветовую схему или рисковать белой моделью.

## 5. Модпак-референсы (опциональный PBO `ZP_Research_NH`)

NH-консоли (`Land_mtl_pult1`, `Land_prop_pult4`), стойки приборов (`Land_prop_pribori_02/03`),
весы (`Land_mtl_vesa`) и лаб-интерьеры сильнее ванилы по атмосфере, но жёстко привязывают мод к
@STALKER NewHorizon Objects (лицензия не заявлена, портированные GSC-ассеты). Решение: ядро
ZP_Research — только ваниль; NH-варианты — потом, отдельным опциональным PBO с
`requiredAddons[] = {"NH_ChernobylZoneFurniture"}`, только наследование/model=-референс, без
копирования файлов. Прецедент twin-паттерна в модпаке: `Land_Y_CookingPot` + `Y_CookingPotItem`
(GSC JMC) — шаблон для будущих пар статик/портатив на одной модели.
