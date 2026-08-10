// Тести мутаторів з'єднання/створення/видалення дерева (W3 Task 3, TDD ДО реалізації).
// Дзеркальна дисципліна applyNodeEdit (tests/nodeEdit.test.ts) успадковується всіма
// функціями; НОВЕ тут — гвард недосяжності: кожна мутація Parents/ParentsMode/Id
// перевіряється на ЧЕРНЕТЦІ (draft-проєкт, НЕ комітиться до перевірки) і відмовляє, якщо
// з'являються НОВІ недосяжні вузли — точне дзеркало серверної транзакційної операції
// OpUpsertNode (ZP_ConfigService.c:975-1005: unreachBefore/unreachAfter, «відхилено: вузли
// стануть недосяжними (цикл або хибний батьківський вузол)») — сервер сам захищає дерево
// саме так, редактор не вигадує нову семантику.

import { describe, test, expect } from 'vitest'
import { parseConfig } from '../src/io/parse'
import { TECH_TREE_SCHEMA } from '../src/model/schema'
import { serialize } from '../src/io/jsonWriter'
import { loadClassIndex } from '../src/model/classIndex'
import type { ClassIndex } from '../src/model/classIndex'
import type { StorageBackend } from '../src/io/backend'
import type { Project, ProjectFile } from '../src/io/project'
import {
  addNodeParent,
  removeNodeParent,
  replaceNodeParent,
  setNodeParentsMode,
  renameTreeNode,
  createTreeNode,
  createTreeBranchFile,
  deleteTreeNode,
} from '../src/io/nodeEdit'

const idx: ClassIndex = loadClassIndex()

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

type Doc = { Branch: Record<string, unknown>; Nodes: Record<string, unknown>[] }

function nodesOf(p: Project, filePath: string): Record<string, unknown>[] {
  return (p.files.find((f) => f.path === filePath)!.parsed as Doc).Nodes
}

// ---- addNodeParent -------------------------------------------------------------------------

