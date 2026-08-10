// Чиста модель вкладки «Баланс» (W4 Task 5) — БЕЗ React і БЕЗ мутаторів: вкладка суворо
// read-only (правка чисел живе у своїх панелях, дубль-редактор був би дрейфом). Модуль ui/,
// але чистий — той самий статус, що pointTypesMatrix.ts/dataItemRows.ts/treeProblems.ts,
// тестується в environment='node' (tests/balanceView.test.ts, TDD: тести написані ПЕРЕД
// цим файлом).
//
// Компонент-рендерер живе в ui/BalanceTab.tsx, а НЕ в «BalanceView.tsx»: на Windows імена
// файлів кейс-інсенситивні, і пара balanceView.ts / BalanceView.tsx дала б TS1261 (та сама
// пастка, через яку модель полотна дерева зветься treeLayout.ts, а не treeCanvas.ts).
//
// Формулювання власника (HANDOFF §139-140, у перекладі): «Баланс — таблиця „що скільки дає":
// заготовки × типи балів, вартість вузлів проти видобутку. Зараз не видно ніде.» Три секції
// нижче — рівно ці дві половини плюс місток між ними (чим саме заготовка виробляється).
//
// ---- ДЗЕРКАЛА СЕРВЕРА (усі перечитані по джерелах перед написанням, нічого не вгадано) ----
//
//  1) ZP_DataItemsConfig.Find (:52-69) — пошук заготовки КЕЙС-ІНСЕНСИТИВНИЙ і пропускає
//     `!d.Enabled`: вимкнена заготовка для сервера НЕ ІСНУЄ (у грі показує запасну назву,
//     здати її не можна). Тому вимкнений рядок матриці не додає нічого в підсумок.
//  2) ZP_DataItemsConfig.Validate (:105-137) — реверсний прохід, last-wins: із дублів Id
//     виживає ОСТАННІЙ. Модель бере ОСТАННІЙ (через findDataItemEntry, єдине джерело цієї
//     семантики) і позначає рядок дублем.
//  3) ZP_DataItemsConfig.CountGrantable (:144-153) — нарахування ПРОПУСКАЄ запис із порожнім
//     типом, `Amount <= 0` і тип, якого немає в PointTypes. «Написано 0 балів» у грі означає
//     «нічого», а не «нуль балів у пулі» — клітинка це показує окремим прапорцем.
//  4) ZP_PointTypesConfig.Find (:317-325) — `pt.Id == id` ТОЧНИМ ==, БЕЗ ToLower (єдиний Find
//     серед восьми конфігів без нормалізації регістру). 'BIO_FIELD_T1' для сервера — інший
//     тип, ніж 'bio_field_t1', і бали за нього не нараховуються взагалі.
//  5) ZP_ActionDeposit.CanDeposit (:29-30) — здати можна ЛИШЕ предмет родини ZP_Data_Base
//     (`GetGame().IsKindOf(item.GetType(), "ZP_Data_Base")`), тобто «видобутком» вважається
//     лише вихід цієї родини, а не будь-який вихід правила.
//  6) ZP_ConfigService.TerminalsFor (:1553-1561) — свої TerminalClasses; якщо своїх немає, а
//     ХОЧ ХТОСЬ їх оголосив — жодного (m_NoTerminals); інакше спільний Settings.
//     TreeTerminalClasses. Фракція без терміналу не може здати НІЧОГО, тобто її дерево
//     недосяжне незалежно від виробництва — це найтихіша з можливих дірок балансу.
//  7) ZP_ConfigService.DevicesFor/IsDeviceFor (:1566-1588) — та сама логіка для приладів,
//     з однією відмінністю: «поділу немає» повертає null, тобто прилад доступний УСІМ.
//  8) ZP_Processing.FindStartableCore (:126-143) — правило працює, лише якщо Enabled, його
//     Device збігається (MatchClass) і RequiredFactions або порожні, або містять фракцію
//     (порівняння `array<string>.Find` — ТОЧНЕ, регістрозалежне).
//  9) ZP_TechTree.NodeBelongsTo (:92-104) — вузол належить фракції, якщо Branch.Factions
//     порожні або містять її І node.RequiredFactions порожні або містять її (обидва Find
//     точні). Гілка без Factions належить УСІМ — не «нікому».
//
// ---- ДВІ АПРОКСИМАЦІЇ, ЯКІ НЕ МОЖНА ЗРОБИТИ ТОЧНІШЕ З КОНФІГІВ (свідомо, у звіті теж) ----
//
//  A) IsDeviceFor на сервері приймає клас ФІЗИЧНОГО приладу у світі, а редактор має лише
//     рядок ZP_Rule.Device — сам по собі теж ШАБЛОН (може бути базовим класом або нести
//     «|N»). Модель порівнює шаблон правила з шаблоном фракції тим самим MatchClass. Розбіг
//     можливий лише в екзотиці «правило написане на базовий клас, фракція володіє нащадком»:
//     тоді в грі фракція запустить правило на своєму приладі, а модель цього не побачить.
//     Протилежної помилки (показати видобуток там, де його немає) ця апроксимація не робить —
//     вона консервативна.
//  B) RequiredNode правила — стан ФРАКЦІЇ (CompletedNodes у FactionData/*.json), а це живий
//     стан сервера, який редактор навмисно не читає (kind='foreign'). Тому такий шлях
//     видобутку позначається 'gated' — «буде, коли вузол досліджено», а не 'ok'.
//
// ---- ФІКС-РАУНД РЕВʼЮ (Critical 1): ДВА ЗАВАНТАЖУВАЛЬНІ ЗРІЗИ ПОВЕРХ ВОСЬМИ ДЗЕРКАЛ -------
//
// Перша редакція брала виробників із buildChainGraph (він за задумом тримає ВСІ правила з
// Id — це граф ПОЛОТНА, де адмін мусить бачити й зламане) і гейтила видобуток лише по
// Enabled/Device/RequiredFactions. Сервер відкидає БІЛЬШЕ, і обидва зрізи вже мають у репо
// свої перевірені дзеркала — тут вони лише СКОМПОНОВАНІ, без третьої копії:
//
//  10) ZP_ProcessingConfig.ValidateRule (:262-350) через model/ruleValidation.validateRule:
//      правило з будь-якою 'alarm'-помилкою на сервер НЕ потрапляє взагалі (AddFileRules
//      :249-254 — Warn+continue). ПОРЯДОК завантажувача відтворено точно: тиха заміна
//      нульового BasePurityMax на 0.5 (:232-237) йде ДО ValidateRule, інакше правило, яке
//      сервер приймає, отримало б хибну тривогу.
//  11) ZP_DataItemsConfig.ValidateItem (:78-89) через ui/dataItemRows.dataItemCutProblems:
//      запис із порожнім Name / чужим класом / не-родиною Validate ВИДАЛЯЄ з масиву
//      (:105-137), тож Find його не знайде, CanDeposit поверне false, і бали за нього не
//      нарахуються НІКОЛИ — ні в підсумку матриці, ні в видобутку фракції.
//
// МЕЖА ЦЬОГО ЗРІЗУ (заведена контрольним ревʼю фікс-раунду як N2, ПЕРЕПИСАНА закривною
// хвилею W4 — фінальне ревʼю гілки, Important 1): раніше тут стояв перелік із пʼяти форм,
// які сервер відкидає, а зріз лишав «живими» (Output.Chance, Output.Quantity,
// InputItem.Quantity, Content на не-зразковому вході, зразок на виході без Content).
// ПЕРЕЛІК БІЛЬШЕ НЕ ПОТРІБЕН: дзеркало ValidateRule стало ПОВНИМ — усі пʼять і ще чотири
// (порожній елемент RequiredWorn/RequiredTools, порожній Consumables[].Classname, порожній
// InputItem.Classname, межі Consumable.Quantity) закриті в model/ruleValidation.ts суцільним
// проходом ValidateRule зверху вниз. Що лишається межею СВІДОМО — перелічено в шапці
// ruleValidation.ts (клас поза локальним ClassIndex -> warn; порожній Device/Output, які
// сервер приймає; дослівне порівняння з "" без trim; дубль Id як hardErr рівня файлу).
// Ще одна відома апроксимація того ж роду: N1 — дубль Id заготовки, де ВИЖИВШИЙ (останній)
// близнюк невалідний: сервер тоді ріже саме його і бали дає РАННІЙ, а findDataItemEntry
// завжди бере останній -> тут хибне «немає» (адреса — W7). N4 закрито нижче (Consumables
// у транзитивності).
//
// Мертвий виробник при цьому НЕ ХОВАЄТЬСЯ (пряма вимога ревʼю): рядок ланцюга показує його
// з бейджем і причиною, а рядок вартості пише в reasons, ЧОМУ видобутку немає. Порожнеча
// без пояснення була б гіршою порадою, ніж хибне зелене.

