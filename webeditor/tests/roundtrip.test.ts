// Побайтовий round-trip (Task 4, Step 3): байти фікстури -> JSON.parse -> serialize за
// схемою -> ті самі байти. Для КОЖНОГО gold-файла (крім StaticDevices.json — не один із
// семи конфігів редактора) збіг байт ОБОВ'ЯЗКОВИЙ: це файли, написані самим рушієм.
// Для live/* обов'язковий семантичний збіг; побайтовий — бонус, якщо виходить природно
// (виходить: див. коментар у групі live нижче).

import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { serialize, encodeConfig } from '../src/io/jsonWriter'
import { parseConfig } from '../src/io/parse'
import { SCHEMAS } from '../src/model/schema'
import type { ConfigKind, ObjectSchema, FieldType } from '../src/model/schema'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, 'fixtures')

const GOLD: [ConfigKind, string][] = [
  ['settings', 'gold/Settings.json'],
  ['pointTypes', 'gold/PointTypes.json'],
  ['factions', 'gold/Factions.json'],
  ['dataItems', 'gold/DataItems.json'],
  ['modules', 'gold/Modules.json'],
  ['sampleTypes', 'gold/SampleTypes.json'],
  ['rules', 'gold/ProcessingRules/demo.json'],
]

const LIVE: [ConfigKind, string][] = [
  ['rules', 'live/chain.json'],
  ['settings', 'live/Settings.json'],
]

function bytesOf(rel: string): Buffer {
  return readFileSync(join(FIXTURES, rel)) // саме Buffer: порівнюємо байти, не текст
}

function reserialize(kind: ConfigKind, original: Buffer): Buffer {
  const parsed = JSON.parse(original.toString('utf8')) as unknown
  return Buffer.from(encodeConfig(SCHEMAS[kind], parsed))
}

describe('gold/*: побайтовий збіг із байтами рушія (ОБОВ\'ЯЗКОВИЙ)', () => {
  for (const [kind, rel] of GOLD) {
    test(rel, () => {
      const original = bytesOf(rel)
      const out = reserialize(kind, original)
      // При розбіжності показуємо перший відмінний байт — інакше дифи нечитабельні.
      if (!out.equals(original)) {
        let i = 0
        while (i < Math.min(out.length, original.length) && out[i] === original[i]) i++
        const ctx = (b: Buffer) => JSON.stringify(b.toString('utf8').slice(Math.max(0, i - 40), i + 40))
        throw new Error(
          `${rel}: розбіжність із байта ${i} (довжини ${original.length} -> ${out.length})\n` +
            `оригінал: ${ctx(original)}\nвивід:    ${ctx(out)}`,
        )
      }
      expect(out.equals(original)).toBe(true)
    })
  }
})

// Семантичне порівняння, кероване схемою: для кожного поля схеми значення (або дефолт)
// має збігатися в межах семантики рушія — float через Math.fround, bool через істинність.
function semanticEqual(schema: ObjectSchema, a: unknown, b: unknown): void {
  const ra = (a ?? {}) as Record<string, unknown>
  const rb = (b ?? {}) as Record<string, unknown>
  for (const field of schema.fields) {
    const va = field.name in ra ? ra[field.name] : field.def
    const vb = field.name in rb ? rb[field.name] : field.def
    valueEqual(field.type, va, vb, schema.name + '.' + field.name)
  }
}
function valueEqual(t: FieldType, va: unknown, vb: unknown, path: string): void {
  switch (t.kind) {
    case 'int':
      expect(Math.trunc(Number(va)), path).toBe(Math.trunc(Number(vb)))
      break
    case 'float':
      expect(Math.fround(Number(va)), path).toBe(Math.fround(Number(vb)))
      break
    case 'bool':
      expect(!!va, path).toBe(!!vb)
      break
    case 'string':
      expect(String(va ?? ''), path).toBe(String(vb ?? ''))
      break
    case 'string[]': {
      expect(va ?? [], path).toEqual(vb ?? [])
      break
    }
    case 'object':
      semanticEqual(t.schema, va, vb)
      break
    case 'object[]': {
      const aa = (va ?? []) as unknown[]
      const ab = (vb ?? []) as unknown[]
      expect(aa.length, path).toBe(ab.length)
      for (let i = 0; i < aa.length; i++) semanticEqual(t.schema, aa[i], ab[i])
      break
    }
  }
}

