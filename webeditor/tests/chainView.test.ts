// Тести чистих хелперів ChainView (W2 Task 5, переписано W2.6 Task 2 під двудольне
// полотно "предмет -> станок -> предмет"): мапінг StationViewResult (T1)+ChainGraph
// (розриви, T4) -> структури React Flow, композитні ключі ВУЗЛІВ ПРАВИЛА (панель
// дублікатів Id, без змін із T5), геометрія підпис-елемента "розрив" (DESIGN.md §6, без
// змін). Сам React-компонент (ReactFlow/elk у браузері) перевіряється смоуком у звіті, не
// тут -- vitest працює в Node без DOM.

import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseConfig } from '../src/io/parse'
import { RULES_FILE_SCHEMA, DATA_ITEMS_SCHEMA, SAMPLE_TYPES_SCHEMA } from '../src/model/schema'
import { loadClassIndex } from '../src/model/classIndex'
import type { ClassIndex } from '../src/model/classIndex'
import type { StorageBackend } from '../src/io/backend'
import type { Project, ProjectFile } from '../src/io/project'
import type { ChainNode } from '../src/model/chainGraph'
import {
  assignNodeKeys,
  buildStationCanvas,
  toStationFlowElements,
  computeBreakGeometry,
  estimateItemCardHeight,
  itemKey,
  layoutFlowNodes,
  pluralizeInputs,
  ITEM_CARD_WIDTH,
  STATION_CARD_WIDTH,
} from '../src/ui/ChainView'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, 'fixtures')

function fixtureText(rel: string): string {
  return readFileSync(join(FIXTURES, rel), 'utf8')
}

const idx: ClassIndex = loadClassIndex()

const dummyBackend: StorageBackend = {
  kind: 'zip',
  list: async () => [],
  read: async () => new Uint8Array(0),
  write: async () => {},
}

