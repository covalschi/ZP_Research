// Тести чистої збірки рядків панелі проблем дерева (W3 Task 4, TDD ДО реалізації).
// Модуль src/ui/treeProblems.ts — БЕЗ React (той самий поділ, що treeLayout.ts проти
// TreeCanvas.tsx): buildTreeProblems(TreeViewResult) -> модель панелі (проєктний блок /
// групи по гілках / рядки по вузлах, лічильники, ключі-цілі центрування).
//
// Ключ рядка = ключ КАРТКИ на полотні (дзеркало buildTreeCanvas: 'tnode::<file>::<id>'
// + '#N' на повторі Id у файлі) — контракт клік-центрування: полотно шукає картку рівно
// за цим ключем, тож маппінг рядок->ключ покривається юнітом ПРОТИ buildTreeCanvas, а не
// проти захардкоженого рядка.

import { describe, test, expect } from 'vitest'
import { parseConfig } from '../src/io/parse'
import { TECH_TREE_SCHEMA, POINT_TYPES_SCHEMA } from '../src/model/schema'
import { loadClassIndex } from '../src/model/classIndex'
import type { ClassIndex } from '../src/model/classIndex'
import type { StorageBackend } from '../src/io/backend'
import type { Project, ProjectFile } from '../src/io/project'
import { buildTreeView } from '../src/model/treeView'
import { buildTreeCanvas } from '../src/ui/treeLayout'
import {
  TREE_HARDERR_NOTE,
  TREE_ITEMCOST_DOUBT_HINT,
  TREE_SERVER_GUARD_HINT,
  buildTreeProblems,
} from '../src/ui/treeProblems'

const idx: ClassIndex = loadClassIndex()

const dummyBackend: StorageBackend = {
  kind: 'zip',
  list: async () => [],
  read: async () => new Uint8Array(0),
  write: async () => {},
}

function project(...files: ProjectFile[]): Project {
  return { files, backend: dummyBackend }
}

