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
            "DZ_Gear_Containers",        // RefrigeratorMinsk / ScientificBriefcase / Protector_Case
            "DZ_Gear_Camping",           // Refridgerator (карго 5x8 + EnergyManager)
            "DZ_Structures_Furniture",   // lab_*, radar_rack_quad, kitchen fridge
            "DZ_Radio"                   // Base_radio_station_g (науковий термінал)
        };
    };
};

class CfgMods
{
    class ZP_Research
    {
        dir = "ZP_Research";
        name = "ZP Research";
        author = "Zone Protocol";
        version = "0.1.0";
        type = "mod";
        storageVersion = 7;    // v5 (M8): незабраний результат (перелік предметів і балів).
                               // v6 (M8, крок 5): + вміст незакладених ЗРАЗКІВ.
                               // v7 (M8, крок 5): + заморожена чистота циклу й чистота
                               // незакладених зразків. Кожен раз ДОПИСУЄМО в кінець потоку
                               // й читаємо за ctx.GetVersion() — записи CF позиційні, тож
                               // будь-яка інша зміна зсунула б і з'їла чужі дані.
        dependencies[] = {"Game", "World", "Mission"};
        defines[] = {"ZP_RESEARCH"};

        class defs
        {
            class gameScriptModule    { value = ""; files[] = {"ZP_Research/scripts/3_Game"}; };
            class worldScriptModule   { value = ""; files[] = {"ZP_Research/scripts/4_World"}; };
            class missionScriptModule { value = ""; files[] = {"ZP_Research/scripts/5_Mission"}; };
        };
    };
};

// Слоти під ІНСТРУМЕНТИ приладів. Три на прилад — із запасом: правило гейтиться переліком
// потрібних інструментів, тож комбінацій має вистачати без оновлення мода.
// Канон взаємодії: CfgSlots оголошує слот, прилад перелічує його в attachments[],
// сам інструмент оголошує inventorySlot[]. Пастка T148506 нас не зачіпає — інструменти
// наші власні класи, а не ванільні предмети з inventorySlot РЯДКОМ.
class CfgSlots
{
    class Slot_ZP_Tool1
    {
        name = "ZP_Tool1";
        displayName = "$STR_zp_slot_tool";
        ghostIcon = "missing";
    };
    class Slot_ZP_Tool2
    {
        name = "ZP_Tool2";
        displayName = "$STR_zp_slot_tool";
        ghostIcon = "missing";
    };
    class Slot_ZP_Tool3
    {
        name = "ZP_Tool3";
        displayName = "$STR_zp_slot_tool";
        ghostIcon = "missing";
    };
};

class CfgVehicles
{
    class Inventory_Base;
    class Container_Base;
    class Refridgerator;            // ваніль gear_camping (орфографія Bohemia через «d»): карго 5x8 + EnergyManager
    class ScientificBriefcase;      // ваніль Frostline, gear_containers

    // ---- СПІЛЬНА БАЗА СТАЦІОНАРНИХ ПРИЛАДІВ ----
    // Канон Bohemia для «ItemBase на будівельній моделі» — PowerGeneratorStatic
    // (structures_sakhal config.cpp:3543): physLayer=item_large + carveNavmesh + GlobalArmor damage=0.
    // physLayer КРИТИЧНИЙ: перешкодою рушій вважає ЛИШЕ item_large — дефолтний item_small
    // навмисне прохідний (FireplaceBase.c:2503, Environment.c:406).

