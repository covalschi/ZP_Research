// Тести імпортера класів (T7 Steps 3/5). Дві частини:
// 1) синтетика в пам'яті (ганяється завжди, нуль чужого контенту): виявлення джерел,
//    мердж later-wins, display property-merge, пріоритет резолву stringtable, лічильники
//    статистики, кеш, скасування;
// 2) ПАРИТЕТ-ПРИЙМАННЯ по реальному корпусу (skipIf без теки гри): той самий конвеєр,
//    що в браузері (classImportCore + discoverSources), прогнаний Node-адаптером по
//    справжніх DayZ\ + E:\dayzmod, проти вшитого classindex.json з python-еталона T1 —
//    рівність МНОЖИНИ імен класів по коренях І display-рядків кожного класу.

import { describe, test, expect } from 'vitest'
import { existsSync, readdirSync, statSync, openSync, readSync, closeSync, readFileSync } from 'fs'
import { join, basename } from 'path'
import {
  discoverSources,
  importClassIndex,
  dirFromFileList,
  type ImportCache,
  type CachedPbo,
  type WorkerCtor,
} from '../src/io/classImport'
import type { DirLike, DirChild, FileLike } from '../src/io/classImportCore'
import { parseStringtableCsv, fileLikeFromFile } from '../src/io/classImportCore'
import { PBO_PACKING_CPRS } from '../src/io/pbo'

// ---- Синтетичні теки/PBO в пам'яті ---------------------------------------------------------

function asciiz(s: string): number[] {
  return [...new TextEncoder().encode(s), 0]
}
function u32(v: number): number[] {
  return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]
}
function entryRecord(name: string, packing: number, orig: number, dsize: number): number[] {
  return [...asciiz(name), ...u32(packing), ...u32(orig), ...u32(0), ...u32(0), ...u32(dsize)]
}
function buildPbo(files: Array<{ name: string; data: Uint8Array; packing?: number; orig?: number }>): Uint8Array {
  const parts: number[] = []
  for (const f of files) parts.push(...entryRecord(f.name, f.packing ?? 0, f.orig ?? 0, f.data.length))
  parts.push(...entryRecord('', 0, 0, 0))
  for (const f of files) parts.push(...f.data)
  return new Uint8Array(parts)
}
const enc = (s: string) => new TextEncoder().encode(s)

type MemTree = { [name: string]: MemTree | Uint8Array }

function memDir(name: string, tree: MemTree): DirLike {
  return {
    name,
    async children(): Promise<DirChild[]> {
      const out: DirChild[] = []
      for (const [childName, value] of Object.entries(tree)) {
        if (value instanceof Uint8Array) {
          out.push({
            kind: 'file',
            name: childName,
            open: async (): Promise<FileLike> => ({
              name: childName,
              size: value.length,
              lastModified: 1000,
              slice: async (s, e) => value.subarray(s, Math.min(e, value.length)),
            }),
          })
        } else {
          out.push({ kind: 'dir', name: childName, dir: memDir(childName, value) })
        }
      }
      return out
    },
  }
}

const CFG_A = enc('class CfgVehicles { class Apple: Edible_Base { displayName="$STR_apple"; }; class Pear { displayName="Груша літерал"; }; };')
const CFG_B = enc('class CfgVehicles { class Apple: Edible_Base { attenuation="x"; }; };') // без display
const ST_A = enc('"Language","original","english",\r\n"STR_apple","Яблуко A","Apple A",\r\n')
const ST_B = enc('"Language","original","english",\r\n"str_APPLE","","Apple B",\r\n') // original порожній

function gameTree(): MemTree {
  return {
    Addons: { 'food.pbo': buildPbo([{ name: 'config.cpp', data: CFG_A }, { name: 'stringtable.csv', data: ST_A }]) },
    dta: {
      'bin.pbo': buildPbo([{ name: 'config.cpp', data: enc('class CfgVehicles { class BinThing {}; };') }]),
      'languagecore.pbo': buildPbo([{ name: 'stringtable.csv', data: enc('"Language","original","english",\r\n"str_core","Ядро","Core",\r\n') }]),
    },
    '!Workshop': {
      '@SoundMod': { addons: { 'sound.pbo': buildPbo([{ name: 'config.cpp', data: CFG_B }, { name: 'languagecore\\stringtable.csv', data: ST_B }]) } },
      '@NoAddons': { docs: {} },
    },
  }
}

