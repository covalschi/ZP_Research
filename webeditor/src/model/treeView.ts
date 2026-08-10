// Модель дерева технологій (W3 Task 1) — ЧИСТА логіка, без React/DOM (жодного імпорту з
// ui/*): гілка = файл TechTree/*.json, вузол = ZP_TreeNode всередині нього. Дзеркалить
// РІВНО ту саму послідовність перевірок, яку рушій проганяє при завантаженні дерева —
// AddFileNodes -> ValidateNode (на вузол) -> ValidateGraph (на весь граф) — щоб полотно
// (T2/T3/T4) показувало адміну ПРАВДИВИЙ стан: вузол, якого сервер ніколи не завантажить,
// має горіти alarm тут само, а не виглядати звичайним.
//
// Джерело (прочитано ПОВНІСТЮ перед написанням коду, як вимагає бриф):
// ZP_Research/scripts/3_Game/ZP_Research/ZP_TechTree.c (267 рядків).
//
// ---- Схема послідовності завантаження (для орієнтації по коду нижче) ---------------------
//
// TryLoadTechTree (ZP_ConfigService.c:459-506) для КОЖНОГО файлу TechTree/*.json (у порядку
// SortFileNames) кличе AddFileNodes; ПЕРША ж hardErr (`return false` з AddFileNodes) уриває
// ВЕСЬ прохід — ValidateGraph (:504) не встигає виконатись, а м'яка стара пам'ять дерева
// лишається незмінною (LoadTechTree:508-523 просто НЕ комітить `fresh`). Модель нижче все
// одно ОБРОБЛЯЄ КОЖЕН файл до кінця (той самий принцип, що chainGraph.ts/ruleValidation.ts:
// адміну потрібна ПОВНА картина проблем одразу, а не лише перша) — але позначає КОЖНЕ
// джерело "жорсткої" відмови (ZP_TechTree.c:119-144) як project-wide TreeGraphProblem
// severity='alarm' із поясненням, що ОДНА така відмова будь-де зупиняє ЦІЛЕ дерево на
// найближчому reload/boot (той самий T8-прецедент, parse.ts:wrongTypeNote).
//
// AddFileNodes (ZP_TechTree.c:116-155):
//   :119-123  Branch.Id=="" -> hardErr "немає Branch.Id", файл НЕ реєструється взагалі
//   :124-128  дубль Branch.Id серед УЖЕ зареєстрованих гілок -> hardErr "дубль гілки"
//   :135-139  n.Id=="" -> ЛИШЕ ZP_Log.Warn, `continue` (вузол просто не існує в Nodes;
//             те саме, що chainGraph.ts вже робить для правил без Id — граф не бреше)
//   :140-144  FindNode(n.Id) вже існує (ЗІ ЗБІРКИ Nodes, а вона накопичується і ВСЕРЕДИНІ
//             одного файлу, і між файлами — дублікат у межах ОДНОГО файлу ловиться так
//             само, як і між різними) -> hardErr "дубль Id вузла" — ЄДИНЕ джерело істини
//             для "duplicate node Ids across branches" з брифа
//   :145-150  ValidateNode(n) != "" -> ЛИШЕ ZP_Log.Warn + `continue` (SKIP, не hardErr) —
//             вузол просто не потрапляє в Nodes, решта файлу/дерева вантажиться далі
//
// ValidateNode (:158-192) — усі гілки нижче ПОВЕРТАЮТЬ ПЕРШЕ непорожнє повідомлення
// (short-circuit); наслідок ОДИН і той самий для будь-якої з них — вузол пропускається
// (:145-150 вище) — рушій сам НІКОЛИ не покаже адміну більш ніж одну причину нараз. Модель
// нижче збирає ВСІ застосовні причини (той самий "не short-circuit" принцип, що
// ruleValidation.validateRule) — це суворо БІЛЬШЕ інформації, ніж рушій друкує в лог, не
// вигадана нова причина відмови.
//
// ValidateGraph (:204-220) — М'ЯКА пост-перевірка зв'язності НАД уже завантаженими Nodes
// (вузли, що не пройшли ValidateNode, у ній узагалі не беруть участі — вони не в Nodes):
//   :208-211  для КОЖНОГО (вузол, батько) — якщо FindNode(батько)==null -> ZP_Log.Warn
//             "батьківський вузол не існує" (ПЕР ПАРУ, не одне повідомлення на вузол)
//   :216-219  для КОЖНОГО вузла з GetUnreachable() (фікспойнт, :224-265) -> ZP_Log.Warn
//             "недосяжний (цикл або биті батьківські вузли)" — рушій НЕ розрізняє
//             "справжній цикл" від "битий батько без циклу" в тексті й НЕ друкує шлях циклу
//             ЖОДНОГО РАЗУ — findCycleAmong нижче ("cycles (node lists the cycle path)"
//             з брифа) ЦЕ ЯВНЕ РОЗШИРЕННЯ редактора понад те, що рахує/друкує сам рушій,
//             а не переказ його виводу; позначено окремим TreeGraphProblem.kind='cycle'.
//
// ВАЖЛИВО, підтверджено читанням (обидва — ВІДХИЛЯЮТЬ БРИФ-ПРИПУЩЕННЯ "case-insensitive"):
//   FindNode (:69-77)              — `n.Id == id`, РЕГІСТРОЗАЛЕЖНО (звичайний `==`, без
//                                    .ToLower() — на відміну від MatchClass/Content/усіх
//                                    інших config-lookup'ів мода).
//   ZP_PointTypesConfig.Find       — `pt.Id == id`, ТЕЖ РЕГІСТРОЗАЛЕЖНО
//   (ZP_PointTypesConfig.c:317-325)  (єдиний Find серед восьми конфігів БЕЗ .ToLower() —
//                                    порівняй ZP_DataItemsConfig.Find/ZP_SampleTypesConfig.
//                                    Find, обидва кейс-інсенситивні). Бриф-припущення
//                                    "case-insensitive Find" для типів балів НЕВІРНЕ —
//                                    findPointType нижче мириться з реальним рушієм.
//
// Дублі Cost.Type (ValidateNode :173-177) — ПІДТВЕРДЖЕНО: сервер відхиляє ЦІЛИЙ ВУЗОЛ
// (не лише "зайвий" Cost-запис) — той самий SKIP-шлях :145-150. Severity тут 'alarm'
// (як і решта ValidateNode-провалів): вузол зникає з робочої пам'яті сервера НАЗАВЖДИ,
// доки адмін не поправить файл.