import type { Project } from '../io/project'
import type { ClassIndex } from '../model/classIndex'
import { displayNameOf, isKindOf, stripExact } from '../model/classIndex'
import { buildChainGraph, matchClassMirror, matchInputMirror, asRuleLike } from '../model/chainGraph'
import type { RuleLike } from '../model/chainGraph'
import { resolveDataItemFace } from '../model/faceResolve'
import { isSampleClass } from '../model/sampleContent'
import { buildTreeView } from '../model/treeView'
import type { TreeNodeView, TreeViewResult } from '../model/treeView'
import { resolveStationItemDisplay, buildRuleValidationInput } from '../model/stationView'
import { validateRule } from '../model/ruleValidation'
import { dataItemCutProblems } from './dataItemRows'
import type { RowTone } from './factionRows'

// ---- Секція (а): «Що скільки дає» ------------------------------------------------------------

export interface BalanceColumn {
  id: string
  name: string
  color: string
  sortOrder: number
}

export interface BalanceCell {
  amount: number
  // Чи сервер СПРАВДІ нарахує ці бали при здачі: заготовка увімкнена, тип відомий (точний ==)
  // і Amount > 0 (CountGrantable :144-153). Число саме по собі нічого не гарантує.
  grantable: boolean
}

export interface BalanceItemRow {
  classname: string
  name: string
  enabled: boolean
  duplicate: boolean
  // Причини, з яких сервер ВИКИНЕ цей запис при завантаженні (дзеркало 11 у шапці). Непорожній
  // масив означає, що заготовки в грі немає взагалі: жодна її клітинка не grantable, у підсумок
  // колонки вона не входить, видобутком фракції не рахується.
  cut: string[]
  // ключ — id колонки (типу балів); лише ВІДОМІ типи
  cells: Map<string, BalanceCell>
  // Типи, яких немає в PointTypes (точний ==) — бали за них не нараховуються НІКОЛИ
  unknown: { type: string; amount: number }[]
  tone: RowTone
  notes: string[]
}

export interface BalanceMatrix {
  // Лише типи, які хоч хтось дає — інакше 24 переважно порожні колонки стенда ховали б дані
  columns: BalanceColumn[]
  rows: BalanceItemRow[]
  // Сума по колонці серед УВІМКНЕНИХ заготовок (те, що фактично прийде в пул за одну здачу)
  totals: Map<string, number>
  // Типи балів, яких не дає жодна увімкнена заготовка (перелік, не мертві колонки)
  idle: BalanceColumn[]
  hasUnknown: boolean
}

// ---- Секція (б): «Ланцюги до заготовок» ------------------------------------------------------

export interface BalanceProducer {
  ruleId: string
  filePath: string
  disabled: boolean
  // Правило НЕ дасть виходу НІКОЛИ, хай навіть Enabled: або сервер відкине його при
  // завантаженні (ValidateRule, дзеркало 10 у шапці), або воно завантажиться, але не
  // стартує ні на чому (порожній Device — MatchClass по порожньому шаблоні завжди false,
  // доведено зондом, дивись validateDeviceRequired у ruleValidation.ts). Для економіки це
  // те саме «виходу не буде», тому один прапорець на обидва випадки; точну причину несе
  // deadReasons.
  dead: boolean
  deadReasons: string[]
  device: string
  deviceDisplay: string
  inputClassname: string
  inputContent: string
  inputDisplay: string
  requiredNode: string
  requiredFactions: string[]
}

export interface BalanceChainRow {
  classname: string
  name: string
  // Є запис у DataItems.json (хай навіть вимкнений). false — правило виробляє клас, про який
  // конфіг мовчить: у грі це предмет із запасною назвою, який нікуди не здається.
  configured: boolean
  enabled: boolean
  producers: BalanceProducer[]
  tone: RowTone
  notes: string[]
}

// ---- Секція (в): «Вартість дерева проти видобутку» -------------------------------------------

export interface BalanceYieldPath {
  pointType: string
  amount: number
  dataItem: string
  dataItemName: string
  ruleId: string
  filePath: string
  device: string
  deviceDisplay: string
  // Непорожній — правило під гейтом дерева: видобуток відкриється лише після дослідження
  requiredNode: string
  // Вхід правила — зразок родини ZP_Sample_Base, тобто ланка ланцюга, а не сировина світу
  chainInput: boolean
  // ...і його пакує ІНШЕ правило на приладі ЦІЄЇ Ж фракції (інакше зразок треба звідкись брати).
  // ТРАНЗИТИВНО (фікс-раунд ревʼю, Important 2): пакувальник, чий власний вхід — теж зразок,
  // рахується постачальником, лише якщо його самого хтось годує; замкнене коло («правило пакує
  // те, що саме ж і споживає») постачальником НЕ вважається.
  selfFed: boolean
  // Вузли дерева, які треба дослідити, щоб ЛАНЦЮГ ПОСТАЧАННЯ цього входу запрацював — тобто
  // RequiredNode попередніх ланок (власний гейт правила лишається в requiredNode вище).
  // Непорожній масив робить шлях 'gated' навіть тоді, коли саме це правило гейта не має:
  // фракція не вироблятиме заготовку, доки не відкриє пакувальника (емпірика ревʼю).
  feedGates: string[]
}

