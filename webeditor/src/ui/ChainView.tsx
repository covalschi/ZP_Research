// ChainView — двудольне полотно «предмет -> станок -> предмет» (W2.6 Task 2, замінює
// правило-центричний вигляд W2 Task 5/9 + W2.5 Task 4 забракований власником прев'ю
// 2026-08-07). Адмін працює в термінах ГРИ (Яблуко -> Холодильник зразків -> Біозразок ->
// Мікроскоп -> Дані польової біології), а не в термінах JSON-файлу правил: вузли тепер
// або ПРЕДМЕТИ (сировина/зразок/заготовка з ігровим ім'ям), або СТАНКИ (фізичний прилад).
// Правило як окрема картка на полотні БІЛЬШЕ НЕ ІСНУЄ — модель станків
// (model/stationView.ts, T1) уже подає дані рівно в термінах "станок -> рядки", тут лише
// мапінг у React Flow.
//
// СТАНОК-ІНСТАНЦІЯ НА ПРАВИЛО (директива власника, ПІСЛЯ живого смоуку першої версії
// цього таска, 2026-08-07: на тому ланцюзі не було видно, що є результатом чого — хай
// станки дублюються в ланцюгах, аби це читалось наочно). Перша версія малювала ОДИН
// вузол станка на класнейм, що зливав УСІ його правила в один хаб —
// на скріншоті "Rag і Apple годують ОДНУ картку Холодильника" було неможливо простежити,
// яка сировина дала який результат, не трасуючи ребра. Тепер ідентичність вузла станка —
// (станок, ПРАВИЛО): один вузол-інстанція на кожен рядок (StationInputRow), з АГРЕГАТНИМИ
// даними станка (N входів/ролі/витратні — той самий вміст на кожній інстанції, бо "станок
// в основі один", директива п.3) і власним ruleId як другорядним текстом-розрізненням.
// Кожна лінія тепер читається як БЕЗПЕРЕРВНА доріжка зліва направо: `Apple -> Холодильник
// зразків (chain_pack_chimera) -> Біозразок(chimera_claw) -> Мікроскоп
// (chain_analyze_chimera) -> Дані...` — окремо від `Rag -> Холодильник зразків
// (chain_pack_bloodsucker) -> ...`. Ідентичність ПРЕДМЕТА лишається за струмом
// (classname+content, itemKey) — директива п.2 прямо це фіксує: лінії природно
// розходяться самим вмістом, а спільна сировина/результат законно розгалужує граф далі
// (elk сам розводить це по рядках, коли станки вже унікальні за рядком).
//
// Чисті хелпери (buildStationCanvas/toStationFlowElements/assignNodeKeys/
// computeBreakGeometry) лишаються експортовані й покриті tests/chainView.test.ts — той
// самий підхід колокації, що встановлено W2 Task 5: мапінг StationViewResult (T1) У
// структури, специфічні для @xyflow/react (Node/Edge), сам по собі нікому, крім цього
// полотна, не потрібен.
//
// buildStationCanvas НЕ реалізує МАТЧИНГ повторно (директива брифа Task 2): "чи предмет
// задовольняє вимогу" лишається виключно за matchInputMirror (chainGraph.ts) — сюди
// заходить лише ЧЕРЕЗ вже готові дані model/stationView.ts (рядки/призначення/потоки) і
// graph.breaks (chainGraph.ts). Єдине місце, де цей файл САМ порівнює предмети —
// itemKey() нижче, і це НЕ матчинг, а ІДЕНТИЧНІСТЬ вузла-предмета (той самий принцип,
// яким T1 дедуплікує producedStreams: лишерcase(classname)+lowercase(content), буквальний
// рядковий збіг, без IsKindOf-спадкування).

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  EdgeLabelRenderer,
  Handle,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react'
import type { Edge, EdgeProps, Node, NodeProps, NodeTypes, EdgeTypes } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
// Синхронна (не Worker) збірка elkjs -- дивись T5 звіт (Task 5, Step 1): `elk.bundled.js`
// завжди використовує вбудований синхронний "фейковий" воркер, жодного окремого
// worker-файлу для single-file збірки не з'являється.
import ELK from 'elkjs/lib/elk.bundled.js'
import type { ElkNode } from 'elkjs/lib/elk-api'

import type { Project } from '../io/project'
import type { ClassIndex } from '../model/classIndex'
import { displayNameOf, isKindOf, stripExact } from '../model/classIndex'
import { isSampleClass } from '../model/sampleContent'
import { buildChainGraph, asRuleLike } from '../model/chainGraph'
import type { ChainBreak, ChainBreakKind, ChainNode, RuleItemLike } from '../model/chainGraph'
import { buildStationView } from '../model/stationView'
import type { StationInfo, StationInputRow, StationRoles } from '../model/stationView'
// Резолв data-face (заготовки ZP_Data_*/зразки ZP_Sample_*) — model/faceResolve.ts (W2.6
// Task 1): реекспорт нижче — публічний API ЦЬОГО файлу (символи, якими вже користуються
// RulePanel.tsx/SampleTypesView.tsx/DataItemQuickEdit.tsx/tests) не змінився.
import {
  resolveDataItemFace,
  resolveSampleTypeFace,
} from '../model/faceResolve'

export { resolveDataItemFace, resolveSampleTypeFace }
export type { DataItemFace, SampleTypeFace } from '../model/faceResolve'

// ChainSelection (спадковий контракт W2 Task 5 "клік по картці правила -> RulePanel")
// ВИДАЛЕНИЙ у W2.6 Task 3: вікно станка (ui/StationWindow.tsx) ідентифікує розгорнутий
// рядок власним ключем filePath+ruleId, бічна панель RulePanel перетворена на вбудовувану
// RuleForm -- жодного споживача типу не лишилось (перевірено грепом по src/ і tests/).

export interface ChainViewProps {
  project: Project
  index: ClassIndex
  // T9: клік по data-face предмета-заготовки (ZP_Data_*) на полотні -- відкриває
  // DataItemQuickEdit (машинерія T9, БЕЗ ЗМІН у цьому тасці, лише джерело кліку інше:
  // раніше тег на картці правила, тепер сам предмет-вузол).
  onSelectOutput?: (classname: string) => void
  // W2.6 Task 2/3: клік по станку -- ЄДИНИЙ контракт, яким відкривається вікно станка
  // (App.tsx -> ui/StationWindow.tsx). Класнейм -- КАНОНІЧНИЙ (StationInfo.classname,
  // без "|N", перший побачений регістр, model/stationView.ts).
  onOpenStation?: (classname: string) => void
}