describe('discoverSources (форми вибраних тек)', () => {
  test('корінь гри: ваніль (Addons + dta/bin + dta/languagecore) -> моди !Workshop', async () => {
    const { sources, skipped } = await discoverSources([memDir('DayZ', gameTree())])
    expect(sources.map((s) => `${s.modLabel}:${s.path.split('/').pop()}`)).toEqual([
      'vanilla:food.pbo',
      'vanilla:bin.pbo',
      'vanilla:languagecore.pbo',
      '@SoundMod:sound.pbo',
    ])
    // @NoAddons без addons/ — легально і БЕЗ запису в skipped (python: continue мовчки)
    expect(skipped.filter((s) => s.source === '@NoAddons')).toEqual([])
  })

  test('тека модпаку напряму (@*), тека одного мода, тека з *.pbo', async () => {
    const ws = await discoverSources([memDir('!Workshop', gameTree()['!Workshop'] as MemTree)])
    expect(ws.sources.map((s) => s.modLabel)).toEqual(['@SoundMod'])
    const mod = await discoverSources([memDir('@SoundMod', (gameTree()['!Workshop'] as MemTree)['@SoundMod'] as MemTree)])
    expect(mod.sources.map((s) => s.modLabel)).toEqual(['@SoundMod'])
    const bare = await discoverSources([memDir('addons', { 'x.pbo': buildPbo([]) })])
    expect(bare.sources.map((s) => s.modLabel)).toEqual(['addons'])
  })

  test('тека Steam-контенту (числові ID з addons/ всередині, без @) -> кожен ID = мод', async () => {
    // Реальна розкладка steamapps\workshop\content\221100: браузер НЕ бачить крізь
    // NTFS-junction'и !Workshop (перевірено зондом: webkitdirectory віддає 0 файлів),
    // тож адмінові на стандартному Steam-клієнті потрібен шлях через справжню теку
    // контенту — підтеки там названі Workshop-ID, не @Ім'я.
    const tree: MemTree = {
      '1559212036': { addons: { 'cf.pbo': buildPbo([]) } },
      '2545497806': { Addons: { 'vpp.pbo': buildPbo([]) } }, // регістр Addons — теж легальний
      '123': { docs: {} }, // без addons/ — не мод, мовчки повз (як @NoAddons)
    }
    const { sources } = await discoverSources([memDir('221100', tree)])
    expect(sources.map((s) => `${s.modLabel}:${s.path.split('/').pop()}`)).toEqual([
      '1559212036:cf.pbo',
      '2545497806:vpp.pbo',
    ])
  })

  test('корінь гри з ПОРОЖНІМ !Workshop (junction-и, невидимі браузеру) -> явне попередження', async () => {
    const tree = gameTree()
    ;(tree['!Workshop'] as MemTree)['@SoundMod'] = {} // моди «зникли» — як після пропуску junction-ів
    const { skipped } = await discoverSources([memDir('DayZ', tree)])
    expect(skipped.some((s) => s.source === '!Workshop' && s.reason.includes('221100'))).toBe(true)
  })

  test('непізнавана тека -> skipped зі зрозумілою причиною', async () => {
    const { sources, skipped } = await discoverSources([memDir('Documents', { 'readme.txt': enc('hi') })])
    expect(sources).toEqual([])
    expect(skipped.length).toBe(1)
    expect(skipped[0].reason).toContain('не схоже')
  })

  test('битий junction мода -> skipped, не виняток', async () => {
    const broken: DirLike = {
      name: '@Broken',
      children: async () => {
        throw new Error('ENOENT')
      },
    }
    const ws: DirLike = {
      name: '!Workshop',
      children: async () => [{ kind: 'dir', name: '@Broken', dir: broken }],
    }
    const { skipped } = await discoverSources([ws])
    expect(skipped.some((s) => s.source === '@Broken' && s.reason.includes('junction'))).toBe(true)
  })

  test('дублікати шляхів (гра + !Workshop з неї ж окремо) дедупляться', async () => {
    const tree = gameTree()
    const { sources, skipped } = await discoverSources([
      memDir('DayZ', tree),
      memDir('!Workshop', tree['!Workshop'] as MemTree),
    ])
    // ...з різними імен тек шлях різний -- дедуп спрацьовує лише на ідентичних ключах:
    // додаємо той самий корінь двічі
    const twice = await discoverSources([memDir('DayZ', tree), memDir('DayZ', tree)])
    expect(twice.sources.length).toBe(sources.length - 1) // -1: '@SoundMod' під іншим префіксом не здедупився
    expect(twice.skipped.some((s) => s.source === '(дедуп)')).toBe(true)
    expect(skipped).toBeDefined()
  })
})

