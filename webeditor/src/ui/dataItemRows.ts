// Чисті хелпери вкладки «Заготовки» (W4 Task 4) — прецедент factionRows/moduleRows: мапують
// проєкт у рядки списку, самі нічого не рендерять і не мутують. Родина класів — скан індексу
// isKindOf(..., 'ZP_Data_Base') (прецедент listSampleFamilyClasses, model/sampleContent.ts),
// НЕ жорсткий список 90 імен: майбутній 91-й донор підхопиться без правки цього файлу.
//
// Дзеркало сервера — РУЙНІВНИЙ Validate DataItems.json (ZP_DataItemsConfig.c:105-137), той
// самий клас суворості, що Modules: невалідний запис (порожній Id :80-81, класу немає в грі
// :84-85, не-родина ZP_Data_Base :86-87, порожній Name :88-89) і РАННІ дублі Id (реверсний
// цикл :111-130, last-wins) ВИКИДАЮТЬСЯ RemoveOrdered — формулювання «сервер ВИКИНЕ цей
// запис», НЕ «відхилить файл». М'які проблеми балів (порожній запис :92-96, невідомий тип
// :97-98 — ЛИШЕ коли PointTypes завантажені, дзеркало `if (pointTypes && ...)`, Amount поза
// [0..1000000] :99-100) — softWarn, запис живе.
//
// «Клас поза індексом» — ЗАВЖДИ 'warn' (правило шапки configValidation.ts: офлайн-індекс
// редактора ≠ живий сервер), навіть попри те, що сервер за СПРАВЖНЬОЇ відсутності класу
// запис виріже (:84-85) — повідомлення чесно каже, що зробить сервер. «Клас Є в індексі» —
// 'alarm' із ТОЧНОЮ причиною зрізу (ревью T4, minor 1): корінь НЕ CfgVehicles — сервер
// ріже на :84-85 (ConfigIsExisting перевіряє ЛИШЕ CfgVehicles, клас під іншим коренем для
// нього «немає в грі»); корінь CfgVehicles, але не родина — :86-87.

import type { Project } from '../io/project'
import type { ClassIndex } from '../model/classIndex'
import { isKindOf, classRoot, stripExact, ROOT_NAMES } from '../model/classIndex'
import type { Root } from '../model/classIndex'
import { resolveDataItemFace, findDataItemEntry } from '../model/faceResolve'
import type { DataItemFace } from '../model/faceResolve'
import type { FieldError } from '../model/ruleValidation'
import { worstTone } from './factionRows'
import type { RowTone } from './factionRows'
import { collectPointTypeOptions } from './optionCollectors'

const CUT = 'сервер ВИКИНЕ цей запис при завантаженні (руйнівний Validate, ZP_DataItemsConfig.c:105-137)'

export interface DataItemRow {
  // Ідентичність рядка: для родини — імʼя класу з індексу, для сиріт — Id запису як у файлі.
  classname: string
  face: DataItemFace
  // Запис є в DataItems.json, але клас НЕ належить родині ZP_Data_Base (або відсутній в індексі).
  orphan: boolean
  problems: FieldError[]
  tone: RowTone
  // Людське зведення нагород: 'bio_field_t1×5, combat_field_t1×2' ('' якщо балів немає).
  pointsSummary: string
}

export interface DataItemRowsResult {
  rows: DataItemRow[]
  // Проблеми без рядка-носія (запис із порожнім Id — його немає до чого привʼязати).
  docProblems: FieldError[]
}

// Дзеркало listSampleFamilyClasses для родини заготовок: усі КОНКРЕТНІ класи ZP_Data_Base у
// поточному ClassIndex, без самого абстрактного кореня (scope=0 носій спільного коду, не
// предмет гравця — той самий аргумент, що в listSampleFamilyClasses про ZP_Sample_Base).
// `.sort()` — UTF-16 кодове порівняння; для ASCII-імен із нуль-доповненням «_01..90» це
// водночас алфавітний і числовий порядок.
export function listDataFamilyClasses(index: ClassIndex): string[] {
  const out: string[] = []
  for (const row of index.classes) {
    const name = row[0]
    if (name.toLowerCase() === 'zp_data_base') continue
    if (isKindOf(index, name, 'ZP_Data_Base')) out.push(name)
  }
  return out.sort()
}

type Rec = Record<string, unknown>

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

