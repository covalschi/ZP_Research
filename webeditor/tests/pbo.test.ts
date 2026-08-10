// Тести pbo.ts (T7 Step 2): заголовок PBO (плейнтекстова таблиця імен на початку файла)
// + LZSS. Фікстури синтетичні (зібрані тест-кодом) — нуль чужого контенту; LZSS-вектори
// звірені КРОС-ІМПЛЕМЕНТАЦІЙНО: очікувані байти згенеровані python-еталоном
// extract_pbo.lzss_decompress (звірений байт-у-байт із BankRev.exe) на цих САМИХ
// входах — не вигадані. Реальний @ZP_Research.pbo (наш власний) — skipIf, коли не
// зібраний локально (git не возить PBO).

import { describe, test, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import {
  parsePboHeader,
  lzssDecompress,
  extractPboEntry,
  TruncatedPboHeader,
  PBO_PACKING_CPRS,
} from '../src/io/pbo'
import { parseTextConfig } from '../src/io/configText'

// ---- Синтетичний PBO-конструктор ----------------------------------------------------------

function asciiz(s: string): number[] {
  return [...new TextEncoder().encode(s), 0]
}

function u32(v: number): number[] {
  return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]
}

function entryRecord(name: string, packing: number, orig: number, dsize: number): number[] {
  return [...asciiz(name), ...u32(packing), ...u32(orig), ...u32(0), ...u32(0), ...u32(dsize)]
}

function buildPbo(withVers: boolean, files: Array<{ name: string; data: Uint8Array; packing?: number; orig?: number }>): Uint8Array {
  const parts: number[] = []
  if (withVers) {
    // 'Vers'-запис властивостей: порожнє ім'я + packing 0x56657273 + 4 нулі, далі
    // пари ключ/значення до порожнього ключа
    parts.push(...asciiz(''), ...u32(0x56657273), ...u32(0), ...u32(0), ...u32(0), ...u32(0))
    parts.push(...asciiz('prefix'), ...asciiz('test\\mod'))
    parts.push(...asciiz(''))
  }
  for (const f of files) {
    parts.push(...entryRecord(f.name, f.packing ?? 0, f.orig ?? 0, f.data.length))
  }
  parts.push(...entryRecord('', 0, 0, 0)) // термінатор
  for (const f of files) parts.push(...f.data)
  return new Uint8Array(parts)
}

const enc = (s: string) => new TextEncoder().encode(s)

describe('parsePboHeader', () => {
  test('таблиця імен + офсети даних; Vers-блок пропускається', () => {
    const cfg = enc('class CfgVehicles { class A {}; };')
    const st = enc('"Language","original","english",\r\n')
    const pbo = buildPbo(true, [
      { name: 'scripts\\stuff.c', data: enc('void x();') },
      { name: 'config.cpp', data: cfg },
      { name: 'languagecore\\stringtable.csv', data: st },
    ])
    const { entries } = parsePboHeader(pbo)
    expect(entries.map((e) => e.name)).toEqual(['scripts\\stuff.c', 'config.cpp', 'languagecore\\stringtable.csv'])
    const cfgEntry = entries[1]
    expect(pbo.subarray(cfgEntry.dataOffset, cfgEntry.dataOffset + cfgEntry.dataSize)).toEqual(cfg)
    const stEntry = entries[2]
    expect(pbo.subarray(stEntry.dataOffset, stEntry.dataOffset + stEntry.dataSize)).toEqual(st)
  })

  test('без Vers-блока теж парситься (FileBank-стиль)', () => {
    const pbo = buildPbo(false, [{ name: 'config.cpp', data: enc('class X {};') }])
    expect(parsePboHeader(pbo).entries.length).toBe(1)
  })

  test('обрізаний заголовок -> TruncatedPboHeader (сигнал «читай більший шмат»)', () => {
    const pbo = buildPbo(true, [{ name: 'config.cpp', data: enc('class X {};') }])
    // будь-який префікс, що обриває таблицю імен посеред запису
    expect(() => parsePboHeader(pbo.subarray(0, 30))).toThrow(TruncatedPboHeader)
    expect(() => parsePboHeader(new Uint8Array(0))).toThrow(TruncatedPboHeader)
  })

  test('extractPboEntry: розпаковує Cprs-запис, віддає сирий інший', () => {
    // 'ABABAB' стиснуто LZSS-вектором v2 (див. нижче), packing='Cprs'
    const compressed = new Uint8Array([0b00000011, 0x41, 0x42, 0x02, 0x01])
    const pbo = buildPbo(false, [
      { name: 'config.bin', data: compressed, packing: PBO_PACKING_CPRS, orig: 6 },
      { name: 'plain.txt', data: enc('hi') },
    ])
    const { entries } = parsePboHeader(pbo)
    expect(new TextDecoder().decode(extractPboEntry(pbo, entries[0]))).toBe('ABABAB')
    expect(new TextDecoder().decode(extractPboEntry(pbo, entries[1]))).toBe('hi')
  })
})

