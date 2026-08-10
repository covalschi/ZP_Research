// Тести чистих хелперів вкладки «Заготовки» (W4 Task 4, ui/dataItemRows.ts) — TDD-вперед.
// Дзеркалиться РУЙНІВНИЙ Validate DataItems.json (ZP_DataItemsConfig.c:105-137): невалідні
// записи (порожній Id, клас поза грою, не-родина ZP_Data_Base, порожній Name) і дублі Id
// ВИКИДАЮТЬСЯ з набору RemoveOrdered — той самий клас суворості, що Modules (validateModulesDoc,
// «сервер ВИКИНЕ запис», НЕ «відхилить файл»); м'які проблеми балів (порожній запис,
// невідомий тип, Amount поза [0..1000000]) — softWarn (:90-101), запис ЖИВЕ.
//
// Родина класів — скан індексу isKindOf(..., 'ZP_Data_Base') (прецедент
// listSampleFamilyClasses, model/sampleContent.ts) — НЕ жорсткий список 90 імен.

import { describe, test, expect } from 'vitest'
import { parseConfig } from '../src/io/parse'
import { DATA_ITEMS_SCHEMA, POINT_TYPES_SCHEMA } from '../src/model/schema'
import { loadClassIndex } from '../src/model/classIndex'
import type { ClassIndex } from '../src/model/classIndex'
import type { StorageBackend } from '../src/io/backend'
import type { Project, ProjectFile } from '../src/io/project'
import { listDataFamilyClasses, buildDataItemRows, filterDataItemRows } from '../src/ui/dataItemRows'

const idx: ClassIndex = loadClassIndex()

const dummyBackend: StorageBackend = {
  kind: 'zip',
  list: async () => [],
  read: async () => new Uint8Array(0),
  write: async () => {},
}

