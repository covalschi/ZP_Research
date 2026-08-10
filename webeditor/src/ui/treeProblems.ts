// Чиста збірка рядків панелі проблем дерева (W3 Task 4) — БЕЗ React і БЕЗ @xyflow/react
// (той самий поділ, що treeLayout.ts проти TreeCanvas.tsx): buildTreeProblems перекладає
// TreeViewResult (model/treeView.ts, T1) у модель панелі — проєктний блок / групи по гілках /
// рядки по вузлах — за зразком панелі розривів ланцюгів (ChainView.BreaksPanel), але з
// ТРЬОМА рівнями замість плаского списку: hardErr-проблеми зривають ЦІЛЕ дерево (окремий
// блок), пер-вузлові причини живуть під рядком свого вузла у групі своєї гілки.
//
// Ключ рядка = ключ КАРТКИ на полотні: 'tnode::<filePath>::<id>' + '#N' на повторі Id у
// файлі — ДЗЕРКАЛО нумерації buildTreeCanvas (treeLayout.ts, seenBase) і, транзитивно,
// assignNodeKeys (ChainView.tsx). Полотно центрується рівно за цим ключем
// (TreeCanvas.handleCenterRow), тож збіг нумерації закріплений юнітом ПРОТИ buildTreeCanvas
// (tests/treeProblems.test.ts), а не повторним захардкоженим рядком.

import type { TreeGraphProblem, TreeViewResult } from '../model/treeView'
import type { FieldSeverity } from '../model/ruleValidation'
import { treeCardKeyBase } from './treeLayout'

// ---- Обов'язкові UA-підказки (бриф T4, п.2 + хвіст ревью T1) --------------------------------
// Формулювання — З ФАКТІВ джерел, не з брифа; усі рядки перечитані перед написанням:
// ZP_TechTree.c (AddFileNodes/ValidateGraph/GetUnreachable), ZP_ConfigService.c
// (TryLoadTechTree/LoadTechTree/OpUpsertNode/OpDeleteNode/SaveBranch).

// Хвіст ревью T1 («ВІДОМІ НАСЛІДКИ ДРУГОГО ПОРЯДКУ», treeView.ts): warn «клас відсутній в
// індексі» — це СУМНІВ (локальний ClassIndex міг бути неповним відносно модпака живого
// сервера), і сумнів униз по дереву не поширюється — нащадки такого вузла світяться «ok».
// Панель мусить чесно доносити наслідок, якщо сумнів справдиться: ValidateNode поверне
// «невідомий клас у ItemCost» (ZP_TechTree.c:181-182), вузол буде ПРОПУЩЕНО (skip-шлях
// AddFileNodes) — і фікспойнт досяжності вже не побачить його серед завантажених.
export const TREE_ITEMCOST_DOUBT_HINT =
  'Якщо цього класу справді немає на живому сервері, вузол буде пропущено (skip, AddFileNodes, ' +
  'ZP_TechTree.c:145-150) — недосяжними стануть і його НАЩАДКИ (фікспойнт GetUnreachable, ' +
  ':224-248; нащадок mode="any" з іншим живим батьком виживе), хоча тут вони світяться «ok»: ' +
  'сумнів униз не поширюється.'

