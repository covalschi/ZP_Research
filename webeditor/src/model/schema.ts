// Декларативна схема восьми конфігів ZP_Research. Порядок полів у кожній ObjectSchema —
// ТОЧНА копія порядку оголошення в Enforce-класах
// (ZP_Research/scripts/3_Game/ZP_Research/*.c) — саме на ньому тримається байт-точна
// серіалізація (Task 4) і повідомлення терпимого парсера (Task 5). Дефолти — з
// ініціалізаторів тих самих класів; поле без явного ініціалізатора отримує дефолт свого
// типу (int/float -> 0, bool -> false, string -> '', масив -> []).
//
// Джерела (прочитано, не вгадано):
//   ZP_SettingsConfig.c, ZP_PointTypesConfig.c + ZP_Types.c (ZP_PointType),
//   ZP_ProcessingConfig.c (ZP_RulesFile/ZP_Rule/ZP_RuleInput/ZP_RuleOutput/
//   ZP_RuleConsumable), ZP_TechTree.c (ZP_TechTreeFile/ZP_TreeBranchInfo/ZP_TreeNode/
//   ZP_TreeCost/ZP_TreeItemCost), ZP_FactionsConfig.c (ZP_FactionDef),
//   ZP_DataItemsConfig.c (ZP_DataDef + ZP_DataReward), ZP_ModulesConfig.c (ZP_ModuleDef),
//   ZP_SampleTypesConfig.c (ZP_SampleTypeDef; W2.5 Task 3 — дзеркало ZP_DataItemsConfig
//   БЕЗ Points, звірено з .c дослівно, не з плану).

import { i, f, b, s, sarr, obj, oarr } from './types'
import type { ObjectSchema, ConfigKind } from './types'

export type { ObjectSchema, FieldDef, FieldType, ConfigKind } from './types'

// ---- ZP_SettingsConfig.c --------------------------------------------------------------

export const SETTINGS_SCHEMA: ObjectSchema = {
  name: 'ZP_SettingsConfig',
  fields: [
    i('ConfigVersion', 1),
    b('DebugMode', true),
    sarr('AdminIds'),
    s('DefaultFaction', 'default'),
    sarr('TreeTerminalClasses'),
    i('TreeVisibilityDepth', 1),
    s('TreeBackgroundImage'),
  ],
}

// ---- ZP_PointTypesConfig.c + ZP_Types.c (ZP_PointType) --------------------------------

// ZP_Types.c: `int Tier;` без ініціалізатора -> 0. НЕ плутати з ZP_TreeNode.Tier (=1) —
// однойменні поля різних класів з різними дефолтами.
const POINT_TYPE_SCHEMA: ObjectSchema = {
  name: 'ZP_PointType',
  fields: [s('Id'), s('Name'), s('Icon'), s('Color'), i('SortOrder'), s('Category'), s('Kind'), i('Tier')],
}

const POINT_DIMENSION_SCHEMA: ObjectSchema = {
  name: 'ZP_PointDimension',
  fields: [s('Id'), s('Name'), i('SortOrder')],
}

export const POINT_TYPES_SCHEMA: ObjectSchema = {
  name: 'ZP_PointTypesConfig',
  fields: [
    i('ConfigVersion', 1),
    oarr('PointTypes', POINT_TYPE_SCHEMA),
    oarr('Categories', POINT_DIMENSION_SCHEMA),
    oarr('Kinds', POINT_DIMENSION_SCHEMA),
  ],
}

// ---- ZP_ProcessingConfig.c -------------------------------------------------------------

const RULE_INPUT_SCHEMA: ObjectSchema = {
  name: 'ZP_RuleInput',
  fields: [s('Classname'), i('Quantity', 1), b('ConsumeInput', true), s('Content')],
}

const RULE_OUTPUT_SCHEMA: ObjectSchema = {
  name: 'ZP_RuleOutput',
  fields: [s('Classname'), i('Quantity', 1), f('Chance', 1.0), s('Content')],
}

const RULE_CONSUMABLE_SCHEMA: ObjectSchema = {
  name: 'ZP_RuleConsumable',
  fields: [s('Classname'), i('Quantity', 1), s('Content')],
}

