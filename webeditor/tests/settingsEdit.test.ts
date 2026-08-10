// Тести мутатора Settings.json (W4 Task 1). Settings — ЄДИНИЙ конфіг без колекції записів
// (плаский об'єкт полів), тож мутатор один: applySettingsEdit(project, updater) — точкова
// правка полів над structuredClone-копією документа. createSettingsFile НЕ робиться свідомо:
// Settings.json сервер створює й перезаписує на КОЖНОМУ буті (load-then-save,
// ZP_ConfigService.c:186-197) — у будь-якому реальному профілі він є (той самий аргумент,
// чому dataItemEdit не має createDataItemsFile, на відміну від SampleTypes.json W2.5).

import { describe, test, expect } from 'vitest'
import { parseConfig } from '../src/io/parse'
import { SETTINGS_SCHEMA, RULES_FILE_SCHEMA } from '../src/model/schema'
import { serialize } from '../src/io/jsonWriter'
import type { StorageBackend } from '../src/io/backend'
import type { Project, ProjectFile } from '../src/io/project'
import { applySettingsEdit } from '../src/io/settingsEdit'

const dummyBackend: StorageBackend = {
  kind: 'zip',
  list: async () => [],
  read: async () => new Uint8Array(0),
  write: async () => {},
}

function settingsFile(override: Record<string, unknown> = {}): ProjectFile {
  const doc = {
    ConfigVersion: 1,
    DebugMode: true,
    AdminIds: ['76561198000000001'],
    DefaultFaction: 'default',
    TreeTerminalClasses: ['ZP_LabComputer'],
    TreeVisibilityDepth: 1,
    TreeBackgroundImage: '',
    ...override,
  }
  const { value, warnings } = parseConfig(SETTINGS_SCHEMA, JSON.stringify(doc))
  return { path: 'Settings.json', kind: 'settings', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function rulesFile(path: string): ProjectFile {
  const { value, warnings } = parseConfig(RULES_FILE_SCHEMA, JSON.stringify({ ConfigVersion: 1, Rules: [] }))
  return { path, kind: 'rules', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function project(...files: ProjectFile[]): Project {
  return { files, backend: dummyBackend }
}

describe('applySettingsEdit', () => {
  test('точкова правка поля, dirty=true, оригінал не мутовано', () => {
    const p = project(settingsFile({ TreeVisibilityDepth: 1 }))
    const result = applySettingsEdit(p, (s) => {
      s.TreeVisibilityDepth = 3
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((result.project.files[0].parsed as Record<string, unknown>).TreeVisibilityDepth).toBe(3)
    expect(result.project.files[0].dirty).toBe(true)
    expect((p.files[0].parsed as Record<string, unknown>).TreeVisibilityDepth).toBe(1)
    expect(p.files[0].dirty).toBe(false)
  })

  test('правка масиву (TreeTerminalClasses) — копія глибока, оригінальний масив не чіпається', () => {
    const p = project(settingsFile({ TreeTerminalClasses: ['ZP_LabComputer'] }))
    const originalArr = (p.files[0].parsed as Record<string, unknown>).TreeTerminalClasses
    const result = applySettingsEdit(p, (s) => {
      ;(s.TreeTerminalClasses as string[]).push('Land_Furniture_radiostation1')
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((result.project.files[0].parsed as Record<string, unknown>).TreeTerminalClasses).toEqual([
      'ZP_LabComputer',
      'Land_Furniture_radiostation1',
    ])
    expect(originalArr).toEqual(['ZP_LabComputer'])
  })

  test('ІНШІ файли зберігають ідентичність', () => {
    const rulesF = rulesFile('ProcessingRules/a.json')
    const p = project(rulesF, settingsFile())
    const result = applySettingsEdit(p, (s) => {
      s.DebugMode = false
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.files[0]).toBe(rulesF)
    expect(result.project.files[1]).not.toBe(p.files[1])
  })

  test('Settings.json не завантажено — явна відмова', () => {
    const p = project(rulesFile('ProcessingRules/a.json'))
    const result = applySettingsEdit(p, () => {})
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/не завантажено/i)
  })

  test('послідовні правки: друга бере результат першої', () => {
    const p = project(settingsFile({ DebugMode: true }))
    const r1 = applySettingsEdit(p, (s) => {
      s.DebugMode = false
    })
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    const r2 = applySettingsEdit(r1.project, (s) => {
      s.DefaultFaction = 'ecolog'
    })
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    const doc = r2.project.files[0].parsed as Record<string, unknown>
    expect(doc.DebugMode).toBe(false)
    expect(doc.DefaultFaction).toBe('ecolog')
  })
})

describe('settingsEdit: байт-стабільність повторної канонізації', () => {
  test('serialize -> parse -> serialize ідентичний після applySettingsEdit', () => {
    const p = project(settingsFile())
    const result = applySettingsEdit(p, (s) => {
      s.TreeBackgroundImage = 'ZP_Research/gui/textures/tree_bg.edds'
      ;(s.AdminIds as string[]).push('76561198000000002')
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const doc = result.project.files[0].parsed
    const firstPass = serialize(SETTINGS_SCHEMA, doc)
    const reparsed = parseConfig(SETTINGS_SCHEMA, firstPass)
    expect(reparsed.warnings).toEqual([])
    const secondPass = serialize(SETTINGS_SCHEMA, reparsed.value)
    expect(secondPass).toBe(firstPass)
  })
})
