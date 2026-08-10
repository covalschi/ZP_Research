// Тести моделі станків (W2.6 Task 1). buildStationView перегруповує ProcessingRules за
// станком (Device) і резолвить ігрові імена/статус настроєності/"куди йде" — якщо тут
// розійдеться з chainGraph/matchInputMirror чи ruleValidation, T2/T3 покажуть адміну
// неправдиву картину станка (пропущений вхід, фантомне "куди йде", хибний статус).

import { describe, test, expect } from 'vitest'
import { parseConfig } from '../src/io/parse'
import { RULES_FILE_SCHEMA, FACTIONS_SCHEMA } from '../src/model/schema'
import { loadClassIndex } from '../src/model/classIndex'
import type { ClassIndex } from '../src/model/classIndex'
import type { StorageBackend } from '../src/io/backend'
import type { Project, ProjectFile } from '../src/io/project'
import { buildStationView, resolveStationItemDisplay } from '../src/model/stationView'
import { buildChainGraph } from '../src/model/chainGraph'

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

function factionsFile(factions: Record<string, unknown>[]): ProjectFile {
  const jsonText = JSON.stringify({ ConfigVersion: 1, Factions: factions })
  const { value, warnings } = parseConfig(FACTIONS_SCHEMA, jsonText)
  return { path: 'Factions.json', kind: 'factions', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function project(...files: ProjectFile[]): Project {
  return { files, backend: dummyBackend }
}

// Той самий helper, що chainGraph.test.ts/chainView.test.ts — усі обов'язкові поля схеми
// присутні (щоб не піднімати "ключ відсутній"), значення підставляються через override.
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

function faction(id: string, override: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Id: id,
    DisplayName: id,
    Supertype: '',
    Armbands: [],
    TerminalClasses: [],
    DeviceClasses: [],
    ...override,
  }
}

function stationOf(result: ReturnType<typeof buildStationView>, classname: string) {
  return result.byClassname.get(classname.toLowerCase())
}

// ---- resolveStationItemDisplay --------------------------------------------------------------

describe('resolveStationItemDisplay', () => {
  const p = project()

  test('порожній класнейм -- порожній display, не зразок', () => {
    expect(resolveStationItemDisplay(p, idx, '')).toEqual({ display: '', isSample: false })
  })

  test('звичайний предмет (Apple) -- displayNameOf, isSample=false', () => {
    const face = resolveStationItemDisplay(p, idx, 'Apple')
    expect(face.isSample).toBe(false)
    expect(face.display.length).toBeGreaterThan(0)
  })

  test('родина ZP_Sample_Base -- isSample=true, fallback display=класнейм без SampleTypes.json', () => {
    const face = resolveStationItemDisplay(p, idx, 'ZP_Sample')
    expect(face.isSample).toBe(true)
    expect(face.display).toBe('ZP_Sample') // немає файлу sampleTypes у проєкті -- fallback
  })

  test('родина ZP_Data_Base -- isSample=false, fallback display=класнейм без DataItems.json', () => {
    const face = resolveStationItemDisplay(p, idx, 'ZP_Data_01')
    expect(face.isSample).toBe(false)
    expect(face.display).toBe('ZP_Data_01')
  })

  test('пайп-форма "|1" стрипається ПЕРЕД резолвом (інакше SampleTypes.json/ClassIndex не знайшли б клас)', () => {
    const withPipe = resolveStationItemDisplay(p, idx, 'ZP_Sample|1')
    const bare = resolveStationItemDisplay(p, idx, 'ZP_Sample')
    expect(withPipe).toEqual(bare)
  })
})

// ---- Станок-множина: Device правил + DeviceClasses фракцій ---------------------------------

describe('buildStationView: множина станків', () => {
  test('станок з Device правила (увімкненого)', () => {
    const p = project(rulesFile('ProcessingRules/r.json', rulesJson([rule('r1', { Device: 'ZP_Microscope' })])))
    const result = buildStationView(p, idx)
    expect(result.stations.map((s) => s.classname)).toEqual(['ZP_Microscope'])
  })

  test('станок з Device ВИМКНЕНОГО правила теж потрапляє в множину (п.1 брифа: enabled ЧИ disabled)', () => {
    const p = project(rulesFile('ProcessingRules/r.json', rulesJson([rule('r1', { Device: 'ZP_Microscope', Enabled: false })])))
    const result = buildStationView(p, idx)
    expect(result.stations.map((s) => s.classname)).toEqual(['ZP_Microscope'])
    expect(stationOf(result, 'ZP_Microscope')?.inputRows[0].disabled).toBe(true)
  })

  test('станок ЛИШЕ з Factions.json DeviceClasses (жодного правила ще немає)', () => {
    const p = project(factionsFile([faction('ecolog', { DeviceClasses: ['ZP_LabComputer'] })]))
    const result = buildStationView(p, idx)
    expect(result.stations.map((s) => s.classname)).toEqual(['ZP_LabComputer'])
    expect(stationOf(result, 'ZP_LabComputer')?.inputRows).toEqual([])
    expect(stationOf(result, 'ZP_LabComputer')?.roles).toEqual({ packer: false, analyzer: false })
  })

  test('DeviceClasses стрипає "|1", кейс-інсенситивний дедуп із правилом -- перший побачений регістр виграє', () => {
    const p = project(
      rulesFile('ProcessingRules/r.json', rulesJson([rule('r1', { Device: 'zp_microscope' })])),
      factionsFile([faction('ecolog', { DeviceClasses: ['ZP_Microscope|1'] })]),
    )
    const result = buildStationView(p, idx)
    expect(result.stations).toHaveLength(1)
    expect(result.stations[0].classname).toBe('zp_microscope') // регістр з правила (побачено першим)
    expect(result.byClassname.get('zp_microscope')).toBe(result.stations[0])
  })

  test('порожній Device (після стрипу) -- рядок не потрапляє в жоден станок, не падає', () => {
    const p = project(rulesFile('ProcessingRules/r.json', rulesJson([rule('r1', { Device: '' })])))
    const result = buildStationView(p, idx)
    expect(result.stations).toEqual([])
  })

  test('display станка -- displayNameOf (ігрове ім\'я, не сирий класнейм для нашого мода)', () => {
    const p = project(rulesFile('ProcessingRules/r.json', rulesJson([rule('r1', { Device: 'ZP_Microscope' })])))
    const result = buildStationView(p, idx)
    const s = stationOf(result, 'ZP_Microscope')!
    expect(s.display.length).toBeGreaterThan(0)
    expect(s.display).not.toBe('ZP_Microscope') // наш мод має displayName у stringtable
  })
})

// ---- Ролі: packer / analyzer / обидва / жоден ------------------------------------------------

describe('buildStationView: ролі', () => {
  test('packer -- є правило з виходом родини ZP_Sample_Base', () => {
    const p = project(
      rulesFile(
        'ProcessingRules/r.json',
        rulesJson([rule('pack', { Device: 'ZP_SampleFridge', Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'x' }] })]),
      ),
    )
    const result = buildStationView(p, idx)
    expect(stationOf(result, 'ZP_SampleFridge')?.roles).toEqual({ packer: true, analyzer: false })
  })

  test('analyzer -- є правило зі входом родини ZP_Sample_Base', () => {
    const p = project(
      rulesFile(
        'ProcessingRules/r.json',
        rulesJson([rule('analyze', { Device: 'ZP_Microscope', InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: true, Content: 'x' } })]),
      ),
    )
    const result = buildStationView(p, idx)
    expect(stationOf(result, 'ZP_Microscope')?.roles).toEqual({ packer: false, analyzer: true })
  })

  test('станок може бути ОБОМА одночасно (два правила: одне пакує, інше аналізує)', () => {
    const pack = rule('pack', { Device: 'ZP_Hybrid', Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'x' }] })
    const analyze = rule('analyze', {
      Device: 'ZP_Hybrid',
      InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: true, Content: 'y' },
    })
    const p = project(rulesFile('ProcessingRules/r.json', rulesJson([pack, analyze])))
    const result = buildStationView(p, idx)
    expect(stationOf(result, 'ZP_Hybrid')?.roles).toEqual({ packer: true, analyzer: true })
  })

  test('звичайний переробник (жодної родини ні на вході, ні на виході) -- обидва прапорці false, рядки все одно є', () => {
    const p = project(
      rulesFile(
        'ProcessingRules/r.json',
        rulesJson([rule('plain', { Device: 'ZP_ChemBench', InputItem: { Classname: 'Apple', Quantity: 1, ConsumeInput: true, Content: '' }, Outputs: [{ Classname: 'Rag', Quantity: 1, Chance: 1, Content: '' }] })]),
      ),
    )
    const result = buildStationView(p, idx)
    const s = stationOf(result, 'ZP_ChemBench')!
    expect(s.roles).toEqual({ packer: false, analyzer: false })
    expect(s.inputRows).toHaveLength(1)
  })

  test('роль рахується і з ВИМКНЕНОГО правила (структура станка, не "чи працює зараз")', () => {
    const p = project(
      rulesFile(
        'ProcessingRules/r.json',
        rulesJson([rule('pack', { Device: 'ZP_SampleFridge', Enabled: false, Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'x' }] })]),
      ),
    )
    const result = buildStationView(p, idx)
    expect(stationOf(result, 'ZP_SampleFridge')?.roles.packer).toBe(true)
  })
})