function techTreeFile(path: string, jsonText: string): ProjectFile {
  const { value, warnings } = parseConfig(TECH_TREE_SCHEMA, jsonText)
  return { path, kind: 'techTree', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function pointTypesFile(pointTypes: Record<string, unknown>[]): ProjectFile {
  const jsonText = JSON.stringify({ ConfigVersion: 1, PointTypes: pointTypes, Categories: [], Kinds: [] })
  const { value, warnings } = parseConfig(POINT_TYPES_SCHEMA, jsonText)
  return { path: 'PointTypes.json', kind: 'pointTypes', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function pointType(id: string): Record<string, unknown> {
  return { Id: id, Name: id, Icon: '', Color: '#ffffff', SortOrder: 0, Category: '', Kind: '', Tier: 1 }
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

function branchDoc(branchId: string, nodes: Record<string, unknown>[], branchOverride: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ConfigVersion: 1,
    Branch: { Id: branchId, Name: branchId, Icon: '', SortOrder: 1, Factions: [], ...branchOverride },
    Nodes: nodes,
  })
}

function modelFor(...files: ProjectFile[]) {
  return buildTreeProblems(buildTreeView(project(...files, pointTypesFile([pointType('bio_t1')])), idx))
}

// ---- Чисте дерево -----------------------------------------------------------------------------

describe('buildTreeProblems: чисте дерево', () => {
  test('здорові гілки -- порожня модель (нуль рядків, нуль лічильників)', () => {
    const f = techTreeFile(
      'TechTree/zone.json',
      branchDoc('zone', [node('root'), node('child', { Tier: 2, Parents: ['root'] })]),
    )
    const m = modelFor(f)
    expect(m.project).toEqual([])
    expect(m.groups).toEqual([])
    expect(m.rowCount).toBe(0)
    expect(m.alarmCount).toBe(0)
    expect(m.warnCount).toBe(0)
  })
})

// ---- Групування і порядок ---------------------------------------------------------------------

describe('buildTreeProblems: групування по гілках', () => {
  test('групи -- у порядку файлів; рядки -- у порядку файлу; здорові вузли в рядки не потрапляють', () => {
    const fA = techTreeFile(
      'TechTree/a.json',
      branchDoc('branchA', [node('a_ok'), node('a_orphan', { Parents: ['no_such'] })], { Name: 'Гілка А' }),
    )
    const fZ = techTreeFile(
      'TechTree/z.json',
      branchDoc('branchZ', [node('cyc_x', { Parents: ['cyc_y'] }), node('cyc_y', { Parents: ['cyc_x'] })]),
    )
    const m = modelFor(fA, fZ)
    expect(m.groups.map((g) => g.filePath)).toEqual(['TechTree/a.json', 'TechTree/z.json'])
    expect(m.groups[0].label).toBe('Гілка А')
    expect(m.groups[0].branchId).toBe('branchA')
    expect(m.groups[0].rows.map((r) => r.nodeId)).toEqual(['a_orphan'])
    expect(m.groups[1].label).toBe('branchZ') // Name порожнього немає -- у фікстурі Name = branchId
    expect(m.groups[1].rows.map((r) => r.nodeId)).toEqual(['cyc_x', 'cyc_y'])
  })

  test('назва рядка -- Name вузла, фолбек на Id при порожньому Name', () => {
    const f = techTreeFile('TechTree/zone.json', branchDoc('zone', [node('noname', { Name: '', Parents: ['ghost'] })]))
    const m = modelFor(f)
    // Name === '' -- це і ValidateNode-провал (alarm), і фолбек назви рядка.
    expect(m.groups[0].rows[0].label).toBe('noname')
  })
})

// ---- Проєктний блок (hardErr-рівень: зриває завантаження ЦІЛОГО дерева) ----------------------

describe('buildTreeProblems: проєктний блок', () => {
  test('дубль Id вузла -- один проєктний запис (alarm) + ОБИДВА екземпляри рядками', () => {
    const f = techTreeFile('TechTree/zone.json', branchDoc('zone', [node('dup'), node('dup', { Tier: 2 })]))
    const m = modelFor(f)
    expect(m.project).toHaveLength(1)
    expect(m.project[0].kind).toBe('duplicate-node-id')
    expect(m.project[0].severity).toBe('alarm')
    expect(m.project[0].message).toContain("дубль Id вузла 'dup'")
    const rows = m.groups[0].rows
    expect(rows.map((r) => r.nodeId)).toEqual(['dup', 'dup'])
    expect(rows.every((r) => r.worst === 'alarm')).toBe(true)
  })

  test('гілка без Branch.Id -- проєктний запис + рядки вузлів несуть причину «гілка не завантажується»', () => {
    const f = techTreeFile('TechTree/broken.json', branchDoc('', [node('inside')]))
    const m = modelFor(f)
    expect(m.project.map((p) => p.kind)).toEqual(['missing-branch-id'])
    const row = m.groups[0].rows[0]
    expect(row.nodeId).toBe('inside')
    expect(row.worst).toBe('alarm')
    expect(row.reasons.some((r) => r.message.includes('гілка файлу не завантажується'))).toBe(true)
  })

  test('warn-рівень ValidateGraph (битий батько/недосяжність/цикл) у проєктний блок НЕ потрапляє', () => {
    const f = techTreeFile(
      'TechTree/zone.json',
      branchDoc('zone', [node('cyc_x', { Parents: ['cyc_y'] }), node('cyc_y', { Parents: ['cyc_x'] }), node('orphan', { Parents: ['nope'] })]),
    )
    const m = modelFor(f)
    expect(m.project).toEqual([])
    expect(m.groups[0].rows).toHaveLength(3)
    expect(m.groups[0].rows.every((r) => r.worst === 'warn')).toBe(true)
  })
})

// ---- Маппінг рядок -> ключ картки (контракт клік-центрування) --------------------------------

describe('buildTreeProblems: ключі рядків = ключі карток полотна', () => {
  test('дубль Id -- ключі рядків ідентичні ключам buildTreeCanvas (base і base#2)', () => {
    const f = techTreeFile('TechTree/zone.json', branchDoc('zone', [node('dup'), node('dup', { Tier: 2 })]))
    const view = buildTreeView(project(f, pointTypesFile([pointType('bio_t1')])), idx)
    const m = buildTreeProblems(view)
    const canvas = buildTreeCanvas(view, 'TechTree/zone.json')
    expect(m.groups[0].rows.map((r) => r.key)).toEqual(canvas.cards.map((c) => c.key))
    expect(m.groups[0].rows[1].key).toMatch(/#2$/)
  })

  test('проблемні вузли РІЗНИХ гілок -- ключ несе filePath своєї гілки', () => {
    const fA = techTreeFile('TechTree/a.json', branchDoc('branchA', [node('a_orphan', { Parents: ['no_such'] })]))
    const fZ = techTreeFile('TechTree/z.json', branchDoc('branchZ', [node('z_orphan', { Parents: ['no_such'] })]))
    const m = modelFor(fA, fZ)
    expect(m.groups[0].rows[0].key).toBe('tnode::TechTree/a.json::a_orphan')
    expect(m.groups[1].rows[0].key).toBe('tnode::TechTree/z.json::z_orphan')
  })
})

// ---- Підказка другого порядку для warn «клас відсутній в індексі» (хвіст ревью T1) -----------

describe('buildTreeProblems: підказка ItemCost-warn', () => {
  test('невідомий індексу клас у ItemCost -- warn-причина несе hint про нащадків', () => {
    const f = techTreeFile(
      'TechTree/zone.json',
      branchDoc('zone', [node('ic', { ItemCost: [{ Classname: 'ZZZ_No_Such_Class', Quantity: 1, Content: '' }] })]),
    )
    const view = buildTreeView(project(f, pointTypesFile([pointType('bio_t1')])), idx)
    const m = buildTreeProblems(view)
    const row = m.groups[0].rows[0]
    // worst рядка -- severity ПРИЧИН (тут warn: сумнів, не вирок); бінарний alarm на полотні
    // лишається справою node.status моделі T1 -- перевіряємо, що вони чесно РОЗХОДЯТЬСЯ.
    expect(row.worst).toBe('warn')
    expect(view.nodes[0].status).toBe('alarm')
    const reason = row.reasons.find((r) => r.severity === 'warn')!
    expect(reason.message).toContain('відсутній в індексі')
    expect(reason.hint).toBe(TREE_ITEMCOST_DOUBT_HINT)
    expect(TREE_ITEMCOST_DOUBT_HINT).toContain('НАЩАДКИ')
    expect(TREE_ITEMCOST_DOUBT_HINT).toContain('ZP_TechTree.c:145-150')
  })

  test('порожній Classname у ItemCost -- alarm БЕЗ hint (детермінований провал, не сумнів)', () => {
    const f = techTreeFile(
      'TechTree/zone.json',
      branchDoc('zone', [node('ic', { ItemCost: [{ Classname: '', Quantity: 1, Content: '' }] })]),
    )
    const m = modelFor(f)
    const reasons = m.groups[0].rows[0].reasons
    expect(reasons.some((r) => r.severity === 'alarm' && r.message.includes('ItemCost'))).toBe(true)
    expect(reasons.every((r) => r.hint === undefined)).toBe(true)
  })

  test('інші warn-причини (битий батько/недосяжність) hint НЕ отримують', () => {
    const f = techTreeFile('TechTree/zone.json', branchDoc('zone', [node('orphan', { Parents: ['nope'] })]))
    const m = modelFor(f)
    expect(m.groups[0].rows[0].reasons.every((r) => r.hint === undefined)).toBe(true)
  })
})

// ---- Лічильники -------------------------------------------------------------------------------

describe('buildTreeProblems: лічильники', () => {
  test('битий батько: 2 warn-причини (missing-parent + unreachable), 0 alarm, 1 рядок', () => {
    const f = techTreeFile('TechTree/zone.json', branchDoc('zone', [node('orphan', { Parents: ['nope'] })]))
    const m = modelFor(f)
    expect(m.rowCount).toBe(1)
    expect(m.alarmCount).toBe(0)
    expect(m.warnCount).toBe(2)
  })

  test('лічильники = проєктні alarm + причини рядків (те, що панель реально показує)', () => {
    const f = techTreeFile(
      'TechTree/zone.json',
      branchDoc('zone', [node('dup'), node('dup', { Tier: 2 }), node('orphan', { Parents: ['nope'] })]),
    )
    const m = modelFor(f)
    // Проєктний блок: 1 alarm (дубль Id). Рядки: dup (1 alarm-причина) + dup#2 (1 alarm) +
    // orphan (2 warn: битий батько + недосяжність).
    expect(m.rowCount).toBe(3)
    expect(m.alarmCount).toBe(3)
    expect(m.warnCount).toBe(2)
  })
})

// ---- Обов'язкові UA-підказки (бриф T4): точні цитати з .c-джерел -----------------------------

describe('константи підказок', () => {
  test('TREE_SERVER_GUARD_HINT пояснює різницю warn/операції сервера з цитатами джерел', () => {
    expect(TREE_SERVER_GUARD_HINT).toContain('ValidateGraph')
    expect(TREE_SERVER_GUARD_HINT).toContain('ZP_TechTree.c:202-220')
    expect(TREE_SERVER_GUARD_HINT).toContain('UPSERT_NODE')
    expect(TREE_SERVER_GUARD_HINT).toContain('ZP_ConfigService.c:975-1005')
    expect(TREE_SERVER_GUARD_HINT).toContain('SaveBranch')
    expect(TREE_SERVER_GUARD_HINT).toContain(':538-554')
    expect(TREE_SERVER_GUARD_HINT).toContain('вузли стануть недосяжними')
  })

  test('TREE_HARDERR_NOTE пояснює «одна відмова = нуль вузлів» з цитатою TryLoadTechTree', () => {
    expect(TREE_HARDERR_NOTE).toContain('TryLoadTechTree')
    expect(TREE_HARDERR_NOTE).toContain('ZP_ConfigService.c:497-502')
    expect(TREE_HARDERR_NOTE).toContain('ЖОДНОГО')
  })
})
