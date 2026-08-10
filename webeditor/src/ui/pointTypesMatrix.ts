// Чисті хелпери розкладки матриці типів балів Категорія×Вид×Тір (W4 Task 2). Модуль ui/,
// але БЕЗ React (той самий статус, що optionCollectors.ts/treeLayout.ts) — тестується в
// environment='node' (tests/pointTypesMatrix.test.ts, TDD: тести написані ПЕРЕД цим файлом).
//
// Дзеркала сервера (усі процитовані, нічого не вгадано):
//   - порядок осей = SortOrder (стабільно при рівних), збіг Id ТОЧНИЙ ==, перший виграє —
//     дзеркало DimensionName/DimensionOrder (ZP_PointTypesConfig.c:237-255: `d.Id == id`,
//     перший збіг, невідомий Id -> 9999 «іде в кінець, але не зникає»);
//   - запис із Category/Kind поза осями НЕ ховається: сервер показав би його блоком у кінці
//     з сирим Id — у редакторі це секція «поза матрицею» (вимога брифа: показати розсинхрон
//     як проблему, а не мовчки загубити запис);
//   - записи, які НЕ можна адресувати за Id (порожній Id — alarm Validate :301-304;
//     не-об'єкт у масиві), теж ідуть «поза матрицею»: гейт збереження тримає їх alarm-ом
//     (validatePointTypesDoc), applyPointTypeEdit/deletePointType за Id їх не бачать, і
//     єдиний шлях ремонту — позиційне deletePointTypeAt, тож секція мусить показати їх
//     із index-ом;
//   - Tier поза [0..10] (межі Validate :311-312) НЕ розширює колонки — такий запис іде
//     «поза матрицею» (він і так alarm, який тримає гейт).
//
// РІШЕННЯ ПРО КОЛОНКИ ТІРІВ (бриф лишав діапазон на розсуд реалізатора з вимогою
// задокументувати — ось рішення):
// колонки — суцільний діапазон 1..max(3, максимальний спостережений валідний Tier записів
// У матриці); колонка 0 (легальна для сервера) додається ЛИШЕ коли запис із Tier=0 реально
// є — стенд і шаблон Id (`..._t<N>`) починаються з 1, тож порожня колонка 0 за замовчуванням
// була б мертвою. Мінімум 3 колонки — щоб порожній файл одразу показував робочу сітку
// (стендова матриця 4×2×3). extraTiers (кнопка «+ тір» у вкладці) додає порожні колонки
// справа, стеля — 10 (сервер відхиляє Tier > 10).

import { uniqueId } from '../io/ruleFileUtils'

export interface MatrixAxisEntry {
  // Позиція у масиві осі файлу (для applyDimensionEdit/renameDimension помилок і стабільних key)
  index: number
  id: string
  name: string
  sortOrder: number
}

export interface MatrixEntry {
  // Позиція у doc.PointTypes — ідентичність запису для вибору і позиційного deletePointTypeAt
  index: number
  id: string
  name: string
  color: string
  sortOrder: number
  category: string
  kind: string
  tier: number
  // Id зустрічається >1 раз ТОЧНИМ == (дзеркало Validate :306-308) — включно з поза-матричними
  duplicate: boolean
}

export interface OutsideEntry {
  entry: MatrixEntry
  // Людські причини, чому запис не ліг у матрицю (кожна — окремий рядок для UI)
  reasons: string[]
}

export interface PointTypesMatrix {
  categories: MatrixAxisEntry[]
  kinds: MatrixAxisEntry[]
  tiers: number[]
  // Ключ — cellKey(catId, kindId, tier); значення — записи клітинки у порядку файлу
  cells: Map<string, MatrixEntry[]>
  outside: OutsideEntry[]
  // УСІ записи у порядку файлу (і матричні, і поза-матричні) — для панелі близнюків
  entries: MatrixEntry[]
  // Дублі Id осей ТОЧНИМ == (ревью T2, minor 3): axisEntries дедупить «перший виграє»
  // (дзеркало першого збігу DimensionName/DimensionOrder — близнюк осі НІКОЛИ не
  // рендериться), а мутатори осей на дублі відмовляють «виправте вручну» — без цього
  // списку близнюк був би невидимим і неполагоджуваним мовчки. Сервер осі НЕ валідує
  // (нешкідливо), тож це warn-рядок аркуша осей, не гейт.
  axisDuplicates: { axis: 'Categories' | 'Kinds'; id: string; count: number }[]
}

type Rec = Record<string, unknown>

function recOf(v: unknown): Rec | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function num(v: unknown): number {
  return typeof v === 'number' ? v : 0
}

