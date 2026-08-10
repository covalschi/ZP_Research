// Тести мутаторів вікна станка (W2.6 Task 3, TDD ДО коду вікна): createRulesFile /
// createStubRules / deleteRule / linkOutputToStation (src/io/stationEdit.ts). Дисципліна
// та сама, що applyRuleEdit (tests/ruleEdit.test.ts): deep-copy до коміту (оригінал НЕ
// мутується), dirty=true лише на зміненому файлі, ідентичність об'єктів недирти файлів
// зберігається, явні відмови замість вгадування, байт-стабільність канонізації після правки.
//
// СЕМАНТИКА ЗАГОТОВОК (Step 1 брифа, звірено по ZP_ProcessingConfig.c/ZP_Processing.c):
// правило-заготовка пишеться з Enabled=false — дивись великий коментар над createStubRules
// у src/io/stationEdit.ts (цитати рядків там). Тут тести ЗАКРІПЛЮЮТЬ цей вибір:
// заготовка БЕЗ Enabled=false була б УВІМКНЕНИМ правилом із порожніми Outputs, яке сервер
// ПРИЙМАЄ (ValidateRule не перевіряє Outputs.Count()) і ЗАПУСКАЄ (FindStartableCore не має
// гейта на виходи) — станція мовчки з'їдала б сировину, не даючи нічого.

import { describe, test, expect } from 'vitest'
import { parseConfig } from '../src/io/parse'
import { RULES_FILE_SCHEMA } from '../src/model/schema'
import { serialize } from '../src/io/jsonWriter'
import { loadClassIndex } from '../src/model/classIndex'
import type { ClassIndex } from '../src/model/classIndex'
import type { StorageBackend } from '../src/io/backend'
import type { Project, ProjectFile } from '../src/io/project'
import { createRulesFile, createStubRules, deleteRule, linkOutputToStation } from '../src/io/stationEdit'
import { applyRuleEdit } from '../src/io/ruleEdit'
import { buildStationView } from '../src/model/stationView'
import { buildChainGraph } from '../src/model/chainGraph'

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

function rulesJson(rules: Record<string, unknown>[]): string {
  return JSON.stringify({ ConfigVersion: 1, Rules: rules })
}

function rulesFile(path: string, jsonText: string): ProjectFile {
  const { value, warnings } = parseConfig(RULES_FILE_SCHEMA, jsonText)
  return { path, kind: 'rules', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function project(...files: ProjectFile[]): Project {
  return { files, backend: dummyBackend }
}

function docOf(p: Project, path: string): { ConfigVersion: number; Rules: Record<string, unknown>[] } {
  const f = p.files.find((x) => x.path === path)
  if (!f) throw new Error(`тестовий файл не знайдено: ${path}`)
  return f.parsed as { ConfigVersion: number; Rules: Record<string, unknown>[] }
}

// ---- createRulesFile ------------------------------------------------------------------------

describe('createRulesFile: новий файл правил', () => {
  test('створює канонічний порожній документ, dirty=true, kind=rules', () => {
    const p = project()
    const r = createRulesFile(p, 'nova')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.path).toBe('ProcessingRules/nova.json')
    const f = r.project.files.find((x) => x.path === r.path)!
    expect(f.kind).toBe('rules')
    expect(f.dirty).toBe(true)
    expect(f.originalBytes.length).toBe(0)
    expect(f.parsed).toEqual({ ConfigVersion: 1, Rules: [] })
    // Канонічність: serialize -> parse -> serialize стабільний і без попереджень.
    const first = serialize(RULES_FILE_SCHEMA, f.parsed)
    const re = parseConfig(RULES_FILE_SCHEMA, first)
    expect(re.warnings).toEqual([])
    expect(serialize(RULES_FILE_SCHEMA, re.value)).toBe(first)
  })

  test('".json" додається, якщо його не набрано', () => {
    const r = createRulesFile(project(), 'ecolog_chain')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.path).toBe('ProcessingRules/ecolog_chain.json')
  })

  test('".JSON" у будь-якому регістрі не подвоюється', () => {
    const r = createRulesFile(project(), 'Nova.JSON')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.path).toBe('ProcessingRules/Nova.JSON')
  })

  test('відмова: порожнє ім\'я, роздільники шляху, заборонені символи Windows', () => {
    for (const bad of ['', '   ', 'a/b', 'a\\b', 'x<y', 'x>y', 'x:y', 'x"y', 'x|y', 'x?y', 'x*y', '..', 'con', 'COM1']) {
      const r = createRulesFile(project(), bad)
      expect(r.ok, `мало відмовити на '${bad}'`).toBe(false)
    }
  })

  test('відмова: файл із таким шляхом уже є (кейс-інсенситивно)', () => {
    const p = project(rulesFile('ProcessingRules/chain.json', rulesJson([]) ))
    const r = createRulesFile(p, 'CHAIN')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/вже/i)
  })

  test('вставляється у СЕРВЕРНИЙ порядок серед rules-файлів (пріоритет правил = порядок файлів)', () => {
    const a = rulesFile('ProcessingRules/alpha.json', rulesJson([]))
    const z = rulesFile('ProcessingRules/zeta.json', rulesJson([]))
    const p = project(a, z)
    const r = createRulesFile(p, 'micro')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.project.files.map((f) => f.path)).toEqual([
      'ProcessingRules/alpha.json',
      'ProcessingRules/micro.json',
      'ProcessingRules/zeta.json',
    ])
    // Ідентичність недирти файлів збережена.
    expect(r.project.files[0]).toBe(a)
    expect(r.project.files[2]).toBe(z)
  })

  test('оригінальний Project не мутується', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([])))
    const before = p.files.length
    const r = createRulesFile(p, 'b')
    expect(r.ok).toBe(true)
    expect(p.files.length).toBe(before)
  })
})

