// Тести авто-визначення Content для виходів-зразків (W2 Task 6, директива власника
// "Content = назва сировини"). Чотири сценарії, явно перелічені в директиві: empty->auto;
// auto йде за зміною входу; ручне перевизначення переживає зміну входу; "повернути авто"
// знову вмикає підхоплення наступних змін.

import { describe, test, expect } from 'vitest'
import { loadClassIndex } from '../src/model/classIndex'
import type { ClassIndex } from '../src/model/classIndex'
import { isAutoContent, deriveOutputContent, isSampleClass, listSampleFamilyClasses } from '../src/model/sampleContent'

const idx: ClassIndex = loadClassIndex()

describe('isAutoContent', () => {
  test('порожній рядок — завжди авто, незалежно від референсного значення', () => {
    expect(isAutoContent('', 'Apple')).toBe(true)
    expect(isAutoContent('', '')).toBe(true)
  })

  test('значення дорівнює референсному — авто', () => {
    expect(isAutoContent('Apple', 'Apple')).toBe(true)
  })

  test('значення відрізняється від референсного і непорожнє — НЕ авто (ручне)', () => {
    expect(isAutoContent('chimera_claw', 'Apple')).toBe(false)
  })
})

describe('deriveOutputContent — сценарії з брифа директиви', () => {
  test('empty -> auto: порожній Content одразу отримує нове авто-значення', () => {
    expect(deriveOutputContent('', 'Apple', 'Rag')).toBe('Rag')
  })

  test('auto йде за зміною InputItem.Classname: content дорівнював СТАРОМУ авто -> стає НОВИМ', () => {
    expect(deriveOutputContent('Apple', 'Apple', 'Rag')).toBe('Rag')
  })

  test('ручне перевизначення переживає зміну входу: інший рядок лишається недоторканим', () => {
    expect(deriveOutputContent('chimera_claw', 'Apple', 'Rag')).toBe('chimera_claw')
  })

  test('"повернути авто" (пряме присвоєння поточного авто-значення) знову вмикає підхоплення наступних змін', () => {
    // Крок 1: адмін набрав ручний текст — переживає зміну входу (як у тесті вище).
    const afterManualEdit = deriveOutputContent('custom_label', 'Apple', 'Rag')
    expect(afterManualEdit).toBe('custom_label')
    // Крок 2: адмін натискає "повернути авто" — RulePanel присвоює ПОТОЧНЕ авто-значення
    // ('Rag') напряму, без проходу через deriveOutputContent (це просто commit).
    const afterReset = 'Rag'
    // Крок 3: наступна зміна InputItem.Classname (Rag -> Meat) — рядок знову "авто",
    // бо після reset content === поточне (тепер уже СТАРЕ відносно цієї нової зміни) авто-значення.
    expect(deriveOutputContent(afterReset, 'Rag', 'Meat')).toBe('Meat')
  })

  test('ланцюжок кількох правок InputItem.Classname без жодного ручного втручання лишається авто', () => {
    let content = ''
    content = deriveOutputContent(content, '', 'Apple') // перша поява входу
    expect(content).toBe('Apple')
    content = deriveOutputContent(content, 'Apple', 'Rag')
    expect(content).toBe('Rag')
    content = deriveOutputContent(content, 'Rag', 'Meat')
    expect(content).toBe('Meat')
  })
})

describe('isSampleClass (дзеркало ZP_ProcessingConfig.c:352-363 IsSampleClass)', () => {
  test('ZP_Sample сам себе — так', () => {
    expect(isSampleClass(idx, 'ZP_Sample')).toBe(true)
  })

  test('явно НЕ зразок (звичайна ванільна їжа) — ні', () => {
    expect(isSampleClass(idx, 'Apple')).toBe(false)
  })

  test('пайп-форма "|N" зрізається (StripExact) перед перевіркою спадкування', () => {
    expect(isSampleClass(idx, 'ZP_Sample|1')).toBe(true)
  })

  test('порожній рядок — ні (немає такого класу)', () => {
    expect(isSampleClass(idx, '')).toBe(false)
  })

  // Шов родини (W2.5 Task 1/3): тридцять донорів моделі ZP_Sample_01..30 успадковують від
  // ZP_Sample_Base, НЕ від голого 'ZP_Sample' — до фіксу перевірка на буквальне 'ZP_Sample'
  // (замість 'ZP_Sample_Base') відхиляла б Content для будь-якого з цих тридцяти класів,
  // той самий дефект, який T1 виправляв у самому моді (ZP_ProcessingConfig.c:355-359).
  test('ZP_Sample_03 (один із тридцяти донорів моделі) — теж зразок, а не лише сумісний ZP_Sample', () => {
    expect(isSampleClass(idx, 'ZP_Sample_03')).toBe(true)
  })

  test('ZP_Sample_Base сам (спільний батько) — так', () => {
    expect(isSampleClass(idx, 'ZP_Sample_Base')).toBe(true)
  })
})

// listSampleFamilyClasses (W2.5 Task 4, вікно «Типовий зразок») -- перелік конкретних
// класів родини для вікна. Перевірено окремим node-скриптом при розробці (тимчасовий
// tmp_check.mts, видалений): рівно 31 клас у бандлі classindex.json -- ZP_Sample +
// ZP_Sample_01..30, без ZP_Sample_Base (абстрактний корінь) і без ZP_SampleFridge
// (окремий прилад, НЕ спадкоємець ZP_Sample_Base -- він extends Refridgerator).
describe('listSampleFamilyClasses', () => {
  test('рівно 31 клас: сумісний ZP_Sample + тридцять донорів ZP_Sample_01..30', () => {
    const list = listSampleFamilyClasses(idx)
    expect(list).toHaveLength(31)
    expect(list[0]).toBe('ZP_Sample')
    expect(list[1]).toBe('ZP_Sample_01')
    expect(list[list.length - 1]).toBe('ZP_Sample_30')
  })

  test('абстрактний корінь ZP_Sample_Base НЕ входить у перелік', () => {
    expect(listSampleFamilyClasses(idx)).not.toContain('ZP_Sample_Base')
  })

  test('несумісний сусід за назвою (ZP_SampleFridge, інша родина) НЕ входить у перелік', () => {
    expect(listSampleFamilyClasses(idx)).not.toContain('ZP_SampleFridge')
  })

  test('відсортовано за зростанням (ASCII) -- нуль-доповнення "_01".."_30" дає водночас алфавітний і числовий порядок', () => {
    const list = listSampleFamilyClasses(idx)
    const sorted = [...list].sort()
    expect(list).toEqual(sorted)
  })

  test('кожен елемент дійсно проходить isSampleClass (внутрішня узгодженість)', () => {
    for (const cls of listSampleFamilyClasses(idx)) {
      expect(isSampleClass(idx, cls)).toBe(true)
    }
  })
})

describe('deriveOutputContent на виході ZP_Sample_03 — той самий каскад, що й для ZP_Sample (регресія шва)', () => {
  test('вихід ZP_Sample_03 з порожнім Content вважається зразком і отримує авто-значення входу', () => {
    // isSampleClass гейтить, чи РЯДОК Outputs[].Content взагалі має сенс показувати
    // адміну (RulePanel) -- сам каскад deriveOutputContent однаковий для будь-якого
    // класнейму виходу, перевірка тут доводить, що ворота для ZP_Sample_03 відкриті.
    expect(isSampleClass(idx, 'ZP_Sample_03')).toBe(true)
    expect(deriveOutputContent('', 'chimera_claw', 'chimera_claw')).toBe('chimera_claw')
  })
})