import type { Project } from '../io/project'
import type { ClassIndex } from './classIndex'
import { classRoot, stripExact } from './classIndex'
import { isSampleClass } from './sampleContent'
import { resolveStationItemDisplay } from './stationView'
import type { FieldError, FieldSeverity } from './ruleValidation'

// ---- Мінімальна типізована форма ZP_TreeNode/ZP_TreeBranchInfo ----------------------------
// Той самий підхід, що RuleLike/asRuleLike у chainGraph.ts: терпимий парсер (parse.ts)
// гарантує, що КОЖЕН ключ TREE_NODE_SCHEMA/TREE_BRANCH_INFO_SCHEMA присутній у розібраному
// значенні (відсутній у файлі -> нуль свого типу), тож структурного інтерфейсу досить —
// повної рефлексії по ObjectSchema не треба. Експортовано (як RuleLike) — майбутня форма
// вузла (T3) читає ті самі поля.

export interface TreeCostLike {
  Type: string
  Amount: number
}

export interface TreeItemCostLike {
  Classname: string
  Quantity: number
  Content: string
}

export interface TreeNodeLike {
  Id: string
  Name: string
  Description: string
  Icon: string
  Tier: number
  Parents: string[]
  ParentsMode: string
  Cost: TreeCostLike[]
  ItemCost: TreeItemCostLike[]
  ResearchTimeSec: number
  RequiredFactions: string[]
}

export interface TreeBranchInfoLike {
  Id: string
  Name: string
  Icon: string
  SortOrder: number
  Factions: string[]
}

interface TechTreeFileLike {
  ConfigVersion: number
  Branch: unknown
  Nodes: unknown[]
}

function asTreeCostLike(raw: unknown): TreeCostLike | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const c = raw as Record<string, unknown>
  if (typeof c.Type !== 'string' || typeof c.Amount !== 'number') return undefined
  return { Type: c.Type, Amount: c.Amount }
}

function asTreeItemCostLike(raw: unknown): TreeItemCostLike | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const c = raw as Record<string, unknown>
  if (typeof c.Classname !== 'string') return undefined
  return {
    Classname: c.Classname,
    Quantity: typeof c.Quantity === 'number' ? c.Quantity : 1,
    Content: typeof c.Content === 'string' ? c.Content : '',
  }
}

export function asTreeNodeLike(raw: unknown): TreeNodeLike | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const n = raw as Record<string, unknown>
  if (typeof n.Id !== 'string' || typeof n.Name !== 'string') return undefined
  if (!Array.isArray(n.Parents) || !Array.isArray(n.Cost) || !Array.isArray(n.ItemCost) || !Array.isArray(n.RequiredFactions)) return undefined
  return {
    Id: n.Id,
    Name: n.Name,
    Description: typeof n.Description === 'string' ? n.Description : '',
    Icon: typeof n.Icon === 'string' ? n.Icon : '',
    Tier: typeof n.Tier === 'number' ? n.Tier : 1,
    Parents: n.Parents.filter((x): x is string => typeof x === 'string'),
    ParentsMode: typeof n.ParentsMode === 'string' ? n.ParentsMode : 'all',
    Cost: n.Cost.map(asTreeCostLike).filter((x): x is TreeCostLike => !!x),
    ItemCost: n.ItemCost.map(asTreeItemCostLike).filter((x): x is TreeItemCostLike => !!x),
    ResearchTimeSec: typeof n.ResearchTimeSec === 'number' ? n.ResearchTimeSec : 0,
    RequiredFactions: n.RequiredFactions.filter((x): x is string => typeof x === 'string'),
  }
}