describe('addNodeParent', () => {
  test('щасливий шлях: батько додається в Parents, файл dirty, оригінал НЕ мутується', () => {
    const p = project(techTreeFile('TechTree/zone.json', branchJson('zone', [node('root'), node('child', { Tier: 2 })])))
    const result = addNodeParent(p, idx, 'TechTree/zone.json', 'child', 'root')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(nodesOf(result.project, 'TechTree/zone.json')[1].Parents).toEqual(['root'])
    expect(result.project.files[0].dirty).toBe(true)
    // оригінал недоторканий (дзеркальна дисципліна applyNodeEdit)
    expect(nodesOf(p, 'TechTree/zone.json')[1].Parents).toEqual([])
    expect(p.files[0].dirty).toBe(false)
  })

  test('кросгілковий батько (інший файл) — легальне ребро, додається', () => {
    const fA = techTreeFile('TechTree/a.json', branchJson('branchA', [node('r')]))
    const fZ = techTreeFile('TechTree/z.json', branchJson('branchZ', [node('child', { Tier: 2 })]))
    const p = project(fA, fZ)
    const result = addNodeParent(p, idx, 'TechTree/z.json', 'child', 'r')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(nodesOf(result.project, 'TechTree/z.json')[0].Parents).toEqual(['r'])
    // недирти файл зберігає ідентичність об'єкта
    expect(result.project.files[0]).toBe(fA)
  })

  test('вузол не може бути власним батьком — явна відмова', () => {
    const p = project(techTreeFile('TechTree/zone.json', branchJson('zone', [node('a')])))
    const result = addNodeParent(p, idx, 'TechTree/zone.json', 'a', 'a')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/власним батьком/)
  })

  test('батько вже в Parents (регістрозалежно, дзеркало FindNode) — відмова', () => {
    const p = project(techTreeFile('TechTree/zone.json', branchJson('zone', [node('root'), node('child', { Parents: ['root'] })])))
    const result = addNodeParent(p, idx, 'TechTree/zone.json', 'child', 'root')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/вже є/)
  })

  test('ЦИКЛ — відмова з UA-причиною, переліком недосяжних і шляхом циклу; проєкт недоторканий', () => {
    // root -> mid -> leaf; спроба зробити leaf батьком root замикає цикл на всі три.
    const p = project(
      techTreeFile(
        'TechTree/zone.json',
        branchJson('zone', [node('root'), node('mid', { Tier: 2, Parents: ['root'] }), node('leaf', { Tier: 3, Parents: ['mid'] })]),
      ),
    )
    const result = addNodeParent(p, idx, 'TechTree/zone.json', 'root', 'leaf')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/недосяжн/)
    expect(result.error).toMatch(/цикл/)
    expect(result.error).toContain('root')
    expect(result.error).toContain('mid')
    expect(result.error).toContain('leaf')
    // розширення редактора понад сервер: ШЛЯХ циклу (сервер друкує лише перелік недосяжних)
    expect(result.error).toContain('->')
    // нічого не записано
    expect(nodesOf(p, 'TechTree/zone.json')[0].Parents).toEqual([])
    expect(p.files[0].dirty).toBe(false)
  })

  test('неіснуючий батько робить вузол недосяжним — відмова (дзеркало гварда OpUpsertNode)', () => {
    const p = project(techTreeFile('TechTree/zone.json', branchJson('zone', [node('a')])))
    const result = addNodeParent(p, idx, 'TechTree/zone.json', 'a', 'ghost_of_nothing')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/недосяжн/)
    expect(result.error).toContain('a')
  })

  test('вузол УЖЕ недосяжний (битий батько) — другий битий батько НЕ дає НОВИХ недосяжних, дозволено', () => {
    // Дзеркало серверного гварда: порівнюються НАБОРИ до/після, не факт наявності проблем.
    const p = project(techTreeFile('TechTree/zone.json', branchJson('zone', [node('x', { Parents: ['missing1'] })])))
    const result = addNodeParent(p, idx, 'TechTree/zone.json', 'x', 'missing2')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(nodesOf(result.project, 'TechTree/zone.json')[0].Parents).toEqual(['missing1', 'missing2'])
  })

  test('дубль Id вузла у файлі — відмова (пропагується з applyNodeEdit)', () => {
    const p = project(techTreeFile('TechTree/zone.json', branchJson('zone', [node('root'), node('dup'), node('dup')])))
    const result = addNodeParent(p, idx, 'TechTree/zone.json', 'dup', 'root')
    expect(result.ok).toBe(false)
  })
})

// ---- removeNodeParent ----------------------------------------------------------------------

describe('removeNodeParent', () => {
  test('щасливий шлях: батько видаляється, файл dirty', () => {
    const p = project(techTreeFile('TechTree/zone.json', branchJson('zone', [node('root'), node('child', { Parents: ['root'] })])))
    const result = removeNodeParent(p, idx, 'TechTree/zone.json', 'child', 'root')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(nodesOf(result.project, 'TechTree/zone.json')[1].Parents).toEqual([])
    expect(result.project.files[0].dirty).toBe(true)
  })

  test('видаляються ВСІ входження того самого Id (полотно малює одне ребро на пару)', () => {
    const p = project(
      techTreeFile('TechTree/zone.json', branchJson('zone', [node('root'), node('child', { Parents: ['root', 'root'] })])),
    )
    const result = removeNodeParent(p, idx, 'TechTree/zone.json', 'child', 'root')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(nodesOf(result.project, 'TechTree/zone.json')[1].Parents).toEqual([])
  })

  test('такого батька немає в Parents — відмова', () => {
    const p = project(techTreeFile('TechTree/zone.json', branchJson('zone', [node('child')])))
    const result = removeNodeParent(p, idx, 'TechTree/zone.json', 'child', 'root')
    expect(result.ok).toBe(false)
  })

  test('видалення ЄДИНОГО батька робить вузол коренем (досяжним) — дозволено', () => {
    const p = project(techTreeFile('TechTree/zone.json', branchJson('zone', [node('root'), node('child', { Parents: ['root'] })])))
    const result = removeNodeParent(p, idx, 'TechTree/zone.json', 'child', 'root')
    expect(result.ok).toBe(true)
  })

  test("ParentsMode='any': видалення ЖИВОГО батька при битому другому — вузол стає недосяжним, відмова", () => {
    const p = project(
      techTreeFile(
        'TechTree/zone.json',
        branchJson('zone', [node('root'), node('x', { Parents: ['root', 'missing'], ParentsMode: 'any' })]),
      ),
    )
    const result = removeNodeParent(p, idx, 'TechTree/zone.json', 'x', 'root')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/недосяжн/)
  })
})