// ---- Порядок рядків: файл-пріоритет + порядок у файлі ----------------------------------------

describe('buildStationView: порядок inputRows', () => {
  // W2.6 fix-round-1, MINOR 3: попередня фікстура (a1/a2/b1) НЕ дискримінувала --
  // алфавітний порядок ruleId випадково збігався з порядком файлів проєкту, тож тест
  // пройшов би однаково і з хибною реалізацією "сортувати рядки за ruleId". Тут Id
  // НАВМИСНО у "зворотному" алфавіті відносно порядку файлів: z1 у ПЕРШОМУ файлі
  // (a.json), a1 у ДРУГОМУ (z.json) -- якби порядок держався на алфавіті Id, a1 йшов би
  // першим; тест доводить, що порядок -- САМЕ порядок масиву project.files (файл-пріоритет).
  test('два файли -- рядки йдуть у порядку ПРОЄКТУ (файл-пріоритет), НЕ за алфавітом ruleId (дискримінуюча фікстура)', () => {
    const fileA = rulesFile('ProcessingRules/a.json', rulesJson([rule('z1', { Device: 'ZP_Microscope' })]))
    const fileZ = rulesFile('ProcessingRules/z.json', rulesJson([rule('a1', { Device: 'ZP_Microscope' })]))
    const p = project(fileA, fileZ) // порядок масиву = порядок пріоритету (як його вже встановив би sortPathsByBasename)
    const result = buildStationView(p, idx)
    const rows = stationOf(result, 'ZP_Microscope')!.inputRows
    expect(rows.map((r) => r.ruleId)).toEqual(['z1', 'a1'])
    expect(rows.map((r) => r.filePath)).toEqual(['ProcessingRules/a.json', 'ProcessingRules/z.json'])
  })

  // Та сама дискримінуюча ідея всередині ОДНОГО файлу: Rules[] несе z9 ПЕРЕД a1 --
  // алфавітне сортування Id дало б протилежний порядок.
  test('у межах ОДНОГО файлу -- порядок Rules[] масиву, НЕ алфавіт ruleId (дискримінуюча фікстура)', () => {
    const file = rulesFile('ProcessingRules/r.json', rulesJson([rule('z9', { Device: 'ZP_Microscope' }), rule('a1', { Device: 'ZP_Microscope' })]))
    const p = project(file)
    const result = buildStationView(p, idx)
    expect(stationOf(result, 'ZP_Microscope')!.inputRows.map((r) => r.ruleId)).toEqual(['z9', 'a1'])
  })

  test('рядки РІЗНИХ станків не змішуються (кожен станок бачить лише СВОЇ правила у своєму порядку)', () => {
    const file = rulesFile(
      'ProcessingRules/r.json',
      rulesJson([rule('m1', { Device: 'ZP_Microscope' }), rule('f1', { Device: 'ZP_SampleFridge' }), rule('m2', { Device: 'ZP_Microscope' })]),
    )
    const p = project(file)
    const result = buildStationView(p, idx)
    expect(stationOf(result, 'ZP_Microscope')!.inputRows.map((r) => r.ruleId)).toEqual(['m1', 'm2'])
    expect(stationOf(result, 'ZP_SampleFridge')!.inputRows.map((r) => r.ruleId)).toEqual(['f1'])
  })
})