// Різниця «файл валідний типами» проти «сервер відхилить операцію» (бриф T4, п.2).
// Перевірено по джерелах: ValidateGraph — М'ЯКА пост-перевірка («недосяжні вузли — warn
// (не skip: адмін може лагодити покроково, стан фракцій не повинен руйнуватися)»,
// коментар ZP_TechTree.c:202-203, тіло :204-220) — файл із циклом на диску вантажиться
// легально, вузли лишаються завантаженими, лише недосяжними. Серверні ж ОПЕРАЦІЇ редагування
// порівнюють недосяжні ДО/ПІСЛЯ мутації і відмовляють, коли правка створює НОВІ недосяжні:
// OpUpsertNode (unreachBefore :975-976, відмова «відхилено: вузли стануть недосяжними (цикл
// або хибний батьківський вузол)» :1001-1005), OpDeleteNode («відхилено: вузли осиротіють»
// повний гвард :1036-1060 — та сама конвенція повного діапазону, що й :975-1005);
// SaveBranch (:538-554 — запис файлу гілки з бекапом у ConfigBackup)
// викликається лише ПІСЛЯ цих гвардів (:1007 і :1062) — гілка з НОВИМ циклом на диск
// сервером не пишеться. Уже наявна (стара) недосяжність операцію НЕ блокує — саме це і є
// «лагодити покроково».
export const TREE_SERVER_GUARD_HINT =
  'Жовте (warn) — НЕ відмова сервера: файл із циклом чи битим батьком на диску вантажиться ' +
  'легально, ValidateGraph — м\'яка пост-перевірка, що лише пише Warn у лог, вузли лишаються ' +
  'завантаженими, тільки недосяжними («недосяжні вузли — warn (не skip: адмін може лагодити ' +
  'покроково)», ZP_TechTree.c:202-220). Натомість серверні ОПЕРАЦІЇ редагування відмовляють ще ' +
  'ДО запису на диск: UPSERT_NODE відхиляє правку, що створює НОВІ недосяжні вузли («відхилено: ' +
  'вузли стануть недосяжними (цикл або хибний батьківський вузол)», ZP_ConfigService.c:975-1005), ' +
  'DELETE_NODE — осиротіння нащадків («відхилено: вузли осиротіють», :1036-1060), і лише ПІСЛЯ ' +
  'цих гвардів викликається SaveBranch (:1007, :1062; сам SaveBranch, :538-554, пише файл гілки ' +
  'з бекапом). Цей редактор пише файли безпосередньо, повз серверні операції, тож warn-стан ' +
  'можна зберегти і сервер його завантажить; власні гварди редактора (дзеркало OpUpsertNode) ' +
  'так само відмовляють правкам, що створюють нові недосяжні вузли.'

// Каверза loaded (doc-коментар TreeNodeView.loaded, treeView.ts): при hardErr ДЕ ЗАВГОДНО
// сервер не вантажить УЗАГАЛІ НІЧОГО. Перевірено: TryLoadTechTree уриває прохід на першому
// hardErr з AddFileNodes (ZP_ConfigService.c:497-502, `return false`). Далі шляхи різняться:
// на БУТІ LoadTechTree на відмові просто НЕ комітить fresh у m_TechTree (:508-523) — дерево
// лишиться порожнім (конструктор стартує з порожнього); на ЖИВОМУ `!zp reload` той самий
// TryLoadTechTree викликається з OpReloadAll (:1482), і атомарний гейт (:1505-1506) вертає
// відмову ДО будь-якого застосування — в пам'яті лишається стара версія (уточнення ревью T4).
export const TREE_HARDERR_NOTE =
  'Будь-яка ОДНА з цих відмов зриває завантаження ЦІЛОГО дерева: TryLoadTechTree уриває прохід ' +
  'на першому ж hardErr (ZP_ConfigService.c:497-502), тож на найближчому рестарті сервер не ' +
  'завантажить ЖОДНОГО вузла з ЖОДНОЇ гілки (LoadTechTree :508-523 не комітить fresh), а живий ' +
  '`!zp reload` відмовить атомарним гейтом OpReloadAll (:1505-1506) і залишить у пам\'яті ' +
  'стару версію дерева.'

// ---- Модель панелі ----------------------------------------------------------------------------

export interface TreeProblemReason {
  severity: FieldSeverity
  message: string
  // Додаткова підказка другого порядку — наразі ЄДИНЕ джерело: warn «клас відсутній в
  // індексі» на ItemCost[N].Classname (TREE_ITEMCOST_DOUBT_HINT). Alarm-шляхи підказки не
  // мають: вони детерміновані самими файлами проєкту, сумніву там немає.
  hint?: string
}

export interface TreeProblemRow {
  // Ключ картки-екземпляра на полотні (дзеркало buildTreeCanvas) — ціль центрування.
  key: string
  filePath: string
  nodeId: string
  // Name вузла; порожній -> фолбек на Id (той самий принцип, що картка полотна).
  label: string
  // Найгірша severity серед причин рядка — лампа рядка. Бінарний status вузла (alarm на
  // будь-яку причину) лишається справою полотна; тут різниця warn/alarm ЯКРАЗ важлива
  // («вузол зникне НАЗАВЖДИ» проти «лишиться, але недосяжний»).
  worst: FieldSeverity
  reasons: TreeProblemReason[]
}