// ЖОРСТКІ відмови ValidateItem (:78-89) для запису, що ВЖЕ вижив last-wins — рівно ті, після
// яких сервер ВИКИДАЄ запис із масиву, тобто Find його не знайде і CanDeposit поверне false.
//
// Дубль Id сюди НАВМИСНО не входить: із дублів гине РАННЯ копія, а та, що вижила (остання —
// саме її повертає findDataItemEntry), для сервера цілком легітимна. Тому «дубль» лишається
// окремою тривогою рядка вкладки «Заготовки», але НЕ означає «цього запису на сервері немає».
//
// Виділено окремою функцією у W4 T5 фікс-раунді ревʼю (Critical 1): вкладка «Баланс» мусить
// гейтити підсумки матриці й видобуток балів РІВНО цим набором — до фіксу вона рахувала суми
// й малювала зелене «видобувається» по записах, яких на сервері не існує. Друга копія цих
// чотирьох перевірок розійшлася б із цією при першій же правці.
//
// severity лишається таким самим, як у рядку вкладки: «класу немає в індексі» — 'warn'
// (офлайн-індекс редактора ≠ жива гра, правило шапки configValidation.ts), решта — 'alarm'.
// Споживач, якому треба «сервер ТОЧНО викине», фільтрує по severity === 'alarm'.
function hardCutProblems(face: DataItemFace, entry: Rec, familyMember: boolean, root: Root | undefined): FieldError[] {
  const inIndex = root !== undefined
  const out: FieldError[] = []
  if (!inIndex) {
    out.push({
      path: 'Id',
      severity: 'warn',
      message: `класу '${face.entryId}' немає в індексі редактора (мод міг бути відсутній на цій машині); якщо його справді немає В ГРІ — ${CUT} (ValidateItem :84-85)`,
    })
  } else if (root !== 0) {
    // Уточнення цитати (ревью T4, minor 1): ValidateItem перевіряє існування ЛИШЕ через
    // ConfigIsExisting("CfgVehicles " + Id) (:84-85) — клас під іншим коренем (набій,
    // магазин, зброя) для сервера «не існує в грі», і запис ріжеться ЩЕ ДО перевірки
    // родини (:86-87). Наслідок той самий (запис викинуто), але причина — інша.
    // root — числовий (ROOT_NAMES: 0 = CfgVehicles).
    out.push({
      path: 'Id',
      severity: 'alarm',
      message: `'${face.entryId}' лежить під коренем ${ROOT_NAMES[root]}, а сервер шукає заготовки ЛИШЕ у CfgVehicles — для нього класу «немає в грі», ${CUT} (ValidateItem :84-85)`,
    })
  } else if (!familyMember) {
    out.push({
      path: 'Id',
      severity: 'alarm',
      message: `'${face.entryId}' не є заготовкою родини ZP_Data_Base — ${CUT} (ValidateItem :86-87)`,
    })
  }
  if (str(entry.Name) === '') {
    out.push({ path: 'Name', severity: 'alarm', message: `заготовка без Name — ${CUT} (ValidateItem :88-89)` })
  }
  return out
}

// Той самий зріз, але з резолвом лиця/запису/родини всередині — публічний вхід для
// споживачів поза цим файлом (ui/balanceView.ts). Запису немає взагалі -> порожньо: різати
// нема чого (клас без запису в DataItems.json — окрема проблема, її діагностує сам споживач).
export function dataItemCutProblems(project: Project, index: ClassIndex, classname: string): FieldError[] {
  const entry = findDataItemEntry(project, classname)
  if (!entry) return []
  const face = resolveDataItemFace(project, index, classname)
  const base = stripExact(classname)
  return hardCutProblems(face, entry, isKindOf(index, base, 'ZP_Data_Base'), classRoot(index, base))
}

