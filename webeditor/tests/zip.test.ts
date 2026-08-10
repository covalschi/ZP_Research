// Тести Task 6: бекенди сховища за одним StorageBackend і модель проєкту. ZipBackend —
// єдиний бекенд, який можна юніт-тестувати в Node (DirectoryBackend потребує браузерного
// File System Access API — тут перевіряється лише його фіча-детект). Класифікація шляхів,
// сортування rules/techTree і завантаження/збереження — чисті функції над StorageBackend,
// тож усе, що стосується цієї логіки, перевіряється тут через ZipBackend.

import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { zipSync, unzipSync } from 'fflate'
import { ZipBackend, DirectoryBackend } from '../src/io/backend'
import type { StorageBackend } from '../src/io/backend'
import {
  loadProject,
  saveDirty,
  sortLikeServer,
  classifyPath,
  MULTI_FILE_DIRS,
  SINGLE_FILE_KINDS,
  isMultiFileDir,
} from '../src/io/project'
import { SCHEMAS } from '../src/model/schema'
import type { ConfigKind } from '../src/model/schema'
import { encodeConfig } from '../src/io/jsonWriter'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, 'fixtures')

function fx(rel: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, rel)))
}

// Імітує реальний корінь ZP_Research\: вісім конфігів редактора (тут шість одиночних +
// один rules-файл — вистачає для перевірки класифікації; sampleTypes додано W2.5 Task 3)
// з РЕАЛЬНИХ байтів gold-фікстур (Task 2), плюс приклади "чужих" шляхів (одиночний файл,
// вкладеність під невідомим каталогом, каталог бекапів) — так тест бекенда не залежить
// від коректності серіалізатора.
function projectPaths(): Record<string, Uint8Array> {
  return {
    'Settings.json': fx('gold/Settings.json'),
    'PointTypes.json': fx('gold/PointTypes.json'),
    'Factions.json': fx('gold/Factions.json'),
    'DataItems.json': fx('gold/DataItems.json'),
    'Modules.json': fx('gold/Modules.json'),
    'SampleTypes.json': fx('gold/SampleTypes.json'),
    'ProcessingRules/demo.json': fx('gold/ProcessingRules/demo.json'),
    'StaticDevices.json': fx('gold/StaticDevices.json'), // foreign: не один із восьми конфігів
    // 76561190000000000 — задокументований невалідний плейсхолдер (fixtures/README.md:
    // нижче реального мінімуму SteamID64), НЕ форма реального акаунта.
    'FactionData/76561190000000000.json': fx('gold/DataItems.json'), // вміст неважливий, foreign не читається
    'ConfigBackup/Settings_20260101.bak': fx('gold/Settings.json'),
  }
}

function zipOfFixtures(): Uint8Array {
  return zipSync(projectPaths())
}

// Порівняння ПОФАЙЛОВО, а не сирих байтів цілого архіву: fflate.zipSync пише mtime кожного
// запису (момент виклику, якщо джерело не несло свій), тож export() у різні секунди дає
// різні байти архіву при тотожному вмісті файлів — властивість документована в backend.ts.
function filesOf(zipBytes: Uint8Array): Record<string, string> {
  const unzipped = unzipSync(zipBytes)
  const out: Record<string, string> = {}
  for (const [path, data] of Object.entries(unzipped)) {
    if (path.endsWith('/')) continue
    out[path] = Buffer.from(data).toString('base64')
  }
  return out
}

describe('Step 1 (брифовані тести)', () => {
  test('zip: імпорт -> експорт без змін дає той самий набір байтів', () => {
    const zb = ZipBackend.fromBytes(zipOfFixtures())
    expect(filesOf(zb.export())).toEqual(filesOf(zipOfFixtures()))
  })

  test('порядок файлів = дзеркало SortFileNames (ASCII-lower, стабільно)', () => {
    expect(sortLikeServer(['B.json', 'a.json', 'A2.json'])).toEqual(['a.json', 'A2.json', 'B.json'])
  })
})

describe('sortLikeServer: властивості', () => {
  test('рівні ключі (той самий basename у різному регістрі) не переставляються — стабільність', () => {
    expect(sortLikeServer(['Alpha.json', 'alpha.JSON'])).toEqual(['Alpha.json', 'alpha.JSON'])
  })

  test('лишає масив тієї ж довжини, без втрат/дублів', () => {
    const input = ['gamma.json', 'Beta.json', 'alpha.json', 'Beta.json']
    expect(sortLikeServer(input).length).toBe(input.length)
  })
})