// ---- createStubRules ------------------------------------------------------------------------

describe('createStubRules: заготовки з масового додавання', () => {
  test('створює по одній заготовці на сировину: Enabled=false, повна канонічна форма', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([])))
    const r = createStubRules(p, 'ZP_SampleFridge', ['Apple', 'Rag'], 'ProcessingRules/a.json')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.createdIds).toEqual(['zp_samplefridge_apple', 'zp_samplefridge_rag'])
    const doc = docOf(r.project, 'ProcessingRules/a.json')
    expect(doc.Rules).toHaveLength(2)
    const stub = doc.Rules[0]
    // Ключова семантика Step 1: заготовка ВИМКНЕНА (інакше сервер запускав би її і з'їдав сировину).
    expect(stub.Enabled).toBe(false)
    expect(stub.Device).toBe('ZP_SampleFridge')
    expect(stub.Mode).toBe('background')
    expect(stub.InputItem).toEqual({ Classname: 'Apple', Quantity: 1, ConsumeInput: true, Content: '' })
    expect(stub.BasePurityMin).toBe(0.5)
    expect(stub.BasePurityMax).toBe(0.5)
    expect(stub.TimeSec).toBe(10)
    expect(stub.Consumables).toEqual([])
    expect(stub.Outputs).toEqual([])
    expect(stub.RequiredNode).toBe('')
    expect(stub.RequiredFactions).toEqual([])
    expect(stub.RequiredWorn).toEqual([])
    expect(stub.RequiredTools).toEqual([])
    expect(stub.Notes).toBe('')
    expect(r.project.files.find((f) => f.path === 'ProcessingRules/a.json')!.dirty).toBe(true)
  })

  test('Enabled=false серіалізується рушійним 0 (bool → 1/0), а не true/false', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([])))
    const r = createStubRules(p, 'ZP_SampleFridge', ['Apple'], 'ProcessingRules/a.json')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const text = serialize(RULES_FILE_SCHEMA, docOf(r.project, 'ProcessingRules/a.json'))
    expect(text).toContain('"Enabled": 0')
    // Ідемпотентність канонізації після мутації.
    const re = parseConfig(RULES_FILE_SCHEMA, text)
    expect(re.warnings).toEqual([])
    expect(serialize(RULES_FILE_SCHEMA, re.value)).toBe(text)
  })

  test('дубль-гейт Id: зайнятий base отримує суфікс _2/_3 (кейс-інсенситивно, по ВСЬОМУ проєкту)', () => {
    const p = project(
      rulesFile('ProcessingRules/a.json', rulesJson([rule('ZP_SampleFridge_Apple')])), // інший регістр — усе одно колізія
      rulesFile('ProcessingRules/b.json', rulesJson([rule('zp_samplefridge_apple_2')])),
    )
    const r = createStubRules(p, 'ZP_SampleFridge', ['Apple'], 'ProcessingRules/b.json')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.createdIds).toEqual(['zp_samplefridge_apple_3'])
  })

  test('унікальність усередині ОДНІЄЇ партії: дублікати сировини схлопуються, а не колізують', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([])))
    const r = createStubRules(p, 'ZP_Microscope', ['Apple', 'apple', 'Rag'], 'ProcessingRules/a.json')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // 'apple' — той самий клас, що 'Apple' (кейс-інсенситивний дедуп у межах партії).
    expect(r.createdIds).toEqual(['zp_microscope_apple', 'zp_microscope_rag'])
  })

  test('суфікс "|1" і спецсимволи класнейму санітизуються в Id, сам InputItem.Classname — як набрано', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([])))
    const r = createStubRules(p, 'ZP_ChemBench', ['Apple|1'], 'ProcessingRules/a.json')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.createdIds).toEqual(['zp_chembench_apple'])
    const doc = docOf(r.project, 'ProcessingRules/a.json')
    expect((doc.Rules[0].InputItem as Record<string, unknown>).Classname).toBe('Apple|1')
  })

  test('НЕ мутує оригінал; недирти файли зберігають ідентичність', () => {
    const a = rulesFile('ProcessingRules/a.json', rulesJson([rule('r1')]))
    const b = rulesFile('ProcessingRules/b.json', rulesJson([]))
    const p = project(a, b)
    const r = createStubRules(p, 'ZP_SampleFridge', ['Rag'], 'ProcessingRules/b.json')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(docOf(p, 'ProcessingRules/b.json').Rules).toHaveLength(0) // оригінал не зачеплено
    expect(r.project.files[0]).toBe(a) // ідентичність недирти файлу
    expect(r.project.files[1]).not.toBe(b)
  })

  test('шлях "новий файл": createRulesFile -> createStubRules працює композицією', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([rule('r1')])))
    const rf = createRulesFile(p, 'fresh')
    expect(rf.ok).toBe(true)
    if (!rf.ok) return
    const rs = createStubRules(rf.project, 'ZP_ServerRack', ['Rag'], rf.path)
    expect(rs.ok).toBe(true)
    if (!rs.ok) return
    expect(docOf(rs.project, 'ProcessingRules/fresh.json').Rules).toHaveLength(1)
  })

  test('відмови: порожній станок, порожній список сировини, відсутній/чужий цільовий файл', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([])))
    expect(createStubRules(p, '', ['Apple'], 'ProcessingRules/a.json').ok).toBe(false)
    expect(createStubRules(p, 'ZP_SampleFridge', [], 'ProcessingRules/a.json').ok).toBe(false)
    expect(createStubRules(p, 'ZP_SampleFridge', ['  ', ''], 'ProcessingRules/a.json').ok).toBe(false)
    expect(createStubRules(p, 'ZP_SampleFridge', ['Apple'], 'ProcessingRules/nope.json').ok).toBe(false)
    const foreign: ProjectFile = { path: 'FactionData/x.json', kind: 'foreign', originalBytes: new Uint8Array(0), warnings: [], dirty: false }
    expect(createStubRules(project(foreign), 'ZP_SampleFridge', ['Apple'], 'FactionData/x.json').ok).toBe(false)
  })
})

