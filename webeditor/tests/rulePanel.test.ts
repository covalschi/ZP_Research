// Тести чистих хелперів RulePanel (W2 Task 6): пошук правила за composite-ключем і збір
// опцій ZpSelect (Content/вузли дерева/фракції) з Project. Сам React-компонент (форма,
// ZpSelect, стан фокусу числових полів) перевіряється браузерним смоуком у звіті -- той
// самий поділ, що ChainView.tsx/tests/chainView.test.ts.

import { describe, test, expect } from 'vitest'
import { parseConfig } from '../src/io/parse'
import { RULES_FILE_SCHEMA, TECH_TREE_SCHEMA, FACTIONS_SCHEMA } from '../src/model/schema'
import { loadClassIndex } from '../src/model/classIndex'
import type { ClassIndex } from '../src/model/classIndex'
import type { StorageBackend } from '../src/io/backend'
import type { Project, ProjectFile } from '../src/io/project'
import type { ProducedStream } from '../src/model/stationView'
import {
  findRuleMatches,
  collectContentOptions,
  collectNodeOptions,
  collectFactionOptions,
  resolveAnalyzerInputMode,
  collectProducedStreamOptions,
  encodeStreamOptionId,
  decodeStreamOptionId,
} from '../src/ui/RulePanel'

const idx: ClassIndex = loadClassIndex()