describe('ZipBackend', () => {
  test('list(): відносні шляхи без каталогових псевдозаписів', async () => {
    const zb = ZipBackend.fromBytes(zipOfFixtures())
    const list = await zb.list()
    expect([...list].sort()).toEqual(Object.keys(projectPaths()).sort())
  })

  test('read(): байти файлу збігаються з вхідними', async () => {
    const zb = ZipBackend.fromBytes(zipOfFixtures())
    const bytes = await zb.read('Settings.json')
    expect(Buffer.from(bytes).equals(Buffer.from(fx('gold/Settings.json')))).toBe(true)
  })

  test('read(): невідомий шлях -> відмова', async () => {
    const zb = ZipBackend.fromBytes(zipOfFixtures())
    await expect(zb.read('nope.json')).rejects.toThrow()
  })

  test('write(): нові байти видно і в read(), і в export()', async () => {
    const zb = ZipBackend.fromBytes(zipOfFixtures())
    const bytes = new TextEncoder().encode('{\n    "x": 1\n}')
    await zb.write('Settings.json', bytes)
    expect(Buffer.from(await zb.read('Settings.json')).equals(Buffer.from(bytes))).toBe(true)

    const reopened = ZipBackend.fromBytes(zb.export())
    expect(Buffer.from(await reopened.read('Settings.json')).equals(Buffer.from(bytes))).toBe(true)
  })

  test('шляхи зі зворотними слешами нормалізуються до /', async () => {
    const zip = zipSync({ 'ProcessingRules\\weird.json': fx('gold/ProcessingRules/demo.json') })
    const zb = ZipBackend.fromBytes(zip)
    expect(await zb.list()).toEqual(['ProcessingRules/weird.json'])
  })

  test('порожній архів -> порожній список, без падіння', async () => {
    const zb = ZipBackend.fromBytes(zipSync({}))
    expect(await zb.list()).toEqual([])
  })

  test('kind = "zip"', () => {
    expect(ZipBackend.fromBytes(zipSync({})).kind).toBe('zip')
  })
})

describe('DirectoryBackend: лише фіча-детект (сам бекенд не юніт-тестовний у Node)', () => {
  test('isSupported(): false у середовищі без showDirectoryPicker (Node/vitest)', () => {
    expect(DirectoryBackend.isSupported()).toBe(false)
  })

  test('pick(): відмова замість падіння, коли API недоступний', async () => {
    await expect(DirectoryBackend.pick()).rejects.toThrow()
  })
})

describe('classifyPath', () => {
  const cases: [string, string][] = [
    ['Settings.json', 'settings'],
    ['settings.json', 'settings'], // регістронезалежно за іменем файлу
    ['SETTINGS.JSON', 'settings'],
    ['PointTypes.json', 'pointTypes'],
    ['Factions.json', 'factions'],
    ['DataItems.json', 'dataItems'],
    ['Modules.json', 'modules'],
    ['SampleTypes.json', 'sampleTypes'],
    ['sampletypes.json', 'sampleTypes'], // регістронезалежно, той самий принцип, що й решта п'яти
    ['ProcessingRules/demo.json', 'rules'],
    ['TechTree/zone.json', 'techTree'],
    // Регістронезалежність каталогу (W2 Task 4, відкладений minor рев'ю W1): FS Windows не
    // розрізняє регістр каталогу, і сервер (рушійний FindFile) теж — адмін цілком міг
    // зберегти "processingrules" замість "ProcessingRules".
    ['processingrules/x.json', 'rules'],
    ['PROCESSINGRULES/x.json', 'rules'],
    ['techtree/x.json', 'techTree'],
    ['TeChTrEe/x.json', 'techTree'],
    ['StaticDevices.json', 'foreign'],
    ['StaticDevicesState.json', 'foreign'],
    ['FactionData/x.json', 'foreign'],
    ['FactionData/nested/deep.json', 'foreign'], // вкладеність під невідомим каталогом
    ['PlayerData/76561190000000000.json', 'foreign'],
    ['ConfigBackup/Settings_20260101.bak', 'foreign'],
    ['random.txt', 'foreign'],
    ['ProcessingRules/nested/deep.json', 'foreign'], // > 2 сегментів під відомим каталогом теж foreign
    // Рев'ю W1 (Important): голий бракетний lookup на об'єкт-літералі успадковує
    // Object.prototype, тож ці імена раніше давали ЩОСЬ ІСТИННЕ (сам Object.prototype.
    // constructor) замість undefined -> classifyPath повертав не-foreign "kind", а
    // loadProject падав нижче за течією на SCHEMAS[kind].fields. 'constructor' без
    // розширення (один сегмент) не збігається НІ З ОДНИМ із п'яти відомих імен файлів
    // (settings.json/pointtypes.json/...), тож безпечний результат тут — 'foreign', так
    // само як і для будь-якого іншого невідомого одиночного імені.
    ['constructor', 'foreign'],
    ['constructor/x.json', 'foreign'],
    ['__proto__/x.json', 'foreign'],
  ]
  for (const [path, expected] of cases) {
    test(`${path} -> ${expected}`, () => {
      expect(classifyPath(path)).toBe(expected)
    })
  }
})