// ---- configured / problems --------------------------------------------------------------------

describe('buildStationView: configured/problems', () => {
  test('заготовка-правило з ПОРОЖНІМИ Outputs -- НЕ налаштовано, причина "вихід не задано"', () => {
    const p = project(rulesFile('ProcessingRules/r.json', rulesJson([rule('stub', { Device: 'ZP_Microscope', Outputs: [] })])))
    const result = buildStationView(p, idx)
    const row = stationOf(result, 'ZP_Microscope')!.inputRows[0]
    expect(row.configured).toBe(false)
    expect(row.problems).toContain('вихід не задано')
  })

  test('порожній InputItem.Classname -- НЕ налаштовано, причина "вхід не задано"', () => {
    const p = project(
      rulesFile(
        'ProcessingRules/r.json',
        rulesJson([rule('stub', { Device: 'ZP_Microscope', InputItem: { Classname: '', Quantity: 1, ConsumeInput: true, Content: '' }, Outputs: [{ Classname: 'Rag', Quantity: 1, Chance: 1, Content: '' }] })]),
      ),
    )
    const result = buildStationView(p, idx)
    const row = stationOf(result, 'ZP_Microscope')!.inputRows[0]
    expect(row.configured).toBe(false)
    expect(row.problems).toContain('вхід не задано')
  })

  test('Outputs=[{Classname:""}] (непорожній масив, але порожній рядок) теж рахується "вихід не задано"', () => {
    const p = project(
      rulesFile('ProcessingRules/r.json', rulesJson([rule('stub', { Device: 'ZP_Microscope', Outputs: [{ Classname: '', Quantity: 1, Chance: 1, Content: '' }] })])),
    )
    const result = buildStationView(p, idx)
    expect(stationOf(result, 'ZP_Microscope')!.inputRows[0].configured).toBe(false)
  })

  test('ConsumeInput=false -- НЕ налаштовано, повідомлення validateRule потрапляє в problems', () => {
    const p = project(
      rulesFile(
        'ProcessingRules/r.json',
        rulesJson([
          rule('badconsume', {
            Device: 'ZP_Microscope',
            InputItem: { Classname: 'Apple', Quantity: 1, ConsumeInput: false, Content: '' },
            Outputs: [{ Classname: 'Rag', Quantity: 1, Chance: 1, Content: '' }],
          }),
        ]),
      ),
    )
    const result = buildStationView(p, idx)
    const row = stationOf(result, 'ZP_Microscope')!.inputRows[0]
    expect(row.configured).toBe(false)
    expect(row.problems).toContain('сервер відхилить: ConsumeInput=false недопустимий для background')
  })

  test('повністю коректне правило -- configured=true, problems порожній', () => {
    const p = project(
      rulesFile(
        'ProcessingRules/r.json',
        rulesJson([rule('ok', { Device: 'ZP_Microscope', Outputs: [{ Classname: 'Rag', Quantity: 1, Chance: 1, Content: '' }] })]),
      ),
    )
    const result = buildStationView(p, idx)
    const row = stationOf(result, 'ZP_Microscope')!.inputRows[0]
    expect(row.configured).toBe(true)
    expect(row.problems).toEqual([])
  })

  test('клас поза індексом -- лише WARN (validateRule), configured лишається true, але problems непорожній', () => {
    const p = project(
      rulesFile(
        'ProcessingRules/r.json',
        rulesJson([
          rule('warnonly', {
            Device: 'Totally_Unknown_Class_Zzz',
            Outputs: [{ Classname: 'Rag', Quantity: 1, Chance: 1, Content: '' }],
          }),
        ]),
      ),
    )
    const result = buildStationView(p, idx)
    const row = stationOf(result, 'Totally_Unknown_Class_Zzz')!.inputRows[0]
    expect(row.configured).toBe(true) // warn -- не alarm, не блокує
    expect(row.problems.length).toBeGreaterThan(0)
  })
})

