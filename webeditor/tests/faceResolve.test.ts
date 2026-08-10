// Тести резолверів "лиця" заготовок/зразків (model/faceResolve.ts, винесено з
// ui/ChainView.tsx у W2.6 Task 1). Живуть в ОКРЕМОМУ файлі (fix-round-1 Task 2 review,
// IMPORTANT 2): функції — модельний код без жодної залежності від React/ChainView, тож
// їхнє покриття не повинно жити всередині tests/chainView.test.ts (яке рерайти полотна
// цілком законно чіпають) — імпорт іде НАПРЯМУ з model/faceResolve.ts, а не через
// реекспорт ui/ChainView.tsx (символи там лишаються реекспортовані для
// RulePanel.tsx/SampleTypesView.tsx/DataItemQuickEdit.tsx, але тестам сенсу імпортувати
// React-компонент заради чистих функцій немає).
//
// Повне покриття (25 тестів, 8 describe-блоків) — те САМЕ, що W2/W2.5 писали в
// chainView.test.ts до рерайту W2.6 Task 2: рерайт помилково скоротив набір до
// абревіатури (25→10), хоча сам model/faceResolve.ts не мав жодної правки в тому ж
// коміті — відновлено тут дослівно, лише джерело імпорту змінилось.

import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseConfig } from '../src/io/parse'
import { DATA_ITEMS_SCHEMA, RULES_FILE_SCHEMA, SAMPLE_TYPES_SCHEMA } from '../src/model/schema'
import { loadClassIndex } from '../src/model/classIndex'
import type { ClassIndex } from '../src/model/classIndex'
import type { StorageBackend } from '../src/io/backend'
import type { Project, ProjectFile } from '../src/io/project'
import { resolveDataItemFace, resolveSampleTypeFace } from '../src/model/faceResolve'

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

// ---- resolveDataItemFace: виявлення "чи це заготовка" ---------------------------------------

describe('resolveDataItemFace: виявлення "чи це заготовка" -- isKindOf(ZP_Data_Base), НЕ префікс рядка', () => {
  test('ZP_Data_01 (реальний клас родини) -- isDataItem=true навіть без запису в DataItems.json', () => {
    const p = project(dataItemsFile([]))
    const face = resolveDataItemFace(p, idx, 'ZP_Data_01')
    expect(face.isDataItem).toBe(true)
    expect(face.configured).toBe(false)
  })

  test('ZP_Sample (проміжний зразок, НЕ заготовка) -- isDataItem=false', () => {
    const p = project(dataItemsFile([]))
    expect(resolveDataItemFace(p, idx, 'ZP_Sample').isDataItem).toBe(false)
  })

  test('звичайна сировина (Apple, поза родиною ZP_Data_Base) -- isDataItem=false', () => {
    const p = project(dataItemsFile([]))
    expect(resolveDataItemFace(p, idx, 'Apple').isDataItem).toBe(false)
  })

  test('порожній класнейм -- isDataItem=false, без падіння', () => {
    const p = project(dataItemsFile([]))
    const face = resolveDataItemFace(p, idx, '')
    expect(face.isDataItem).toBe(false)
    expect(face.configured).toBe(false)
  })
})