const RULE_SCHEMA: ObjectSchema = {
  name: 'ZP_Rule',
  fields: [
    s('Id'),
    b('Enabled', true),
    s('Device'),
    s('Mode', 'background'),
    obj('InputItem', RULE_INPUT_SCHEMA),
    f('BasePurityMin', 0.5),
    f('BasePurityMax', 0.5),
    f('TimeSec', 10),
    oarr('Consumables', RULE_CONSUMABLE_SCHEMA),
    oarr('Outputs', RULE_OUTPUT_SCHEMA),
    s('RequiredNode'),
    sarr('RequiredFactions'),
    sarr('RequiredWorn'),
    sarr('RequiredTools'),
    s('Notes'),
  ],
}

export const RULES_FILE_SCHEMA: ObjectSchema = {
  name: 'ZP_RulesFile',
  fields: [i('ConfigVersion', 1), oarr('Rules', RULE_SCHEMA)],
}

// ---- ZP_TechTree.c ----------------------------------------------------------------------

const TREE_COST_SCHEMA: ObjectSchema = {
  name: 'ZP_TreeCost',
  fields: [s('Type'), i('Amount')],
}

const TREE_ITEM_COST_SCHEMA: ObjectSchema = {
  name: 'ZP_TreeItemCost',
  fields: [s('Classname'), i('Quantity', 1), s('Content')],
}

// Експортовано (W3 Task 3): io/nodeEdit.createTreeNode будує НОВИЙ вузол саме з дефолтів
// Enforce-класу (розрізнення W1: нуль-семантика — для ЧИТАННЯ наявних файлів, дефолти
// Enforce — для СТВОРЕННЯ нових сутностей).
export const TREE_NODE_SCHEMA: ObjectSchema = {
  name: 'ZP_TreeNode',
  fields: [
    s('Id'),
    s('Name'),
    s('Description'),
    s('Icon'),
    i('Tier', 1),
    sarr('Parents'),
    s('ParentsMode', 'all'),
    oarr('Cost', TREE_COST_SCHEMA),
    oarr('ItemCost', TREE_ITEM_COST_SCHEMA),
    i('ResearchTimeSec', 0),
    // ResearchDevice СКАСОВАНО (ZP_TechTree.c:32-34, рішення власника 2026-08-03) —
    // поля навмисно немає. Старі файли з цим ключем ловить STALE_KEYS нижче.
    sarr('RequiredFactions'),
  ],
}

export const TREE_BRANCH_INFO_SCHEMA: ObjectSchema = {
  name: 'ZP_TreeBranchInfo',
  fields: [s('Id'), s('Name'), s('Icon'), i('SortOrder'), sarr('Factions')],
}

export const TECH_TREE_SCHEMA: ObjectSchema = {
  name: 'ZP_TechTreeFile',
  fields: [i('ConfigVersion', 1), obj('Branch', TREE_BRANCH_INFO_SCHEMA), oarr('Nodes', TREE_NODE_SCHEMA)],
}

// ---- ZP_FactionsConfig.c -----------------------------------------------------------------

const FACTION_DEF_SCHEMA: ObjectSchema = {
  name: 'ZP_FactionDef',
  fields: [
    s('Id'),
    s('DisplayName'),
    s('Supertype'),
    sarr('Armbands'),
    sarr('TerminalClasses'),
    sarr('DeviceClasses'),
  ],
}

export const FACTIONS_SCHEMA: ObjectSchema = {
  name: 'ZP_FactionsConfig',
  fields: [i('ConfigVersion', 1), oarr('Factions', FACTION_DEF_SCHEMA)],
}

// ---- ZP_DataItemsConfig.c ------------------------------------------------------------------

// ZP_DataReward (звірено Task 3/Step 1 напряму з ZP_DataItemsConfig.c:15-19):
// `string Type; int Amount = 0;` — саме такий склад і очікувався за аналогією з
// ZP_TreeCost, розбіжностей із брифом немає.
const DATA_REWARD_SCHEMA: ObjectSchema = {
  name: 'ZP_DataReward',
  fields: [s('Type'), i('Amount', 0)],
}