describe('importClassIndex (синтетика, головний потік, без кеша)', () => {
  test('мердж later-wins + display property-merge + $STR-резолв "пізніше джерело виграє"', async () => {
    const { index, raw, stats } = await importClassIndex([memDir('DayZ', gameTree())], undefined, undefined, {
      workers: 0,
      cache: null,
    })
    // Apple: тіло B (пізніше, @SoundMod) виграло клас, але display успадковано від A
    // (property-merge), а ключ STR_apple перекрито таблицею B: original порожній ->
    // english "Apple B"
    const apple = raw.classes.find((r) => r[0] === 'Apple')!
    expect(raw.mods[apple[2]]).toBe('@SoundMod')
    expect(apple[4]).toBe('Apple B')
    const pear = raw.classes.find((r) => r[0] === 'Pear')!
    expect(pear[4]).toBe('Груша літерал')
    expect(index.byName.has('binthing')).toBe(true)
    expect(stats.pboOk).toBe(3) // food + bin + sound; languagecore -> no_config
    expect(stats.pboNoConfig).toBe(1)
    expect(stats.pboFailed).toBe(0)
    expect(stats.classes).toBe(3)
  })

  test('декой-конфіг рахується failed з причиною; stringtable з нього все одно береться', async () => {
    const tree: MemTree = {
      addons: {
        'decoy.pbo': buildPbo([
          { name: 'config.cpp', data: enc('#include "\u0432\u043e\u0430\u0445.ogg"\n'.repeat(50)) },
          { name: 'stringtable.csv', data: enc('"Language","original","english",\r\n"str_x","Є","",\r\n') },
        ]),
      },
    }
    const { stats, raw } = await importClassIndex([memDir('@Decoy', tree)], undefined, undefined, {
      workers: 0,
      cache: null,
    })
    expect(stats.pboFailed).toBe(1)
    expect(stats.failedDetails[0].reason).toContain('decoy')
    expect(stats.stringtableKeys).toBe(1)
    expect(raw.classes.length).toBe(0)
  })

  test('стиснутий Cprs config.bin розпаковується і парситься як raP чи текст', async () => {
    // Текстовий конфіг, стиснутий синтетичним LZSS (самі літерали: прапорці 0xFF)
    const text = enc('class CfgAmmo { class BulletZZ { displayName="Куля"; }; };')
    const compressed: number[] = []
    for (let i = 0; i < text.length; i += 8) {
      const chunk = text.subarray(i, Math.min(i + 8, text.length))
      compressed.push(0xff & ((1 << chunk.length) - 1))
      compressed.push(...chunk)
    }
    const tree: MemTree = {
      addons: {
        'c.pbo': buildPbo([
          { name: 'config.bin', data: new Uint8Array(compressed), packing: PBO_PACKING_CPRS, orig: text.length },
        ]),
      },
    }
    const { raw } = await importClassIndex([memDir('@C', tree)], undefined, undefined, { workers: 0, cache: null })
    expect(raw.classes).toEqual([['BulletZZ', -1, 0, 3, 'Куля']])
  })

  test('кеш: холодний прогін кладе, теплий бере без розбору; змінений файл перечитується', async () => {
    const store = new Map<string, CachedPbo>()
    let puts = 0
    const cache: ImportCache = {
      get: async (k) => store.get(k),
      put: async (k, v) => {
        puts++
        store.set(k, v)
      },
      close: () => undefined,
    }
    const dirs = [memDir('DayZ', gameTree())]
    const cold = await importClassIndex(dirs, undefined, undefined, { workers: 0, cache })
    expect(cold.stats.cacheHits).toBe(0)
    expect(puts).toBe(4)
    const warm = await importClassIndex(dirs, undefined, undefined, { workers: 0, cache })
    expect(warm.stats.cacheHits).toBe(4)
    expect(warm.raw).toEqual(cold.raw) // індекс із кеша ІДЕНТИЧНИЙ
    // «Змінився» файл: підмінюємо розмір у кеші -> перечитування
    for (const [k, v] of store) store.set(k, { ...v, size: v.size + 1 })
    const stale = await importClassIndex(dirs, undefined, undefined, { workers: 0, cache })
    expect(stale.stats.cacheHits).toBe(0)
  })

  test('конструктор воркера кидається (симуляція CSP) -> фолбек на головний потік, імпорт завершується', async () => {
    // Рев'ю T7, фікс-раунд 1, Important 1: до фікса синхронний кид new Worker() валив
    // увесь імпорт без шляху відступу.
    class BoomCtor {
      constructor() {
        throw new Error('CSP: worker-src заборонено')
      }
    }
    const { raw, stats } = await importClassIndex([memDir('DayZ', gameTree())], undefined, undefined, {
      workers: 2,
      cache: null,
      workerCtor: BoomCtor as unknown as WorkerCtor,
    })
    expect(stats.usedWorkers).toBe(0) // звіт чесно каже «без воркерів»
    expect(raw.classes.length).toBe(3) // той самий результат, що й синтетика вище
    expect(raw.classes.some((r) => r[0] === 'Apple')).toBe(true)
  })

  test('воркер падає в рантаймі (onerror до результату) -> per-run фолбек, файл розібрано', async () => {
    class DeadWorker {
      onmessage: ((ev: MessageEvent) => void) | null = null
      onerror: ((ev: { message?: string }) => void) | null = null
      postMessage(): void {
        setTimeout(() => this.onerror?.({ message: 'boom' }), 0)
      }
      terminate(): void {
        /* нічого */
      }
    }
    // FileLike з native File (Node >= 20 має глобальний File) — інакше пул чесно йде
    // повз воркер одразу, і per-run шлях не перевіряється.
    const pboBytes = buildPbo([{ name: 'config.cpp', data: enc('class CfgVehicles { class WX {}; };') }])
    const file = new File([pboBytes as BlobPart], 'w.pbo', { lastModified: 1000 })
    const dir: DirLike = {
      name: '@W',
      children: async () => [
        {
          kind: 'dir',
          name: 'addons',
          dir: {
            name: 'addons',
            children: async () => [{ kind: 'file', name: 'w.pbo', open: async () => fileLikeFromFile(file) }],
          },
        },
      ],
    }
    const { raw, stats } = await importClassIndex([dir], undefined, undefined, {
      workers: 1,
      cache: null,
      workerCtor: DeadWorker as unknown as WorkerCtor,
    })
    expect(stats.usedWorkers).toBe(1) // пул створився; відмова оброблена на рівні запуску
    expect(raw.classes.map((r) => r[0])).toEqual(['WX'])
  })

  test('прогрес рухається, скасування кидає AbortError', async () => {
    const labels: string[] = []
    await importClassIndex(
      [memDir('DayZ', gameTree())],
      (p) => labels.push(`${p.phase}:${p.done}/${p.total}`),
      undefined,
      { workers: 0, cache: null },
    )
    expect(labels[0]).toBe('scan:0/0')
    expect(labels).toContain('parse:4/4')
    expect(labels[labels.length - 1]).toBe('finalize:4/4')

    const ctrl = new AbortController()
    ctrl.abort()
    await expect(
      importClassIndex([memDir('DayZ', gameTree())], undefined, ctrl.signal, { workers: 0, cache: null }),
    ).rejects.toThrow(/скасовано/)
  })

  test('dirFromFileList збирає дерево з webkitRelativePath (шлях смоуку/Firefox)', async () => {
    const mk = (rel: string, data: Uint8Array): File => {
      const f = new File([data as BlobPart], rel.split('/').pop()!)
      Object.defineProperty(f, 'webkitRelativePath', { value: rel })
      return f
    }
    const pbo = buildPbo([{ name: 'config.cpp', data: enc('class CfgVehicles { class FL {}; };') }])
    const dir = dirFromFileList([
      mk('DayZ/Addons/a.pbo', pbo),
      mk('DayZ/dta/bin.pbo', buildPbo([])),
      mk('DayZ/other.txt', enc('x')),
    ])
    expect(dir).not.toBeNull()
    const { sources } = await discoverSources([dir!])
    expect(sources.map((s) => s.path.split('/').pop())).toEqual(['a.pbo', 'bin.pbo'])
    const { raw } = await importClassIndex([dir!], undefined, undefined, { workers: 0, cache: null })
    expect(raw.classes.map((r) => r[0])).toEqual(['FL'])
  })
})