    // ---- ІНСТРУМЕНТИ ПРИЛАДІВ ----
    // НЕ витрачаються: стоять у слоті й відкривають правила, що їх вимагають
    // (ZP_Rule.RequiredTools). Три різні моделі — щоб їх було видно в слотах.
    //
    // МОДЕЛІ ЗВІРЕНО ПО ТАБЛИЦЯХ ФАЙЛІВ ІГРОВИХ PBO. Спершу тут стояв
    // \dz\gear	ools\Toolbox.p3d — такого шляху в грі НЕМА ЖОДНОГО, і предмет без
    // моделі, узятий у руки, ронив КЛІЄНТ (ACCESS_VIOLATION, у скриптовому логу лише
    // ванільний шум). Перевірка одним рядком:
    //   grep -ail "<ім'я>" *.pbo   у теці DayZ\Addons
    // (контроль методу: Protector_Case знаходиться, Toolbox — ні).
    class ZP_Tool_Base : Inventory_Base
    {
        scope = 0;
        weight = 800;
        itemSize[] = {2, 2};
        spawnDamageRange[] = {0, 0};
        inventorySlot[] = {"ZP_Tool1", "ZP_Tool2", "ZP_Tool3"};
    };
    class ZP_Tool_Optics : ZP_Tool_Base
    {
        scope = 2;
        displayName = "$STR_zp_tool_optics";
        descriptionShort = "$STR_zp_tool_optics_desc";
        model = "\DZ\gear\tools\RemoteDetonator_Receiver.p3d";
    };
    class ZP_Tool_Centrifuge : ZP_Tool_Base
    {
        scope = 2;
        displayName = "$STR_zp_tool_centrifuge";
        descriptionShort = "$STR_zp_tool_centrifuge_desc";
        model = "\DZ\gear\consumables\Chemlight.p3d";
    };
    class ZP_Tool_Reagents : ZP_Tool_Base
    {
        scope = 2;
        displayName = "$STR_zp_tool_reagents";
        descriptionShort = "$STR_zp_tool_reagents_desc";
        model = "\DZ\gear\containers\Protector_Case.p3d";
    };

    // ---- ЗРАЗОК: проміжний предмет ланцюжка (скрипт-клас ZP_Sample) ----
    //
    // ОДИН клас на всі види вмісту: усі зразки однакові на вигляд, різницю несуть приховані
    // поля Content + Purity на самій сутності. Читає їх ПРИЛАД, а не гравець, тож ані
    // видимої назви вмісту, ані дії «визначити» тут немає й не буде.
    //
    // ЖОДНИХ quantity-ключів (varQuantityMax / canBeSplit / varStackMax) — і це не економія
    // рядків, а вимога: рушій зливає стек одного класу, не дивлячись на скриптові поля, тож
    // два зразки різного вмісту злиплися б в один і вміст другого зник би мовчки.
    // Модель — ванільний запаяний флакон (шлях звірено по таблиці файлів gear_medical.pbo).
    class ZP_Sample : Inventory_Base
    {
        scope = 2;
        displayName = "$STR_zp_sample";
        descriptionShort = "$STR_zp_sample_desc";
        model = "\dz\gear\medical\InjectionVial.p3d";
        itemSize[] = {1, 1};
        weight = 60;
        soundImpactType = "plastic";
        spawnDamageRange[] = {0, 0};
        rotationFlags = 1;
    };

