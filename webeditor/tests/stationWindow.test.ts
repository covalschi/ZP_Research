// Тести чистих хелперів вікна станка (W2.6 Task 3, ui/StationWindow.tsx). Сам React-
// компонент (розворот рядка, чіпи, друге натискання видалення) перевіряється браузерним
// смоуком зі скріншотами -- той самий поділ, що ChainView/RulePanel.

import { describe, test, expect } from 'vitest'
import { parseConfig } from '../src/io/parse'
import { RULES_FILE_SCHEMA, FACTIONS_SCHEMA } from '../src/model/schema'
import { loadClassIndex } from '../src/model/classIndex'
import type { ClassIndex } from '../src/model/classIndex'
import type { StorageBackend } from '../src/io/backend'
import type { Project, ProjectFile } from '../src/io/project'
import { buildStationView } from '../src/model/stationView'
import {
  collectRulesFileOptions,
  collectPlannedDestinations,
  defaultTargetFileFor,
  linkTargetFileFor,
  resolveLinkTargetFile,
  pluralizeRows,
} from '../src/ui/StationWindow'

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

function rulesFile(path: string, rules: Record<string, unknown>[]): ProjectFile {
  const { value, warnings } = parseConfig(RULES_FILE_SCHEMA, JSON.stringify({ ConfigVersion: 1, Rules: rules }))
  return { path, kind: 'rules', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function factionsFile(deviceClasses: string[]): ProjectFile {
  const doc = { ConfigVersion: 1, Factions: [{ Id: 'eco', DisplayName: 'Eco', Supertype: '', Armbands: [], TerminalClasses: [], DeviceClasses: deviceClasses }] }
  const { value, warnings } = parseConfig(FACTIONS_SCHEMA, JSON.stringify(doc))
  return { path: 'Factions.json', kind: 'factions', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function project(...files: ProjectFile[]): Project {
  return { files, backend: dummyBackend }
}

const packer = (id = 'pack', enabled = true) =>
  rule(id, { Enabled: enabled, Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'chimera_claw' }] })

describe('collectRulesFileOptions', () => {
  test('лише rules-файли, у порядку project.files (порядок = пріоритет)', () => {
    const p = project(factionsFile([]), rulesFile('ProcessingRules/a.json', []), rulesFile('ProcessingRules/b.json', []))
    expect(collectRulesFileOptions(p).map((o) => o.id)).toEqual(['ProcessingRules/a.json', 'ProcessingRules/b.json'])
  })
})

describe('collectPlannedDestinations', () => {
  test('ВИМКНЕНИЙ аналізатор-заготовка видимий як запланований (увімкнений уже в destinations і не дублюється)', () => {
    const analyzerStub = rule('an_stub', {
      Enabled: false,
      Device: 'ZP_Microscope',
      InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: true, Content: 'chimera_claw' },
    })
    const p = project(rulesFile('ProcessingRules/a.json', [packer(), analyzerStub]))
    const view = buildStationView(p, idx)
    const row = view.byClassname.get('zp_samplefridge')!.inputRows[0]
    expect(row.destinations).toEqual([]) // T1: вимкнений споживач не рахується живим призначенням
    const planned = collectPlannedDestinations(p, idx, row)
    expect(planned.map((d) => d.stationClassname)).toEqual(['ZP_Microscope'])
  })

  test('увімкнений споживач НЕ потрапляє в planned (він уже в row.destinations)', () => {
    const analyzer = rule('an', {
      Device: 'ZP_Microscope',
      InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: true, Content: 'chimera_claw' },
    })
    const p = project(rulesFile('ProcessingRules/a.json', [packer(), analyzer]))
    const view = buildStationView(p, idx)
    const row = view.byClassname.get('zp_samplefridge')!.inputRows[0]
    expect(row.destinations.map((d) => d.stationClassname)).toEqual(['ZP_Microscope'])
    expect(collectPlannedDestinations(p, idx, row)).toEqual([])
  })

  test('ВИМКНЕНЕ джерело (заготовка): planned показує УСІХ споживачів, і увімкнених теж', () => {
    const analyzer = rule('an', {
      Device: 'ZP_Microscope',
      InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: true, Content: 'chimera_claw' },
    })
    const p = project(rulesFile('ProcessingRules/a.json', [packer('pack', false), analyzer]))
    const view = buildStationView(p, idx)
    const row = view.byClassname.get('zp_samplefridge')!.inputRows[0]
    expect(row.disabled).toBe(true)
    expect(row.destinations).toEqual([]) // T1: вимкнене джерело не має живих призначень
    const planned = collectPlannedDestinations(p, idx, row)
    expect(planned.map((d) => d.stationClassname)).toEqual(['ZP_Microscope'])
  })

  test('без збігу вмісту — нічого не заплановано', () => {
    const analyzerOther = rule('an_other', {
      Enabled: false,
      Device: 'ZP_Microscope',
      InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: true, Content: 'bloodsucker_gland' },
    })
    const p = project(rulesFile('ProcessingRules/a.json', [packer(), analyzerOther]))
    const view = buildStationView(p, idx)
    const row = view.byClassname.get('zp_samplefridge')!.inputRows[0]
    expect(collectPlannedDestinations(p, idx, row)).toEqual([])
  })
})

