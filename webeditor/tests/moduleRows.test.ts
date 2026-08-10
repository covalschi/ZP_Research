// Тести чистих хелперів вкладки «Модулі» (W4 Task 3, src/ui/moduleRows.ts):
// buildModuleRows — рядки списку з ігровим лицем класу (displayNameOf) і атрибуцією
// проблем РУЙНІВНОГО дзеркала validateModulesDoc (localized шляхи, лампа стану).
//
// Мінор ревью T1 (адресат — цей таск): дзеркало модулів може дати ДВА повідомлення на
// один запис (warn «класу немає в індексі» + alarm по бонусу/дублю), тоді як сервер
// (Validate, ZP_ModulesConfig.c:104-147) видаляє запис на ПЕРШІЙ причині й далі не
// дивиться. Панель показує ОБИДВА — це чесніше за сервер: адмін бачить усі причини
// одразу, а не по одній за рестарт. Тест нижче закріплює саме цю поведінку.

import { describe, test, expect } from 'vitest'
import { loadClassIndex, displayNameOf } from '../src/model/classIndex'
import type { ClassIndex } from '../src/model/classIndex'
import { buildModuleRows } from '../src/ui/moduleRows'

const idx: ClassIndex = loadClassIndex()
const KNOWN_CLASS = 'Apple'

function moduleDef(cls: string, override: Record<string, unknown> = {}): Record<string, unknown> {
  return { Classname: cls, PurityBonus: 0.2, Devices: [], Notes: '', ...override }
}

function doc(modules: Record<string, unknown>[]) {
  return { ConfigVersion: 1, Modules: modules }
}

describe('buildModuleRows', () => {
  test('чистий запис — tone=ok, ігрове лице з індексу, поля з запису', () => {
    const rows = buildModuleRows(doc([moduleDef(KNOWN_CLASS, { Devices: [KNOWN_CLASS], Notes: 'нотатка' })]), idx)
    expect(rows).toHaveLength(1)
    expect(rows[0].classname).toBe(KNOWN_CLASS)
    expect(rows[0].displayName).toBe(displayNameOf(idx, KNOWN_CLASS))
    expect(rows[0].purityBonus).toBe(0.2)
    expect(rows[0].devices).toEqual([KNOWN_CLASS])
    expect(rows[0].notes).toBe('нотатка')
    expect(rows[0].problems).toEqual([])
    expect(rows[0].tone).toBe('ok')
  })

  test('шляхи проблем ЛОКАЛІЗОВАНІ (без префікса Modules[i].), бонус поза [0..2] — alarm «викине»', () => {
    const rows = buildModuleRows(doc([moduleDef(KNOWN_CLASS, { PurityBonus: 3 })]), idx)
    const alarms = rows[0].problems.filter((p) => p.severity === 'alarm')
    expect(alarms).toHaveLength(1)
    expect(alarms[0].path).toBe('PurityBonus')
    expect(alarms[0].message).toMatch(/ВИКИНЕ/)
    expect(rows[0].tone).toBe('alarm')
  })

  test('ДВА повідомлення на один запис: клас поза індексом (warn) + бонус поза межами (alarm) — показані ОБИДВА', () => {
    const rows = buildModuleRows(doc([moduleDef('No_Such_Class_ZZZ', { PurityBonus: -1 })]), idx)
    expect(rows[0].problems.some((p) => p.severity === 'warn' && p.path === 'Classname')).toBe(true)
    expect(rows[0].problems.some((p) => p.severity === 'alarm' && p.path === 'PurityBonus')).toBe(true)
    expect(rows[0].tone).toBe('alarm')
  })

  test('дубль класу — alarm на РАННЬОМУ записі (last-wins реверсного циклу), обидва рядки в списку', () => {
    const rows = buildModuleRows(doc([moduleDef('dup'), moduleDef('dup')]), idx)
    expect(rows).toHaveLength(2)
    expect(rows[0].problems.some((p) => p.severity === 'alarm' && p.path === 'Classname' && /дубль/i.test(p.message))).toBe(true)
  })

  test('невідоме лице: displayNameOf-фолбек = сам класнейм', () => {
    const rows = buildModuleRows(doc([moduleDef('No_Such_Class_ZZZ')]), idx)
    expect(rows[0].displayName).toBe('No_Such_Class_ZZZ')
  })

  test('нерозібраний документ — порожній список без падіння', () => {
    expect(buildModuleRows(undefined, idx)).toEqual([])
    expect(buildModuleRows('текст', idx)).toEqual([])
  })
})