    // ---- ЗАГОТОВКИ РЕЗУЛЬТАТУ: ZP_Data_01 .. ZP_Data_90 (скрипт-клас ZP_Data_Base) ----
    //
    // Результат дослідження — ЗВИЧАЙНИЙ клас, по одному на вид даних: назва прямо каже, що
    // це, тому ані прихованих полів, ані визначення на комп'ютері не потрібно. Назва, опис
    // і бали при здачі беруться з DataItems.json і міняються на льоту; клас несе лише
    // модель і розмір.
    //
    // Дев'яносто — із запасом: нові види з'являються лише з новою збіркою мода, тож краще
    // мати вільні номери, ніж випускати збірку заради одного рядка. Імена НЕЙТРАЛЬНІ й
    // наскрізні: усе, чим заготовки різняться, живе в конфігу, а ім'я класу нічого не
    // обіцяє й тому не може збрехати.
    //
    // Скриптовий клас один на всі 90: рушій шукає його, піднімаючись конфіг-ієрархією
    // (ZP_Data_07 -> ZP_Data_Base). Правило переробки може так само назвати ZP_Data_Base і
    // збігтися з усіма дев'яноста (MatchClass -> IsKindOf), а «ZP_Data_07|1» — рівно з одним.
    //
    // hiddenSelections оголошено НАВМИСНО, хоч перефарбування зараз і не використовується:
    // без нього процедурний колір мовчки нічого не робить. Знадобиться колір — його місце
    // в конфігу заготовки, а фарбувати клас у config.cpp не можна: він переживе будь-яке
    // переозначення й почне брехати.
    class ZP_Data_Base : Inventory_Base
    {
        scope = 0;
        displayName = "$STR_zp_data_unknown";
        descriptionShort = "$STR_zp_data_unknown_desc";
        model = "\DZ\gear\books\Book_kniga.p3d";
        itemSize[] = {2, 2};
        weight = 300;
        spawnDamageRange[] = {0, 0};
        rotationFlags = 1;
        hiddenSelections[] = {"camoGround"};
        hiddenSelectionsTextures[] = {"dz\gear\books\data\book_kniga_co.paa"};
    };
    // <<< ZP_DATA_GENERATED: блок нижче створює build\gen-data-classes.ps1 — руками не правити
    class ZP_Data_01 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_01"; descriptionShort = "$STR_zp_data_01_desc"; };
    class ZP_Data_02 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_02"; descriptionShort = "$STR_zp_data_02_desc"; };
    class ZP_Data_03 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_03"; descriptionShort = "$STR_zp_data_03_desc"; };
    class ZP_Data_04 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_04"; descriptionShort = "$STR_zp_data_04_desc"; };
    class ZP_Data_05 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_05"; descriptionShort = "$STR_zp_data_05_desc"; };
    class ZP_Data_06 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_06"; descriptionShort = "$STR_zp_data_06_desc"; };
    class ZP_Data_07 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_07"; descriptionShort = "$STR_zp_data_07_desc"; };
    class ZP_Data_08 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_08"; descriptionShort = "$STR_zp_data_08_desc"; };
    class ZP_Data_09 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_09"; descriptionShort = "$STR_zp_data_09_desc"; };
    class ZP_Data_10 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_10"; descriptionShort = "$STR_zp_data_10_desc"; };
    class ZP_Data_11 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_11"; descriptionShort = "$STR_zp_data_11_desc"; };
    class ZP_Data_12 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_12"; descriptionShort = "$STR_zp_data_12_desc"; };
    class ZP_Data_13 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_13"; descriptionShort = "$STR_zp_data_13_desc"; };
    class ZP_Data_14 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_14"; descriptionShort = "$STR_zp_data_14_desc"; };
    class ZP_Data_15 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_15"; descriptionShort = "$STR_zp_data_15_desc"; };
    class ZP_Data_16 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_16"; descriptionShort = "$STR_zp_data_16_desc"; };
    class ZP_Data_17 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_17"; descriptionShort = "$STR_zp_data_17_desc"; };
    class ZP_Data_18 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_18"; descriptionShort = "$STR_zp_data_18_desc"; };
    class ZP_Data_19 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_19"; descriptionShort = "$STR_zp_data_19_desc"; };
    class ZP_Data_20 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_20"; descriptionShort = "$STR_zp_data_20_desc"; };
    class ZP_Data_21 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_21"; descriptionShort = "$STR_zp_data_21_desc"; };
    class ZP_Data_22 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_22"; descriptionShort = "$STR_zp_data_22_desc"; };
    class ZP_Data_23 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_23"; descriptionShort = "$STR_zp_data_23_desc"; };
    class ZP_Data_24 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_24"; descriptionShort = "$STR_zp_data_24_desc"; };
    class ZP_Data_25 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_25"; descriptionShort = "$STR_zp_data_25_desc"; };
    class ZP_Data_26 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_26"; descriptionShort = "$STR_zp_data_26_desc"; };
    class ZP_Data_27 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_27"; descriptionShort = "$STR_zp_data_27_desc"; };
    class ZP_Data_28 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_28"; descriptionShort = "$STR_zp_data_28_desc"; };
    class ZP_Data_29 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_29"; descriptionShort = "$STR_zp_data_29_desc"; };
    class ZP_Data_30 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_30"; descriptionShort = "$STR_zp_data_30_desc"; };
    class ZP_Data_31 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_31"; descriptionShort = "$STR_zp_data_31_desc"; };
    class ZP_Data_32 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_32"; descriptionShort = "$STR_zp_data_32_desc"; };
    class ZP_Data_33 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_33"; descriptionShort = "$STR_zp_data_33_desc"; };
    class ZP_Data_34 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_34"; descriptionShort = "$STR_zp_data_34_desc"; };
    class ZP_Data_35 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_35"; descriptionShort = "$STR_zp_data_35_desc"; };
    class ZP_Data_36 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_36"; descriptionShort = "$STR_zp_data_36_desc"; };
    class ZP_Data_37 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_37"; descriptionShort = "$STR_zp_data_37_desc"; };
    class ZP_Data_38 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_38"; descriptionShort = "$STR_zp_data_38_desc"; };
    class ZP_Data_39 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_39"; descriptionShort = "$STR_zp_data_39_desc"; };
    class ZP_Data_40 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_40"; descriptionShort = "$STR_zp_data_40_desc"; };
    class ZP_Data_41 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_41"; descriptionShort = "$STR_zp_data_41_desc"; };
    class ZP_Data_42 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_42"; descriptionShort = "$STR_zp_data_42_desc"; };
    class ZP_Data_43 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_43"; descriptionShort = "$STR_zp_data_43_desc"; };
    class ZP_Data_44 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_44"; descriptionShort = "$STR_zp_data_44_desc"; };
    class ZP_Data_45 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_45"; descriptionShort = "$STR_zp_data_45_desc"; };
    class ZP_Data_46 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_46"; descriptionShort = "$STR_zp_data_46_desc"; };
    class ZP_Data_47 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_47"; descriptionShort = "$STR_zp_data_47_desc"; };
    class ZP_Data_48 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_48"; descriptionShort = "$STR_zp_data_48_desc"; };
    class ZP_Data_49 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_49"; descriptionShort = "$STR_zp_data_49_desc"; };
    class ZP_Data_50 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_50"; descriptionShort = "$STR_zp_data_50_desc"; };
    class ZP_Data_51 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_51"; descriptionShort = "$STR_zp_data_51_desc"; };
    class ZP_Data_52 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_52"; descriptionShort = "$STR_zp_data_52_desc"; };
    class ZP_Data_53 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_53"; descriptionShort = "$STR_zp_data_53_desc"; };
    class ZP_Data_54 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_54"; descriptionShort = "$STR_zp_data_54_desc"; };
    class ZP_Data_55 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_55"; descriptionShort = "$STR_zp_data_55_desc"; };
    class ZP_Data_56 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_56"; descriptionShort = "$STR_zp_data_56_desc"; };
    class ZP_Data_57 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_57"; descriptionShort = "$STR_zp_data_57_desc"; };
    class ZP_Data_58 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_58"; descriptionShort = "$STR_zp_data_58_desc"; };
    class ZP_Data_59 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_59"; descriptionShort = "$STR_zp_data_59_desc"; };
    class ZP_Data_60 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_60"; descriptionShort = "$STR_zp_data_60_desc"; };
    class ZP_Data_61 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_61"; descriptionShort = "$STR_zp_data_61_desc"; };
    class ZP_Data_62 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_62"; descriptionShort = "$STR_zp_data_62_desc"; };
    class ZP_Data_63 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_63"; descriptionShort = "$STR_zp_data_63_desc"; };
    class ZP_Data_64 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_64"; descriptionShort = "$STR_zp_data_64_desc"; };
    class ZP_Data_65 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_65"; descriptionShort = "$STR_zp_data_65_desc"; };
    class ZP_Data_66 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_66"; descriptionShort = "$STR_zp_data_66_desc"; };
    class ZP_Data_67 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_67"; descriptionShort = "$STR_zp_data_67_desc"; };
    class ZP_Data_68 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_68"; descriptionShort = "$STR_zp_data_68_desc"; };
    class ZP_Data_69 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_69"; descriptionShort = "$STR_zp_data_69_desc"; };
    class ZP_Data_70 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_70"; descriptionShort = "$STR_zp_data_70_desc"; };
    class ZP_Data_71 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_71"; descriptionShort = "$STR_zp_data_71_desc"; };
    class ZP_Data_72 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_72"; descriptionShort = "$STR_zp_data_72_desc"; };
    class ZP_Data_73 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_73"; descriptionShort = "$STR_zp_data_73_desc"; };
    class ZP_Data_74 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_74"; descriptionShort = "$STR_zp_data_74_desc"; };
    class ZP_Data_75 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_75"; descriptionShort = "$STR_zp_data_75_desc"; };
    class ZP_Data_76 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_76"; descriptionShort = "$STR_zp_data_76_desc"; };
    class ZP_Data_77 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_77"; descriptionShort = "$STR_zp_data_77_desc"; };
    class ZP_Data_78 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_78"; descriptionShort = "$STR_zp_data_78_desc"; };
    class ZP_Data_79 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_79"; descriptionShort = "$STR_zp_data_79_desc"; };
    class ZP_Data_80 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_80"; descriptionShort = "$STR_zp_data_80_desc"; };
    class ZP_Data_81 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_81"; descriptionShort = "$STR_zp_data_81_desc"; };
    class ZP_Data_82 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_82"; descriptionShort = "$STR_zp_data_82_desc"; };
    class ZP_Data_83 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_83"; descriptionShort = "$STR_zp_data_83_desc"; };
    class ZP_Data_84 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_84"; descriptionShort = "$STR_zp_data_84_desc"; };
    class ZP_Data_85 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_85"; descriptionShort = "$STR_zp_data_85_desc"; };
    class ZP_Data_86 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_86"; descriptionShort = "$STR_zp_data_86_desc"; };
    class ZP_Data_87 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_87"; descriptionShort = "$STR_zp_data_87_desc"; };
    class ZP_Data_88 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_88"; descriptionShort = "$STR_zp_data_88_desc"; };
    class ZP_Data_89 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_89"; descriptionShort = "$STR_zp_data_89_desc"; };
    class ZP_Data_90 : ZP_Data_Base { scope = 2; displayName = "$STR_zp_data_90"; descriptionShort = "$STR_zp_data_90_desc"; };
    // >>> ZP_DATA_GENERATED

