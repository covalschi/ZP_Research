// Чисті хелпери вкладки «Фракції» (W4 Task 3) — прецедент pointTypesMatrix.ts: мапують
// parsed-документ Factions.json у рядки списку та деталь-панелі, самі нічого не рендерять
// і не мутують. Дзеркала валідації — model/configValidation.ts (фундамент T1).
//
// АТРИБУЦІЯ ПРОБЛЕМ (ключове рішення, закріплене tests/factionRows.test.ts):
// сервер має ДВА дзеркала з великим перетином — validateFactionRecord (per-record дзеркало
// ValidateFaction :183-212: жорсткі причини відмови ops = alarm, softWarn = warn) і
// validateFactionsDoc (whole-file Validate :227-282 + WarnShared*, усе warn — TryLoadFactions
// ігнорує результат). Майже кожна панельна проблема (порожній DisplayName, конфлікт нашивки,
// клас поза індексом…) існує в ОБОХ дзеркалах із різними severity. Показувати обидва — шум,
// а не чесність (на відміну від модулів, де ДВА повідомлення — це ДВІ РІЗНІ причини).
// Правило: первинне дзеркало рядка — per-record; whole-file додає лише проблеми на шляхах,
// яких per-record НЕ зачепив (Supertype, дубль Id, спільні термінали/прилади, «без власних
// терміналів/приладів»). Збіг локалізованого шляху ПРИ ОДНАКОВІЙ severity -> whole-file
// запис відкидається (ревью T3, minor 1: різна суворість = різна причина, обидві видимі).
//
// ДОДАТОК РЕДАКТОРА (не серверне дзеркало): TerminalClasses/DeviceClasses сервер узагалі не
// звіряє з конфігами (Validate перевіряє лише нашивки, :262-268) — але «залізне правило»
// брифа вимагає validateClassField-попередження біля КОЖНОГО класового поля, тож тут вони
// додаються поштучно (warn, magazineCheck=false) і теж впливають на лампу рядка.

import type { ClassIndex } from '../model/classIndex'
import type { FieldError, FieldSeverity } from '../model/ruleValidation'
import { validateClassField } from '../model/ruleValidation'
import { validateFactionRecord, validateFactionsDoc } from '../model/configValidation'
import type { ZpOption } from './ZpSelect'

export type RowTone = 'ok' | 'warn' | 'alarm'

export interface FactionRow {
  index: number
  id: string
  displayName: string
  supertype: string
  armbands: string[]
  terminals: string[]
  devices: string[]
  // Шляхи ЛОКАЛЬНІ до запису (Id, DisplayName, Armbands[0], TerminalClasses, …) — деталь-
  // панель фільтрує їх fieldErrors-ами без повторного розбору префіксів.
  problems: FieldError[]
  tone: RowTone
}

export interface FactionRowsResult {
  rows: FactionRow[]
  // Проблеми рівня документа (шлях не Factions[i].…) — напр. «жодної фракції».
  docProblems: FieldError[]
}

export function worstTone(problems: { severity: FieldSeverity }[]): RowTone {
  if (problems.some((p) => p.severity === 'alarm')) return 'alarm'
  if (problems.length > 0) return 'warn'
  return 'ok'
}

type Rec = Record<string, unknown>

function recOf(v: unknown): Rec | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

const REC_PATH = /^Factions\[(\d+)\]\.(.+)$/

export function buildFactionRows(doc: unknown, index: ClassIndex): FactionRowsResult {
  const d = recOf(doc)
  if (!d || !Array.isArray(d.Factions)) return { rows: [], docProblems: [] }
  const factions = d.Factions

  const rows: FactionRow[] = factions.map((raw, i) => {
    const f = recOf(raw)
    const problems: FieldError[] = [...validateFactionRecord(raw, factions, index)]
    // Додаток редактора: класові поля, які сервер не звіряє (див. шапку модуля).
    for (const [field, classes] of [
      ['TerminalClasses', strArr(f?.TerminalClasses)],
      ['DeviceClasses', strArr(f?.DeviceClasses)],
    ] as const) {
      classes.forEach((cls, ci) => {
        // Ревью T3 (minor 3): validateClassField на '' мовчить, і свіжий незаповнений
        // рядок зберігався б у файл порожнім рядком без жодного сигналу (сервер його теж
        // ігнорує — тому warn-лінт, не аварія; у нашивок порожній рядок — серверний alarm).
        if (cls === '') {
          problems.push({ path: `${field}[${ci}]`, severity: 'warn', message: 'порожній рядок — приберіть або заповніть (сервер його мовчки ігнорує)' })
          return
        }
        problems.push(...validateClassField(`${field}[${ci}]`, cls, index, false))
      })
    }
    return {
      index: i,
      id: f ? str(f.Id) : '',
      displayName: f ? str(f.DisplayName) : '',
      supertype: f ? str(f.Supertype) : '',
      armbands: strArr(f?.Armbands),
      terminals: strArr(f?.TerminalClasses),
      devices: strArr(f?.DeviceClasses),
      problems,
      tone: 'ok',
    }
  })

  const docProblems: FieldError[] = []
  for (const problem of validateFactionsDoc(doc, index)) {
    const m = REC_PATH.exec(problem.path)
    if (!m) {
      docProblems.push(problem)
      continue
    }
    const i = Number(m[1])
    const localPath = m[2]
    const row = rows[i]
    if (!row) {
      docProblems.push(problem)
      continue
    }
    // Дедуп по локалізованому шляху І severity (ревью T3, minor 1): по самому шляху
    // per-record-alarm (конфлікт нашивки) ковтав би whole-file-WARN іншої природи на тому
    // самому полі (клас відсутній в індексі) — різна суворість = різна причина, обидві
    // мусять бути видимі. Первинне дзеркало — per-record (див. шапку модуля).
    if (row.problems.some((p) => p.path === localPath && p.severity === problem.severity)) continue
    row.problems.push({ ...problem, path: localPath })
  }

  for (const row of rows) row.tone = worstTone(row.problems)
  return { rows, docProblems }
}

// Supertype — мітка групування без жодного гейта (whole-file Validate лише warn-ить на
// порожню, :247-248): опції — СПОСТЕРЕЖЕНІ значення проєкту (перший регістр виграє,
// порядок появи) + allowFree у ZpSelect для нових міток.
export function collectSupertypeOptions(doc: unknown): ZpOption[] {
  const d = recOf(doc)
  if (!d || !Array.isArray(d.Factions)) return []
  const seen = new Map<string, string>()
  for (const raw of d.Factions) {
    const f = recOf(raw)
    const sup = f ? str(f.Supertype) : ''
    if (sup === '') continue
    const key = sup.toLowerCase()
    if (!seen.has(key)) seen.set(key, sup)
  }
  return [...seen.values()].map((v) => ({ id: v, label: v }))
}
