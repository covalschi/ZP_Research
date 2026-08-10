// Тест повноти схеми (Task 3, Step 4) + регресія порядку полів/дефолтів (самоперевірка
// "fresh eyes" перед комітом): кожен ключ еталонних файлів (gold/live/stale) або відомий
// схемі, або зареєстрований як застарілий; порядок полів кожної ObjectSchema звірений
// повторно з .c-файлами field-by-field.

import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  SCHEMAS,
  isStaleKey,
  schemaKnowsKey,
  SETTINGS_SCHEMA,
  POINT_TYPES_SCHEMA,
  RULES_FILE_SCHEMA,
  TECH_TREE_SCHEMA,
  FACTIONS_SCHEMA,
  DATA_ITEMS_SCHEMA,
  MODULES_SCHEMA,
  SAMPLE_TYPES_SCHEMA,
} from '../src/model/schema'
import type { ObjectSchema, ConfigKind, FieldType } from '../src/model/schema'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, 'fixtures')

// Десять файлів: gold шість одиночних конфігів (sampleTypes додано W2.5 Task 3) +
// gold/ProcessingRules/demo.json + live/chain.json + live/Settings.json + stale/zone.json.
// gold/StaticDevices.json свідомо не входить — не один із восьми конфігів редактора
// (спавнер статиків).
const FIXTURE_MAP: [ConfigKind, string][] = [
  ['settings', join(FIXTURES, 'gold/Settings.json')],
  ['pointTypes', join(FIXTURES, 'gold/PointTypes.json')],
  ['factions', join(FIXTURES, 'gold/Factions.json')],
  ['dataItems', join(FIXTURES, 'gold/DataItems.json')],
  ['modules', join(FIXTURES, 'gold/Modules.json')],
  ['sampleTypes', join(FIXTURES, 'gold/SampleTypes.json')],
  ['rules', join(FIXTURES, 'gold/ProcessingRules/demo.json')],
  ['rules', join(FIXTURES, 'live/chain.json')],
  ['settings', join(FIXTURES, 'live/Settings.json')],
  ['techTree', join(FIXTURES, 'stale/zone.json')],
]

// Плоский набір усіх імен ключів об'єкта на будь-якій глибині (масиви розгортаються,
// шлях не важливий — schemaKnowsKey шукає ім'я поля будь-де в дереві схеми, дзеркально).
function collectKeysDeep(value: unknown): Set<string> {
  const keys = new Set<string>()
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const item of v) walk(item)
    } else if (v !== null && typeof v === 'object') {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        keys.add(k)
        walk(val)
      }
    }
  }
  walk(value)
  return keys
}

describe('схема покриває всі ключі еталонних файлів', () => {
  for (const [kind, file] of FIXTURE_MAP) {
    test(`${kind}: ${file.slice(FIXTURES.length + 1)}`, () => {
      const raw = JSON.parse(readFileSync(file, 'utf8'))
      for (const key of collectKeysDeep(raw)) {
        expect(
          schemaKnowsKey(SCHEMAS[kind], key) || isStaleKey(kind, key),
          `${kind}: ключ '${key}' (${file}) не описаний у схемі й не зареєстрований як застарілий`,
        ).toBe(true)
      }
    })
  }
})