function rulesFile(path: string, jsonText: string): ProjectFile {
  const { value, warnings } = parseConfig(RULES_FILE_SCHEMA, jsonText)
  return { path, kind: 'rules', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function dataItemsFile(items: Record<string, unknown>[]): ProjectFile {
  const jsonText = JSON.stringify({ ConfigVersion: 1, Items: items })
  const { value, warnings } = parseConfig(DATA_ITEMS_SCHEMA, jsonText)
  return { path: 'DataItems.json', kind: 'dataItems', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function sampleTypesFile(items: Record<string, unknown>[]): ProjectFile {
  const jsonText = JSON.stringify({ ConfigVersion: 1, Items: items })
  const { value, warnings } = parseConfig(SAMPLE_TYPES_SCHEMA, jsonText)
  return { path: 'SampleTypes.json', kind: 'sampleTypes', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function project(...files: ProjectFile[]): Project {
  return { files, backend: dummyBackend }
}

function rule(id: string, override: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Id: id,
    Enabled: true,
    Device: 'ZP_SampleFridge',
    Mode: 'background',
    InputItem: { Classname: 'Apple', Quantity: 1, ConsumeInput: true, Content: '' },
    BasePurityMin: 0.5,
    BasePurityMax: 0.5,
    TimeSec: 10,
    Consumables: [],
    Outputs: [],
    RequiredNode: '',
    RequiredFactions: [],
    RequiredWorn: [],
    RequiredTools: [],
    Notes: '',
    ...override,
  }
}

function rulesJson(rules: Record<string, unknown>[]): string {
  return JSON.stringify({ ConfigVersion: 1, Rules: rules })
}

// stationKey -- дзеркало instanceKey у buildStationCanvas (W2.6 Task 2, директива
// власника про дублювання станків 2026-08-07): "station::<filePath>::<ruleId>". Станок-
// вузол тепер ІНСТАНЦІЯ ПРАВИЛА, не класнейму -- тести звертаються до конкретної картки
// саме через цей композитний ключ, а не через голий класнейм станка.
function stationKey(filePath: string, ruleId: string): string {
  return `station::${filePath}::${ruleId}`
}

// ---- assignNodeKeys: композитні ключі ВУЗЛІВ ПРАВИЛА (панель дублікатів Id) -- БЕЗ ЗМІН ----

describe('assignNodeKeys', () => {
  function node(filePath: string, ruleId: string): ChainNode {
    return { ruleId, filePath, rule: rule(ruleId), disabled: false }
  }

  test('унікальні ruleId -- ключ дорівнює "filePath::ruleId", дублікатів немає', () => {
    const { keyed, duplicates } = assignNodeKeys([node('a.json', 'x'), node('b.json', 'y')])
    expect(keyed.map((k) => k.key)).toEqual(['a.json::x', 'b.json::y'])
    expect(duplicates).toEqual([])
  })

  test('однаковий Id у РІЗНИХ файлах -- обидва ключі унікальні (не колізують), позначені як дублікат', () => {
    const nodes = [node('a.json', 'dup'), node('b.json', 'dup')]
    const { keyed, duplicates } = assignNodeKeys(nodes)
    expect(keyed.map((k) => k.key)).toEqual(['a.json::dup', 'b.json::dup'])
    expect(new Set(keyed.map((k) => k.key)).size).toBe(2)
    expect(duplicates).toEqual([{ ruleId: 'dup', keys: ['a.json::dup', 'b.json::dup'], filePaths: ['a.json', 'b.json'] }])
  })

  test('однаковий Id в ОДНОМУ файлі -- композитний ключ теж колізує, рятує лічильник-суфікс', () => {
    const nodes = [node('a.json', 'dup'), node('a.json', 'dup'), node('a.json', 'dup')]
    const { keyed, duplicates } = assignNodeKeys(nodes)
    expect(keyed.map((k) => k.key)).toEqual(['a.json::dup', 'a.json::dup#2', 'a.json::dup#3'])
    expect(new Set(keyed.map((k) => k.key)).size).toBe(3)
    expect(duplicates).toHaveLength(1)
    expect(duplicates[0].keys).toHaveLength(3)
    expect(duplicates[0].filePaths).toEqual(['a.json'])
  })
})

// ---- itemKey: ідентичність предмета-вузла (W2.6 Task 2) -------------------------------------

describe('itemKey', () => {
  test('кейс-інсенситивність по обидвох частинах', () => {
    expect(itemKey('ZP_Sample', 'Chimera')).toBe(itemKey('zp_sample', 'CHIMERA'))
  })

  test('роздільник запобігає колізії конкатенації ("ab"+"c d" != "ab c"+"d")', () => {
    expect(itemKey('ab', 'c d')).not.toBe(itemKey('ab c', 'd'))
  })

  test('сировина без вмісту -- ключ визначений і стабільний', () => {
    expect(itemKey('Apple', '')).toBe(itemKey('Apple', ''))
    expect(itemKey('Apple', '')).not.toBe(itemKey('apple', 'x'))
  })
})

// resolveDataItemFace/resolveSampleTypeFace (model/faceResolve.ts) — ПОВНЕ пряме
// тестування живе окремо в tests/faceResolve.test.ts (fix-round-1 Task 2 review,
// IMPORTANT 2: ці функції не залежать від рерайту полотна й не мають дублювати
// покриття в обох файлах) — тут лишається лише інтеграційне використання нижче
// (buildStationCanvas з/без DataItems.json/SampleTypes.json у проєкті).

// ---- buildStationCanvas: chain.json (замкнений ланцюг) ---------------------------------------
// Fixtures/live/chain.json (T5): Apple -> Fridge -> ZP_Sample(chimera_claw) -> Microscope ->
// ZP_Data_01; Rag -> Fridge -> ZP_Sample(bloodsucker_gland) -> Microscope -> ZP_Data_61.
// ДИРЕКТИВА ВЛАСНИКА (2026-08-07, після живого смоуку): станок дублюється НА ПРАВИЛО --
// 4 станки-ІНСТАНЦІЇ (по одній на chain_pack_chimera/chain_pack_bloodsucker/
// chain_analyze_chimera/chain_analyze_bloodsucker, 2 інстанції кожного з 2 класнеймів),
// 6 предметів (ідентичність лишається за струмом -- Apple, Rag, 2х ZP_Sample-з-різним-
// вмістом, ZP_Data_01, ZP_Data_61), 8 ребер (та сама кількість, що й до директиви --
// змінилась лише ЦІЛЬ ребра станка: instanceKey замість голого класнейму), 0 розривів --
// дві НЕЗАЛЕЖНІ доріжки зліва направо, кожна ланка своя.

describe('buildStationCanvas: chain.json (замкнений ланцюг, станок дублюється на правило)', () => {
  const p = project(rulesFile('ProcessingRules/chain.json', fixtureText('live/chain.json')))
  const model = buildStationCanvas(p, idx)
  const FILE = 'ProcessingRules/chain.json'

  test('4 станки-інстанції (2 класнейми × 2 правила кожен), 6 предметів, 0 привидів, 0 розривів', () => {
    expect(model.stationCards).toHaveLength(4)
    expect(new Set(model.stationCards.map((s) => s.key)).size).toBe(4) // усі ключі унікальні
    expect(model.stationCards.filter((s) => s.classname === 'ZP_SampleFridge')).toHaveLength(2)
    expect(model.stationCards.filter((s) => s.classname === 'ZP_Microscope')).toHaveLength(2)
    expect(model.itemCards).toHaveLength(6)
    expect(model.ghostCards).toEqual([])
    expect(model.breakEdges).toEqual([])
    expect(model.breakTargets).toEqual([])
    expect(model.duplicates).toEqual([])
  })

  test('кожна інстанція несе СВІЙ ruleId, але АГРЕГАТНІ inputCount/roles ЦІЛОГО станка (директива п.3)', () => {
    const packChimera = model.stationCards.find((s) => s.key === stationKey(FILE, 'chain_pack_chimera'))!
    const packBlood = model.stationCards.find((s) => s.key === stationKey(FILE, 'chain_pack_bloodsucker'))!
    const analyzeChimera = model.stationCards.find((s) => s.key === stationKey(FILE, 'chain_analyze_chimera'))!
    expect(packChimera.ruleId).toBe('chain_pack_chimera')
    expect(packBlood.ruleId).toBe('chain_pack_bloodsucker')
    // Обидві інстанції ZP_SampleFridge несуть ОДНАКОВИЙ агрегат станка (2 входи, роль
    // "пакувальник") -- дублювання ВІЗУАЛЬНЕ, станок в основі один.
    expect(packChimera.inputCount).toBe(2)
    expect(packBlood.inputCount).toBe(2)
    expect(packChimera.roles).toEqual({ packer: true, analyzer: false })
    expect(packBlood.roles).toEqual(packChimera.roles)
    expect(analyzeChimera.roles).toEqual({ packer: false, analyzer: true })
    expect(analyzeChimera.inputCount).toBe(2)
  })

  test('8 ребер: 2 сировина->станок-інстанція, 2 станок->зразок, 2 зразок->станок, 2 станок->заготовка', () => {
    expect(model.edges).toHaveLength(8)
    const packChimeraKey = stationKey(FILE, 'chain_pack_chimera')
    const packBloodKey = stationKey(FILE, 'chain_pack_bloodsucker')
    const analyzeChimeraKey = stationKey(FILE, 'chain_analyze_chimera')
    const analyzeBloodKey = stationKey(FILE, 'chain_analyze_bloodsucker')
    const appleKey = itemKey('Apple', '')
    const ragKey = itemKey('Rag', '')
    const chimeraKey = itemKey('ZP_Sample', 'chimera_claw')
    const bloodKey = itemKey('ZP_Sample', 'bloodsucker_gland')
    const data01Key = itemKey('ZP_Data_01', '')
    const data61Key = itemKey('ZP_Data_61', '')
    const pairs = new Set(model.edges.map((e) => `${e.sourceKey}=>${e.targetKey}`))
    // Дві НЕЗАЛЕЖНІ доріжки -- жодне ребро НЕ перетинає лінію: chimera-лінія і
    // bloodsucker-лінія розходяться ще на РІВНІ станка-інстанції (не лише предмета).
    expect(pairs).toEqual(
      new Set([
        `${appleKey}=>${packChimeraKey}`,
        `${ragKey}=>${packBloodKey}`,
        `${packChimeraKey}=>${chimeraKey}`,
        `${packBloodKey}=>${bloodKey}`,
        `${chimeraKey}=>${analyzeChimeraKey}`,
        `${bloodKey}=>${analyzeBloodKey}`,
        `${analyzeChimeraKey}=>${data01Key}`,
        `${analyzeBloodKey}=>${data61Key}`,
      ]),
    )
  })

  test('звичайні ребра НЕ несуть content у даних (мітка на самому предметі, не на ребрі)', () => {
    expect(model.edges.every((e) => e.content === '')).toBe(true)
  })

  test('класифікація предметів: Apple/Rag -- raw, ZP_Sample* -- sample, ZP_Data_* -- dataItem', () => {
    const apple = model.itemCards.find((i) => i.key === itemKey('Apple', ''))!
    const sample = model.itemCards.find((i) => i.key === itemKey('ZP_Sample', 'chimera_claw'))!
    const data = model.itemCards.find((i) => i.key === itemKey('ZP_Data_01', ''))!
    expect(apple).toMatchObject({ kind: 'raw', configured: true, duplicate: false, enabled: true })
    expect(sample.kind).toBe('sample')
    expect(data.kind).toBe('dataItem')
    // Без SampleTypes.json/DataItems.json у проєкті -- "не налаштовано" (configured=false).
    expect(sample.configured).toBe(false)
    expect(data.configured).toBe(false)
  })

  test('з DataItems.json/SampleTypes.json у проєкті -- ігрове ім’я резолвиться', () => {
    const withNames = project(
      rulesFile('ProcessingRules/chain.json', fixtureText('live/chain.json')),
      dataItemsFile([{ Id: 'ZP_Data_01', Enabled: true, Name: 'Хімерна тканина', Description: '', Points: [] }]),
      sampleTypesFile([{ Id: 'ZP_Sample', Enabled: true, Name: 'Тканинний зразок', Description: '' }]),
    )
    const m = buildStationCanvas(withNames, idx)
    const sample = m.itemCards.find((i) => i.key === itemKey('ZP_Sample', 'chimera_claw'))!
    const data = m.itemCards.find((i) => i.key === itemKey('ZP_Data_01', ''))!
    expect(sample).toMatchObject({ configured: true, display: 'Тканинний зразок', enabled: true })
    expect(data).toMatchObject({ configured: true, display: 'Хімерна тканина', enabled: true })
  })
})

// ---- Наскрізний ланцюг 3 ЛАНКИ, не-упаковувач посередині (W2.6 Task 4) ---------------------
//
// chain.json вище -- РІВНО дволанковий (пакувальник->аналізатор->заготовка); тут -- ТРЕТІЙ
// станок посередині ланцюга споживає проміжний предмет аналізатора (не зразок, не
// заготовка) і лише ВІН виробляє фінальну ZP_Data_01. Три станки-інстанції, три предмети-
// вузли (Apple/ZP_Sample/ZP_Interm_Ore/ZP_Data_01 -- разом ЧОТИРИ, по одному на кожну
// стрілку доріжки), 0 привидів/розривів -- "три лінії доріжки" з брифа T4 (лінія =
// станок1->станок2->станок3, читається зліва направо суцільно).
describe('buildStationCanvas: наскрізний ланцюг 3 ланки (пакувальник -> аналізатор -> третій станок)', () => {
  const FILE = 'ProcessingRules/chain3.json'
  const pack = rule('pack', { Device: 'ZP_SampleFridge', Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'ore' }] })
  const analyze = rule('analyze', {
    Device: 'ZP_Microscope',
    InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: true, Content: 'ore' },
    Outputs: [{ Classname: 'ZP_Interm_Ore', Quantity: 1, Chance: 1, Content: '' }],
  })
  const refine = rule('refine', {
    Device: 'ZP_ChemBench',
    InputItem: { Classname: 'ZP_Interm_Ore', Quantity: 1, ConsumeInput: true, Content: '' },
    Outputs: [{ Classname: 'ZP_Data_01', Quantity: 1, Chance: 1, Content: '' }],
  })
  const p = project(rulesFile(FILE, rulesJson([pack, analyze, refine])))
  const model = buildStationCanvas(p, idx)

  test('3 станки-інстанції, 4 предмети-вузли (Apple/зразок/проміжний/заготовка), 0 привидів/розривів', () => {
    expect(model.stationCards).toHaveLength(3)
    expect(new Set(model.stationCards.map((s) => s.classname))).toEqual(new Set(['ZP_SampleFridge', 'ZP_Microscope', 'ZP_ChemBench']))
    expect(model.itemCards).toHaveLength(4)
    expect(model.ghostCards).toEqual([])
    expect(model.breakEdges).toEqual([])
    expect(model.breakTargets).toEqual([])
  })

  test('6 ребер -- одна суцільна лінія зліва направо через УСІ три станки-інстанції (вхід+вихід на кожен з трьох)', () => {
    expect(model.edges).toHaveLength(6)
    const packKey = stationKey(FILE, 'pack')
    const analyzeKey = stationKey(FILE, 'analyze')
    const refineKey = stationKey(FILE, 'refine')
    const appleKey = itemKey('Apple', '')
    const sampleKey = itemKey('ZP_Sample', 'ore')
    const intermKey = itemKey('ZP_Interm_Ore', '')
    const dataKey = itemKey('ZP_Data_01', '')
    const pairs = new Set(model.edges.map((e) => `${e.sourceKey}=>${e.targetKey}`))
    // Одна БЕЗПЕРЕРВНА доріжка, ланка за ланкою: сировина -> станок1 -> зразок -> станок2
    // -> проміжний предмет -> станок3 -> заготовка. Жодне ребро не перескакує через станок
    // (кожна стрілка з'єднує сусідні вузли лінії, не станок1 напряму зі станок3).
    expect(pairs).toEqual(
      new Set([
        `${appleKey}=>${packKey}`,
        `${packKey}=>${sampleKey}`,
        `${sampleKey}=>${analyzeKey}`,
        `${analyzeKey}=>${intermKey}`,
        `${intermKey}=>${refineKey}`, // ланка #2->#3
        `${refineKey}=>${dataKey}`,
      ]),
    )
  })

  test('проміжний предмет класифікується як raw (не sample, не dataItem) -- звичайний клас поза обома родинами', () => {
    const interm = model.itemCards.find((i) => i.key === itemKey('ZP_Interm_Ore', ''))!
    expect(interm.kind).toBe('raw')
    expect(interm.configured).toBe(true)
  })
})

// ---- Ідентичність предмета: той самий (класнейм,вміст) з ДВОХ станків -- ОДИН вузол --------

describe('buildStationCanvas: той самий предмет з двох станків -- один вузол, два вхідних ребра', () => {
  test('два різні пакувальники виробляють ZP_Sample з тим самим вмістом -- 1 предмет-вузол, 2 ребра в нього', () => {
    const packA = rule('pack_a', { Device: 'StationA', Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'x' }] })
    const packB = rule('pack_b', { Device: 'StationB', Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'x' }] })
    const p = project(rulesFile('ProcessingRules/r.json', rulesJson([packA, packB])))
    const model = buildStationCanvas(p, idx)

    const sampleNodes = model.itemCards.filter((i) => i.key === itemKey('ZP_Sample', 'x'))
    expect(sampleNodes).toHaveLength(1) // предмет-вузол лишається ОДНИМ (ідентичність за струмом, директива п.2)
    const incoming = model.edges.filter((e) => e.targetKey === itemKey('ZP_Sample', 'x'))
    expect(incoming).toHaveLength(2)
    // Станки-джерела -- ОКРЕМІ інстанції (по одній на правило), не той самий вузол.
    expect(new Set(incoming.map((e) => e.sourceKey))).toEqual(
      new Set([stationKey('ProcessingRules/r.json', 'pack_a'), stationKey('ProcessingRules/r.json', 'pack_b')]),
    )
  })
})