describe('resolveDataItemFace: запис знайдено -- ім\'я/опис/бали з DataItems.json, кейс-інсенситивно', () => {
  test('точний регістр -- configured, name/description/enabled/points з запису', () => {
    const p = project(
      dataItemsFile([{ Id: 'ZP_Data_01', Enabled: true, Name: 'Хімерна тканина', Description: 'опис', Points: [{ Type: 'bio_lab_t1', Amount: 5 }] }]),
    )
    const face = resolveDataItemFace(p, idx, 'ZP_Data_01')
    expect(face).toMatchObject({
      classname: 'ZP_Data_01',
      isDataItem: true,
      configured: true,
      entryId: 'ZP_Data_01',
      enabled: true,
      name: 'Хімерна тканина',
      description: 'опис',
      points: [{ Type: 'bio_lab_t1', Amount: 5 }],
    })
  })

  test('запит іншим регістром (zp_data_01) все одно резолвиться -- entryId лишається ЗБЕРЕЖЕНИМ регістром', () => {
    const p = project(dataItemsFile([{ Id: 'ZP_Data_01', Enabled: true, Name: 'Хімерна тканина', Description: '', Points: [] }]))
    const face = resolveDataItemFace(p, idx, 'zp_data_01')
    expect(face.configured).toBe(true)
    expect(face.entryId).toBe('ZP_Data_01') // не 'zp_data_01' -- те, що реально лежить у файлі
    expect(face.name).toBe('Хімерна тканина')
  })

  test('запис ВИМКНЕНИЙ (Enabled=false) -- configured=true, enabled=false (на відміну від серверного Find, який пропускає вимкнені)', () => {
    const p = project(dataItemsFile([{ Id: 'ZP_Data_02', Enabled: false, Name: 'Вимкнена заготовка', Description: '', Points: [] }]))
    const face = resolveDataItemFace(p, idx, 'ZP_Data_02')
    expect(face.configured).toBe(true)
    expect(face.enabled).toBe(false)
    expect(face.name).toBe('Вимкнена заготовка') // ім'я видно, навіть якщо вимкнено -- адмін бачить, ЩО саме вимкнув
  })
})

describe('resolveDataItemFace: запис НЕ знайдено -- "не налаштовано", честно як у грі', () => {
  test('DataItems.json завантажено, але без цього Id -- configured=false, name=classname (фолбек)', () => {
    const p = project(dataItemsFile([{ Id: 'ZP_Data_01', Enabled: true, Name: 'x', Description: '', Points: [] }]))
    const face = resolveDataItemFace(p, idx, 'ZP_Data_02')
    expect(face.configured).toBe(false)
    expect(face.name).toBe('ZP_Data_02')
    expect(face.description).toBe('')
    expect(face.points).toEqual([])
    expect(face.entryId).toBeUndefined()
  })

  test('DataItems.json взагалі НЕ завантажено (проєкт без такого файлу) -- не падає, configured=false', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([rule('r1')])))
    const face = resolveDataItemFace(p, idx, 'ZP_Data_01')
    expect(face.isDataItem).toBe(true) // isKindOf не залежить від DataItems.json
    expect(face.configured).toBe(false)
    expect(face.name).toBe('ZP_Data_01')
  })
})

// ---- resolveDataItemFace: дублікат Id -- LAST-WINS, як сервер (рев'ю фікс-раунду 1,
// Important 1) --------------------------------------------------------------------------
// Джерело (звірено напряму, ZP_DataItemsConfig.c:107-137, Validate): цикл іде ВІД КІНЦЯ
// масиву Items ДО ПОЧАТКУ (`for (int i = Items.Count()-1; i >= 0; i--)`), кожен
// lower-case Id кладеться в "seen" ПРИ ПЕРШОМУ (з кінця) траплянні -- отже ОСТАННІЙ елемент
// масиву переможе, а будь-який РАНІШИЙ дублікат буде видалений (RemoveOrdered) наступним
// Validate/reload. Array.find (як тут було ДО фіксу) повертав би ПЕРШИЙ -- саме той запис,
// який рушій сам зітре.
describe('resolveDataItemFace: дублікат Id -- last-wins (ZP_DataItemsConfig.c:107-137) + позначка duplicate', () => {
  test('два записи з однаковим Id -- резолвиться ОСТАННІЙ (за порядком масиву), duplicate=true', () => {
    const p = project(
      dataItemsFile([
        { Id: 'ZP_Data_01', Enabled: true, Name: 'Перший (буде видалений сервером)', Description: 'd1', Points: [{ Type: 'a', Amount: 1 }] },
        { Id: 'ZP_Data_01', Enabled: true, Name: 'Останній (виживе на сервері)', Description: 'd2', Points: [{ Type: 'b', Amount: 2 }] },
      ]),
    )
    const face = resolveDataItemFace(p, idx, 'ZP_Data_01')
    expect(face.configured).toBe(true)
    expect(face.duplicate).toBe(true)
    expect(face.name).toBe('Останній (виживе на сервері)')
    expect(face.description).toBe('d2')
    expect(face.points).toEqual([{ Type: 'b', Amount: 2 }])
  })

  test('дублікат ІНШИМ регістром Id (ZP_Data_01 / zp_data_01) -- теж виявляється (кейс-інсенситивна лічба, як серверне "seen")', () => {
    const p = project(
      dataItemsFile([
        { Id: 'ZP_Data_01', Enabled: true, Name: 'A', Description: '', Points: [] },
        { Id: 'zp_data_01', Enabled: true, Name: 'B', Description: '', Points: [] },
      ]),
    )
    const face = resolveDataItemFace(p, idx, 'ZP_DATA_01')
    expect(face.duplicate).toBe(true)
    expect(face.name).toBe('B') // останній у масиві, незалежно від регістру запиту
  })

  test('унікальний Id (без дублів) -- duplicate=false', () => {
    const p = project(dataItemsFile([{ Id: 'ZP_Data_01', Enabled: true, Name: 'x', Description: '', Points: [] }]))
    expect(resolveDataItemFace(p, idx, 'ZP_Data_01').duplicate).toBe(false)
  })

  test('незнайдений Id (configured=false) -- duplicate теж false, не падає', () => {
    const p = project(dataItemsFile([{ Id: 'ZP_Data_01', Enabled: true, Name: 'x', Description: '', Points: [] }]))
    const face = resolveDataItemFace(p, idx, 'ZP_Data_02')
    expect(face.configured).toBe(false)
    expect(face.duplicate).toBe(false)
  })
})