export type BalanceCostStatus = 'ok' | 'gated' | 'missing'

// Вузол, який вимагає цей тип балів — адреса переходу на вкладку «Дерево» (той самий контракт
// filePath+nodeId, яким уже користується панель проблем дерева).
export interface BalanceNodeRef {
  filePath: string
  nodeId: string
  label: string
  amount: number
}

export interface BalanceCostRow {
  pointType: string
  typeName: string
  color: string
  // Тип є в PointTypes.json (точний ==). НА ПРАКТИЦІ тут завжди true, і це не випадковість:
  // вузол із невідомим типом балів сервер відхиляє ЦІЛКОМ (ValidateNode :168-170), тож він не
  // `loaded` і в суму не потрапляє взагалі (tests/balanceView.test.ts фіксує саме це). Поле
  // лишається захистом від екзотики «PointType із порожнім Id + Cost.Type=""», де дзеркало
  // treeView визнало б тип відомим, а реєстр колонок (порожні Id пропускає) — ні.
  known: boolean
  // Сума Cost.Amount по ВСІХ завантажуваних вузлах фракції
  total: number
  nodeCount: number
  // Ті самі вузли поіменно — щоб адмін бачив, ЗА ЩО саме платить (і міг перейти на полотно)
  nodes: BalanceNodeRef[]
  paths: BalanceYieldPath[]
  status: BalanceCostStatus
  reasons: string[]
}

export interface BalanceSurplusRow {
  pointType: string
  typeName: string
  color: string
  paths: BalanceYieldPath[]
  // Фікс-раунд ревʼю, Important 3: чи фракція взагалі має куди здати заготовку (TerminalsFor
  // :1553-1561). false означає, що «надлишок» до пулу не дійде — рядки вартості тієї самої
  // фракції кажуть рівно це, і половини блоку більше не суперечать одна одній.
  canDeposit: boolean
}

export interface BalanceItemCostRow {
  classname: string
  display: string
  quantity: number
  nodeCount: number
}

export interface BalanceBranchRef {
  branchId: string
  label: string
  filePath: string
}

export interface BalanceFactionRow {
  id: string
  displayName: string
  // 'own' — свої DeviceClasses; 'none' — своїх немає, але поділ уже почався (жодного приладу);
  // 'all' — поділу немає взагалі, прилади доступні всім (DevicesFor -> null)
  deviceMode: 'own' | 'none' | 'all'
  devices: string[]
  // 'own' — свої термінали; 'shared' — спільні з Settings; 'none' — здати нема куди
  depositMode: 'own' | 'shared' | 'none'
  terminals: string[]
  canDeposit: boolean
  branches: BalanceBranchRef[]
  nodeCount: number
  // Вузли фракції, які сервер НЕ завантажить (ValidateNode/дубль/бита гілка) — їхня вартість
  // у суму не входить: платити за те, чого в грі немає, не доведеться
  skippedNodes: number
  costs: BalanceCostRow[]
  surplus: BalanceSurplusRow[]
  itemCosts: BalanceItemCostRow[]
  tone: RowTone
  notes: string[]
}

export interface BalanceView {
  matrix: BalanceMatrix
  chains: BalanceChainRow[]
  factions: BalanceFactionRow[]
  // Примітки рівня проєкту (відсутні файли, записи без Id, гілки чужих фракцій)
  notes: string[]
}

// ---- дрібні читачі документів ----------------------------------------------------------------

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

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function docOf(project: Project, kind: string): Rec | undefined {
  const file = project.files.find((f) => f.kind === kind)
  return recOf(file?.parsed)
}

// Реєстр типів балів: перший збіг Id виграє (дзеркало Find :317-325 — вона теж повертає
// ПЕРШИЙ), ключ ТОЧНИЙ (без ToLower).
function collectPointTypes(project: Project): Map<string, BalanceColumn> {
  const out = new Map<string, BalanceColumn>()
  const doc = docOf(project, 'pointTypes')
  const list = doc && Array.isArray(doc.PointTypes) ? doc.PointTypes : []
  list.forEach((raw, i) => {
    const pt = recOf(raw)
    if (!pt) return
    const id = str(pt.Id)
    if (id === '' || out.has(id)) return
    const name = str(pt.Name)
    out.set(id, { id, name: name !== '' ? name : id, color: str(pt.Color), sortOrder: num(pt.SortOrder) === 0 ? i + 1 : num(pt.SortOrder) })
  })
  return out
}

function bySortOrder(a: BalanceColumn, b: BalanceColumn): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
  return a.id.localeCompare(b.id)
}

// ---- (а) матриця ------------------------------------------------------------------------------

interface MatrixBuild {
  matrix: BalanceMatrix
  notes: string[]
  // Класи рядків у порядку матриці — вхід секції (б)
  order: string[]
}