describe('defaultTargetFileFor / linkTargetFileFor', () => {
  test('станок із рядками: файл його першого рядка', () => {
    const p = project(rulesFile('ProcessingRules/a.json', [packer()]), rulesFile('ProcessingRules/b.json', []))
    const view = buildStationView(p, idx)
    expect(defaultTargetFileFor(view, p, 'ZP_SampleFridge')).toBe('ProcessingRules/a.json')
  })

  test('станок БЕЗ рядків (лише DeviceClasses): перший rules-файл проєкту', () => {
    const p = project(factionsFile(['ZP_ChemBench']), rulesFile('ProcessingRules/a.json', []))
    const view = buildStationView(p, idx)
    expect(view.byClassname.has('zp_chembench')).toBe(true) // вікно ЗОБОВ'ЯЗАНЕ листити такий станок
    expect(defaultTargetFileFor(view, p, 'ZP_ChemBench')).toBe('ProcessingRules/a.json')
  })

  test('немає файлів правил узагалі — undefined (адмін мусить створити файл)', () => {
    const p = project(factionsFile(['ZP_ChemBench']))
    const view = buildStationView(p, idx)
    expect(defaultTargetFileFor(view, p, 'ZP_ChemBench')).toBeUndefined()
  })

  test('linkTargetFileFor: правила станка-призначення тримаються разом; без рядків — fallback', () => {
    const analyzer = rule('an', { Device: 'ZP_Microscope', InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: true, Content: 'x' } })
    const p = project(rulesFile('ProcessingRules/a.json', [packer()]), rulesFile('ProcessingRules/b.json', [analyzer]))
    const view = buildStationView(p, idx)
    expect(linkTargetFileFor(view, 'ZP_Microscope', 'ProcessingRules/a.json')).toBe('ProcessingRules/b.json')
    expect(linkTargetFileFor(view, 'ZP_ServerRack', 'ProcessingRules/a.json')).toBe('ProcessingRules/a.json')
  })
})

// ---- resolveLinkTargetFile (W4 Task 6, хвіст капстоуна №3) --------------------------------
// Симптом капстоуна: «Куди піде результат» клало заготовку-аналізатор у файл, обраний
// автоматично (перший рядок станка-призначення), і адмін НІЯК не міг сказати «поклади в
// мій файл». Явний вибір мусить перемагати автоматику, але лишатись НЕОБОВʼЯЗКОВИМ —
// типова поведінка не змінюється мовчки (вимога брифа).
describe('resolveLinkTargetFile', () => {
  const analyzer = () => rule('an', { Device: 'ZP_Microscope', InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: true, Content: 'x' } })

  test('без вибору адміна — та сама автоматика, що й до T6', () => {
    const p = project(rulesFile('ProcessingRules/a.json', [packer()]), rulesFile('ProcessingRules/b.json', [analyzer()]))
    const view = buildStationView(p, idx)
    expect(resolveLinkTargetFile(view, p, 'ZP_Microscope', 'ProcessingRules/a.json', null)).toBe('ProcessingRules/b.json')
    expect(resolveLinkTargetFile(view, p, 'ZP_Microscope', 'ProcessingRules/a.json', '')).toBe('ProcessingRules/b.json')
  })

  test('явний вибір перемагає автоматику', () => {
    const p = project(rulesFile('ProcessingRules/a.json', [packer()]), rulesFile('ProcessingRules/b.json', [analyzer()]), rulesFile('ProcessingRules/c.json', []))
    const view = buildStationView(p, idx)
    expect(resolveLinkTargetFile(view, p, 'ZP_Microscope', 'ProcessingRules/a.json', 'ProcessingRules/c.json')).toBe('ProcessingRules/c.json')
  })

  test('обраний файл зник із проєкту (видалено) — тихо повертаємось до автоматики, не в нікуди', () => {
    const p = project(rulesFile('ProcessingRules/a.json', [packer()]), rulesFile('ProcessingRules/b.json', [analyzer()]))
    const view = buildStationView(p, idx)
    expect(resolveLinkTargetFile(view, p, 'ZP_Microscope', 'ProcessingRules/a.json', 'ProcessingRules/znyklyj.json')).toBe('ProcessingRules/b.json')
  })

  test('обрано НЕ файл правил (одиночний конфіг) — так само автоматика', () => {
    const p = project(factionsFile([]), rulesFile('ProcessingRules/a.json', [packer()]))
    const view = buildStationView(p, idx)
    expect(resolveLinkTargetFile(view, p, 'ZP_Microscope', 'ProcessingRules/a.json', 'Factions.json')).toBe('ProcessingRules/a.json')
  })
})

describe('pluralizeRows', () => {
  test('слов\'янська плюралізація', () => {
    expect(pluralizeRows(1)).toBe('1 рядок')
    expect(pluralizeRows(3)).toBe('3 рядки')
    expect(pluralizeRows(5)).toBe('5 рядків')
    expect(pluralizeRows(11)).toBe('11 рядків')
    expect(pluralizeRows(21)).toBe('21 рядок')
  })
})