export function asTreeBranchInfoLike(raw: unknown): TreeBranchInfoLike | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const b = raw as Record<string, unknown>
  if (typeof b.Id !== 'string') return undefined
  return {
    Id: b.Id,
    Name: typeof b.Name === 'string' ? b.Name : '',
    Icon: typeof b.Icon === 'string' ? b.Icon : '',
    SortOrder: typeof b.SortOrder === 'number' ? b.SortOrder : 0,
    Factions: Array.isArray(b.Factions) ? b.Factions.filter((x): x is string => typeof x === 'string') : [],
  }
}

// ---- PointTypes.json lookup: дзеркало ZP_PointTypesConfig.Find (РЕГІСТРОЗАЛЕЖНО, ПЕРШИЙ
// збіг — не last-wins, як у DataItems/SampleTypes) ------------------------------------------

interface PointTypesDoc {
  PointTypes: unknown[]
}

function findPointTypesDoc(project: Project): PointTypesDoc | undefined {
  const file = project.files.find((f) => f.kind === 'pointTypes')
  const doc = file?.parsed as { PointTypes?: unknown[] } | undefined
  if (!doc || !Array.isArray(doc.PointTypes)) return undefined
  return doc as PointTypesDoc
}

// ZP_PointTypesConfig.c:317-325 — `pt.Id == id`, БЕЗ .ToLower(). PointTypesConfig.Validate
// (яка провалила б ЦІЛИЙ файл на дублі Id) НЕ мириться тут — PointTypes.json лежить поза
// обсягом Task 1 (модель дерева читає його ЯК Є, тим самим Find, що й сервер).
function findPointType(doc: PointTypesDoc | undefined, id: string): { Id: string; Name: string } | undefined {
  if (!doc) return undefined
  for (const raw of doc.PointTypes) {
    if (!raw || typeof raw !== 'object') continue
    const pt = raw as Record<string, unknown>
    if (typeof pt.Id === 'string' && pt.Id === id) {
      return { Id: pt.Id, Name: typeof pt.Name === 'string' ? pt.Name : '' }
    }
  }
  return undefined
}

// ---- Лиця (для карток T2/T3) ---------------------------------------------------------------

export interface TreeCostFace {
  type: string
  amount: number
  // pointTypes.Find(c.Type) знайшов запис -- РЕГІСТРОЗАЛЕЖНО (findPointType вище).
  known: boolean
  // Name знайденого типу; якщо не знайдено АБО Name порожній -- сирий Type (чесний
  // роздрук, той самий принцип, що DataItemFace.name/SampleTypeFace.name).
  name: string
}

function resolveCostFace(doc: PointTypesDoc | undefined, c: TreeCostLike): TreeCostFace {
  const pt = findPointType(doc, c.Type)
  return { type: c.Type, amount: c.Amount, known: !!pt, name: pt && pt.Name !== '' ? pt.Name : c.Type }
}

export interface TreeItemCostFace {
  classname: string
  quantity: number
  content: string
  // resolveStationItemDisplay (model/stationView.ts) -- ТОЙ САМИЙ трипрохідний резолв
  // (SampleTypes.json -> DataItems.json -> ClassIndex.displayNameOf), що вже носять картки
  // станків/ланцюгів. Жодної другої копії цієї логіки тут -- дрейф двох копій, якого
  // codebase свідомо уникає (chainGraph.ts/stationView.ts, коментарі над matchClassMirror
  // і resolveStationItemDisplay).
  display: string
  isSample: boolean
}

function resolveItemCostFace(project: Project, index: ClassIndex, ic: TreeItemCostLike): TreeItemCostFace {
  const face = resolveStationItemDisplay(project, index, ic.Classname)
  return { classname: ic.Classname, quantity: ic.Quantity, content: ic.Content, display: face.display, isSample: face.isSample }
}