// ---- outputs (лице кожного виходу) ------------------------------------------------------------

describe('buildStationView: outputs лице', () => {
  test('вихід родини ZP_Sample_Base -- isSample=true, класнейм+вміст збережені', () => {
    const p = project(
      rulesFile(
        'ProcessingRules/r.json',
        rulesJson([rule('pack', { Device: 'ZP_SampleFridge', Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'chimera_claw' }] })]),
      ),
    )
    const result = buildStationView(p, idx)
    const [out] = stationOf(result, 'ZP_SampleFridge')!.inputRows[0].outputs
    expect(out).toEqual({ classname: 'ZP_Sample', display: 'ZP_Sample', isSample: true, content: 'chimera_claw' })
  })

  test('вихід родини ZP_Data_Base -- isSample=false, ігрове ім\'я (fallback класнейм без DataItems.json)', () => {
    const p = project(
      rulesFile(
        'ProcessingRules/r.json',
        rulesJson([rule('analyze', { Device: 'ZP_Microscope', Outputs: [{ Classname: 'ZP_Data_01', Quantity: 1, Chance: 1, Content: '' }] })]),
      ),
    )
    const result = buildStationView(p, idx)
    const [out] = stationOf(result, 'ZP_Microscope')!.inputRows[0].outputs
    expect(out.isSample).toBe(false)
    expect(out.classname).toBe('ZP_Data_01')
    expect(out.display).toBe('ZP_Data_01')
  })

  test('звичайний вихід -- isSample=false, display через ClassIndex', () => {
    const p = project(
      rulesFile('ProcessingRules/r.json', rulesJson([rule('r1', { Device: 'ZP_ChemBench', Outputs: [{ Classname: 'Apple', Quantity: 1, Chance: 1, Content: '' }] })])),
    )
    const result = buildStationView(p, idx)
    const [out] = stationOf(result, 'ZP_ChemBench')!.inputRows[0].outputs
    expect(out.isSample).toBe(false)
    expect(out.classname).toBe('Apple')
  })
})