// ---- deleteRule -----------------------------------------------------------------------------

describe('deleteRule: видалення рядка станка', () => {
  test('видаляє рівно одне правило, dirty=true, оригінал не мутується', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([rule('r1'), rule('r2')])))
    const r = deleteRule(p, 'ProcessingRules/a.json', 'r1')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const doc = docOf(r.project, 'ProcessingRules/a.json')
    expect(doc.Rules.map((x) => x.Id)).toEqual(['r2'])
    expect(r.project.files[0].dirty).toBe(true)
    expect(docOf(p, 'ProcessingRules/a.json').Rules).toHaveLength(2) // оригінал цілий
  })

  test('дубль Id в одному файлі — явна відмова (не вгадуємо, котрого близнюка видаляти)', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([rule('dup'), rule('dup')])))
    const r = deleteRule(p, 'ProcessingRules/a.json', 'dup')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/дубль/i)
  })

  test('відмови: файл/правило не знайдено', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([rule('r1')])))
    expect(deleteRule(p, 'ProcessingRules/nope.json', 'r1').ok).toBe(false)
    expect(deleteRule(p, 'ProcessingRules/a.json', 'nope').ok).toBe(false)
  })

  test('недирти файли зберігають ідентичність', () => {
    const a = rulesFile('ProcessingRules/a.json', rulesJson([rule('r1')]))
    const b = rulesFile('ProcessingRules/b.json', rulesJson([rule('r2')]))
    const p = project(a, b)
    const r = deleteRule(p, 'ProcessingRules/a.json', 'r1')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.project.files[1]).toBe(b)
  })
})