// ---- validateTreeNode: дзеркало ValidateNode (ZP_TechTree.c:158-192) -----------------------
// НЕ short-circuit (сервер повертає ПЕРШЕ повідомлення й зупиняється) -- збирає УСІ
// застосовні причини, той самий принцип, що ruleValidation.validateRule. Будь-яка непорожня
// причина тут ОЗНАЧАЄ, що сервер вузол ПРОПУСТИТЬ (:145-150) -- severity ЗАВЖДИ 'alarm',
// крім ОДНОГО винятку (ItemCost.Classname відсутній в індексі -- див. коментар нижче).
function validateTreeNode(n: TreeNodeLike, index: ClassIndex, pointTypesDoc: PointTypesDoc | undefined): FieldError[] {
  const out: FieldError[] = []

  // :160-161
  if (n.Name === '') {
    out.push({ path: 'Name', severity: 'alarm', message: "сервер відхилить вузол: немає Name (ValidateNode, ZP_TechTree.c:160-161)" })
  }

  // :162-165 -- ПОРІВНЯННЯ регістронезалежне (.ToLower() застосований), на відміну від
  // усього іншого в цій функції.
  const pm = n.ParentsMode.toLowerCase()
  if (pm !== 'all' && pm !== 'any') {
    out.push({
      path: 'ParentsMode',
      severity: 'alarm',
      message: `сервер відхилить вузол: ParentsMode '${n.ParentsMode}' (треба all|any) (ValidateNode, ZP_TechTree.c:162-165)`,
    })
  }

  // :166-178 -- Cost: невідомий тип / межі Amount / дубль типу. Дубль перевіряється ДО
  // додавання поточного Type у "seen" (перше входження НІКОЛИ не отримує "дубль" -- лише
  // друге й наступні), той самий порядок, що `seenCost.Contains(c.Type)` ПЕРЕД
  // `seenCost.Set(...)` на сервері.
  const seenCostTypes = new Set<string>()
  n.Cost.forEach((c, i) => {
    if (!findPointType(pointTypesDoc, c.Type)) {
      out.push({
        path: `Cost[${i}].Type`,
        severity: 'alarm',
        message: `сервер відхилить вузол: невідомий тип балів '${c.Type}' у Cost (ValidateNode, ZP_TechTree.c:168-170)`,
      })
    }
    if (c.Amount < 0 || c.Amount > 1000000) {
      out.push({
        path: `Cost[${i}].Amount`,
        severity: 'alarm',
        message: 'сервер відхилить вузол: Cost.Amount поза межами [0..1000000] (ValidateNode, ZP_TechTree.c:171-172)',
      })
    }
    if (seenCostTypes.has(c.Type)) {
      out.push({
        path: `Cost[${i}].Type`,
        severity: 'alarm',
        message: `сервер відхилить вузол: дубль типу '${c.Type}' у Cost (ValidateNode, ZP_TechTree.c:173-177)`,
      })
    }
    seenCostTypes.add(c.Type)
  })

  // :179-188 -- ItemCost: клас / межі Quantity / ValidateContent (ZP_ProcessingConfig.c:
  // 365-379). Класнейм стрипається "|N" ПЕРЕД перевіркою існування (ZP_StripExactHelper,
  // ZP_TechTree.c:194-200 -- та сама логіка, що classIndex.stripExact, окрема копія на
  // сервері, не другий алгоритм).
  n.ItemCost.forEach((ic, i) => {
    if (ic.Classname === '') {
      out.push({
        path: `ItemCost[${i}].Classname`,
        severity: 'alarm',
        message: 'сервер відхилить вузол: невідомий клас у ItemCost (Classname порожній) (ValidateNode, ZP_TechTree.c:181-182)',
      })
    } else {
      const stripped = stripExact(ic.Classname)
      const root = classRoot(index, stripped)
      if (root === undefined) {
        // ЗНИЖЕНО до 'warn' -- ЄДИНИЙ виняток severity у цій функції, той самий принцип,
        // що ruleValidation.validateClassField (allowFree/локальний ClassIndex МІГ БУТИ
        // неповним відносно РЕАЛЬНОГО модпака живого сервера -- ClassExists перевіряє
        // п'ять конфіг-коренів фактично завантажених модів, ZP_ProcessingConfig.c:175-188,
        // а не наш офлайн-скан PBO). Решта перевірок тут -- 100% детерміновані самими
        // файлами проєкту (PointTypes.json уже завантажено, межі й дублі рахуються з
        // самого JSON), тому лишаються 'alarm' без цього застереження.
        // ВІДОМІ НАСЛІДКИ ДРУГОГО ПОРЯДКУ 'warn'-шляху (ревью T1, minor; адресат -- панель
        // проблем T4): (а) якщо класу СПРАВДІ нема на живому сервері, вузол там буде
        // відкинуто -> його НАЩАДКИ стануть недосяжні, а тут вони світяться 'ok' (сумнів
        // не поширюється вниз); (б) класнейм, що стрипається в порожній рядок ("|1"), --
        // детермінований провал ClassExists("") де завгодно, але падає в цей самий warn
        // (status все одно 'alarm' через бінарність, оптимістичним лишається тільки loaded).
        out.push({
          path: `ItemCost[${i}].Classname`,
          severity: 'warn',
          message: `клас '${ic.Classname}' відсутній в індексі (мод відсутній на цій машині?) -- якщо його справді нема на сервері, вузол буде відхилено (ValidateNode, ZP_TechTree.c:181-182; ClassExists, ZP_ProcessingConfig.c:175-188)`,
        })
      } else if (ic.Content !== '') {
        // ValidateContent (ZP_ProcessingConfig.c:365-379), викликана з "ItemCost" (:185).
        if (!isSampleClass(index, ic.Classname)) {
          out.push({
            path: `ItemCost[${i}].Content`,
            severity: 'alarm',
            message: `сервер відхилить вузол: ItemCost Content задано для '${ic.Classname}', але вміст мають лише зразки родини ZP_Sample_Base (ValidateContent, ZP_ProcessingConfig.c:365-370)`,
          })
        } else {
          // Рушій рахує БАЙТИ, не символи: Enforce string.Length() -- байтова довжина
          // (enstring.c: Length() :199 і LengthUtf8() :212 -- ДВА окремі нативи; якби
          // Length() рахував кодпойнти, LengthUtf8 був би зайвим), а JSON -- UTF-8, тож
          // кирилична мітка на 33-64 літери (66-128 байт) провалює серверну перевірку.
          // JS .length рахує UTF-16-одиниці -- брати саме байти (фікс ревью T1).
          if (new TextEncoder().encode(ic.Content).length > 64) {
            out.push({
              path: `ItemCost[${i}].Content`,
              severity: 'alarm',
              message: 'сервер відхилить вузол: ItemCost Content довший за 64 БАЙТИ у UTF-8 (кирилична літера = 2 байти) (ValidateContent, ZP_ProcessingConfig.c:371-372)',
            })
          }
          if (ic.Content.trim() !== ic.Content) {
            out.push({
              path: `ItemCost[${i}].Content`,
              severity: 'alarm',
              message: `сервер відхилить вузол: ItemCost Content '${ic.Content}' має пробіл на початку або в кінці (ValidateContent, ZP_ProcessingConfig.c:373-378)`,
            })
          }
        }
      }
    }
    if (ic.Quantity < 1 || ic.Quantity > 100) {
      out.push({
        path: `ItemCost[${i}].Quantity`,
        severity: 'alarm',
        message: 'сервер відхилить вузол: ItemCost.Quantity поза межами [1..100] (ValidateNode, ZP_TechTree.c:183-184)',
      })
    }
  })

  // :189-190
  if (n.ResearchTimeSec < 0 || n.ResearchTimeSec > 2592000) {
    out.push({
      path: 'ResearchTimeSec',
      severity: 'alarm',
      message: 'сервер відхилить вузол: ResearchTimeSec поза межами [0..30 діб] (ValidateNode, ZP_TechTree.c:189-190)',
    })
  }

  return out
}

