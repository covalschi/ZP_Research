// Тести моделі дерева технологій (W3 Task 1). buildTreeView мусить бути ТОЧНИМ дзеркалом
// ZP_TechTree.c (AddFileNodes/ValidateNode/ValidateGraph/GetUnreachable) — якщо тут
// розійдеться з сервером, полотно (T2/T3) покаже адміну вузол як здоровий, який рушій
// НІКОЛИ не завантажить, або навпаки — alarm там, де все насправді працює. Кожен дефект
// нижче процитований з .c (дивись коментар над самими функціями в src/model/treeView.ts).

import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseConfig } from '../src/io/parse'
import { TECH_TREE_SCHEMA, POINT_TYPES_SCHEMA } from '../src/model/schema'
import { loadClassIndex } from '../src/model/classIndex'
import type { ClassIndex } from '../src/model/classIndex'
import type { StorageBackend } from '../src/io/backend'
import type { Project, ProjectFile } from '../src/io/project'
import { buildTreeView } from '../src/model/treeView'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, 'fixtures')
function fixtureText(rel: string): string {
  return readFileSync(join(FIXTURES, rel), 'utf8')
}

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

// Мінімальний ZP_TreeNode -- усі обов'язкові поля схеми присутні (щоб не піднімати
// "ключ відсутній"), значення підставляються через override. Той самий підхід, що
// chainGraph.test.ts::rule()/stationView.test.ts::rule().
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

function nodeById(result: ReturnType<typeof buildTreeView>, id: string) {
  return result.nodes.find((n) => n.id === id)
}

// ---- Гілки: файл=гілка, мета, сортування -----------------------------------------------

describe('buildTreeView: гілки', () => {
  test('один файл -- одна гілка з Branch-метою й nodeIds у порядку файлу', () => {
    const f = techTreeFile('TechTree/zone.json', branchDoc('zone', [node('a'), node('b')], { Name: 'Зона', Icon: 'icon1', SortOrder: 5, Factions: ['ecolog'] }))
    const result = buildTreeView(project(f, pointTypesFile([])), idx)
    expect(result.branches).toHaveLength(1)
    const b = result.branches[0]
    expect(b).toMatchObject({ id: 'zone', filePath: 'TechTree/zone.json', name: 'Зона', icon: 'icon1', sortOrder: 5, factions: ['ecolog'], valid: true })
    expect(b.nodeIds).toEqual(['a', 'b'])
  })

  // Порядок файлів НЕ пересортовується всередині buildTreeView -- модель довіряє порядку
  // project.files (io/project.ts:loadProject -> orderPaths -> sortPathsByBasename, той самий
  // принцип, що chainGraph.buildChainGraph для 'rules'). Тест конструює файли ВЖЕ у
  // бажаному (алфавітному по basename) порядку -- так, як їх поставив би loadProject.
  test('декілька файлів -- по гілці на файл, порядок = порядок project.files', () => {
    const fA = techTreeFile('TechTree/a.json', branchDoc('branchA', [node('a1')]))
    const fZ = techTreeFile('TechTree/z.json', branchDoc('branchZ', [node('z1')]))
    const result = buildTreeView(project(fA, fZ, pointTypesFile([])), idx)
    expect(result.branches.map((b) => b.id)).toEqual(['branchA', 'branchZ'])
  })

  test('вузол без Id пропущений і з nodeIds гілки, і зі списку nodes (AddFileNodes:135-139, дзеркало chainGraph)', () => {
    const f = techTreeFile('TechTree/z.json', branchDoc('zone', [node('a'), node('', { Name: 'Без Id' })]))
    const result = buildTreeView(project(f, pointTypesFile([])), idx)
    expect(result.branches[0].nodeIds).toEqual(['a'])
    expect(result.nodes.map((n) => n.id)).toEqual(['a'])
  })

  test('Branch.Id порожній -- гілка invalid, alarm project-problem, УСІ її вузли loaded=false (AddFileNodes:119-123)', () => {
    const f = techTreeFile('TechTree/bad.json', branchDoc('', [node('a')]))
    const result = buildTreeView(project(f, pointTypesFile([])), idx)
    expect(result.branches[0].valid).toBe(false)
    expect(result.problems).toContainEqual(
      expect.objectContaining({ kind: 'missing-branch-id', severity: 'alarm', filePath: 'TechTree/bad.json' }),
    )
    const n = nodeById(result, 'a')!
    expect(n.loaded).toBe(false)
    expect(n.status).toBe('alarm')
  })

  test('дубль Branch.Id між ДВОМА файлами -- другий invalid, alarm project-problem (AddFileNodes:124-128)', () => {
    const f1 = techTreeFile('TechTree/a.json', branchDoc('dup', [node('n1')]))
    const f2 = techTreeFile('TechTree/b.json', branchDoc('dup', [node('n2')]))
    const result = buildTreeView(project(f1, f2, pointTypesFile([])), idx)
    expect(result.branches[0].valid).toBe(true) // перший -- валідний
    expect(result.branches[1].valid).toBe(false) // другий -- дубль
    expect(result.problems).toContainEqual(
      expect.objectContaining({ kind: 'duplicate-branch-id', severity: 'alarm', filePath: 'TechTree/b.json', branchId: 'dup' }),
    )
    expect(nodeById(result, 'n1')!.loaded).toBe(true)
    expect(nodeById(result, 'n2')!.loaded).toBe(false)
  })
})