// ---- Композитні ключі ВУЗЛІВ ПРАВИЛА: лише для панелі дублікатів Id ------------------------
// assignNodeKeys/DuplicateGroup лишаються БЕЗ ЗМІН із W2 Task 5 -- дублікат Id це досі
// властивість ПРАВИЛА (chainGraph.ChainNode), не станка чи предмета, і адмін усе одно має
// про це знати (рушій відхилить такий конфіг). DuplicateWarning нижче й далі читає ЦЮ
// функцію напряму, повз новий двудольний вузловий простір.
export interface KeyedChainNode {
  key: string
  node: ChainNode
}

export interface DuplicateGroup {
  ruleId: string
  keys: string[]
  filePaths: string[]
}

export function assignNodeKeys(nodes: ChainNode[]): { keyed: KeyedChainNode[]; duplicates: DuplicateGroup[] } {
  const seenBase = new Map<string, number>()
  const keyed: KeyedChainNode[] = nodes.map((node) => {
    const base = `${node.filePath}::${node.ruleId}`
    const count = (seenBase.get(base) ?? 0) + 1
    seenBase.set(base, count)
    return { key: count === 1 ? base : `${base}#${count}`, node }
  })

  const byRuleId = new Map<string, KeyedChainNode[]>()
  for (const kn of keyed) {
    const list = byRuleId.get(kn.node.ruleId) ?? []
    list.push(kn)
    byRuleId.set(kn.node.ruleId, list)
  }
  const duplicates: DuplicateGroup[] = []
  for (const [ruleId, list] of byRuleId) {
    if (list.length < 2) continue
    duplicates.push({ ruleId, keys: list.map((x) => x.key), filePaths: [...new Set(list.map((x) => x.node.filePath))] })
  }
  return { keyed, duplicates }
}

// ---- Дані карток предмета/станка ------------------------------------------------------------

export type CanvasItemKind = 'raw' | 'sample' | 'dataItem'

// itemKey -- ідентичність предмета-вузла (W2.6 Task 2, п. "Item node identity" брифа):
// (класнейм.toLowerCase(), вміст.toLowerCase()) — ТОЙ САМИЙ ключ, яким T1 дедуплікує
// ProducedStream (stationView.ts, Фаза 5) -- буквальний рядковий збіг, БЕЗ IsKindOf-
// спадкування (це ідентичність вузла на полотні, не матчинг правил). Роздільник --
// нуль-байт (той самий захист від колізії конкатенації, що T1: "ab"+"c d" не збігається
// з "ab c"+"d"). Сировина без вмісту (Content="") отримує ключ "classname\u0000" --
// "raw world items keyed by classname" з брифа виконується автоматично, без спецкейса.
export function itemKey(classname: string, content: string): string {
  return `${classname.toLowerCase()}\u0000${content.toLowerCase()}`
}

export interface ItemCardData extends Record<string, unknown> {
  key: string
  // Сирий класнейм ЯК ЗБЕРЕЖЕНО у файлі (може нести "|N") -- перший побачений варіант
  // для цього ключа; резолв display нижче ЗАВЖДИ стрипає перед пошуком (як
  // resolveStationItemDisplay у stationView.ts), тому "|N" не заважає імені.
  classname: string
  content: string
  kind: CanvasItemKind
  display: string
  // raw -- завжди true (немає поняття "не налаштовано" для звичайної сировини: ігрове
  // ім'я береться з ClassIndex і завжди є, бодай фолбеком-класнеймом). sample/dataItem --
  // face.configured (є запис у SampleTypes.json/DataItems.json).
  configured: boolean
  duplicate: boolean
  enabled: boolean
}

// СТАНОК-ІНСТАНЦІЯ (директива власника 2026-08-07, ПІСЛЯ живого смоуку W2.6 Task 2):
// злитий вузол "один на класнейм станка" ховав спорідненість -- на скріншоті "Rag і
// Apple годують ОДНУ картку" не було видно, ЯКА сировина дала ЯКИЙ результат без
// трасування ребер крізь спільний хаб. Ідентичність вузла станка тепер (станок,
// ПРАВИЛО) -- один вузол-ІНСТАНЦІЯ на кожен рядок станка (StationInputRow), НЕ один на
// класнейм: `key` -- складений з filePath+ruleId (дивись buildStationCanvas,
// rowInstanceKey), `classname`/`display`/`inputCount`/`roles`/`consumablesCount`/
// `consumablesHint` лишаються АГРЕГАТНИМИ властивостями ЦІЛОГО станка (той самий вміст на
// КОЖНІЙ інстанції одного класнейму -- "дублювання візуальне, станок один в основі",
// директива п.3): клік по БУДЬ-ЯКІЙ інстанції веде в ТЕ САМЕ вікно станка (T3, за
// класнеймом). `ruleId` -- НОВЕ поле, другорядний текст-підказка на картці (директива
// п.1: "a small «×N» or file/rule hint is fine as secondary text") -- саме ЦЕ робить
// кожну інстанцію візуально розрізнюваною (яке саме правило тут стоїть), а разом з тим і
// сам composite-ключ (без видимого тексту два "Холодильник зразків" виглядали б як два
// клони без пояснення, чому їх два).
export interface StationCardData extends Record<string, unknown> {
  key: string // "station::<filePath>::<ruleId>" (+ "#N" на справжній колізії Id, дзеркало assignNodeKeys)
  classname: string
  display: string
  // Id ПРАВИЛА цієї конкретної інстанції -- другорядний текст на картці, що
  // розрізняє інстанції одного станка візуально.
  ruleId: string
  // Кількість рядків СТАНКА (stationView.StationInfo.inputRows.length) -- УСІ, і
  // увімкнені, і вимкнені; АГРЕГАТ, той самий на кожній інстанції ЦЬОГО класнейму
  // (той самий структурний принцип, що roles: "скільки правил тут визначено загалом",
  // а не "скільки на ЦІЙ конкретній картці").
  inputCount: number
  roles: StationRoles
  // Витратні (Consumables) -- АГРЕГАТ по УСІХ рядках станка (той самий "усі рядки", що
  // inputCount/roles), той самий на кожній інстанції. W2.5 хвіст "лица для
  // Consumables-строк" закривається на МІНІМАЛЬНІЙ видимості тут (повні рядки -- вікно
  // станка, T3): лічильник непорожніх Consumables[].Classname + резолвлені ігрові імена
  // в тултипі бейджа (consumablesHint).
  consumablesCount: number
  consumablesHint: string
}

// GhostCardData -- ПОВНІСТЮ той самий контракт, що W2 Task 5 (dashed-контур + hazard-
// штрихування, DESIGN.md §6): "ghost предмет-узла" з брифа Task 2 буквально ПЕРЕВИКОРИСТОВУЄ
// цей компонент, лише перепризначаючи джерело/ціль ребра з рівня "картка правила" на
// рівень "предмет/станок" (дивись buildStationCanvas нижче) -- жодної другої версії
// ghost-картки не заводиться.
export interface GhostCardData extends Record<string, unknown> {
  key: string
  kind: ChainBreakKind
  classname: string
  content: string
  message: string
}

