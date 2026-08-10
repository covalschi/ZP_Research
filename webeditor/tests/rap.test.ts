// Тести raP-парсера і текстового конфіг-парсера (T7 Step 1). Фікстури БЕЗ чужого
// контенту (ліцензії: чужі config.bin — це редистрибуція мода): золота пара — НАШ
// власний ZP_Research/config.cpp, бінаризований CfgConvert.exe -bin (+ його ж -txt
// раундтрип), решта — синтетичні raP, зібрані тест-кодом побайтово. Паритет із реальними
// модами — окремий локальний importParity.test.ts зі skipIf.

import { describe, test, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseRapConfig, isRapConfig, type ConfigClassDef } from '../src/io/rap'
import { parseTextConfig, extractDisplayNameText, looksLikeConfigText } from '../src/io/configText'

const FX = join(__dirname, 'fixtures', 'rap')

function defKey(d: ConfigClassDef): string {
  return `${d.root}|${d.name.toLowerCase()}`
}

function byKey(defs: ConfigClassDef[]): Map<string, ConfigClassDef> {
  const m = new Map<string, ConfigClassDef>()
  for (const d of defs) m.set(defKey(d), d) // пізніший виграє — та сама семантика merge
  return m
}

describe('золота пара (наш власний config.cpp -> CfgConvert -bin)', () => {
  const binBytes = new Uint8Array(readFileSync(join(FX, 'zp_research.config.bin')))
  const cppText = readFileSync(join(FX, 'zp_research.config.cpp'), 'utf8')
  const roundtripText = readFileSync(join(FX, 'zp_research.config.roundtrip.cpp'), 'utf8')

  test('isRapConfig впізнає сигнатуру \\0raP', () => {
    expect(isRapConfig(binBytes)).toBe(true)
    expect(isRapConfig(new TextEncoder().encode('class CfgVehicles {};'))).toBe(false)
  })

  test('raP-парсер і текстовий парсер дають ІДЕНТИЧНІ дефініції на одному конфігу', () => {
    // Той самий вміст трьома шляхами: бінарний raP, CfgConvert-раундтрип-текст і
    // оригінальний рукописний config.cpp. Розбіжність будь-якої пари — баг парсера.
    const fromBin = byKey(parseRapConfig(binBytes))
    const fromRoundtrip = byKey(parseTextConfig(roundtripText))
    const fromCpp = byKey(parseTextConfig(cppText))
    expect(fromBin.size).toBeGreaterThan(50)
    expect([...fromBin.keys()].sort()).toEqual([...fromRoundtrip.keys()].sort())
    expect([...fromBin.keys()].sort()).toEqual([...fromCpp.keys()].sort())
    for (const [key, d] of fromBin) {
      const rt = fromRoundtrip.get(key)!
      const cp = fromCpp.get(key)!
      expect({ base: d.base?.toLowerCase() ?? null, hasBody: d.hasBody, displayRaw: d.displayRaw },
        `розбіжність bin/roundtrip на ${key}`).toEqual(
        { base: rt.base?.toLowerCase() ?? null, hasBody: rt.hasBody, displayRaw: rt.displayRaw })
      expect({ base: d.base?.toLowerCase() ?? null, hasBody: d.hasBody, displayRaw: d.displayRaw },
        `розбіжність bin/cpp на ${key}`).toEqual(
        { base: cp.base?.toLowerCase() ?? null, hasBody: cp.hasBody, displayRaw: cp.displayRaw })
    }
  })

  test('конкретика: ZP_Microscope з базою і сирим $STR_-display', () => {
    const defs = byKey(parseRapConfig(binBytes))
    const micro = defs.get('0|zp_microscope')
    expect(micro).toBeDefined()
    expect(micro!.base).toBe('ZP_StaticDevice_Base')
    expect(micro!.hasBody).toBe(true)
    expect(micro!.displayRaw).toBe('$STR_zp_microscope')
  })

  test('forward-декларації (class Inventory_Base;) — hasBody=false, без display', () => {
    const defs = byKey(parseRapConfig(binBytes))
    const fwd = defs.get('0|inventory_base')
    expect(fwd).toBeDefined()
    expect(fwd!.hasBody).toBe(false)
    expect(fwd!.base).toBeNull()
    expect(fwd!.displayRaw).toBeNull()
  })

  test('не-кореневі блоки (CfgPatches/CfgMods/CfgSlots) не дають дефініцій', () => {
    const defs = parseRapConfig(binBytes)
    expect(defs.some((d) => d.name === 'ZP_Tool1' || d.name.startsWith('Slot_'))).toBe(false)
    // а кількість коренів у грі — лише ті з п'яти, що реально є в нашому конфігу
    const roots = new Set(defs.map((d) => d.root))
    expect(roots.has(0)).toBe(true) // CfgVehicles
  })
})

// ---- Синтетичні raP (зібрані тест-кодом побайтово — нуль чужого контенту) ----------------

