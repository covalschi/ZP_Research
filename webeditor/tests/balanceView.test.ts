// Тести чистої моделі вкладки «Баланс» (W4 Task 5, ui/balanceView.ts) — TDD-вперед: цей
// файл написаний ПЕРЕД реалізацією.
//
// Вкладка read-only, тож ціна помилки тут — не зіпсований конфіг, а ХИБНА ПОРАДА адміну:
// «цей тип балів фракція добуває» там, де в грі вона не добуває нічого. Тому кожне
// твердження моделі дзеркалить конкретний серверний шлях, і кожне дзеркало має свій тест:
//   - ZP_DataItemsConfig.Find (:52-69)      — вимкнений запис для сервера НЕ ІСНУЄ;
//   - ZP_DataItemsConfig.CountGrantable (:144-153) — Amount<=0 і невідомий тип НЕ нараховуються;
//   - ZP_PointTypesConfig.Find (:317-325)   — тип балів шукається ТОЧНИМ ==, без ToLower;
//   - ZP_ConfigService.DevicesFor/IsDeviceFor (:1566-1588) — «свої прилади», інакше жодних;
//   - ZP_ConfigService.TerminalsFor (:1553-1561) — без свого терміналу здати нема куди;
//   - ZP_Processing.FindStartableCore (:126-143) — Enabled + MatchClass(Device) + RequiredFactions;
//   - ZP_TechTree.NodeBelongsTo (:92-104)   — гілка фракції + RequiredFactions вузла.

import { describe, test, expect } from 'vitest'
import { parseConfig } from '../src/io/parse'
import {
  RULES_FILE_SCHEMA,
  TECH_TREE_SCHEMA,
  POINT_TYPES_SCHEMA,
  FACTIONS_SCHEMA,
  DATA_ITEMS_SCHEMA,
  SETTINGS_SCHEMA,
} from '../src/model/schema'
import { loadClassIndex } from '../src/model/classIndex'
import type { ClassIndex } from '../src/model/classIndex'
import type { StorageBackend } from '../src/io/backend'
import type { Project, ProjectFile } from '../src/io/project'
import { buildBalanceView } from '../src/ui/balanceView'

const idx: ClassIndex = loadClassIndex()

const dummyBackend: StorageBackend = {
  kind: 'zip',
  list: async () => [],
  read: async () => new Uint8Array(0),
  write: async () => {},
}

function project(...files: ProjectFile[]): Project {
  return { files, backend: dummyBackend }
}

