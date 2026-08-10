// Тести мутаторів заготовок DataItems.json (W2 Task 9) — дзеркало ruleEdit.test.ts (T6):
// deep-copy до коміту (оригінал НЕ мутується), dirty=true лише на dataItems-файлі,
// ідентичність об'єктів ІНШИХ файлів (rules/settings/...) зберігається, явна відмова на
// відсутньому файлі/Id/дублі, і байт-стабільність повторної канонізації після правки.
// createDataItem — окрема функція (не "тихе створення" всередині applyDataItemEdit):
// той самий поділ, що й у DataItemQuickEdit.tsx ("не налаштовано" -> явна кнопка "створити").

import { describe, test, expect } from 'vitest'
import { parseConfig } from '../src/io/parse'
import { DATA_ITEMS_SCHEMA, RULES_FILE_SCHEMA } from '../src/model/schema'
import { serialize } from '../src/io/jsonWriter'
import type { StorageBackend } from '../src/io/backend'
import type { Project, ProjectFile } from '../src/io/project'
import { applyDataItemEdit, createDataItem } from '../src/io/dataItemEdit'

const dummyBackend: StorageBackend = {
  kind: 'zip',
  list: async () => [],
  read: async () => new Uint8Array(0),
  write: async () => {},
}

function dataItem(id: string, override: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Id: id,
    Enabled: true,
    Name: 'Назва',
    Description: 'Опис',
    Points: [{ Type: 'bio_lab_t1', Amount: 5 }],
    ...override,
  }
}

function dataItemsJson(items: Record<string, unknown>[]): string {
  return JSON.stringify({ ConfigVersion: 1, Items: items })
}