describe('live/*: семантичний round-trip (обов\'язковий) + побайтовий (виходить природно)', () => {
  for (const [kind, rel] of LIVE) {
    test(rel + ': семантика', () => {
      const original = JSON.parse(bytesOf(rel).toString('utf8')) as unknown
      const again = JSON.parse(serialize(SCHEMAS[kind], original)) as unknown
      semanticEqual(SCHEMAS[kind], original, again)
    })
    // Побайтовий збіг live-файлів НЕ вимагався (провенанс непевний), але виходить сам:
    // зламаний по gold/* алгоритм принтера відтворює й float-рядки chain.json
    // (0.4000000059604645 / 0.800000011920929) — див. звіт Task 4. Якщо цей тест колись
    // упаде через НОВУ live-фікстуру з "рукописними" float — послабити до семантичного
    // для неї, gold-тести вище не чіпати.
    test(rel + ': байти', () => {
      const original = bytesOf(rel)
      expect(reserialize(kind, original).equals(original)).toBe(true)
    })
  }
})

describe('інваріанти формату виводу', () => {
  test('вивід ніколи не містить CR і BOM, завжди закінчується на }', () => {
    for (const [kind, rel] of [...GOLD, ...LIVE]) {
      const out = reserialize(kind, bytesOf(rel))
      expect(out.includes(0x0d), rel).toBe(false)
      expect(out[0], rel).toBe(0x7b)
      expect(out[out.length - 1], rel).toBe(0x7d)
    }
  })
})

// Наскрізний round-trip через терпимий парсер (Task 5, Step 3): не JSON.parse напряму
// (як вище), а саме parseConfig — той шлях, яким редактор реально читає файл з диска.
// Для gold/live encodeConfig(schema, parseConfig(schema, text).value) мусить дати
// побайтово ті самі байти, і жодного попередження — бо ці файли ВЖЕ повні й канонічні
// (написані рушієм або семантично еквівалентні його виводу): serialize() сам добиває
// відсутні поля дефолтами, а якщо parseConfig на такому файлі щось попереджає, це
// означає розбіжність зі схемою, яку слід було б побачити тут, а не в проді.
function reparseAndReserialize(kind: ConfigKind, original: Buffer): { out: Buffer; warnings: unknown[] } {
  const { value, warnings } = parseConfig(SCHEMAS[kind], original.toString('utf8'))
  return { out: Buffer.from(encodeConfig(SCHEMAS[kind], value)), warnings }
}

describe('parseConfig + encodeConfig: наскрізний round-trip (Task 5)', () => {
  for (const [kind, rel] of [...GOLD, ...LIVE]) {
    test(`${rel}: побайтовий збіг, нуль попереджень`, () => {
      const original = bytesOf(rel)
      const { out, warnings } = reparseAndReserialize(kind, original)
      expect(warnings, `${rel}: неочікувані попередження ${JSON.stringify(warnings)}`).toEqual([])
      expect(out.equals(original)).toBe(true)
    })
  }

  test('stale/zone.json: НЕ побайтовий збіг (ResearchDevice скасовано), але канонізація ідемпотентна', () => {
    const original = bytesOf('stale/zone.json')
    const first = reparseAndReserialize('techTree', original)
    // Застарілий файл дає попередження (ResearchDevice на кожному з 12 вузлів) і тому
    // НЕ дорівнює оригіналу байт-в-байт — це очікувано, на відміну від gold/live вище.
    expect(first.warnings.length).toBeGreaterThan(0)
    expect(first.out.equals(original)).toBe(false)
    expect(first.out.toString('utf8')).not.toContain('ResearchDevice')

    // Другий прохід (parse -> serialize) над уже канонізованим текстом стабільний:
    // канонічний вивід сам по собі валідний за схемою, тому повторний розбір не додає
    // нових попереджень і дає ті самі байти знову (canonicalization is idempotent).
    const second = reparseAndReserialize('techTree', first.out)
    expect(second.warnings).toEqual([])
    expect(second.out.equals(first.out)).toBe(true)
  })
})