export const STATION_CARD_WIDTH = 210
const STATION_CARD_HEIGHT = 100
export const ITEM_CARD_WIDTH = 210
const ITEM_CARD_HEIGHT = 60
// Зразок несе додатковий рядок ("вміст приховано" +, за наявності, content-mark) --
// трохи вища картка, щоб elk-розкладка не тіснила текст.
const SAMPLE_ITEM_CARD_HEIGHT = 82
export const GHOST_CARD_WIDTH = 200
export const GHOST_CARD_HEIGHT = 84

export function estimateItemCardHeight(kind: CanvasItemKind): number {
  return kind === 'sample' ? SAMPLE_ITEM_CARD_HEIGHT : ITEM_CARD_HEIGHT
}

// resolveCanvasItemFace -- те САМЕ трипрохідне визначення "що це за предмет", що
// resolveStationItemDisplay (stationView.ts): родина ZP_Sample_Base -> SampleTypes.json,
// родина ZP_Data_Base -> DataItems.json, інакше -- звичайний ClassIndex.displayNameOf.
// НЕ дублює stationView.resolveStationItemDisplay буквально (та функція повертає лише
// {display,isSample} -- Task 1 не потребував configured/duplicate/enabled для рядків
// станка), тут потрібні ПОВНІ поля обличчя для алярм-стилізації "unconfigured-family"
// (превью власника) -- звідси окрема, трохи ширша версія, а не другий виклик тієї самої
// функції з подальшим окремим resolveSampleTypeFace/resolveDataItemFace (це й так були б
// два виклики або тут, або там -- дублювання неминуче на рівні "викликати face-резолвер",
// різниця лише в тому, ЩО з відповіді читається).
function resolveCanvasItemFace(
  project: Project,
  index: ClassIndex,
  rawClassname: string,
): { kind: CanvasItemKind; display: string; configured: boolean; duplicate: boolean; enabled: boolean } {
  const cls = stripExact(rawClassname).trim()
  if (isSampleClass(index, cls)) {
    const face = resolveSampleTypeFace(project, index, cls)
    return { kind: 'sample', display: face.name, configured: face.configured, duplicate: face.duplicate, enabled: face.enabled }
  }
  if (isKindOf(index, cls, 'ZP_Data_Base')) {
    const face = resolveDataItemFace(project, index, cls)
    return { kind: 'dataItem', display: face.name, configured: face.configured, duplicate: face.duplicate, enabled: face.enabled }
  }
  return { kind: 'raw', display: displayNameOf(index, cls), configured: true, duplicate: false, enabled: true }
}

// ---- StationCanvasModel: StationView (T1) + ChainGraph (розриви) -> двудольний граф -------

export interface FlowEdgeSpec {
  id: string
  sourceKey: string
  targetKey: string
  classname: string
  content: string
}

export interface BreakEdgeSpec extends FlowEdgeSpec {
  kind: ChainBreakKind
}

// BreakTarget -- один на КОЖЕН запис graph.breaks (той самий порядок), для панелі
// розривів: куди камері центруватись при кліку. На відміну від W2 Task 5
// (resolveBreakCardKeys, що резолвив ГІПОТЕТИЧНО кілька карток-близнюків через дублікат
// Id правила), тут ціль ЗАВЖДИ рівно один реальний вузол -- станок-ІНСТАНЦІЯ ЦЬОГО
// КОНКРЕТНОГО рядка (unfed-input: instanceKey, однозначно визначений через filePath+
// ruleId рядка -- директива власника про дублювання станків зробила це ЩЕ точнішим:
// раніше ціль була "якась" інстанція станка, тепер це РІВНО ТОЙ рядок, що вимагає) або
// предмет (dead-output: сам ключ classname+content, той самий, що itemKey зверху).
// centerKey===undefined -- рядок правила без Device (задокументована межа T1,
// "Занепокоєння 2": рядок без Device не потрапляє в ЖОДЕН станок) -- кнопка панелі
// дизейблиться, як і раніше при "нема цілі".
export interface BreakTarget {
  message: string
  kind: ChainBreakKind
  centerKey: string | undefined
}

export interface StationCanvasModel {
  stationCards: StationCardData[]
  itemCards: ItemCardData[]
  ghostCards: GhostCardData[]
  edges: FlowEdgeSpec[]
  breakEdges: BreakEdgeSpec[]
  breakTargets: BreakTarget[]
  duplicates: DuplicateGroup[]
}

// ---- resolveBreakOwner: чий саме рядок ЦЕЙ КОНКРЕТНИЙ розрив (fix-round-1, IMPORTANT 1) ----
//
// СИМПТОМ РЕВ'Ю (ВІДТВОРЕНО): справжній дублікат Id В ОДНОМУ файлі (той самий Device --
// найтиповіший випадок, напр. copy-paste рядка з новим Content, але забутим Id) --
// СТАРИЙ ownerByRow (Map<string,string>, побудований `.set()` на ключ "filePath::ruleId")
// колізував: другий `.set()` тихо перезаписував першого, і ОБИДВА розриви близнюків
// (кожен вимагає СВІЙ Content, тому в chainGraph.ts генеруються ДВОМА окремими записами
// graph.breaks) резолвились в ОСТАННЮ інстанцію -- перший близнюк лишався взагалі БЕЗ
// break-ребра, ніби в нього все гаразд.
//
// ФІКС: rowsByBaseKey несе МАСИВ кандидатів на (filePath,ruleId) замість одного значення.
// Коли кандидат рівно один (99% випадків -- Id НЕ дубльований) -- тривіально, без жодної
// структурної перевірки. Коли кандидатів 2+ (справжній дублікат): дізамбігуація за
// СТРУКТУРНИМ збігом (classname,content) розриву З ВЛАСНИМИ полями кандидата --
// dead-output звіряє з row.outputs (вихід ЦЬОГО рядка), unfed-input звіряє з
// InputItem (row.rawClassname/rawContent) АБО будь-яким Consumables[i] (raw rule.
// Consumables, StationInputRow їх не несе -- звідси окремий параметр consumables).
// Це НЕ повторний матчинг MatchInput/matchInputMirror (порівняння предмета з ІНШИМ
// предметом за класом+вмістом через IsKindOf) -- це звірка "чиє це ВЛАСНЕ поле",
// буквальна рівність рядків, той самий принцип, що itemKey() вище.
//
// Якщо структурний збіг НЕОДНОЗНАЧНИЙ (0 чи 2+ кандидатів -- напр. обидва близнюки мають
// БУКВАЛЬНО ідентичний вихід/вхід, не лише однаковий Id) -- чесний послідовний fallback
// (той самий дух "показуємо ВСІХ підозрюваних по черзі", що W2 Task 5
// resolveBreakCardKeys для свого найгіршого випадку): курсор на (filePath,ruleId)
// просувається на кожен неоднозначний виклик, розподіляючи розриви МІЖ кандидатами
// круговим чином, а не завжди в одного й того самого (як робив старий баг).
function resolveBreakOwner(
  b: ChainBreak,
  candidates: { instanceKey: string; row: StationInputRow; consumables: RuleItemLike[] }[],
  ambiguousCursor: Map<string, number>,
): string | undefined {
  if (candidates.length === 0) return undefined
  if (candidates.length === 1) return candidates[0].instanceKey

  const matched = candidates.filter((c) => {
    if (b.kind === 'dead-output') {
      return c.row.outputs.some((o) => o.classname === b.classname && o.content === b.content)
    }
    return (
      (c.row.rawClassname === b.classname && c.row.rawContent === b.content) ||
      c.consumables.some((cm) => cm.Classname === b.classname && cm.Content === b.content)
    )
  })
  if (matched.length === 1) return matched[0].instanceKey

  // Неоднозначно (0 чи 2+ структурних збігів) -- круговий fallback.
  const baseKey = `${b.filePath}::${b.ruleId}`
  const cursor = ambiguousCursor.get(baseKey) ?? 0
  ambiguousCursor.set(baseKey, cursor + 1)
  return candidates[cursor % candidates.length].instanceKey
}

