// Тести мутатора applyRuleEdit (W2 Task 6, Step 1 — TDD ДО панелі/форми). Перевіряється
// САМЕ те, що вимагає бриф: deep-copy до коміту (оригінал НЕ мутується), dirty=true лише
// на зміненому файлі, ідентичність об'єктів НЕДИРТИ файлів зберігається (щоб T5-граф не
// перемальовувався даремно), відмова на дублікаті Id у файлі, і байт-стабільність
// повторної канонізації після правки (serialize -> parse -> serialize дає той самий текст).

import { describe, test, expect } from 'vitest'
import { parseConfig } from '../src/io/parse'
import { RULES_FILE_SCHEMA } from '../src/model/schema'
import { serialize } from '../src/io/jsonWriter'
import type { StorageBackend } from '../src/io/backend'
import type { Project, ProjectFile } from '../src/io/project'
import { applyRuleEdit } from '../src/io/ruleEdit'

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

describe('applyRuleEdit: щасливий шлях', () => {
  test('оновлює поле правила й позначає файл dirty', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([rule('r1', { TimeSec: 10 })])))
    const result = applyRuleEdit(p, 'ProcessingRules/a.json', 'r1', (r) => {
      r.TimeSec = 42
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const doc = result.project.files[0].parsed as { Rules: Record<string, unknown>[] }
    expect(doc.Rules[0].TimeSec).toBe(42)
    expect(result.project.files[0].dirty).toBe(true)
  })

  test('НЕ мутує оригінальний Project/parsed — deep-copy до коміту', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([rule('r1', { TimeSec: 10 })])))
    const originalDoc = p.files[0].parsed as { Rules: Record<string, unknown>[] }
    const originalRuleRef = originalDoc.Rules[0]

    const result = applyRuleEdit(p, 'ProcessingRules/a.json', 'r1', (r) => {
      r.TimeSec = 999
    })
    expect(result.ok).toBe(true)

    // Оригінальний Project.files[0] — той самий об'єкт, той самий parsed, те саме значення.
    expect(p.files[0].dirty).toBe(false)
    expect(p.files[0].parsed).toBe(originalDoc)
    expect(originalDoc.Rules[0]).toBe(originalRuleRef)
    expect(originalDoc.Rules[0].TimeSec).toBe(10)
  })

  test('повертає НОВИЙ Project і НОВИЙ files-масив (нове посилання)', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([rule('r1')])))
    const result = applyRuleEdit(p, 'ProcessingRules/a.json', 'r1', (r) => {
      r.Notes = 'x'
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project).not.toBe(p)
    expect(result.project.files).not.toBe(p.files)
  })

  test('НЕДИРТИ файли зберігають ІДЕНТИЧНІСТЬ об\'єкта (не лише рівність вмісту)', () => {
    const fileA = rulesFile('ProcessingRules/a.json', rulesJson([rule('a1')]))
    const fileB = rulesFile('ProcessingRules/b.json', rulesJson([rule('b1')]))
    const p = project(fileA, fileB)
    const result = applyRuleEdit(p, 'ProcessingRules/a.json', 'a1', (r) => {
      r.Notes = 'edited'
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Файл b — ТОЙ САМИЙ об'єкт, що й до виклику (React re-render його б не торкнувся).
    expect(result.project.files[1]).toBe(fileB)
    // Файл a — НОВИЙ об'єкт (dirty), не той самий, що вхідний fileA.
    expect(result.project.files[0]).not.toBe(fileA)
    expect(result.project.files[0].dirty).toBe(true)
    expect(result.project.files[1].dirty).toBe(false)
  })

  test('дозволяє послідовні правки: друга правка бере РЕЗУЛЬТАТ першої, перший виклик лишається незмінним', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([rule('r1', { TimeSec: 10 })])))
    const r1 = applyRuleEdit(p, 'ProcessingRules/a.json', 'r1', (r) => {
      r.TimeSec = 20
    })
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    const r2 = applyRuleEdit(r1.project, 'ProcessingRules/a.json', 'r1', (r) => {
      r.TimeSec = 30
    })
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    const doc1 = r1.project.files[0].parsed as { Rules: Record<string, unknown>[] }
    const doc2 = r2.project.files[0].parsed as { Rules: Record<string, unknown>[] }
    expect(doc1.Rules[0].TimeSec).toBe(20) // r1 незмінний після r2
    expect(doc2.Rules[0].TimeSec).toBe(30)
    // Оригінальний p узагалі не займався.
    const docOrig = p.files[0].parsed as { Rules: Record<string, unknown>[] }
    expect(docOrig.Rules[0].TimeSec).toBe(10)
  })
})

