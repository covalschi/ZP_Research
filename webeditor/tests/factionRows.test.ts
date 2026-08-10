// Тести чистих хелперів вкладки «Фракції» (W4 Task 3, src/ui/factionRows.ts):
// buildFactionRows (рядки списку + атрибуція проблем дзеркал по фракціях),
// collectSupertypeOptions (спостережені значення — це мітка групування, гейтів немає),
// worstTone (лампа стану рядка).
//
// Атрибуція проблем — КЛЮЧОВЕ рішення (задокументоване і в шапці factionRows.ts):
// первинне дзеркало рядка — validateFactionRecord (per-record, шляхи вже локальні);
// whole-file validateFactionsDoc додає ЛИШЕ те, чого per-record не покриває (Supertype,
// дубль Id, спільні термінали/прилади, «без власних терміналів»); збіг локального шляху
// З ОДНАКОВОЮ severity — whole-file запис відкидається (той самий факт двічі — шум);
// різна severity НЕ дедупиться (ревью T3, minor 1: різна суворість = різна причина).

import { describe, test, expect } from 'vitest'
import { loadClassIndex } from '../src/model/classIndex'
import type { ClassIndex } from '../src/model/classIndex'
import { buildFactionRows, collectSupertypeOptions, worstTone } from '../src/ui/factionRows'

const idx: ClassIndex = loadClassIndex()
const KNOWN_CLASS = 'Apple'

function faction(id: string, override: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Id: id,
    DisplayName: 'Фракція',
    Supertype: 'science',
    Armbands: [KNOWN_CLASS],
    TerminalClasses: [],
    DeviceClasses: [],
    ...override,
  }
}

function doc(factions: Record<string, unknown>[]) {
  return { ConfigVersion: 1, Factions: factions }
}

describe('worstTone', () => {
  test('ok / warn / alarm — найгірше виграє', () => {
    expect(worstTone([])).toBe('ok')
    expect(worstTone([{ severity: 'warn' }])).toBe('warn')
    expect(worstTone([{ severity: 'warn' }, { severity: 'alarm' }])).toBe('alarm')
  })
})