    class ZP_StaticDevice_Base : Inventory_Base
    {
        scope = 0;
        physLayer = "item_large";
        // карго й слоти вкладень уживаються на одному класі (канон: одяг має і те, і те)
        attachments[] = {"ZP_Tool1", "ZP_Tool2", "ZP_Tool3"};
        class GUIInventoryAttachmentsProps
        {
            class Tools
            {
                name = "$STR_zp_slot_tool";
                description = "";
                attachmentSlots[] = {"ZP_Tool1", "ZP_Tool2", "ZP_Tool3"};
                icon = "missing";
            };
        };
        carveNavmesh = 1;              // зомбі/ШІ обходять прилад
        heavyItem = 1;
        itemBehaviour = 0;
        rotationFlags = 2;
        slopeTolerance = 0.4;
        overrideDrawArea = "8.0";      // великі предмети інакше зникають зблизька (як Fireplace)
        forceFarBubble = "true";
        canBeDigged = 0;
        spawnDamageRange[] = {0, 0};   // копії з CE не спавняться побитими
        class DamageSystem
        {
            // прилад не руйнується: зомбі/куля/вибух не мають його ламати (канон PowerGeneratorStatic)
            class GlobalArmor
            {
                class Projectile  { class Health { damage = 0; }; class Blood { damage = 0; }; class Shock { damage = 0; }; };
                class Melee       { class Health { damage = 0; }; class Blood { damage = 0; }; class Shock { damage = 0; }; };
                class FragGrenade { class Health { damage = 0; }; class Blood { damage = 0; }; class Shock { damage = 0; }; };
            };
        };
    };