// ---- replaceNodeParent ---------------------------------------------------------------------

describe('replaceNodeParent', () => {
  test('щасливий шлях: заміна за позицією', () => {
    const p = project(
      techTreeFile('TechTree/zone.json', branchJson('zone', [node('a'), node('b'), node('child', { Parents: ['a'] })])),
    )
    const result = replaceNodeParent(p, idx, 'TechTree/zone.json', 'child', 0, 'b')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(nodesOf(result.project, 'TechTree/zone.json')[2].Parents).toEqual(['b'])
  })

  test('позиція поза межами — відмова', () => {
    const p = project(techTreeFile('TechTree/zone.json', branchJson('zone', [node('a'), node('child', { Parents: ['a'] })])))
    const result = replaceNodeParent(p, idx, 'TechTree/zone.json', 'child', 5, 'a')
    expect(result.ok).toBe(false)
  })

  test('заміна, що замикає цикл, — відмова', () => {
    const p = project(
      techTreeFile('TechTree/zone.json', branchJson('zone', [node('a'), node('mid', { Parents: ['a'] }), node('leaf', { Parents: ['mid'] })])),
    )
    // a стає нащадком leaf? Ні: міняємо батька a... у a немає батьків. Міняємо батька mid: a -> leaf.
    const result = replaceNodeParent(p, idx, 'TechTree/zone.json', 'mid', 0, 'leaf')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/цикл/)
  })

  test('новий батько вже стоїть на ІНШІЙ позиції — відмова (не плодимо дубль ребра)', () => {
    const p = project(
      techTreeFile('TechTree/zone.json', branchJson('zone', [node('a'), node('b'), node('child', { Parents: ['a', 'b'] })])),
    )
    const result = replaceNodeParent(p, idx, 'TechTree/zone.json', 'child', 0, 'b')
    expect(result.ok).toBe(false)
  })

  test('вузол не може стати власним батьком через заміну', () => {
    const p = project(techTreeFile('TechTree/zone.json', branchJson('zone', [node('a'), node('child', { Parents: ['a'] })])))
    const result = replaceNodeParent(p, idx, 'TechTree/zone.json', 'child', 0, 'child')
    expect(result.ok).toBe(false)
  })
})

// ---- setNodeParentsMode --------------------------------------------------------------------

describe('setNodeParentsMode', () => {
  test("'all' -> 'any' — дозволено", () => {
    const p = project(techTreeFile('TechTree/zone.json', branchJson('zone', [node('root'), node('x', { Parents: ['root'] })])))
    const result = setNodeParentsMode(p, idx, 'TechTree/zone.json', 'x', 'any')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(nodesOf(result.project, 'TechTree/zone.json')[1].ParentsMode).toBe('any')
  })

  test('невалідний режим — відмова (дзеркало ValidateNode all|any)', () => {
    const p = project(techTreeFile('TechTree/zone.json', branchJson('zone', [node('x')])))
    const result = setNodeParentsMode(p, idx, 'TechTree/zone.json', 'x', 'zzz')
    expect(result.ok).toBe(false)
  })

  test("'any' -> 'all' при битому одному з батьків — вузол стане недосяжним, відмова", () => {
    const p = project(
      techTreeFile(
        'TechTree/zone.json',
        branchJson('zone', [node('root'), node('x', { Parents: ['root', 'missing'], ParentsMode: 'any' })]),
      ),
    )
    const result = setNodeParentsMode(p, idx, 'TechTree/zone.json', 'x', 'all')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/недосяжн/)
  })
})

