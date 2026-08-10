// Тести W4 Task 6, хвіст капстоуна №1 — видалення ФАЙЛУ з проєкту (io/fileDelete.ts +
// відкладене застосування у io/project.saveDirty). TDD: написані ДО коду.
//
// Чому механізм саме «відкладений список», а не «видалити одразу»: обидва бекенди
// (io/backend.ts) працюють у термінах «редактор тримає стан у памʼяті, диск міняється
// РІВНО на «Зберегти зміни»» — той самий контракт, що dirty-файли (W1). Негайне видалення
// з диска по кліку зробило б кнопку «Видалити файл» ЄДИНОЮ дією редактора, яку не можна
// відкотити перезавантаженням проєкту, і розійшлося б із ZIP-шляхом, де «диск» узагалі
// зʼявляється лише на експорті.
//
// Дисципліна мутатора — контракт io/dataItemEdit.ts:1-14: без мутацій на відмові,
// ідентичність нечіпаних ProjectFile-обʼєктів, dirty/pending видимі в новому Project.

import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { zipSync, unzipSync } from 'fflate'
import { ZipBackend } from '../src/io/backend'
import type { StorageBackend } from '../src/io/backend'
import { loadProject, saveDirty, pendingDeletions, canSave, canExport } from '../src/io/project'
import type { Project, ProjectFile } from '../src/io/project'
import { deleteProjectFile, fileDeleteGuard, describeFileContents } from '../src/io/fileDelete'
import { createRulesFile } from '../src/io/stationEdit'
import { parseConfig } from '../src/io/parse'
import { RULES_FILE_SCHEMA, TECH_TREE_SCHEMA } from '../src/model/schema'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, 'fixtures')

function fx(rel: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, rel)))
}

const dummyBackend: StorageBackend = {
  kind: 'zip',
  list: async () => [],
  read: async () => new Uint8Array(0),
  write: async () => {},
}

function rule(id: string): Record<string, unknown> {
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
  }
}