// ---- destinations: "куди йде" -------------------------------------------------------------

describe('buildStationView: destinations', () => {
  test('точний збіг класу+вмісту -- вихід одного станка веде до станка-споживача', () => {
    const pack = rule('pack', { Device: 'ZP_SampleFridge', Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'chimera_claw' }] })
    const analyze = rule('analyze', {
      Device: 'ZP_Microscope',
      InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: true, Content: 'chimera_claw' },
    })
    const p = project(rulesFile('ProcessingRules/r.json', rulesJson([pack, analyze])))
    const result = buildStationView(p, idx)
    const row = stationOf(result, 'ZP_SampleFridge')!.inputRows[0]
    expect(row.destinations).toEqual([{ stationClassname: 'ZP_Microscope', display: stationOf(result, 'ZP_Microscope')!.display }])
  })

  test('матчинг через успадкування (isKindOf, не лише точний клас) -- ZP_Sample задовольняє вимогу ZP_Sample_Base', () => {
    const pack = rule('pack', { Device: 'ZP_SampleFridge', Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'x' }] })
    const analyze = rule('analyze', {
      Device: 'ZP_Microscope',
      InputItem: { Classname: 'ZP_Sample_Base', Quantity: 1, ConsumeInput: true, Content: 'x' },
    })
    const p = project(rulesFile('ProcessingRules/r.json', rulesJson([pack, analyze])))
    const result = buildStationView(p, idx)
    const row = stationOf(result, 'ZP_SampleFridge')!.inputRows[0]
    expect(row.destinations.map((d) => d.stationClassname)).toEqual(['ZP_Microscope'])
  })

  test('ВИМКНЕНИЙ споживач -- НЕ призначення (мовчазний відкид, дзеркало chainGraph)', () => {
    const pack = rule('pack', { Device: 'ZP_SampleFridge', Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'x' }] })
    const analyze = rule('analyze', {
      Device: 'ZP_Microscope',
      Enabled: false,
      InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: true, Content: 'x' },
    })
    const p = project(rulesFile('ProcessingRules/r.json', rulesJson([pack, analyze])))
    const result = buildStationView(p, idx)
    expect(stationOf(result, 'ZP_SampleFridge')!.inputRows[0].destinations).toEqual([])
  })

  test('ВИМКНЕНИЙ рядок-джерело НЕ дає жодних призначень (вимкнене правило виключене як джерело "куди йде", W2.6 fix-round-1 CRITICAL 1)', () => {
    const pack = rule('pack', { Device: 'ZP_SampleFridge', Enabled: false, Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'x' }] })
    const analyze = rule('analyze', { Device: 'ZP_Microscope', InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: true, Content: 'x' } })
    const p = project(rulesFile('ProcessingRules/r.json', rulesJson([pack, analyze])))
    const result = buildStationView(p, idx)
    expect(stationOf(result, 'ZP_SampleFridge')!.inputRows[0].destinations).toEqual([])
  })

  test('Consumables НЕ враховуються для destinations (лише InputItem, п.4 брифа)', () => {
    const pack = rule('pack', { Device: 'ZP_SampleFridge', Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'reagent' }] })
    const consumer = rule('consumer', {
      Device: 'ZP_Microscope',
      InputItem: { Classname: 'Apple', Quantity: 1, ConsumeInput: true, Content: '' },
      Consumables: [{ Classname: 'ZP_Sample', Quantity: 1, Content: 'reagent' }],
    })
    const p = project(rulesFile('ProcessingRules/r.json', rulesJson([pack, consumer])))
    const result = buildStationView(p, idx)
    expect(stationOf(result, 'ZP_SampleFridge')!.inputRows[0].destinations).toEqual([])
  })

  test('декілька виходів рядка -- destinations об\'єднання без дублів станка', () => {
    const pack = rule('pack', {
      Device: 'ZP_SampleFridge',
      Outputs: [
        { Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'a' },
        { Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'b' },
      ],
    })
    const analyzeA = rule('analyzeA', { Device: 'ZP_Microscope', InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: true, Content: 'a' } })
    const analyzeB = rule('analyzeB', { Device: 'ZP_Microscope', InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: true, Content: 'b' } })
    const p = project(rulesFile('ProcessingRules/r.json', rulesJson([pack, analyzeA, analyzeB])))
    const result = buildStationView(p, idx)
    expect(stationOf(result, 'ZP_SampleFridge')!.inputRows[0].destinations).toHaveLength(1) // один станок, не два записи
  })
})

