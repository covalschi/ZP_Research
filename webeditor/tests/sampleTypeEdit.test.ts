// Тести мутаторів типів зразків SampleTypes.json (W2.5 Task 4) — дзеркало
// tests/dataItemEdit.test.ts (W2 Task 9): deep-copy до коміту (оригінал НЕ мутується),
// dirty=true лише на sampleTypes-файлі, ідентичність об'єктів ІНШИХ файлів зберігається,
// явна відмова на відсутньому файлі/Id/дублі, і байт-стабільність повторної канонізації.
// createSampleTypesFile -- ТРЕТЯ функція без аналога в dataItemEdit.test.ts: SampleTypes.json
// може бути відсутнім у ПРОЄКТІ цілком (не лише порожнім), на відміну від DataItems.json.

import { describe, test, expect } from 'vitest'
import { parseConfig } from '../src/io/parse'
import { SAMPLE_TYPES_SCHEMA, RULES_FILE_SCHEMA } from '../src/model/schema'
import { serialize } from '../src/io/jsonWriter'
import type { StorageBackend } from '../src/io/backend'
import type { Project, ProjectFile } from '../src/io/project'
import { applySampleTypeEdit, createSampleType, createSampleTypesFile } from '../src/io/sampleTypeEdit'

const dummyBackend: StorageBackend = {
  kind: 'zip',
  list: async () => [],
  read: async () => new Uint8Array(0),
  write: async () => {},
}

function sampleType(id: string, override: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Id: id,
    Enabled: true,
    Name: 'Назва',
    Description: 'Опис',
    ...override,
  }
}

function sampleTypesJson(items: Record<string, unknown>[]): string {
  return JSON.stringify({ ConfigVersion: 1, Items: items })
}