// ---- Вимкнений рядок -- "item flow absent" ---------------------------------------------------

describe('buildStationCanvas: вимкнений рядок не додає жодного ребра/предмета сам по собі', () => {
  test('станок з ЄДИНИМ вимкненим правилом -- inputCount=1 (структурно), 0 предметів/ребер', () => {
    const disabled = rule('off', {
      Device: 'ZP_LonelyStation',
      Enabled: false,
      InputItem: { Classname: 'ZP_OnlyHere', Quantity: 1, ConsumeInput: true, Content: '' },
      Outputs: [{ Classname: 'ZP_OnlyHereOut', Quantity: 1, Chance: 1, Content: '' }],
    })
    const p = project(rulesFile('ProcessingRules/r.json', rulesJson([disabled])))
    const model = buildStationCanvas(p, idx)

    expect(model.stationCards).toHaveLength(1)
    expect(model.stationCards[0].inputCount).toBe(1) // рядок ІСНУЄ структурно
    expect(model.itemCards).toHaveLength(0) // але жоден предмет не з'явився
    expect(model.edges).toHaveLength(0)
  })

  test('той самий предмет фігурує ще й в УВІМКНЕНОМУ рядку іншого станка -- з\'являється звідти', () => {
    const disabled = rule('off', { Device: 'A', Enabled: false, InputItem: { Classname: 'Shared', Quantity: 1, ConsumeInput: true, Content: '' } })
    const enabled = rule('on', { Device: 'B', InputItem: { Classname: 'Shared', Quantity: 1, ConsumeInput: true, Content: '' } })
    const p = project(rulesFile('ProcessingRules/r.json', rulesJson([disabled, enabled])))
    const model = buildStationCanvas(p, idx)

    const shared = model.itemCards.filter((i) => i.key === itemKey('Shared', ''))
    expect(shared).toHaveLength(1)
    const onKey = stationKey('ProcessingRules/r.json', 'on')
    const offKey = stationKey('ProcessingRules/r.json', 'off')
    expect(model.edges.some((e) => e.sourceKey === itemKey('Shared', '') && e.targetKey === onKey)).toBe(true)
    expect(model.edges.some((e) => e.targetKey === offKey)).toBe(false)
    // Обидві станок-інстанції ІСНУЮТЬ як картки (адмін бачить структуру, і увімкненого,
    // і вимкненого правила) -- лише ребро в/з вимкненої відсутнє.
    expect(model.stationCards.some((s) => s.key === offKey)).toBe(true)
  })
})