// ---- producedStreams -------------------------------------------------------------------------

describe('buildStationView: producedStreams', () => {
  test('увімкнений configured пакувальник -- потік з\'являється', () => {
    const p = project(
      rulesFile('ProcessingRules/r.json', rulesJson([rule('pack', { Device: 'ZP_SampleFridge', Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'x' }] })])),
    )
    const result = buildStationView(p, idx)
    expect(result.producedStreams).toEqual([{ classname: 'ZP_Sample', content: 'x', display: 'ZP_Sample' }])
  })

  test('дедуп кейс-інсенситивний по (classname,content) -- перший побачений регістр виграє', () => {
    const p = project(
      rulesFile(
        'ProcessingRules/r.json',
        rulesJson([
          rule('pack1', { Device: 'ZP_SampleFridge', Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'Chimera_Claw' }] }),
          rule('pack2', { Device: 'ZP_SampleFridge', Outputs: [{ Classname: 'zp_sample', Quantity: 1, Chance: 1, Content: 'CHIMERA_CLAW' }] }),
        ]),
      ),
    )
    const result = buildStationView(p, idx)
    expect(result.producedStreams).toHaveLength(1)
    expect(result.producedStreams[0].classname).toBe('ZP_Sample')
    expect(result.producedStreams[0].content).toBe('Chimera_Claw')
  })

  test('ВИМКНЕНИЙ пакувальник -- потік ВІДСУТНІЙ', () => {
    const p = project(
      rulesFile(
        'ProcessingRules/r.json',
        rulesJson([rule('pack', { Device: 'ZP_SampleFridge', Enabled: false, Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'x' }] })]),
      ),
    )
    const result = buildStationView(p, idx)
    expect(result.producedStreams).toEqual([])
  })

  test('НЕ configured пакувальник (ConsumeInput=false) -- потік ВІДСУТНІЙ', () => {
    const p = project(
      rulesFile(
        'ProcessingRules/r.json',
        rulesJson([
          rule('pack', {
            Device: 'ZP_SampleFridge',
            InputItem: { Classname: 'Apple', Quantity: 1, ConsumeInput: false, Content: '' },
            Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'x' }],
          }),
        ]),
      ),
    )
    const result = buildStationView(p, idx)
    expect(result.producedStreams).toEqual([])
  })

  test('НЕ-зразковий побічний вихід пакувального правила -- НЕ потрапляє в producedStreams (лише родина ZP_Sample_Base)', () => {
    const p = project(
      rulesFile(
        'ProcessingRules/r.json',
        rulesJson([
          rule('pack', {
            Device: 'ZP_SampleFridge',
            Outputs: [
              { Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'x' },
              { Classname: 'Rag', Quantity: 1, Chance: 1, Content: '' }, // побічний, не зразок
            ],
          }),
        ]),
      ),
    )
    const result = buildStationView(p, idx)
    expect(result.producedStreams).toEqual([{ classname: 'ZP_Sample', content: 'x', display: 'ZP_Sample' }])
  })
})