// Проблеми ОДНОГО запису, що вижив last-wins (сирі поля — з findDataItemEntry, єдиного
// джерела last-wins-семантики). knownPointTypes === undefined означає «PointTypes.json не
// завантажено» — перевірка типів балів тоді мовчить, як на сервері (`if (pointTypes && ...)`).
function entryProblems(face: DataItemFace, entry: Rec, familyMember: boolean, root: Root | undefined, knownPointTypes: Set<string> | undefined): FieldError[] {
  const out: FieldError[] = []
  if (face.duplicate) {
    out.push({
      path: 'Id',
      severity: 'alarm',
      message: `дубль Id '${face.entryId}' — рушій лишає ОСТАННІЙ запис (реверсний Validate :111-130), решту ВИКИНЕ з файлу; форма нижче показує саме той, що виживе`,
    })
  }
  // Порядок повідомлень рядка збережено байт у байт: дубль -> зріз -> бали.
  out.push(...hardCutProblems(face, entry, familyMember, root))
  const points = Array.isArray(entry.Points) ? entry.Points : []
  points.forEach((raw, i) => {
    const p = raw && typeof raw === 'object' ? (raw as Rec) : undefined
    const type = p ? str(p.Type) : ''
    if (!p || type === '') {
      out.push({ path: `Points[${i}]`, severity: 'warn', message: 'порожній запис балів — сервер лише попередить, запис ЖИВЕ (softWarn :92-96)' })
      return
    }
    // Точне ==, як pointTypes.Find (кейс-СЕНСИТИВНИЙ, ZP_PointTypesConfig.c:317-325).
    if (knownPointTypes && !knownPointTypes.has(type)) {
      out.push({ path: `Points[${i}]`, severity: 'warn', message: `невідомий тип балів '${type}' — назва покажеться, але нагорода НЕ нарахується (softWarn :97-98, CountGrantable :144-153)` })
    }
    const amount = typeof p.Amount === 'number' ? p.Amount : 0
    if (amount < 0 || amount > 1000000) {
      out.push({ path: `Points[${i}]`, severity: 'warn', message: `Amount '${amount}' поза межами [0..1000000] (softWarn :99-100)` })
    }
  })
  return out
}

export function buildDataItemRows(project: Project, index: ClassIndex): DataItemRowsResult {
  const family = listDataFamilyClasses(index)
  const familyLower = new Set(family.map((c) => c.toLowerCase()))

  const ptFile = project.files.find((f) => f.kind === 'pointTypes')
  const knownPointTypes = ptFile ? new Set(collectPointTypeOptions(project).map((o) => o.id)) : undefined

  const docProblems: FieldError[] = []
  const rows: DataItemRow[] = []

  const makeRow = (classname: string, orphan: boolean): DataItemRow => {
    const face = resolveDataItemFace(project, index, classname)
    const entry = findDataItemEntry(project, classname)
    const problems = entry
      ? entryProblems(face, entry, isKindOf(index, stripExact(classname), 'ZP_Data_Base'), classRoot(index, stripExact(classname)), knownPointTypes)
      : []
    const pointsSummary = face.points.map((p) => `${p.Type !== '' ? p.Type : '—'}×${p.Amount}`).join(', ')
    return { classname, face, orphan, problems, tone: worstTone(problems), pointsSummary }
  }

  for (const cls of family) rows.push(makeRow(cls, false))

  // Сироти: записи DataItems.json, чий Id не належить родині — показуємо ОКРЕМИМИ рядками
  // (адмін мусить бачити, що сервер їх викине), унікальність — кейс-інсенситивна (last-wins
  // усередині face). Порожній Id рядка-носія не має — йде в docProblems.
  const dataFile = project.files.find((f) => f.kind === 'dataItems')
  const doc = dataFile?.parsed as { Items?: unknown[] } | undefined
  if (doc && Array.isArray(doc.Items)) {
    const seenOrphans = new Set<string>()
    doc.Items.forEach((raw, i) => {
      const d = raw && typeof raw === 'object' ? (raw as Rec) : undefined
      const id = d ? str(d.Id) : ''
      if (id === '') {
        docProblems.push({ path: `Items[${i}]`, severity: 'alarm', message: `запис №${i + 1} без Id — ${CUT} (ValidateItem :80-81)` })
        return
      }
      const lower = id.toLowerCase()
      if (familyLower.has(lower) || seenOrphans.has(lower)) return
      seenOrphans.add(lower)
      rows.push(makeRow(id, true))
    })
  }

  return { rows, docProblems }
}

// Фільтр живого пошуку: підрядок класнейму АБО налаштованої назви, кейс-інсенситивно.
export function filterDataItemRows(rows: DataItemRow[], query: string): DataItemRow[] {
  const q = query.trim().toLowerCase()
  if (q === '') return rows
  return rows.filter((r) => r.classname.toLowerCase().includes(q) || r.face.name.toLowerCase().includes(q))
}