export function buildStationCanvas(project: Project, index: ClassIndex): StationCanvasModel {
  const view = buildStationView(project, index)
  // buildChainGraph тут -- ДРУГИЙ виклик у цьому дереві викликів (buildStationView сам
  // викликає його всередині, T1 звіт: "повторний виклик buildChainGraph тут ДЕШЕВИЙ").
  // Потрібен НАПРЯМУ (не лише крізь StationViewResult) заради ТРЬОХ речей, яких T1
  // навмисно НЕ віддає назовні: graph.breaks (розриви -- своя семантика, за межами
  // "рядок станка"), rule.Consumables (T1 їх взагалі не несе в StationInputRow -- лише
  // InputItem/Outputs), і graph.nodes для панелі дублікатів Id (assignNodeKeys).
  const graph = buildChainGraph(project, index)
  const { duplicates } = assignNodeKeys(graph.nodes)

  // ---- станок-ІНСТАНЦІЯ на кожен рядок (директива власника: "видно наглядно, що є
  // результатом чого" -- злитий вузол "один на класнейм" ховав спорідненість між
  // конкретною сировиною і конкретним результатом). Один запис rowEntries на КОЖЕН
  // StationInputRow, у ІСТИННОМУ порядку graph.nodes (файл-пріоритет + порядок у файлі) --
  // НЕ станок-мажорному обході view.stations[].inputRows, яким це рахувалось до фікс-
  // раунду 1: той обхід групує рядки ЗА СТАНКОМ ПЕРШИМ (усі рядки станка A, потім усі
  // рядки станка B, ...), а НЕ за позицією в файлі -- для двох близнюків з РІЗНИМ Device
  // (той самий Id, різний прилад) це давало instanceKey/consumables-прив'язку, не
  // узгоджену зі справжнім порядком, у якому chainGraph.ts генерує graph.breaks.
  //
  // Один прохід по graph.nodes (fix-round-1, IMPORTANT 1): для КОЖНОГО вузла з валідним
  // Device підбираємо ЙОГО ВЛАСНУ StationInputRow через лічильник-покажчик "скільки
  // рядків ЦЬОГО станка вже відвідано" (stationRowPtr) -- T1 гарантує, що
  // station.inputRows зберігає порядок graph.nodes ВСЕРЕДИНІ одного станка (Фаза 2,
  // ZP_Research/webeditor/src/model/stationView.ts), тож n-те відвідування станка X у
  // ІСТИННОМУ порядку графа ЗАВЖДИ відповідає station.inputRows[n] -- навіть коли двоє
  // правил з ОДНАКОВИМ Id стоять в ОДНОМУ файлі й на ОДНОМУ станку. instanceKey --
  // composite filePath+ruleId з лічильником-суфіксом "#N" на справжню колізію Id (дзеркало
  // assignNodeKeys, тепер рахований по ТІЙ САМІЙ ІСТИННІЙ послідовності). Заодно (той самий
  // прохід) збираємо raw rule.Consumables на рядок -- потрібні і для агрегату
  // consumablesByStation (без окремого O(рядків²) `.find()`-проходу, який був тут ДО
  // фікс-раунду 1), і для дізамбігуації розривів нижче.
  const stationRowPtr = new Map<string, number>()
  const seenRowBase = new Map<string, number>()
  const rowEntries: { st: StationInfo; row: StationInputRow; instanceKey: string; consumables: RuleItemLike[] }[] = []
  const consumablesByStation = new Map<string, { count: number; names: Set<string> }>()
  for (const n of graph.nodes) {
    const rule = asRuleLike(n.rule)
    if (!rule) continue
    const deviceCls = stripExact(rule.Device).trim()
    if (deviceCls === '') continue // рядок без Device -- нема куди приєднати (T1)
    const stationLower = deviceCls.toLowerCase()
    const st = view.byClassname.get(stationLower)
    if (!st) continue // не повинно статись -- захист від дрейфу (той самий принцип, що T1 Фаза 2)

    const ptr = stationRowPtr.get(stationLower) ?? 0
    stationRowPtr.set(stationLower, ptr + 1)
    const row = st.inputRows[ptr]
    if (!row) continue // захист -- не повинно статись, якщо T1-інваріант "порядок = graph.nodes" тримається

    const base = `station::${n.filePath}::${n.ruleId}`
    const count = (seenRowBase.get(base) ?? 0) + 1
    seenRowBase.set(base, count)
    const instanceKey = count === 1 ? base : `${base}#${count}`

    rowEntries.push({ st, row, instanceKey, consumables: rule.Consumables })

    // Витратні -- АГРЕГАТ по УСІХ рядках СТАНКА (увімкнених і вимкнених, той самий
    // структурний принцип, що inputCount/roles), ключ -- classname станка (не
    // instanceKey рядка): значення ОДНАКОВЕ на кожній інстанції одного станка (директива
    // п.3: "duplication is visual, the underlying station is one").
    const bucket = consumablesByStation.get(stationLower) ?? { count: 0, names: new Set<string>() }
    for (const c of rule.Consumables) {
      if (c.Classname.trim() === '') continue
      bucket.count++
      bucket.names.add(resolveCanvasItemFace(project, index, c.Classname).display)
    }
    consumablesByStation.set(stationLower, bucket)
  }

  // ---- rowsByBaseKey: filePath::ruleId -> УСІ кандидати-рядки з цим ключем (fix-round-1,
  // IMPORTANT 1) -- на відміну від СТАРОГО ownerByRow (Map<string,string>, один-до-одного),
  // ЦЕ Map<string, кандидат[]>: справжній дублікат Id В ОДНОМУ файлі дає МАСИВ з 2+
  // кандидатів замість того, щоб другий .set() тихо стирав першого (симптом рев'ю: обидва
  // близнюки-розриви резолвились в ОСТАННЮ інстанцію, перша лишалась без жодного
  // break-ребра). Дізамбігуація -- у циклі розривів нижче, resolveBreakOwner.
  const rowsByBaseKey = new Map<string, { instanceKey: string; row: StationInputRow; consumables: RuleItemLike[] }[]>()
  for (const { row, instanceKey, consumables } of rowEntries) {
    const key = `${row.filePath}::${row.ruleId}`
    const list = rowsByBaseKey.get(key) ?? []
    list.push({ instanceKey, row, consumables })
    rowsByBaseKey.set(key, list)
  }

  const stationCards: StationCardData[] = rowEntries.map(({ st, row, instanceKey }) => {
    const cons = consumablesByStation.get(st.classname.toLowerCase())
    return {
      key: instanceKey,
      classname: st.classname,
      display: st.display,
      ruleId: row.ruleId,
      inputCount: st.inputRows.length,
      roles: st.roles,
      consumablesCount: cons?.count ?? 0,
      consumablesHint: cons ? [...cons.names].join(', ') : '',
    }
  })

  // ---- предмети + звичайні ребра (item<->станок-ІНСТАНЦІЯ) ----------------------------------
  // Ідентичність предмета лишається ЗА СТРУМОМ (classname+content, itemKey) -- НЕ за
  // рядком/лінією: директива п.2 прямо каже "Item nodes stay keyed per stream" --
  // предмети РІЗНИХ ліній природно розходяться самим вмістом (chimera_claw проти
  // bloodsucker_gland), а спільна сировина/спільний проміжний результат (якщо колись
  // трапиться) законно розгалужує/зливає лінії далі по графу -- elk-розкладка (layered
  // LR) сама розводить це по рядках, коли вузли станка вже унікальні за рядком.
  const itemsByKey = new Map<string, ItemCardData>()
  function ensureItem(rawClassname: string, rawContent: string): ItemCardData {
    const key = itemKey(rawClassname, rawContent)
    let card = itemsByKey.get(key)
    if (!card) {
      const face = resolveCanvasItemFace(project, index, rawClassname)
      card = { key, classname: rawClassname, content: rawContent, ...face }
      itemsByKey.set(key, card)
    }
    return card
  }

  const edges: FlowEdgeSpec[] = []
  const edgeIds = new Set<string>()
  function addEdge(sourceKey: string, targetKey: string, classname: string) {
    const id = `edge::${sourceKey}=>${targetKey}`
    if (edgeIds.has(id)) return // захист від теоретичного дубля (той самий вихід двічі в одному рядку) -- не мало б статись, але не шкодить
    edgeIds.add(id)
    // content НЕ передається в edge-дані (порожній рядок): позначку вмісту показує САМ
    // предмет-вузол (content-mark, ItemCardNode нижче), не ребро.
    edges.push({ id, sourceKey, targetKey, classname, content: '' })
  }

  // unfed-input -- ГЛОБАЛЬНА властивість пари (класнейм,вміст), не властивість
  // КОНКРЕТНОГО рядка: matchInputMirror (chainGraph.ts) порівнює лише req.Classname/
  // req.Content проти виходів усіх увімкнених правил -- результат ідентичний для БУДЬ-
  // ЯКОГО рядка з тим самим (класнейм,вміст). Тому набір "не годується ніким" -- це
  // просто множина itemKey() з усіх unfed-input розривів.
  const unfedKeys = new Set<string>()
  for (const b of graph.breaks) {
    if (b.kind !== 'unfed-input') continue
    unfedKeys.add(itemKey(b.classname, b.content))
  }

  for (const { row, instanceKey } of rowEntries) {
    // "disabled rules: their item flow absent" (бриф T2) -- вимкнений рядок НЕ додає ані
    // вхідного, ані вихідного ребра, і НЕ породжує предмет-вузол сам по собі (якщо той
    // самий предмет фігурує деінде в УВІМКНЕНОМУ рядку -- він однаково з'явиться звідти).
    // Сама КАРТКА-ІНСТАНЦІЯ станка (вище) для вимкненого рядка ІСНУЄ (адмін бачить
    // структуру), лише без жодного ребра в/з неї.
    if (row.disabled) continue

    if (row.rawClassname.trim() !== '') {
      const key = itemKey(row.rawClassname, row.rawContent)
      if (!unfedKeys.has(key)) {
        const item = ensureItem(row.rawClassname, row.rawContent)
        addEdge(item.key, instanceKey, item.classname)
      }
      // Якщо ключ у unfedKeys -- звичайне ребро НЕ малюється тут: ghost-предмет і
      // break-ребро додаються нижче окремим проходом по graph.breaks.
    }

    // Вихід рядка -- ЗАВЖДИ реальне ребро (структурний факт "ЦЕЙ рядок виробляє
    // предмет"), НЕЗАЛЕЖНО від того, чи хтось це споживає -- dead-output (нижче) додає
    // ДОДАТКОВИЙ обірваний "хвіст" ПОВЕРХ цього реального ребра, а не замінює його.
    for (const o of row.outputs) {
      if (o.classname.trim() === '') continue
      const item = ensureItem(o.classname, o.content)
      addEdge(instanceKey, item.key, item.classname)
    }
  }

  // ---- розриви: ghost-предмет-вузли + break-ребра (DESIGN.md §6, перенесений підпис) -------
  const ghostCards: GhostCardData[] = []
  const breakEdges: BreakEdgeSpec[] = []
  const breakTargets: BreakTarget[] = []
  const ambiguousCursor = new Map<string, number>()
  let ghostSeq = 0
  for (const b of graph.breaks) {
    const candidates = rowsByBaseKey.get(`${b.filePath}::${b.ruleId}`) ?? []
    const owner = resolveBreakOwner(b, candidates, ambiguousCursor)
    if (!owner) {
      // Рядок без Device -- нема куди приєднати ні ghost, ні ціль центрування
      // (задокументована межа T1, "Занепокоєння 2"). Панель усе одно показує ПОВІДОМЛЕННЯ
      // (адмін бачить ТЕКСТ розриву), лише кнопка "центрувати" дизейблена.
      breakTargets.push({ message: b.message, kind: b.kind, centerKey: undefined })
      continue
    }
    ghostSeq++
    const ghostKey = `ghost::${b.kind}::${ghostSeq}`
    ghostCards.push({ key: ghostKey, kind: b.kind, classname: b.classname, content: b.content, message: b.message })
    if (b.kind === 'unfed-input') {
      // Примара-виробник (нічого не виробляє) -> станок, що вимагає -- ghost на джерелі,
      // дзеркало напрямку Handle у GhostCardNode (isUpstream).
      breakEdges.push({ id: `break::${ghostKey}`, sourceKey: ghostKey, targetKey: owner, classname: b.classname, content: b.content, kind: b.kind })
      breakTargets.push({ message: b.message, kind: b.kind, centerKey: owner }) // центруємо на РЕАЛЬНОМУ станку -- завжди існує, однозначний
    } else {
      // dead-output: реальний предмет-вузол (ВЖЕ створений вище через вихідне ребро
      // станка-виробника, бо dead-output триггериться лише для УВІМКНЕНОГО рядка з
      // непорожнім Content на виході -- рівно та умова, за якою вище безумовно
      // виконався ensureItem) -> ghost "ніхто не бере далі".
      const realKey = itemKey(b.classname, b.content)
      breakEdges.push({ id: `break::${ghostKey}`, sourceKey: realKey, targetKey: ghostKey, classname: b.classname, content: b.content, kind: b.kind })
      breakTargets.push({ message: b.message, kind: b.kind, centerKey: realKey }) // центруємо на РЕАЛЬНОМУ предметі, не на ghost
    }
  }

  return { stationCards, itemCards: [...itemsByKey.values()], ghostCards, edges, breakEdges, breakTargets, duplicates }
}

