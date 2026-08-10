// Тести чистих хелперів вкладки «Налаштування» (W4 Task 4, ui/settingsFields.ts) — TDD-вперед.
// readSettingsValues — ТИПІЗОВАНЕ читання полів ZP_SettingsConfig (мінор ревью T1: панель
// зобовʼязана працювати типізованими компонентами, бо applySettingsEdit типи не захищає);
// settingsProblems — warn-only дзеркало validateSettingsDoc (фундамент T1) + додаток
// редактора validateClassField для кожного класу TreeTerminalClasses (сервер класи терміналів
// на завантаженні НЕ звіряє — перевірка є лише в живої команди `!zp set treeterminal`,
// OpSetSetting, ZP_ConfigService.c:786-829; «залізне правило» вимагає попередження біля
// кожного класового поля).

import { describe, test, expect } from 'vitest'
import { parseConfig } from '../src/io/parse'
import { SETTINGS_SCHEMA } from '../src/model/schema'
import { loadClassIndex } from '../src/model/classIndex'
import type { ClassIndex } from '../src/model/classIndex'
import { readSettingsValues, settingsProblems } from '../src/ui/settingsFields'

const idx: ClassIndex = loadClassIndex()

function parsedDoc(override: Record<string, unknown> = {}): unknown {
  const doc = {
    ConfigVersion: 1,
    DebugMode: 1, // канон рушія: bool друкується 1/0
    AdminIds: ['76561190000000000'],
    DefaultFaction: 'default',
    TreeTerminalClasses: ['ZP_LabComputer'],
    TreeVisibilityDepth: 2,
    TreeBackgroundImage: 'gui/textures/tree_bg.edds',
    ...override,
  }
  return parseConfig(SETTINGS_SCHEMA, JSON.stringify(doc)).value
}

describe('readSettingsValues: типізоване читання', () => {
  test('усі сім полів схеми читаються з правильними типами', () => {
    const v = readSettingsValues(parsedDoc())
    expect(v.configVersion).toBe(1)
    expect(v.debugMode).toBe(true)
    expect(v.adminIds).toEqual(['76561190000000000'])
    expect(v.defaultFaction).toBe('default')
    expect(v.treeTerminalClasses).toEqual(['ZP_LabComputer'])
    expect(v.treeVisibilityDepth).toBe(2)
    expect(v.treeBackgroundImage).toBe('gui/textures/tree_bg.edds')
  })

  test('DebugMode false (0 у файлі) — false', () => {
    expect(readSettingsValues(parsedDoc({ DebugMode: 0 })).debugMode).toBe(false)
  })

  test('відсутні ключі — нулі свого типу (дзеркало завантаження рушієм, НЕ дефолти Enforce)', () => {
    // parseConfig сам канонізує відсутні ключі в нуль типу — але readSettingsValues мусить
    // бути стійким і до сирого обʼєкта без канонізації (напр. у майбутніх викликачів).
    const v = readSettingsValues({})
    expect(v.configVersion).toBe(0)
    expect(v.debugMode).toBe(false)
    expect(v.adminIds).toEqual([])
    expect(v.defaultFaction).toBe('')
    expect(v.treeTerminalClasses).toEqual([])
    expect(v.treeVisibilityDepth).toBe(0)
    expect(v.treeBackgroundImage).toBe('')
  })
})

describe('settingsProblems: warn-only дзеркало + класовий додаток редактора', () => {
  test('чистий стендовий документ — жодної проблеми', () => {
    expect(settingsProblems(parsedDoc(), idx)).toEqual([])
  })

  test('TreeVisibilityDepth поза [0..10] — warn (Validate :59-60), НЕ alarm', () => {
    const out = settingsProblems(parsedDoc({ TreeVisibilityDepth: 15 }), idx)
    const hit = out.filter((p) => p.path === 'TreeVisibilityDepth')
    expect(hit.length).toBe(1)
    expect(hit[0].severity).toBe('warn')
  })

  test('AdminIds не схожий на Steam64 — warn із номером рядка', () => {
    const out = settingsProblems(parsedDoc({ AdminIds: ['76561190000000000', 'абракадабра'] }), idx)
    expect(out.some((p) => p.path === 'AdminIds[1]' && p.severity === 'warn' && p.message.includes('Steam64'))).toBe(true)
    expect(out.some((p) => p.path === 'AdminIds[0]')).toBe(false)
  })

  test('порожній DefaultFaction — warn path-safe (Validate :51-52)', () => {
    const out = settingsProblems(parsedDoc({ DefaultFaction: '' }), idx)
    expect(out.some((p) => p.path === 'DefaultFaction' && p.severity === 'warn')).toBe(true)
  })

  test('порожній перелік терміналів — warn «дерево не відкриється» (Validate :61-62)', () => {
    const out = settingsProblems(parsedDoc({ TreeTerminalClasses: [] }), idx)
    expect(out.some((p) => p.path === 'TreeTerminalClasses' && p.severity === 'warn')).toBe(true)
  })

  test('порожній рядок терміналів — warn на своєму індексі (Validate :53-57)', () => {
    const out = settingsProblems(parsedDoc({ TreeTerminalClasses: ['ZP_LabComputer', ''] }), idx)
    expect(out.some((p) => p.path === 'TreeTerminalClasses[1]' && p.severity === 'warn')).toBe(true)
  })

  test('клас термінала поза індексом — warn додатка редактора; відомий клас — тиша', () => {
    const out = settingsProblems(parsedDoc({ TreeTerminalClasses: ['ZP_LabComputer', 'Land_Unknown_Console_XYZ'] }), idx)
    expect(out.some((p) => p.path === 'TreeTerminalClasses[1]' && p.severity === 'warn' && p.message.includes('індекс'))).toBe(true)
    expect(out.some((p) => p.path === 'TreeTerminalClasses[0]')).toBe(false)
  })

  test('пайп-форма "|1" термінала не хибить (stripExact перед пошуком в індексі)', () => {
    const out = settingsProblems(parsedDoc({ TreeTerminalClasses: ['ZP_LabComputer|1'] }), idx)
    expect(out.some((p) => p.path === 'TreeTerminalClasses[0]')).toBe(false)
  })

  test('жодна проблема Settings ніколи не alarm (сервер: Validate завжди повертає true, :63-67)', () => {
    const out = settingsProblems(
      parsedDoc({ TreeVisibilityDepth: -3, AdminIds: ['x'], DefaultFaction: 'a/b', TreeTerminalClasses: [''] }),
      idx,
    )
    expect(out.length).toBeGreaterThan(0)
    expect(out.every((p) => p.severity === 'warn')).toBe(true)
  })
})