describe('buildFactionRows: рядки і лічильники', () => {
  test('чиста фракція — tone=ok, лічильники з масивів', () => {
    const { rows, docProblems } = buildFactionRows(
      doc([faction('ecolog', { TerminalClasses: ['ZP_LabComputer'], DeviceClasses: ['ZP_Microscope', 'ZP_LabComputer'] })]),
      idx,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('ecolog')
    expect(rows[0].displayName).toBe('Фракція')
    expect(rows[0].supertype).toBe('science')
    expect(rows[0].armbands).toEqual([KNOWN_CLASS])
    expect(rows[0].terminals).toEqual(['ZP_LabComputer'])
    expect(rows[0].devices).toEqual(['ZP_Microscope', 'ZP_LabComputer'])
    expect(rows[0].problems).toEqual([])
    expect(rows[0].tone).toBe('ok')
    expect(docProblems).toEqual([])
  })

  test('порожній список фракцій — doc-проблема (warn Validate :271-272), рядків нуль', () => {
    const { rows, docProblems } = buildFactionRows(doc([]), idx)
    expect(rows).toEqual([])
    expect(docProblems.length).toBeGreaterThan(0)
    expect(docProblems[0].severity).toBe('warn')
  })

  test('нерозібраний документ — порожній результат без падіння', () => {
    expect(buildFactionRows(undefined, idx)).toEqual({ rows: [], docProblems: [] })
    expect(buildFactionRows('текст', idx)).toEqual({ rows: [], docProblems: [] })
  })
})

describe('buildFactionRows: атрибуція проблем', () => {
  test('конфлікт нашивки видно на ОБОХ фракціях (per-record дзеркало ValidateFaction :194-203)', () => {
    const { rows } = buildFactionRows(doc([faction('a'), faction('b')]), idx)
    // обидві фракції несуть той самий KNOWN_CLASS -> конфлікт у кожної
    expect(rows[0].tone).toBe('alarm')
    expect(rows[1].tone).toBe('alarm')
    expect(rows[0].problems.some((p) => p.path === 'Armbands[0]' && p.message.includes("'b'"))).toBe(true)
    expect(rows[1].problems.some((p) => p.path === 'Armbands[0]' && p.message.includes("'a'"))).toBe(true)
  })

  test('шляхи whole-file проблем ЛОКАЛІЗОВАНІ (без префікса Factions[i].)', () => {
    const { rows } = buildFactionRows(doc([faction('a', { Supertype: '' })]), idx)
    // Supertype порожній — це покриває ЛИШЕ whole-file Validate (:247-248)
    const sup = rows[0].problems.filter((p) => p.path === 'Supertype')
    expect(sup).toHaveLength(1)
    expect(sup[0].severity).toBe('warn')
  })

  test('per-record і whole-file НЕ дублюються на одному шляху (первинне — per-record)', () => {
    // Нашивка поза індексом: обидва дзеркала мають warn на Armbands[0] — лишається ОДИН запис
    const { rows } = buildFactionRows(doc([faction('a', { Armbands: ['No_Such_Class_ZZZ'] })]), idx)
    expect(rows[0].problems.filter((p) => p.path === 'Armbands[0]')).toHaveLength(1)
  })

  test('дубль Id — whole-file warn на пізнішому записі', () => {
    const { rows } = buildFactionRows(doc([faction('dup'), faction('dup', { Armbands: ['ZZZ_Other'] })]), idx)
    expect(rows[1].problems.some((p) => p.path === 'Id' && /дублікат/i.test(p.message))).toBe(true)
  })

  // Ревью T3 (minor 1): дедуп по самому шляху ковтав whole-file-WARN іншої природи, коли
  // per-record уже дав ALARM на тому самому полі. Конструкція ревьюера: конфлікт нашивки
  // (alarm) + клас поза індексом (warn) на одному Armbands[0] — тепер видимі ОБИДВА.
  test('різна severity на одному шляху НЕ дедупиться (alarm конфлікту + warn індексу разом)', () => {
    const { rows } = buildFactionRows(
      doc([faction('a', { Armbands: ['No_Such_Class_ZZZ'] }), faction('b', { Armbands: ['No_Such_Class_ZZZ'] })]),
      idx,
    )
    const p0 = rows[0].problems.filter((p) => p.path === 'Armbands[0]')
    expect(p0.some((p) => p.severity === 'alarm')).toBe(true) // конфлікт (per-record)
    expect(p0.some((p) => p.severity === 'warn')).toBe(true) // клас поза індексом (whole-file)
  })

  // Ревью T3 (minor 3): свіжий незаповнений рядок термінала/прибора зберігався б порожнім
  // рядком без жодного сигналу (validateClassField на '' мовчить).
  test('порожній рядок TerminalClasses/DeviceClasses — warn-лінт «приберіть»', () => {
    const { rows } = buildFactionRows(doc([faction('a', { TerminalClasses: [''], DeviceClasses: ['Apple', ''] })]), idx)
    expect(rows[0].problems.some((p) => p.path === 'TerminalClasses[0]' && /порожній рядок/.test(p.message))).toBe(true)
    expect(rows[0].problems.some((p) => p.path === 'DeviceClasses[1]' && /порожній рядок/.test(p.message))).toBe(true)
  })

  test('спільний термінал — warn на обох перетнутих полях, «без власних терміналів» — на третій', () => {
    const { rows } = buildFactionRows(
      doc([
        faction('a', { Armbands: ['A1'], TerminalClasses: ['ZP_LabComputer'] }),
        faction('b', { Armbands: ['B1'], TerminalClasses: ['ZP_LabComputer'] }),
        faction('c', { Armbands: ['C1'] }),
      ]),
      idx,
    )
    expect(rows[0].problems.some((p) => p.path === 'TerminalClasses' && /ZP_LabComputer/.test(p.message))).toBe(true)
    expect(rows[2].problems.some((p) => p.path === 'TerminalClasses' && /власних терміналів/.test(p.message))).toBe(true)
  })
})

describe('collectSupertypeOptions', () => {
  test('спостережені значення, перший регістр виграє, порядок появи, без порожніх', () => {
    const options = collectSupertypeOptions(
      doc([
        faction('a', { Supertype: 'science' }),
        faction('b', { Supertype: 'combat' }),
        faction('c', { Supertype: 'Science' }),
        faction('d', { Supertype: '' }),
        faction('e', { Supertype: 'stalker' }),
      ]),
    )
    expect(options.map((o) => o.id)).toEqual(['science', 'combat', 'stalker'])
  })

  test('нерозібраний документ — порожній список', () => {
    expect(collectSupertypeOptions(undefined)).toEqual([])
  })
})