// ---- StationCanvasModel -> вузли/ребра React Flow (позиції {0,0} -- виставить elk) ---------

export type StationFlowNode = Node<StationCardData, 'stationNode'>
export type ItemFlowNode = Node<ItemCardData, 'itemNode'>
export type GhostFlowNode = Node<GhostCardData, 'ghostNode'>
export type ChainFlowNode = StationFlowNode | ItemFlowNode | GhostFlowNode

export type ChainEdgeData = { classname: string; content: string }
export type BreakEdgeData = { kind: ChainBreakKind; classname: string; content: string }
export type ChainFlowEdge = Edge<ChainEdgeData, 'chainEdge'> | Edge<BreakEdgeData, 'breakEdge'>

export function toStationFlowElements(model: StationCanvasModel): { nodes: ChainFlowNode[]; edges: ChainFlowEdge[] } {
  const nodes: ChainFlowNode[] = []
  for (const st of model.stationCards) {
    nodes.push({ id: st.key, type: 'stationNode', data: st, position: { x: 0, y: 0 }, width: STATION_CARD_WIDTH, height: STATION_CARD_HEIGHT })
  }
  for (const item of model.itemCards) {
    nodes.push({ id: item.key, type: 'itemNode', data: item, position: { x: 0, y: 0 }, width: ITEM_CARD_WIDTH, height: estimateItemCardHeight(item.kind) })
  }
  for (const ghost of model.ghostCards) {
    nodes.push({ id: ghost.key, type: 'ghostNode', data: ghost, position: { x: 0, y: 0 }, width: GHOST_CARD_WIDTH, height: GHOST_CARD_HEIGHT })
  }

  const edges: ChainFlowEdge[] = []
  for (const e of model.edges) {
    edges.push({ id: e.id, source: e.sourceKey, target: e.targetKey, type: 'chainEdge', data: { classname: e.classname, content: e.content } })
  }
  for (const b of model.breakEdges) {
    edges.push({
      id: b.id,
      source: b.sourceKey,
      target: b.targetKey,
      type: 'breakEdge',
      data: { kind: b.kind, classname: b.classname, content: b.content },
    })
  }
  return { nodes, edges }
}