function buildMatrix(project: Project, index: ClassIndex, types: Map<string, BalanceColumn>): MatrixBuild {
  const notes: string[] = []
  const doc = docOf(project, 'dataItems')
  const items = doc && Array.isArray(doc.Items) ? doc.Items : []

  // Виживають ОСТАННІ записи кожного Id (кейс-інсенситивно) — дзеркало реверсного Validate
  // (:105-137). Порядок рядків = порядок ВИЖИВЛИХ записів у файлі (RemoveOrdered прибирає
  // ранні, позиція пізнього не зсувається відносно решти).
  const lastIndexById = new Map<string, number>()
  let noId = 0
  items.forEach((raw, i) => {
    const d = recOf(raw)
    const id = d ? str(d.Id) : ''
    if (id === '') {
      noId++
      return
    }
    lastIndexById.set(id.toLowerCase(), i)
  })
  if (noId > 0) {
    notes.push(`У DataItems.json є ${noId} запис(ів) без Id — сервер викине їх при завантаженні (ValidateItem :80-81); подробиці на вкладці «Заготовки».`)
  }

  const survivors = [...lastIndexById.entries()].sort((a, b) => a[1] - b[1])

  const rows: BalanceItemRow[] = []
  const usedTypes = new Set<string>()
  const totals = new Map<string, number>()
  let hasUnknown = false

  for (const [, idxInFile] of survivors) {
    const entry = recOf(items[idxInFile])!
    const classname = str(entry.Id)
    const face = resolveDataItemFace(project, index, classname)
    const cells = new Map<string, BalanceCell>()
    const unknown: { type: string; amount: number }[] = []
    const rowNotes: string[] = []
    let alarm = false
    let warn = false

    // Зріз завантажувача (дзеркало 11): 'alarm' — сервер ТОЧНО викине запис, 'warn' — викине,
    // якщо класу справді немає в грі (офлайн-індекс редактора ≠ жива гра). Суми й видобуток
    // гейтить лише 'alarm': інакше кожен клас чужого мода, відсутнього на цій машині, зникав
    // би з балансу мовчки.
    const cutProblems = dataItemCutProblems(project, index, classname)
    const cut = cutProblems.filter((p) => p.severity === 'alarm').map((p) => p.message)
    for (const p of cutProblems) {
      rowNotes.push(p.message)
      if (p.severity === 'alarm') alarm = true
      else warn = true
    }
    if (face.duplicate) {
      alarm = true
      rowNotes.push('дубль Id — виживе лише ОСТАННІЙ запис (реверсний Validate :111-130), решту сервер видалить')
    }
    if (!face.enabled) {
      warn = true
      rowNotes.push('запис вимкнений — сервер його не бачить (Find пропускає !Enabled), здати заготовку не можна')
    }

    let emptyTypes = 0
    for (const p of face.points) {
      if (p.Type === '') {
        emptyTypes++
        continue
      }
      if (!types.has(p.Type)) {
        unknown.push({ type: p.Type, amount: p.Amount })
        hasUnknown = true
        alarm = true
        continue
      }
      usedTypes.add(p.Type)
      // Колонка існує — отже й підсумок існує (нехай нульовий): «0» у підвалі читається як
      // «цей тип оголошено, але в пул нічого не прийде», а порожнє місце — як «даних немає».
      if (!totals.has(p.Type)) totals.set(p.Type, 0)
      const prev = cells.get(p.Type)
      const amount = (prev ? prev.amount : 0) + p.Amount
      // grantable рахується по ПІДСУМКУ типу, а не по окремому запису: сервер нарахує кожен
      // валідний запис окремо, тож підсумок > 0 і є тим, що прийде в пул.
      cells.set(p.Type, { amount, grantable: face.enabled && amount > 0 && cut.length === 0 })
      if (prev) rowNotes.push(`тип '${p.Type}' указано двічі — сервер нарахує обидва записи, у клітинці сума`)
    }
    if (emptyTypes > 0) {
      warn = true
      rowNotes.push(`${emptyTypes} запис(ів) балів без типу — сервер їх пропустить (CountGrantable :148)`)
    }
    for (const [type, cell] of cells) {
      if (!cell.grantable) {
        warn = true
        if (cell.amount <= 0) rowNotes.push(`'${type}': Amount ${cell.amount} — сервер НЕ нарахує нічого (CountGrantable :148)`)
      } else {
        totals.set(type, (totals.get(type) ?? 0) + cell.amount)
      }
    }
    if (face.points.length === 0) {
      warn = true
      rowNotes.push('жодного типу балів — заготовка не здається (CanDeposit вимагає CountGrantable > 0)')
    }

    rows.push({
      classname,
      name: face.name,
      enabled: face.enabled,
      duplicate: face.duplicate,
      cut,
      cells,
      unknown,
      tone: alarm ? 'alarm' : warn ? 'warn' : 'ok',
      notes: rowNotes,
    })
  }

  const columns = [...usedTypes].map((id) => types.get(id)!).sort(bySortOrder)
  // Фікс-раунд ревʼю (minor 6): «не дає ніхто» = ЖОДНА заготовка не згадує цей тип, а не
  // «підсумок нульовий». Інакше тип, який дає лише ВИМКНЕНА (чи зрізана) заготовка, стояв би
  // одночасно колонкою з нульовим підсумком І в переліку — один факт у двох регістрах, з яких
  // читач мусив би сам здогадатись, що це той самий тип. Тепер набори не перетинаються:
  // колонка з мертвою клітинкою каже «згадують, але не дають», перелік — «не згадує ніхто».
  const idle = [...types.values()].filter((c) => !usedTypes.has(c.id)).sort(bySortOrder)

  return { matrix: { columns, rows, totals, idle, hasUnknown }, notes, order: rows.map((r) => r.classname) }
}

// ---- Сирі правила проєкту (єдиний прохід, спільний для секцій «б» і «в») ----------------------
// Джерело — buildChainGraph (chainGraph.ts): він уже дає правила у ТОМУ САМОМУ порядку
// (файл-пріоритет -> порядок у файлі), що бачить адмін на полотні ланцюгів, уже відкидає
// правила без Id (сервер їх теж пропускає, AddFileRules :216-220) і вже несе прапорець
// disabled. buildStationView поверх нього НЕ використовується як джерело правил навмисно:
// StationInputRow не несе RequiredFactions/RequiredNode, а саме вони вирішують питання
// «чия це фабрика» — відновлювати їх позиційним зіставленням рядків станків із графом було б
// крихко (дублікати Id у різних файлах). Ігрові імена приладів/предметів беруться тими самими
// хелперами, що й станки (displayNameOf/resolveStationItemDisplay) — без другої копії резолву.

interface RuleFact {
  ruleId: string
  filePath: string
  disabled: boolean
  dead: boolean
  deadReasons: string[]
  device: string
  deviceDisplay: string
  input: { classname: string; content: string; display: string; isSample: boolean }
  // Витратники-ЗРАЗКИ (контрольне ревʼю фікс-раунду, N4): FindStartableCore вимагає їх у
  // карго нарівні з входом (ZP_Processing.c), тож витратник-зразок, якого ніхто не пакує,
  // так само зупиняє правило, як і непостачений вхід. Не-зразкові витратники сюди не йдуть:
  // це сировина світу, її наявність баланс не моделює (та сама межа, що для InputItem).
  sampleConsumables: { classname: string; content: string }[]
  outputs: { classname: string; content: string }[]
  requiredNode: string
  requiredFactions: string[]
}