// Рев'ю T6, раунд 1 (Important): backend.ts і classifyPath раніше тримали ДВІ незалежні
// копії переліку багатофайлових каталогів ({'ProcessingRules', 'TechTree'}), і жоден тест
// цього не ловив — ZipBackend плоский, тож код DirectoryBackend.list(), де жила друга копія,
// узагалі не виконувався жодним тестом. Фікс: MULTI_FILE_DIRS/SINGLE_FILE_KINDS у project.ts
// стали ЄДИНИМ джерелом істини (backend.ts тепер імпортує MULTI_FILE_DIRS замість власного
// переліку) — ці тести намагаються зловити майбутню розбіжність БЕЗ повторного хардкоду
// імен каталогів/kind'ів тут: вони проганяють УСІ ConfigKind зі SCHEMAS і УСІ імена з
// MULTI_FILE_DIRS через саму classifyPath.
describe("MULTI_FILE_DIRS <-> classifyPath: узгодженість (рев'ю T6, раунд 1)", () => {
  test('пряме: кожне ім\'я з MULTI_FILE_DIRS дає НЕ-foreign kind', () => {
    expect(MULTI_FILE_DIRS.size).toBeGreaterThan(0) // страховка від порожнього набору, що тривіально "проходить"
    for (const dir of MULTI_FILE_DIRS) {
      expect(classifyPath(`${dir}/x.json`), dir).not.toBe('foreign')
    }
  })

  test('зворотне: кожен НЕ-одиночний ConfigKind має відповідний каталог у MULTI_FILE_DIRS', () => {
    const allKinds = Object.keys(SCHEMAS) as ConfigKind[]
    for (const kind of allKinds) {
      if (SINGLE_FILE_KINDS.has(kind)) continue
      const matchingDir = [...MULTI_FILE_DIRS].find((dir) => classifyPath(`${dir}/x.json`) === kind)
      expect(matchingDir, `ConfigKind '${kind}' не має каталогу в MULTI_FILE_DIRS`).toBeDefined()
    }
  })

  test('повнота: кожен ConfigKind зі SCHEMAS — рівно одна з двох категорій (одиночний XOR багатофайловий)', () => {
    const allKinds = Object.keys(SCHEMAS) as ConfigKind[]
    const multiKindsViaDirs = new Set([...MULTI_FILE_DIRS].map((dir) => classifyPath(`${dir}/x.json`)))
    expect(allKinds.length).toBeGreaterThan(0)
    for (const kind of allKinds) {
      const isSingle = SINGLE_FILE_KINDS.has(kind)
      const isMulti = multiKindsViaDirs.has(kind)
      expect(isSingle !== isMulti, `ConfigKind '${kind}': isSingle=${isSingle} isMulti=${isMulti} (мусить бути рівно один)`).toBe(true)
    }
  })
})

// isMultiFileDir — ЄДИНЕ джерело істини для backend.ts.DirectoryBackend.list() і
// writeback.ts.NodeFsBackend.list() (W2 Task 4): обидва мали б розходитись, якби кожен
// звертався до MULTI_FILE_DIRS напряму (case-sensitive Set) замість цієї функції.
describe('isMultiFileDir: регістронезалежність узгоджена з classifyPath', () => {
  test('канонічний регістр — true для обох відомих каталогів', () => {
    for (const dir of MULTI_FILE_DIRS) {
      expect(isMultiFileDir(dir), dir).toBe(true)
    }
  })

  test('довільний регістр теж true', () => {
    expect(isMultiFileDir('processingrules')).toBe(true)
    expect(isMultiFileDir('PROCESSINGRULES')).toBe(true)
    expect(isMultiFileDir('techtree')).toBe(true)
  })

  test('невідомий каталог — false', () => {
    expect(isMultiFileDir('FactionData')).toBe(false)
    expect(isMultiFileDir('ConfigBackup')).toBe(false)
  })
})