// ---- Дублі Id вузла (AddFileNodes:140-144) -- IN-SCOPE брифа: "duplicate node Ids across
// branches — mirror the server's semantics (cite)" -------------------------------------------

describe('buildTreeView: дублі Id вузла', () => {
  test('той самий Id у ДВОХ РІЗНИХ гілках/файлах -- ОБИДВА екземпляри позначені duplicateId+alarm', () => {
    const f1 = techTreeFile('TechTree/a.json', branchDoc('branchA', [node('shared', { Name: 'Перший' })]))
    const f2 = techTreeFile('TechTree/z.json', branchDoc('branchZ', [node('shared', { Name: 'Другий' })]))
    const result = buildTreeView(project(f1, f2, pointTypesFile([])), idx)
    const withId = result.nodes.filter((n) => n.id === 'shared')
    expect(withId).toHaveLength(2) // обидва екземпляри лишаються у nodes[] -- не колапсуються в один
    for (const n of withId) {
      expect(n.duplicateId).toBe(true)
      expect(n.loaded).toBe(false)
      expect(n.status).toBe('alarm')
    }
    expect(result.problems).toContainEqual(expect.objectContaining({ kind: 'duplicate-node-id', severity: 'alarm', nodeId: 'shared' }))
  })

  test('той самий Id ДВІЧІ у ОДНОМУ файлі -- та сама поведінка, що між файлами (AddFileNodes перевіряє FindNode(Nodes), а Nodes накопичується і всередині одного файлу)', () => {
    const f = techTreeFile('TechTree/z.json', branchDoc('zone', [node('dup', { Name: 'A' }), node('dup', { Name: 'B' })]))
    const result = buildTreeView(project(f, pointTypesFile([])), idx)
    const withId = result.nodes.filter((n) => n.id === 'dup')
    expect(withId).toHaveLength(2)
    expect(withId.every((n) => n.duplicateId && n.loaded === false)).toBe(true)
  })

  test('byId зберігає ЛИШЕ перший побачений екземпляр дубля (регістрозалежно, дзеркало FindNode)', () => {
    const f1 = techTreeFile('TechTree/a.json', branchDoc('branchA', [node('shared', { Name: 'Перший' })]))
    const f2 = techTreeFile('TechTree/z.json', branchDoc('branchZ', [node('shared', { Name: 'Другий' })]))
    const result = buildTreeView(project(f1, f2, pointTypesFile([])), idx)
    expect(result.byId.get('shared')!.name).toBe('Перший') // Name прийшов з ПЕРШОГО оголошення (f1) -- перший побачений виграє мапу
    expect(result.byId.get('shared')!.filePath).toBe('TechTree/a.json')
  })

  // Дискримінуючий тест: Id відрізняється лише РЕГІСТРОМ -- FindNode на сервері РЕГІСТРОЗАЛЕЖНИЙ
  // (`n.Id == id`, без .ToLower(), на відміну від MatchClass/Content) -- це НЕ дублікат.
  test('Id, що відрізняється лише регістром -- НЕ дублікат (FindNode:69-77 регістрозалежний)', () => {
    const f = techTreeFile('TechTree/z.json', branchDoc('zone', [node('Node1'), node('node1')]))
    const result = buildTreeView(project(f, pointTypesFile([])), idx)
    expect(result.nodes.every((n) => !n.duplicateId)).toBe(true)
    expect(result.problems.some((p) => p.kind === 'duplicate-node-id')).toBe(false)
  })
})

// ---- ValidateNode: усі перевірки, ПОВНИЙ перелік (не short-circuit) ------------------------