// ---- Синтетичні зразки для гілок, порожніх у ВСІХ фікстурах -----------------------------
//
// collectKeysDeep не заходить у порожній масив ([] не має записів для обходу), а
// DataItems.json у кожній фікстурі має "Items": [], і жоден фікстурний файл правил не
// містить непорожнього Consumables[]. Через це тест повноти вище НІКОЛИ не бачив полів
// ZP_DataDef/ZP_DataReward (крім верхніх Id/Enabled/Name/Description, які повторюються в
// сусідніх типах і випадково збіглися б навіть при биті ZP_DataReward) і
// ZP_RuleConsumable — помилка в імені поля там пройшла б непоміченою. Те саме стосується
// gold/SampleTypes.json (W2.5 Task 3): це теж "чесно порожній" `{ConfigVersion, Items:[]}`
// свіжого SetDefaults(), тож ZP_SampleTypeDef теж потребує власного синтетичного зразка.
// Синтетичні документи нижче існують ЛИШЕ в пам'яті тесту (жодного нового файлу на диску)
// і навмисно містять по одному запису в кожному з цих масивів.
describe('синтетичні зразки для порожніх у фікстурах вкладених типів', () => {
  test('dataItems: непорожній Items[].Points[] покритий схемою', () => {
    const synthetic = {
      ConfigVersion: 1,
      Items: [
        {
          Id: 'ZP_Data_01',
          Enabled: true,
          Name: 'Тестова заготовка',
          Description: 'опис для перевірки',
          Points: [{ Type: 'bio_field_t1', Amount: 5 }],
        },
      ],
    }
    for (const key of collectKeysDeep(synthetic)) {
      expect(
        schemaKnowsKey(SCHEMAS.dataItems, key) || isStaleKey('dataItems', key),
        `dataItems: синтетичний ключ '${key}' не описаний у схемі`,
      ).toBe(true)
    }
  })

  test('sampleTypes: непорожній Items[] покритий схемою', () => {
    const synthetic = {
      ConfigVersion: 1,
      Items: [
        {
          Id: 'ZP_Sample_01',
          Enabled: true,
          Name: 'Зразок тканини',
          Description: 'опис для перевірки',
        },
      ],
    }
    for (const key of collectKeysDeep(synthetic)) {
      expect(
        schemaKnowsKey(SCHEMAS.sampleTypes, key) || isStaleKey('sampleTypes', key),
        `sampleTypes: синтетичний ключ '${key}' не описаний у схемі`,
      ).toBe(true)
    }
  })

  test('rules: непорожній Rules[].Consumables[] покритий схемою', () => {
    const synthetic = {
      ConfigVersion: 1,
      Rules: [
        {
          Id: 'demo_with_consumable',
          Enabled: true,
          Device: 'ZP_SampleFridge',
          Mode: 'background',
          InputItem: { Classname: 'Apple', Quantity: 1, ConsumeInput: true, Content: '' },
          BasePurityMin: 0.5,
          BasePurityMax: 0.5,
          TimeSec: 10,
          Consumables: [{ Classname: 'Rag', Quantity: 1, Content: '' }],
          Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1.0, Content: 'x' }],
          RequiredNode: '',
          RequiredFactions: [],
          RequiredWorn: [],
          RequiredTools: [],
          Notes: '',
        },
      ],
    }
    for (const key of collectKeysDeep(synthetic)) {
      expect(
        schemaKnowsKey(SCHEMAS.rules, key) || isStaleKey('rules', key),
        `rules: синтетичний ключ '${key}' не описаний у схемі`,
      ).toBe(true)
    }
  })

  test('негативна перевірка: обхідник дійсно спускається у Points[]/Consumables[]', () => {
    // Той самий позитивний зразок вище пройшов би навіть якби schemaKnowsKey ніколи не
    // спускався у вкладені object[]-схеми (false-негативів немає, коли перевірка
    // тривіально true). Довести, що обхід СПРАВДІ доходить до цієї глибини, можна лише
    // навмисно биті ключем і побачивши, що перевірка його ловить.
    const badDataItems = {
      ConfigVersion: 1,
      Items: [
        {
          Id: 'ZP_Data_01',
          Enabled: true,
          Name: 'x',
          Description: '',
          Points: [{ Type: 'bio_field_t1', Amount: 5, Bogus_Extra_Field: 1 }],
        },
      ],
    }
    const badDataKeys = collectKeysDeep(badDataItems)
    expect(badDataKeys.has('Bogus_Extra_Field')).toBe(true) // walker дійшов до Points[]
    expect(schemaKnowsKey(SCHEMAS.dataItems, 'Bogus_Extra_Field')).toBe(false)
    expect(isStaleKey('dataItems', 'Bogus_Extra_Field')).toBe(false)

    const badRules = {
      ConfigVersion: 1,
      Rules: [
        {
          Id: 'demo',
          Consumables: [{ Classname: 'Rag', Quantity: 1, Content: '', Bogus_Consumable_Field: true }],
        },
      ],
    }
    const badRuleKeys = collectKeysDeep(badRules)
    expect(badRuleKeys.has('Bogus_Consumable_Field')).toBe(true) // walker дійшов до Consumables[]
    expect(schemaKnowsKey(SCHEMAS.rules, 'Bogus_Consumable_Field')).toBe(false)
    expect(isStaleKey('rules', 'Bogus_Consumable_Field')).toBe(false)
  })
})