function rulesFile(path: string, ids: string[]): ProjectFile {
  const { value, warnings } = parseConfig(RULES_FILE_SCHEMA, JSON.stringify({ ConfigVersion: 1, Rules: ids.map(rule) }))
  return { path, kind: 'rules', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function treeFile(path: string, branchId: string, nodeIds: string[]): ProjectFile {
  const doc = {
    ConfigVersion: 1,
    Branch: { Id: branchId, Name: branchId, Icon: '', SortOrder: 1, Factions: [] },
    Nodes: nodeIds.map((id) => ({
      Id: id,
      Name: id,
      Description: '',
      Icon: '',
      Tier: 1,
      Parents: [],
      ParentsMode: 'all',
      Cost: [],
      ItemCost: [],
      ResearchTimeSec: 0,
      RequiredFactions: [],
    })),
  }
  const { value, warnings } = parseConfig(TECH_TREE_SCHEMA, JSON.stringify(doc))
  return { path, kind: 'techTree', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function singleFile(path: string, kind: ProjectFile['kind']): ProjectFile {
  return { path, kind, originalBytes: new Uint8Array(0), parsed: { ConfigVersion: 1 }, warnings: [], dirty: false }
}

function foreignFile(path: string): ProjectFile {
  return { path, kind: 'foreign', originalBytes: new Uint8Array(0), warnings: [], dirty: false }
}

function project(...files: ProjectFile[]): Project {
  return { files, backend: dummyBackend }
}

// ---- describeFileContents ---------------------------------------------------------------

describe('describeFileContents: перелік вмісту для гарда', () => {
  test('правила — словʼянська плюралізація', () => {
    expect(describeFileContents(rulesFile('ProcessingRules/a.json', ['r1']))).toBe('1 правило')
    expect(describeFileContents(rulesFile('ProcessingRules/a.json', ['r1', 'r2', 'r3', 'r4']))).toBe('4 правила')
    expect(describeFileContents(rulesFile('ProcessingRules/a.json', ['a', 'b', 'c', 'd', 'e']))).toBe('5 правил')
    expect(describeFileContents(rulesFile('ProcessingRules/a.json', []))).toBe('жодного правила')
  })

  test('гілка дерева — вузли + Id гілки (адмін мусить бачити, ЯКУ гілку зносить)', () => {
    expect(describeFileContents(treeFile('TechTree/eco.json', 'eco_bio', ['a', 'b']))).toBe('2 вузли (гілка «eco_bio»)')
    expect(describeFileContents(treeFile('TechTree/eco.json', 'eco_bio', []))).toBe('жодного вузла (гілка «eco_bio»)')
    // Гілка без Id — файл, який сервер і так відхилить; перелік не мусить брехати про назву.
    expect(describeFileContents(treeFile('TechTree/eco.json', '', ['a']))).toBe('1 вузол')
  })

  test('решта видів — порожній перелік (їх однаково не можна видаляти)', () => {
    expect(describeFileContents(singleFile('Settings.json', 'settings'))).toBe('')
    expect(describeFileContents(foreignFile('StaticDevices.json'))).toBe('')
  })
})

// ---- fileDeleteGuard --------------------------------------------------------------------

describe('fileDeleteGuard: що можна видаляти', () => {
  test('файл правил і гілка дерева — можна, з переліком вмісту', () => {
    const rules = fileDeleteGuard(rulesFile('ProcessingRules/a.json', ['r1', 'r2']))
    expect(rules.deletable).toBe(true)
    expect(rules.reason).toBeUndefined()
    expect(rules.summary).toBe('2 правила')

    const tree = fileDeleteGuard(treeFile('TechTree/eco.json', 'eco_bio', ['n1']))
    expect(tree.deletable).toBe(true)
    expect(tree.summary).toBe('1 вузол (гілка «eco_bio»)')
  })

  test('усі шість одиночних конфігів — НЕ можна (сервер пише їх сам)', () => {
    for (const kind of ['settings', 'pointTypes', 'factions', 'dataItems', 'modules', 'sampleTypes'] as const) {
      const guard = fileDeleteGuard(singleFile(`${kind}.json`, kind))
      expect(guard.deletable, kind).toBe(false)
      expect(guard.reason, kind).toContain('сервер')
    }
  })

  test('чужий файл — НЕ можна (живий стан сервера)', () => {
    const guard = fileDeleteGuard(foreignFile('FactionData/ecolog.json'))
    expect(guard.deletable).toBe(false)
    expect(guard.reason).toContain('не редагується')
  })
})

// ---- deleteProjectFile ------------------------------------------------------------------

describe('deleteProjectFile: мутатор', () => {
  test('прибирає файл зі списку, ставить шлях у чергу видалення, решту лишає ТИМИ САМИМИ обʼєктами', () => {
    const keep = rulesFile('ProcessingRules/a.json', ['r1'])
    const drop = rulesFile('ProcessingRules/b.json', ['r2'])
    const settings = singleFile('Settings.json', 'settings')
    const p = project(settings, keep, drop)

    const res = deleteProjectFile(p, 'ProcessingRules/b.json')
    expect(res.ok).toBe(true)
    if (!res.ok) return

    expect(res.project.files.map((f) => f.path)).toEqual(['Settings.json', 'ProcessingRules/a.json'])
    expect(pendingDeletions(res.project)).toEqual(['ProcessingRules/b.json'])
    // Ідентичність нечіпаних файлів (React перемальовує лише те, що змінилось).
    expect(res.project.files[0]).toBe(settings)
    expect(res.project.files[1]).toBe(keep)
    // Оригінал не мутований.
    expect(p.files).toHaveLength(3)
    expect(pendingDeletions(p)).toEqual([])
  })

  test('черга накопичується, порядок видалень зберігається', () => {
    const p = project(rulesFile('ProcessingRules/a.json', []), rulesFile('ProcessingRules/b.json', []))
    const first = deleteProjectFile(p, 'ProcessingRules/b.json')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = deleteProjectFile(first.project, 'ProcessingRules/a.json')
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.project.files).toHaveLength(0)
    expect(pendingDeletions(second.project)).toEqual(['ProcessingRules/b.json', 'ProcessingRules/a.json'])
  })

  test('відмови: невідомий шлях, одиночний конфіг, чужий файл — БЕЗ мутацій', () => {
    const p = project(singleFile('Settings.json', 'settings'), foreignFile('StaticDevices.json'), rulesFile('ProcessingRules/a.json', []))

    for (const path of ['ProcessingRules/nema.json', 'Settings.json', 'StaticDevices.json']) {
      const res = deleteProjectFile(p, path)
      expect(res.ok, path).toBe(false)
      if (res.ok) return
      expect(res.error.length, path).toBeGreaterThan(0)
    }
    expect(p.files).toHaveLength(3)
    expect(pendingDeletions(p)).toEqual([])
  })

  test('повторне видалення того самого шляху — відмова (файлу вже немає у проєкті)', () => {
    const p = project(rulesFile('ProcessingRules/a.json', []))
    const first = deleteProjectFile(p, 'ProcessingRules/a.json')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const again = deleteProjectFile(first.project, 'ProcessingRules/a.json')
    expect(again.ok).toBe(false)
    expect(pendingDeletions(first.project)).toEqual(['ProcessingRules/a.json'])
  })
})

// ---- Гейт кнопок ------------------------------------------------------------------------

describe('canSave/canExport бачать чергу видалення', () => {
  test('видалення без жодного dirty-файлу однаково вмикає «Зберегти» і глушить експорт', () => {
    const p = project(rulesFile('ProcessingRules/a.json', []))
    expect(canSave(p)).toBe(false)
    expect(canExport(p)).toBe(true)

    const res = deleteProjectFile(p, 'ProcessingRules/a.json')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    // Без цього видалення НІКОЛИ не доїхало б до сховища: кнопка «Зберегти зміни»
    // лишалась би заблокованою (dirty-файлів немає), а ZIP пакував би стан «до».
    expect(canSave(res.project)).toBe(true)
    expect(canExport(res.project)).toBe(false)
  })
})

// ---- Застосування до сховища (ZipBackend — єдиний бекенд, тестовний у Node) --------------

function zipOfFixtures(): Uint8Array {
  return zipSync({
    'Settings.json': fx('gold/Settings.json'),
    'ProcessingRules/demo.json': fx('gold/ProcessingRules/demo.json'),
    'StaticDevices.json': fx('gold/StaticDevices.json'),
  })
}

function pathsOf(zipBytes: Uint8Array): string[] {
  return Object.keys(unzipSync(zipBytes)).filter((p) => !p.endsWith('/'))
}

describe('saveDirty застосовує чергу видалення', () => {
  test('файл зникає зі сховища й з експорту, черга спорожняється', async () => {
    const zb = ZipBackend.fromBytes(zipOfFixtures())
    const loaded = await loadProject(zb)
    const res = deleteProjectFile(loaded, 'ProcessingRules/demo.json')
    expect(res.ok).toBe(true)
    if (!res.ok) return

    const saved = await saveDirty(res.project)
    expect(saved.removed).toEqual(['ProcessingRules/demo.json'])
    expect(saved.written).toEqual([])
    expect(pendingDeletions(res.project)).toEqual([])
    expect(await zb.list()).not.toContain('ProcessingRules/demo.json')
    expect(pathsOf(zb.export())).toEqual(['Settings.json', 'StaticDevices.json'])
    expect(canExport(res.project)).toBe(true)
  })

  test('видалення застосовується ДО записів: файл, створений заново під тим самим шляхом, виживає', async () => {
    const zb = ZipBackend.fromBytes(zipOfFixtures())
    const loaded = await loadProject(zb)
    const dropped = deleteProjectFile(loaded, 'ProcessingRules/demo.json')
    expect(dropped.ok).toBe(true)
    if (!dropped.ok) return
    const recreated = createRulesFile(dropped.project, 'demo')
    expect(recreated.ok).toBe(true)
    if (!recreated.ok) return
    expect(recreated.path).toBe('ProcessingRules/demo.json')

    const saved = await saveDirty(recreated.project)
    expect(saved.removed).toEqual(['ProcessingRules/demo.json'])
    expect(saved.written).toEqual(['ProcessingRules/demo.json'])
    // Порядок навпаки стер би щойно записаний файл: на диску мусить лежати НОВИЙ (порожній) вміст.
    expect(await zb.list()).toContain('ProcessingRules/demo.json')
    expect(new TextDecoder().decode(await zb.read('ProcessingRules/demo.json'))).toContain('"Rules": []')
  })

  test('бекенд без remove — ЯВНА відмова, а не тихе «нібито видалено»', async () => {
    const files = new Map<string, Uint8Array>()
    files.set('ProcessingRules/a.json', new TextEncoder().encode('{\n    "ConfigVersion": 1,\n    "Rules": []\n}'))
    const noRemove: StorageBackend = {
      kind: 'zip',
      list: async () => [...files.keys()],
      read: async (p) => files.get(p)!,
      write: async (p, d) => {
        files.set(p, d)
      },
    }
    const loaded = await loadProject(noRemove)
    const res = deleteProjectFile(loaded, 'ProcessingRules/a.json')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    await expect(saveDirty(res.project)).rejects.toThrow(/видал/i)
    // Черга НЕ спорожнилась: адмін бачить, що видалення не застосоване.
    expect(pendingDeletions(res.project)).toEqual(['ProcessingRules/a.json'])
    expect(files.has('ProcessingRules/a.json')).toBe(true)
  })

  // Ревью T6, Important 2: збій remove РАНІШЕ кидав виняток ДО записів — жоден dirty-файл
  // не зберігався, і єдиним виходом було перевідкрити проєкт (втративши правки). Тепер
  // записи виконуються, а зведена помилка кидається ПІСЛЯ них. Дискримінує стару поведінку.
  test('збій видалення НЕ забирає записи в заручники: правки на диску, помилка — після', async () => {
    const files = new Map<string, Uint8Array>()
    files.set('ProcessingRules/a.json', new TextEncoder().encode('{\n    "ConfigVersion": 1,\n    "Rules": []\n}'))
    files.set('ProcessingRules/b.json', new TextEncoder().encode('{\n    "ConfigVersion": 1,\n    "Rules": []\n}'))
    const flaky: StorageBackend = {
      kind: 'folder',
      list: async () => [...files.keys()],
      read: async (p) => files.get(p)!,
      write: async (p, d) => {
        files.set(p, d)
      },
      remove: async () => {
        throw new Error('NoModificationAllowedError: файл заблоковано')
      },
    }
    const loaded = await loadProject(flaky)
    const del = deleteProjectFile(loaded, 'ProcessingRules/a.json')
    expect(del.ok).toBe(true)
    if (!del.ok) return
    // Друга правка чекає на запис — саме її стара поведінка втрачала.
    const bFile = del.project.files.find((f) => f.path === 'ProcessingRules/b.json')!
    ;(bFile.parsed as { Rules: unknown[] }).Rules = [{ Id: 'нове_правило' }]
    bFile.dirty = true

    await expect(saveDirty(del.project)).rejects.toThrow(/видалення не вдалося/i)
    // Запис ВІДБУВСЯ (головне): байти на диску, dirty знято.
    expect(new TextDecoder().decode(files.get('ProcessingRules/b.json')!)).toContain('нове_правило')
    expect(bFile.dirty).toBe(false)
    // А невдале видалення лишилось у черзі — повторна спроба доробить.
    expect(pendingDeletions(del.project)).toEqual(['ProcessingRules/a.json'])
    expect(files.has('ProcessingRules/a.json')).toBe(true)
  })

  // Ревью T6, minor 4: видалити -> створити під тим самим імʼям -> видалити знову клало
  // шлях у чергу двічі, і звіт казав «Видалено файлів: 2» про один файл.
  test('дубль у черзі не рахується двічі у звіті', async () => {
    const files = new Map<string, Uint8Array>()
    files.set('ProcessingRules/a.json', new TextEncoder().encode('{\n    "ConfigVersion": 1,\n    "Rules": []\n}'))
    const zb: StorageBackend = {
      kind: 'zip',
      list: async () => [...files.keys()],
      read: async (p) => files.get(p)!,
      write: async (p, d) => {
        files.set(p, d)
      },
      remove: async (p) => {
        files.delete(p)
      },
    }
    const loaded = await loadProject(zb)
    const p1 = deleteProjectFile(loaded, 'ProcessingRules/a.json')
    expect(p1.ok).toBe(true)
    if (!p1.ok) return
    // Рукотворний дубль у черзі — те, що дає сценарій «видалити -> створити -> видалити».
    p1.project.deleted = ['ProcessingRules/a.json', 'ProcessingRules/a.json']
    const res = await saveDirty(p1.project)
    expect(res.removed).toEqual(['ProcessingRules/a.json'])
  })
})