describe('buildTreeView: ValidateNode -- Name/ParentsMode', () => {
  test('порожній Name -- alarm, loaded=false (ValidateNode:160-161)', () => {
    const f = techTreeFile('TechTree/z.json', branchDoc('zone', [node('a', { Name: '' })]))
    const result = buildTreeView(project(f, pointTypesFile([])), idx)
    const n = nodeById(result, 'a')!
    expect(n.loaded).toBe(false)
    expect(n.status).toBe('alarm')
    expect(n.problems).toContainEqual(expect.objectContaining({ path: 'Name', severity: 'alarm' }))
  })

  test("ParentsMode='all'/'any' -- валідні, у БУДЬ-ЯКОМУ регістрі (ToLower на сервері, :162-165)", () => {
    const f = techTreeFile('TechTree/z.json', branchDoc('zone', [node('a', { ParentsMode: 'ALL' }), node('b', { ParentsMode: 'Any' })]))
    const result = buildTreeView(project(f, pointTypesFile([])), idx)
    expect(nodeById(result, 'a')!.loaded).toBe(true)
    expect(nodeById(result, 'b')!.loaded).toBe(true)
  })

  test("ParentsMode стороннє значення -- alarm, loaded=false (:162-165)", () => {
    const f = techTreeFile('TechTree/z.json', branchDoc('zone', [node('a', { ParentsMode: 'first' })]))
    const result = buildTreeView(project(f, pointTypesFile([])), idx)
    const n = nodeById(result, 'a')!
    expect(n.loaded).toBe(false)
    expect(n.problems).toContainEqual(expect.objectContaining({ path: 'ParentsMode', severity: 'alarm' }))
  })
})

describe('buildTreeView: ValidateNode -- Cost', () => {
  test('невідомий тип балів у Cost -- alarm, loaded=false; face.known=false (:168-170)', () => {
    const f = techTreeFile('TechTree/z.json', branchDoc('zone', [node('a', { Cost: [{ Type: 'nope', Amount: 5 }] })]))
    const result = buildTreeView(project(f, pointTypesFile([pointType('real_t1')])), idx)
    const n = nodeById(result, 'a')!
    expect(n.loaded).toBe(false)
    expect(n.problems).toContainEqual(expect.objectContaining({ path: 'Cost[0].Type', severity: 'alarm' }))
    expect(n.cost[0]).toMatchObject({ type: 'nope', known: false, name: 'nope' })
  })

  test('Cost.Amount поза межами [0..1000000] -- alarm (:171-172)', () => {
    const f = techTreeFile('TechTree/z.json', branchDoc('zone', [node('a', { Cost: [{ Type: 'real_t1', Amount: -1 }] })]))
    const result = buildTreeView(project(f, pointTypesFile([pointType('real_t1')])), idx)
    expect(nodeById(result, 'a')!.problems).toContainEqual(expect.objectContaining({ path: 'Cost[0].Amount', severity: 'alarm' }))
    const f2 = techTreeFile('TechTree/z2.json', branchDoc('zone2', [node('b', { Cost: [{ Type: 'real_t1', Amount: 1000001 }] })]))
    const result2 = buildTreeView(project(f2, pointTypesFile([pointType('real_t1')])), idx)
    expect(nodeById(result2, 'b')!.problems).toContainEqual(expect.objectContaining({ path: 'Cost[0].Amount', severity: 'alarm' }))
  })

  test('Cost.Amount межові значення 0 і 1000000 -- ВАЛІДНІ (межа включна)', () => {
    const f = techTreeFile(
      'TechTree/z.json',
      branchDoc('zone', [node('a', { Cost: [{ Type: 'real_t1', Amount: 0 }, { Type: 'real_t2', Amount: 1000000 }] })]),
    )
    const result = buildTreeView(project(f, pointTypesFile([pointType('real_t1'), pointType('real_t2')])), idx)
    expect(nodeById(result, 'a')!.loaded).toBe(true)
  })

  // Дискримінуючий тест: перше входження типу НІКОЛИ не позначається дублем -- лише
  // друге й наступні (seenCost.Contains ПЕРЕД Set, той самий порядок, що на сервері).
  test('дубль Cost.Type ВСЕРЕДИНІ ОДНОГО вузла -- alarm лише на ДРУГОМУ (і далі) входженні, вузол не завантажиться (:173-177)', () => {
    const f = techTreeFile(
      'TechTree/z.json',
      branchDoc('zone', [node('a', { Cost: [{ Type: 'real_t1', Amount: 1 }, { Type: 'real_t1', Amount: 2 }] })]),
    )
    const result = buildTreeView(project(f, pointTypesFile([pointType('real_t1')])), idx)
    const n = nodeById(result, 'a')!
    expect(n.loaded).toBe(false)
    const dupProblems = n.problems.filter((p) => p.message.includes('дубль типу'))
    expect(dupProblems).toHaveLength(1)
    expect(dupProblems[0].path).toBe('Cost[1].Type') // не Cost[0]
  })

  test('три РІЗНІ типи Cost, жодного дублю -- вузол завантажується (контрольний парний тест)', () => {
    const f = techTreeFile(
      'TechTree/z.json',
      branchDoc('zone', [node('a', { Cost: [{ Type: 'real_t1', Amount: 1 }, { Type: 'real_t2', Amount: 2 }, { Type: 'real_t3', Amount: 3 }] })]),
    )
    const result = buildTreeView(project(f, pointTypesFile([pointType('real_t1'), pointType('real_t2'), pointType('real_t3')])), idx)
    expect(nodeById(result, 'a')!.loaded).toBe(true)
  })

  // Бриф-припущення "case-insensitive Find" для типів балів СПРОСТОВАНО читанням
  // ZP_PointTypesConfig.c:317-325 (`pt.Id == id`, БЕЗ .ToLower()) -- цей тест доводить, що
  // модель мириться з РЕАЛЬНИМ (регістрозалежним) рушієм, а не з припущенням брифа.
  test('Cost.Type, що відрізняється лише регістром від PointTypes.Id -- НЕВІДОМИЙ (Find регістрозалежний)', () => {
    const f = techTreeFile('TechTree/z.json', branchDoc('zone', [node('a', { Cost: [{ Type: 'Real_T1', Amount: 1 }] })]))
    const result = buildTreeView(project(f, pointTypesFile([pointType('real_t1')])), idx)
    const n = nodeById(result, 'a')!
    expect(n.loaded).toBe(false)
    expect(n.cost[0].known).toBe(false)
  })
})

