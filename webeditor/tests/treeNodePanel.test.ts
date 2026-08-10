// Тести чистих хелперів панелі вузла (W3 Task 3, TDD ДО реалізації). Сама панель —
// React-компонент (jsdom не встановлено, environment='node'), тому тестуються ЧИСТІ
// експортовані функції — той самий поділ, що rulePanel.test.ts для форми правила.

import { describe, test, expect } from 'vitest'
import { parseConfig } from '../src/io/parse'
import { TECH_TREE_SCHEMA } from '../src/model/schema'
import type { StorageBackend } from '../src/io/backend'
import type { Project, ProjectFile } from '../src/io/project'
import { findNodeMatches } from '../src/ui/TreeNodePanel'

const dummyBackend: StorageBackend = {
  kind: 'zip',
  list: async () => [],
  read: async () => new Uint8Array(0),
  write: async () => {},
}

function project(...files: ProjectFile[]): Project {
  return { files, backend: dummyBackend }
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

function techTreeFile(path: string, branchId: string, nodes: Record<string, unknown>[]): ProjectFile {
  const jsonText = JSON.stringify({
    ConfigVersion: 1,
    Branch: { Id: branchId, Name: branchId, Icon: '', SortOrder: 1, Factions: [] },
    Nodes: nodes,
  })
  const { value, warnings } = parseConfig(TECH_TREE_SCHEMA, jsonText)
  return { path, kind: 'techTree', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

// Сюїта collectPointTypeOptions переїхала в tests/optionCollectors.test.ts (W4 Task 1) —
// разом із самою функцією (ui/optionCollectors.ts, злиття двох копій).

describe('findNodeMatches', () => {
  test('точний (регістрозалежний) збіг Id — дзеркало FindNode', () => {
    const p = project(techTreeFile('TechTree/zone.json', 'zone', [node('a'), node('A')]))
    expect(findNodeMatches(p, 'TechTree/zone.json', 'a')).toHaveLength(1)
    expect(findNodeMatches(p, 'TechTree/zone.json', 'A')).toHaveLength(1)
  })

  test('дубль Id повертає ВСІ входження (панель показує відмову-дубль)', () => {
    const p = project(techTreeFile('TechTree/zone.json', 'zone', [node('dup'), node('dup')]))
    expect(findNodeMatches(p, 'TechTree/zone.json', 'dup')).toHaveLength(2)
  })

  test('чужий/відсутній файл — порожньо', () => {
    const p = project(techTreeFile('TechTree/zone.json', 'zone', [node('a')]))
    expect(findNodeMatches(p, 'TechTree/nope.json', 'a')).toEqual([])
  })
})