function dataItemsFile(path: string, jsonText: string): ProjectFile {
  const { value, warnings } = parseConfig(DATA_ITEMS_SCHEMA, jsonText)
  return { path, kind: 'dataItems', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function rulesFile(path: string, jsonText: string): ProjectFile {
  const { value, warnings } = parseConfig(RULES_FILE_SCHEMA, jsonText)
  return { path, kind: 'rules', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function project(...files: ProjectFile[]): Project {
  return { files, backend: dummyBackend }
}

// ---- applyDataItemEdit: щасливий шлях -------------------------------------------------------

describe('applyDataItemEdit: щасливий шлях', () => {
  test('оновлює поле заготовки й позначає файл dirty', () => {
    const p = project(dataItemsFile('DataItems.json', dataItemsJson([dataItem('ZP_Data_01', { Name: 'стара' })])))
    const result = applyDataItemEdit(p, 'ZP_Data_01', (it) => {
      it.Name = 'нова'
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const doc = result.project.files[0].parsed as { Items: Record<string, unknown>[] }
    expect(doc.Items[0].Name).toBe('нова')
    expect(result.project.files[0].dirty).toBe(true)
  })

  test('НЕ мутує оригінальний Project/parsed — deep-copy до коміту', () => {
    const p = project(dataItemsFile('DataItems.json', dataItemsJson([dataItem('ZP_Data_01', { Name: 'стара' })])))
    const originalDoc = p.files[0].parsed as { Items: Record<string, unknown>[] }
    const originalItemRef = originalDoc.Items[0]

    const result = applyDataItemEdit(p, 'ZP_Data_01', (it) => {
      it.Name = 'мутована-б-якби'
    })
    expect(result.ok).toBe(true)

    expect(p.files[0].dirty).toBe(false)
    expect(p.files[0].parsed).toBe(originalDoc)
    expect(originalDoc.Items[0]).toBe(originalItemRef)
    expect(originalDoc.Items[0].Name).toBe('стара')
  })

  test('повертає НОВИЙ Project і НОВИЙ files-масив (нове посилання)', () => {
    const p = project(dataItemsFile('DataItems.json', dataItemsJson([dataItem('ZP_Data_01')])))
    const result = applyDataItemEdit(p, 'ZP_Data_01', (it) => {
      it.Description = 'x'
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project).not.toBe(p)
    expect(result.project.files).not.toBe(p.files)
  })

  test('ІНШІ файли проєкту (rules) зберігають ІДЕНТИЧНІСТЬ об\'єкта, не лише рівність вмісту', () => {
    const rulesF = rulesFile('ProcessingRules/a.json', JSON.stringify({ ConfigVersion: 1, Rules: [] }))
    const dataF = dataItemsFile('DataItems.json', dataItemsJson([dataItem('ZP_Data_01')]))
    const p = project(rulesF, dataF)
    const result = applyDataItemEdit(p, 'ZP_Data_01', (it) => {
      it.Name = 'edited'
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.files[0]).toBe(rulesF) // rules-файл узагалі не займався
    expect(result.project.files[1]).not.toBe(dataF) // dataItems-файл -- новий об'єкт (dirty)
    expect(result.project.files[0].dirty).toBe(false)
    expect(result.project.files[1].dirty).toBe(true)
  })

  test('послідовні правки: друга бере РЕЗУЛЬТАТ першої, перший виклик лишається незмінним', () => {
    const p = project(dataItemsFile('DataItems.json', dataItemsJson([dataItem('ZP_Data_01', { Name: 'v0' })])))
    const r1 = applyDataItemEdit(p, 'ZP_Data_01', (it) => {
      it.Name = 'v1'
    })
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    const r2 = applyDataItemEdit(r1.project, 'ZP_Data_01', (it) => {
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

// ---- applyDataItemEdit: відмови ---------------------------------------------------------------

describe('applyDataItemEdit: відмови', () => {
  test('DataItems.json не завантажено (проєкт без такого файлу) — явна відмова з поясненням', () => {
    const p = project(rulesFile('ProcessingRules/a.json', JSON.stringify({ ConfigVersion: 1, Rules: [] })))
    const result = applyDataItemEdit(p, 'ZP_Data_01', () => {})
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/не завантажено/i)
  })

  test('заготовку з таким Id не знайдено — явна відмова, project не повертається', () => {
    const p = project(dataItemsFile('DataItems.json', dataItemsJson([dataItem('ZP_Data_01')])))
    const result = applyDataItemEdit(p, 'ZP_Data_99', () => {})
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/не знайдено/i)
  })

  test('дублікат Id у DataItems.json — явна відмова, нічого не змінилось', () => {
    const p = project(dataItemsFile('DataItems.json', dataItemsJson([dataItem('dup', { Name: 'a' }), dataItem('dup', { Name: 'b' })])))
    const result = applyDataItemEdit(p, 'dup', (it) => {
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

  test('точна регістрова відповідність Id (applyDataItemEdit — НЕ кейс-інсенситивний, на відміну від резолву картки)', () => {
    const p = project(dataItemsFile('DataItems.json', dataItemsJson([dataItem('ZP_Data_01')])))
    const result = applyDataItemEdit(p, 'zp_data_01', () => {})
    expect(result.ok).toBe(false)
  })
})

// ---- createDataItem -----------------------------------------------------------------------

describe('createDataItem: щасливий шлях', () => {
  test('додає новий запис із дефолтами Enforce-класу, позначає файл dirty', () => {
    const p = project(dataItemsFile('DataItems.json', dataItemsJson([])))
    const result = createDataItem(p, 'ZP_Data_05')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const doc = result.project.files[0].parsed as { Items: Record<string, unknown>[] }
    expect(doc.Items).toHaveLength(1)
    expect(doc.Items[0]).toEqual({ Id: 'ZP_Data_05', Enabled: true, Name: '', Description: '', Points: [] })
    expect(result.project.files[0].dirty).toBe(true)
  })

  test('НЕ мутує оригінальний Project — deep-copy до коміту', () => {
    const p = project(dataItemsFile('DataItems.json', dataItemsJson([])))
    const originalDoc = p.files[0].parsed as { Items: Record<string, unknown>[] }
    createDataItem(p, 'ZP_Data_05')
    expect(p.files[0].dirty).toBe(false)
    expect((p.files[0].parsed as { Items: unknown[] }).Items).toHaveLength(0)
    expect(p.files[0].parsed).toBe(originalDoc)
  })

  test('додає ПІСЛЯ наявних записів, не чіпає їх', () => {
    const p = project(dataItemsFile('DataItems.json', dataItemsJson([dataItem('ZP_Data_01')])))
    const result = createDataItem(p, 'ZP_Data_02')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const doc = result.project.files[0].parsed as { Items: Record<string, unknown>[] }
    expect(doc.Items).toHaveLength(2)
    expect(doc.Items[0].Id).toBe('ZP_Data_01')
    expect(doc.Items[1].Id).toBe('ZP_Data_02')
  })
})

describe('createDataItem: відмови', () => {
  test('DataItems.json не завантажено — явна відмова', () => {
    const p = project(rulesFile('ProcessingRules/a.json', JSON.stringify({ ConfigVersion: 1, Rules: [] })))
    const result = createDataItem(p, 'ZP_Data_01')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/не завантажено/i)
  })

  test('запис уже існує (точний регістр) — відмова', () => {
    const p = project(dataItemsFile('DataItems.json', dataItemsJson([dataItem('ZP_Data_01')])))
    const result = createDataItem(p, 'ZP_Data_01')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/уже налаштована/i)
  })

  test('запис уже існує ІНШИМ регістром — теж відмова (гравова семантика, кейс-інсенситивно)', () => {
    const p = project(dataItemsFile('DataItems.json', dataItemsJson([dataItem('ZP_Data_01')])))
    const result = createDataItem(p, 'zp_data_01')
    expect(result.ok).toBe(false)
  })
})

// ---- байт-стабільність повторної канонізації після правки -----------------------------------

describe('applyDataItemEdit/createDataItem: байт-стабільність повторної канонізації', () => {
  test('serialize(parsed) -> parse -> serialize дає ІДЕНТИЧНИЙ текст після applyDataItemEdit', () => {
    const p = project(dataItemsFile('DataItems.json', dataItemsJson([dataItem('ZP_Data_01', { Name: 'стара' })])))
    const result = applyDataItemEdit(p, 'ZP_Data_01', (it) => {
      it.Name = 'нова назва з юнікодом і "лапками"'
      ;(it.Points as Record<string, unknown>[]).push({ Type: 'electronics_field_t2', Amount: 3 })
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const doc = result.project.files[0].parsed
    const firstPass = serialize(DATA_ITEMS_SCHEMA, doc)
    const reparsed = parseConfig(DATA_ITEMS_SCHEMA, firstPass)
    expect(reparsed.warnings).toEqual([])
    const secondPass = serialize(DATA_ITEMS_SCHEMA, reparsed.value)
    expect(secondPass).toBe(firstPass)
  })

  test('serialize(parsed) -> parse -> serialize дає ІДЕНТИЧНИЙ текст після createDataItem', () => {
    const p = project(dataItemsFile('DataItems.json', dataItemsJson([])))
    const result = createDataItem(p, 'ZP_Data_10')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const doc = result.project.files[0].parsed
    const firstPass = serialize(DATA_ITEMS_SCHEMA, doc)
    const reparsed = parseConfig(DATA_ITEMS_SCHEMA, firstPass)
    expect(reparsed.warnings).toEqual([])
    const secondPass = serialize(DATA_ITEMS_SCHEMA, reparsed.value)
    expect(secondPass).toBe(firstPass)
  })
})