function dataItemsFile(items: Record<string, unknown>[]): ProjectFile {
  const { value, warnings } = parseConfig(DATA_ITEMS_SCHEMA, JSON.stringify({ ConfigVersion: 1, Items: items }))
  return { path: 'DataItems.json', kind: 'dataItems', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function pointTypesFile(ids: string[]): ProjectFile {
  const doc = {
    ConfigVersion: 1,
    Categories: [],
    Kinds: [],
    PointTypes: ids.map((id) => ({ Id: id, Name: id, Category: '', Kind: '', Tier: 1, Color: '', SortOrder: 0 })),
  }
  const { value, warnings } = parseConfig(POINT_TYPES_SCHEMA, JSON.stringify(doc))
  return { path: 'PointTypes.json', kind: 'pointTypes', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function project(...files: ProjectFile[]): Project {
  return { files, backend: dummyBackend }
}

describe('listDataFamilyClasses: скан індексу, не жорсткий список', () => {
  test('рівно 90 класів ZP_Data_01..90, без кореня ZP_Data_Base, відсортовано', () => {
    const classes = listDataFamilyClasses(idx)
    expect(classes.length).toBe(90)
    expect(classes[0]).toBe('ZP_Data_01')
    expect(classes[89]).toBe('ZP_Data_90')
    expect(classes).not.toContain('ZP_Data_Base')
    expect([...classes].sort()).toEqual(classes)
  })
})

describe('buildDataItemRows: рядки списку', () => {
  test('без DataItems.json — 90 рядків, усі не налаштовані, тон ok, docProblems порожні', () => {
    const { rows, docProblems } = buildDataItemRows(project(), idx)
    expect(rows.length).toBe(90)
    expect(rows.every((r) => !r.face.configured)).toBe(true)
    expect(rows.every((r) => r.tone === 'ok')).toBe(true)
    expect(docProblems).toEqual([])
  })

  test('налаштований запис: імʼя з файлу, зведення балів, тон ok', () => {
    const p = project(
      dataItemsFile([{ Id: 'ZP_Data_01', Enabled: true, Name: 'Зразок химери', Description: '', Points: [{ Type: 'bio_field_t1', Amount: 5 }] }]),
      pointTypesFile(['bio_field_t1']),
    )
    const { rows } = buildDataItemRows(p, idx)
    const row = rows.find((r) => r.classname === 'ZP_Data_01')!
    expect(row.face.configured).toBe(true)
    expect(row.face.name).toBe('Зразок химери')
    expect(row.pointsSummary).toBe('bio_field_t1×5')
    expect(row.tone).toBe('ok')
    expect(row.orphan).toBe(false)
  })

  test('дубль Id — alarm «рушій лишає ОСТАННІЙ», тон alarm', () => {
    const p = project(
      dataItemsFile([
        { Id: 'ZP_Data_01', Enabled: true, Name: 'A', Description: '', Points: [] },
        { Id: 'zp_data_01', Enabled: true, Name: 'B', Description: '', Points: [] },
      ]),
    )
    const { rows } = buildDataItemRows(p, idx)
    const row = rows.find((r) => r.classname === 'ZP_Data_01')!
    expect(row.face.duplicate).toBe(true)
    expect(row.tone).toBe('alarm')
    expect(row.problems.some((pr) => pr.severity === 'alarm' && pr.message.includes('ОСТАННІЙ'))).toBe(true)
  })

  test('порожній Name у налаштованого запису — alarm «сервер ВИКИНЕ» (ValidateItem :88-89)', () => {
    const p = project(dataItemsFile([{ Id: 'ZP_Data_02', Enabled: true, Name: '', Description: '', Points: [] }]))
    const { rows } = buildDataItemRows(p, idx)
    const row = rows.find((r) => r.classname === 'ZP_Data_02')!
    expect(row.tone).toBe('alarm')
    expect(row.problems.some((pr) => pr.severity === 'alarm' && pr.message.includes('ВИКИНЕ') && pr.path === 'Name')).toBe(true)
  })

  test('сирота: клас Є в індексі, але НЕ родина ZP_Data_Base — окремий рядок з alarm', () => {
    const p = project(dataItemsFile([{ Id: 'Apple', Enabled: true, Name: 'Яблуко', Description: '', Points: [] }]))
    const { rows } = buildDataItemRows(p, idx)
    expect(rows.length).toBe(91)
    const row = rows.find((r) => r.classname === 'Apple')!
    expect(row.orphan).toBe(true)
    expect(row.tone).toBe('alarm')
    expect(row.problems.some((pr) => pr.severity === 'alarm' && pr.message.includes('ZP_Data_Base'))).toBe(true)
  })

  // Ревью T4 (minor 1): ValidateItem існування перевіряє ЛИШЕ через CfgVehicles (:84-85) —
  // клас під іншим коренем (набій/магазин/зброя) сервер ріже ЩЕ ДО перевірки родини
  // (:86-87). Alarm той самий, але цитата й причина мусять бути серверні, не зручні.
  test('сирота під НЕ-CfgVehicles коренем — alarm із цитатою :84-85 («немає в грі»), не :86-87', () => {
    const nonVehicle = idx.classes.find((row) => row[3] !== 0)
    expect(nonVehicle).toBeDefined()
    const cls = nonVehicle![0]
    const p = project(dataItemsFile([{ Id: cls, Enabled: true, Name: 'X', Description: '', Points: [] }]))
    const { rows } = buildDataItemRows(p, idx)
    const row = rows.find((r) => r.classname === cls)!
    expect(row.tone).toBe('alarm')
    const prob = row.problems.find((pr) => pr.path === 'Id' && pr.severity === 'alarm')!
    expect(prob.message).toContain(':84-85')
    expect(prob.message).toContain('CfgVehicles')
    expect(prob.message).not.toContain(':86-87')
  })

  test('сирота: класу немає в індексі редактора — warn, НЕ alarm (офлайн-індекс може бути неповним)', () => {
    const p = project(dataItemsFile([{ Id: 'SomeMod_Unknown_XYZ', Enabled: true, Name: 'X', Description: '', Points: [] }]))
    const { rows } = buildDataItemRows(p, idx)
    const row = rows.find((r) => r.classname === 'SomeMod_Unknown_XYZ')!
    expect(row.orphan).toBe(true)
    expect(row.tone).toBe('warn')
    expect(row.problems.some((pr) => pr.severity === 'warn' && pr.message.includes('індекс'))).toBe(true)
  })

  test('мʼякі проблеми балів: порожній тип, невідомий тип, Amount поза [0..1000000] — warn, запис живе', () => {
    const p = project(
      dataItemsFile([
        {
          Id: 'ZP_Data_03',
          Enabled: true,
          Name: 'B',
          Description: '',
          Points: [
            { Type: '', Amount: 1 },
            { Type: 'nope_type', Amount: 2 },
            { Type: 'bio_field_t1', Amount: 2000000 },
          ],
        },
      ]),
      pointTypesFile(['bio_field_t1']),
    )
    const { rows } = buildDataItemRows(p, idx)
    const row = rows.find((r) => r.classname === 'ZP_Data_03')!
    expect(row.tone).toBe('warn')
    expect(row.problems.some((pr) => pr.path === 'Points[0]' && pr.message.includes('порожній'))).toBe(true)
    expect(row.problems.some((pr) => pr.path === 'Points[1]' && pr.message.includes('nope_type'))).toBe(true)
    expect(row.problems.some((pr) => pr.path === 'Points[2]' && pr.message.includes('1000000'))).toBe(true)
    expect(row.problems.every((pr) => pr.severity === 'warn')).toBe(true)
  })

  test('невідомий тип балів БЕЗ PointTypes.json у проєкті — НЕ лається (сервер: `if (pointTypes && ...)`)', () => {
    const p = project(dataItemsFile([{ Id: 'ZP_Data_03', Enabled: true, Name: 'B', Description: '', Points: [{ Type: 'nope_type', Amount: 2 }] }]))
    const { rows } = buildDataItemRows(p, idx)
    const row = rows.find((r) => r.classname === 'ZP_Data_03')!
    expect(row.problems.some((pr) => pr.message.includes('nope_type'))).toBe(false)
  })

  test('запис без Id — docProblem «сервер ВИКИНЕ», окремого рядка немає', () => {
    const p = project(dataItemsFile([{ Id: '', Enabled: true, Name: 'X', Description: '', Points: [] }]))
    const { rows, docProblems } = buildDataItemRows(p, idx)
    expect(rows.length).toBe(90)
    expect(docProblems.some((pr) => pr.severity === 'alarm' && pr.message.includes('без Id'))).toBe(true)
  })
})

describe('filterDataItemRows: фільтр-пошук за класом і назвою', () => {
  const p = project(dataItemsFile([{ Id: 'ZP_Data_01', Enabled: true, Name: 'Зразок химери', Description: '', Points: [] }]))
  const { rows } = buildDataItemRows(p, idx)

  test('порожній запит — усі рядки', () => {
    expect(filterDataItemRows(rows, '').length).toBe(90)
    expect(filterDataItemRows(rows, '   ').length).toBe(90)
  })

  test('підрядок класнейму: "_77" — рівно один рядок', () => {
    const hit = filterDataItemRows(rows, '_77')
    expect(hit.length).toBe(1)
    expect(hit[0].classname).toBe('ZP_Data_77')
  })

  test('підрядок налаштованої назви, кейс-інсенситивно', () => {
    const hit = filterDataItemRows(rows, 'ХИМЕРИ')
    expect(hit.length).toBe(1)
    expect(hit[0].classname).toBe('ZP_Data_01')
  })
})