describe('buildTreeView: ValidateNode -- ItemCost', () => {
  test('невідомий (поза індексом) клас -- WARN, не alarm (індекс міг бути неповним; той самий принцип, що ruleValidation.validateClassField)', () => {
    const f = techTreeFile('TechTree/z.json', branchDoc('zone', [node('a', { ItemCost: [{ Classname: 'ZP_TotallyUnknownXYZ123', Quantity: 1, Content: '' }] })]))
    const result = buildTreeView(project(f, pointTypesFile([])), idx)
    const n = nodeById(result, 'a')!
    expect(n.problems).toContainEqual(expect.objectContaining({ path: 'ItemCost[0].Classname', severity: 'warn' }))
    // ТІЛЬКИ ця причина -- вона 'warn', тож loaded не обов'язково false ЛИШЕ через неї
    expect(n.problems.every((p) => p.severity === 'warn')).toBe(true)
    expect(n.loaded).toBe(true)
  })

  test('порожній Classname -- alarm (ItemCost.Classname==="" в ValidateNode:181-182)', () => {
    const f = techTreeFile('TechTree/z.json', branchDoc('zone', [node('a', { ItemCost: [{ Classname: '', Quantity: 1, Content: '' }] })]))
    const result = buildTreeView(project(f, pointTypesFile([])), idx)
    const n = nodeById(result, 'a')!
    expect(n.loaded).toBe(false)
    expect(n.problems).toContainEqual(expect.objectContaining({ path: 'ItemCost[0].Classname', severity: 'alarm' }))
  })

  test('відомий звичайний клас (Apple) без Content -- OK, face.display -- ігрове ім\'я', () => {
    const f = techTreeFile('TechTree/z.json', branchDoc('zone', [node('a', { ItemCost: [{ Classname: 'Apple', Quantity: 2, Content: '' }] })]))
    const result = buildTreeView(project(f, pointTypesFile([])), idx)
    const n = nodeById(result, 'a')!
    expect(n.loaded).toBe(true)
    expect(n.itemCost[0]).toMatchObject({ classname: 'Apple', quantity: 2, isSample: false })
    expect(n.itemCost[0].display.length).toBeGreaterThan(0)
  })

  test('ItemCost.Quantity поза межами [1..100] -- alarm (:183-184)', () => {
    const f = techTreeFile('TechTree/z.json', branchDoc('zone', [node('a', { ItemCost: [{ Classname: 'Apple', Quantity: 0, Content: '' }] })]))
    const result = buildTreeView(project(f, pointTypesFile([])), idx)
    expect(nodeById(result, 'a')!.problems).toContainEqual(expect.objectContaining({ path: 'ItemCost[0].Quantity', severity: 'alarm' }))
    const f2 = techTreeFile('TechTree/z2.json', branchDoc('zone2', [node('b', { ItemCost: [{ Classname: 'Apple', Quantity: 101, Content: '' }] })]))
    const result2 = buildTreeView(project(f2, pointTypesFile([])), idx)
    expect(nodeById(result2, 'b')!.problems).toContainEqual(expect.objectContaining({ path: 'ItemCost[0].Quantity', severity: 'alarm' }))
  })

  test('Content на звичайному класі (Apple, не зразок) -- alarm (ValidateContent, ZP_ProcessingConfig.c:365-370)', () => {
    const f = techTreeFile('TechTree/z.json', branchDoc('zone', [node('a', { ItemCost: [{ Classname: 'Apple', Quantity: 1, Content: 'щось' }] })]))
    const result = buildTreeView(project(f, pointTypesFile([])), idx)
    const n = nodeById(result, 'a')!
    expect(n.loaded).toBe(false)
    expect(n.problems).toContainEqual(expect.objectContaining({ path: 'ItemCost[0].Content', severity: 'alarm' }))
  })

  test('Content на класі родини ZP_Sample_Base -- ОК (isSampleClass через isKindOf, не буквальний "ZP_Sample")', () => {
    const f = techTreeFile('TechTree/z.json', branchDoc('zone', [node('a', { ItemCost: [{ Classname: 'ZP_Sample_01', Quantity: 1, Content: 'apple_juice' }] })]))
    const result = buildTreeView(project(f, pointTypesFile([])), idx)
    const n = nodeById(result, 'a')!
    expect(n.loaded).toBe(true)
    expect(n.itemCost[0].isSample).toBe(true)
  })

  test('Content довший за 64 символи на зразку -- alarm (:371-372)', () => {
    const longContent = 'x'.repeat(65)
    const f = techTreeFile('TechTree/z.json', branchDoc('zone', [node('a', { ItemCost: [{ Classname: 'ZP_Sample_01', Quantity: 1, Content: longContent }] })]))
    const result = buildTreeView(project(f, pointTypesFile([])), idx)
    expect(nodeById(result, 'a')!.problems).toContainEqual(expect.objectContaining({ path: 'ItemCost[0].Content', severity: 'alarm' }))
  })

  // Рушій рахує БАЙТИ (Enforce Length() -- байтовий: enstring.c має ОКРЕМИЙ LengthUtf8),
  // JSON -- UTF-8: кирилиця = 2 байти/літера. 33 літери = 66 байт > 64, хоча .length = 33.
  // Дискримінує UTF-16-реалізацію: та пропустила б (33 < 64) -- фікс ревью T1.
  test('Content: 33 кириличні літери (66 байт UTF-8) -- alarm, хоча .length=33 (:371-372)', () => {
    const cyr = 'ч'.repeat(33)
    expect(cyr.length).toBe(33)
    const f = techTreeFile('TechTree/z.json', branchDoc('zone', [node('a', { ItemCost: [{ Classname: 'ZP_Sample_01', Quantity: 1, Content: cyr }] })]))
    const result = buildTreeView(project(f, pointTypesFile([])), idx)
    expect(nodeById(result, 'a')!.problems).toContainEqual(expect.objectContaining({ path: 'ItemCost[0].Content', severity: 'alarm' }))
  })

  // Межа з іншого боку: 32 кириличні літери = 64 байти -- РІВНО ліміт, сервер пропускає
  // (перевірка "> 64"), модель мусить теж.
  test('Content: 32 кириличні літери (64 байти UTF-8) -- ОК, межа включно', () => {
    const cyr = 'ч'.repeat(32)
    const f = techTreeFile('TechTree/z.json', branchDoc('zone', [node('a', { ItemCost: [{ Classname: 'ZP_Sample_01', Quantity: 1, Content: cyr }] })]))
    const result = buildTreeView(project(f, pointTypesFile([])), idx)
    expect(nodeById(result, 'a')!.problems).not.toContainEqual(expect.objectContaining({ path: 'ItemCost[0].Content' }))
    expect(nodeById(result, 'a')!.loaded).toBe(true)
  })

  test('Content з пробілом на краю на зразку -- alarm (:373-378)', () => {
    const f = techTreeFile('TechTree/z.json', branchDoc('zone', [node('a', { ItemCost: [{ Classname: 'ZP_Sample_01', Quantity: 1, Content: ' apple ' }] })]))
    const result = buildTreeView(project(f, pointTypesFile([])), idx)
    expect(nodeById(result, 'a')!.problems).toContainEqual(expect.objectContaining({ path: 'ItemCost[0].Content', severity: 'alarm' }))
  })
})