// ---- elk-розкладка (layered, LR) -- БЕЗ ЗМІН із W2 Task 5: генеричний контракт
// (id/width/height, id/source/target) не залежить від того, ЩО саме зображує вузол. -------

const elk = new ELK()

export async function layoutFlowNodes(nodes: ChainFlowNode[], edges: ChainFlowEdge[]): Promise<Map<string, { x: number; y: number }>> {
  if (nodes.length === 0) return new Map()
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.layered.spacing.nodeNodeBetweenLayers': '110',
      'elk.spacing.nodeNode': '32',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    },
    children: nodes.map((n) => ({ id: n.id, width: n.width ?? ITEM_CARD_WIDTH, height: n.height ?? ITEM_CARD_HEIGHT })),
    edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  }
  const result = await elk.layout(graph)
  const positions = new Map<string, { x: number; y: number }>()
  for (const child of result.children ?? []) {
    positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 })
  }
  return positions
}

// ---- Геометрія розриву (DESIGN.md §6) -- БЕЗ ЗМІН із W2 Task 5 ------------------------------

const BREAK_GAP = 24
const BREAK_TICK = 6

export interface BreakGeometry {
  stub1: { x1: number; y1: number; x2: number; y2: number }
  tick1: { x1: number; y1: number; x2: number; y2: number }
  stub2: { x1: number; y1: number; x2: number; y2: number }
  tick2: { x1: number; y1: number; x2: number; y2: number }
  lampX: number
  lampY: number
}

export function computeBreakGeometry(sx: number, sy: number, tx: number, ty: number): BreakGeometry {
  const dx = tx - sx
  const dy = ty - sy
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const px = -uy
  const py = ux
  const half = BREAK_GAP / 2
  const midX = (sx + tx) / 2
  const midY = (sy + ty) / 2
  const aX = midX - ux * half
  const aY = midY - uy * half
  const bX = midX + ux * half
  const bY = midY + uy * half
  const halfTick = BREAK_TICK / 2
  return {
    stub1: { x1: sx, y1: sy, x2: aX, y2: aY },
    tick1: { x1: aX - px * halfTick, y1: aY - py * halfTick, x2: aX + px * halfTick, y2: aY + py * halfTick },
    stub2: { x1: bX, y1: bY, x2: tx, y2: ty },
    tick2: { x1: bX - px * halfTick, y1: bY - py * halfTick, x2: bX + px * halfTick, y2: bY + py * halfTick },
    lampX: midX,
    lampY: midY,
  }
}

// ---- pluralizeInputs: "N вхід/входи/входів" -- звичайна слов'янська плюралізація ------------

export function pluralizeInputs(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} вхід`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} входи`
  return `${n} входів`
}