// Ключ клітинки: JSON-кортеж, а не склейка роздільником — Id осей довільні рядки, і жоден
// символ-роздільник не був би гарантовано вільним (а керівні символи в літералах — відома
// міна Write/Edit-тулів, стояче правило байт-скану W2.6).
export function cellKey(catId: string, kindId: string, tier: number): string {
  return JSON.stringify([catId, kindId, tier])
}

interface DocShape {
  types: unknown[]
  categories: unknown[]
  kinds: unknown[]
}

function shapeOf(doc: unknown): DocShape {
  const d = recOf(doc)
  return {
    types: d && Array.isArray(d.PointTypes) ? d.PointTypes : [],
    categories: d && Array.isArray(d.Categories) ? d.Categories : [],
    kinds: d && Array.isArray(d.Kinds) ? d.Kinds : [],
  }
}

// Вісь: валідні об'єкти з непорожнім Id, дедуп ТОЧНИМ == «перший виграє» (дзеркало
// першого збігу DimensionName/DimensionOrder), стабільне сортування за SortOrder.
function axisEntries(raw: unknown[]): MatrixAxisEntry[] {
  const seen = new Set<string>()
  const out: MatrixAxisEntry[] = []
  raw.forEach((v, index) => {
    const d = recOf(v)
    if (!d) return
    const id = str(d.Id)
    if (id === '' || seen.has(id)) return
    seen.add(id)
    out.push({ index, id, name: str(d.Name), sortOrder: num(d.SortOrder) })
  })
  return out
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.sortOrder !== b.e.sortOrder ? a.e.sortOrder - b.e.sortOrder : a.i - b.i))
    .map((x) => x.e)
}

function entryOf(raw: unknown, index: number): MatrixEntry {
  const d = recOf(raw)
  return {
    index,
    id: d ? str(d.Id) : '',
    name: d ? str(d.Name) : '',
    color: d ? str(d.Color) : '',
    sortOrder: d ? num(d.SortOrder) : 0,
    category: d ? str(d.Category) : '',
    kind: d ? str(d.Kind) : '',
    tier: d ? num(d.Tier) : 0,
    duplicate: false, // остаточне значення — у пост-проході дублів buildPointTypesMatrix
  }
}

export function buildPointTypesMatrix(doc: unknown, extraTiers = 0): PointTypesMatrix {
  const { types, categories: rawCats, kinds: rawKinds } = shapeOf(doc)
  const categories = axisEntries(rawCats)
  const kinds = axisEntries(rawKinds)
  const catIds = new Set(categories.map((c) => c.id))
  const kindIds = new Set(kinds.map((k) => k.id))

  const entries = types.map((raw, i) => entryOf(raw, i))

  // Пост-прохід дублів: точний == (дзеркало Validate :306-308), позначаються ВСІ входження
  const idCount = new Map<string, number>()
  for (const e of entries) {
    if (e.id !== '') idCount.set(e.id, (idCount.get(e.id) ?? 0) + 1)
  }
  for (const e of entries) {
    e.duplicate = e.id !== '' && (idCount.get(e.id) ?? 0) > 1
  }

  const cells = new Map<string, MatrixEntry[]>()
  const outside: OutsideEntry[] = []
  const inMatrixTiers: number[] = []

  for (const e of entries) {
    const raw = types[e.index]
    const reasons: string[] = []
    if (!recOf(raw)) {
      reasons.push('запис не є обʼєктом — видаліть його позиційно')
    } else {
      if (e.id === '') {
        reasons.push('порожній Id (аварія Validate :301-304) — правка за Id неможлива, лише позиційне видалення')
      }
      if (e.category === '' || !catIds.has(e.category)) {
        reasons.push(`категорії '${e.category}' немає в осі Categories`)
      }
      if (e.kind === '' || !kindIds.has(e.kind)) {
        reasons.push(`виду '${e.kind}' немає в осі Kinds`)
      }
      if (!Number.isInteger(e.tier) || e.tier < 0 || e.tier > 10) {
        reasons.push(`Tier ${e.tier} поза межами [0..10] (аварія Validate :311-312)`)
      }
    }
    if (reasons.length > 0) {
      outside.push({ entry: e, reasons })
      continue
    }
    inMatrixTiers.push(e.tier)
    const key = cellKey(e.category, e.kind, e.tier)
    const cell = cells.get(key)
    if (cell) cell.push(e)
    else cells.set(key, [e])
  }

  // Колонки тірів — рішення задокументоване в шапці модуля
  const maxObserved = inMatrixTiers.length > 0 ? Math.max(...inMatrixTiers) : 0
  const minObserved = inMatrixTiers.length > 0 ? Math.min(...inMatrixTiers) : 1
  const from = Math.min(1, minObserved)
  const to = Math.min(10, Math.max(3, maxObserved) + Math.max(0, extraTiers))
  const tiers: number[] = []
  for (let t = from; t <= to; t++) tiers.push(t)

  // Дублі Id осей (ревью T2, minor 3) — рахуються по СИРИХ масивах (axisEntries близнюків
  // уже викинув), точний ==, як і скрізь у PointTypes.
  const axisDuplicates: PointTypesMatrix['axisDuplicates'] = []
  for (const [axis, raw] of [['Categories', rawCats], ['Kinds', rawKinds]] as const) {
    const count = new Map<string, number>()
    for (const v of raw) {
      const d = recOf(v)
      if (!d) continue
      const id = str(d.Id)
      if (id === '') continue
      count.set(id, (count.get(id) ?? 0) + 1)
    }
    for (const [id, n] of count) {
      if (n > 1) axisDuplicates.push({ axis, id, count: n })
    }
  }

  return { categories, kinds, tiers, cells, outside, entries, axisDuplicates }
}