describe('buildTreeView: ValidateNode -- ResearchTimeSec', () => {
  test('поза межами [0..2592000] -- alarm (:189-190)', () => {
    const f = techTreeFile('TechTree/z.json', branchDoc('zone', [node('a', { ResearchTimeSec: -1 })]))
    const result = buildTreeView(project(f, pointTypesFile([])), idx)
    expect(nodeById(result, 'a')!.problems).toContainEqual(expect.objectContaining({ path: 'ResearchTimeSec', severity: 'alarm' }))
    const f2 = techTreeFile('TechTree/z2.json', branchDoc('zone2', [node('b', { ResearchTimeSec: 2592001 })]))
    const result2 = buildTreeView(project(f2, pointTypesFile([])), idx)
    expect(nodeById(result2, 'b')!.problems).toContainEqual(expect.objectContaining({ path: 'ResearchTimeSec', severity: 'alarm' }))
  })

  test('межові значення 0 і 2592000 -- валідні', () => {
    const f = techTreeFile('TechTree/z.json', branchDoc('zone', [node('a', { ResearchTimeSec: 0 }), node('b', { ResearchTimeSec: 2592000 })]))
    const result = buildTreeView(project(f, pointTypesFile([])), idx)
    expect(nodeById(result, 'a')!.loaded).toBe(true)
    expect(nodeById(result, 'b')!.loaded).toBe(true)
  })
})