// ---- Публічна модель -------------------------------------------------------------------

export interface TreeNodeView {
  id: string
  branchId: string
  filePath: string
  name: string
  description: string
  icon: string
  tier: number
  parents: string[]
  // Сире значення (для форми T3) -- порівняння регістронезалежне лише ВСЕРЕДИНІ валідатора/
  // фікспойнта (n.ParentsMode.toLowerCase(), дзеркало pm.ToLower() на сервері).
  parentsMode: string
  cost: TreeCostFace[]
  itemCost: TreeItemCostFace[]
  researchTimeSec: number
  requiredFactions: string[]
  // Id збігається (регістрозалежно) з іншим вузлом де завгодно в проєкті (AddFileNodes:
  // 140-144) -- ОБИДВА (перший і другий) екземпляри позначені, не лише "переможений".
  duplicateId: boolean
  // true -- вузол пройшов би ValidateNode І не є дублем Id І його гілка валідна (Branch.Id
  // не порожній/не дублікат) -- тобто ДІЙСНО потрапив би в m_TechTree.Nodes сервера,
  // ЗА УМОВИ, що hardErr-блокери в ІНШИХ файлах виправлені: будь-який hardErr будь-де
  // (дубль Id, битa гілка) зриває ВЕСЬ reload, і сервер не завантажить НІЧОГО -- цей
  // project-wide факт лежить у problems[] верхнього рівня, T2/T4 мусять показувати його
  // ОКРЕМО від пер-вузлового loaded (фікс ревью T1: коментар обіцяв більше, ніж поле знає).
  // false -- вузол ІСНУЄ лише на диску/в редакторі, сервер його НІКОЛИ не завантажить.
  loaded: boolean
  // Бінарний статус для полотна (T1-бриф: "ok | alarm(+reasons)", БЕЗ третього стану) --
  // Task 2 очікує, що навіть SOFT-проблема ValidateGraph (недосяжність, битий батько)
  // "горить" alarm на канві (план W3, T2: "alarm-узел (рукописний цикл) горить"); повний
  // severity (warn/alarm) кожної причини лишається в problems[] для деталь-панелі T4, де
  // різниця "вузол зникне НАЗАВЖДИ" проти "вузол лишиться, але недосяжний" МАЄ значення.
  status: 'ok' | 'alarm'
  // Усі причини (ValidateNode + ValidateGraph-рівень: nonexistent-parent/unreachable/
  // cycle-path + дубль Id/гілки) -- порожній масив = 'ok'.
  problems: FieldError[]
}

export interface TreeBranchView {
  id: string
  filePath: string
  name: string
  icon: string
  sortOrder: number
  factions: string[]
  // Порядок появи у файлі (Nodes[], без сортування) -- ідентифікатори, що МАЮТЬ Id (порожні
  // Id пропущені так само, як chainGraph пропускає правила без Id -- дивись коментар над
  // asTreeNodeLike/пропуском n.Id==='' нижче).
  nodeIds: string[]
  // false -- Branch.Id порожній АБО дублює вже зареєстровану гілку (AddFileNodes:119-128) --
  // ЦЕЙ файл сервер не зареєструє взагалі, і ЖОДЕН його вузол не потрапить у Nodes.
  valid: boolean
}

export type TreeGraphProblemKind = 'missing-branch-id' | 'duplicate-branch-id' | 'duplicate-node-id' | 'missing-parent' | 'unreachable' | 'cycle'

