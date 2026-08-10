// Чисті хелпери вкладки «Налаштування» (W4 Task 4). Імʼя файлу НЕ settingsView.ts свідомо:
// на кейс-інсенситивній ФС Windows воно відрізнялось би від компонента SettingsView.tsx
// лише регістром — tsc це забороняє (TS1261). Два експорти:
//
// readSettingsValues — ТИПІЗОВАНЕ читання полів ZP_SettingsConfig із parsed-документа.
// Причина існування (мінор ревью T1, зафіксований брифом): applySettingsEdit навмисно НЕ
// захищає типи (updater пише що завгодно), тож панель зобовʼязана працювати типізованими
// компонентами над типізованими значеннями — це читальна половина тієї самої страховки.
// Відсутній/кривий ключ канонізується в нуль СВОГО ТИПУ (дзеркало завантаження рушієм,
// W1: відсутній ключ ≠ дефолт Enforce-ініціалізатора), а не в дефолт схеми.
//
// settingsProblems — warn-only дзеркало validateSettingsDoc (фундамент T1; сервер збирає
// problems і ЗАВЖДИ повертає true — ZP_SettingsConfig.c:63-67, файл застосовується як є)
// ПЛЮС додаток редактора: validateClassField на кожному класі TreeTerminalClasses. Сервер
// класи терміналів на завантаженні НЕ звіряє (Validate перевіряє лише порожні рядки
// :53-57) — ClassExists-перевірка існує тільки в живої команди `!zp set treeterminal`
// (OpSetSetting, ZP_ConfigService.c:786-829); «залізне правило» брифа вимагає попередження
// біля КОЖНОГО класового поля, тож тут воно додається поштучно (warn, magazineCheck=false,
// пайп-форму «|1» validateClassField сам зрізає stripExact-ом — та сама, що приймає OpSetSetting).

import type { ClassIndex } from '../model/classIndex'
import type { FieldError } from '../model/ruleValidation'
import { validateClassField } from '../model/ruleValidation'
import { validateSettingsDoc } from '../model/configValidation'

export interface SettingsValues {
  configVersion: number
  debugMode: boolean
  adminIds: string[]
  defaultFaction: string
  treeTerminalClasses: string[]
  treeVisibilityDepth: number
  treeBackgroundImage: string
}

type Rec = Record<string, unknown>

function recOf(v: unknown): Rec | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function bool(v: unknown): boolean {
  // Канон рушія: bool у файлі — 1/0; parseConfig віддає boolean, але читач стійкий і до
  // сирого числа (той самий поділ, що в тесті: стійкість до майбутніх викликачів).
  return v === true || v === 1
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => str(x)) : []
}

export function readSettingsValues(doc: unknown): SettingsValues {
  const d = recOf(doc) ?? {}
  return {
    configVersion: num(d.ConfigVersion),
    debugMode: bool(d.DebugMode),
    adminIds: strArr(d.AdminIds),
    defaultFaction: str(d.DefaultFaction),
    treeTerminalClasses: strArr(d.TreeTerminalClasses),
    treeVisibilityDepth: num(d.TreeVisibilityDepth),
    treeBackgroundImage: str(d.TreeBackgroundImage),
  }
}

export function settingsProblems(doc: unknown, index: ClassIndex): FieldError[] {
  const out: FieldError[] = [...validateSettingsDoc(doc)]
  const terminals = readSettingsValues(doc).treeTerminalClasses
  terminals.forEach((cls, i) => {
    // validateClassField на '' мовчить — порожній рядок уже покритий серверним дзеркалом
    // validateSettingsDoc (Validate :53-57), другий warn на тому самому індексі був би шумом.
    out.push(...validateClassField(`TreeTerminalClasses[${i}]`, cls, index, false))
  })
  return out
}