// ---- ValidateGraph: nonexistent parent, unreachable fixpoint, цикли -----------------------

describe('buildTreeView: ValidateGraph -- неіснуючий батько', () => {
  test("Parents посилається на неіснуючий Id -- warn на ПАРУ (вузол, батько), вузол недосяжний (:208-211)", () => {
    const f = techTreeFile('TechTree/z.json', branchDoc('zone', [node('a', { Parents: ['ghost'] })]))
    const result = buildTreeView(project(f, pointTypesFile([])), idx)
    const n = nodeById(result, 'a')!
    expect(n.loaded).toBe(true) // ValidateNode сам по собі нічого не каже про Parents-існування
    expect(n.status).toBe('alarm') // але ValidateGraph все одно засвічує вузол
    expect(n.problems).toContainEqual(expect.objectContaining({ path: 'Parents[0]', severity: 'warn', message: expect.stringContaining('ghost') }))
    expect(result.problems).toContainEqual(expect.objectContaining({ kind: 'missing-parent', nodeId: 'a', severity: 'warn' }))
  })

  // Дискримінуючий тест: батько, що ІСНУЄ, але сам НЕ ЗАВАНТАЖИВСЯ (ValidateNode-провал) --
  // для фікспойнта/nonexistent-parent-перевірки це ТЕ САМЕ, що "батька нема взагалі" --
  // loadedById (не byId/усі-Id-у-файлі) є єдиним джерелом істини "чи FindNode його знайде".
  test('батько ІСНУЄ у файлі, але сам не пройшов ValidateNode -- дитина теж отримує "батько не існує"', () => {
    const f = techTreeFile(
      'TechTree/z.json',
      branchDoc('zone', [node('broken_parent', { Name: '' }), node('child', { Parents: ['broken_parent'] })]),
    )
    const result = buildTreeView(project(f, pointTypesFile([])), idx)
    expect(nodeById(result, 'broken_parent')!.loaded).toBe(false)
    const child = nodeById(result, 'child')!
    expect(child.loaded).toBe(true)
    expect(child.problems).toContainEqual(expect.objectContaining({ path: 'Parents[0]', severity: 'warn' }))
  })
})

