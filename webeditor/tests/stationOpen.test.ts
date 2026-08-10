// Тести W4 Task 6, хвіст капстоуна №2 — вхід у вікно станка БЕЗ полотна
// (ui/stationOpen.ts). TDD: написані ДО коду.
//
// Симптом капстоуна: єдиним входом у вікно станка був клік по картці на полотні
// «Ланцюги», а картка існує лише коли в станка вже є ПРАВИЛО (ідентичність вузла полотна =
// станок+правило, W2.6 T2). Проєкт із нуля правил не мав жодного способу відкрити вікно —
// тобто «створити перше правило» через УІ було неможливо взагалі.
//
// Список для перемикача мусить бути ширшим за view.stations: станок, якого немає ні в
// правилах, ні в Factions.json.DeviceClasses (свіжий прилад чужого мода), однаково має
// відкриватись — звідси другий ярус із ClassIndex і вільний ввід.

import { describe, test, expect } from 'vitest'
import { parseConfig } from '../src/io/parse'
import { RULES_FILE_SCHEMA, FACTIONS_SCHEMA } from '../src/model/schema'
import { loadClassIndex } from '../src/model/classIndex'
import type { ClassIndex } from '../src/model/classIndex'
import type { StorageBackend } from '../src/io/backend'
import type { Project, ProjectFile } from '../src/io/project'
import { buildStationView } from '../src/model/stationView'
import { collectStationOpenOptions, STATION_KNOWN_HINT } from '../src/ui/stationOpen'

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
  const doc = {
    ConfigVersion: 1,
    Factions: [{ Id: 'eco', DisplayName: 'Eco', Supertype: '', Armbands: [], TerminalClasses: [], DeviceClasses: deviceClasses }],
  }
  const { value, warnings } = parseConfig(FACTIONS_SCHEMA, JSON.stringify(doc))
  return { path: 'Factions.json', kind: 'factions', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function project(...files: ProjectFile[]): Project {
  return { files, backend: dummyBackend }
}

describe('collectStationOpenOptions', () => {
  test('станки проєкту йдуть ПЕРШИМИ й позначені підказкою', () => {
    const p = project(rulesFile('ProcessingRules/a.json', [rule('r1')]), factionsFile(['ZP_ChemBench']))
    const view = buildStationView(p, idx)
    const opts = collectStationOpenOptions(view.stations, idx, '', 20)
    expect(opts.slice(0, 2).map((o) => o.id)).toEqual(['ZP_SampleFridge', 'ZP_ChemBench'])
    expect(opts[0].hint).toContain(STATION_KNOWN_HINT)
    expect(opts[0].hint).toContain('ZP_SampleFridge') // класнейм лишається в підказці — пошук по ньому мусить працювати
  })

  test('порожній проєкт: список НЕ порожній — індекс класів дає з чого почати', () => {
    const view = buildStationView(project(), idx)
    expect(view.stations).toHaveLength(0)
    const opts = collectStationOpenOptions(view.stations, idx, 'ZP_Microscope', 20)
    expect(opts.map((o) => o.id)).toContain('ZP_Microscope')
  })

  test('станок проєкту НЕ дублюється рядком з індексу (дедуп кейс-інсенситивний)', () => {
    const p = project(rulesFile('ProcessingRules/a.json', [rule('r1', { Device: 'zp_microscope' })]))
    const view = buildStationView(p, idx)
    const opts = collectStationOpenOptions(view.stations, idx, 'ZP_Microscope', 20)
    const hits = opts.filter((o) => o.id.toLowerCase() === 'zp_microscope')
    expect(hits).toHaveLength(1)
    expect(hits[0].id).toBe('zp_microscope') // перший побачений регістр станка проєкту, як у stationView
    expect(hits[0].hint).toContain(STATION_KNOWN_HINT)
  })

  test('запит фільтрує обидва яруси; ліміт рахується на весь список', () => {
    const p = project(rulesFile('ProcessingRules/a.json', [rule('r1')]), factionsFile(['ZP_ChemBench']))
    const view = buildStationView(p, idx)
    expect(collectStationOpenOptions(view.stations, idx, 'ChemBench', 20).map((o) => o.id)).toEqual(['ZP_ChemBench'])
    expect(collectStationOpenOptions(view.stations, idx, '', 1).map((o) => o.id)).toEqual(['ZP_SampleFridge'])
    expect(collectStationOpenOptions(view.stations, idx, '', 3)).toHaveLength(3)
  })

  test('пошук по ігровому імені станка теж працює (ярус 1 ZpSelect — label)', () => {
    const p = project(rulesFile('ProcessingRules/a.json', [rule('r1')]))
    const view = buildStationView(p, idx)
    const label = view.stations[0].display
    const opts = collectStationOpenOptions(view.stations, idx, label, 20)
    expect(opts[0].id).toBe('ZP_SampleFridge')
  })
})