// ---- Регресія порядку полів (звірено з .c повторно, "fresh eyes") ----------------------

function namesOf(schema: ObjectSchema): string[] {
  return schema.fields.map((field) => field.name)
}

function nested(schema: ObjectSchema, fieldName: string): ObjectSchema {
  const field = schema.fields.find((fd) => fd.name === fieldName)
  if (!field) throw new Error(`поле '${fieldName}' не знайдено у схемі '${schema.name}'`)
  const t: FieldType = field.type
  if (t.kind !== 'object' && t.kind !== 'object[]') {
    throw new Error(`поле '${fieldName}' не є object/object[] у схемі '${schema.name}' (kind=${t.kind})`)
  }
  return t.schema
}

function defOf(schema: ObjectSchema, fieldName: string): unknown {
  const field = schema.fields.find((fd) => fd.name === fieldName)
  if (!field) throw new Error(`поле '${fieldName}' не знайдено у схемі '${schema.name}'`)
  return field.def
}

describe('порядок полів = порядок оголошення в Enforce-класах', () => {
  test('ZP_SettingsConfig (ZP_SettingsConfig.c)', () => {
    expect(namesOf(SETTINGS_SCHEMA)).toEqual([
      'ConfigVersion',
      'DebugMode',
      'AdminIds',
      'DefaultFaction',
      'TreeTerminalClasses',
      'TreeVisibilityDepth',
      'TreeBackgroundImage',
    ])
  })

  test('ZP_PointTypesConfig + ZP_PointType + ZP_PointDimension (ZP_PointTypesConfig.c, ZP_Types.c)', () => {
    expect(namesOf(POINT_TYPES_SCHEMA)).toEqual(['ConfigVersion', 'PointTypes', 'Categories', 'Kinds'])
    expect(namesOf(nested(POINT_TYPES_SCHEMA, 'PointTypes'))).toEqual([
      'Id',
      'Name',
      'Icon',
      'Color',
      'SortOrder',
      'Category',
      'Kind',
      'Tier',
    ])
    expect(namesOf(nested(POINT_TYPES_SCHEMA, 'Categories'))).toEqual(['Id', 'Name', 'SortOrder'])
    expect(namesOf(nested(POINT_TYPES_SCHEMA, 'Kinds'))).toEqual(['Id', 'Name', 'SortOrder'])
  })

  test('ZP_RulesFile + ZP_Rule + ZP_RuleInput/Output/Consumable (ZP_ProcessingConfig.c)', () => {
    expect(namesOf(RULES_FILE_SCHEMA)).toEqual(['ConfigVersion', 'Rules'])
    const rule = nested(RULES_FILE_SCHEMA, 'Rules')
    expect(namesOf(rule)).toEqual([
      'Id',
      'Enabled',
      'Device',
      'Mode',
      'InputItem',
      'BasePurityMin',
      'BasePurityMax',
      'TimeSec',
      'Consumables',
      'Outputs',
      'RequiredNode',
      'RequiredFactions',
      'RequiredWorn',
      'RequiredTools',
      'Notes',
    ])
    expect(namesOf(nested(rule, 'InputItem'))).toEqual(['Classname', 'Quantity', 'ConsumeInput', 'Content'])
    expect(namesOf(nested(rule, 'Outputs'))).toEqual(['Classname', 'Quantity', 'Chance', 'Content'])
    expect(namesOf(nested(rule, 'Consumables'))).toEqual(['Classname', 'Quantity', 'Content'])
  })

  test('ZP_TechTreeFile + ZP_TreeBranchInfo + ZP_TreeNode + ZP_TreeCost/ItemCost (ZP_TechTree.c)', () => {
    expect(namesOf(TECH_TREE_SCHEMA)).toEqual(['ConfigVersion', 'Branch', 'Nodes'])
    expect(namesOf(nested(TECH_TREE_SCHEMA, 'Branch'))).toEqual(['Id', 'Name', 'Icon', 'SortOrder', 'Factions'])
    const node = nested(TECH_TREE_SCHEMA, 'Nodes')
    expect(namesOf(node)).toEqual([
      'Id',
      'Name',
      'Description',
      'Icon',
      'Tier',
      'Parents',
      'ParentsMode',
      'Cost',
      'ItemCost',
      'ResearchTimeSec',
      'RequiredFactions',
    ])
    expect(namesOf(nested(node, 'Cost'))).toEqual(['Type', 'Amount'])
    expect(namesOf(nested(node, 'ItemCost'))).toEqual(['Classname', 'Quantity', 'Content'])
  })

  test('ZP_FactionsConfig + ZP_FactionDef (ZP_FactionsConfig.c)', () => {
    expect(namesOf(FACTIONS_SCHEMA)).toEqual(['ConfigVersion', 'Factions'])
    expect(namesOf(nested(FACTIONS_SCHEMA, 'Factions'))).toEqual([
      'Id',
      'DisplayName',
      'Supertype',
      'Armbands',
      'TerminalClasses',
      'DeviceClasses',
    ])
  })

  test('ZP_DataItemsConfig + ZP_DataDef + ZP_DataReward (ZP_DataItemsConfig.c)', () => {
    expect(namesOf(DATA_ITEMS_SCHEMA)).toEqual(['ConfigVersion', 'Items'])
    const dataDef = nested(DATA_ITEMS_SCHEMA, 'Items')
    expect(namesOf(dataDef)).toEqual(['Id', 'Enabled', 'Name', 'Description', 'Points'])
    expect(namesOf(nested(dataDef, 'Points'))).toEqual(['Type', 'Amount'])
  })

  test('ZP_ModulesConfig + ZP_ModuleDef (ZP_ModulesConfig.c)', () => {
    expect(namesOf(MODULES_SCHEMA)).toEqual(['ConfigVersion', 'Modules'])
    expect(namesOf(nested(MODULES_SCHEMA, 'Modules'))).toEqual(['Classname', 'PurityBonus', 'Devices', 'Notes'])
  })

  test('ZP_SampleTypesConfig + ZP_SampleTypeDef (ZP_SampleTypesConfig.c, W2.5 Task 3)', () => {
    expect(namesOf(SAMPLE_TYPES_SCHEMA)).toEqual(['ConfigVersion', 'Items'])
    // Строгий префікс ZP_DataDef (Id, Enabled, Name, Description, Points) БЕЗ Points —
    // зразок не здається напряму (task-2-report.md, поле за полем звірено з .c).
    expect(namesOf(nested(SAMPLE_TYPES_SCHEMA, 'Items'))).toEqual(['Id', 'Enabled', 'Name', 'Description'])
  })
})