describe('parseStringtableCsv (дзеркало python)', () => {
  test('заголовок за іменами колонок, лапки/коми/переноси в значеннях, trailing comma', () => {
    const rows = parseStringtableCsv(
      enc('"Language","original","english","czech",\r\n"k1","A, ""B""\r\nC","en",\r\n"k2","","only en",\r\n'),
    )
    expect(rows).toEqual([
      ['k1', 'A, "B"\r\nC', 'en'],
      ['k2', '', 'only en'],
    ])
  })

  test('пробіл перед лапкою -> поле НЕзацитоване, лапки лишаються літералом (python csv, реальний кейс @ProcolPack)', () => {
    // Знайдено паритет-тестом на реальному корпусі: `"k", "Tactical Belt USA",` --
    // python csv.reader вважає поле з пробілом на початку НЕзацитованим, лапки стають
    // частиною значення; .strip() зрізає лише пробіли -> '"Tactical Belt USA"'.
    const rows = parseStringtableCsv(enc('"Language","original","english",\r\n"k", "Tactical Belt USA","en",\r\n'))
    expect(rows).toEqual([['k', '"Tactical Belt USA"', 'en']])
  })

  test('літерал після закривної лапки добирається в поле (python: "a"x -> ax)', () => {
    const rows = parseStringtableCsv(enc('"Language","original","english",\r\n"k","a"x,"en",\r\n'))
    expect(rows).toEqual([['k', 'ax', 'en']])
  })

  test('BOM зрізається; невпізнаний заголовок/бінарне сміття -> нуль рядків', () => {
    expect(parseStringtableCsv(enc('\uFEFF"Language","original","english",\r\n"k","v","e",\r\n'))).toEqual([
      ['k', 'v', 'e'],
    ])
    expect(parseStringtableCsv(new Uint8Array([0, 1, 2, 255, 254]))).toEqual([])
  })
})