// ---- Презентація: картка станка ------------------------------------------------------------
// Клікабельність -- НЕ окрема кнопка всередині (немає конфлікту stopPropagation, на
// відміну від W2 Task 9 DataFaceTag, де тег сидів УСЕРЕДИНІ картки правила): станок і
// предмет -- ОКРЕМІ, непересічні типи вузлів React Flow, тому клік по картці станка ловить
// один спільний handleNodeClick у ChainViewInner нижче -- жодного per-node колбека в пропах
// САМЕ ЦЬОГО компонента не потрібно. ВИПРАВЛЕНО (W2.6-фінал, фінальне ревʼю, мінор b):
// nodeTypes НЕ модульна константа -- це useMemo нижче (ChainViewInner, :912-919), бо
// itemNode обгортає ItemCardNode замиканням на onSelectOutput (пропс компонента) і мусить
// перебудовуватись, коли той міняється; лише сама картка станка (без такого замикання) не
// потребує per-node колбека.

function StationCardNode({ data }: NodeProps<StationFlowNode>) {
  return (
    <div className="station-card" title={`${data.classname} — ${data.ruleId}`}>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <div className="station-card-name">{data.display}</div>
      {/* Класнейм + Id ПРАВИЛА цієї інстанції -- директива власника про дублювання
          станків: другорядний текст, що розрізняє інстанції одного класнейму на
          сусідніх лініях (без нього два "Холодильник зразків" виглядали б як
          нез'ясовні клони). */}
      <code className="station-card-class">
        {data.classname} · {data.ruleId}
      </code>
      <div className="station-card-meta">
        <span>{pluralizeInputs(data.inputCount)}</span>
        {data.roles.packer && <span className="station-role-badge">пакувальник</span>}
        {data.roles.analyzer && <span className="station-role-badge">аналізатор</span>}
      </div>
      {data.consumablesCount > 0 && (
        <span className="station-consumables-badge" title={`Витратні: ${data.consumablesHint}`}>
          + витратні: {data.consumablesCount}
        </span>
      )}
      <span className="station-configure-hint">налаштувати →</span>
    </div>
  )
}

// ---- Презентація: картка предмета ----------------------------------------------------------
// Трилампова граматика "дубль / не налаштовано / налаштовано" — ТА САМА, що DataFaceTag/
// SampleFaceTag (W2/W2.5), тепер застосована до цілого вузла-предмета замість інлайн-тегу
// на картці правила. raw ЗАВЖДИ третій, "спокійний" стан (displayNameOf ніколи не дає
// "не налаштовано" -- ігрове ім'я або є в ClassIndex, або фолбек = сам класнейм).
function ItemCardNode({ data, onSelectOutput }: NodeProps<ItemFlowNode> & { onSelectOutput?: (classname: string) => void }) {
  const clickableDataItem = data.kind === 'dataItem'
  const classes = ['item-node', `item-node-${data.kind}`]
  if (data.duplicate) classes.push('item-node-duplicate')
  else if (data.kind !== 'raw' && !data.configured) classes.push('item-node-unconfigured')
  if (data.kind !== 'raw' && data.configured && !data.enabled) classes.push('item-node-disabled')
  if (clickableDataItem) classes.push('item-node-clickable')

  function handleClick(e: ReactMouseEvent) {
    if (!clickableDataItem) return
    e.stopPropagation() // не пускаємо клік у onNodeClick станка/предмета -- сам собі ціль
    onSelectOutput?.(stripExact(data.classname))
  }

  return (
    <div className={classes.join(' ')} title={data.classname} onClick={handleClick}>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      {data.duplicate ? (
        <>
          <code className="item-node-classname">{data.classname}</code>
          <span className="item-node-badge item-node-badge-alarm">дубль Id</span>
        </>
      ) : data.kind !== 'raw' && !data.configured ? (
        <>
          <code className="item-node-classname">{data.classname}</code>
          <span className="item-node-badge">не налаштовано</span>
        </>
      ) : (
        <div className="item-node-name-row">
          <span className="item-node-name">{data.display}</span>
          {data.kind !== 'raw' && <span className={`lamp ${data.enabled ? 'lamp-ok' : 'lamp-warn'}`} aria-hidden="true" />}
        </div>
      )}
      {data.kind === 'sample' && (
        <div className="item-node-sample-row">
          {data.content && <span className="content-mark">{data.content}</span>}
          <span className="item-node-hint">вміст приховано</span>
        </div>
      )}
    </div>
  )
}

// ---- Презентація: картка-привид (DESIGN.md §6) -- БЕЗ ЗМІН із W2 Task 5 --------------------

function GhostCardNode({ data }: NodeProps<GhostFlowNode>) {
  const isUpstream = data.kind === 'unfed-input'
  return (
    <div className="ghost-card hazard" title={data.message}>
      {isUpstream ? <Handle type="source" position={Position.Right} /> : <Handle type="target" position={Position.Left} />}
      <span className="ghost-card-label label">Відсутній вузол</span>
      <code className="ghost-card-class">{data.classname || '—'}</code>
      {data.content && <span className="content-mark">{data.content}</span>}
    </div>
  )
}

// ---- Ребро: цілий провідник -- БЕЗ ЗМІН із W2 Task 5 (data.content тепер завжди порожній
// для звичайних ребер -- мітка просто не рендериться, дивись коментар addEdge вище) --------

