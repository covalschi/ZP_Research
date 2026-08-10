// Тести чистих хелперів полотна дерева (W3 Task 2, TDD ДО реалізації). На відміну від
// полотна ланцюгів (ChainView + elkjs) позиція вузла дерева — ДЕТЕРМІНОВАНА функція
// (Tier, порядковий номер у колонці): auto-layout тут не потрібен і шкідливий (колонка =
// Tier — семантична координата, її не можна віддавати солверу). Хелпери живуть у
// src/ui/treeLayout.ts (чистий .ts без React — той самий поділ, що model/treeView.ts проти
// ui/TreeCanvas.tsx; імʼя НЕ treeCanvas.ts — Windows-ФС кейс-інсенситивна, і tsc плутав би
// його з TreeCanvas.tsx, перевірено збіркою: TS1261 «differs only in casing»).

import { describe, test, expect } from 'vitest'
import { parseConfig } from '../src/io/parse'
import { TECH_TREE_SCHEMA, POINT_TYPES_SCHEMA } from '../src/model/schema'
import { loadClassIndex } from '../src/model/classIndex'
import type { ClassIndex } from '../src/model/classIndex'
import type { StorageBackend } from '../src/io/backend'
import type { Project, ProjectFile } from '../src/io/project'
import { buildTreeView } from '../src/model/treeView'
import {
  TREE_COL_STEP,
  TREE_ROW_STEP,
  TREE_TOP,
  columnTiers,
  cardPosition,
  tierForX,
  buildTreeCanvas,
} from '../src/ui/treeLayout'

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

