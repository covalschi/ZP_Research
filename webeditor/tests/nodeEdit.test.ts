// Тести мутатора applyNodeEdit (W3 Task 2, TDD ДО полотна). Дзеркальна дисципліна
// applyRuleEdit (io/ruleEdit.ts, tests/ruleEdit.test.ts): deep-copy до коміту (оригінал НЕ
// мутується), dirty=true лише на зміненому файлі, ідентичність об'єктів НЕДИРТИ файлів
// зберігається (React перемальовує лише змінене), відмова на дублікаті Id вузла У ФАЙЛІ
// (мовчазна правка «першого-ліпшого» близнюка правила б не те, що адмін тягнув мишею),
// байт-стабільність повторної канонізації після правки.

import { describe, test, expect } from 'vitest'
import { parseConfig } from '../src/io/parse'
import { TECH_TREE_SCHEMA } from '../src/model/schema'
import { serialize } from '../src/io/jsonWriter'
import type { StorageBackend } from '../src/io/backend'
import type { Project, ProjectFile } from '../src/io/project'
import { applyNodeEdit } from '../src/io/nodeEdit'

const dummyBackend: StorageBackend = {
  kind: 'zip',
  list: async () => [],
  read: async () => new Uint8Array(0),
  write: async () => {},
}

function node(id: string, override: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Id: id,
    Name: `Вузол ${id}`,
    Description: '',
    Icon: '',
    Tier: 1,
    Parents: [],
    ParentsMode: 'all',
    Cost: [],
    ItemCost: [],
    ResearchTimeSec: 0,
    RequiredFactions: [],
    ...override,
  }
}

function branchJson(branchId: string, nodes: Record<string, unknown>[]): string {
  return JSON.stringify({
    ConfigVersion: 1,
    Branch: { Id: branchId, Name: branchId, Icon: '', SortOrder: 1, Factions: [] },
    Nodes: nodes,
  })
}