    // ---- ПЕРЕНОСНІ ----

    // Польовий набір для відбору проб. Модель — герметичний кейс (Protector_Case):
    // у lab_petri_dish.p3d НЕМАЄ Geometry LOD (колізія неможлива в принципі) і це
    // напівпрозоре скло 10 см — у світі читалось як осколок.
    // КАРГО Й СЛОТИ ОБОВ'ЯЗКОВІ. Відколи переробки «в руках» немає, станція без карго не
    // може взяти сировину взагалі — клас був би мертвим, а внутрішньоігровий редактор саме
    // його підставляє в шаблон нового правила. Карго менше, ніж у стаціонарних: це польовий
    // набір, і носити в ньому цілу партію не має бути так само зручно.
    class ZP_PetriDishKit : Inventory_Base
    {
        scope = 2;
        displayName = "$STR_zp_petridishkit";
        descriptionShort = "$STR_zp_petridishkit_desc";
        model = "\dz\gear\containers\Protector_Case.p3d";
        weight = 1200;
        itemSize[] = {3, 4};
        itemsCargoSize[] = {3, 2};
        spawnDamageRange[] = {0, 0};
        rotatable = 1;
        attachments[] = {"ZP_Tool1", "ZP_Tool2", "ZP_Tool3"};
        class GUIInventoryAttachmentsProps
        {
            class Tools
            {
                name = "$STR_zp_slot_tool";
                description = "";
                attachmentSlots[] = {"ZP_Tool1", "ZP_Tool2", "ZP_Tool3"};
                icon = "missing";
            };
        };
    };