// ---- Consumables: лічильник на станку, БЕЗ окремого предмета/ребра ---------------------------

describe('buildStationCanvas: Consumables -- бейдж на станку, не предмет-вузол', () => {
  test('правило з 2 витратними -- consumablesCount=2 на станку, жодного предмета/ребра з їхніх класнеймів', () => {
    const withConsumables = rule('r1', {
      Consumables: [
        { Classname: 'Battery', Quantity: 1, Content: '' },
        { Classname: 'Rope', Quantity: 1, Content: '' },
      ],
    })
    const p = project(rulesFile('ProcessingRules/r.json', rulesJson([withConsumables])))
    const model = buildStationCanvas(p, idx)

    const station = model.stationCards[0]
    expect(station.consumablesCount).toBe(2)
    expect(station.consumablesHint).toContain('Battery')
    expect(station.consumablesHint).toContain('Rope')
    expect(model.itemCards.some((i) => i.classname === 'Battery')).toBe(false)
    expect(model.itemCards.some((i) => i.classname === 'Rope')).toBe(false)
    // Consumables НЕ дають жодного власного ребра/предмета -- лишається рівно ОДНЕ ребро
    // від InputItem.Classname='Apple' (дефолт rule()) у станок-інстанцію цього правила,
    // як у будь-якого рядка з непорожнім входом і без Outputs.
    expect(model.edges).toHaveLength(1)
    expect(model.edges[0]).toMatchObject({ sourceKey: itemKey('Apple', ''), targetKey: stationKey('ProcessingRules/r.json', 'r1') })
  })
})