// ---- ПАРИТЕТ-ПРИЙМАННЯ по реальному корпусу (локально; у чужому CI тихо скипається) --------

const DAYZ_ROOT = 'E:/Programs/Steam/steamapps/common/DayZ'
const OWN_ROOT = 'E:/dayzmod'

function nodeFile(full: string, name: string, size: number, mtimeMs: number): FileLike {
  return {
    name,
    size,
    lastModified: Math.round(mtimeMs),
    async slice(start, end) {
      const fd = openSync(full, 'r')
      try {
        const len = Math.max(0, Math.min(end, size) - start)
        const buf = Buffer.alloc(len)
        readSync(fd, buf, 0, len, start)
        return new Uint8Array(buf.buffer, buf.byteOffset, len)
      } finally {
        closeSync(fd)
      }
    },
  }
}

function nodeDir(path: string, name?: string): DirLike {
  return {
    name: name ?? (basename(path) || path),
    async children(): Promise<DirChild[]> {
      const out: DirChild[] = []
      for (const childName of readdirSync(path)) {
        const full = join(path, childName)
        let st
        try {
          st = statSync(full)
        } catch {
          // битий junction: тека, чий обхід кидає -- дзеркало поведінки браузерного
          // хендла (сам хендл існує, entries() падає)
          out.push({
            kind: 'dir',
            name: childName,
            dir: {
              name: childName,
              children: async () => {
                throw new Error('broken junction')
              },
            },
          })
          continue
        }
        if (st.isDirectory()) out.push({ kind: 'dir', name: childName, dir: nodeDir(full) })
        else if (st.isFile())
          out.push({ kind: 'file', name: childName, open: async () => nodeFile(full, childName, st.size, st.mtimeMs) })
      }
      return out
    },
  }
}

