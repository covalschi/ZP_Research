// Чисті хелпери вкладки «Модулі» (W4 Task 3) — прецедент factionRows.ts/pointTypesMatrix.ts.
// Дзеркало РУЙНІВНОЇ Validate (ZP_ModulesConfig.c:104-147) уже живе в validateModulesDoc
// (фундамент T1) — тут лише атрибуція його проблем по записах (локалізація шляхів
// Modules[i].X -> X) та ігрове лице класу для списку.
//
// Мінор ревью T1 (адресат — цей таск): на ОДИН запис можливі ДВА повідомлення (warn «класу
// немає в індексі» + alarm по бонусу/дублю), тоді як сервер видаляє запис на ПЕРШІЙ причині
// й далі не дивиться. Панель показує ОБИДВА — чесніше за сервер: адмін бачить усі причини
// одразу, а не по одній за рестарт. Дедупу тут НЕМАЄ навмисно (на відміну від factionRows,
// де два дзеркала повторювали ту САМУ причину двічі — у модулів причини різні).

import type { ClassIndex } from '../model/classIndex'
import { displayNameOf } from '../model/classIndex'
import type { FieldError } from '../model/ruleValidation'
import { validateModulesDoc } from '../model/configValidation'
import { worstTone } from './factionRows'
import type { RowTone } from './factionRows'

export interface ModuleRow {
  index: number
  classname: string
  // Ігрове лице (displayNameOf, успадкування по ланцюгу предків; фолбек — сам класнейм).
  displayName: string
  purityBonus: number
  devices: string[]
  notes: string
  // Шляхи ЛОКАЛЬНІ до запису (Classname, PurityBonus, Devices[0], …).
  problems: FieldError[]
  tone: RowTone
}

type Rec = Record<string, unknown>

function recOf(v: unknown): Rec | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined
}

const REC_PATH = /^Modules\[(\d+)\]\.(.+)$/

export function buildModuleRows(doc: unknown, index: ClassIndex): ModuleRow[] {
  const d = recOf(doc)
  if (!d || !Array.isArray(d.Modules)) return []

  const rows: ModuleRow[] = d.Modules.map((raw, i) => {
    const m = recOf(raw)
    const classname = m && typeof m.Classname === 'string' ? m.Classname : ''
    return {
      index: i,
      classname,
      displayName: classname !== '' ? displayNameOf(index, classname) : '',
      purityBonus: m && typeof m.PurityBonus === 'number' ? m.PurityBonus : 0,
      devices: Array.isArray(m?.Devices) ? (m.Devices as unknown[]).filter((x): x is string => typeof x === 'string') : [],
      notes: m && typeof m.Notes === 'string' ? m.Notes : '',
      problems: [],
      tone: 'ok',
    }
  })

  for (const problem of validateModulesDoc(doc, index)) {
    const match = REC_PATH.exec(problem.path)
    if (!match) continue // validateModulesDoc не продукує doc-рівневих шляхів
    const row = rows[Number(match[1])]
    if (!row) continue
    row.problems.push({ ...problem, path: match[2] })
  }

  for (const row of rows) row.tone = worstTone(row.problems)
  return rows
}