    // Польовий науковий кейс — переносний набір / транспорт зразків T1
    class ZP_FieldCase : ScientificBriefcase
    {
        scope = 2;
        displayName = "$STR_zp_fieldcase";
        descriptionShort = "$STR_zp_fieldcase_desc";
        weight = 4000;
        spawnDamageRange[] = {0, 0};
    };

    // ---- СТАЦІОНАРНІ (скрипт-клас ZP_Device_StaticBase) ----

    // Мікроскоп — станція аналізу T2
    class ZP_Microscope : ZP_StaticDevice_Base
    {
        scope = 2;
        displayName = "$STR_zp_microscope";
        descriptionShort = "$STR_zp_microscope_desc";
        model = "\DZ\structures\furniture\School_equipment\lab_microscope.p3d";
        weight = 12000;
        itemSize[] = {3, 3};
        itemsCargoSize[] = {4, 4};
        rotatable = 1;
    };

    // Науковий термінал — головний прилад дерева досліджень.
    // Історія вибору моделі (перевірено розбором самих p3d, білд 124708):
    //   PC.p3d — в атласі pc_co.paa є ДВА екрани, цілий і розбитий вщент, плюс іржа;
    //     який саме бере модель, вирішує UV, а hiddenSelections немає — не перетекстуриш;
    //   patient_monitor — медична стійка на коліщатках, не той вигляд;
    //   Base_radio_station_g — предметна модель рації, читалась як польова, не стаціонарна.
    // radar_panel — підлогова консоль радарної станції: суцільнометалевий корпус,
    // шкали, тумблери й ЦІЛИЙ круглий екран (radar_console_co.paa), жодних пошкоджень.
    // Має component01..03 у Geometry LOD, тож фізична колізія працює.
    class ZP_LabComputer : ZP_StaticDevice_Base
    {
        scope = 2;
        displayName = "$STR_zp_labcomputer";
        descriptionShort = "$STR_zp_labcomputer_desc";
        model = "\DZ\structures\furniture\radar_equipment\radar_panel.p3d";
        weight = 70000;
        itemSize[] = {8, 6};
        itemsCargoSize[] = {4, 4};
        rotatable = 1;
    };