function collectRuleFacts(project: Project, index: ClassIndex): RuleFact[] {
  const graph = buildChainGraph(project, index)
  const out: RuleFact[] = []
  for (const n of graph.nodes) {
    const rule = asRuleLike(n.rule)
    if (!rule) continue
    const raw = n.rule as Rec
    const device = stripExact(rule.Device).trim()
    const inputCls = stripExact(rule.InputItem.Classname).trim()
    const inputFace = resolveStationItemDisplay(project, index, rule.InputItem.Classname)
    // Дзеркало 10 (шапка): ValidateRule через СПІЛЬНИЙ збирач входу (model/stationView.ts) —
    // рівно те, що вже перевіряє вікно станка. Порядок завантажувача (AddFileRules :232-237
    // ГУЧНО замінює нульовий BasePurityMax типовим 0.5 ДО виклику ValidateRule, тож правило з
    // BasePurityMax=0 сервер приймає) з закривної хвилі W4 відтворює САМЕ ДЗЕРКАЛО
    // (validateBasePurityLoaderDefault, ruleValidation.ts) — раніше це робив ручний префікс
    // ТУТ, і про підміну знав лише цей викликач із трьох. Префікс лишено як ДРУГИЙ ПОЯС:
    // він нормалізує вхід ще до валідації, а не лише гасить її тривогу, тож жоден майбутній
    // споживач vinput (наприклад, друк «яка чистота піде в гру») не побачить нуля.
    const vinput = buildRuleValidationInput(rule, raw)
    if (vinput.BasePurityMax <= 0) {
      vinput.BasePurityMin = 0.5
      vinput.BasePurityMax = 0.5
    }
    const deadReasons = validateRule(vinput, index)
      .filter((e) => e.severity === 'alarm')
      .map((e) => e.message)
    out.push({
      ruleId: rule.Id,
      filePath: n.filePath,
      disabled: n.disabled,
      dead: deadReasons.length > 0,
      deadReasons,
      device,
      deviceDisplay: device !== '' ? displayNameOf(index, device) : '',
      input: {
        classname: rule.InputItem.Classname,
        content: rule.InputItem.Content,
        display: inputFace.display,
        isSample: inputCls !== '' && isSampleClass(index, inputCls),
      },
      sampleConsumables: (Array.isArray(raw.Consumables) ? raw.Consumables : [])
        .map((c) => (c && typeof c === 'object' && !Array.isArray(c) ? (c as Rec) : undefined))
        .filter((c): c is Rec => c !== undefined)
        .map((c) => ({ classname: str(c.Classname), content: str(c.Content) }))
        .filter((c) => {
          const base = stripExact(c.classname).trim()
          return base !== '' && isSampleClass(index, base)
        }),
      outputs: (rule as RuleLike).Outputs.map((o) => ({ classname: o.Classname, content: o.Content })),
      requiredNode: str(raw.RequiredNode),
      requiredFactions: strArr(raw.RequiredFactions),
    })
  }
  return out
}

// ---- (б) ланцюги до заготовок -----------------------------------------------------------------

function buildChains(project: Project, index: ClassIndex, matrix: BalanceMatrix, facts: RuleFact[]): BalanceChainRow[] {
  const producersByClass = new Map<string, BalanceProducer[]>()
  for (const f of facts) {
    for (const o of f.outputs) {
      const cls = stripExact(o.classname).trim()
      if (cls === '') continue
      const key = cls.toLowerCase()
      const list = producersByClass.get(key) ?? []
      list.push({
        ruleId: f.ruleId,
        filePath: f.filePath,
        disabled: f.disabled,
        dead: f.dead,
        deadReasons: f.deadReasons,
        device: f.device,
        deviceDisplay: f.deviceDisplay,
        inputClassname: f.input.classname,
        inputContent: f.input.content,
        inputDisplay: f.input.display,
        requiredNode: f.requiredNode,
        requiredFactions: f.requiredFactions,
      })
      producersByClass.set(key, list)
    }
  }

  const rows: BalanceChainRow[] = []
  const seen = new Set<string>()

  // cut — причини зрізу запису DataItems (порожній масив = запис живий). Заготовка, яку сервер
  // викине, не здається взагалі, тому рядок аварійний НЕЗАЛЕЖНО від того, скільки в неї
  // виробників: правило справно виробить предмет, за який гравцеві не дадуть нічого.
  function toneOf(producers: BalanceProducer[], configured: boolean, cut: string[]): { tone: RowTone; notes: string[] } {
    const notes: string[] = []
    if (!configured) {
      notes.push('немає запису в DataItems.json — у грі це предмет із запасною назвою, який нікуди не здається')
      return { tone: 'alarm', notes }
    }
    if (cut.length > 0) {
      notes.push(...cut)
      return { tone: 'alarm', notes }
    }
    if (producers.length === 0) {
      notes.push('жодне правило не виробляє цю заготовку — здати її гравцям буде нізвідки')
      return { tone: 'warn', notes }
    }
    // Мертве правило (дзеркало 10) відрізняється від вимкненого: вимкнене — свідомий вибір
    // адміна, мертве — помилка конфігу, яку сервер мовчки з'їсть при завантаженні. Тому коли
    // живих виробників не лишилось, тон вирішує саме наявність мертвих.
    const alive = producers.filter((p) => !p.disabled && !p.dead)
    if (alive.length === 0) {
      if (producers.some((p) => p.dead)) {
        notes.push('усі правила-виробники сервер відкине або вони ніколи не стартують — у грі заготовки не буде; причини на самих правилах нижче')
        return { tone: 'alarm', notes }
      }
      notes.push('усі правила-виробники вимкнені — у грі заготовки не буде (FindStartableCore :127-128)')
      return { tone: 'warn', notes }
    }
    return { tone: 'ok', notes }
  }

  for (const row of matrix.rows) {
    const key = row.classname.toLowerCase()
    seen.add(key)
    const producers = producersByClass.get(key) ?? []
    const { tone, notes } = toneOf(producers, true, row.cut)
    rows.push({ classname: row.classname, name: row.name, configured: true, enabled: row.enabled, producers, tone, notes })
  }

  // Виробляється, але не описане: клас родини ZP_Data_Base без запису в конфігу — правило
  // виробляє предмет, за який гравцеві не дадуть нічого. Порядок — за класнеймом (у файлах
  // правил такий вихід може згадуватись у будь-якому місці, стабільність важливіша).
  const extra = [...producersByClass.entries()]
    .filter(([key]) => !seen.has(key))
    .map(([key, producers]) => ({ classname: originalClassCase(index, key), producers }))
    .filter((e) => isKindOf(index, e.classname, 'ZP_Data_Base'))
    .sort((a, b) => a.classname.localeCompare(b.classname))
  for (const e of extra) {
    const face = resolveDataItemFace(project, index, e.classname)
    const { tone, notes } = toneOf(e.producers, false, [])
    rows.push({ classname: e.classname, name: face.name, configured: false, enabled: false, producers: e.producers, tone, notes })
  }

  return rows
}

// Регістр класу «як в індексі» (індекс зберігає ім'я в оригінальному написанні, ключ мапи —
// lower-case; classIndex.ts, коментар про byName). Немає в індексі — повертаємо як є.
function originalClassCase(index: ClassIndex, lowerName: string): string {
  const i = index.byName.get(lowerName)
  return i === undefined ? lowerName : index.classes[i][0]
}

// ---- (в) вартість дерева проти видобутку -------------------------------------------------------

interface FactionDef {
  id: string
  displayName: string
  terminals: string[]
  devices: string[]
}

function collectFactions(project: Project): FactionDef[] {
  const doc = docOf(project, 'factions')
  const list = doc && Array.isArray(doc.Factions) ? doc.Factions : []
  const out: FactionDef[] = []
  for (const raw of list) {
    const f = recOf(raw)
    if (!f) continue
    const id = str(f.Id)
    if (id === '') continue
    const name = str(f.DisplayName)
    out.push({ id, displayName: name !== '' ? name : id, terminals: strArr(f.TerminalClasses), devices: strArr(f.DeviceClasses) })
  }
  return out
}