function sampleTypesFile(path: string, jsonText: string): ProjectFile {
  const { value, warnings } = parseConfig(SAMPLE_TYPES_SCHEMA, jsonText)
  return { path, kind: 'sampleTypes', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function rulesFile(path: string, jsonText: string): ProjectFile {
  const { value, warnings } = parseConfig(RULES_FILE_SCHEMA, jsonText)
  return { path, kind: 'rules', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function project(...files: ProjectFile[]): Project {
  return { files, backend: dummyBackend }
}

// ---- applySampleTypeEdit: щасливий шлях -----------------------------------------------------

describe('applySampleTypeEdit: щасливий шлях', () => {
  test('оновлює поле типу зразка й позначає файл dirty', () => {
    const p = project(sampleTypesFile('SampleTypes.json', sampleTypesJson([sampleType('ZP_Sample_01', { Name: 'стара' })])))
    const result = applySampleTypeEdit(p, 'ZP_Sample_01', (it) => {
      it.Name = 'нова'
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const doc = result.project.files[0].parsed as { Items: Record<string, unknown>[] }
    expect(doc.Items[0].Name).toBe('нова')
    expect(result.project.files[0].dirty).toBe(true)
  })

  test('НЕ мутує оригінальний Project/parsed — deep-copy до коміту', () => {
    const p = project(sampleTypesFile('SampleTypes.json', sampleTypesJson([sampleType('ZP_Sample_01', { Name: 'стара' })])))
    const originalDoc = p.files[0].parsed as { Items: Record<string, unknown>[] }
    const originalItemRef = originalDoc.Items[0]

    const result = applySampleTypeEdit(p, 'ZP_Sample_01', (it) => {
      it.Name = 'мутована-б-якби'
    })
    expect(result.ok).toBe(true)

    expect(p.files[0].dirty).toBe(false)
    expect(p.files[0].parsed).toBe(originalDoc)
    expect(originalDoc.Items[0]).toBe(originalItemRef)
    expect(originalDoc.Items[0].Name).toBe('стара')
  })

  test('повертає НОВИЙ Project і НОВИЙ files-масив (нове посилання)', () => {
    const p = project(sampleTypesFile('SampleTypes.json', sampleTypesJson([sampleType('ZP_Sample_01')])))
    const result = applySampleTypeEdit(p, 'ZP_Sample_01', (it) => {
      it.Description = 'x'
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project).not.toBe(p)
    expect(result.project.files).not.toBe(p.files)
  })

  test('ІНШІ файли проєкту (rules) зберігають ІДЕНТИЧНІСТЬ об\'єкта, не лише рівність вмісту', () => {
    const rulesF = rulesFile('ProcessingRules/a.json', JSON.stringify({ ConfigVersion: 1, Rules: [] }))
    const sampleF = sampleTypesFile('SampleTypes.json', sampleTypesJson([sampleType('ZP_Sample_01')]))
    const p = project(rulesF, sampleF)
    const result = applySampleTypeEdit(p, 'ZP_Sample_01', (it) => {
      it.Name = 'edited'
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.files[0]).toBe(rulesF) // rules-файл узагалі не займався
    expect(result.project.files[1]).not.toBe(sampleF) // sampleTypes-файл -- новий об'єкт (dirty)
    expect(result.project.files[0].dirty).toBe(false)
    expect(result.project.files[1].dirty).toBe(true)
  })

  test('послідовні правки: друга бере РЕЗУЛЬТАТ першої, перший виклик лишається незмінним', () => {
    const p = project(sampleTypesFile('SampleTypes.json', sampleTypesJson([sampleType('ZP_Sample_01', { Name: 'v0' })])))
    const r1 = applySampleTypeEdit(p, 'ZP_Sample_01', (it) => {
      it.Name = 'v1'
    })
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    const r2 = applySampleTypeEdit(r1.project, 'ZP_Sample_01', (it) => {
      it.Name = 'v2'
    })
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    const doc1 = r1.project.files[0].parsed as { Items: Record<string, unknown>[] }
    const doc2 = r2.project.files[0].parsed as { Items: Record<string, unknown>[] }
    expect(doc1.Items[0].Name).toBe('v1')
    expect(doc2.Items[0].Name).toBe('v2')
    const docOrig = p.files[0].parsed as { Items: Record<string, unknown>[] }
    expect(docOrig.Items[0].Name).toBe('v0')
  })
})

// ---- applySampleTypeEdit: відмови ------------------------------------------------------------

describe('applySampleTypeEdit: відмови', () => {
  test('SampleTypes.json не завантажено (проєкт без такого файлу) — явна відмова з поясненням', () => {
    const p = project(rulesFile('ProcessingRules/a.json', JSON.stringify({ ConfigVersion: 1, Rules: [] })))
    const result = applySampleTypeEdit(p, 'ZP_Sample_01', () => {})
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/не завантажено/i)
  })

  test('тип зразка з таким Id не знайдено — явна відмова, project не повертається', () => {
    const p = project(sampleTypesFile('SampleTypes.json', sampleTypesJson([sampleType('ZP_Sample_01')])))
    const result = applySampleTypeEdit(p, 'ZP_Sample_99', () => {})
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/не знайдено/i)
  })

  test('дублікат Id у SampleTypes.json — явна відмова, нічого не змінилось', () => {
    const p = project(sampleTypesFile('SampleTypes.json', sampleTypesJson([sampleType('dup', { Name: 'a' }), sampleType('dup', { Name: 'b' })])))
    const result = applySampleTypeEdit(p, 'dup', (it) => {
      it.Name = 'edited'
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/дубль/i)
    const doc = p.files[0].parsed as { Items: Record<string, unknown>[] }
    expect(doc.Items[0].Name).toBe('a')
    expect(doc.Items[1].Name).toBe('b')
    expect(p.files[0].dirty).toBe(false)
  })

  test('точна регістрова відповідність Id (НЕ кейс-інсенситивний, на відміну від резолву картки)', () => {
    const p = project(sampleTypesFile('SampleTypes.json', sampleTypesJson([sampleType('ZP_Sample_01')])))
    const result = applySampleTypeEdit(p, 'zp_sample_01', () => {})
    expect(result.ok).toBe(false)
  })
})

// ---- createSampleType ---------------------------------------------------------------------

describe('createSampleType: щасливий шлях', () => {
  test('додає новий запис із дефолтами Enforce-класу (без Points), позначає файл dirty', () => {
    const p = project(sampleTypesFile('SampleTypes.json', sampleTypesJson([])))
    const result = createSampleType(p, 'ZP_Sample_05')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const doc = result.project.files[0].parsed as { Items: Record<string, unknown>[] }
    expect(doc.Items).toHaveLength(1)
    expect(doc.Items[0]).toEqual({ Id: 'ZP_Sample_05', Enabled: true, Name: '', Description: '' })
    expect(result.project.files[0].dirty).toBe(true)
  })

  test('НЕ мутує оригінальний Project — deep-copy до коміту', () => {
    const p = project(sampleTypesFile('SampleTypes.json', sampleTypesJson([])))
    const originalDoc = p.files[0].parsed as { Items: Record<string, unknown>[] }
    createSampleType(p, 'ZP_Sample_05')
    expect(p.files[0].dirty).toBe(false)
    expect((p.files[0].parsed as { Items: unknown[] }).Items).toHaveLength(0)
    expect(p.files[0].parsed).toBe(originalDoc)
  })

  test('додає ПІСЛЯ наявних записів, не чіпає їх', () => {
    const p = project(sampleTypesFile('SampleTypes.json', sampleTypesJson([sampleType('ZP_Sample_01')])))
    const result = createSampleType(p, 'ZP_Sample_02')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const doc = result.project.files[0].parsed as { Items: Record<string, unknown>[] }
    expect(doc.Items).toHaveLength(2)
    expect(doc.Items[0].Id).toBe('ZP_Sample_01')
    expect(doc.Items[1].Id).toBe('ZP_Sample_02')
  })
})

describe('createSampleType: відмови', () => {
  test('SampleTypes.json не завантажено — явна відмова', () => {
    const p = project(rulesFile('ProcessingRules/a.json', JSON.stringify({ ConfigVersion: 1, Rules: [] })))
    const result = createSampleType(p, 'ZP_Sample_01')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/не завантажено/i)
  })

  test('запис уже існує (точний регістр) — відмова', () => {
    const p = project(sampleTypesFile('SampleTypes.json', sampleTypesJson([sampleType('ZP_Sample_01')])))
    const result = createSampleType(p, 'ZP_Sample_01')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/уже налаштований/i)
  })

  test('запис уже існує ІНШИМ регістром — теж відмова (гравова семантика, кейс-інсенситивно)', () => {
    const p = project(sampleTypesFile('SampleTypes.json', sampleTypesJson([sampleType('ZP_Sample_01')])))
    const result = createSampleType(p, 'zp_sample_01')
    expect(result.ok).toBe(false)
  })
})

// ---- createSampleTypesFile -----------------------------------------------------------------
// БЕЗ аналога в createDataItem/dataItemEdit.test.ts — DataItems.json живе в моді з M1 і
// практично гарантовано присутній у будь-якому реальному профілі; SampleTypes.json (W2.5)
// цілком реально відсутній у СТАРОМУ профілі/ZIP -- перший конфіг, який редактор уміє
// створити як ФАЙЛ (не лише як запис усередині вже наявного файлу).

describe('createSampleTypesFile: щасливий шлях', () => {
  test('додає НОВИЙ ProjectFile із канонічним порожнім документом, dirty=true', () => {
    const p = project(rulesFile('ProcessingRules/a.json', JSON.stringify({ ConfigVersion: 1, Rules: [] })))
    const result = createSampleTypesFile(p)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.files).toHaveLength(2)
    const newFile = result.project.files.find((f) => f.kind === 'sampleTypes')
    expect(newFile).toBeDefined()
    expect(newFile!.path).toBe('SampleTypes.json')
    expect(newFile!.dirty).toBe(true)
    expect(newFile!.parsed).toEqual({ ConfigVersion: 1, Items: [] })
  })

  test('НЕ чіпає інші файли проєкту (ідентичність об\'єкта)', () => {
    const rulesF = rulesFile('ProcessingRules/a.json', JSON.stringify({ ConfigVersion: 1, Rules: [] }))
    const p = project(rulesF)
    const result = createSampleTypesFile(p)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.files[0]).toBe(rulesF)
  })

  test('порожній проєкт (жодного файлу) -- теж працює, files стає [SampleTypes.json]', () => {
    const p = project()
    const result = createSampleTypesFile(p)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.files).toHaveLength(1)
    expect(result.project.files[0].kind).toBe('sampleTypes')
  })
})

describe('createSampleTypesFile: відмова', () => {
  test('файл уже є в проєкті -- явна відмова, project не повертається (без дублю файлу)', () => {
    const p = project(sampleTypesFile('SampleTypes.json', sampleTypesJson([])))
    const result = createSampleTypesFile(p)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/уже є/i)
  })
})

// ---- байт-стабільність повторної канонізації після правки -----------------------------------

describe('applySampleTypeEdit/createSampleType/createSampleTypesFile: байт-стабільність', () => {
  test('serialize(parsed) -> parse -> serialize дає ІДЕНТИЧНИЙ текст після applySampleTypeEdit', () => {
    const p = project(sampleTypesFile('SampleTypes.json', sampleTypesJson([sampleType('ZP_Sample_01', { Name: 'стара' })])))
    const result = applySampleTypeEdit(p, 'ZP_Sample_01', (it) => {
      it.Name = 'нова назва з юнікодом і "лапками"'
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const doc = result.project.files[0].parsed
    const firstPass = serialize(SAMPLE_TYPES_SCHEMA, doc)
    const reparsed = parseConfig(SAMPLE_TYPES_SCHEMA, firstPass)
    expect(reparsed.warnings).toEqual([])
    const secondPass = serialize(SAMPLE_TYPES_SCHEMA, reparsed.value)
    expect(secondPass).toBe(firstPass)
  })

  test('serialize(parsed) -> parse -> serialize дає ІДЕНТИЧНИЙ текст після createSampleType', () => {
    const p = project(sampleTypesFile('SampleTypes.json', sampleTypesJson([])))
    const result = createSampleType(p, 'ZP_Sample_10')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const doc = result.project.files[0].parsed
    const firstPass = serialize(SAMPLE_TYPES_SCHEMA, doc)
    const reparsed = parseConfig(SAMPLE_TYPES_SCHEMA, firstPass)
    expect(reparsed.warnings).toEqual([])
    const secondPass = serialize(SAMPLE_TYPES_SCHEMA, reparsed.value)
    expect(secondPass).toBe(firstPass)
  })

  test('serialize(parsed) дає gold-байти ({ConfigVersion:1,Items:[]}) одразу після createSampleTypesFile', () => {
    const p = project()
    const result = createSampleTypesFile(p)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const doc = result.project.files[0].parsed
    const bytes = serialize(SAMPLE_TYPES_SCHEMA, doc)
    expect(bytes).toBe('{\n    "ConfigVersion": 1,\n    "Items": []\n}')
  })
})