// ---- renameTreeNode ------------------------------------------------------------------------

describe('renameTreeNode', () => {
  test('щасливий шлях: без нащадків Id міняється', () => {
    const p = project(techTreeFile('TechTree/zone.json', branchJson('zone', [node('old_id')])))
    const result = renameTreeNode(p, idx, 'TechTree/zone.json', 'old_id', 'new_id')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(nodesOf(result.project, 'TechTree/zone.json')[0].Id).toBe('new_id')
  })

  test('порожній новий Id — відмова', () => {
    const p = project(techTreeFile('TechTree/zone.json', branchJson('zone', [node('a')])))
    const result = renameTreeNode(p, idx, 'TechTree/zone.json', 'a', '  ')
    expect(result.ok).toBe(false)
  })

  test('новий Id вже існує (у будь-якому файлі) — відмова «дубль» (hardErr AddFileNodes:140-144)', () => {
    const p = project(
      techTreeFile('TechTree/a.json', branchJson('branchA', [node('taken')])),
      techTreeFile('TechTree/z.json', branchJson('branchZ', [node('x')])),
    )
    const result = renameTreeNode(p, idx, 'TechTree/z.json', 'x', 'taken')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/дубль/i)
  })

  test("перейменування батька з нащадком mode='all' — нащадок стане недосяжним, відмова з його Id", () => {
    const p = project(techTreeFile('TechTree/zone.json', branchJson('zone', [node('root'), node('child', { Parents: ['root'] })])))
    const result = renameTreeNode(p, idx, 'TechTree/zone.json', 'root', 'root_v2')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/недосяжн/)
    expect(result.error).toContain('child')
  })

  test("нащадок mode='any' з другим живим батьком — перейменування дозволене (дзеркало серверної семантики)", () => {
    const p = project(
      techTreeFile(
        'TechTree/zone.json',
        branchJson('zone', [node('a'), node('b'), node('child', { Parents: ['a', 'b'], ParentsMode: 'any' })]),
      ),
    )
    const result = renameTreeNode(p, idx, 'TechTree/zone.json', 'a', 'a_v2')
    expect(result.ok).toBe(true)
  })

  // Вирівнювання конвенції (ревью T3, minor 2): create* тримають кейс-інсенситивну
  // унікальність (uniqueId/ruleFileUtils), а rename тримав лише дослівну серверну —
  // 'x' -> 'TAKEN' при живому 'taken' закладав би кейс-варіантну міну.
  test("новий Id відрізняється від чужого ЛИШЕ регістром — відмова (конвенція uniqueId)", () => {
    const p = project(
      techTreeFile('TechTree/a.json', branchJson('branchA', [node('taken')])),
      techTreeFile('TechTree/z.json', branchJson('branchZ', [node('x')])),
    )
    const result = renameTreeNode(p, idx, 'TechTree/z.json', 'x', 'TAKEN')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/дубль/i)
  })

  test('зміна ЛИШЕ регістру власного Id — легальна (це не дубль)', () => {
    const p = project(techTreeFile('TechTree/zone.json', branchJson('zone', [node('vuzol')])))
    const result = renameTreeNode(p, idx, 'TechTree/zone.json', 'vuzol', 'Vuzol')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(nodesOf(result.project, 'TechTree/zone.json')[0].Id).toBe('Vuzol')
  })
})

// ---- createTreeNode ------------------------------------------------------------------------