const dummyBackend: StorageBackend = {
  kind: 'zip',
  list: async () => [],
  read: async () => new Uint8Array(0),
  write: async () => {},
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

function parsedFile(path: string, kind: ProjectFile['kind'], schema: Parameters<typeof parseConfig>[0], jsonText: string): ProjectFile {
  const { value, warnings } = parseConfig(schema, jsonText)
  return { path, kind, originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function rulesFile(path: string, rules: Record<string, unknown>[]): ProjectFile {
  return parsedFile(path, 'rules', RULES_FILE_SCHEMA, JSON.stringify({ ConfigVersion: 1, Rules: rules }))
}

function project(...files: ProjectFile[]): Project {
  return { files, backend: dummyBackend }
}

// ---- findRuleMatches -----------------------------------------------------------------------

describe('findRuleMatches', () => {
  test('одне співпадіння за composite (filePath, ruleId)', () => {
    const p = project(rulesFile('ProcessingRules/a.json', [rule('r1'), rule('r2')]))
    const matches = findRuleMatches(p, 'ProcessingRules/a.json', 'r1')
    expect(matches).toHaveLength(1)
    expect(matches[0].Id).toBe('r1')
  })

  test('дублікат Id в ОДНОМУ файлі -- обидва повертаються (панель сама вирішує, що робити)', () => {
    const p = project(rulesFile('ProcessingRules/a.json', [rule('dup'), rule('dup')]))
    expect(findRuleMatches(p, 'ProcessingRules/a.json', 'dup')).toHaveLength(2)
  })

  test('той самий Id в ІНШОМУ файлі -- не бере участі (composite-ключ, не bare ruleId)', () => {
    const p = project(rulesFile('ProcessingRules/a.json', [rule('dup')]), rulesFile('ProcessingRules/b.json', [rule('dup')]))
    expect(findRuleMatches(p, 'ProcessingRules/a.json', 'dup')).toHaveLength(1)
  })

  test('файл не rules (foreign) -- порожньо, без падіння', () => {
    const foreign: ProjectFile = { path: 'FactionData/x.json', kind: 'foreign', originalBytes: new Uint8Array(0), warnings: [], dirty: false }
    expect(findRuleMatches(project(foreign), 'FactionData/x.json', 'anything')).toEqual([])
  })

  test('файл не знайдено -- порожньо', () => {
    expect(findRuleMatches(project(), 'nope.json', 'r1')).toEqual([])
  })
})

// ---- collectContentOptions ------------------------------------------------------------------

describe('collectContentOptions: первинні (виробляються) перед вторинними', () => {
  test('Content з Outputs УВІМКНЕНОГО правила -- у первинних', () => {
    const p = project(
      rulesFile('ProcessingRules/a.json', [
        rule('producer', { Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'chimera_claw' }] }),
      ]),
    )
    const opts = collectContentOptions(p, idx)
    expect(opts.map((o) => o.id)).toContain('chimera_claw')
    expect(opts[0].id).toBe('chimera_claw') // єдиний produced -- перший
  })

  test('Content ЛИШЕ з ВИМКНЕНОГО правила -- НЕ у первинних, але присутній як вторинний', () => {
    const p = project(
      rulesFile('ProcessingRules/a.json', [
        rule('producer', { Enabled: false, Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'orphan' }] }),
        rule('consumer', { InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: true, Content: 'unrelated' } }),
      ]),
    )
    const opts = collectContentOptions(p, idx)
    const orphan = opts.find((o) => o.id === 'orphan')
    expect(orphan).toBeDefined()
    expect(orphan?.hint).toMatch(/не виробляється/)
    // Produced (з увімкненого 'consumer'.InputItem.Content НЕ рахується як produced --
    // produced рахується лише з Outputs) -- 'unrelated' теж вторинний.
    const unrelated = opts.find((o) => o.id === 'unrelated')
    expect(unrelated?.hint).toMatch(/не виробляється/)
  })

  test('порожні Content ігноруються (не з\'являються в опціях)', () => {
    const p = project(rulesFile('ProcessingRules/a.json', [rule('r1')])) // Content скрізь ''
    expect(collectContentOptions(p, idx)).toEqual([])
  })

  test('Content, що дорівнює реальному класнейму з індексу -- отримує hint мод-джерела (не "не виробляється")', () => {
    // Типовий випадок АВТО-похідних значень (директива власника): Content == InputItem.Classname.
    const knownClass = idx.classes[0][0]
    const p = project(
      rulesFile('ProcessingRules/a.json', [
        rule('producer', { InputItem: { Classname: knownClass, Quantity: 1, ConsumeInput: true, Content: '' }, Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: knownClass }] }),
      ]),
    )
    const opts = collectContentOptions(p, idx)
    const hit = opts.find((o) => o.id === knownClass)
    expect(hit).toBeDefined()
    expect(hit?.hint).not.toMatch(/не виробляється/)
  })

  // W2.6 Task 4 (хвіст W2): matchInputMirror/сервер порівнюють Content без урахування
  // регістру (ZP_ProcessingConfig.c:166-169) -- пара "Paper"/"paper" функціонально ОДНЕ й
  // те саме, тож "paper", згаданий деінде (тут -- у Content ІНШОГО правила), НЕ повинен
  // з'являтись окремим "вторинним" записом із хибним хінтом "не виробляється" -- він уже
  // покритий "Paper" у первинних. ДО фіксу (точний Set): "paper" з'являвся б САМЕ так --
  // окремим вторинним записом попри те, що функціонально це та сама сировина.
  test('кейс-неспівпадаючий Content: "Paper" (вихід) покриває "paper" (згадка деінде) -- останній НЕ стає окремим хибним "не виробляється"', () => {
    const p = project(
      rulesFile('ProcessingRules/a.json', [
        rule('producer', { Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'Paper' }] }),
        rule('consumer', { InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: true, Content: 'paper' } }),
      ]),
    )
    const opts = collectContentOptions(p, idx)
    // 'Paper' -- у первинних, без хибної тривоги.
    const upperHit = opts.find((o) => o.id === 'Paper')
    expect(upperHit).toBeDefined()
    expect(upperHit?.hint).not.toMatch(/не виробляється/)
    // 'paper' (інший регістр ТОГО САМОГО Content) НЕ фігурує окремим записом узагалі --
    // ні первинним (він не з Outputs), ні (головне для цього тесту) вторинним із хибним
    // "не виробляється": кейс-інсенситивний produced.has(...) вже покрив його в фільтрі.
    expect(opts.find((o) => o.id === 'paper')).toBeUndefined()
  })

  test('produced дедуплікується кейс-інсенситивно: два увімкнені виходи з різним регістром -- один запис, перший побачений регістр', () => {
    const p = project(
      rulesFile('ProcessingRules/a.json', [
        rule('producer1', { Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'Stone' }] }),
        rule('producer2', { Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'STONE' }] }),
      ]),
    )
    const opts = collectContentOptions(p, idx)
    // Обидва увімкнені виходи несуть той самий кейс-інсенситивний Content -- лише ОДИН
    // запис у первинних (produced -- Map за lower-key, перший побачений регістр виграє),
    // а не два "primary"-дубля "Stone"/"STONE".
    const hits = opts.filter((o) => o.id.toLowerCase() === 'stone')
    expect(hits).toHaveLength(1)
    expect(hits[0].id).toBe('Stone') // 'producer1' -- перший у файлі, його регістр виграє
  })

  test('ItemCost.Content дерева потрапляє у вторинні (дерево нічого не виробляє)', () => {
    const techTreeJson = JSON.stringify({
      ConfigVersion: 1,
      Branch: { Id: 'b1', Name: 'Branch', Icon: '', SortOrder: 0, Factions: [] },
      Nodes: [
        {
          Id: 'n1',
          Name: 'Node',
          Description: '',
          Icon: '',
          Tier: 1,
          Parents: [],
          ParentsMode: 'all',
          Cost: [],
          ItemCost: [{ Classname: 'ZP_Data_01', Quantity: 1, Content: 'tree_material' }],
          ResearchTimeSec: 0,
          RequiredFactions: [],
        },
      ],
    })
    const p = project(parsedFile('TechTree/b1.json', 'techTree', TECH_TREE_SCHEMA, techTreeJson))
    const opts = collectContentOptions(p, idx)
    expect(opts.map((o) => o.id)).toContain('tree_material')
  })
})