// ---- resolveSampleTypeFace: дзеркало resolveDataItemFace ВИЩЕ, для іншої родини
// (ZP_Sample_Base, SampleTypes.json, без Points -- зразок не здається напряму, спека §4a) ----

describe('resolveSampleTypeFace: виявлення "чи це зразок" -- isSampleClass(ZP_Sample_Base), НЕ префікс рядка', () => {
  test('ZP_Sample_07 (донор моделі родини) -- isSample=true навіть без запису в SampleTypes.json', () => {
    const p = project(sampleTypesFile([]))
    const face = resolveSampleTypeFace(p, idx, 'ZP_Sample_07')
    expect(face.isSample).toBe(true)
    expect(face.configured).toBe(false)
  })

  test('ZP_Data_01 (заготовка результату, НЕ зразок) -- isSample=false', () => {
    const p = project(sampleTypesFile([]))
    expect(resolveSampleTypeFace(p, idx, 'ZP_Data_01').isSample).toBe(false)
  })

  test('звичайна сировина (Apple, поза родиною ZP_Sample_Base) -- isSample=false', () => {
    const p = project(sampleTypesFile([]))
    expect(resolveSampleTypeFace(p, idx, 'Apple').isSample).toBe(false)
  })

  test('порожній класнейм -- isSample=false, без падіння', () => {
    const p = project(sampleTypesFile([]))
    const face = resolveSampleTypeFace(p, idx, '')
    expect(face.isSample).toBe(false)
    expect(face.configured).toBe(false)
  })
})