function rulesFile(path: string, rules: Record<string, unknown>[]): ProjectFile {
  const { value, warnings } = parseConfig(RULES_FILE_SCHEMA, JSON.stringify({ ConfigVersion: 1, Rules: rules }))
  return { path, kind: 'rules', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function techTreeFile(path: string, branchId: string, nodes: Record<string, unknown>[], branchOverride: Record<string, unknown> = {}): ProjectFile {
  const jsonText = JSON.stringify({
    ConfigVersion: 1,
    Branch: { Id: branchId, Name: branchId, Icon: '', SortOrder: 1, Factions: [], ...branchOverride },
    Nodes: nodes,
  })
  const { value, warnings } = parseConfig(TECH_TREE_SCHEMA, jsonText)
  return { path, kind: 'techTree', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function pointTypesFile(pointTypes: Record<string, unknown>[]): ProjectFile {
  const jsonText = JSON.stringify({ ConfigVersion: 1, PointTypes: pointTypes, Categories: [], Kinds: [] })
  const { value, warnings } = parseConfig(POINT_TYPES_SCHEMA, jsonText)
  return { path: 'PointTypes.json', kind: 'pointTypes', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function factionsFile(factions: Record<string, unknown>[]): ProjectFile {
  const jsonText = JSON.stringify({ ConfigVersion: 1, Factions: factions })
  const { value, warnings } = parseConfig(FACTIONS_SCHEMA, jsonText)
  return { path: 'Factions.json', kind: 'factions', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function dataItemsFile(items: Record<string, unknown>[]): ProjectFile {
  const { value, warnings } = parseConfig(DATA_ITEMS_SCHEMA, JSON.stringify({ ConfigVersion: 1, Items: items }))
  return { path: 'DataItems.json', kind: 'dataItems', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function settingsFile(override: Record<string, unknown> = {}): ProjectFile {
  const doc = {
    ConfigVersion: 1,
    DebugMode: false,
    AdminIds: [],
    DefaultFaction: 'default',
    TreeVisibilityDepth: 2,
    TreeTerminalClasses: [],
    TreeBackgroundImage: '',
    EnergyRadiusM: 15,
    ...override,
  }
  const { value, warnings } = parseConfig(SETTINGS_SCHEMA, JSON.stringify(doc))
  return { path: 'Settings.json', kind: 'settings', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

// ---- Мінімальні записи з УСІМА ключами схеми (той самий підхід, що stationView.test.ts) ----

function rule(id: string, override: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Id: id,
    Enabled: true,
    Device: 'ZP_Microscope',
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

function output(classname: string, content = ''): Record<string, unknown> {
  return { Classname: classname, Quantity: 1, Chance: 1, Content: content }
}

function node(id: string, override: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Id: id,
    Name: `Вузол ${id}`,
    Description: '',
    Icon: '',
    Tier: 1,
    Parents: [],
    ParentsMode: 'all',
    Cost: [],
    ItemCost: [],
    ResearchTimeSec: 0,
    RequiredFactions: [],
    ...override,
  }
}

function pointType(id: string, override: Record<string, unknown> = {}): Record<string, unknown> {
  return { Id: id, Name: id, Icon: '', Color: '#7CB342', SortOrder: 0, Category: 'bio', Kind: 'field', Tier: 1, ...override }
}

function faction(id: string, override: Record<string, unknown> = {}): Record<string, unknown> {
  return { Id: id, DisplayName: id, Supertype: '', Armbands: [], TerminalClasses: [], DeviceClasses: [], ...override }
}

function dataItem(id: string, points: { Type: string; Amount: number }[], override: Record<string, unknown> = {}): Record<string, unknown> {
  return { Id: id, Enabled: true, Name: `Назва ${id}`, Description: '', Points: points, ...override }
}

function costRowOf(view: ReturnType<typeof buildBalanceView>, factionId: string, type: string) {
  const f = view.factions.find((x) => x.id === factionId)
  return f?.costs.find((c) => c.pointType === type)
}

// ============================================================================================
// Секція (а): матриця «що скільки дає»
// ============================================================================================

describe('матриця заготовки × типи балів', () => {
  test('порожній проєкт — жодного рядка, жодної колонки, без падіння', () => {
    const view = buildBalanceView(project(), idx)
    expect(view.matrix.rows).toEqual([])
    expect(view.matrix.columns).toEqual([])
    expect(view.chains).toEqual([])
    expect(view.factions).toEqual([])
  })

  test('колонки — ЛИШЕ типи, які хтось дає, у порядку SortOrder', () => {
    const view = buildBalanceView(
      project(
        pointTypesFile([
          pointType('bio_field_t1', { SortOrder: 1, Name: 'Біо-полe 1' }),
          pointType('bio_lab_t3', { SortOrder: 6 }),
          pointType('combat_field_t1', { SortOrder: 19, Color: '#C62828' }),
        ]),
        dataItemsFile([
          dataItem('ZP_Data_31', [{ Type: 'combat_field_t1', Amount: 5 }]),
          dataItem('ZP_Data_01', [{ Type: 'bio_field_t1', Amount: 3 }]),
        ]),
      ),
      idx,
    )
    expect(view.matrix.columns.map((c) => c.id)).toEqual(['bio_field_t1', 'combat_field_t1'])
    expect(view.matrix.columns[0].name).toBe('Біо-полe 1')
    expect(view.matrix.columns[1].color).toBe('#C62828')
    // Тип, якого не дає ніхто — окремим переліком (не мертвою колонкою)
    expect(view.matrix.idle.map((c) => c.id)).toEqual(['bio_lab_t3'])
  })

  test('клітинка = Amount; підсумок колонки рахує лише увімкнені записи', () => {
    const view = buildBalanceView(
      project(
        pointTypesFile([pointType('bio_field_t1', { SortOrder: 1 })]),
        dataItemsFile([
          dataItem('ZP_Data_01', [{ Type: 'bio_field_t1', Amount: 5 }]),
          dataItem('ZP_Data_02', [{ Type: 'bio_field_t1', Amount: 7 }], { Enabled: false }),
        ]),
      ),
      idx,
    )
    const r1 = view.matrix.rows.find((r) => r.classname === 'ZP_Data_01')!
    const r2 = view.matrix.rows.find((r) => r.classname === 'ZP_Data_02')!
    expect(r1.cells.get('bio_field_t1')).toEqual({ amount: 5, grantable: true })
    expect(r2.cells.get('bio_field_t1')).toEqual({ amount: 7, grantable: false })
    expect(r2.enabled).toBe(false)
    expect(r2.tone).toBe('warn')
    expect(r2.notes.join(' ')).toContain('вимкнен')
    expect(view.matrix.totals.get('bio_field_t1')).toBe(5)
  })

  test('Amount<=0 — сервер НЕ нарахує (CountGrantable), рядок жовтий', () => {
    const view = buildBalanceView(
      project(pointTypesFile([pointType('bio_field_t1')]), dataItemsFile([dataItem('ZP_Data_01', [{ Type: 'bio_field_t1', Amount: 0 }])])),
      idx,
    )
    const row = view.matrix.rows[0]
    expect(row.cells.get('bio_field_t1')).toEqual({ amount: 0, grantable: false })
    expect(row.tone).toBe('warn')
    expect(view.matrix.totals.get('bio_field_t1')).toBe(0)
  })

  test('невідомий тип (точний ==) — окрема колонка «невідомі», тон аварійний', () => {
    const view = buildBalanceView(
      project(
        pointTypesFile([pointType('bio_field_t1')]),
        dataItemsFile([dataItem('ZP_Data_01', [{ Type: 'BIO_FIELD_T1', Amount: 4 }])]),
      ),
      idx,
    )
    const row = view.matrix.rows[0]
    // ZP_PointTypesConfig.Find регістрозалежний — 'BIO_FIELD_T1' для сервера НЕ ІСНУЄ
    expect(row.unknown).toEqual([{ type: 'BIO_FIELD_T1', amount: 4 }])
    expect(row.cells.size).toBe(0)
    expect(row.tone).toBe('alarm')
    expect(view.matrix.hasUnknown).toBe(true)
    expect(view.matrix.columns).toEqual([])
  })

  test('два записи Points того самого типу — суми складаються (сервер нараховує обидва)', () => {
    const view = buildBalanceView(
      project(
        pointTypesFile([pointType('bio_field_t1')]),
        dataItemsFile([
          dataItem('ZP_Data_01', [
            { Type: 'bio_field_t1', Amount: 2 },
            { Type: 'bio_field_t1', Amount: 3 },
          ]),
        ]),
      ),
      idx,
    )
    expect(view.matrix.rows[0].cells.get('bio_field_t1')!.amount).toBe(5)
  })

  test('дубль Id — виживає ОСТАННІЙ запис (last-wins), рядок один і аварійний', () => {
    const view = buildBalanceView(
      project(
        pointTypesFile([pointType('bio_field_t1')]),
        dataItemsFile([dataItem('ZP_Data_01', [{ Type: 'bio_field_t1', Amount: 1 }]), dataItem('zp_data_01', [{ Type: 'bio_field_t1', Amount: 9 }])]),
      ),
      idx,
    )
    expect(view.matrix.rows.length).toBe(1)
    expect(view.matrix.rows[0].cells.get('bio_field_t1')!.amount).toBe(9)
    expect(view.matrix.rows[0].duplicate).toBe(true)
    expect(view.matrix.rows[0].tone).toBe('alarm')
  })

  test('запис із порожнім Id не дає рядка — лише примітка рівня документа', () => {
    const view = buildBalanceView(project(pointTypesFile([pointType('bio_field_t1')]), dataItemsFile([dataItem('', [{ Type: 'bio_field_t1', Amount: 1 }])])), idx)
    expect(view.matrix.rows).toEqual([])
    expect(view.notes.join(' ')).toContain('без Id')
  })
})

// ============================================================================================
// Секція (б): ланцюги до заготовок
// ============================================================================================

describe('ланцюги до заготовок', () => {
  const pt = pointTypesFile([pointType('bio_field_t1')])

  test('виробник знайдений: правило-аналізатор із приладом і входом', () => {
    const view = buildBalanceView(
      project(
        pt,
        dataItemsFile([dataItem('ZP_Data_01', [{ Type: 'bio_field_t1', Amount: 5 }])]),
        rulesFile('ProcessingRules/a.json', [
          rule('analiz', { Device: 'ZP_Microscope', InputItem: { Classname: 'ZP_Sample_01', Quantity: 1, ConsumeInput: true, Content: 'apple' }, Outputs: [output('ZP_Data_01')] }),
        ]),
      ),
      idx,
    )
    const row = view.chains.find((c) => c.classname === 'ZP_Data_01')!
    expect(row.producers.length).toBe(1)
    expect(row.producers[0].ruleId).toBe('analiz')
    expect(row.producers[0].device).toBe('ZP_Microscope')
    expect(row.producers[0].inputClassname).toBe('ZP_Sample_01')
    expect(row.producers[0].inputContent).toBe('apple')
    expect(row.producers[0].disabled).toBe(false)
    expect(row.tone).toBe('ok')
  })

  test('заготовка без виробника — «ніхто не виробляє» (не розрив ланцюга, а факт економіки)', () => {
    const view = buildBalanceView(project(pt, dataItemsFile([dataItem('ZP_Data_77', [{ Type: 'bio_field_t1', Amount: 4 }])])), idx)
    const row = view.chains.find((c) => c.classname === 'ZP_Data_77')!
    expect(row.producers).toEqual([])
    expect(row.tone).toBe('warn')
  })

  test('вимкнене правило лишається виробником, але позначеним', () => {
    const view = buildBalanceView(
      project(
        pt,
        dataItemsFile([dataItem('ZP_Data_01', [{ Type: 'bio_field_t1', Amount: 5 }])]),
        rulesFile('ProcessingRules/a.json', [rule('vymk', { Enabled: false, Outputs: [output('ZP_Data_01')] })]),
      ),
      idx,
    )
    const row = view.chains.find((c) => c.classname === 'ZP_Data_01')!
    expect(row.producers.length).toBe(1)
    expect(row.producers[0].disabled).toBe(true)
    // усі виробники вимкнені — у грі заготовки не буде
    expect(row.tone).toBe('warn')
  })

  test('вироблена, але НЕ налаштована заготовка — окремий рядок із configured=false', () => {
    const view = buildBalanceView(
      project(pt, dataItemsFile([]), rulesFile('ProcessingRules/a.json', [rule('r', { Outputs: [output('ZP_Data_05')] })])),
      idx,
    )
    const row = view.chains.find((c) => c.classname === 'ZP_Data_05')!
    expect(row.configured).toBe(false)
    expect(row.producers.length).toBe(1)
    expect(row.tone).toBe('alarm')
  })

  test('вихід із суфіксом |1 усе одно впізнається як та сама заготовка', () => {
    const view = buildBalanceView(
      project(
        pt,
        dataItemsFile([dataItem('ZP_Data_01', [{ Type: 'bio_field_t1', Amount: 5 }])]),
        rulesFile('ProcessingRules/a.json', [rule('r', { Outputs: [output('ZP_Data_01|1')] })]),
      ),
      idx,
    )
    expect(view.chains.find((c) => c.classname === 'ZP_Data_01')!.producers.length).toBe(1)
  })
})

// ============================================================================================
// Секція (в): вартість дерева проти видобутку
// ============================================================================================

describe('вартість дерева проти видобутку', () => {
  const pt = pointTypesFile([pointType('bio_field_t1', { SortOrder: 1 }), pointType('bio_lab_t3', { SortOrder: 6 })])
  const items = dataItemsFile([dataItem('ZP_Data_01', [{ Type: 'bio_field_t1', Amount: 5 }])])

  // Мікроскоп належить лише «eco» — «свої прилади» (DevicesFor), решта фракцій його не має.
  const factions = factionsFile([
    faction('eco', { DisplayName: 'Вчені', TerminalClasses: ['ZP_LabComputer'], DeviceClasses: ['ZP_Microscope'] }),
    faction('sky', { DisplayName: 'Небо', TerminalClasses: ['ZP_ChemBench'], DeviceClasses: ['ZP_ChemBench'] }),
  ])
  const rules = rulesFile('ProcessingRules/a.json', [rule('analiz', { Device: 'ZP_Microscope', Outputs: [output('ZP_Data_01')] })])

  test('сума вартостей гілки по типах + перелік гілок фракції', () => {
    const tree = techTreeFile(
      'TechTree/nauka.json',
      'nauka',
      [
        node('a', { Cost: [{ Type: 'bio_field_t1', Amount: 5 }] }),
        node('b', { Cost: [{ Type: 'bio_field_t1', Amount: 8 }, { Type: 'bio_lab_t3', Amount: 2 }] }),
      ],
      { Factions: ['eco'], Name: 'Наука' },
    )
    const view = buildBalanceView(project(pt, items, factions, rules, tree), idx)
    const eco = view.factions.find((f) => f.id === 'eco')!
    expect(eco.branches.map((b) => b.branchId)).toEqual(['nauka'])
    expect(eco.nodeCount).toBe(2)
    expect(costRowOf(view, 'eco', 'bio_field_t1')!.total).toBe(13)
    expect(costRowOf(view, 'eco', 'bio_field_t1')!.nodeCount).toBe(2)
    // Поіменний перелік вузлів — адреса переходу на полотно дерева
    expect(costRowOf(view, 'eco', 'bio_field_t1')!.nodes.map((n) => n.nodeId)).toEqual(['a', 'b'])
    expect(costRowOf(view, 'eco', 'bio_field_t1')!.nodes[1].amount).toBe(8)
    expect(costRowOf(view, 'eco', 'bio_field_t1')!.nodes[0].filePath).toBe('TechTree/nauka.json')
    expect(costRowOf(view, 'eco', 'bio_lab_t3')!.total).toBe(2)
    // Чужа гілка до «sky» не потрапляє
    expect(view.factions.find((f) => f.id === 'sky')!.costs).toEqual([])
  })

  test('ГОЛОВНЕ: тип, який дерево вимагає, а фракція не добуває — статус «дірка»', () => {
    const tree = techTreeFile('TechTree/nauka.json', 'nauka', [node('a', { Cost: [{ Type: 'bio_field_t1', Amount: 5 }, { Type: 'bio_lab_t3', Amount: 4 }] })], { Factions: ['eco'] })
    const view = buildBalanceView(project(pt, items, factions, rules, tree), idx)
    const ok = costRowOf(view, 'eco', 'bio_field_t1')!
    const hole = costRowOf(view, 'eco', 'bio_lab_t3')!
    expect(ok.status).toBe('ok')
    expect(ok.paths.length).toBe(1)
    expect(ok.paths[0].ruleId).toBe('analiz')
    expect(ok.paths[0].dataItem).toBe('ZP_Data_01')
    expect(hole.status).toBe('missing')
    expect(hole.paths).toEqual([])
    expect(view.factions.find((f) => f.id === 'eco')!.tone).toBe('alarm')
  })

  test('чужий прилад — правило фракції недоступне (дзеркало IsDeviceFor)', () => {
    const tree = techTreeFile('TechTree/nebo.json', 'nebo', [node('n', { Cost: [{ Type: 'bio_field_t1', Amount: 5 }] })], { Factions: ['sky'] })
    const view = buildBalanceView(project(pt, items, factions, rules, tree), idx)
    const row = costRowOf(view, 'sky', 'bio_field_t1')!
    expect(row.status).toBe('missing')
    expect(view.factions.find((f) => f.id === 'sky')!.deviceMode).toBe('own')
  })

  test('RequiredFactions правила відсіює чужу фракцію навіть на своєму приладі', () => {
    const shared = factionsFile([
      faction('eco', { TerminalClasses: ['ZP_LabComputer'], DeviceClasses: ['ZP_Microscope'] }),
      faction('sky', { TerminalClasses: ['ZP_ChemBench'], DeviceClasses: ['ZP_Microscope'] }),
    ])
    const gated = rulesFile('ProcessingRules/a.json', [rule('analiz', { Device: 'ZP_Microscope', RequiredFactions: ['eco'], Outputs: [output('ZP_Data_01')] })])
    const tree = techTreeFile('TechTree/t.json', 't', [node('n', { Cost: [{ Type: 'bio_field_t1', Amount: 5 }] })], { Factions: [] })
    const view = buildBalanceView(project(pt, items, shared, gated, tree), idx)
    expect(costRowOf(view, 'eco', 'bio_field_t1')!.status).toBe('ok')
    expect(costRowOf(view, 'sky', 'bio_field_t1')!.status).toBe('missing')
  })

  test('гілка без Factions належить УСІМ (дзеркало NodeBelongsTo), RequiredFactions вузла звужує', () => {
    const tree = techTreeFile(
      'TechTree/t.json',
      't',
      [node('spilnyi', { Cost: [{ Type: 'bio_field_t1', Amount: 5 }] }), node('lyshe_eco', { Cost: [{ Type: 'bio_lab_t3', Amount: 1 }], RequiredFactions: ['eco'] })],
      { Factions: [] },
    )
    const view = buildBalanceView(project(pt, items, factions, rules, tree), idx)
    expect(view.factions.find((f) => f.id === 'eco')!.nodeCount).toBe(2)
    expect(view.factions.find((f) => f.id === 'sky')!.nodeCount).toBe(1)
    expect(costRowOf(view, 'sky', 'bio_lab_t3')).toBeUndefined()
  })

  test('гейт вузлом (RequiredNode) — видобуток є, але умовний', () => {
    const gated = rulesFile('ProcessingRules/a.json', [rule('analiz', { Device: 'ZP_Microscope', RequiredNode: 'osnovy', Outputs: [output('ZP_Data_01')] })])
    const tree = techTreeFile('TechTree/t.json', 't', [node('osnovy', { Cost: [{ Type: 'bio_field_t1', Amount: 5 }] })], { Factions: ['eco'] })
    const view = buildBalanceView(project(pt, items, factions, gated, tree), idx)
    const row = costRowOf(view, 'eco', 'bio_field_t1')!
    expect(row.status).toBe('gated')
    expect(row.paths[0].requiredNode).toBe('osnovy')
    expect(row.reasons.join(' ')).toContain('osnovy')
  })

  test('вхід-зразок, якого фракція сама не пакує — видобуток умовний (gated)', () => {
    const chainRules = rulesFile('ProcessingRules/a.json', [
      // пакувальник живе на ЧУЖОМУ приладі (ZP_ChemBench належить «sky»)
      rule('pak', { Device: 'ZP_ChemBench', InputItem: { Classname: 'Apple', Quantity: 1, ConsumeInput: true, Content: '' }, Outputs: [output('ZP_Sample_01', 'apple')] }),
      rule('analiz', { Device: 'ZP_Microscope', InputItem: { Classname: 'ZP_Sample_01', Quantity: 1, ConsumeInput: true, Content: 'apple' }, Outputs: [output('ZP_Data_01')] }),
    ])
    const tree = techTreeFile('TechTree/t.json', 't', [node('n', { Cost: [{ Type: 'bio_field_t1', Amount: 5 }] })], { Factions: ['eco'] })
    const view = buildBalanceView(project(pt, items, factions, chainRules, tree), idx)
    const row = costRowOf(view, 'eco', 'bio_field_t1')!
    expect(row.status).toBe('gated')
    expect(row.paths[0].chainInput).toBe(true)
    expect(row.paths[0].selfFed).toBe(false)
  })

  test('той самий ланцюг цілком на своїх приладах — статус «ok», selfFed=true', () => {
    const ownFactions = factionsFile([faction('eco', { TerminalClasses: ['ZP_LabComputer'], DeviceClasses: ['ZP_Microscope', 'ZP_SampleFridge'] })])
    const chainRules = rulesFile('ProcessingRules/a.json', [
      rule('pak', { Device: 'ZP_SampleFridge', Outputs: [output('ZP_Sample_01', 'apple')] }),
      rule('analiz', { Device: 'ZP_Microscope', InputItem: { Classname: 'ZP_Sample_01', Quantity: 1, ConsumeInput: true, Content: 'apple' }, Outputs: [output('ZP_Data_01')] }),
    ])
    const tree = techTreeFile('TechTree/t.json', 't', [node('n', { Cost: [{ Type: 'bio_field_t1', Amount: 5 }] })], { Factions: ['eco'] })
    const view = buildBalanceView(project(pt, items, ownFactions, chainRules, tree), idx)
    const row = costRowOf(view, 'eco', 'bio_field_t1')!
    expect(row.status).toBe('ok')
    expect(row.paths[0].selfFed).toBe(true)
  })

  test('без власного терміналу здати нема куди — увесь видобуток фракції марний', () => {
    const noTerm = factionsFile([
      faction('eco', { TerminalClasses: ['ZP_LabComputer'], DeviceClasses: ['ZP_Microscope'] }),
      faction('bez', { TerminalClasses: [], DeviceClasses: ['ZP_Microscope'] }),
    ])
    const tree = techTreeFile('TechTree/t.json', 't', [node('n', { Cost: [{ Type: 'bio_field_t1', Amount: 5 }] })], { Factions: ['bez'] })
    const view = buildBalanceView(project(pt, items, noTerm, rules, tree), idx)
    const bez = view.factions.find((f) => f.id === 'bez')!
    expect(bez.depositMode).toBe('none')
    expect(bez.tone).toBe('alarm')
    const row = costRowOf(view, 'bez', 'bio_field_t1')!
    expect(row.status).toBe('missing')
    expect(row.reasons.join(' ')).toContain('термінал')
  })

  test('поділу приладів немає взагалі — прилади доступні всім (DevicesFor -> null)', () => {
    const bare = factionsFile([faction('eco', { TerminalClasses: ['ZP_LabComputer'] }), faction('sky', { TerminalClasses: ['ZP_ChemBench'] })])
    const tree = techTreeFile('TechTree/t.json', 't', [node('n', { Cost: [{ Type: 'bio_field_t1', Amount: 5 }] })], { Factions: [] })
    const view = buildBalanceView(project(pt, items, bare, rules, tree), idx)
    expect(view.factions.find((f) => f.id === 'eco')!.deviceMode).toBe('all')
    expect(costRowOf(view, 'eco', 'bio_field_t1')!.status).toBe('ok')
    expect(costRowOf(view, 'sky', 'bio_field_t1')!.status).toBe('ok')
  })

  test('фракція без власних приладів, коли поділ уже почався — жодного видобутку', () => {
    const split = factionsFile([faction('eco', { TerminalClasses: ['ZP_LabComputer'], DeviceClasses: ['ZP_Microscope'] }), faction('nihto', { TerminalClasses: ['ZP_ServerRack'] })])
    const tree = techTreeFile('TechTree/t.json', 't', [node('n', { Cost: [{ Type: 'bio_field_t1', Amount: 5 }] })], { Factions: ['nihto'] })
    const view = buildBalanceView(project(pt, items, split, rules, tree), idx)
    expect(view.factions.find((f) => f.id === 'nihto')!.deviceMode).toBe('none')
    expect(costRowOf(view, 'nihto', 'bio_field_t1')!.status).toBe('missing')
  })

  test('надлишок: фракція добуває тип, якого її дерево не вимагає', () => {
    const tree = techTreeFile('TechTree/t.json', 't', [node('n', { Cost: [{ Type: 'bio_lab_t3', Amount: 4 }] })], { Factions: ['eco'] })
    const view = buildBalanceView(project(pt, items, factions, rules, tree), idx)
    const eco = view.factions.find((f) => f.id === 'eco')!
    expect(eco.surplus.map((s) => s.pointType)).toEqual(['bio_field_t1'])
    expect(eco.surplus[0].paths.length).toBe(1)
  })

  test('вимкнена заготовка не дає видобутку (сервер її не бачить: Find пропускає !Enabled)', () => {
    const off = dataItemsFile([dataItem('ZP_Data_01', [{ Type: 'bio_field_t1', Amount: 5 }], { Enabled: false })])
    const tree = techTreeFile('TechTree/t.json', 't', [node('n', { Cost: [{ Type: 'bio_field_t1', Amount: 5 }] })], { Factions: ['eco'] })
    const view = buildBalanceView(project(pt, off, factions, rules, tree), idx)
    expect(costRowOf(view, 'eco', 'bio_field_t1')!.status).toBe('missing')
  })

  test('вимкнене правило не дає видобутку (FindStartableCore перевіряє Enabled першим)', () => {
    const off = rulesFile('ProcessingRules/a.json', [rule('analiz', { Enabled: false, Device: 'ZP_Microscope', Outputs: [output('ZP_Data_01')] })])
    const tree = techTreeFile('TechTree/t.json', 't', [node('n', { Cost: [{ Type: 'bio_field_t1', Amount: 5 }] })], { Factions: ['eco'] })
    const view = buildBalanceView(project(pt, items, factions, off, tree), idx)
    expect(costRowOf(view, 'eco', 'bio_field_t1')!.status).toBe('missing')
  })

  test('невідомий тип у Cost — сервер відхиляє ВЕСЬ вузол, тож вартості немає взагалі', () => {
    // ValidateNode :168-170 відкидає вузол із невідомим типом балів (skip-шлях AddFileNodes
    // :145-150) — його вартості на сервері не існує, і зводити її означало б брехати про
    // ціну дерева. Вузол рахується як skippedNodes, причину показує вкладка «Дерево».
    const tree = techTreeFile('TechTree/t.json', 't', [node('n', { Cost: [{ Type: 'nema_takogo', Amount: 5 }] })], { Factions: ['eco'] })
    const view = buildBalanceView(project(pt, items, factions, rules, tree), idx)
    expect(costRowOf(view, 'eco', 'nema_takogo')).toBeUndefined()
    const eco = view.factions.find((f) => f.id === 'eco')!
    expect(eco.skippedNodes).toBe(1)
    expect(eco.nodeCount).toBe(0)
    expect(eco.notes.join(' ')).toContain('не завантажить')
  })

  test('вузол, який сервер не завантажить, у суму не входить і рахується окремо', () => {
    // ParentsMode='кривий' -> ValidateNode відхиляє вузол (skip), його вартості на сервері немає
    const tree = techTreeFile(
      'TechTree/t.json',
      't',
      [node('good', { Cost: [{ Type: 'bio_field_t1', Amount: 5 }] }), node('bad', { ParentsMode: 'хибний', Cost: [{ Type: 'bio_field_t1', Amount: 100 }] })],
      { Factions: ['eco'] },
    )
    const view = buildBalanceView(project(pt, items, factions, rules, tree), idx)
    const eco = view.factions.find((f) => f.id === 'eco')!
    expect(costRowOf(view, 'eco', 'bio_field_t1')!.total).toBe(5)
    expect(eco.skippedNodes).toBe(1)
    expect(eco.nodeCount).toBe(1)
  })

  test('ItemCost вузлів зведений окремо (це предмети, не бали)', () => {
    const tree = techTreeFile(
      'TechTree/t.json',
      't',
      [
        node('a', { ItemCost: [{ Classname: 'Paper', Quantity: 2, Content: '' }] }),
        node('b', { ItemCost: [{ Classname: 'Paper', Quantity: 3, Content: '' }] }),
      ],
      { Factions: ['eco'] },
    )
    const view = buildBalanceView(project(pt, items, factions, rules, tree), idx)
    const eco = view.factions.find((f) => f.id === 'eco')!
    expect(eco.itemCosts.length).toBe(1)
    expect(eco.itemCosts[0].classname).toBe('Paper')
    expect(eco.itemCosts[0].quantity).toBe(5)
    expect(eco.itemCosts[0].nodeCount).toBe(2)
  })

  test('гілка адресована фракції, якої немає в Factions.json — примітка проєкту', () => {
    const tree = techTreeFile('TechTree/t.json', 't', [node('n')], { Factions: ['prybultsi'] })
    const view = buildBalanceView(project(pt, items, factions, rules, tree), idx)
    expect(view.notes.join(' ')).toContain('prybultsi')
  })

  test('спільні термінали з Settings, поки НІХТО не оголосив своїх', () => {
    const bare = factionsFile([faction('eco'), faction('sky')])
    const tree = techTreeFile('TechTree/t.json', 't', [node('n', { Cost: [{ Type: 'bio_field_t1', Amount: 5 }] })], { Factions: [] })
    const view = buildBalanceView(project(pt, items, bare, rules, tree, settingsFile({ TreeTerminalClasses: ['ZP_LabComputer'] })), idx)
    const eco = view.factions.find((f) => f.id === 'eco')!
    expect(eco.depositMode).toBe('shared')
    expect(costRowOf(view, 'eco', 'bio_field_t1')!.status).toBe('ok')
  })
})

// ============================================================================================
// ФІКС-РАУНД РЕВʼЮ, Critical 1: сервер відкидає БІЛЬШЕ, ніж Enabled/Device/RequiredFactions
//
// Правило, яке не пройшло ValidateRule (ZP_ProcessingConfig.c:262-350), у Rules НЕ
// потрапляє взагалі (AddFileRules :249-254 — Warn+continue), а запис DataItems, який не
// пройшов ValidateItem, руйнівний Validate ВИДАЛЯЄ з масиву (:105-137), тож Find його не
// знайде і CanDeposit поверне false. До фікс-раунду обидві родини помилок давали зелене
// «видобувається»: джерело правил (buildChainGraph) тримає ВСІ правила з Id за задумом
// (це граф полотна), а гейт видобутку дивився лише на Enabled/Device/RequiredFactions.
//
// Кожен тест нижче ДИСКРИМІНУЄ: на коді до фікс-раунду він падав би (status був 'ok').
// Вимога ревʼю: мертвого виробника НЕ ХОВАТИ — рядок ланцюга мусить показати ЧОМУ виходу
// не буде, інакше адмін бачить порожнечу без пояснення.
// ============================================================================================

describe('фікс-раунд: сервер відкидає правило — видобутку немає, виробник видимий', () => {
  const pt = pointTypesFile([pointType('bio_field_t1', { SortOrder: 1 })])
  const items = dataItemsFile([dataItem('ZP_Data_01', [{ Type: 'bio_field_t1', Amount: 5 }])])
  const factions = factionsFile([faction('eco', { TerminalClasses: ['ZP_LabComputer'], DeviceClasses: ['ZP_Microscope'] })])
  const tree = techTreeFile('TechTree/t.json', 't', [node('n', { Cost: [{ Type: 'bio_field_t1', Amount: 5 }] })], { Factions: ['eco'] })

  function viewWith(override: Record<string, unknown>) {
    const rules = rulesFile('ProcessingRules/a.json', [rule('analiz', { Device: 'ZP_Microscope', Outputs: [output('ZP_Data_01')], ...override })])
    return buildBalanceView(project(pt, items, factions, rules, tree), idx)
  }

  function expectDead(view: ReturnType<typeof buildBalanceView>, needle: string) {
    const cost = costRowOf(view, 'eco', 'bio_field_t1')!
    expect(cost.status).toBe('missing')
    expect(cost.paths).toEqual([])
    // причина видима саме в рядку вартості, а не лише десь у ланцюгах
    expect(cost.reasons.join(' ')).toContain(needle)
    const chain = view.chains.find((c) => c.classname === 'ZP_Data_01')!
    // виробник ЛИШАЄТЬСЯ в переліку (не ховаємо), але позначений мертвим із причиною
    expect(chain.producers.length).toBe(1)
    expect(chain.producers[0].dead).toBe(true)
    expect(chain.producers[0].deadReasons.join(' ')).toContain(needle)
    expect(chain.tone).toBe('alarm')
  }

  test("Mode='action' — сервер відхиляє правило (ValidateRule :267-270)", () => {
    expectDead(viewWith({ Mode: 'action' }), 'Mode')
  })

  test('TimeSec менший за MIN_TIME_SEC=5 — сервер відхиляє правило (:271-272)', () => {
    expectDead(viewWith({ TimeSec: 0 }), 'TimeSec')
  })

  test('пайп у Outputs[].Classname — ClassExists без StripExact (:326), правило відхилене', () => {
    expectDead(viewWith({ Outputs: [output('ZP_Data_01|1')] }), 'Output')
  })

  test('ConsumeInput=false у background — сервер відхиляє правило (:347-348)', () => {
    expectDead(viewWith({ InputItem: { Classname: 'Apple', Quantity: 1, ConsumeInput: false, Content: '' } }), 'ConsumeInput')
  })

  test('BasePurityMax=0 — завантажувач ставить 0.5 ДО валідації (AddFileRules :232-237), правило ЖИВЕ', () => {
    // Дзеркало мусить повторювати САМЕ порядок завантажувача: спершу тиха заміна нуля,
    // потім ValidateRule. Наївний гейт «просто прогнати validateRule» дав би тут хибну
    // тривогу (BasePurityMax < BasePurityMin) на правилі, яке сервер приймає.
    const view = viewWith({ BasePurityMin: 0.5, BasePurityMax: 0 })
    expect(costRowOf(view, 'eco', 'bio_field_t1')!.status).toBe('ok')
    expect(view.chains.find((c) => c.classname === 'ZP_Data_01')!.producers[0].dead).toBe(false)
  })

  test('заготовка без Name — сервер ВИКИДАЄ запис: ні балів у підсумку, ні видобутку', () => {
    const noName = dataItemsFile([dataItem('ZP_Data_01', [{ Type: 'bio_field_t1', Amount: 5 }], { Name: '' })])
    const rules = rulesFile('ProcessingRules/a.json', [rule('analiz', { Device: 'ZP_Microscope', Outputs: [output('ZP_Data_01')] })])
    const view = buildBalanceView(project(pt, noName, factions, rules, tree), idx)
    const row = view.matrix.rows[0]
    expect(row.tone).toBe('alarm')
    expect(row.notes.join(' ')).toContain('Name')
    // матриця не сміє рахувати суму по запису, якого на сервері не буде
    expect(row.cells.get('bio_field_t1')!.grantable).toBe(false)
    expect(view.matrix.totals.get('bio_field_t1')).toBe(0)
    expect(costRowOf(view, 'eco', 'bio_field_t1')!.status).toBe('missing')
    expect(costRowOf(view, 'eco', 'bio_field_t1')!.reasons.join(' ')).toContain('ZP_Data_01')
    expect(view.chains.find((c) => c.classname === 'ZP_Data_01')!.tone).toBe('alarm')
  })

  test('запис не родини ZP_Data_Base — той самий зріз (ValidateItem :86-87)', () => {
    const alien = dataItemsFile([dataItem('Apple', [{ Type: 'bio_field_t1', Amount: 5 }])])
    const view = buildBalanceView(project(pt, alien, factions, rulesFile('ProcessingRules/a.json', []), tree), idx)
    const row = view.matrix.rows[0]
    expect(row.tone).toBe('alarm')
    expect(row.cells.get('bio_field_t1')!.grantable).toBe(false)
    expect(view.matrix.totals.get('bio_field_t1')).toBe(0)
  })

  test('вимкнене правило — не «мертве», а свідомо вимкнене (окремий бейдж, тон warn)', () => {
    const view = viewWith({ Enabled: false })
    const chain = view.chains.find((c) => c.classname === 'ZP_Data_01')!
    expect(chain.producers[0].dead).toBe(false)
    expect(chain.producers[0].disabled).toBe(true)
    expect(chain.tone).toBe('warn')
    expect(costRowOf(view, 'eco', 'bio_field_t1')!.reasons.join(' ')).toContain('вимкнен')
  })
})

// ============================================================================================
// ФІКС-РАУНД РЕВʼЮ, Important 2: гейт постачання ТРАНЗИТИВНИЙ
// ============================================================================================

describe('фікс-раунд: транзитивність гейта постачання зразка', () => {
  const pt = pointTypesFile([pointType('bio_field_t1', { SortOrder: 1 })])
  const items = dataItemsFile([dataItem('ZP_Data_01', [{ Type: 'bio_field_t1', Amount: 5 }])])
  const own = factionsFile([faction('eco', { TerminalClasses: ['ZP_LabComputer'], DeviceClasses: ['ZP_Microscope', 'ZP_SampleFridge'] })])
  const tree = techTreeFile('TechTree/t.json', 't', [node('n', { Cost: [{ Type: 'bio_field_t1', Amount: 5 }] })], { Factions: ['eco'] })
  const analyzerInput = { Classname: 'ZP_Sample_01', Quantity: 1, ConsumeInput: true, Content: 'apple' }

  test('пакувальник під гейтом вузла — аналізатор БЕЗ власного гейта теж лише «умовно»', () => {
    const chain = rulesFile('ProcessingRules/a.json', [
      rule('pak', { Device: 'ZP_SampleFridge', RequiredNode: 'n1', Outputs: [output('ZP_Sample_01', 'apple')] }),
      rule('analiz', { Device: 'ZP_Microscope', InputItem: analyzerInput, Outputs: [output('ZP_Data_01')] }),
    ])
    const view = buildBalanceView(project(pt, items, own, chain, tree), idx)
    const row = costRowOf(view, 'eco', 'bio_field_t1')!
    expect(row.status).toBe('gated')
    expect(row.paths[0].requiredNode).toBe('')
    expect(row.paths[0].selfFed).toBe(true)
    // гейт приїхав ПО ЛАНЦЮГУ, від пакувальника
    expect(row.paths[0].feedGates).toEqual(['n1'])
    expect(row.reasons.join(' ')).toContain('n1')
  })

  test('пакувальник, який годується сам собою по колу — ланцюга немає (не зациклюємось)', () => {
    const loop = rulesFile('ProcessingRules/a.json', [
      rule('petlya', { Device: 'ZP_SampleFridge', InputItem: analyzerInput, Outputs: [output('ZP_Sample_01', 'apple')] }),
      rule('analiz', { Device: 'ZP_Microscope', InputItem: analyzerInput, Outputs: [output('ZP_Data_01')] }),
    ])
    const view = buildBalanceView(project(pt, items, own, loop, tree), idx)
    const row = costRowOf(view, 'eco', 'bio_field_t1')!
    expect(row.status).toBe('gated')
    expect(row.paths[0].selfFed).toBe(false)
  })

  // N4 (контрольне ревʼю фікс-раунду): транзитивність дивилась лише на InputItem, а
  // FindStartableCore вимагає ще й витратники в карго — витратник-зразок, якого ніхто не
  // пакує, зупиняє правило так само. Дискримінує стару поведінку (та давала 'ok').
  test('витратник-зразок, якого ніхто не пакує — видобутку немає (N4)', () => {
    const chain = rulesFile('ProcessingRules/a.json', [
      rule('analiz', {
        Device: 'ZP_Microscope',
        InputItem: { Classname: 'Apple', Quantity: 1, ConsumeInput: true, Content: '' },
        Consumables: [{ Classname: 'ZP_Sample_03', Quantity: 1, Content: '' }],
        Outputs: [output('ZP_Data_01')],
      }),
    ])
    const view = buildBalanceView(project(pt, items, own, chain, tree), idx)
    const row = costRowOf(view, 'eco', 'bio_field_t1')!
    expect(row.status).toBe('gated')
    expect(row.paths[0].selfFed).toBe(false)
  })

  test('витратник-зразок під гейтом свого пакувальника — гейт їде на споживача (N4)', () => {
    const chain = rulesFile('ProcessingRules/a.json', [
      rule('pak', { Device: 'ZP_SampleFridge', RequiredNode: 'n1', Outputs: [output('ZP_Sample_03', 'apple')] }),
      rule('analiz', {
        Device: 'ZP_Microscope',
        InputItem: { Classname: 'Apple', Quantity: 1, ConsumeInput: true, Content: '' },
        Consumables: [{ Classname: 'ZP_Sample_03', Quantity: 1, Content: 'apple' }],
        Outputs: [output('ZP_Data_01')],
      }),
    ])
    const view = buildBalanceView(project(pt, items, own, chain, tree), idx)
    const row = costRowOf(view, 'eco', 'bio_field_t1')!
    expect(row.status).toBe('gated')
    expect(row.paths[0].feedGates).toEqual(['n1'])
  })

  test('не-зразковий витратник (сировина світу) видобутку НЕ блокує', () => {
    const chain = rulesFile('ProcessingRules/a.json', [
      rule('analiz', {
        Device: 'ZP_Microscope',
        InputItem: { Classname: 'Apple', Quantity: 1, ConsumeInput: true, Content: '' },
        Consumables: [{ Classname: 'Rag', Quantity: 1, Content: '' }],
        Outputs: [output('ZP_Data_01')],
      }),
    ])
    const view = buildBalanceView(project(pt, items, own, chain, tree), idx)
    expect(costRowOf(view, 'eco', 'bio_field_t1')!.status).toBe('ok')
  })

  test('вільний пакувальник поруч із гейтованим — переможе вільний ланцюг', () => {
    const both = rulesFile('ProcessingRules/a.json', [
      rule('pak_gated', { Device: 'ZP_SampleFridge', RequiredNode: 'n1', Outputs: [output('ZP_Sample_01', 'apple')] }),
      rule('pak_free', { Device: 'ZP_SampleFridge', InputItem: { Classname: 'Pear', Quantity: 1, ConsumeInput: true, Content: '' }, Outputs: [output('ZP_Sample_01', 'apple')] }),
      rule('analiz', { Device: 'ZP_Microscope', InputItem: analyzerInput, Outputs: [output('ZP_Data_01')] }),
    ])
    const view = buildBalanceView(project(pt, items, own, both, tree), idx)
    const row = costRowOf(view, 'eco', 'bio_field_t1')!
    expect(row.status).toBe('ok')
    expect(row.paths[0].feedGates).toEqual([])
  })
})

// ============================================================================================
// ФІКС-РАУНД РЕВʼЮ, Important 3 + minor 6
// ============================================================================================

describe('фікс-раунд: надлишок і мертві колонки', () => {
  const pt = pointTypesFile([pointType('bio_field_t1', { SortOrder: 1 }), pointType('bio_lab_t3', { SortOrder: 6 })])
  const items = dataItemsFile([dataItem('ZP_Data_01', [{ Type: 'bio_field_t1', Amount: 5 }])])
  const rules = rulesFile('ProcessingRules/a.json', [rule('analiz', { Device: 'ZP_Microscope', Outputs: [output('ZP_Data_01')] })])

  test('фракція без терміналу: надлишок позначений «здати нема куди» (Important 3)', () => {
    const noTerm = factionsFile([
      faction('eco', { TerminalClasses: ['ZP_LabComputer'], DeviceClasses: ['ZP_Microscope'] }),
      faction('bez', { TerminalClasses: [], DeviceClasses: ['ZP_Microscope'] }),
    ])
    const tree = techTreeFile('TechTree/t.json', 't', [node('n', { Cost: [{ Type: 'bio_lab_t3', Amount: 4 }] })], { Factions: ['bez'] })
    const view = buildBalanceView(project(pt, items, noTerm, rules, tree), idx)
    const bez = view.factions.find((f) => f.id === 'bez')!
    // рядок вартості цієї ж фракції каже «здавати нема куди» — надлишок не сміє це заперечувати
    expect(costRowOf(view, 'bez', 'bio_lab_t3')!.status).toBe('missing')
    expect(bez.surplus.map((s) => s.pointType)).toEqual(['bio_field_t1'])
    expect(bez.surplus[0].canDeposit).toBe(false)
    expect(view.factions.find((f) => f.id === 'eco')!.surplus[0].canDeposit).toBe(true)
  })

  test('тип, який дає лише ВИМКНЕНА заготовка — колонка з мертвою клітинкою, а не «не дає ніхто» (minor 6)', () => {
    const off = dataItemsFile([dataItem('ZP_Data_01', [{ Type: 'bio_field_t1', Amount: 5 }], { Enabled: false })])
    const view = buildBalanceView(project(pt, off), idx)
    expect(view.matrix.columns.map((c) => c.id)).toEqual(['bio_field_t1'])
    expect(view.matrix.totals.get('bio_field_t1')).toBe(0)
    // один факт в ОДНОМУ регістрі: тип уже видно колонкою, у переліку «не дає ніхто» його немає
    expect(view.matrix.idle.map((c) => c.id)).toEqual(['bio_lab_t3'])
  })
})