// Id нового типу з позиції клітинки: шаблон `<cat>_<kind>_t<N>` (конвенція стенду —
// bio_field_t1 ... combat_lab_t3), прогнаний через uniqueId (io/ruleFileUtils: кейс-
// інсенситивне «base, base_2, ...») проти ВСІХ наявних Id файлу — createPointType однаково
// відмовив би на кейс-варіанті, тож генератор не сміє його пропонувати.
export function suggestPointTypeId(doc: unknown, catId: string, kindId: string, tier: number): string {
  const { types } = shapeOf(doc)
  const taken = new Set<string>()
  for (const raw of types) {
    const d = recOf(raw)
    const id = d ? str(d.Id) : ''
    if (id !== '') taken.add(id.toLowerCase())
  }
  return uniqueId(`${catId}_${kindId}_t${tier}`, taken)
}

// Назва нового типу з Name осей (порожній Name — сирий Id, той самий фолбек, що
// DimensionName :237-245). Непорожня назва ОБОВ'ЯЗКОВА: тип без Name — alarm Validate
// :309-310, який одразу закрив би гейт збереження щойно створеного запису.
export function suggestPointTypeName(cat: { id: string; name: string }, kind: { id: string; name: string }, tier: number): string {
  const catLabel = cat.name !== '' ? cat.name : cat.id
  const kindLabel = kind.name !== '' ? kind.name : kind.id
  return `${catLabel} — ${kindLabel}, тір ${tier}`
}

// Колір для нового запису клітинки: перший непорожній Color серед записів ТІЄЇ САМОЇ
// категорії (точний ==, порядок файлу). «Колір константний по категорії» — факт ДАНИХ
// стенду (бриф/розвідка W4), не серверне правило, тому це лише підказка передзаповнення,
// яку адмін вільно міняє в панелі.
export function categoryColor(doc: unknown, catId: string): string {
  const { types } = shapeOf(doc)
  for (const raw of types) {
    const d = recOf(raw)
    if (!d) continue
    if (str(d.Category) === catId && str(d.Color) !== '') return str(d.Color)
  }
  return ''
}

export interface MatrixSelection {
  index: number
  id: string
}

// Вибір зберігається парою {index, id}: індекс потрібен позиційному ремонту близнюків
// (deletePointTypeAt), а Id — страховка від застарілого індексу (переімпорт проєкту з
// іншим PointTypes.json, видалення сусіда). Розбіжність index<->Id — вибір мертвий (null),
// панель мовчки закривається замість показу ЧУЖОГО запису (урок внутрішньоігрового
// редактора 2026-08-05, дефект 3: «виділення номером рядка їхало на сусідній запис»).
export function resolveMatrixSelection(matrix: PointTypesMatrix, sel: MatrixSelection | null): MatrixEntry | null {
  if (!sel) return null
  const entry = matrix.entries[sel.index]
  if (!entry || entry.id !== sel.id) return null
  return entry
}

// Пересування вибору після позиційного deletePointTypeAt: видалення зсуває всі індекси
// праворуч від видаленого на -1, вибір самого видаленого гасне (викликач далі може
// перевибрати вцілілого близнюка за Id, якщо хоче).
export function adjustSelectionAfterDelete(sel: MatrixSelection | null, deletedIndex: number): MatrixSelection | null {
  if (!sel) return null
  if (sel.index === deletedIndex) return null
  if (sel.index > deletedIndex) return { index: sel.index - 1, id: sel.id }
  return sel
}