describe('createTreeNode', () => {
  test('створює вузол із дефолтами Enforce-класу в КІНЦІ Nodes, Tier = колонка, файл dirty', () => {
    const p = project(techTreeFile('TechTree/zone.json', branchJson('zone', [node('existing')])))
    const result = createTreeNode(p, 'TechTree/zone.json', 3)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const nodes = nodesOf(result.project, 'TechTree/zone.json')
    expect(nodes).toHaveLength(2)
    const created = nodes[1]
    expect(created.Id).toBe(result.nodeId)
    // Дефолти Enforce (schema.ts TREE_NODE_SCHEMA): Name порожній, ParentsMode 'all',
    // ResearchTimeSec 0 — «дефолти Enforce — для СТВОРЕННЯ нових сутностей» (W1).
    expect(created.Name).toBe('')
    expect(created.ParentsMode).toBe('all')
    expect(created.Tier).toBe(3)
    expect(created.Parents).toEqual([])
    expect(created.Cost).toEqual([])
    expect(created.ItemCost).toEqual([])
    expect(created.ResearchTimeSec).toBe(0)
    expect(created.RequiredFactions).toEqual([])
    expect(result.project.files[0].dirty).toBe(true)
  })

  test('Id — від Branch.Id + суфікс унікальності (кейс-інсенситивно по ВСЬОМУ проєкту)', () => {
    const p = project(
      techTreeFile('TechTree/a.json', branchJson('branchA', [node('ZONE_VUZOL')])),
      techTreeFile('TechTree/zone.json', branchJson('zone', [])),
    )
    const r1 = createTreeNode(p, 'TechTree/zone.json', 1)
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    // 'zone_vuzol' зайнято як 'ZONE_VUZOL' (кейс-інсенситивно) -> суфікс _2
    expect(r1.nodeId).toBe('zone_vuzol_2')
    const r2 = createTreeNode(r1.project, 'TechTree/zone.json', 1)
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    expect(r2.nodeId).toBe('zone_vuzol_3')
  })

  test('дефолти НЕ шаряться зі схемою: мутація створеного вузла не псує наступний', () => {
    const p = project(techTreeFile('TechTree/zone.json', branchJson('zone', [])))
    const r1 = createTreeNode(p, 'TechTree/zone.json', 1)
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    ;(nodesOf(r1.project, 'TechTree/zone.json')[0].Parents as string[]).push('junk')
    const r2 = createTreeNode(r1.project, 'TechTree/zone.json', 1)
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    expect(nodesOf(r2.project, 'TechTree/zone.json')[1].Parents).toEqual([])
  })

  test('не-techTree файл — відмова', () => {
    const p = project(techTreeFile('TechTree/zone.json', branchJson('zone', [])))
    const result = createTreeNode(p, 'TechTree/nope.json', 1)
    expect(result.ok).toBe(false)
  })
})

// ---- createTreeBranchFile ------------------------------------------------------------------