// Дзеркало NodeBelongsTo (:92-104): Find по масиву — ТОЧНИЙ, регістрозалежний.
function nodeBelongsTo(node: TreeNodeView, branchFactions: string[], factionId: string): boolean {
  if (branchFactions.length > 0 && !branchFactions.includes(factionId)) return false
  if (node.requiredFactions.length > 0 && !node.requiredFactions.includes(factionId)) return false
  return true
}

interface FactionAccess {
  deviceMode: 'own' | 'none' | 'all'
  devices: string[]
  depositMode: 'own' | 'shared' | 'none'
  terminals: string[]
  canDeposit: boolean
}

function accessOf(f: FactionDef, all: FactionDef[], sharedTerminals: string[]): FactionAccess {
  const anyDevices = all.some((x) => x.devices.length > 0)
  const anyTerminals = all.some((x) => x.terminals.length > 0)

  let deviceMode: FactionAccess['deviceMode']
  let devices: string[]
  if (f.devices.length > 0) {
    deviceMode = 'own'
    devices = f.devices
  } else if (anyDevices) {
    deviceMode = 'none'
    devices = []
  } else {
    deviceMode = 'all'
    devices = []
  }

  let depositMode: FactionAccess['depositMode']
  let terminals: string[]
  if (f.terminals.length > 0) {
    depositMode = 'own'
    terminals = f.terminals
  } else if (anyTerminals) {
    depositMode = 'none'
    terminals = []
  } else {
    terminals = sharedTerminals
    depositMode = sharedTerminals.length > 0 ? 'shared' : 'none'
  }

  // Порожній рядок у переліку рахується оголошенням (сервер міряє Count()), але MatchClass на
  // порожньому шаблоні завжди false (:135-137) — тобто «оголосив, а користуватись нічим».
  const canDeposit = terminals.some((t) => stripExact(t).trim() !== '')

  return { deviceMode, devices, depositMode, terminals, canDeposit }
}

function factionCanUseDevice(access: FactionAccess, deviceClass: string, index: ClassIndex): boolean {
  if (access.deviceMode === 'all') return true
  if (access.deviceMode === 'none') return false
  return access.devices.some((d) => matchClassMirror(deviceClass, d, index))
}

// «Правило НАЛЕЖИТЬ фракції»: свій прилад + RequiredFactions (FindStartableCore :132-143).
// БЕЗ перевірок живучості — саме на цій множині рахуються і шляхи видобутку, і ПОЯСНЕННЯ,
// чому шляху немає: вимкнене чи мертве правило СВОГО приладу адмін мусить побачити як
// причину, а чуже — ні (воно цієї фракції не стосується взагалі).
// RequiredNode тут НЕ гейт — він відкладає видобуток, а не забороняє його (див. апроксимацію B).
function ruleBelongsTo(f: RuleFact, access: FactionAccess, factionId: string, index: ClassIndex): boolean {
  if (f.device === '') return false
  if (!factionCanUseDevice(access, f.device, index)) return false
  if (f.requiredFactions.length > 0 && !f.requiredFactions.includes(factionId)) return false
  return true
}

// Стан ПОСТАЧАННЯ входу правила: чи є ланцюг, що дає цей зразок, і які вузли дерева треба
// дослідити, щоб ланцюг запрацював.
interface SupplyState {
  reachable: boolean
  gates: string[]
}

function addGate(gates: string[], node: string): string[] {
  if (node === '' || gates.includes(node)) return gates
  return [...gates, node]
}

// Фікс-раунд ревʼю, Important 2. Перша редакція питала лише «чи є ІНШЕ доступне правило з
// підходящим виходом», не дивлячись на гейти того правила: пакувальник під RequiredNode
// давав аналізатору зелене «видобувається», хоча фракція не вироблятиме заготовку, доки не
// дослідить вузол. Тут один прохід поширення: гейти постачальника переходять на споживача.
//
// Ітеративний фікспойнт, а не рекурсія з мемо — саме через КОЛА: правило, яке споживає рівно
// той зразок, що й виробляє, рекурсію довелося б спеціально розплутувати, а фікспойнт
// розв'язує це своєю природою (стан вмикається лише від УЖЕ ввімкненого сусіда, тож коло,
// у яке ззовні ніхто не входить, лишається вимкненим). Це й правда гри: станція виключає
// власний свіжий вихід із наступної партії (IsExcluded, ZP_Processing.c:106-118), тож
// самопідживлення не буває.
//
// Серед кількох постачальників виграє НАЙДЕШЕВШИЙ (найменше гейтів) — інакше вільний ланцюг
// поруч із гейтованим давав би «умовно» залежно від порядку правил у файлі.
// N4 (контрольне ревʼю фікс-раунду): вимоги правила — це не лише вхід-зразок, а Й
// витратники-зразки (FindStartableCore шукає їх у карго нарівні з входом). Правило досяжне,
// лише коли постачені ВСІ вимоги; гейти — обʼєднання гейтів найдешевших постачальників по
// кожній вимозі.
function supplyRequirements(f: RuleFact): { classname: string; content: string }[] {
  const reqs: { classname: string; content: string }[] = []
  if (f.input.isSample) reqs.push({ classname: f.input.classname, content: f.input.content })
  reqs.push(...f.sampleConsumables)
  return reqs
}

function computeSupply(available: RuleFact[], index: ClassIndex): SupplyState[] {
  const reqs = available.map(supplyRequirements)
  const state: SupplyState[] = available.map((_, i) => ({ reachable: reqs[i].length === 0, gates: [] }))
  for (let pass = 0; pass <= available.length; pass++) {
    let changed = false
    available.forEach((_, i) => {
      if (reqs[i].length === 0) return
      // Кожна вимога мусить мати постачальника; серед кількох виграє НАЙДЕШЕВШИЙ (менше
      // гейтів). Хоч одна непостачена вимога — правило лишається недосяжним.
      let union: string[] = []
      for (const req of reqs[i]) {
        let best: string[] | undefined
        available.forEach((other, j) => {
          if (i === j || !state[j].reachable) return
          if (!other.outputs.some((o) => matchInputMirror(o.classname, o.content, req.classname, req.content, index))) return
          const gates = addGate(state[j].gates, other.requiredNode)
          if (best === undefined || gates.length < best.length) best = gates
        })
        if (best === undefined) return // вимога без постачальника -> правило недосяжне
        for (const g of best) union = addGate(union, g)
      }
      if (!state[i].reachable || union.length < state[i].gates.length) {
        state[i] = { reachable: true, gates: union }
        changed = true
      }
    })
    if (!changed) break
  }
  return state
}