    // Хімічний стенд — лабораторний стіл із мийкою (2.55 x 1.17 x 0.84 м)
    class ZP_ChemBench : ZP_StaticDevice_Base
    {
        scope = 2;
        displayName = "$STR_zp_chembench";
        descriptionShort = "$STR_zp_chembench_desc";
        model = "\DZ\structures\furniture\School_equipment\lab_teacher_bench.p3d";
        weight = 80000;
        itemSize[] = {10, 5};
        itemsCargoSize[] = {6, 4};
        rotatable = 1;
    };

    // Серверна стійка (3.18 x 1.99 м) — сховище даних досліджень
    class ZP_ServerRack : ZP_StaticDevice_Base
    {
        scope = 2;
        displayName = "$STR_zp_serverrack";
        descriptionShort = "$STR_zp_serverrack_desc";
        model = "\DZ\structures\furniture\radar_equipment\radar_rack_quad.p3d";
        weight = 120000;
        itemSize[] = {10, 10};
        itemsCargoSize[] = {6, 6};
        rotatable = 1;
    };

    // Холодильник зразків. Батько ЗМІНЕНО з RefrigeratorMinsk на Refridgerator:
    // карго 5x8=40 замість 2x5=10 і вбудований EnergyManager (стане в пригоді для M5b).
    // Модель — кухонний холодильник на 25 % вищий за «Мінськ» (1.40 м проти 1.12 м).
    class ZP_SampleFridge : Refridgerator
    {
        scope = 2;
        displayName = "$STR_zp_samplefridge";
        descriptionShort = "$STR_zp_samplefridge_desc";
        model = "\DZ\structures\furniture\kitchen\fridge\fridge.p3d";
        weight = 90000;
        // СЛОТИ ПІД ІНСТРУМЕНТИ/МОДУЛІ. Оголошено ОКРЕМО, бо цей клас успадкований від
        // ванільного Refridgerator, а не від ZP_StaticDevice_Base, де ці рядки вже є.
        // Пастка T148506 тут не діє: ванільний Refridgerator не оголошує attachments[]
        // взагалі (перевірено розпакуванням gear_camping.pbo), тож нічого не губиться.
        attachments[] = {"ZP_Tool1", "ZP_Tool2", "ZP_Tool3"};
        class GUIInventoryAttachmentsProps
        {
            class Tools
            {
                name = "$STR_zp_slot_tool";
                description = "";
                attachmentSlots[] = {"ZP_Tool1", "ZP_Tool2", "ZP_Tool3"};
                icon = "missing";
            };
        };
        physLayer = "item_large";
        carveNavmesh = 1;
        heavyItem = 1;
        overrideDrawArea = "8.0";
        forceFarBubble = "true";
        canBeDigged = 0;
        spawnDamageRange[] = {0, 0};
        class DamageSystem
        {
            class GlobalArmor
            {
                class Projectile  { class Health { damage = 0; }; class Blood { damage = 0; }; class Shock { damage = 0; }; };
                class Melee       { class Health { damage = 0; }; class Blood { damage = 0; }; class Shock { damage = 0; }; };
                class FragGrenade { class Health { damage = 0; }; class Blood { damage = 0; }; class Shock { damage = 0; }; };
            };
        };
    };
};