describe('createTreeBranchFile', () => {
  const meta = { Id: 'newbranch', Name: 'Нова гілка', Icon: '', SortOrder: 5, Factions: ['ecolog'] }

  test('створює канонічний порожній ZP_TechTreeFile із Branch-метою, dirty, kind techTree', () => {
    const p = project()
    const result = createTreeBranchFile(p, 'newbranch', meta)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.path).toBe('TechTree/newbranch.json')
    const file = result.project.files.find((f) => f.path === result.path)!
    expect(file.kind).toBe('techTree')
    expect(file.dirty).toBe(true)
    const doc = file.parsed as Doc
    expect(doc.Branch).toEqual({ Id: 'newbranch', Name: 'Нова гілка', Icon: '', SortOrder: 5, Factions: ['ecolog'] })
    expect(doc.Nodes).toEqual([])
  })

  test('вставка в СЕРВЕРНИЙ порядок серед techTree-файлів (basename, дзеркало SortFileNames)', () => {
    const p = project(
      techTreeFile('TechTree/a.json', branchJson('branchA', [])),
      techTreeFile('TechTree/z.json', branchJson('branchZ', [])),
    )
    const result = createTreeBranchFile(p, 'm', { ...meta, Id: 'branchM' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.files.map((f) => f.path)).toEqual(['TechTree/a.json', 'TechTree/m.json', 'TechTree/z.json'])
  })

  test('порожній Branch.Id — відмова (hardErr AddFileNodes:119-123: файл не завантажиться взагалі)', () => {
    const result = createTreeBranchFile(project(), 'x', { ...meta, Id: '  ' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/Branch\.Id/)
  })

  test('дубль Branch.Id (кейс-інсенситивно) — відмова', () => {
    const p = project(techTreeFile('TechTree/a.json', branchJson('Existing', [])))
    const result = createTreeBranchFile(p, 'x', { ...meta, Id: 'existing' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/дубль/i)
  })

  test('дубль шляху файлу (кейс-інсенситивно) — відмова', () => {
    const p = project(techTreeFile('TechTree/taken.json', branchJson('branchA', [])))
    const result = createTreeBranchFile(p, 'TAKEN', { ...meta, Id: 'branchB' })
    expect(result.ok).toBe(false)
  })

  test('заборонені символи/зарезервовані імена Windows — відмова (та сама перевірка, що createRulesFile)', () => {
    expect(createTreeBranchFile(project(), 'bad:name', meta).ok).toBe(false)
    expect(createTreeBranchFile(project(), 'con', meta).ok).toBe(false)
    expect(createTreeBranchFile(project(), '', meta).ok).toBe(false)
  })

  test('байт-стабільність: serialize -> parse -> serialize ідентичний, 0 попереджень', () => {
    const result = createTreeBranchFile(project(), 'newbranch', meta)
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

// ---- deleteTreeNode ------------------------------------------------------------------------

describe('deleteTreeNode', () => {
  test('щасливий шлях: вузол без нащадків видаляється, файл dirty', () => {
    const p = project(techTreeFile('TechTree/zone.json', branchJson('zone', [node('root'), node('leaf', { Parents: ['root'] })])))
    const result = deleteTreeNode(p, 'TechTree/zone.json', 'leaf')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(nodesOf(result.project, 'TechTree/zone.json').map((n) => n.Id)).toEqual(['root'])
    expect(result.project.files[0].dirty).toBe(true)
  })

  test('гард «має нащадків»: відмова з переліком нащадків тієї самої гілки', () => {
    const p = project(
      techTreeFile('TechTree/zone.json', branchJson('zone', [node('root'), node('c1', { Parents: ['root'] }), node('c2', { Parents: ['root'] })])),
    )
    const result = deleteTreeNode(p, 'TechTree/zone.json', 'root')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/нащадк/)
    expect(result.error).toContain('c1')
    expect(result.error).toContain('c2')
  })

  test('гард ловить і КРОСГІЛКОВИХ нащадків (нащадок в іншому файлі)', () => {
    const p = project(
      techTreeFile('TechTree/a.json', branchJson('branchA', [node('shared_root')])),
      techTreeFile('TechTree/z.json', branchJson('branchZ', [node('remote_child', { Parents: ['shared_root'] })])),
    )
    const result = deleteTreeNode(p, 'TechTree/a.json', 'shared_root')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('remote_child')
  })

  test('самопосилання не блокує видалення (вузол не є власним нащадком)', () => {
    const p = project(techTreeFile('TechTree/zone.json', branchJson('zone', [node('weird', { Parents: ['weird'] })])))
    const result = deleteTreeNode(p, 'TechTree/zone.json', 'weird')
    expect(result.ok).toBe(true)
  })

  test('дубль Id у файлі — відмова (та сама причина, що applyNodeEdit)', () => {
    const p = project(techTreeFile('TechTree/zone.json', branchJson('zone', [node('dup'), node('dup')])))
    const result = deleteTreeNode(p, 'TechTree/zone.json', 'dup')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/дубль/i)
  })

  test('вузол не знайдено — відмова', () => {
    const p = project(techTreeFile('TechTree/zone.json', branchJson('zone', [node('a')])))
    const result = deleteTreeNode(p, 'TechTree/zone.json', 'nope')
    expect(result.ok).toBe(false)
  })
})