interface YieldResult {
  // Шляхи, які СПРАВДІ дадуть бали (правило живе, заготовка доживе до сервера)
  byType: Map<string, BalanceYieldPath[]>
  // ...і причини по тих, що не дадуть: тип балів -> перелік пояснень. Саме вони не дають
  // рядку вартості перетворитись на порожнє «не видобувається» без жодної підказки.
  blocked: Map<string, string[]>
}

function ruleBlockReason(f: RuleFact): string {
  if (f.dead) return `правило '${f.ruleId}' сервер не запустить: ${f.deadReasons.join('; ')}`
  return `правило '${f.ruleId}' вимкнене`
}

function buildYieldPaths(
  project: Project,
  index: ClassIndex,
  facts: RuleFact[],
  types: Map<string, BalanceColumn>,
  access: FactionAccess,
  factionId: string,
): YieldResult {
  const own = facts.filter((f) => ruleBelongsTo(f, access, factionId, index))
  const available = own.filter((f) => !f.disabled && !f.dead)
  const supplyList = computeSupply(available, index)
  const supply = new Map<RuleFact, SupplyState>()
  available.forEach((f, i) => supply.set(f, supplyList[i]))

  const byType = new Map<string, BalanceYieldPath[]>()
  const blocked = new Map<string, string[]>()
  function block(type: string, reason: string) {
    const list = blocked.get(type) ?? []
    if (!list.includes(reason)) list.push(reason)
    blocked.set(type, list)
  }

  for (const f of own) {
    const alive = !f.disabled && !f.dead
    const st = supply.get(f)
    // «Правило залежить від потоку» — це вхід-зразок АБО витратник-зразок (N4 контрольного
    // ревʼю: FindStartableCore однаково вимагає і те, і те; читати стан лише по входу
    // означало б, що правило з непостаченим витратником-зразком світиться вільним).
    const chainInput = f.input.isSample || f.sampleConsumables.length > 0
    const selfFed = chainInput && st !== undefined && st.reachable
    const feedGates = chainInput && st ? st.gates : []

    for (const o of f.outputs) {
      const cls = stripExact(o.classname).trim()
      if (cls === '') continue
      // Здати можна ЛИШЕ родину ZP_Data_Base (CanDeposit :29-30)
      if (!isKindOf(index, cls, 'ZP_Data_Base')) continue
      const face = resolveDataItemFace(project, index, cls)
      // Чому саме ця заготовка не дійде до пулу ('' — дійде). Порядок як на сервері: спершу
      // «запису немає» (Find :52-69 нічого не знайде), потім «вимкнений» (той самий Find
      // пропускає !Enabled), потім руйнівний зріз (дзеркало 11).
      const cut = dataItemCutProblems(project, index, cls).filter((p) => p.severity === 'alarm')
      let itemBlock = ''
      if (!face.configured) itemBlock = `заготовка '${cls}' не описана в DataItems.json — балів за неї не нарахують`
      else if (!face.enabled) itemBlock = `запис заготовки '${cls}' вимкнений — сервер її не бачить (Find пропускає !Enabled)`
      else if (cut.length > 0) itemBlock = `сервер викине запис заготовки '${cls}': ${cut.map((c) => c.message).join('; ')}`

      for (const p of face.points) {
        if (p.Type === '' || p.Amount <= 0 || !types.has(p.Type)) continue
        if (!alive) {
          block(p.Type, ruleBlockReason(f))
          continue
        }
        if (itemBlock !== '') {
          block(p.Type, itemBlock)
          continue
        }
        const list = byType.get(p.Type) ?? []
        list.push({
          pointType: p.Type,
          amount: p.Amount,
          dataItem: cls,
          dataItemName: face.name,
          ruleId: f.ruleId,
          filePath: f.filePath,
          device: f.device,
          deviceDisplay: f.deviceDisplay,
          requiredNode: f.requiredNode,
          chainInput,
          selfFed,
          feedGates,
        })
        byType.set(p.Type, list)
      }
    }
  }
  return { byType, blocked }
}

interface BranchMeta {
  branchId: string
  label: string
  filePath: string
  factions: string[]
}