export interface TreeGraphProblem {
  kind: TreeGraphProblemKind
  severity: FieldSeverity
  message: string
  nodeId?: string
  branchId?: string
  filePath?: string
}

export interface TreeViewResult {
  branches: TreeBranchView[]
  nodes: TreeNodeView[]
  // ключ -- РЕГІСТРОЗАЛЕЖНИЙ Id (FindNode:69-77 -- `n.Id == id`, без .ToLower()). Дублі
  // Id -- перший побачений виграє мапу (найближче до "якби завантаження не впало цілком").
  byId: Map<string, TreeNodeView>
  problems: TreeGraphProblem[]
}

// ---- Фікспойнт досяжності: дзеркало GetUnreachable/IsReachableGiven (:224-265) -------------
// Працює ЛИШЕ над loaded-вузлами (loadedById) -- вузол, що не пройшов ValidateNode/гілку,
// НІКОЛИ не потрапляє в m_TechTree.Nodes на сервері, тож для фікспойнта він так само
// відсутній, як і зовсім не написаний у файлі (посилання на нього -- це "батько не існує",
// той самий шлях, що й звичайний nonexistent-parent).
function isReachableGiven(n: TreeNodeView, reachable: Set<string>): boolean {
  if (n.parents.length === 0) return true
  const pm = n.parentsMode.toLowerCase()
  let okCount = 0
  for (const p of n.parents) {
    if (reachable.has(p)) okCount++
  }
  if (pm === 'any') return okCount > 0
  return okCount === n.parents.length
}

function computeUnreachable(loadedNodes: TreeNodeView[]): Set<string> {
  const reachable = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const n of loadedNodes) {
      if (reachable.has(n.id)) continue
      if (isReachableGiven(n, reachable)) {
        reachable.add(n.id)
        changed = true
      }
    }
  }
  const unreachable = new Set<string>()
  for (const n of loadedNodes) {
    if (!reachable.has(n.id)) unreachable.add(n.id)
  }
  return unreachable
}

// ---- findCycleAmong: РОЗШИРЕННЯ редактора понад ValidateGraph ("cycles (node lists the
// cycle path)" з брифа) -- сервер САМ НІКОЛИ не обчислює/не друкує шлях циклу, лише
// узагальнене "недосяжний (цикл або биті батьківські вузли)" на КОЖЕН недосяжний вузол
// (:216-219, однаковий текст для "справжнього" циклу й для "просто битого батька"). Пошук
// обмежений РЕБРАМИ ВСЕРЕДИНІ фінального `unreachable`-набору: ребро, що веде НАЗОВНІ
// (до вузла, який зрештою став reachable), не може бути частиною "вічного" циклу -- такий
// вузол вибув би з unreachable ще на попередньому кроці фікспойнта. ParentsMode свідомо
// ІГНОРУЄТЬСЯ тут (усі перелічені Parents трактуються як ребра) -- ціль "показати РЕАЛЬНИЙ
// цикл посилань", а не "яке САМЕ ребро вирішило недосяжність під all/any".
function findCycleAmong(loadedById: Map<string, TreeNodeView>, unreachable: Set<string>): string[] | undefined {
  const state = new Map<string, 1 | 2>() // 1 = у стеку, 2 = завершено
  const stack: string[] = []

  function dfs(id: string): string[] | undefined {
    state.set(id, 1)
    stack.push(id)
    const n = loadedById.get(id)
    if (n) {
      for (const p of n.parents) {
        if (!unreachable.has(p)) continue
        const st = state.get(p)
        if (st === 1) {
          const start = stack.indexOf(p)
          return stack.slice(start)
        }
        if (st === undefined) {
          const found = dfs(p)
          if (found) return found
        }
      }
    }
    stack.pop()
    state.set(id, 2)
    return undefined
  }

  for (const id of unreachable) {
    if (state.has(id)) continue
    const found = dfs(id)
    if (found) return found
  }
  return undefined
}

