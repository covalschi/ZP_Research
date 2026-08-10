// Тести мутатора модулів Modules.json (W4 Task 1) — контракт dataItemEdit/sampleTypeEdit.
// Ключ запису — Classname, збіг ТОЧНИЙ == (дзеркало OpUpsertModule,
// ZP_ConfigService.c:1385: `md.Classname == incoming.Classname`); створення відмовляє на
// дублі КЕЙС-ІНСЕНСИТИВНО (конвенція uniqueId: рантайм-лукапи AllowedOn/SumBonus ідуть
// через MatchClass/IsKindOf — регістронезалежні); deleteModule видаляє ВСІ точні збіги
// (дзеркало OpDeleteModule :1427-1435 — foreach з continue прибирає кожен збіг) — це
// заодно і шлях ремонту дубля класу.

import { describe, test, expect } from 'vitest'
import { parseConfig } from '../src/io/parse'
import { MODULES_SCHEMA, RULES_FILE_SCHEMA } from '../src/model/schema'
import { serialize } from '../src/io/jsonWriter'
import type { StorageBackend } from '../src/io/backend'
import type { Project, ProjectFile } from '../src/io/project'
import { applyModuleEdit, createModule, deleteModule, renameModule } from '../src/io/moduleEdit'

const dummyBackend: StorageBackend = {
  kind: 'zip',
  list: async () => [],
  read: async () => new Uint8Array(0),
  write: async () => {},
}

function moduleDef(cls: string, override: Record<string, unknown> = {}): Record<string, unknown> {
  return { Classname: cls, PurityBonus: 0.2, Devices: [], Notes: '', ...override }
}