// ---- Розриви: ghost-предмет + break-ребро, ретаргетовані на новий вузловий простір ----------

describe('buildStationCanvas: розрив unfed-input -- ghost-предмет -> станок', () => {
  test('вимога Content, якого ніхто не виробляє -- ghost-предмет, звичайне ребро НЕ малюється', () => {
    const consumer = rule('consumer', {
      Device: 'ZP_Microscope',
      InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: true, Content: 'missing' },
    })
    const p = project(rulesFile('ProcessingRules/r.json', rulesJson([consumer])))
    const model = buildStationCanvas(p, idx)

    const consumerKey = stationKey('ProcessingRules/r.json', 'consumer')
    expect(model.ghostCards).toHaveLength(1)
    expect(model.ghostCards[0]).toMatchObject({ kind: 'unfed-input', classname: 'ZP_Sample', content: 'missing' })
    expect(model.breakEdges).toHaveLength(1)
    expect(model.breakEdges[0].sourceKey).toBe(model.ghostCards[0].key)
    expect(model.breakEdges[0].targetKey).toBe(consumerKey)
    // Немає звичайного ребра "ZP_Sample(missing) -> станок-інстанція" -- лише ghost-ребро.
    expect(model.edges.some((e) => e.targetKey === consumerKey)).toBe(false)
    // Немає й реального предмета-вузла з цим (класнейм,вміст) -- нікому виробляти.
    expect(model.itemCards.some((i) => i.key === itemKey('ZP_Sample', 'missing'))).toBe(false)

    expect(model.breakTargets).toHaveLength(1)
    expect(model.breakTargets[0].centerKey).toBe(consumerKey) // центруємо на РЕАЛЬНІЙ інстанції, що вимагає
  })
})