describe('applyRuleEdit: відмови', () => {
  test('дублікат Id в ОДНОМУ файлі — явна відмова, project не повертається', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([rule('dup'), rule('dup')])))
    const result = applyRuleEdit(p, 'ProcessingRules/a.json', 'dup', (r) => {
      r.TimeSec = 999
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/дубль/i)
    // Нічого не змінилось.
    const doc = p.files[0].parsed as { Rules: Record<string, unknown>[] }
    expect(doc.Rules[0].TimeSec).toBe(10)
    expect(doc.Rules[1].TimeSec).toBe(10)
    expect(p.files[0].dirty).toBe(false)
  })

  test('дублікат Id У РІЗНИХ файлах — НЕ заважає редагувати ОДИН з них за filePath+ruleId', () => {
    const p = project(
      rulesFile('ProcessingRules/a.json', rulesJson([rule('dup', { Notes: 'a' })])),
      rulesFile('ProcessingRules/b.json', rulesJson([rule('dup', { Notes: 'b' })])),
    )
    const result = applyRuleEdit(p, 'ProcessingRules/a.json', 'dup', (r) => {
      r.Notes = 'edited-a'
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const docA = result.project.files[0].parsed as { Rules: Record<string, unknown>[] }
    const docB = result.project.files[1].parsed as { Rules: Record<string, unknown>[] }
    expect(docA.Rules[0].Notes).toBe('edited-a')
    expect(docB.Rules[0].Notes).toBe('b') // файл b узагалі не займався (composite filePath+ruleId)
    expect(result.project.files[1]).toBe(p.files[1]) // ідентичність збережена
  })

  test('файл не знайдено', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([rule('r1')])))
    const result = applyRuleEdit(p, 'ProcessingRules/nope.json', 'r1', () => {})
    expect(result.ok).toBe(false)
  })

  test('правило не знайдено у файлі', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([rule('r1')])))
    const result = applyRuleEdit(p, 'ProcessingRules/a.json', 'nope', () => {})
    expect(result.ok).toBe(false)
  })

  test('не-rules файл (foreign) — відмова, foreign ніколи не редагується панеллю', () => {
    const foreign: ProjectFile = {
      path: 'FactionData/ecolog.json',
      kind: 'foreign',
      originalBytes: new Uint8Array(0),
      warnings: [],
      dirty: false,
    }
    const p = project(foreign)
    const result = applyRuleEdit(p, 'FactionData/ecolog.json', 'anything', () => {})
    expect(result.ok).toBe(false)
  })
})

describe('applyRuleEdit: байт-стабільність повторної канонізації після правки', () => {
  test('serialize(parsed) -> parse -> serialize дає ІДЕНТИЧНИЙ текст (правка сама по собі канонічна)', () => {
    const p = project(
      rulesFile(
        'ProcessingRules/a.json',
        rulesJson([rule('r1', { TimeSec: 10, BasePurityMin: 0.4, Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'x' }] })]),
      ),
    )
    const result = applyRuleEdit(p, 'ProcessingRules/a.json', 'r1', (r) => {
      r.TimeSec = 15.5
      ;(r.Outputs as Record<string, unknown>[])[0].Content = 'chimera_claw'
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const doc = result.project.files[0].parsed
    const firstPass = serialize(RULES_FILE_SCHEMA, doc)
    const reparsed = parseConfig(RULES_FILE_SCHEMA, firstPass)
    expect(reparsed.warnings).toEqual([]) // канонічний текст не породжує жодного попередження
    const secondPass = serialize(RULES_FILE_SCHEMA, reparsed.value)
    expect(secondPass).toBe(firstPass) // ідемпотентність: другий прохід == перший
  })
})