// ---- linkOutputToStation --------------------------------------------------------------------

describe('linkOutputToStation: «Куди піде результат»', () => {
  const packer = () =>
    rule('pack', {
      Device: 'ZP_SampleFridge',
      Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'chimera_claw' }],
    })

  test('створює вимкнену заготовку-аналізатор із входом = вихід (клас + вміст)', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([packer()])))
    const r = linkOutputToStation(p, idx, 'ProcessingRules/a.json', 'pack', 0, 'ZP_Microscope', 'ProcessingRules/a.json')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.created).toBe(true)
    expect(r.ruleId).toBe('zp_microscope_chimera_claw') // Id з Content (розрізнює потоки одного класу зразка)
    expect(r.filePath).toBe('ProcessingRules/a.json')
    const doc = docOf(r.project, 'ProcessingRules/a.json')
    expect(doc.Rules).toHaveLength(2)
    const analyzer = doc.Rules[1]
    expect(analyzer.Enabled).toBe(false) // та сама Step 1-семантика, що createStubRules
    expect(analyzer.Device).toBe('ZP_Microscope')
    expect(analyzer.InputItem).toEqual({ Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: true, Content: 'chimera_claw' })
    expect(analyzer.Outputs).toEqual([])
  })

  test('вихід БЕЗ Content: Id будується з класнейму виходу', () => {
    const p = project(
      rulesFile('ProcessingRules/a.json', rulesJson([rule('pack2', { Outputs: [{ Classname: 'Rag', Quantity: 1, Chance: 1, Content: '' }] })])),
    )
    const r = linkOutputToStation(p, idx, 'ProcessingRules/a.json', 'pack2', 0, 'ZP_ChemBench', 'ProcessingRules/a.json')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.created).toBe(true)
    expect(r.ruleId).toBe('zp_chembench_rag')
  })

  test('існуючий відповідний аналізатор — created=false, project ТОЙ САМИЙ (без мутації)', () => {
    const analyzer = rule('an', {
      Device: 'ZP_Microscope',
      InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: true, Content: 'CHIMERA_CLAW' }, // інший регістр Content — MatchInput кейс-інсенситивний
      Outputs: [{ Classname: 'ZP_Data_01', Quantity: 1, Chance: 1, Content: '' }],
    })
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([packer(), analyzer])))
    const r = linkOutputToStation(p, idx, 'ProcessingRules/a.json', 'pack', 0, 'ZP_Microscope', 'ProcessingRules/a.json')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.created).toBe(false)
    expect(r.ruleId).toBe('an')
    expect(r.project).toBe(p) // жодної мутації — та сама ідентичність
  })

  test('«відповідність» = matchInputMirror: аналізатор із базовим класом родини теж рахується', () => {
    // Вихід ZP_Sample_03; аналізатор вимагає ZP_Sample_Base (IsKindOf, не дослівний збіг).
    const src = rule('pack3', { Outputs: [{ Classname: 'ZP_Sample_03', Quantity: 1, Chance: 1, Content: 'x' }] })
    const analyzer = rule('an_base', {
      Device: 'ZP_Microscope',
      InputItem: { Classname: 'ZP_Sample_Base', Quantity: 1, ConsumeInput: true, Content: 'x' },
    })
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([src, analyzer])))
    const r = linkOutputToStation(p, idx, 'ProcessingRules/a.json', 'pack3', 0, 'ZP_Microscope', 'ProcessingRules/a.json')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.created).toBe(false)
    expect(r.ruleId).toBe('an_base')
  })

  test('аналізатор на ІНШОМУ станку не рахується — станок звіряється дослівно (ідентичність T1)', () => {
    const analyzer = rule('an_other', {
      Device: 'ZP_LabComputer',
      InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: true, Content: 'chimera_claw' },
    })
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([packer(), analyzer])))
    const r = linkOutputToStation(p, idx, 'ProcessingRules/a.json', 'pack', 0, 'ZP_Microscope', 'ProcessingRules/a.json')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.created).toBe(true) // існуючий на ZP_LabComputer НЕ перехопив призначення на ZP_Microscope
  })

  test('вимкнений відповідний аналізатор ТЕЖ рахується існуючим (не плодимо близнюка заготовки)', () => {
    const stub = rule('an_stub', {
      Enabled: false,
      Device: 'ZP_Microscope',
      InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: true, Content: 'chimera_claw' },
    })
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([packer(), stub])))
    const r = linkOutputToStation(p, idx, 'ProcessingRules/a.json', 'pack', 0, 'ZP_Microscope', 'ProcessingRules/a.json')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.created).toBe(false)
    expect(r.ruleId).toBe('an_stub')
  })

  test('відмови: правило/файл не знайдено, дубль Id джерела, вихід поза межами, порожній клас виходу, порожній станок', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([packer()])))
    expect(linkOutputToStation(p, idx, 'ProcessingRules/nope.json', 'pack', 0, 'ZP_Microscope', 'ProcessingRules/a.json').ok).toBe(false)
    expect(linkOutputToStation(p, idx, 'ProcessingRules/a.json', 'nope', 0, 'ZP_Microscope', 'ProcessingRules/a.json').ok).toBe(false)
    expect(linkOutputToStation(p, idx, 'ProcessingRules/a.json', 'pack', 5, 'ZP_Microscope', 'ProcessingRules/a.json').ok).toBe(false)
    expect(linkOutputToStation(p, idx, 'ProcessingRules/a.json', 'pack', 0, '', 'ProcessingRules/a.json').ok).toBe(false)
    expect(linkOutputToStation(p, idx, 'ProcessingRules/a.json', 'pack', 0, 'ZP_Microscope', 'ProcessingRules/nope.json').ok).toBe(false)

    const dup = project(rulesFile('ProcessingRules/a.json', rulesJson([packer(), packer()])))
    expect(linkOutputToStation(dup, idx, 'ProcessingRules/a.json', 'pack', 0, 'ZP_Microscope', 'ProcessingRules/a.json').ok).toBe(false)

    const empty = project(rulesFile('ProcessingRules/a.json', rulesJson([rule('e', { Outputs: [{ Classname: '', Quantity: 1, Chance: 1, Content: '' }] })])))
    expect(linkOutputToStation(empty, idx, 'ProcessingRules/a.json', 'e', 0, 'ZP_Microscope', 'ProcessingRules/a.json').ok).toBe(false)
  })

  test('створення в ІНШОМУ файлі: лише цільовий файл дирти, джерело не зачеплено', () => {
    const a = rulesFile('ProcessingRules/a.json', rulesJson([packer()]))
    const b = rulesFile('ProcessingRules/b.json', rulesJson([]))
    const p = project(a, b)
    const r = linkOutputToStation(p, idx, 'ProcessingRules/a.json', 'pack', 0, 'ZP_Microscope', 'ProcessingRules/b.json')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.created).toBe(true)
    expect(r.filePath).toBe('ProcessingRules/b.json')
    expect(r.project.files[0]).toBe(a) // джерело — та сама ідентичність, не дирти
    expect(docOf(r.project, 'ProcessingRules/b.json').Rules).toHaveLength(1)
    expect(docOf(r.project, 'ProcessingRules/a.json').Rules).toHaveLength(1)
  })
})