function buildFactions(
  project: Project,
  index: ClassIndex,
  types: Map<string, BalanceColumn>,
  facts: RuleFact[],
  tree: TreeViewResult,
): { rows: BalanceFactionRow[]; notes: string[] } {
  const notes: string[] = []
  const defs = collectFactions(project)
  const settings = docOf(project, 'settings')
  const sharedTerminals = settings ? strArr(settings.TreeTerminalClasses) : []

  const branchByPath = new Map<string, BranchMeta>()
  for (const b of tree.branches) {
    branchByPath.set(b.filePath, { branchId: b.id, label: b.name !== '' ? b.name : b.id, filePath: b.filePath, factions: b.factions })
  }

  // Гілка, адресована фракції поза реєстром — її дерево не побачить НІХТО (GetFactionClass
  // повертає лише Id з Factions.json або DefaultFaction).
  const known = new Set(defs.map((d) => d.id))
  const strangers = new Set<string>()
  for (const b of branchByPath.values()) {
    for (const fid of b.factions) {
      if (!known.has(fid)) strangers.add(fid)
    }
  }
  for (const s of strangers) {
    notes.push(`Гілка дерева адресована фракції '${s}', якої немає у Factions.json — її вузли не побачить жодна фракція.`)
  }

  const rows: BalanceFactionRow[] = []
  for (const def of defs) {
    const access = accessOf(def, defs, sharedTerminals)
    const { byType: yieldByType, blocked } = buildYieldPaths(project, index, facts, types, access, def.id)

    const costTotals = new Map<string, { total: number; nodes: BalanceNodeRef[] }>()
    const itemTotals = new Map<string, { classname: string; display: string; quantity: number; nodes: number }>()
    const branches = new Map<string, BalanceBranchRef>()
    let nodeCount = 0
    let skippedNodes = 0

    for (const n of tree.nodes) {
      const meta = branchByPath.get(n.filePath)
      const branchFactions = meta ? meta.factions : []
      if (!nodeBelongsTo(n, branchFactions, def.id)) continue
      if (!n.loaded) {
        skippedNodes++
        continue
      }
      nodeCount++
      if (meta) branches.set(meta.filePath, { branchId: meta.branchId, label: meta.label, filePath: meta.filePath })
      for (const c of n.cost) {
        const prev = costTotals.get(c.type) ?? { total: 0, nodes: [] as BalanceNodeRef[] }
        prev.total += c.amount
        prev.nodes.push({ filePath: n.filePath, nodeId: n.id, label: n.name !== '' ? n.name : n.id, amount: c.amount })
        costTotals.set(c.type, prev)
      }
      for (const ic of n.itemCost) {
        const key = stripExact(ic.classname).toLowerCase()
        const prev = itemTotals.get(key)
        if (prev) {
          prev.quantity += ic.quantity
          prev.nodes++
        } else {
          itemTotals.set(key, { classname: stripExact(ic.classname), display: ic.display, quantity: ic.quantity, nodes: 1 })
        }
      }
    }

    const costs: BalanceCostRow[] = []
    for (const [type, agg] of costTotals) {
      const col = types.get(type)
      const paths = yieldByType.get(type) ?? []
      const reasons: string[] = []
      let status: BalanceCostStatus
      if (!access.canDeposit) {
        status = 'missing'
        reasons.push(
          access.depositMode === 'none'
            ? 'фракція не має власного терміналу, а хтось інший свої вже оголосив — здавати заготовки нема куди (TerminalsFor :1553-1561), тож пул не поповниться взагалі'
            : 'жоден оголошений термінал не є придатним класом — здавати заготовки нема куди',
        )
      } else if (paths.length === 0) {
        status = 'missing'
        reasons.push(
          access.deviceMode === 'none'
            ? 'у фракції немає власних приладів, а поділ уже почався — жодне правило переробки їй недоступне (DevicesFor :1566-1576)'
            : 'жодне доступне фракції правило не виробляє заготовку з цим типом балів',
        )
        // Вимога ревʼю: не порожнеча, а ЧОМУ. Правило/запис, які сервер відкидає, названі
        // поіменно з причиною — інакше адмін бачить «не видобувається» на конфігу, у якому
        // ланцюг візуально є, і не має жодної зачіпки, куди дивитись.
        reasons.push(...(blocked.get(type) ?? []))
      } else {
        // free — шлях без ЖОДНОГО гейта: ні власного RequiredNode, ні гейта на ланцюгу
        // постачання зразка (feedGates, фікс-раунд ревʼю Important 2).
        const free = paths.filter((p) => p.requiredNode === '' && (!p.chainInput || p.selfFed) && p.feedGates.length === 0)
        if (free.length > 0) {
          status = 'ok'
        } else {
          status = 'gated'
          const gates = [...new Set(paths.flatMap((p) => (p.requiredNode !== '' ? [p.requiredNode] : []).concat(p.feedGates)))]
          if (gates.length > 0) reasons.push(`видобуток відкриється лише після дослідження: ${gates.join(', ')}`)
          if (paths.some((p) => p.chainInput && !p.selfFed)) {
            reasons.push('вхідний зразок не пакує жодне доступне фракції правило — його доведеться брати ззовні (чужий прилад, обмін)')
          }
        }
      }
      if (!col) reasons.push(`типу '${type}' немає в PointTypes.json — сервер відхилить кожен вузол із такою вартістю (ValidateNode :168-170)`)
      costs.push({
        pointType: type,
        typeName: col ? col.name : type,
        color: col ? col.color : '',
        known: !!col,
        total: agg.total,
        nodeCount: agg.nodes.length,
        nodes: agg.nodes,
        paths,
        status,
        reasons,
      })
    }
    costs.sort((a, b) => {
      const ao = types.get(a.pointType)?.sortOrder ?? Number.MAX_SAFE_INTEGER
      const bo = types.get(b.pointType)?.sortOrder ?? Number.MAX_SAFE_INTEGER
      if (ao !== bo) return ao - bo
      return a.pointType.localeCompare(b.pointType)
    })

    const surplus: BalanceSurplusRow[] = []
    for (const [type, paths] of yieldByType) {
      if (costTotals.has(type)) continue
      const col = types.get(type)
      surplus.push({ pointType: type, typeName: col ? col.name : type, color: col ? col.color : '', paths, canDeposit: access.canDeposit })
    }
    surplus.sort((a, b) => {
      const ao = types.get(a.pointType)?.sortOrder ?? Number.MAX_SAFE_INTEGER
      const bo = types.get(b.pointType)?.sortOrder ?? Number.MAX_SAFE_INTEGER
      return ao !== bo ? ao - bo : a.pointType.localeCompare(b.pointType)
    })

    const rowNotes: string[] = []
    if (!access.canDeposit) {
      rowNotes.push('здавати заготовки нема куди: у фракції немає жодного придатного терміналу — пул не поповниться взагалі')
    }
    if (access.deviceMode === 'none') {
      rowNotes.push('у фракції немає власних приладів, а поділ уже почався — жоден станок їй не належить')
    }
    if (access.deviceMode === 'all') {
      rowNotes.push('поділу приладів немає: жодна фракція не оголосила своїх, тож усі прилади доступні всім (DevicesFor повертає null)')
    }
    if (skippedNodes > 0) {
      rowNotes.push(`${skippedNodes} вузол(ів) фракції сервер не завантажить — їхня вартість у суму не входить (подробиці на вкладці «Дерево»)`)
    }
    if (nodeCount === 0) {
      rowNotes.push('у фракції немає жодного вузла дерева — витрачати бали нема на що')
    }

    const alarm = costs.some((c) => c.status === 'missing') || (!access.canDeposit && nodeCount > 0)
    const warn = costs.some((c) => c.status === 'gated') || skippedNodes > 0 || rowNotes.length > 0

    rows.push({
      id: def.id,
      displayName: def.displayName,
      deviceMode: access.deviceMode,
      devices: access.devices,
      depositMode: access.depositMode,
      terminals: access.terminals,
      canDeposit: access.canDeposit,
      branches: [...branches.values()],
      nodeCount,
      skippedNodes,
      costs,
      surplus,
      itemCosts: [...itemTotals.values()].map((v) => ({ classname: v.classname, display: v.display, quantity: v.quantity, nodeCount: v.nodes })),
      tone: alarm ? 'alarm' : warn ? 'warn' : 'ok',
      notes: rowNotes,
    })
  }

  return { rows, notes }
}

// ---- buildBalanceView ---------------------------------------------------------------------------

export function buildBalanceView(project: Project, index: ClassIndex): BalanceView {
  const types = collectPointTypes(project)
  const { matrix, notes: matrixNotes } = buildMatrix(project, index, types)
  const facts = collectRuleFacts(project, index)
  const chains = buildChains(project, index, matrix, facts)

  const hasFactions = project.files.some((f) => f.kind === 'factions')
  const tree = buildTreeView(project, index)
  const { rows: factions, notes: factionNotes } = hasFactions
    ? buildFactions(project, index, types, facts, tree)
    : { rows: [] as BalanceFactionRow[], notes: [] as string[] }

  const notes = [...matrixNotes, ...factionNotes]
  if (!project.files.some((f) => f.kind === 'pointTypes')) {
    notes.push('У проєкті немає PointTypes.json — типи балів перевірити нічим, усі вони показані як невідомі.')
  }
  if (!project.files.some((f) => f.kind === 'dataItems')) {
    notes.push('У проєкті немає DataItems.json — жодна заготовка не описана, тож видобутку балів у грі немає взагалі.')
  }
  if (!hasFactions) {
    notes.push('У проєкті немає Factions.json — порівняти вартість дерева з видобутком нема з чим (розділ нижче порожній).')
  }

  return { matrix, chains, factions, notes }
}