export interface TreeProblemGroup {
  filePath: string
  branchId: string
  // Branch.Name; порожній -> фолбек на Branch.Id (як табличка гілки в тулбарі).
  label: string
  rows: TreeProblemRow[]
}

export interface TreeProblemsModel {
  // hardErr-рівень (missing-branch-id / duplicate-branch-id / duplicate-node-id) — рівно ті
  // TreeGraphProblem, що на сервері звуться hardErr і зривають завантаження ЦІЛОГО дерева.
  // Фільтр по severity==='alarm': ВСІ три hardErr-види моделі T1 — alarm, а graph-рівень
  // (missing-parent/unreachable/cycle) — warn і живе в reasons своїх вузлів (дублювати його
  // ще й проєктним блоком означало б показувати одну причину двічі).
  project: TreeGraphProblem[]
  // Лише групи, що МАЮТЬ рядки; порядок груп = порядок файлів (view.branches, дзеркало
  // SortFileNames сервера), порядок рядків = порядок вузлів у файлі (view.nodes).
  groups: TreeProblemGroup[]
  // Лічильники того, що панель РЕАЛЬНО показує: проєктні записи + причини рядків.
  // Дубль Id свідомо рахується і проєктним записом (1 на Id), і причиною кожного
  // екземпляра — це різні картки панелі, обидві видимі.
  alarmCount: number
  warnCount: number
  rowCount: number
}

// warn «клас відсутній в індексі» — єдина warn-причина з цим path (alarm «порожній
// Classname» має той самий path, але іншу severity), тож пара (path, severity) ідентифікує
// її однозначно — той самий принцип «ключувати парою (поле, перевірка)», що W2.6-фінал.
const ITEMCOST_CLASSNAME_RE = /^ItemCost\[\d+\]\.Classname$/

export function buildTreeProblems(view: TreeViewResult): TreeProblemsModel {
  // Проєктний блок: hardErr-рівень (дивись коментар до поля project).
  const project = view.problems.filter((p) => p.severity === 'alarm')

  // Нумерація екземплярів — той самий прохід по view.nodes (порядок файлів -> порядок у
  // файлі), що й buildTreeCanvas по своїй гілці: база ключа несе filePath, тож глобальний
  // лічильник дає ту саму нумерацію, що пер-гілковий.
  const seenBase = new Map<string, number>()
  const rowsByFile = new Map<string, TreeProblemRow[]>()
  let rowCount = 0
  let alarmCount = 0
  let warnCount = 0

  // Проєктний блок відфільтрований до 'alarm' вище — гілка else тут була б мертвою
  // (ревью T4, minor: недосяжний warnCount++ прибрано).
  alarmCount += project.length

  for (const n of view.nodes) {
    const base = treeCardKeyBase(n.filePath, n.id)
    const count = (seenBase.get(base) ?? 0) + 1
    seenBase.set(base, count)
    if (n.problems.length === 0) continue

    const reasons: TreeProblemReason[] = n.problems.map((pr) => {
      const reason: TreeProblemReason = { severity: pr.severity, message: pr.message }
      if (pr.severity === 'warn' && ITEMCOST_CLASSNAME_RE.test(pr.path)) reason.hint = TREE_ITEMCOST_DOUBT_HINT
      if (pr.severity === 'alarm') alarmCount++
      else warnCount++
      return reason
    })

    const row: TreeProblemRow = {
      key: count === 1 ? base : `${base}#${count}`,
      filePath: n.filePath,
      nodeId: n.id,
      label: n.name !== '' ? n.name : n.id,
      worst: reasons.some((r) => r.severity === 'alarm') ? 'alarm' : 'warn',
      reasons,
    }
    const list = rowsByFile.get(n.filePath) ?? []
    list.push(row)
    rowsByFile.set(n.filePath, list)
    rowCount++
  }

  const groups: TreeProblemGroup[] = []
  for (const b of view.branches) {
    const rows = rowsByFile.get(b.filePath)
    if (!rows || rows.length === 0) continue
    groups.push({
      filePath: b.filePath,
      branchId: b.id,
      label: b.name !== '' ? b.name : b.id,
      rows,
    })
  }

  return { project, groups, alarmCount, warnCount, rowCount }
}