function modulesFile(modules: Record<string, unknown>[]): ProjectFile {
  const { value, warnings } = parseConfig(MODULES_SCHEMA, JSON.stringify({ ConfigVersion: 1, Modules: modules }))
  return { path: 'Modules.json', kind: 'modules', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function rulesFile(path: string): ProjectFile {
  const { value, warnings } = parseConfig(RULES_FILE_SCHEMA, JSON.stringify({ ConfigVersion: 1, Rules: [] }))
  return { path, kind: 'rules', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function project(...files: ProjectFile[]): Project {
  return { files, backend: dummyBackend }
}

function docOf(p: Project): { Modules: Record<string, unknown>[] } {
  return p.files.find((x) => x.kind === 'modules')!.parsed as { Modules: Record<string, unknown>[] }
}

describe('applyModuleEdit', () => {
  test('оновлює поле модуля, dirty=true, оригінал не мутовано, інші файли — ідентичність', () => {
    const rulesF = rulesFile('ProcessingRules/a.json')
    const p = project(rulesF, modulesFile([moduleDef('ZP_Tool_Optics', { PurityBonus: 0.2 })]))
    const result = applyModuleEdit(p, 'ZP_Tool_Optics', (m) => {
      m.PurityBonus = 0.5
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(docOf(result.project).Modules[0].PurityBonus).toBe(0.5)
    expect(result.project.files.find((f) => f.kind === 'modules')!.dirty).toBe(true)
    expect(result.project.files[0]).toBe(rulesF)
    // parseConfig квантує float через Math.fround (дзеркало float32 рушія, W1)
    expect(docOf(p).Modules[0].PurityBonus).toBe(Math.fround(0.2))
    expect(p.files[1].dirty).toBe(false)
  })

  test('відмови: файл не завантажено / клас не знайдено / інший регістр / дубль', () => {
    expect(applyModuleEdit(project(rulesFile('ProcessingRules/a.json')), 'X', () => {}).ok).toBe(false)
    const p = project(modulesFile([moduleDef('ZP_Tool_Optics')]))
    expect(applyModuleEdit(p, 'no_such', () => {}).ok).toBe(false)
    expect(applyModuleEdit(p, 'zp_tool_optics', () => {}).ok).toBe(false)
    const dup = project(modulesFile([moduleDef('dup'), moduleDef('dup')]))
    const r = applyModuleEdit(dup, 'dup', () => {})
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/дубль/i)
  })
})

describe('createModule', () => {
  test('додає модуль із дефолтами Enforce-класу ZP_ModuleDef', () => {
    const p = project(modulesFile([]))
    const result = createModule(p, 'ZP_Tool_Lens')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const doc = docOf(result.project)
    expect(doc.Modules).toHaveLength(1)
    expect(doc.Modules[0]).toEqual({ Classname: 'ZP_Tool_Lens', PurityBonus: 0, Devices: [], Notes: '' })
    expect(result.project.files[0].dirty).toBe(true)
  })

  test('порожній Classname — відмова (дзеркало OpUpsertModule :1373-1376)', () => {
    const p = project(modulesFile([]))
    expect(createModule(p, '  ').ok).toBe(false)
  })

  test('дубль — відмова, у т.ч. іншим регістром (конвенція uniqueId)', () => {
    const p = project(modulesFile([moduleDef('ZP_Tool_Optics')]))
    expect(createModule(p, 'ZP_Tool_Optics').ok).toBe(false)
    expect(createModule(p, 'zp_tool_optics').ok).toBe(false)
  })
})

describe('deleteModule', () => {
  test('видаляє запис за точним Classname', () => {
    const p = project(modulesFile([moduleDef('a'), moduleDef('b')]))
    const result = deleteModule(p, 'a')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(docOf(result.project).Modules).toHaveLength(1)
    expect(docOf(result.project).Modules[0].Classname).toBe('b')
  })

  test('дубль класу — видаляє ВСІ точні збіги (дзеркало OpDeleteModule :1427-1435), це шлях ремонту дубля', () => {
    const p = project(modulesFile([moduleDef('dup'), moduleDef('keep'), moduleDef('dup')]))
    const result = deleteModule(p, 'dup')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(docOf(result.project).Modules).toHaveLength(1)
    expect(docOf(result.project).Modules[0].Classname).toBe('keep')
  })

  test('клас не знайдено — відмова (у т.ч. інший регістр: збіг точний, як на сервері)', () => {
    const p = project(modulesFile([moduleDef('ZP_Tool_Optics')]))
    expect(deleteModule(p, 'zzz').ok).toBe(false)
    expect(deleteModule(p, 'zp_tool_optics').ok).toBe(false)
  })
})

describe('renameModule (W4 Task 3): прецедент renamePointType', () => {
  test('перейменовує Classname, dirty=true, оригінал не мутовано', () => {
    const p = project(modulesFile([moduleDef('ZP_Tool_Optics')]))
    const result = renameModule(p, 'ZP_Tool_Optics', 'ZP_Tool_Lens')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(docOf(result.project).Modules[0].Classname).toBe('ZP_Tool_Lens')
    expect(result.project.files[0].dirty).toBe(true)
    expect(docOf(p).Modules[0].Classname).toBe('ZP_Tool_Optics')
  })

  test('порожній новий Classname — відмова (дзеркало OpUpsertModule :1373-1376)', () => {
    const p = project(modulesFile([moduleDef('ZP_Tool_Optics')]))
    expect(renameModule(p, 'ZP_Tool_Optics', '  ').ok).toBe(false)
  })

  test('той самий Classname — no-op (ok, той самий project)', () => {
    const p = project(modulesFile([moduleDef('ZP_Tool_Optics')]))
    const result = renameModule(p, 'ZP_Tool_Optics', 'ZP_Tool_Optics')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project).toBe(p)
  })

  test('дубль із ЧУЖИМ класом — відмова, у т.ч. іншим регістром (MatchClass регістронезалежний)', () => {
    const p = project(modulesFile([moduleDef('a'), moduleDef('b')]))
    expect(renameModule(p, 'a', 'b').ok).toBe(false)
    expect(renameModule(p, 'a', 'B').ok).toBe(false)
  })

  test('зміна лише регістру ВЛАСНОГО класу — легальна; при рукописному кейс-близнюку — відмова', () => {
    const p = project(modulesFile([moduleDef('lens')]))
    const result = renameModule(p, 'lens', 'Lens')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(docOf(result.project).Modules[0].Classname).toBe('Lens')
    const twins = project(modulesFile([moduleDef('lens'), moduleDef('Lens')]))
    expect(renameModule(twins, 'lens', 'Lens').ok).toBe(false)
  })

  test('старий клас не знайдено / дубль старого — відмова', () => {
    const p = project(modulesFile([moduleDef('a')]))
    expect(renameModule(p, 'zzz', 'yyy').ok).toBe(false)
    const dup = project(modulesFile([moduleDef('dup'), moduleDef('dup')]))
    expect(renameModule(dup, 'dup', 'other').ok).toBe(false)
  })
})

describe('moduleEdit: байт-стабільність повторної канонізації', () => {
  test('serialize -> parse -> serialize ідентичний після createModule + applyModuleEdit', () => {
    const p = project(modulesFile([moduleDef('ZP_Tool_Optics')]))
    const r1 = createModule(p, 'ZP_Tool_Lens')
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    const r2 = applyModuleEdit(r1.project, 'ZP_Tool_Lens', (m) => {
      m.PurityBonus = 0.30000001192092896
      ;(m.Devices as string[]).push('ZP_Microscope')
      m.Notes = 'лінза з "лапками"'
    })
    expect(r2.ok).toBe(true)
    if (!r2.ok) return

    const doc = r2.project.files[0].parsed
    const firstPass = serialize(MODULES_SCHEMA, doc)
    const reparsed = parseConfig(MODULES_SCHEMA, firstPass)
    expect(reparsed.warnings).toEqual([])
    const secondPass = serialize(MODULES_SCHEMA, reparsed.value)
    expect(secondPass).toBe(firstPass)
  })
})