class RapBuilder {
  private parts: number[] = []
  private fixups: Array<{ at: number; body: () => void }> = []

  private ascii(s: string): void {
    const bytes = new TextEncoder().encode(s)
    for (const b of bytes) this.parts.push(b)
    this.parts.push(0)
  }

  private u32(v: number): void {
    this.parts.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff)
  }

  private f32(v: number): void {
    const buf = new ArrayBuffer(4)
    new DataView(buf).setFloat32(0, v, true)
    for (const b of new Uint8Array(buf)) this.parts.push(b)
  }

  // compressed int — 7-бітний варінт, як у форматі
  private cint(v: number): void {
    while (v >= 0x80) {
      this.parts.push((v & 0x7f) | 0x80)
      v >>= 7
    }
    this.parts.push(v)
  }

  header(): this {
    this.parts.push(0x00, 0x72, 0x61, 0x50) // \0raP
    this.u32(0)
    this.u32(8)
    this.u32(0xffffffff) // enums offset — фіксапиться в build()
    return this
  }

  // Тіло класу: inherited + count + entries (entries — замикання, що пишуть себе самі)
  classBody(inherited: string, entries: Array<() => void>): void {
    this.ascii(inherited)
    this.cint(entries.length)
    for (const e of entries) e()
  }

  subclass(name: string, inherited: string, entries: Array<() => void>): () => void {
    return () => {
      this.parts.push(0)
      this.ascii(name)
      const at = this.parts.length
      this.u32(0xffffffff) // offset фіксапиться після серіалізації тіла
      this.fixups.push({ at, body: () => this.classBody(inherited, entries) })
    }
  }

  valueStr(name: string, value: string): () => void {
    return () => {
      this.parts.push(1, 0)
      this.ascii(name)
      this.ascii(value)
    }
  }

  valueFloat(name: string, value: number): () => void {
    return () => {
      this.parts.push(1, 1)
      this.ascii(name)
      this.f32(value)
    }
  }

  valueLong(name: string, value: number): () => void {
    return () => {
      this.parts.push(1, 2)
      this.ascii(name)
      this.u32(value)
    }
  }

  arrayMixed(name: string): () => void {
    return () => {
      this.parts.push(2)
      this.ascii(name)
      this.cint(3)
      this.parts.push(0)
      this.ascii('str')
      this.parts.push(2)
      this.u32(7)
      this.parts.push(3) // вкладений масив
      this.cint(1)
      this.parts.push(1)
      this.f32(0.5)
    }
  }

  flaggedArray(name: string): () => void {
    return () => {
      this.parts.push(5)
      this.u32(1)
      this.ascii(name)
      this.cint(1)
      this.parts.push(0)
      this.ascii('x')
    }
  }

  externClass(name: string): () => void {
    return () => {
      this.parts.push(3)
      this.ascii(name)
    }
  }

  deleteClass(name: string): () => void {
    return () => {
      this.parts.push(4)
      this.ascii(name)
    }
  }

  rawEntry(bytes: number[]): () => void {
    return () => {
      for (const b of bytes) this.parts.push(b)
    }
  }

  build(rootEntries: Array<() => void>): Uint8Array {
    this.header()
    this.classBody('', rootEntries)
    // Тіла підкласів дописуються ПІСЛЯ батьківського тіла (як робить сам CfgConvert),
    // офсети — абсолютні; фіксапи можуть додавати нові фіксапи (вкладені класи).
    while (this.fixups.length > 0) {
      const { at, body } = this.fixups.shift()!
      const off = this.parts.length
      body()
      this.parts[at] = off & 0xff
      this.parts[at + 1] = (off >> 8) & 0xff
      this.parts[at + 2] = (off >> 16) & 0xff
      this.parts[at + 3] = (off >> 24) & 0xff
    }
    const enumsOff = this.parts.length
    this.parts[12] = enumsOff & 0xff
    this.parts[13] = (enumsOff >> 8) & 0xff
    this.parts[14] = (enumsOff >> 16) & 0xff
    this.parts[15] = (enumsOff >> 24) & 0xff
    this.u32(0) // порожня таблиця enum
    return new Uint8Array(this.parts)
  }
}