describe('buildStationCanvas: розрив dead-output -- реальний предмет + ghost "нікуди йти"', () => {
  test('вихід НЕ бере жодне правило -- реальний предмет ІСНУЄ (звичайне ребро від виробника) + ghost-ребро від нього', () => {
    const producer = rule('producer', { Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'orphan' }] })
    const p = project(rulesFile('ProcessingRules/r.json', rulesJson([producer])))
    const model = buildStationCanvas(p, idx)

    const realKey = itemKey('ZP_Sample', 'orphan')
    const producerKey = stationKey('ProcessingRules/r.json', 'producer')
    expect(model.itemCards.some((i) => i.key === realKey)).toBe(true) // реальний предмет ІСНУЄ
    expect(model.edges.some((e) => e.sourceKey === producerKey && e.targetKey === realKey)).toBe(true) // звичайне ребро від виробника-інстанції

    expect(model.ghostCards).toHaveLength(1)
    expect(model.ghostCards[0]).toMatchObject({ kind: 'dead-output', classname: 'ZP_Sample', content: 'orphan' })
    expect(model.breakEdges).toHaveLength(1)
    expect(model.breakEdges[0].sourceKey).toBe(realKey) // ребро йде ВІД реального предмета
    expect(model.breakEdges[0].targetKey).toBe(model.ghostCards[0].key)

    expect(model.breakTargets).toHaveLength(1)
    expect(model.breakTargets[0].centerKey).toBe(realKey) // центруємо на РЕАЛЬНОМУ предметі, не ghost
  })
})

// ---- fix-round-1, IMPORTANT 1: справжній дублікат Id В ОДНОМУ файлі -- КОЖЕН близнюк
// мусить отримати СВІЙ ВЛАСНИЙ break, не обидва в останню інстанцію (регресія, знайдена
// рев'юером: старий ownerByRow -- Map<string,string> -- колізував на "filePath::ruleId",
// другий .set() тихо перезаписував першого; ОБИДВА розриви резолвились в ОСТАННЮ
// інстанцію, перша лишалась взагалі без break-ребра). W2 Task 5 мала еквівалентний тест
// для rule-card-моделі ("однаковий Id ДВІЧІ В ОДНОМУ файлі"), випав при переписі на
// двудольне полотно (W2.6 Task 2) -- відновлено тут у нових термінах (станок-інстанція/
// предмет), той самий сценарій, що й у пробі рев'юера.
describe('buildStationCanvas: справжній дублікат Id В ОДНОМУ файлі -- КОЖЕН близнюк отримує СВІЙ розрив (fix-round-1, IMPORTANT 1)', () => {
  test('unfed-input: два близнюки, той самий Id/Device, РІЗНИЙ відсутній Content -- кожен розрив центрує на СВОЇЙ інстанції', () => {
    const twin1 = rule('dup_twin', {
      Device: 'ZP_Microscope',
      InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: true, Content: 'missing_a' },
    })
    const twin2 = rule('dup_twin', {
      Device: 'ZP_Microscope',
      InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: true, Content: 'missing_b' },
    })
    const p = project(rulesFile('ProcessingRules/r.json', rulesJson([twin1, twin2])))
    const model = buildStationCanvas(p, idx)

    const key1 = stationKey('ProcessingRules/r.json', 'dup_twin')
    const key2 = `${key1}#2`

    // Обидві інстанції-картки станка ІСНУЮТЬ, з УНІКАЛЬНИМИ ключами.
    expect(model.stationCards).toHaveLength(2)
    expect(new Set(model.stationCards.map((s) => s.key))).toEqual(new Set([key1, key2]))
    expect(model.duplicates).toEqual([{ ruleId: 'dup_twin', keys: expect.any(Array), filePaths: ['ProcessingRules/r.json'] }])

    // Два НЕЗАЛЕЖНІ розриви (по одному на близнюка) -- ГОЛОВНЕ твердження: РІЗНІ centerKey.
    expect(model.breakTargets).toHaveLength(2)
    const centerKeys = model.breakTargets.map((b) => b.centerKey)
    expect(new Set(centerKeys)).toEqual(new Set([key1, key2])) // жоден не губиться, жоден не дублюється в один
    expect(centerKeys[0]).not.toBe(centerKeys[1])

    // Кожен ghost/break-ребро несе СВІЙ Content і веде РІВНО в СВОЮ інстанцію (не в чужу).
    expect(model.ghostCards).toHaveLength(2)
    expect(model.breakEdges).toHaveLength(2)
    const edgeForA = model.breakEdges.find((e) => e.content === 'missing_a')!
    const edgeForB = model.breakEdges.find((e) => e.content === 'missing_b')!
    expect([edgeForA.targetKey, edgeForB.targetKey].sort()).toEqual([key1, key2].sort())
    expect(edgeForA.targetKey).not.toBe(edgeForB.targetKey) // РІЗНІ інстанції, не та сама двічі
  })

  test('dead-output: два близнюки, РІЗНИЙ вихід -- кожен розрив ВІД СВОГО реального предмета', () => {
    const twin1 = rule('dup_producer', { Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'orphan_a' }] })
    const twin2 = rule('dup_producer', { Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'orphan_b' }] })
    const p = project(rulesFile('ProcessingRules/r.json', rulesJson([twin1, twin2])))
    const model = buildStationCanvas(p, idx)

    const key1 = stationKey('ProcessingRules/r.json', 'dup_producer')
    const key2 = `${key1}#2`
    const realA = itemKey('ZP_Sample', 'orphan_a')
    const realB = itemKey('ZP_Sample', 'orphan_b')

    expect(model.breakTargets).toHaveLength(2)
    // Реальні предмети -- РІЗНІ (різний Content), тому dead-output тут природно
    // однозначний за структурним збігом (без потреби у fallback-курсорі), АЛЕ саме
    // ребро "станок -> предмет" мусить іти з ПРАВИЛЬНОЇ інстанції-виробника.
    expect(model.edges.some((e) => e.sourceKey === key1 && e.targetKey === realA)).toBe(true)
    expect(model.edges.some((e) => e.sourceKey === key2 && e.targetKey === realB)).toBe(true)
    expect(model.edges.some((e) => e.sourceKey === key1 && e.targetKey === realB)).toBe(false)
    expect(model.edges.some((e) => e.sourceKey === key2 && e.targetKey === realA)).toBe(false)

    const centerKeys = new Set(model.breakTargets.map((b) => b.centerKey))
    expect(centerKeys).toEqual(new Set([realA, realB]))
  })
})