describe.skipIf(!existsSync(DAYZ_ROOT) || !existsSync(join(OWN_ROOT, '@ZP_Research')))(
  'паритет із python-еталоном по реальному корпусу (локальний тест)',
  () => {
    test(
      'той самий НАБІР класів і ті самі display-рядки, що у вшитому classindex.json',
      { timeout: 600_000 },
      async () => {
        const t0 = Date.now()
        // ВЛАСНІ моди: python бере рівно @ZP_Research + @ZP_Research_VPP (DEFAULT_OWN_MODS);
        // E:\dayzmod цілком підсовувати не можна -- там і testserver, і webeditor.
        const ownDirs = ['@ZP_Research', '@ZP_Research_VPP']
          .map((m) => join(OWN_ROOT, m))
          .filter((p) => existsSync(p))
          .map((p) => nodeDir(p))
        const { raw, stats, skipped } = await importClassIndex(
          [nodeDir(DAYZ_ROOT, 'DayZ'), ...ownDirs],
          undefined,
          undefined,
          { workers: 0, cache: null },
        )
        const elapsed = Date.now() - t0
        // Довідково для звіту: час Node-прогону (без воркерів і кеша)
        console.log(
          `[parity] node cold: ${elapsed} ms; pbo=${stats.pboTotal} ok=${stats.pboOk} no_config=${stats.pboNoConfig} failed=${stats.pboFailed} classes=${stats.classes} skippedMods=${skipped.length}`,
        )

        const bundled = JSON.parse(readFileSync(join(__dirname, '..', 'src', 'data', 'classindex.json'), 'utf8')) as {
          classes: Array<[string, number, number, number, string]>
        }
        const key = (r: [string, number, number, number, string]) => `${r[3]}|${r[0].toLowerCase()}`
        const bundledMap = new Map(bundled.classes.map((r) => [key(r), r]))
        const oursMap = new Map(raw.classes.map((r) => [key(r), r]))

        const missing = [...bundledMap.keys()].filter((k) => !oursMap.has(k))
        const extra = [...oursMap.keys()].filter((k) => !bundledMap.has(k))
        expect(missing.slice(0, 25), `класи еталона, яких НЕМАЄ в браузерному імпорті (${missing.length})`).toEqual([])
        expect(extra.slice(0, 25), `зайві класи браузерного імпорту (${extra.length})`).toEqual([])

        const displayDiffs: string[] = []
        for (const [k, ours] of oursMap) {
          const ref = bundledMap.get(k)!
          if (ours[4] !== ref[4]) displayDiffs.push(`${k}: '${ours[4]}' != '${ref[4]}'`)
        }
        expect(displayDiffs.slice(0, 25), `розбіжності display (${displayDiffs.length})`).toEqual([])
      },
    )
  },
)