function ChainEdgeView({ sourceX, sourceY, targetX, targetY, data }: EdgeProps<Edge<ChainEdgeData, 'chainEdge'>>) {
  const midX = (sourceX + targetX) / 2
  const path = `M ${sourceX} ${sourceY} L ${midX} ${sourceY} L ${midX} ${targetY} L ${targetX} ${targetY}`
  const labelX = midX
  const labelY = (sourceY + targetY) / 2
  return (
    <>
      <path d={path} className="chain-edge-path" fill="none" markerEnd="url(#zp-chain-arrow)" />
      {data?.content && (
        <EdgeLabelRenderer>
          <div
            className="chain-edge-label"
            style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: 'none' }}
          >
            <code>{data.content}</code>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

// ---- Ребро: РОЗРИВ ЛАНЦЮГА -- підпис-елемент дизайну (DESIGN.md §6) -- БЕЗ ЗМІН -------------

function BreakEdgeView({ sourceX, sourceY, targetX, targetY }: EdgeProps<Edge<BreakEdgeData, 'breakEdge'>>) {
  const g = computeBreakGeometry(sourceX, sourceY, targetX, targetY)
  const stubPath = (s: BreakGeometry['stub1']) => `M ${s.x1} ${s.y1} L ${s.x2} ${s.y2}`
  return (
    <g className="break-edge">
      <path d={stubPath(g.stub1)} className="break-edge-stub" fill="none" />
      <line x1={g.tick1.x1} y1={g.tick1.y1} x2={g.tick1.x2} y2={g.tick1.y2} className="break-edge-tick" />
      <path d={stubPath(g.stub2)} className="break-edge-stub" fill="none" />
      <line x1={g.tick2.x1} y1={g.tick2.y1} x2={g.tick2.x2} y2={g.tick2.y2} className="break-edge-tick" />
      <circle cx={g.lampX} cy={g.lampY} r={4} className="break-lamp-fill" />
      <circle cx={g.lampX} cy={g.lampY} r={5} className="break-lamp-ring" />
      <circle cx={g.lampX} cy={g.lampY} r={7} className="break-lamp-outer" />
      <text x={g.lampX} y={g.lampY + 20} textAnchor="middle" className="break-edge-label">
        РОЗРИВ
      </text>
    </g>
  )
}

const edgeTypes: EdgeTypes = { chainEdge: ChainEdgeView, breakEdge: BreakEdgeView }

// ---- Панелі: дублікати Id + список розривів --------------------------------------------------

function DuplicateWarning({ duplicates }: { duplicates: DuplicateGroup[] }) {
  if (duplicates.length === 0) return null
  return (
    <Panel position="top-left" className="chain-panel duplicate-warning">
      <span className="lamp lamp-alarm" aria-hidden="true" />
      <span>
        Дублікат Id{' '}
        {duplicates.map((d, i) => (
          <span key={d.ruleId}>
            {i > 0 && '; '}
            <code>{d.ruleId}</code> у {d.filePaths.join(', ')}
          </span>
        ))}{' '}
        — рушій відхилить такий конфіг; правку шукайте у вікні відповідного станка.
      </span>
    </Panel>
  )
}

function BreaksPanel({ breakTargets, onCenter }: { breakTargets: BreakTarget[]; onCenter: (key: string) => void }) {
  if (breakTargets.length === 0) {
    return (
      <Panel position="top-right" className="chain-panel breaks-panel ok">
        <span className="lamp lamp-ok" aria-hidden="true" />
        <span className="breaks-panel-title label">Розривів немає</span>
      </Panel>
    )
  }
  return (
    <Panel position="top-right" className="chain-panel breaks-panel">
      <span className="breaks-panel-title label">
        <span className="lamp lamp-alarm" aria-hidden="true" /> Розриви ланцюга ({breakTargets.length})
      </span>
      <ul className="breaks-list">
        {breakTargets.map((b, i) => (
          <li key={i}>
            <button type="button" className="breaks-list-item" disabled={!b.centerKey} onClick={() => b.centerKey && onCenter(b.centerKey)}>
              {b.message}
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

// ---- Головний компонент ----------------------------------------------------------------------

function ChainViewInner({ project, index, onSelectOutput, onOpenStation }: ChainViewProps) {
  // Той самий поділ, що W2 Task 5: розкладку рахуємо ЛИШЕ коли змінився project/index.
  const model = useMemo(() => buildStationCanvas(project, index), [project, index])
  const { nodes: baseNodes, edges: baseEdges } = useMemo(() => toStationFlowElements(model), [model])

  const [nodes, setNodes, onNodesChange] = useNodesState<ChainFlowNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<ChainFlowEdge>([])
  const [ready, setReady] = useState(false)
  const rf = useReactFlow()

  useEffect(() => {
    let cancelled = false
    setReady(false)
    void layoutFlowNodes(baseNodes, baseEdges).then((positions) => {
      if (cancelled) return
      setNodes(baseNodes.map((n) => ({ ...n, position: positions.get(n.id) ?? { x: 0, y: 0 } })))
      setEdges(baseEdges)
      setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [baseNodes, baseEdges, setNodes, setEdges])

  // Єдиний обробник кліку по вузлу -- диспетчеризація за типом. Станок -> onOpenStation
  // (контракт T3). Предмет-заготовка (dataItem) -- обробляється ВСЕРЕДИНІ ItemCardNode
  // (stopPropagation, дивись коментар там) і сюди взагалі не долітає для dataItem-кліку;
  // цей хендлер лишається як страхувальний фолбек на ВИПАДОК майбутнього non-dataItem
  // кліку по предмету (наразі -- no-op).
  const handleNodeClick = useCallback(
    (_event: ReactMouseEvent, node: ChainFlowNode) => {
      if (node.type === 'stationNode') onOpenStation?.(node.data.classname)
    },
    [onOpenStation],
  )

  const nodeTypes = useMemo<NodeTypes>(
    () => ({
      stationNode: StationCardNode,
      itemNode: (props: NodeProps<ItemFlowNode>) => <ItemCardNode {...props} onSelectOutput={onSelectOutput} />,
      ghostNode: GhostCardNode,
    }),
    [onSelectOutput],
  )

  const centerOnKey = useCallback(
    (key: string) => {
      const flowNode = nodes.find((n) => n.id === key)
      if (!flowNode) return
      const w = flowNode.width ?? ITEM_CARD_WIDTH
      const h = flowNode.height ?? ITEM_CARD_HEIGHT
      void rf.setCenter(flowNode.position.x + w / 2, flowNode.position.y + h / 2, { zoom: 1, duration: 400 })
    },
    [nodes, rf],
  )

  // Порожній стан за правилами письма DESIGN.md §7: запрошення до дії, не констатація
  // відсутності.
  if (model.stationCards.length === 0) {
    return (
      <p className="intro">
        У проєкті немає жодного станка переробки. Додайте файл у <code>ProcessingRules/</code>{' '}
        (вкладка «Файли») — полотно з'явиться, щойно з'явиться хоч одне правило з валідним Device.
      </p>
    )
  }

  return (
    <div className="chain-canvas-wrap">
      {!ready && (
        <p className="indicator" role="status">
          <span className="lamp lamp-warn" aria-hidden="true" />
          Розкладаю граф…
        </p>
      )}
      <ReactFlow
        style={{ visibility: ready ? 'visible' : 'hidden' }}
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={handleNodeClick}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <svg width={0} height={0}>
          <defs>
            <marker id="zp-chain-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth={8} markerHeight={8} orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="chain-edge-arrowhead" />
            </marker>
          </defs>
        </svg>
        <Background id="zp-grid-minor" gap={8} size={1} color="var(--grid-minor)" variant={BackgroundVariant.Lines} />
        <Background id="zp-grid-major" gap={40} size={1} color="var(--grid-major)" variant={BackgroundVariant.Lines} />
        <Controls showInteractive={false} />
        <DuplicateWarning duplicates={model.duplicates} />
        <BreaksPanel breakTargets={model.breakTargets} onCenter={centerOnKey} />
      </ReactFlow>
    </div>
  )
}

export function ChainView(props: ChainViewProps) {
  return (
    <ReactFlowProvider>
      <ChainViewInner {...props} />
    </ReactFlowProvider>
  )
}