// ---- LZSS: крос-імплементаційні вектори (очікування — вихід python-еталона) ---------------

describe('lzssDecompress (вектори звірені з python extract_pbo.lzss_decompress)', () => {
  test('v1: самі літерали (flags=0xFF)', () => {
    const out = lzssDecompress(new Uint8Array([0xff, 65, 66, 67, 68, 69, 70, 71, 72]), 8)
    expect(new TextDecoder().decode(out)).toBe('ABCDEFGH')
  })

  test('v2: back-reference dist=2 len=4 -> ABABAB', () => {
    const out = lzssDecompress(new Uint8Array([3, 65, 66, 2, 1]), 6)
    expect(new TextDecoder().decode(out)).toBe('ABABAB')
  })

  test('v3: посилання ПЕРЕД початком виходу -> заповнення пробілами 0x20', () => {
    const out = lzssDecompress(new Uint8Array([0, 5, 0]), 3)
    expect(new TextDecoder().decode(out)).toBe('   ')
  })

  test('v4: перекривна копія (RLE, dist=1 len=6) -> XXXXXXX', () => {
    const out = lzssDecompress(new Uint8Array([1, 88, 1, 3]), 7)
    expect(new TextDecoder().decode(out)).toBe('XXXXXXX')
  })

  test('expectedSize обрізає вихід і зупиняє розбір', () => {
    const out = lzssDecompress(new Uint8Array([0xff, 65, 66, 67, 68, 69, 70, 71, 72]), 3)
    expect(new TextDecoder().decode(out)).toBe('ABC')
  })
})

// ---- Реальний власний PBO (skipIf: git не возить зібраний @ZP_Research) -------------------

const OWN_PBO = 'E:/dayzmod/@ZP_Research/addons/ZP_Research.pbo'

describe.skipIf(!existsSync(OWN_PBO))('реальний @ZP_Research.pbo (наш власний)', () => {
  test('заголовок парситься, config.cpp витягується і містить ZP_Microscope', () => {
    const buf = new Uint8Array(readFileSync(OWN_PBO))
    const { entries } = parsePboHeader(buf)
    const cfg = entries.find((e) => e.name.replace(/\\/g, '/').split('/').pop()!.toLowerCase() === 'config.cpp')
    expect(cfg).toBeDefined()
    const text = new TextDecoder().decode(extractPboEntry(buf, cfg!))
    const defs = parseTextConfig(text)
    expect(defs.some((d) => d.name === 'ZP_Microscope' && d.displayRaw === '$STR_zp_microscope')).toBe(true)
  })

  test('обидві stringtable.csv видно в таблиці імен', () => {
    const buf = new Uint8Array(readFileSync(OWN_PBO))
    const { entries } = parsePboHeader(buf)
    const st = entries.filter((e) => e.name.replace(/\\/g, '/').split('/').pop()!.toLowerCase() === 'stringtable.csv')
    expect(st.length).toBe(2)
  })
})