// ---- Наскрізний ланцюг: linkOutputToStation будує ЛАНКУ #2->#3 (W2.6 Task 4) -------------
//
// Усі попередні тести цього файлу зшивали РІВНО перший стик (пакувальник->аналізатор,
// 'pack'->'ZP_Microscope'). Тут -- ДРУГИЙ стик ланцюга (аналізатор->третій станок), доводячи,
// що мутатор не спецкейснуто на "перша ланка": він однаково створює заготовку від будь-якого
// правила-джерела, включно з тим, що само вже є споживачем іншого правила. Другий крок
// (applyRuleEdit -- ТОЙ САМИЙ примітив, яким RuleForm комітить правки з форми) добудовує
// заготовку до робочого правила й доводить: результат -- справжній ЗЧЕПЛЕНИЙ ланцюг (0
// розривів, destinations через усі три станки), а не просто інертний запис у файлі.
describe('linkOutputToStation: будує ланку #2->#3 (не лише перший стик пакувальник->аналізатор)', () => {
  const pack = rule('pack', { Device: 'ZP_SampleFridge', Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'ore' }] })
  const analyze = rule('analyze', {
    Device: 'ZP_Microscope',
    InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: true, Content: 'ore' },
    // Проміжний вихід (не зразок, Content порожній) -- ЩЕ НЕ ЗЧЕПЛЕНИЙ ні з ким: саме цей
    // вихід зараз пов'яжемо linkOutputToStation із третім станком.
    Outputs: [{ Classname: 'ZP_Interm_Ore', Quantity: 1, Chance: 1, Content: '' }],
  })

  test(`linkOutputToStation з ДРУГОГО правила ('analyze') створює заготовку на третьому станку зі входом = ЙОГО вихід`, () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([pack, analyze])))
    const r = linkOutputToStation(p, idx, 'ProcessingRules/a.json', 'analyze', 0, 'ZP_ChemBench', 'ProcessingRules/a.json')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.created).toBe(true)
    expect(r.ruleId).toBe('zp_chembench_zp_interm_ore') // вихід без Content -- Id з класнейму (та сама конвенція, що тест "вихід БЕЗ Content" вище)
    const doc = docOf(r.project, 'ProcessingRules/a.json')
    expect(doc.Rules).toHaveLength(3) // pack, analyze, і НОВА заготовка третього станка
    const stub = doc.Rules[2]
    expect(stub.Device).toBe('ZP_ChemBench')
    expect(stub.Enabled).toBe(false) // Step 1-семантика заготовки, та сама, що й для ланки #1->#2
    expect(stub.InputItem).toEqual({ Classname: 'ZP_Interm_Ore', Quantity: 1, ConsumeInput: true, Content: '' }) // ЯКРАЗ вихід 'analyze', не 'pack'
  })

  test('добудова заготовки (applyRuleEdit, той самий примітив, що RuleForm) завершує ланцюг: 0 розривів, destinations через усі три станки', () => {
    const p0 = project(rulesFile('ProcessingRules/a.json', rulesJson([pack, analyze])))
    const linked = linkOutputToStation(p0, idx, 'ProcessingRules/a.json', 'analyze', 0, 'ZP_ChemBench', 'ProcessingRules/a.json')
    expect(linked.ok).toBe(true)
    if (!linked.ok) return

    // Адмін заповнює заготовку: вмикає й додає вихід-заготовку (ZP_Data_01) -- рівно те,
    // що робить чекбокс "Увімкнено" + "+ Додати вихід" у вбудованій RuleForm.
    const completed = applyRuleEdit(linked.project, linked.filePath, linked.ruleId, (rec) => {
      rec.Enabled = true
      rec.Outputs = [{ Classname: 'ZP_Data_01', Quantity: 1, Chance: 1, Content: '' }]
    })
    expect(completed.ok).toBe(true)
    if (!completed.ok) return

    const graph = buildChainGraph(completed.project, idx)
    expect(graph.breaks).toEqual([]) // ланцюг зчеплений цілком, глухих кутів немає

    const view = buildStationView(completed.project, idx)
    const packRow = view.byClassname.get('zp_samplefridge')!.inputRows[0]
    const analyzeRow = view.byClassname.get('zp_microscope')!.inputRows[0]
    const refineRow = view.byClassname.get('zp_chembench')!.inputRows[0]
    expect(packRow.destinations.map((d) => d.stationClassname)).toEqual(['ZP_Microscope'])
    expect(analyzeRow.destinations.map((d) => d.stationClassname)).toEqual(['ZP_ChemBench']) // ланка #2->#3, побудована linkOutputToStation, тепер жива
    expect(refineRow.destinations).toEqual([]) // кінець ланцюга
  })
})