// ---- Дублікати Id (п.6 брифа) ------------------------------------------------------------------

describe('buildStationView: дублікат Id', () => {
  test('однаковий Id у РІЗНИХ файлах -- ОБИДВА рядки присутні (не колапсуються), обидва позначені duplicate', () => {
    const fileA = rulesFile('ProcessingRules/a.json', rulesJson([rule('dup', { Device: 'ZP_Microscope' })]))
    const fileB = rulesFile('ProcessingRules/b.json', rulesJson([rule('dup', { Device: 'ZP_Microscope' })]))
    const p = project(fileA, fileB)
    const result = buildStationView(p, idx)
    const rows = stationOf(result, 'ZP_Microscope')!.inputRows
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.duplicate)).toBe(true)
    expect(rows.map((r) => r.filePath)).toEqual(['ProcessingRules/a.json', 'ProcessingRules/b.json'])
  })

  test('унікальний Id -- duplicate=false', () => {
    const p = project(rulesFile('ProcessingRules/r.json', rulesJson([rule('unique', { Device: 'ZP_Microscope' })])))
    const result = buildStationView(p, idx)
    expect(stationOf(result, 'ZP_Microscope')!.inputRows[0].duplicate).toBe(false)
  })
})

// ---- Сирі поля рядка (rawClassname/rawContent/rawDisplay) --------------------------------------

describe('buildStationView: сирі поля входу рядка', () => {
  test('rawClassname/rawContent -- рівно те, що у файлі; rawDisplay -- резолв', () => {
    const p = project(
      rulesFile(
        'ProcessingRules/r.json',
        rulesJson([rule('r1', { Device: 'ZP_Microscope', InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: true, Content: 'chimera_claw' } })]),
      ),
    )
    const result = buildStationView(p, idx)
    const row = stationOf(result, 'ZP_Microscope')!.inputRows[0]
    expect(row.rawClassname).toBe('ZP_Sample')
    expect(row.rawContent).toBe('chimera_claw')
    expect(row.rawDisplay).toBe('ZP_Sample') // fallback без SampleTypes.json у проєкті
  })
})