describe('buildTreeView: ValidateGraph -- фікспойнт досяжності', () => {
  test('чисте дерево без циклів -- усі вузли reachable, 0 unreachable-проблем', () => {
    const f = techTreeFile(
      'TechTree/z.json',
      branchDoc('zone', [node('root'), node('child', { Parents: ['root'] }), node('grand', { Parents: ['child'] })]),
    )
    const result = buildTreeView(project(f, pointTypesFile([])), idx)
    expect(result.nodes.every((n) => n.status === 'ok')).toBe(true)
    expect(result.problems).toHaveLength(0)
  })

  test('простий 2-цикл (A<->B, обидва mode=all, немає інших батьків) -- ОБИДВА недосяжні', () => {
    const f = techTreeFile('TechTree/z.json', branchDoc('zone', [node('a', { Parents: ['b'] }), node('b', { Parents: ['a'] })]))
    const result = buildTreeView(project(f, pointTypesFile([])), idx)
    expect(nodeById(result, 'a')!.status).toBe('alarm')
    expect(nodeById(result, 'b')!.status).toBe('alarm')
    expect(result.problems.filter((p) => p.kind === 'unreachable')).toHaveLength(2)
  })

  // Дискримінуюча пара: ParentsMode='any' з ОДНИМ валідним і ОДНИМ неіснуючим батьком --
  // вузол ВСЕ ОДНО reachable (okCount=1>0 для 'any'), незважаючи на попередження про
  // відсутнього батька. Наївна реалізація "будь-який відсутній батько -> недосяжний"
  // провалилася б тут.
  test("ParentsMode='any', один батько існує/reachable, другий -- ні: вузол РЕАЧАБЛ, лише warn про відсутнього", () => {
    const f = techTreeFile(
      'TechTree/z.json',
      branchDoc('zone', [node('root'), node('a', { Parents: ['root', 'ghost'], ParentsMode: 'any' })]),
    )
    const result = buildTreeView(project(f, pointTypesFile([])), idx)
    const a = nodeById(result, 'a')!
    expect(a.status).toBe('alarm') // ЩЕ горить -- через missing-parent warn, не через unreachable
    expect(result.problems.some((p) => p.kind === 'unreachable' && p.nodeId === 'a')).toBe(false)
    expect(result.problems.some((p) => p.kind === 'missing-parent' && p.nodeId === 'a')).toBe(true)
  })

  test("ParentsMode='all' з ОДНИМ неіснуючим і ОДНИМ валідним батьком -- НЕДОСЯЖНИЙ (all вимагає обох)", () => {
    const f = techTreeFile(
      'TechTree/z.json',
      branchDoc('zone', [node('root'), node('a', { Parents: ['root', 'ghost'], ParentsMode: 'all' })]),
    )
    const result = buildTreeView(project(f, pointTypesFile([])), idx)
    expect(result.problems.some((p) => p.kind === 'unreachable' && p.nodeId === 'a')).toBe(true)
  })

  // Ще одна дискримінуюча пара: 2-цикл (A<->B), АЛЕ B ще й має mode='any' з ДРУГИМ,
  // цілком незалежним валідним коренем C -- фікспойнт спершу робить C reachable, тоді B
  // (any: C reachable -> ok), тоді A (all: тепер B reachable) -- УВЕСЬ "цикл" насправді
  // РЕАЧАБЛ. Це не рукописна вигадка -- саме така поведінка випливає з IsReachableGiven,
  // прочитаного дослівно (:250-265).
  test('2-цикл із альтернативним "any"-виходом через незалежний корінь -- ОБИДВА стають reachable, статус ok', () => {
    const f = techTreeFile(
      'TechTree/z.json',
      branchDoc('zone', [node('c'), node('a', { Parents: ['b'], ParentsMode: 'all' }), node('b', { Parents: ['a', 'c'], ParentsMode: 'any' })]),
    )
    const result = buildTreeView(project(f, pointTypesFile([])), idx)
    expect(nodeById(result, 'a')!.status).toBe('ok')
    expect(nodeById(result, 'b')!.status).toBe('ok')
    expect(result.problems).toHaveLength(0)
  })
})

describe('buildTreeView: findCycleAmong -- шлях циклу (розширення редактора понад ValidateGraph)', () => {
  test('простий 2-цикл -- знаходить шлях, повідомлення включає обидва Id', () => {
    const f = techTreeFile('TechTree/z.json', branchDoc('zone', [node('a', { Parents: ['b'] }), node('b', { Parents: ['a'] })]))
    const result = buildTreeView(project(f, pointTypesFile([])), idx)
    const cycleProblem = result.problems.find((p) => p.kind === 'cycle')
    expect(cycleProblem).toBeDefined()
    expect(cycleProblem!.message).toContain('a')
    expect(cycleProblem!.message).toContain('b')
    // Обидва вузли отримали власне problems-повідомлення з шляхом циклу.
    expect(nodeById(result, 'a')!.problems.some((p) => p.message.includes('цикл:'))).toBe(true)
    expect(nodeById(result, 'b')!.problems.some((p) => p.message.includes('цикл:'))).toBe(true)
  })

  test('недосяжність БЕЗ справжнього циклу (лише битий батько) -- findCycleAmong НІЧОГО не знаходить', () => {
    const f = techTreeFile('TechTree/z.json', branchDoc('zone', [node('a', { Parents: ['ghost'] })]))
    const result = buildTreeView(project(f, pointTypesFile([])), idx)
    expect(result.problems.some((p) => p.kind === 'cycle')).toBe(false)
  })

  test('3-цикл (A->B->C->A) -- знаходить шлях довжини 3', () => {
    const f = techTreeFile(
      'TechTree/z.json',
      branchDoc('zone', [node('a', { Parents: ['c'] }), node('b', { Parents: ['a'] }), node('c', { Parents: ['b'] })]),
    )
    const result = buildTreeView(project(f, pointTypesFile([])), idx)
    const cycleProblem = result.problems.find((p) => p.kind === 'cycle')
    expect(cycleProblem).toBeDefined()
    for (const id of ['a', 'b', 'c']) expect(cycleProblem!.message).toContain(id)
  })
})