describe('loadProject', () => {
  test('класифікує вісім конфігів + foreign; читає й розбирає лише впізнані', async () => {
    const zb = ZipBackend.fromBytes(zipOfFixtures())
    const project = await loadProject(zb)
    expect(project.backend).toBe(zb)
    expect(project.files.length).toBe(Object.keys(projectPaths()).length)

    const byPath = new Map(project.files.map((f) => [f.path, f]))

    const settings = byPath.get('Settings.json')!
    expect(settings.kind).toBe('settings')
    expect(settings.warnings).toEqual([]) // gold-фікстура канонічна, попереджень бути не мусить
    expect(settings.dirty).toBe(false)
    expect(settings.originalBytes.length).toBeGreaterThan(0)
    expect(settings.parsed).toBeDefined()
    expect((settings.parsed as Record<string, unknown>).ConfigVersion).toBe(1)

    const sampleTypes = byPath.get('SampleTypes.json')!
    expect(sampleTypes.kind).toBe('sampleTypes')
    expect(sampleTypes.warnings).toEqual([]) // gold-фікстура канонічна (W2.5 Task 3)
    expect(sampleTypes.dirty).toBe(false)
    expect((sampleTypes.parsed as Record<string, unknown>).ConfigVersion).toBe(1)

    const rules = byPath.get('ProcessingRules/demo.json')!
    expect(rules.kind).toBe('rules')
    expect(rules.warnings).toEqual([])

    for (const path of ['StaticDevices.json', 'FactionData/76561190000000000.json', 'ConfigBackup/Settings_20260101.bak']) {
      const f = byPath.get(path)!
      expect(f.kind, path).toBe('foreign')
      expect(f.originalBytes.length, path).toBe(0) // свідомо не читаємо чуже
      expect(f.parsed, path).toBeUndefined()
      expect(f.warnings, path).toEqual([])
      expect(f.dirty, path).toBe(false)
    }
  })

  test('rules/techTree впорядковуються sortLikeServer за іменем файлу (не порядком архіву)', async () => {
    const paths: Record<string, Uint8Array> = {
      'Settings.json': fx('gold/Settings.json'),
      'ProcessingRules/B.json': encodeConfig(SCHEMAS.rules, {}),
      'ProcessingRules/a.json': encodeConfig(SCHEMAS.rules, {}),
      'ProcessingRules/A2.json': encodeConfig(SCHEMAS.rules, {}),
      'TechTree/z.json': encodeConfig(SCHEMAS.techTree, {}),
      'TechTree/A.json': encodeConfig(SCHEMAS.techTree, {}),
    }
    const zb = ZipBackend.fromBytes(zipSync(paths))
    const project = await loadProject(zb)

    expect(project.files.filter((f) => f.kind === 'rules').map((f) => f.path)).toEqual([
      'ProcessingRules/a.json',
      'ProcessingRules/A2.json',
      'ProcessingRules/B.json',
    ])
    expect(project.files.filter((f) => f.kind === 'techTree').map((f) => f.path)).toEqual([
      'TechTree/A.json',
      'TechTree/z.json',
    ])
  })

  test('порожній бекенд -> порожній проєкт, без падіння', async () => {
    const zb = ZipBackend.fromBytes(zipSync({}))
    const project = await loadProject(zb)
    expect(project.files).toEqual([])
  })

  test('дублікати імені файлу, що різняться лише регістром, не зливаються', async () => {
    const paths: Record<string, Uint8Array> = {
      'ProcessingRules/Alpha.json': encodeConfig(SCHEMAS.rules, {}),
      'ProcessingRules/alpha.json': encodeConfig(SCHEMAS.rules, {}),
    }
    const zb = ZipBackend.fromBytes(zipSync(paths))
    const project = await loadProject(zb)
    expect(project.files.map((f) => f.path).sort()).toEqual(['ProcessingRules/Alpha.json', 'ProcessingRules/alpha.json'])
    expect(project.files.length).toBe(2)
  })

  // Регресія рев'ю W1 (Important): до фіксу lookup у project.ts, ZIP з файлом
  // 'constructor/x.json' валив loadProject винятком «Cannot read properties of undefined
  // (reading 'fields')» (classifyPath повертав Object.prototype.constructor замість
  // 'foreign', і код нижче намагався SCHEMAS[тойОб'єкт].fields). Прямий доказ, що
  // ZIP з таким шляхом тепер відкривається штатно.
  test("ZIP із файлом 'constructor/x.json' завантажується без падіння — файл класифікується як foreign", async () => {
    const paths: Record<string, Uint8Array> = {
      'Settings.json': fx('gold/Settings.json'),
      'constructor/x.json': fx('gold/DataItems.json'),
    }
    const zb = ZipBackend.fromBytes(zipSync(paths))
    const project = await loadProject(zb) // до фіксу тут кидало «Cannot read properties of undefined (reading 'fields')»
    const f = project.files.find((file) => file.path === 'constructor/x.json')
    expect(f).toBeDefined()
    expect(f!.kind).toBe('foreign')
    expect(f!.originalBytes.length).toBe(0) // foreign -> байти свідомо не читаються
    expect(f!.parsed).toBeUndefined()
  })
})