describe('buildStationCanvas: розрив на рядку БЕЗ Device -- повідомлення є, ціль центрування відсутня', () => {
  test('порожній Device -- рядок не в жодному станку, breakTargets.centerKey=undefined, ghost НЕ створюється', () => {
    const orphan = rule('orphan', {
      Device: '',
      InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: true, Content: 'missing_orphan' },
    })
    const p = project(rulesFile('ProcessingRules/r.json', rulesJson([orphan])))
    const model = buildStationCanvas(p, idx)

    expect(model.stationCards).toEqual([])
    expect(model.ghostCards).toEqual([]) // нема куди приєднати -- ghost не породжується
    expect(model.breakEdges).toEqual([])
    expect(model.breakTargets).toHaveLength(1)
    expect(model.breakTargets[0].centerKey).toBeUndefined()
    expect(model.breakTargets[0].message).toContain('missing_orphan')
  })
})

// ---- Дублікати Id -- surfaced через model.duplicates (assignNodeKeys під капотом) -----------

describe('buildStationCanvas: model.duplicates -- дублікат Id у різних файлах', () => {
  test('два правила з однаковим Id -- duplicates несе обидва файли', () => {
    const p = project(
      rulesFile('ProcessingRules/a.json', rulesJson([rule('dup')])),
      rulesFile('ProcessingRules/b.json', rulesJson([rule('dup')])),
    )
    const model = buildStationCanvas(p, idx)
    expect(model.duplicates).toEqual([{ ruleId: 'dup', keys: expect.any(Array), filePaths: ['ProcessingRules/a.json', 'ProcessingRules/b.json'] }])
  })
})

// ---- toStationFlowElements: StationCanvasModel -> вузли/ребра React Flow --------------------

describe('toStationFlowElements', () => {
  test('станки й предмети -- окремі типи вузлів з розмірами; ребра -- chainEdge/breakEdge', () => {
    const p = project(rulesFile('ProcessingRules/chain.json', fixtureText('live/chain.json')))
    const model = buildStationCanvas(p, idx)
    const { nodes, edges } = toStationFlowElements(model)

    expect(nodes).toHaveLength(model.stationCards.length + model.itemCards.length + model.ghostCards.length)
    const stationNodes = nodes.filter((n) => n.type === 'stationNode')
    const itemNodes = nodes.filter((n) => n.type === 'itemNode')
    expect(stationNodes).toHaveLength(4) // 4 правила -- 4 станок-інстанції (директива про дублювання)
    expect(itemNodes).toHaveLength(6)
    expect(stationNodes.every((n) => n.width === STATION_CARD_WIDTH)).toBe(true)
    expect(itemNodes.every((n) => n.width === ITEM_CARD_WIDTH)).toBe(true)

    expect(edges).toHaveLength(8)
    expect(edges.every((e) => e.type === 'chainEdge')).toBe(true)
  })

  test('розрив -- ghost-вузол типу ghostNode і ребро типу breakEdge', () => {
    const consumer = rule('consumer', {
      Device: 'ZP_Microscope',
      InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: true, Content: 'missing' },
    })
    const p = project(rulesFile('ProcessingRules/r.json', rulesJson([consumer])))
    const model = buildStationCanvas(p, idx)
    const { nodes, edges } = toStationFlowElements(model)

    expect(nodes.some((n) => n.type === 'ghostNode')).toBe(true)
    expect(edges.some((e) => e.type === 'breakEdge')).toBe(true)
  })
})