describe('resolveSampleTypeFace: запис знайдено -- ім\'я/опис/enabled з SampleTypes.json, кейс-інсенситивно', () => {
  test('точний регістр -- configured, name/description/enabled з запису, БЕЗ points у формі', () => {
    const p = project(sampleTypesFile([{ Id: 'ZP_Sample_01', Enabled: true, Name: 'Біозразок', Description: 'опис' }]))
    const face = resolveSampleTypeFace(p, idx, 'ZP_Sample_01')
    expect(face).toMatchObject({
      classname: 'ZP_Sample_01',
      isSample: true,
      configured: true,
      entryId: 'ZP_Sample_01',
      enabled: true,
      name: 'Біозразок',
      description: 'опис',
    })
    expect((face as unknown as { points?: unknown }).points).toBeUndefined()
  })

  test('запит іншим регістром (zp_sample_01) все одно резолвиться -- entryId лишається ЗБЕРЕЖЕНИМ регістром', () => {
    const p = project(sampleTypesFile([{ Id: 'ZP_Sample_01', Enabled: true, Name: 'Біозразок', Description: '' }]))
    const face = resolveSampleTypeFace(p, idx, 'zp_sample_01')
    expect(face.configured).toBe(true)
    expect(face.entryId).toBe('ZP_Sample_01')
    expect(face.name).toBe('Біозразок')
  })

  test('запис ВИМКНЕНИЙ (Enabled=false) -- configured=true, enabled=false', () => {
    const p = project(sampleTypesFile([{ Id: 'ZP_Sample_02', Enabled: false, Name: 'Вимкнений тип', Description: '' }]))
    const face = resolveSampleTypeFace(p, idx, 'ZP_Sample_02')
    expect(face.configured).toBe(true)
    expect(face.enabled).toBe(false)
    expect(face.name).toBe('Вимкнений тип')
  })
})

describe('resolveSampleTypeFace: запис НЕ знайдено -- "не налаштовано", честно як у грі', () => {
  test('SampleTypes.json завантажено, але без цього Id -- configured=false, name=classname (фолбек)', () => {
    const p = project(sampleTypesFile([{ Id: 'ZP_Sample_01', Enabled: true, Name: 'x', Description: '' }]))
    const face = resolveSampleTypeFace(p, idx, 'ZP_Sample_02')
    expect(face.configured).toBe(false)
    expect(face.name).toBe('ZP_Sample_02')
    expect(face.description).toBe('')
    expect(face.entryId).toBeUndefined()
  })

  test('SampleTypes.json взагалі НЕ завантажено (проєкт без такого файлу) -- не падає, configured=false', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([rule('r1')])))
    const face = resolveSampleTypeFace(p, idx, 'ZP_Sample_01')
    expect(face.isSample).toBe(true) // isSampleClass не залежить від SampleTypes.json
    expect(face.configured).toBe(false)
    expect(face.name).toBe('ZP_Sample_01')
  })
})

// ---- resolveSampleTypeFace: дублікат Id -- LAST-WINS, як сервер (ZP_SampleTypesConfig.c:
// 78-108, той самий зворотний обхід і "seen"-механізм, що ZP_DataItemsConfig.Validate) ------
describe('resolveSampleTypeFace: дублікат Id -- last-wins + позначка duplicate', () => {
  test('два записи з однаковим Id -- резолвиться ОСТАННІЙ (за порядком масиву), duplicate=true', () => {
    const p = project(
      sampleTypesFile([
        { Id: 'ZP_Sample_01', Enabled: true, Name: 'Перший (буде видалений сервером)', Description: 'd1' },
        { Id: 'ZP_Sample_01', Enabled: true, Name: 'Останній (виживе на сервері)', Description: 'd2' },
      ]),
    )
    const face = resolveSampleTypeFace(p, idx, 'ZP_Sample_01')
    expect(face.configured).toBe(true)
    expect(face.duplicate).toBe(true)
    expect(face.name).toBe('Останній (виживе на сервері)')
    expect(face.description).toBe('d2')
  })

  test('дублікат ІНШИМ регістром Id -- теж виявляється (кейс-інсенситивна лічба)', () => {
    const p = project(
      sampleTypesFile([
        { Id: 'ZP_Sample_01', Enabled: true, Name: 'A', Description: '' },
        { Id: 'zp_sample_01', Enabled: true, Name: 'B', Description: '' },
      ]),
    )
    const face = resolveSampleTypeFace(p, idx, 'ZP_SAMPLE_01')
    expect(face.duplicate).toBe(true)
    expect(face.name).toBe('B')
  })

  test('унікальний Id (без дублів) -- duplicate=false', () => {
    const p = project(sampleTypesFile([{ Id: 'ZP_Sample_01', Enabled: true, Name: 'x', Description: '' }]))
    expect(resolveSampleTypeFace(p, idx, 'ZP_Sample_01').duplicate).toBe(false)
  })
})
