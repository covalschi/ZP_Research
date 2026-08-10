// Тести fmtFloat + serialize (Task 4, Step 1). Обов'язкові еталони float — РЯДКИ ПРЯМО З
// gold-фікстур (написаних самим рушієм), не з пам'яті: gold/Modules.json (0.2 / 0.3 / 0.25)
// та gold/ProcessingRules/demo.json (0.5 / 10.0 / 1.0). live/chain.json — НЕ еталон
// принтера (провенанс непевний, див. fixtures/README.md), його рядки перевіряються окремою
// групою як вторинне спостереження.

import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { fmtFloat, serialize, encodeConfig } from '../src/io/jsonWriter'
import { SETTINGS_SCHEMA, MODULES_SCHEMA } from '../src/model/schema'
import type { ObjectSchema } from '../src/model/schema'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, 'fixtures')

function goldText(rel: string): string {
  return readFileSync(join(FIXTURES, rel), 'utf8')
}

// Усі сирі токени значення за ім'ям ключа, в порядку появи у файлі.
function rawTokens(text: string, key: string): string[] {
  const out: string[] = []
  const re = new RegExp(`"${key}":\\s*([-0-9.]+)`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.push(m[1])
  return out
}

describe('fmtFloat: обов\'язкові еталони з gold/* (байти рушія)', () => {
  const modules = goldText('gold/Modules.json')
  const demo = goldText('gold/ProcessingRules/demo.json')

  test('gold/Modules.json: PurityBonus 0.2 / 0.3 / 0.25', () => {
    const tokens = rawTokens(modules, 'PurityBonus')
    expect(tokens).toHaveLength(3)
    // Страховка від дрейфу фікстури: токен і справді відповідає очікуваному float32.
    expect(Math.fround(Number(tokens[0]))).toBe(Math.fround(0.2))
    expect(Math.fround(Number(tokens[1]))).toBe(Math.fround(0.3))
    expect(Math.fround(Number(tokens[2]))).toBe(0.25)
    expect(fmtFloat(0.2)).toBe(tokens[0])
    expect(fmtFloat(0.3)).toBe(tokens[1])
    expect(fmtFloat(0.25)).toBe(tokens[2])
  })

  test('gold/demo.json: 0.5, ціло-значні float 10.0 та 1.0', () => {
    expect(fmtFloat(0.5)).toBe(rawTokens(demo, 'BasePurityMin')[0])
    expect(fmtFloat(10)).toBe(rawTokens(demo, 'TimeSec')[0])
    expect(fmtFloat(1)).toBe(rawTokens(demo, 'Chance')[0])
    // Явна форма (звірено з байтами фікстури, не припущено):
    expect(fmtFloat(10)).toBe('10.0')
    expect(fmtFloat(1)).toBe('1.0')
    expect(fmtFloat(0.5)).toBe('0.5')
  })
})

describe('fmtFloat: вторинне спостереження — live/chain.json відтворюється тим самим алгоритмом', () => {
  // НЕ еталон принтера (fixtures/README.md, "Provenance correction"), але той факт, що
  // зламаний по gold/* алгоритм відтворює і ці рядки, — вагомий доказ, що chain.json
  // сумісний із принтером рушія (17 цифр — НЕ константа, довжина у рушія змінна).
  const chain = goldText('live/chain.json')

  test('0.4 та 0.8 (коротші за 17 цифр — так і має бути)', () => {
    expect(fmtFloat(0.4)).toBe(rawTokens(chain, 'BasePurityMin')[0])
    expect(fmtFloat(0.8)).toBe(rawTokens(chain, 'BasePurityMax')[0])
    expect(fmtFloat(15)).toBe(rawTokens(chain, 'TimeSec')[2])
  })
})

describe('fmtFloat: властивості', () => {
  test('нуль і від\'ємні', () => {
    expect(fmtFloat(0)).toBe('0.0')
    expect(fmtFloat(-0)).toBe('0.0')
    expect(fmtFloat(-0.2)).toBe('-' + fmtFloat(0.2))
    expect(fmtFloat(-1)).toBe('-1.0')
  })

  test('великі цілі float (TimeSec 604800)', () => {
    expect(fmtFloat(604800)).toBe('604800.0')
  })

  test('NaN / Infinity / переповнення float32 — виняток', () => {
    expect(() => fmtFloat(NaN)).toThrow()
    expect(() => fmtFloat(Infinity)).toThrow()
    expect(() => fmtFloat(-Infinity)).toThrow()
    expect(() => fmtFloat(1e39)).toThrow() // fround -> Infinity
  })

  test('раунд-тріп: 50000 випадкових float32 парсяться назад у той самий float32, без експоненти', () => {
    // Детермінований LCG — той самий набір значень на кожному прогоні.
    let rng = 0x12345678
    const next = () => (rng = (rng * 1664525 + 1013904223) >>> 0)
    const f32 = new Float32Array(1)
    const u32 = new Uint32Array(f32.buffer)
    for (let i = 0; i < 50000; i++) {
      u32[0] = next()
      const v = f32[0]
      if (!Number.isFinite(v)) continue
      const s = fmtFloat(v)
      expect(/[eE]/.test(s)).toBe(false)
      const back = Math.fround(Number(s))
      if (v === 0) expect(back).toBe(0)
      else expect(back).toBe(v)
    }
  })
})

// Мінімальна схема для точкових тестів serialize — не залежить від semantics семи конфігів.
const MINI: ObjectSchema = {
  name: 'Mini',
  fields: [
    { name: 'I', type: { kind: 'int' }, def: 7 },
    { name: 'F', type: { kind: 'float' }, def: 0.5 },
    { name: 'B', type: { kind: 'bool' }, def: true },
    { name: 'S', type: { kind: 'string' }, def: 'дефолт' },
    { name: 'A', type: { kind: 'string[]' }, def: [] },
  ],
}

describe('serialize: структурні правила формату рушія', () => {
  test('bool -> 1/0 (і JS true/false, і числа 1/0 після JSON.parse)', () => {
    expect(serialize(MINI, { B: true })).toContain('"B": 1')
    expect(serialize(MINI, { B: false })).toContain('"B": 0')
    expect(serialize(MINI, { B: 1 })).toContain('"B": 1')
    expect(serialize(MINI, { B: 0 })).toContain('"B": 0')
  })

  test('відсутні поля добиваються дефолтами схеми, порядок = порядок схеми', () => {
    const text = serialize(MINI, {})
    expect(text).toBe('{\n    "I": 7,\n    "F": 0.5,\n    "B": 1,\n    "S": "дефолт",\n    "A": []\n}')
  })

  test('порожній масив — інлайн []', () => {
    expect(serialize(SETTINGS_SCHEMA, { AdminIds: [] })).toContain('"AdminIds": [],')
  })

  test('непорожній масив — по елементу на рядок', () => {
    const text = serialize(MINI, { A: ['x', 'y'] })
    expect(text).toContain('"A": [\n        "x",\n        "y"\n    ]')
  })

  test('кирилиця лишається сирим UTF-8, без \\u-екранування', () => {
    const text = serialize(MODULES_SCHEMA, {
      ConfigVersion: 1,
      Modules: [{ Classname: 'X', PurityBonus: 0.25, Devices: [], Notes: 'оптика: мікроскоп' }],
    })
    expect(text).toContain('"Notes": "оптика: мікроскоп"')
    expect(text).not.toContain('\\u')
  })

  test('без завершального LF, останній байт }', () => {
    const text = serialize(MINI, {})
    expect(text.endsWith('}')).toBe(true)
    expect(text.endsWith('\n')).toBe(false)
    expect(text).not.toContain('\r')
  })
})

describe('encodeConfig: UTF-8 без BOM', () => {
  test('байти = UTF-8 тексту, без BOM, останній байт 0x7D', () => {
    const bytes = encodeConfig(MINI, {})
    expect(bytes[0]).toBe(0x7b) // '{', не 0xEF (BOM)
    expect(bytes[bytes.length - 1]).toBe(0x7d)
    const roundText = Buffer.from(bytes).toString('utf8')
    expect(roundText).toBe(serialize(MINI, {}))
  })
})