// ---- buildTreeView --------------------------------------------------------------------------
//
// Порядок файлів: project.files УЖЕ відсортовані для kind==='techTree' точно так, як
// зробить сервер при завантаженні -- io/project.ts:loadProject -> orderPaths ->
// sortPathsByBasename (дзеркало ZP_ConfigService.c:670 SortFileNames, компонент io/project.ts,
// НЕ повторений тут другою копією). Той самий принцип, що chainGraph.buildChainGraph уже
// застосовує для 'rules' -- модель ДОВІРЯЄ порядку project.files, а не пересортовує його
// сама (тести нижче будують project(...) файлами ВЖЕ в бажаному порядку, той самий підхід,
// що chainGraph.test.ts/stationView.test.ts).
export function buildTreeView(project: Project, index: ClassIndex): TreeViewResult {
  const techTreeFiles = project.files.filter((f) => f.kind === 'techTree')
  const pointTypesDoc = findPointTypesDoc(project)
  const problems: TreeGraphProblem[] = []

  interface FileEntry {
    filePath: string
    branch: TreeBranchInfoLike
    branchValid: boolean
    branchProblem: string
    rawNodes: TreeNodeLike[]
  }

  // ---- Pass 1: branch-рівень AddFileNodes (:119-128) -----------------------------------
  const fileEntries: FileEntry[] = []
  const branches: TreeBranchView[] = []
  const branchViewByFilePath = new Map<string, TreeBranchView>()
  const seenBranchIds = new Map<string, string>() // branchId -> перший filePath

  for (const file of techTreeFiles) {
    const parsed = file.parsed as TechTreeFileLike | undefined
    if (!parsed || !Array.isArray(parsed.Nodes)) continue // чужий/непридатний документ -- той самий захист, що chainGraph
    const branch = asTreeBranchInfoLike(parsed.Branch)
    if (!branch) continue

    let branchValid = true
    let branchProblem = ''
    if (branch.Id === '') {
      branchProblem = `${file.path}: немає Branch.Id -- перезавантаження дерева на сервері буде відхилено ЦІЛКОМ (той самий hardErr-шлях, що й дубль гілки) (AddFileNodes, ZP_TechTree.c:119-123)`
      branchValid = false
      problems.push({ kind: 'missing-branch-id', severity: 'alarm', message: branchProblem, filePath: file.path })
    } else if (seenBranchIds.has(branch.Id)) {
      branchProblem = `${file.path}: дубль гілки '${branch.Id}' (уже зареєстрована в ${seenBranchIds.get(branch.Id)}) -- перезавантаження дерева на сервері буде відхилено ЦІЛКОМ (AddFileNodes, ZP_TechTree.c:124-128)`
      branchValid = false
      problems.push({ kind: 'duplicate-branch-id', severity: 'alarm', message: branchProblem, filePath: file.path, branchId: branch.Id })
    } else {
      seenBranchIds.set(branch.Id, file.path)
    }

    const rawNodes = parsed.Nodes.map(asTreeNodeLike).filter((n): n is TreeNodeLike => !!n)
    fileEntries.push({ filePath: file.path, branch, branchValid, branchProblem, rawNodes })
    const branchView: TreeBranchView = {
      id: branch.Id,
      filePath: file.path,
      name: branch.Name,
      icon: branch.Icon,
      sortOrder: branch.SortOrder,
      factions: branch.Factions,
      nodeIds: [],
      valid: branchValid,
    }
    branches.push(branchView)
    branchViewByFilePath.set(file.path, branchView)
  }

  // ---- Pass 2: вузли, у порядку файлів -> порядку в файлі (те саме, що Nodes.Insert) ---
  // AddFileNodes:135-139 -- n.Id==="" ЛИШЕ Warn + continue, вузол НІКОЛИ не потрапляє в
  // Nodes -- модель так само НЕ створює для нього TreeNodeView (той самий принцип, що
  // chainGraph.ts вже застосовує для правил без Id: "граф, який показав би такий вузол як
  // живий, брехав би").
  const nodes: TreeNodeView[] = []

  for (const entry of fileEntries) {
    const branchView = branchViewByFilePath.get(entry.filePath)!
    for (const raw of entry.rawNodes) {
      if (raw.Id === '') continue

      const nodeProblems: FieldError[] = []

      if (!entry.branchValid) {
        nodeProblems.push({ path: '', severity: 'alarm', message: `гілка файлу не завантажується: ${entry.branchProblem}` })
      }

      nodeProblems.push(...validateTreeNode(raw, index, pointTypesDoc))

      const view: TreeNodeView = {
        id: raw.Id,
        branchId: entry.branch.Id,
        filePath: entry.filePath,
        name: raw.Name,
        description: raw.Description,
        icon: raw.Icon,
        tier: raw.Tier,
        parents: raw.Parents,
        parentsMode: raw.ParentsMode,
        cost: raw.Cost.map((c) => resolveCostFace(pointTypesDoc, c)),
        itemCost: raw.ItemCost.map((ic) => resolveItemCostFace(project, index, ic)),
        researchTimeSec: raw.ResearchTimeSec,
        requiredFactions: raw.RequiredFactions,
        duplicateId: false, // остаточне значення -- у пост-проході дублів нижче
        loaded: false, // остаточне значення -- ПІСЛЯ пост-проходу дублів (loaded залежить від нього)
        status: 'ok', // остаточний статус -- нижче, після ValidateGraph-рівня
        problems: nodeProblems,
      }
      nodes.push(view)
      branchView.nodeIds.push(raw.Id)
    }
  }

  // ---- Пост-прохід дублів Id (AddFileNodes:140-144): рахуємо ВСІ входження кожного Id по
  // ВСЬОМУ дереву (в т.ч. в межах одного файлу -- FindNode(Nodes) бачить і те, що вже
  // вставлено з ЦЬОГО САМОГО файлу раніше в тому самому циклі на сервері), і позначаємо
  // ОБИДВА (усі) екземпляри, не лише "той, що спричинив" hardErr на сервері -- інакше
  // перший екземпляр виглядав би здоровим, хоча щонайближчий reload знесе ЦІЛЕ дерево
  // незалежно від того, який із двох "винен". Порахувати це інкрементально під час
  // основного проходу неможливо без другого проходу: перший екземпляр іще НЕ знає, що
  // за ним піде дублікат.
  const idCounts = new Map<string, number>()
  for (const n of nodes) idCounts.set(n.id, (idCounts.get(n.id) ?? 0) + 1)
  const reportedDupIds = new Set<string>()
  for (const n of nodes) {
    const count = idCounts.get(n.id)!
    if (count <= 1) continue
    n.duplicateId = true
    n.problems.push({
      path: 'Id',
      severity: 'alarm',
      message: `дубль Id вузла '${n.id}' (зустрічається ${count} рази у проєкті) -- перезавантаження дерева на сервері буде відхилено ЦІЛКОМ, доки дублікат не усунуто (AddFileNodes, ZP_TechTree.c:140-144)`,
    })
    if (!reportedDupIds.has(n.id)) {
      reportedDupIds.add(n.id)
      problems.push({
        kind: 'duplicate-node-id',
        severity: 'alarm',
        message: `дубль Id вузла '${n.id}' (${count} екземплярів у проєкті) -- перезавантаження дерева на сервері буде відхилено ЦІЛКОМ, доки дублікат не усунуто (AddFileNodes, ZP_TechTree.c:140-144)`,
        nodeId: n.id,
      })
    }
  }

  // loaded -- ЧИСТА похідна від problems, обчислена ПІСЛЯ дублів (branch-invalid і
  // ValidateNode вже в problems, дублі щойно додані): вузол дійсно потрапив би в
  // m_TechTree.Nodes сервера, лише якщо СЕРЕД УСІХ ПОКИ ЗІБРАНИХ problems немає жодного
  // alarm. ValidateGraph-рівень (Pass 3 нижче) додає ЛИШЕ 'warn' -- тому обчислення тут,
  // ДО Pass 3, дає той самий результат, що обчислення після (нема потреби рахувати двічі).
  for (const n of nodes) {
    n.loaded = !n.problems.some((p) => p.severity === 'alarm')
  }

  // byId -- ПЕРШИЙ побачений виграє (найближче до "якби завантаження не впало цілком"),
  // регістрозалежно (FindNode:69-77).
  const byId = new Map<string, TreeNodeView>()
  for (const n of nodes) {
    if (!byId.has(n.id)) byId.set(n.id, n)
  }

  // ---- Pass 3: ValidateGraph-рівень (:204-220), ЛИШЕ над loaded-вузлами ------------------
  const loadedNodes = nodes.filter((n) => n.loaded)
  const loadedById = new Map(loadedNodes.map((n) => [n.id, n]))

  // :208-211 -- nonexistent parent, ПЕР ПАРУ (вузол, батько); незалежно від того, чи цей
  // конкретний батько робить вузол недосяжним під ParentsMode="any" з іншими живими
  // батьками -- сервер друкує це попередження БЕЗУМОВНО для кожного відсутнього батька.
  for (const n of loadedNodes) {
    n.parents.forEach((p, i) => {
      if (loadedById.has(p)) return
      const msg = `вузол '${n.id}': батьківський вузол '${p}' не існує -- вузол недосяжний (ValidateGraph, ZP_TechTree.c:208-211)`
      n.problems.push({ path: `Parents[${i}]`, severity: 'warn', message: msg })
      problems.push({ kind: 'missing-parent', severity: 'warn', message: msg, nodeId: n.id })
    })
  }

  // :216-219 -- фікспойнт недосяжності.
  const unreachable = computeUnreachable(loadedNodes)
  for (const id of unreachable) {
    const n = loadedById.get(id)!
    const msg = `вузол '${id}' недосяжний (цикл або биті батьківські вузли) (ValidateGraph, ZP_TechTree.c:216-219)`
    n.problems.push({ path: 'Parents', severity: 'warn', message: msg })
    problems.push({ kind: 'unreachable', severity: 'warn', message: msg, nodeId: id })
  }

  // Розширення редактора: реальний шлях циклу серед недосяжних (сервер такого не друкує).
  const cyclePath = findCycleAmong(loadedById, unreachable)
  if (cyclePath) {
    const pathText = [...cyclePath, cyclePath[0]].join(' -> ')
    for (const id of cyclePath) {
      const n = loadedById.get(id)!
      n.problems.push({
        path: 'Parents',
        severity: 'warn',
        message: `цикл: ${pathText} (обчислено редактором понад ValidateGraph -- сервер такого шляху не друкує)`,
      })
    }
    problems.push({ kind: 'cycle', severity: 'warn', message: `цикл: ${pathText}`, nodeId: cyclePath[0] })
  }

  // ---- Фінальний статус: БІНАРНИЙ (T1-бриф) -- будь-яка причина (warn чи alarm) світить
  // alarm на полотні; повний severity лишається в problems[] для деталь-панелі.
  for (const n of nodes) {
    n.status = n.problems.length > 0 ? 'alarm' : 'ok'
  }

  return { branches, nodes, byId, problems }
}