// ---- collectNodeOptions ---------------------------------------------------------------------

describe('collectNodeOptions', () => {
  test('label = Name (якщо є), hint = Id', () => {
    const techTreeJson = JSON.stringify({
      ConfigVersion: 1,
      Branch: { Id: 'b1', Name: 'Branch', Icon: '', SortOrder: 0, Factions: [] },
      Nodes: [
        { Id: 'node_a', Name: 'Мутагенні сполуки', Description: '', Icon: '', Tier: 1, Parents: [], ParentsMode: 'all', Cost: [], ItemCost: [], ResearchTimeSec: 0, RequiredFactions: [] },
      ],
    })
    const p = project(parsedFile('TechTree/b1.json', 'techTree', TECH_TREE_SCHEMA, techTreeJson))
    const opts = collectNodeOptions(p)
    expect(opts).toEqual([{ id: 'node_a', label: 'Мутагенні сполуки', hint: 'node_a' }])
  })

  test('вузол без Name -- label фолбечиться на Id', () => {
    const techTreeJson = JSON.stringify({
      ConfigVersion: 1,
      Branch: { Id: 'b1', Name: 'Branch', Icon: '', SortOrder: 0, Factions: [] },
      Nodes: [{ Id: 'node_b', Name: '', Description: '', Icon: '', Tier: 1, Parents: [], ParentsMode: 'all', Cost: [], ItemCost: [], ResearchTimeSec: 0, RequiredFactions: [] }],
    })
    const p = project(parsedFile('TechTree/b1.json', 'techTree', TECH_TREE_SCHEMA, techTreeJson))
    expect(collectNodeOptions(p)[0].label).toBe('node_b')
  })

  test('декілька файлів TechTree -- вузли з усіх зібрані разом', () => {
    const mkTree = (nodeId: string) =>
      JSON.stringify({
        ConfigVersion: 1,
        Branch: { Id: nodeId, Name: 'Branch', Icon: '', SortOrder: 0, Factions: [] },
        Nodes: [{ Id: nodeId, Name: nodeId, Description: '', Icon: '', Tier: 1, Parents: [], ParentsMode: 'all', Cost: [], ItemCost: [], ResearchTimeSec: 0, RequiredFactions: [] }],
      })
    const p = project(
      parsedFile('TechTree/a.json', 'techTree', TECH_TREE_SCHEMA, mkTree('n1')),
      parsedFile('TechTree/b.json', 'techTree', TECH_TREE_SCHEMA, mkTree('n2')),
    )
    expect(collectNodeOptions(p).map((o) => o.id).sort()).toEqual(['n1', 'n2'])
  })
})

// ---- collectFactionOptions -------------------------------------------------------------------

describe('collectFactionOptions', () => {
  test('label = DisplayName, hint = Id', () => {
    const factionsJson = JSON.stringify({
      ConfigVersion: 1,
      Factions: [{ Id: 'ecolog', DisplayName: 'Вчені', Supertype: '', Armbands: [], TerminalClasses: [], DeviceClasses: [] }],
    })
    const p = project(parsedFile('Factions.json', 'factions', FACTIONS_SCHEMA, factionsJson))
    expect(collectFactionOptions(p)).toEqual([{ id: 'ecolog', label: 'Вчені', hint: 'ecolog' }])
  })

  test('немає Factions.json у проєкті -- порожньо, без падіння', () => {
    expect(collectFactionOptions(project())).toEqual([])
  })
})

// ---- resolveAnalyzerInputMode (W2.6 Task 4) --------------------------------------------------
// Тристанний гейт: override !== null перемагає ЗАВЖДИ (в БУДЬ-ЯКИЙ бік), інакше --
// структурне isSampleClass (родина ZP_Sample_Base). Чиста функція без React -- саме той
// "pure helper", який бриф явно просить покрити тестами окремо від компонента.