describe('синтетичні raP', () => {
  test('класи під CfgVehicles: база, display, значення різних типів пропускаються', () => {
    const b = new RapBuilder()
    const bytes = b.build([
      b.subclass('CfgVehicles', '', [
        b.subclass('ItemA', 'Inventory_Base', [
          b.valueLong('scope', 2),
          b.valueStr('displayName', 'Річ А'),
          b.valueFloat('weight', 1.5),
          b.arrayMixed('stuff'),
        ]),
        b.externClass('Forward_Decl'),
        b.deleteClass('Removed_Thing'),
      ]),
    ])
    const defs = byKey(parseRapConfig(bytes))
    expect(defs.get('0|itema')).toEqual({
      root: 0, name: 'ItemA', base: 'Inventory_Base', hasBody: true, displayRaw: 'Річ А',
    })
    expect(defs.get('0|forward_decl')).toEqual({
      root: 0, name: 'Forward_Decl', base: null, hasBody: false, displayRaw: null,
    })
    expect(defs.has('0|removed_thing')).toBe(false)
  })

  test('displayName вкладеного підкласу НЕ просочується нагору; ПЕРШИЙ власний виграє', () => {
    // Рев'ю T7, фікс-раунд 1: дубль властивості в одному тілі тримає ПЕРШЕ значення —
    // звірено емпірично по тулчейну рушія (CfgConvert на дублі попереджає «Member
    // already defined», бінаризований раундтрип несе перше значення). Попередня версія
    // цього тесту закріплювала «останній виграє» — хибне твердження про рушій.
    const b = new RapBuilder()
    const bytes = b.build([
      b.subclass('cfgweapons', '', [
        b.subclass('GunX', 'Rifle_Base', [
          b.subclass('Inner', '', [b.valueStr('displayName', 'НЕПРАВИЛЬНО')]),
          b.valueStr('displayName', 'Перше'),
          b.valueStr('displayName', 'Друге'),
        ]),
      ]),
    ])
    const defs = byKey(parseRapConfig(bytes))
    expect(defs.get('4|gunx')!.displayRaw).toBe('Перше')
    expect(defs.has('4|inner')).toBe(false) // вкладений — не прямий нащадок кореня
  })

  test('текстовий шлях: дубль displayName в одному тілі теж тримає перше (дзеркало)', () => {
    const text = 'class CfgVehicles { class Dup { displayName="Перше"; displayName="Друге"; }; };'
    const defs = parseTextConfig(text)
    expect(defs).toEqual([{ root: 0, name: 'Dup', base: null, hasBody: true, displayRaw: 'Перше' }])
  })

  test('кореневі імена матчаться регістронезалежно і канонізуються (CFGAMMO -> root 3)', () => {
    const b = new RapBuilder()
    const bytes = b.build([
      b.subclass('CFGAMMO', '', [b.subclass('BulletZ', 'Bullet_Base', [])]),
    ])
    const defs = parseRapConfig(bytes)
    expect(defs).toEqual([{ root: 3, name: 'BulletZ', base: 'Bullet_Base', hasBody: true, displayRaw: null }])
  })

  test('flagged array (тип 5, "+=") пропускається коректно', () => {
    const b = new RapBuilder()
    const bytes = b.build([
      b.subclass('CfgVehicles', '', [
        b.subclass('ItemB', '', [b.flaggedArray('extras'), b.valueStr('displayName', 'B')]),
      ]),
    ])
    expect(byKey(parseRapConfig(bytes)).get('0|itemb')!.displayRaw).toBe('B')
  })

  test('невідомий тип запису — виняток з позицією, не тихе сміття', () => {
    const b = new RapBuilder()
    const bytes = b.build([
      b.subclass('CfgVehicles', '', [b.rawEntry([9, 0x41, 0])]),
    ])
    expect(() => parseRapConfig(bytes)).toThrow(/raP/)
  })

  test('не-raP байти відкидаються одразу', () => {
    expect(() => parseRapConfig(new TextEncoder().encode('not a rap'))).toThrow(/raP/)
  })
})

// ---- Текстовий парсер: display-специфіка (решта семантики покрита золотою парою) ----------

describe('parseTextConfig / extractDisplayNameText', () => {
  test('display з рукописного тексту, кейс-інсенситивна властивість, "" -> "', () => {
    const text = 'class CfgVehicles { class A: B { displayname = "Skazhy ""tak"""; }; };'
    const defs = parseTextConfig(text)
    expect(defs).toEqual([{ root: 0, name: 'A', base: 'B', hasBody: true, displayRaw: 'Skazhy "tak"' }])
  })

  test('вкладений клас не віддає display нагору (текстовий шлях)', () => {
    const body = ' class Inner { displayName="X"; }; scope=2; '
    expect(extractDisplayNameText(body, 0, body.length)).toBeNull()
  })

  test('displayNameShort/displayName[] не матчаться', () => {
    const body = ' displayNameShort="No"; displayName[]={"No"}; '
    expect(extractDisplayNameText(body, 0, body.length)).toBeNull()
  })

  test('looksLikeConfigText: декой-фільтр (дзеркало python looks_like_config_text)', () => {
    expect(looksLikeConfigText('class CfgVehicles { class A {}; };')).toBe(true)
    expect(looksLikeConfigText('')).toBe(false)
    expect(looksLikeConfigText('\u0000\u0001\u0002binary junk'.repeat(100))).toBe(false)
    // #include-декой без слова class/Cfg
    expect(looksLikeConfigText('#include "воах.ogg"\n'.repeat(50))).toBe(false)
  })
})