// ---- estimateItemCardHeight: sample вищий за raw/dataItem -----------------------------------

describe('estimateItemCardHeight', () => {
  test('sample вищий (додатковий рядок "вміст приховано")', () => {
    expect(estimateItemCardHeight('sample')).toBeGreaterThan(estimateItemCardHeight('raw'))
    expect(estimateItemCardHeight('raw')).toBe(estimateItemCardHeight('dataItem'))
  })
})

// ---- pluralizeInputs: слов'янська плюралізація -----------------------------------------------

describe('pluralizeInputs', () => {
  test('1, 21 -- однина "вхід"', () => {
    expect(pluralizeInputs(1)).toBe('1 вхід')
    expect(pluralizeInputs(21)).toBe('21 вхід')
  })
  test('2..4, 22..24 -- "входи"', () => {
    expect(pluralizeInputs(2)).toBe('2 входи')
    expect(pluralizeInputs(4)).toBe('4 входи')
    expect(pluralizeInputs(23)).toBe('23 входи')
  })
  test('0, 5..20, 11 -- "входів"', () => {
    expect(pluralizeInputs(0)).toBe('0 входів')
    expect(pluralizeInputs(5)).toBe('5 входів')
    expect(pluralizeInputs(11)).toBe('11 входів')
    expect(pluralizeInputs(20)).toBe('20 входів')
  })
})

// ---- computeBreakGeometry: чиста геометрія підпис-елемента (DESIGN.md §6) -- БЕЗ ЗМІН -------

describe('computeBreakGeometry', () => {
  test('горизонтальна лінія: лампа рівно посередині, проміжок 24px симетричний', () => {
    const g = computeBreakGeometry(0, 100, 200, 100)
    expect(g.lampX).toBe(100)
    expect(g.lampY).toBe(100)
    expect(g.stub1.x2).toBeCloseTo(88, 5)
    expect(g.stub2.x1).toBeCloseTo(112, 5)
    expect(g.tick1.y1).toBeCloseTo(97, 5)
    expect(g.tick1.y2).toBeCloseTo(103, 5)
    expect(g.tick1.x1).toBeCloseTo(88, 5)
    expect(g.tick1.x2).toBeCloseTo(88, 5)
  })

  test('стаби починаються рівно в source/target', () => {
    const g = computeBreakGeometry(0, 100, 200, 100)
    expect(g.stub1.x1).toBe(0)
    expect(g.stub1.y1).toBe(100)
    expect(g.stub2.x2).toBe(200)
    expect(g.stub2.y2).toBe(100)
  })

  test('вироджений випадок (source === target) не ділить на нуль -- скінченні координати', () => {
    const g = computeBreakGeometry(50, 50, 50, 50)
    for (const v of [g.lampX, g.lampY, g.stub1.x2, g.stub2.x1, g.tick1.x1, g.tick2.x2]) {
      expect(Number.isFinite(v)).toBe(true)
    }
  })

  test('діагональна лінія: лампа теж посередині, довжина проміжку зберігається (Піфагор)', () => {
    const g = computeBreakGeometry(0, 0, 100, 100)
    expect(g.lampX).toBeCloseTo(50, 5)
    expect(g.lampY).toBeCloseTo(50, 5)
    const gapLen = Math.hypot(g.stub2.x1 - g.stub1.x2, g.stub2.y1 - g.stub1.y2)
    expect(gapLen).toBeCloseTo(24, 5)
  })
})

// ---- layoutFlowNodes: інтеграція з реальним elkjs (синхронна fake-worker збірка) -----------

describe('layoutFlowNodes (elkjs, layered/RIGHT)', () => {
  test('порожній граф -- порожня мапа, без падіння', async () => {
    const positions = await layoutFlowNodes([], [])
    expect(positions.size).toBe(0)
  })

  test('станок-виробник -> станок-споживач: споживач лежить ПРАВІШЕ (напрямок RIGHT)', async () => {
    const p = project(
      rulesFile(
        'ProcessingRules/r.json',
        rulesJson([
          rule('producer', { Device: 'Producer', Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'x' }] }),
          rule('consumer', {
            Device: 'Consumer',
            InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: true, Content: 'x' },
          }),
        ]),
      ),
    )
    const model = buildStationCanvas(p, idx)
    const { nodes, edges } = toStationFlowElements(model)
    const positions = await layoutFlowNodes(nodes, edges)

    // 2 станки-інстанції (по одному правилу кожен) + 2 предмети: ZP_Sample (виробляється/
    // споживається) І Apple (дефолт rule() лишає непорожній InputItem.Classname='Apple'
    // навіть на producer -- реальний рядок станка так само мав би сировину на вході).
    expect(positions.size).toBe(4)
    const producerPos = positions.get(stationKey('ProcessingRules/r.json', 'producer'))!
    const consumerPos = positions.get(stationKey('ProcessingRules/r.json', 'consumer'))!
    expect(producerPos).toBeDefined()
    expect(consumerPos).toBeDefined()
    expect(consumerPos.x).toBeGreaterThan(producerPos.x)
  })
})