function techTreeFile(path: string, jsonText: string): ProjectFile {
  const { value, warnings } = parseConfig(TECH_TREE_SCHEMA, jsonText)
  return { path, kind: 'techTree', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function project(...files: ProjectFile[]): Project {
  return { files, backend: dummyBackend }
}

type Doc = { Nodes: Record<string, unknown>[] }

describe('applyNodeEdit: щасливий шлях', () => {
  test('оновлює Tier вузла й позначає файл dirty (кейс драгу T2)', () => {
    const p = project(techTreeFile('TechTree/zone.json', branchJson('zone', [node('a', { Tier: 1 })])))
    const result = applyNodeEdit(p, 'TechTree/zone.json', 'a', (n) => {
      n.Tier = 3
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const doc = result.project.files[0].parsed as Doc
    expect(doc.Nodes[0].Tier).toBe(3)
    expect(result.project.files[0].dirty).toBe(true)
  })

  test('НЕ мутує оригінальний Project/parsed — deep-copy до коміту', () => {
    const p = project(techTreeFile('TechTree/zone.json', branchJson('zone', [node('a', { Tier: 1 })])))
    const originalDoc = p.files[0].parsed as Doc
    const originalNodeRef = originalDoc.Nodes[0]

    const result = applyNodeEdit(p, 'TechTree/zone.json', 'a', (n) => {
      n.Tier = 9
    })
    expect(result.ok).toBe(true)

    expect(p.files[0].dirty).toBe(false)
    expect(p.files[0].parsed).toBe(originalDoc)
    expect(originalDoc.Nodes[0]).toBe(originalNodeRef)
    expect(originalDoc.Nodes[0].Tier).toBe(1)
  })

  test('повертає НОВИЙ Project і НОВИЙ files-масив (нове посилання)', () => {
    const p = project(techTreeFile('TechTree/zone.json', branchJson('zone', [node('a')])))
    const result = applyNodeEdit(p, 'TechTree/zone.json', 'a', (n) => {
      n.Description = 'x'
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project).not.toBe(p)
    expect(result.project.files).not.toBe(p.files)
  })

  test("НЕДИРТИ файли зберігають ІДЕНТИЧНІСТЬ об'єкта (не лише рівність вмісту)", () => {
    const fileA = techTreeFile('TechTree/a.json', branchJson('branchA', [node('a1')]))
    const fileB = techTreeFile('TechTree/b.json', branchJson('branchB', [node('b1')]))
    const p = project(fileA, fileB)
    const result = applyNodeEdit(p, 'TechTree/a.json', 'a1', (n) => {
      n.Tier = 2
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.files[1]).toBe(fileB)
    expect(result.project.files[0]).not.toBe(fileA)
    expect(result.project.files[0].dirty).toBe(true)
    expect(result.project.files[1].dirty).toBe(false)
  })

  test('послідовні правки: друга бере РЕЗУЛЬТАТ першої, перший результат незмінний', () => {
    const p = project(techTreeFile('TechTree/zone.json', branchJson('zone', [node('a', { Tier: 1 })])))
    const r1 = applyNodeEdit(p, 'TechTree/zone.json', 'a', (n) => {
      n.Tier = 2
    })
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    const r2 = applyNodeEdit(r1.project, 'TechTree/zone.json', 'a', (n) => {
      n.Tier = 3
    })
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    expect((r1.project.files[0].parsed as Doc).Nodes[0].Tier).toBe(2)
    expect((r2.project.files[0].parsed as Doc).Nodes[0].Tier).toBe(3)
    expect((p.files[0].parsed as Doc).Nodes[0].Tier).toBe(1)
  })
})

describe('applyNodeEdit: відмови', () => {
  test('дублікат Id вузла в ОДНОМУ файлі — явна відмова, нічого не змінено', () => {
    const p = project(techTreeFile('TechTree/zone.json', branchJson('zone', [node('dup', { Tier: 1 }), node('dup', { Tier: 2 })])))
    const result = applyNodeEdit(p, 'TechTree/zone.json', 'dup', (n) => {
      n.Tier = 9
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/дубль/i)
    const doc = p.files[0].parsed as Doc
    expect(doc.Nodes[0].Tier).toBe(1)
    expect(doc.Nodes[1].Tier).toBe(2)
    expect(p.files[0].dirty).toBe(false)
  })

  test('той самий Id у РІЗНИХ файлах — НЕ заважає редагувати один із них за filePath+nodeId', () => {
    const p = project(
      techTreeFile('TechTree/a.json', branchJson('branchA', [node('dup', { Tier: 1 })])),
      techTreeFile('TechTree/b.json', branchJson('branchB', [node('dup', { Tier: 1 })])),
    )
    const result = applyNodeEdit(p, 'TechTree/a.json', 'dup', (n) => {
      n.Tier = 4
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((result.project.files[0].parsed as Doc).Nodes[0].Tier).toBe(4)
    expect((result.project.files[1].parsed as Doc).Nodes[0].Tier).toBe(1)
    expect(result.project.files[1]).toBe(p.files[1])
  })

  test('файл не знайдено', () => {
    const p = project(techTreeFile('TechTree/zone.json', branchJson('zone', [node('a')])))
    const result = applyNodeEdit(p, 'TechTree/nope.json', 'a', () => {})
    expect(result.ok).toBe(false)
  })

  test('вузол не знайдено у файлі', () => {
    const p = project(techTreeFile('TechTree/zone.json', branchJson('zone', [node('a')])))
    const result = applyNodeEdit(p, 'TechTree/zone.json', 'nope', () => {})
    expect(result.ok).toBe(false)
  })

  test('не-techTree файл (foreign) — відмова', () => {
    const foreign: ProjectFile = {
      path: 'FactionData/ecolog.json',
      kind: 'foreign',
      originalBytes: new Uint8Array(0),
      warnings: [],
      dirty: false,
    }
    const p = project(foreign)
    const result = applyNodeEdit(p, 'FactionData/ecolog.json', 'anything', () => {})
    expect(result.ok).toBe(false)
  })
})

describe('applyNodeEdit: байт-стабільність повторної канонізації після правки', () => {
  test('serialize(parsed) -> parse -> serialize дає ІДЕНТИЧНИЙ текст', () => {
    const p = project(
      techTreeFile(
        'TechTree/zone.json',
        branchJson('zone', [node('a', { Tier: 1, Cost: [{ Type: 'bio_t1', Amount: 5 }], Parents: ['root'] })]),
      ),
    )
    const result = applyNodeEdit(p, 'TechTree/zone.json', 'a', (n) => {
      n.Tier = 2
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const doc = result.project.files[0].parsed
    const firstPass = serialize(TECH_TREE_SCHEMA, doc)
    const reparsed = parseConfig(TECH_TREE_SCHEMA, firstPass)
    expect(reparsed.warnings).toEqual([])
    const secondPass = serialize(TECH_TREE_SCHEMA, reparsed.value)
    expect(secondPass).toBe(firstPass)
  })
})