const DATA_DEF_SCHEMA: ObjectSchema = {
  name: 'ZP_DataDef',
  fields: [s('Id'), b('Enabled', true), s('Name'), s('Description'), oarr('Points', DATA_REWARD_SCHEMA)],
}

export const DATA_ITEMS_SCHEMA: ObjectSchema = {
  name: 'ZP_DataItemsConfig',
  fields: [i('ConfigVersion', 1), oarr('Items', DATA_DEF_SCHEMA)],
}

// ---- ZP_ModulesConfig.c ------------------------------------------------------------------

const MODULE_DEF_SCHEMA: ObjectSchema = {
  name: 'ZP_ModuleDef',
  fields: [s('Classname'), f('PurityBonus', 0), sarr('Devices'), s('Notes')],
}

export const MODULES_SCHEMA: ObjectSchema = {
  name: 'ZP_ModulesConfig',
  fields: [i('ConfigVersion', 1), oarr('Modules', MODULE_DEF_SCHEMA)],
}

// ---- ZP_SampleTypesConfig.c (W2.5 Task 3) -------------------------------------------------

// ZP_SampleTypeDef (звірено дослівно з ZP_SampleTypesConfig.c:12-18, task-2-report.md):
// строгий префікс-підмножина ZP_DataDef (Id, Enabled, Name, Description, Points) БЕЗ
// останнього поля — зразок є проміжною ланкою ланцюжка (спека §4a), його не здають
// напряму, тож нагороди (Points) у типу зразка бути не може.
const SAMPLE_TYPE_DEF_SCHEMA: ObjectSchema = {
  name: 'ZP_SampleTypeDef',
  fields: [s('Id'), b('Enabled', true), s('Name'), s('Description')],
}

export const SAMPLE_TYPES_SCHEMA: ObjectSchema = {
  name: 'ZP_SampleTypesConfig',
  fields: [i('ConfigVersion', 1), oarr('Items', SAMPLE_TYPE_DEF_SCHEMA)],
}

// ---- Реєстр ------------------------------------------------------------------------------

export const SCHEMAS: Record<ConfigKind, ObjectSchema> = {
  settings: SETTINGS_SCHEMA,
  pointTypes: POINT_TYPES_SCHEMA,
  rules: RULES_FILE_SCHEMA,
  techTree: TECH_TREE_SCHEMA,
  factions: FACTIONS_SCHEMA,
  dataItems: DATA_ITEMS_SCHEMA,
  modules: MODULES_SCHEMA,
  sampleTypes: SAMPLE_TYPES_SCHEMA,
}

// Відомі застарілі ключі: поле існувало в Enforce-класі раніше, потім було прибрано, а
// старі JSON на диску (в адмінів) досі можуть його містити. Тест повноти схеми не мусить
// вважати такий ключ помилкою — інакше він падав би на кожному реальному сервері, що не
// перезаписав старі файли.
const STALE_KEYS: Partial<Record<ConfigKind, string[]>> = {
  // ZP_TreeNode.ResearchDevice скасовано 2026-08-03 (ZP_TechTree.c:32-34): матеріали
  // тепер беруться з карго власного термінала (ItemCost), а не з "приладу поруч".
  techTree: ['ResearchDevice'],
}

export function isStaleKey(kind: ConfigKind, key: string): boolean {
  const known = STALE_KEYS[kind]
  return !!known && known.includes(key)
}

// Чи існує поле з таким ім'ям БУДЬ-ДЕ в дереві схеми (сама схема + вкладені object/
// object[] схеми). Перевірка навмисно без шляху: файл ходять плоским набором імен ключів
// (collectKeysDeep у tests/schema.test.ts), тому й пошук дзеркальний — ім'я на будь-якій
// глибині цієї схеми.
export function schemaKnowsKey(schema: ObjectSchema, key: string): boolean {
  for (const field of schema.fields) {
    if (field.name === key) return true
    if (field.type.kind === 'object' || field.type.kind === 'object[]') {
      if (schemaKnowsKey(field.type.schema, key)) return true
    }
  }
  return false
}