const SAMPLE_CLASS = 'ZP_Sample' // родина ZP_Sample_Base, той самий клас, що й в OPTIONS producer-тестів вище
const RAW_CLASS = 'Apple' // звичайний предмет, НЕ родина ZP_Sample_Base

describe('resolveAnalyzerInputMode', () => {
  test('override=null, класнейм родини ZP_Sample_Base -- true (структурний аналізатор)', () => {
    expect(resolveAnalyzerInputMode(SAMPLE_CLASS, idx, null)).toBe(true)
  })

  test('override=null, звичайний класнейм -- false (звичайний переробник)', () => {
    expect(resolveAnalyzerInputMode(RAW_CLASS, idx, null)).toBe(false)
  })

  test('override=null, порожній класнейм (щойно створене правило) -- false', () => {
    expect(resolveAnalyzerInputMode('', idx, null)).toBe(false)
  })

  test('override=true перемагає звичайний класнейм -- адмін явно просить режим потоку для НЕ-зразкового рядка', () => {
    expect(resolveAnalyzerInputMode(RAW_CLASS, idx, true)).toBe(true)
  })

  test('override=false перемагає ЗРАЗКОВИЙ класнейм -- вихід з "глухого кута" (немає іншого шляху повернутись до вільного вводу)', () => {
    expect(resolveAnalyzerInputMode(SAMPLE_CLASS, idx, false)).toBe(false)
  })

  test('override=false на звичайному класнеймі -- лишається false (узгоджено з дефолтом)', () => {
    expect(resolveAnalyzerInputMode(RAW_CLASS, idx, false)).toBe(false)
  })
})

// ---- encodeStreamOptionId / decodeStreamOptionId (W2.6 Task 4) -------------------------------

describe('encodeStreamOptionId / decodeStreamOptionId', () => {
  test('раундтрип: decode(encode(cls, content)) повертає ту саму пару', () => {
    expect(decodeStreamOptionId(encodeStreamOptionId('ZP_Sample_03', 'chimera_claw'))).toEqual({
      classname: 'ZP_Sample_03',
      content: 'chimera_claw',
    })
  })

  test('раундтрип із порожнім Content (клас без мітки)', () => {
    expect(decodeStreamOptionId(encodeStreamOptionId('ZP_Data_01', ''))).toEqual({ classname: 'ZP_Data_01', content: '' })
  })

  test('id без роздільника (сторонній value) -- фолбек: увесь рядок як classname, content порожній', () => {
    expect(decodeStreamOptionId('щось-стороннє')).toEqual({ classname: 'щось-стороннє', content: '' })
  })
})

// ---- collectProducedStreamOptions (W2.6 Task 4) -----------------------------------------------

describe('collectProducedStreamOptions', () => {
  test('порожній список потоків -- порожні опції', () => {
    expect(collectProducedStreamOptions([])).toEqual([])
  })

  test('label -- ігрове імʼя (+ Content у дужках), hint -- моно класнейм·вміст, id -- раундтрипний', () => {
    const streams: ProducedStream[] = [{ classname: 'ZP_Sample_03', content: 'chimera_claw', display: 'Аномальний зразок' }]
    const opts = collectProducedStreamOptions(streams)
    expect(opts).toHaveLength(1)
    expect(opts[0].label).toBe('Аномальний зразок (chimera_claw)')
    expect(opts[0].hint).toBe('ZP_Sample_03 · chimera_claw')
    expect(decodeStreamOptionId(opts[0].id)).toEqual({ classname: 'ZP_Sample_03', content: 'chimera_claw' })
  })

  test('потік без Content -- label без дужок, hint -- сам класнейм', () => {
    const streams: ProducedStream[] = [{ classname: 'ZP_Sample', content: '', display: 'ZP_Sample' }]
    const opts = collectProducedStreamOptions(streams)
    expect(opts[0].label).toBe('ZP_Sample')
    expect(opts[0].hint).toBe('ZP_Sample')
  })

  test('декілька потоків -- порядок вхідного масиву зберігається (сортування -- турбота викликача/producedStreams)', () => {
    const streams: ProducedStream[] = [
      { classname: 'ZP_Sample_01', content: 'a', display: 'A' },
      { classname: 'ZP_Sample_02', content: 'b', display: 'B' },
    ]
    expect(collectProducedStreamOptions(streams).map((o) => o.label)).toEqual(['A (a)', 'B (b)'])
  })
})