function pointType(id: string, override: Record<string, unknown> = {}): Record<string, unknown> {
  return { Id: id, Name: id, Icon: '', Color: '#ffffff', SortOrder: 0, Category: '', Kind: '', Tier: 1, ...override }
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

function canvasFor(activePath: string, ...files: ProjectFile[]) {
  const view = buildTreeView(project(...files, pointTypesFile([pointType('bio_t1', { Name: 'Біо T1' })])), idx)
  return buildTreeCanvas(view, activePath)
}

// ---- columnTiers: суцільний діапазон колонок + одна порожня праворуч -----------------------

describe('columnTiers', () => {
  test('порожній вхід -- одна колонка «Тір 1», без зайвої (тягнути нічого)', () => {
    expect(columnTiers([])).toEqual([1])
  })

  test('суцільний діапазон від наявних тірів + ОДНА порожня колонка праворуч (ціль драгу «глибше»)', () => {
    expect(columnTiers([1, 1, 2])).toEqual([1, 2, 3])
  })

  test('діапазон завжди підтягується до Тір 1 (корені живуть там; порожні колонки -- цілі драгу)', () => {
    expect(columnTiers([2, 3])).toEqual([1, 2, 3, 4])
  })

  test('дірка в тірах заповнюється (порожня колонка -- легальна ціль драгу)', () => {
    expect(columnTiers([1, 4])).toEqual([1, 2, 3, 4, 5])
  })

  test('тір нижче 1 (легально: Tier -- лише відображення, ZP_TechTree.c:26) розширює діапазон вліво', () => {
    expect(columnTiers([0, 2])).toEqual([0, 1, 2, 3])
  })

  // Захист від виродженого діапазону (ревью T2, minor): "Tier": 99999 -- легальний int32,
  // суцільна заливка дала б ~100к колонок і завісила вкладку. Фолбек: лише зайняті тіри
  // + Тір 1 + (max+1) як цілі драгу. Дискримінує наївний суцільний діапазон (той дав би
  // масив на 100к елементів).
  test('вироджений тір (99999) -- фолбек на зайняті тіри, а не 100к колонок', () => {
    const result = columnTiers([1, 2, 99999])
    expect(result).toEqual([1, 2, 99999, 100000])
    expect(result.length).toBeLessThan(10)
  })

  test('щільне дерево в межах TREE_MAX_COLS -- суцільний діапазон як і був (фолбек НЕ вмикається)', () => {
    const dense = Array.from({ length: 40 }, (_, i) => i + 1)
    expect(columnTiers(dense)).toEqual(Array.from({ length: 41 }, (_, i) => i + 1))
  })
})

// ---- cardPosition: координата = функція (колонка, порядковий номер) ------------------------

describe('cardPosition', () => {
  test('перша картка першої колонки -- під заголовком', () => {
    expect(cardPosition(0, 0)).toEqual({ x: 0, y: TREE_TOP })
  })

  test('колонка 2, номер 3 -- кроки колонок/рядків', () => {
    expect(cardPosition(2, 3)).toEqual({ x: 2 * TREE_COL_STEP, y: TREE_TOP + 3 * TREE_ROW_STEP })
  })
})

// ---- tierForX: зворотне відображення драгу (лівий край картки -> тір колонки) --------------

describe('tierForX', () => {
  const tiers = [1, 2, 3, 4]

  test('точно на колонці -- її тір', () => {
    expect(tierForX(0, tiers)).toBe(1)
    expect(tierForX(TREE_COL_STEP, tiers)).toBe(2)
  })

  test('між колонками -- найближча (round)', () => {
    expect(tierForX(TREE_COL_STEP * 1.4, tiers)).toBe(2)
    expect(tierForX(TREE_COL_STEP * 1.6, tiers)).toBe(3)
  })

  test('за межами -- клемп у крайні колонки', () => {
    expect(tierForX(-10000, tiers)).toBe(1)
    expect(tierForX(100 * TREE_COL_STEP, tiers)).toBe(4)
  })

  test('порожній список колонок -- 1 (захист, не мало б статись)', () => {
    expect(tierForX(0, [])).toBe(1)
  })
})

// ---- buildTreeCanvas: базова розкладка -----------------------------------------------------

describe('buildTreeCanvas: базова розкладка', () => {
  test('корінь і нащадок -- по своїх Tier-колонках, ребро батько->нащадок', () => {
    const f = techTreeFile(
      'TechTree/zone.json',
      branchDoc('zone', [node('root', { Tier: 1 }), node('child', { Tier: 2, Parents: ['root'] })]),
    )
    const c = canvasFor('TechTree/zone.json', f)
    expect(c.branch?.id).toBe('zone')
    expect(c.tiers).toEqual([1, 2, 3])
    expect(c.headers.map((h) => h.label)).toEqual(['Тір 1', 'Тір 2', 'Тір 3'])
    expect(c.cards).toHaveLength(2)
    const root = c.cards.find((card) => card.node.id === 'root')!
    const child = c.cards.find((card) => card.node.id === 'child')!
    expect(root.x).toBe(0)
    expect(child.x).toBe(TREE_COL_STEP)
    expect(c.edges).toEqual([{ id: expect.any(String), sourceKey: root.key, targetKey: child.key, cross: false }])
  })

  test('вузли одного тіру -- стабільний порядок файлу (порядкові номери зверху вниз)', () => {
    const f = techTreeFile(
      'TechTree/zone.json',
      branchDoc('zone', [node('a', { Tier: 1 }), node('b', { Tier: 1 }), node('c', { Tier: 1 })]),
    )
    const c = canvasFor('TechTree/zone.json', f)
    const ys = c.cards.map((card) => card.y)
    expect(ys).toEqual([TREE_TOP, TREE_TOP + TREE_ROW_STEP, TREE_TOP + 2 * TREE_ROW_STEP])
    expect(c.cards.map((card) => card.node.id)).toEqual(['a', 'b', 'c'])
  })

  test('заголовки стоять по колонках (x = індекс колонки * крок)', () => {
    const f = techTreeFile('TechTree/zone.json', branchDoc('zone', [node('a', { Tier: 2 })]))
    const c = canvasFor('TechTree/zone.json', f)
    expect(c.tiers).toEqual([1, 2, 3])
    expect(c.headers.map((h) => h.x)).toEqual([0, TREE_COL_STEP, 2 * TREE_COL_STEP])
  })

  test('нецілий Tier (легальний JSON) округлюється до колонки', () => {
    const f = techTreeFile('TechTree/zone.json', branchDoc('zone', [node('a', { Tier: 2.4 })]))
    const c = canvasFor('TechTree/zone.json', f)
    expect(c.cards[0].columnTier).toBe(2)
  })

  test('вузли ІНШИХ гілок на полотні відсутні', () => {
    const fA = techTreeFile('TechTree/a.json', branchDoc('branchA', [node('a1')]))
    const fZ = techTreeFile('TechTree/z.json', branchDoc('branchZ', [node('z1')]))
    const c = canvasFor('TechTree/a.json', fA, fZ)
    expect(c.cards.map((card) => card.node.id)).toEqual(['a1'])
  })

  test('невідомий filePath -- порожня модель без падіння', () => {
    const f = techTreeFile('TechTree/zone.json', branchDoc('zone', [node('a')]))
    const c = canvasFor('TechTree/nope.json', f)
    expect(c.branch).toBeUndefined()
    expect(c.cards).toEqual([])
    expect(c.edges).toEqual([])
  })
})

// ---- buildTreeCanvas: кросгілковий батько (примара) ----------------------------------------

describe('buildTreeCanvas: кросгілковий батько', () => {
  const fA = () => techTreeFile('TechTree/a.json', branchDoc('branchA', [node('r', { Tier: 1 })], { Name: 'Гілка А' }))
  const fZ = () =>
    techTreeFile(
      'TechTree/z.json',
      branchDoc('branchZ', [node('child', { Tier: 2, Parents: ['r'] }), node('child2', { Tier: 2, Parents: ['r'] })]),
    )

  test('батько з ІНШОЇ гілки -- картка-примара в колонці СВОГО тіру + cross-ребро', () => {
    const c = canvasFor('TechTree/z.json', fA(), fZ())
    expect(c.ghosts).toHaveLength(1)
    const g = c.ghosts[0]
    expect(g.id).toBe('r')
    expect(g.name).toBe('Вузол r')
    expect(g.branchLabel).toBe('Гілка А')
    expect(g.columnTier).toBe(1)
    expect(g.x).toBe(0) // колонка Тір 1
    const crossEdges = c.edges.filter((e) => e.cross)
    expect(crossEdges).toHaveLength(2) // обидва нащадки тягнуться до ОДНІЄЇ примари
    expect(new Set(crossEdges.map((e) => e.sourceKey))).toEqual(new Set([g.key]))
  })

  test('примара стає ПІСЛЯ реальних карток своєї колонки (порядковий номер продовжується)', () => {
    const fZ2 = techTreeFile(
      'TechTree/z.json',
      branchDoc('branchZ', [node('own', { Tier: 1 }), node('child', { Tier: 2, Parents: ['r'] })]),
    )
    const c = canvasFor('TechTree/z.json', fA(), fZ2)
    const own = c.cards.find((card) => card.node.id === 'own')!
    const g = c.ghosts[0]
    expect(own.y).toBe(TREE_TOP)
    expect(g.y).toBe(TREE_TOP + TREE_ROW_STEP) // другий рядок тієї самої колонки
  })

  test('батько, якого нема НІДЕ, -- ані ребра, ані примари (лампа вузла вже горить причиною)', () => {
    const f = techTreeFile('TechTree/z.json', branchDoc('branchZ', [node('child', { Tier: 2, Parents: ['ghost_of_nothing'] })]))
    const c = canvasFor('TechTree/z.json', f)
    expect(c.ghosts).toEqual([])
    expect(c.edges).toEqual([])
    expect(c.cards[0].node.status).toBe('alarm')
  })

  test('тір примари розширює діапазон колонок', () => {
    const fHigh = techTreeFile('TechTree/a.json', branchDoc('branchA', [node('r', { Tier: 5 })]))
    const fChild = techTreeFile('TechTree/z.json', branchDoc('branchZ', [node('child', { Tier: 1, Parents: ['r'] })]))
    const c = canvasFor('TechTree/z.json', fHigh, fChild)
    expect(c.tiers).toEqual([1, 2, 3, 4, 5, 6])
  })
})

// ---- buildTreeCanvas: дублі Id (ревью T1: малювати ОБИДВА, ітерувати по nodes[]) -----------

describe('buildTreeCanvas: дублі Id', () => {
  test('дубль Id в АКТИВНІЙ гілці -- ДВІ картки з різними ключами (#2-суфікс)', () => {
    const f = techTreeFile('TechTree/zone.json', branchDoc('zone', [node('dup', { Tier: 1 }), node('dup', { Tier: 2 })]))
    const c = canvasFor('TechTree/zone.json', f)
    expect(c.cards).toHaveLength(2)
    expect(c.cards[0].key).not.toBe(c.cards[1].key)
    expect(c.cards[1].key).toMatch(/#2$/)
    expect(c.cards.every((card) => card.node.duplicateId)).toBe(true)
  })

  test('батько-дубль в активній гілці -- ребро йде від ПЕРШОГО екземпляра (дзеркало byId first-wins)', () => {
    const f = techTreeFile(
      'TechTree/zone.json',
      branchDoc('zone', [node('dup', { Tier: 1 }), node('dup', { Tier: 1 }), node('child', { Tier: 2, Parents: ['dup'] })]),
    )
    const c = canvasFor('TechTree/zone.json', f)
    const first = c.cards[0]
    const child = c.cards.find((card) => card.node.id === 'child')!
    const edge = c.edges.find((e) => e.targetKey === child.key)!
    expect(edge.sourceKey).toBe(first.key)
  })

  test('Id батька існує І в активній гілці, І в чужій -- перемагає ЛОКАЛЬНИЙ екземпляр, примари немає', () => {
    const fA = techTreeFile('TechTree/a.json', branchDoc('branchA', [node('shared', { Tier: 1 })]))
    const fZ = techTreeFile(
      'TechTree/z.json',
      branchDoc('branchZ', [node('shared', { Tier: 1 }), node('child', { Tier: 2, Parents: ['shared'] })]),
    )
    const c = canvasFor('TechTree/z.json', fA, fZ)
    expect(c.ghosts).toEqual([])
    const local = c.cards.find((card) => card.node.id === 'shared')!
    const edge = c.edges.find((e) => e.cross === false)!
    expect(edge.sourceKey).toBe(local.key)
  })
})

// ---- buildTreeCanvas: лиця вартостей і статуси доїжджають до картки ------------------------

describe('buildTreeCanvas: дані картки', () => {
  test('картка несе TreeNodeView цілком: лиця Cost, статус, лічильник причин', () => {
    const f = techTreeFile(
      'TechTree/zone.json',
      branchDoc('zone', [node('a', { Cost: [{ Type: 'bio_t1', Amount: 5 }] }), node('bad', { ParentsMode: 'zzz' })]),
    )
    const c = canvasFor('TechTree/zone.json', f)
    const a = c.cards.find((card) => card.node.id === 'a')!
    expect(a.node.cost).toEqual([{ type: 'bio_t1', amount: 5, known: true, name: 'Біо T1' }])
    expect(a.node.status).toBe('ok')
    const bad = c.cards.find((card) => card.node.id === 'bad')!
    expect(bad.node.status).toBe('alarm')
    expect(bad.node.problems.length).toBeGreaterThan(0)
  })
})