describe('saveDirty', () => {
  test('пише лише dirty файли через encodeConfig, скидає прапорець, повертає записані шляхи', async () => {
    const zb = ZipBackend.fromBytes(zipOfFixtures())
    const project = await loadProject(zb)
    const settings = project.files.find((f) => f.path === 'Settings.json')!
    const rules = project.files.find((f) => f.path === 'ProcessingRules/demo.json')!
    const foreign = project.files.find((f) => f.path === 'StaticDevices.json')!

    ;(settings.parsed as Record<string, unknown>).DebugMode = false
    settings.dirty = true
    foreign.dirty = true // помилково виставлений прапорець на foreign — не мусить нічого записати

    // W4 Task 6: saveDirty повертає ОБИДВІ дії — записи й застосовані видалення
    // (черга видалень тут порожня, тож removed=[]).
    const { written, removed } = await saveDirty(project)

    expect(written).toEqual(['Settings.json'])
    expect(removed).toEqual([])
    expect(settings.dirty).toBe(false)
    expect(rules.dirty).toBe(false)
    // foreign.dirty НЕ скидається: прапорець означає "є незбережені зміни", а для foreign
    // saveDirty свідомо нічого не пише — скинути прапорець тут було б неправдою (виглядало
    // б так, ніби зміну зберегли). Перевіряємо нижче байтами на диску, що запису не було.
    expect(foreign.dirty).toBe(true)

    const onDisk = await zb.read('Settings.json')
    expect(Buffer.from(onDisk).equals(Buffer.from(encodeConfig(SCHEMAS.settings, settings.parsed)))).toBe(true)
    expect(new TextDecoder().decode(onDisk)).toContain('"DebugMode": 0')

    // Незачеплений rules-файл: байти на диску не переписані.
    const rulesOnDisk = await zb.read('ProcessingRules/demo.json')
    expect(Buffer.from(rulesOnDisk).equals(Buffer.from(fx('gold/ProcessingRules/demo.json')))).toBe(true)

    // foreign не записаний попри виставлений прапорець.
    const foreignOnDisk = await zb.read('StaticDevices.json')
    expect(Buffer.from(foreignOnDisk).equals(Buffer.from(fx('gold/StaticDevices.json')))).toBe(true)
  })

  test('викликає backend.write() РІВНО для dirty-файлів (не для чистих і не для foreign)', async () => {
    const zb = ZipBackend.fromBytes(zipOfFixtures())
    const calls: string[] = []
    const spy: StorageBackend = {
      kind: zb.kind,
      list: () => zb.list(),
      read: (p) => zb.read(p),
      write: async (p, d) => {
        calls.push(p)
        await zb.write(p, d)
      },
    }
    const project = await loadProject(spy)
    const settings = project.files.find((f) => f.path === 'Settings.json')!
    const foreign = project.files.find((f) => f.path === 'StaticDevices.json')!
    settings.dirty = true
    foreign.dirty = true

    await saveDirty(project)

    expect(calls).toEqual(['Settings.json'])
  })

  test('нічого не dirty -> нічого не пишеться, порожній результат', async () => {
    const zb = ZipBackend.fromBytes(zipOfFixtures())
    const project = await loadProject(zb)
    expect(await saveDirty(project)).toEqual({ written: [], removed: [] })
  })
})