// ---- Регресія дефолтів (binding constraints task-3-brief.md) ---------------------------

describe('дефолти = ініціалізатори Enforce-класів', () => {
  test('спільні дефолти з переліку зобов’язань завдання', () => {
    const rule = nested(RULES_FILE_SCHEMA, 'Rules')
    expect(defOf(rule, 'Enabled')).toBe(true)
    expect(defOf(rule, 'BasePurityMin')).toBe(0.5)
    expect(defOf(rule, 'BasePurityMax')).toBe(0.5)
    expect(defOf(rule, 'TimeSec')).toBe(10)
    expect(defOf(rule, 'Mode')).toBe('background')
    expect(defOf(nested(rule, 'InputItem'), 'Quantity')).toBe(1)
    expect(defOf(nested(rule, 'Outputs'), 'Quantity')).toBe(1)
    expect(defOf(nested(rule, 'Outputs'), 'Chance')).toBe(1.0)

    const node = nested(TECH_TREE_SCHEMA, 'Nodes')
    expect(defOf(node, 'ParentsMode')).toBe('all')
    expect(defOf(node, 'Tier')).toBe(1)
    expect(defOf(nested(node, 'ItemCost'), 'Quantity')).toBe(1)

    expect(defOf(nested(SAMPLE_TYPES_SCHEMA, 'Items'), 'Enabled')).toBe(true)

    expect(defOf(SETTINGS_SCHEMA, 'TreeVisibilityDepth')).toBe(1)
    expect(defOf(SETTINGS_SCHEMA, 'ConfigVersion')).toBe(1)
    expect(defOf(SETTINGS_SCHEMA, 'DebugMode')).toBe(true)
    expect(defOf(SETTINGS_SCHEMA, 'DefaultFaction')).toBe('default')

    expect(defOf(nested(MODULES_SCHEMA, 'Modules'), 'PurityBonus')).toBe(0)

    for (const schema of Object.values(SCHEMAS)) {
      expect(defOf(schema, 'ConfigVersion')).toBe(1)
    }
  })

  test('ZP_PointType.Tier=0 (без ініціалізатора) не плутається з ZP_TreeNode.Tier=1', () => {
    expect(defOf(nested(POINT_TYPES_SCHEMA, 'PointTypes'), 'Tier')).toBe(0)
    expect(defOf(nested(TECH_TREE_SCHEMA, 'Nodes'), 'Tier')).toBe(1)
  })

  test("поля без ініціалізатора -> дефолт типу (0 / '' / [])", () => {
    const treeNode = nested(TECH_TREE_SCHEMA, 'Nodes')
    const dataDef = nested(DATA_ITEMS_SCHEMA, 'Items')
    expect(defOf(nested(POINT_TYPES_SCHEMA, 'PointTypes'), 'SortOrder')).toBe(0)
    expect(defOf(nested(POINT_TYPES_SCHEMA, 'Categories'), 'SortOrder')).toBe(0)
    expect(defOf(nested(TECH_TREE_SCHEMA, 'Branch'), 'SortOrder')).toBe(0)
    expect(defOf(treeNode, 'Id')).toBe('')
    expect(defOf(nested(treeNode, 'Cost'), 'Amount')).toBe(0)
    expect(defOf(dataDef, 'Description')).toBe('')
    expect(defOf(nested(dataDef, 'Points'), 'Amount')).toBe(0)
    expect(defOf(nested(RULES_FILE_SCHEMA, 'Rules'), 'Device')).toBe('')
    expect(defOf(nested(RULES_FILE_SCHEMA, 'Rules'), 'Notes')).toBe('')
  })
})

describe('реєстр застарілих ключів', () => {
  test('єдиний запис — techTree/ResearchDevice', () => {
    expect(isStaleKey('techTree', 'ResearchDevice')).toBe(true)
    expect(isStaleKey('techTree', 'Icon')).toBe(false) // Icon відомий схемі, не застарілий
    expect(isStaleKey('settings', 'ResearchDevice')).toBe(false) // не той kind
    expect(schemaKnowsKey(SCHEMAS.techTree, 'ResearchDevice')).toBe(false)
  })
})