// ---- Лиця: Cost.Type -> ім'я типу балів; ItemCost.Classname -> displayNameOf/лиця зразків --

describe('buildTreeView: cost/itemCost faces', () => {
  test('Cost.Type знайдений -- known=true, name = PointType.Name (не сирий Id)', () => {
    const f = techTreeFile('TechTree/z.json', branchDoc('zone', [node('a', { Cost: [{ Type: 'bio_t1', Amount: 5 }] })]))
    const result = buildTreeView(project(f, pointTypesFile([pointType('bio_t1', { Name: 'Біологія 1' })])), idx)
    expect(nodeById(result, 'a')!.cost[0]).toEqual({ type: 'bio_t1', amount: 5, known: true, name: 'Біологія 1' })
  })

  test('ItemCost на класі-заготовці (ZP_Data_01) -- display НЕ дорівнює голому класнейму, коли DataItems.json його називає', () => {
    // Без DataItems.json у проєкті -- fallback на класнейм (той самий контракт, що
    // resolveStationItemDisplay/resolveDataItemFace без файлу).
    const f = techTreeFile('TechTree/z.json', branchDoc('zone', [node('a', { ItemCost: [{ Classname: 'ZP_Data_01', Quantity: 1, Content: '' }] })]))
    const result = buildTreeView(project(f, pointTypesFile([])), idx)
    expect(nodeById(result, 'a')!.itemCost[0]).toMatchObject({ classname: 'ZP_Data_01', display: 'ZP_Data_01', isSample: false })
  })
})

// ---- Чисте дерево фікстури: stale/zone.json + gold/PointTypes.json -- 0 проблем -----------
// zone.json — реальна гілка (12 вузлів, 5 тирів, cross-links, ParentsMode all/any), її
// Cost.Type-и ЗБІГАЮТЬСЯ з gold/PointTypes.json (обидві фікстури з того самого джерела --
// tests/fixtures/README.md). Стара ключа ResearchDevice відкидається парсером (STALE_KEYS)
// ДО того, як дійде до treeView -- він її взагалі не бачить.

describe('buildTreeView: чисте дерево (реальні фікстури)', () => {
  test('stale/zone.json + gold/PointTypes.json -- 12 вузлів, УСІ ok, 0 project-problems', () => {
    const zoneFile = techTreeFile('TechTree/zone.json', fixtureText('stale/zone.json'))
    const ptFile: ProjectFile = (() => {
      const jsonText = fixtureText('gold/PointTypes.json')
      const { value, warnings } = parseConfig(POINT_TYPES_SCHEMA, jsonText)
      return { path: 'PointTypes.json', kind: 'pointTypes', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
    })()
    const result = buildTreeView(project(zoneFile, ptFile), idx)
    expect(result.nodes).toHaveLength(12)
    expect(result.branches).toHaveLength(1)
    expect(result.branches[0].valid).toBe(true)
    expect(result.problems).toHaveLength(0)
    for (const n of result.nodes) {
      expect(n.status).toBe('ok')
      expect(n.loaded).toBe(true)
      expect(n.problems).toEqual([])
    }
    // Cost.Type-и справді резолвляться на РЕАЛЬНІ імена з PointTypes.json (не fallback на Id).
    const mutagen = nodeById(result, 'bio_mutagen')!
    expect(mutagen.cost.every((c) => c.known)).toBe(true)
    expect(mutagen.cost[0].name).not.toBe(mutagen.cost[0].type)
  })

  test('той самий zone.json БЕЗ PointTypes.json у проєкті -- усі Cost невідомі, вузли alarm (доводить, що резолв справді залежить від файлу, а не вгадує)', () => {
    const zoneFile = techTreeFile('TechTree/zone.json', fixtureText('stale/zone.json'))
    const result = buildTreeView(project(zoneFile), idx)
    expect(result.nodes.some((n) => n.status === 'alarm')).toBe(true)
    const basics = nodeById(result, 'z_basics')!
    expect(basics.cost[0].known).toBe(false)
  })
})