// ---- Наскрізний ланцюг 3+ ланки (W2.6 Task 4) ---------------------------------------------
//
// Не-упаковувач посередині: пакувальник (сировина -> зразок) -> аналізатор (зразок ->
// ПРОМІЖНИЙ предмет, БЕЗ Content -- звичайний класнейм, не родина ZP_Sample_Base і не
// ZP_Data_Base) -> третій станок (проміжний предмет -> заготовка ZP_Data_01). Доводить, що
// ланцюг НЕ обмежений двома ланками "пакувальник->аналізатор" (усі попередні фікстури --
// chain.json, T1-T3 тести -- рівно дволанкові) і що matchInputMirror коректно зчіплює
// ланку, де вимога/вихід НЕ несуть Content узагалі (пайп через голий клас, InputItem.
// Content='' задовольняється будь-яким виходом того самого класу -- chainGraph.ts:150-157).
describe('buildStationView + buildChainGraph: наскрізний ланцюг 3 ланки, не-упаковувач посередині', () => {
  const pack = rule('pack', { Device: 'ZP_SampleFridge', Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'ore' }] })
  const analyze = rule('analyze', {
    Device: 'ZP_Microscope',
    InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: true, Content: 'ore' },
    // Проміжний вихід -- ЗВИЧАЙНИЙ класнейм (не зразок, не заготовка), Content порожній:
    // саме такий вихід ланцюга chainGraph.ts свідомо НЕ перевіряє на dead-output (коментар
    // "Вихід БЕЗ Content ... свідомо НЕ перевіряється"), але matchInputMirror однаково
    // зчіплює його зі станком-споживачем ЗА КЛАСОМ (порожня вимога Content = "вміст не
    // важливий", chainGraph.ts:150-157).
    Outputs: [{ Classname: 'ZP_Interm_Ore', Quantity: 1, Chance: 1, Content: '' }],
  })
  const refine = rule('refine', {
    Device: 'ZP_ChemBench',
    InputItem: { Classname: 'ZP_Interm_Ore', Quantity: 1, ConsumeInput: true, Content: '' },
    Outputs: [{ Classname: 'ZP_Data_01', Quantity: 1, Chance: 1, Content: '' }],
  })
  const p = project(rulesFile('ProcessingRules/chain3.json', rulesJson([pack, analyze, refine])))

  test('breaks порожній -- увесь ланцюг зчеплений, глухих кутів немає', () => {
    const graph = buildChainGraph(p, idx)
    expect(graph.breaks).toEqual([])
  })

  test('destinations зчіплюються через УСІ три станки: пакувальник->аналізатор->третій станок->кінець', () => {
    const result = buildStationView(p, idx)
    const packRow = stationOf(result, 'ZP_SampleFridge')!.inputRows[0]
    const analyzeRow = stationOf(result, 'ZP_Microscope')!.inputRows[0]
    const refineRow = stationOf(result, 'ZP_ChemBench')!.inputRows[0]
    expect(packRow.destinations.map((d) => d.stationClassname)).toEqual(['ZP_Microscope'])
    expect(analyzeRow.destinations.map((d) => d.stationClassname)).toEqual(['ZP_ChemBench'])
    expect(refineRow.destinations).toEqual([]) // кінець ланцюга -- заготовку ZP_Data_01 ніхто далі не споживає (і не повинен)
  })

  test('producedStreams -- ЛИШЕ потік пакувальника (родина ZP_Sample_Base): проміжний предмет і заготовка НЕ потрапляють', () => {
    const result = buildStationView(p, idx)
    expect(result.producedStreams).toEqual([{ classname: 'ZP_Sample', content: 'ore', display: 'ZP_Sample' }])
  })

  test('роль станка-посередника -- ОБИДВІ (аналізатор входом-зразком, звичайний переробник -- виходом): не пакувальник', () => {
    const result = buildStationView(p, idx)
    const st = stationOf(result, 'ZP_Microscope')!
    expect(st.roles).toEqual({ packer: false, analyzer: true })
  })
})
