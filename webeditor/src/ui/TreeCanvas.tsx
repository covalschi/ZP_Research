// Полотно дерева технологій (W3 Task 2 + Task 3) — вкладка «Дерево». Візуальна мова — та
// сама мнемосхема пульта, що й полотно ланцюгів (DESIGN.md §5-6), але розкладка ІНША:
// БЕЗ elkjs — колонка = Tier (семантична координата, дзеркало ігрового ZP_TreeMenu
// «колонка=Tier»), позиції рахує чистий ui/treeLayout.ts (координата = функція
// (Tier, порядковий номер у файлі)), тут лише мапінг у React Flow і драг.
//
// Драг вузла МІЖ колонками = правка Tier через мутатор io/nodeEdit.ts (дзеркальна
// дисципліна applyRuleEdit: копія документа, dirty, ідентичність недирти файлів) —
// після правки project змінюється, модель перераховується, полотно перемальовується
// живцем. Драг УСЕРЕДИНІ колонки НЕ зберігається (порядок у колонці = порядок файлу,
// позиція по вертикалі не є даними конфігу) — картка снапається назад.
//
// W3 Task 3 поверх Т2:
//   - CONNECT мишею: хендл-джерело (правий край) -> хендл-ціль (лівий край) = додати
//     батька в Parents[] цільового вузла (io/nodeEdit.addNodeParent, гвард недосяжності —
//     дзеркало серверного OpUpsertNode; цикл = відмова з UA-причиною і шляхом циклу).
//   - ВИДАЛЕННЯ РЕБРА: клік по ребру взводить його (штрих-стиль + підказка), другий клік
//     за 4 с видаляє батька (removeNodeParent) — паттерн другого натискання проєкту.
//   - ПАНЕЛЬ ВУЗЛА: клік по картці відкриває ui/TreeNodePanel.tsx праворуч від полотна
//     (усі поля ZP_TreeNode, ZpSelect повсюди). Вибір синкається і ПІСЛЯ драгу
//     (хвіст ревью T2: React Flow виділяє вузол на старті драгу БЕЗ onNodeClick — рішення:
//     синк у onNodeDragStop, дивись handleNodeDragStop).
//   - СТВОРЕННЯ ВУЗЛА: кнопка «+» у заголовку Tier-колонки -> новий вузол в активній
//     гілці з дефолтами Enforce-класу, Tier = колонка (createTreeNode), одразу вибраний.
//   - СТВОРЕННЯ ГІЛКИ: «створити гілку» в тулбарі -> форма Branch-мети -> канонічний
//     порожній ZP_TechTreeFile (createTreeBranchFile), перемикання на нову гілку.
//   - Delete-клавіша React Flow ВИМКНЕНА (deleteKeyCode=null): вбудоване видалення зносило
//     б вузол лише з локального стану полотна, не з проєкту — «видалення», яке зникає
//     наступним перерахунком, гірше за відсутнє. Видалення вузла — кнопка панелі з
//     другим натисканням і гвардом «має нащадків» (deleteTreeNode).
//
// Примара батька з ІНШОЇ гілки — перевикористаний ПІДХІД ghost-вузлів ChainView (вузол-
// заглушка на місці відсутнього на полотні), але НЕ його стиль: кросгілковий батько —
// ЛЕГАЛЬНИЙ стан (модель T1 його знає), тому тихий пунктир --line-strong замість
// аварійної штриховки .hazard (вона зарезервована ВИКЛЮЧНО за розривом ланцюга,
// DESIGN.md §6 «семантична дисципліна»). Примара МОЖЕ бути джерелом connect
// (кросгілковий батько легальний), але не ціллю (target-хендла в неї немає).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Panel,
  Position,
  ReactFlow,
  applyNodeChanges,
} from '@xyflow/react'
import type { Connection, Edge, EdgeProps, Node, NodeChange, NodeProps, NodeTypes, EdgeTypes, ReactFlowInstance } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import type { Project } from '../io/project'
import type { ClassIndex } from '../model/classIndex'
import { buildTreeView } from '../model/treeView'
import { applyNodeEdit, addNodeParent, removeNodeParent, createTreeNode, createTreeBranchFile } from '../io/nodeEdit'
import {
  TREE_CARD_WIDTH,
  TREE_CARD_HEIGHT,
  TREE_GHOST_WIDTH,
  TREE_GHOST_HEIGHT,
  TREE_HEADER_HEIGHT,
  buildTreeCanvas,
  tierForX,
  treeCardKeyBase,
} from './treeLayout'
import type { TreeCardSpec, TreeGhostSpec, TreeHeaderSpec } from './treeLayout'
import { TreeNodePanel } from './TreeNodePanel'
import { TreeProblemsPanel } from './TreeProblemsPanel'
import { buildTreeProblems } from './treeProblems'
import { collectFactionOptions } from './RulePanel'
import { ZpSelect } from './ZpSelect'
import type { TreeFocusRequest } from './focusRequest'

// ---- Контракт вибору (панель вузла T3; проп лишається для зовнішніх спостерігачів) ----------

export interface TreeNodeSelection {
  filePath: string
  nodeId: string
  // Ключ ЕКЗЕМПЛЯРА (дубль Id дає #2-суфікс) — однозначно вказує картку на полотні.
  key: string
}

export interface TreeCanvasProps {
  project: Project
  index: ClassIndex
  onProjectChange: (p: Project) => void
  onSelectNode?: (sel: TreeNodeSelection | null) => void
  // W4 Task 5: перехід із вкладки «Баланс». nodeId непорожній — вибрати й доцентрувати вузол
  // (той самий шлях, що клік по рядку панелі проблем); порожній — лише перемкнути гілку.
  focus?: TreeFocusRequest | null
}

// ---- Типи React Flow -------------------------------------------------------------------------

interface TreeCardNodeData extends Record<string, unknown> {
  card: TreeCardSpec
}
interface TreeGhostNodeData extends Record<string, unknown> {
  ghost: TreeGhostSpec
}
interface TierHeaderNodeData extends Record<string, unknown> {
  header: TreeHeaderSpec
  // Кнопка «+» заголовка (T3). Колбек їде в data вузла — штатний шлях React Flow передати
  // поведінку кастомному вузлу (nodeTypes мусять лишатись модульними константами, інакше
  // бібліотека скаржиться на перестворення типів щорендеру).
  onCreateNode: (tier: number) => void
}

type TreeCardFlowNode = Node<TreeCardNodeData, 'treeNode'>
type TreeGhostFlowNode = Node<TreeGhostNodeData, 'treeGhost'>
type TierHeaderFlowNode = Node<TierHeaderNodeData, 'tierHeader'>
type TreeFlowNode = TreeCardFlowNode | TreeGhostFlowNode | TierHeaderFlowNode
type TreeFlowEdge = Edge<{ cross: boolean; armed?: boolean }, 'treeEdge'>

// ---- Презентація: картка вузла ---------------------------------------------------------------
// Лампова граматика DESIGN.md §3: НОРМА (ok) / АВАРІЯ (alarm-вузол «горить» + лічильник
// причин; самі причини — панель вузла). Вибір — чорнильний фіолет (React Flow сам
// веде selected через кліки, NodeProps.selected).

function TreeNodeCard({ data, selected }: NodeProps<TreeCardFlowNode>) {
  const n = data.card.node
  const alarm = n.status === 'alarm'
  const classes = ['tree-node-card']
  if (alarm) classes.push('tree-node-alarm')
  if (selected) classes.push('tree-node-selected')
  return (
    <div className={classes.join(' ')} title={n.id}>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <div className="tree-node-name-row">
        <span className={`lamp ${alarm ? 'lamp-alarm' : 'lamp-ok'}`} aria-hidden="true" />
        <span className="tree-node-name">{n.name !== '' ? n.name : n.id}</span>
      </div>
      <code className="tree-node-id">{n.id}</code>
      <div className="tree-node-cost">
        {n.cost.map((c, i) => (
          <span key={i} className={`tree-cost-chip${c.known ? '' : ' tree-cost-chip-unknown'}`} title={c.type}>
            {c.name} ×{c.amount}
          </span>
        ))}
        {n.itemCost.length > 0 && <span className="tree-cost-items">+ предмети: {n.itemCost.length}</span>}
        {n.cost.length === 0 && n.itemCost.length === 0 && <span className="tree-cost-free">без вартості</span>}
      </div>
      {alarm && <span className="tree-node-alarm-count">причин: {n.problems.length}</span>}
    </div>
  )
}

// ---- Презентація: примара кросгілкового батька ----------------------------------------------

function TreeGhostCard({ data }: NodeProps<TreeGhostFlowNode>) {
  const g = data.ghost
  return (
    <div className="tree-ghost-card" title={`${g.id} — гілка «${g.branchLabel}»`}>
      <Handle type="source" position={Position.Right} />
      <span className="tree-ghost-branch label">з гілки «{g.branchLabel}»</span>
      <span className="tree-ghost-name">{g.name !== '' ? g.name : g.id}</span>
      <code className="tree-ghost-id">{g.id}</code>
    </div>
  )
}

// ---- Презентація: заголовок колонки ----------------------------------------------------------
// Недрагабельний вузол React Flow — їде разом із полотном при zoom/pan (оверлей поза
// полотном відривався б від колонок). pointer-events глушить CSS
// (.react-flow__node-tierHeader), щоб пан стартував і «крізь» заголовок; кнопці «+»
// pointer-events повертає власний клас (дитина з auto приймає кліки й під parent none).

function TierHeaderNode({ data }: NodeProps<TierHeaderFlowNode>) {
  return (
    <div className="tree-tier-header label">
      <span>{data.header.label}</span>
      <button
        type="button"
        className="tree-tier-header-add"
        onClick={() => data.onCreateNode(data.header.tier)}
        title={`Створити вузол у колонці «${data.header.label}»`}
        aria-label={`Створити вузол у колонці ${data.header.label}`}
      >
        +
      </button>
    </div>
  )
}

const nodeTypes: NodeTypes = { treeNode: TreeNodeCard, treeGhost: TreeGhostCard, tierHeader: TierHeaderNode }

// ---- Ребро: провідник батько->нащадок --------------------------------------------------------
// Той самий ортогональний «провідник» 2px, що й ChainEdgeView (DESIGN.md §6, цілий звʼязок)
// — без підпису (розривів-ланцюгів у дереві немає, є alarm-вузли). Кросгілкове ребро —
// пунктир (джерело живе в іншій гілці), колір лишається чорнильним --chain-link.
// Другий (невидимий широкий) шлях — зона кліку: onEdgeClick React Flow ловить кліки по
// БУДЬ-ЯКІЙ дитині обгортки ребра, а по 2px-провіднику не влучити. Взведене на видалення
// ребро (перший клік) підсвічується аварійним штрихом до другого кліку/саморозряду.

function TreeEdgeView({ sourceX, sourceY, targetX, targetY, data }: EdgeProps<TreeFlowEdge>) {
  const midX = (sourceX + targetX) / 2
  const path = `M ${sourceX} ${sourceY} L ${midX} ${sourceY} L ${midX} ${targetY} L ${targetX} ${targetY}`
  const classes = ['tree-edge-path']
  if (data?.cross) classes.push('tree-edge-cross')
  if (data?.armed) classes.push('tree-edge-armed')
  return (
    <g>
      <path d={path} className={classes.join(' ')} fill="none" markerEnd="url(#zp-tree-arrow)" />
      <path d={path} className="tree-edge-hit" fill="none" />
    </g>
  )
}

const edgeTypes: EdgeTypes = { treeEdge: TreeEdgeView }

// ---- Мапінг моделі в елементи React Flow -----------------------------------------------------

function toTreeFlowElements(
  model: ReturnType<typeof buildTreeCanvas>,
  onCreateNode: (tier: number) => void,
): { nodes: TreeFlowNode[]; edges: TreeFlowEdge[] } {
  const nodes: TreeFlowNode[] = []
  for (const h of model.headers) {
    nodes.push({
      id: h.key,
      type: 'tierHeader',
      data: { header: h, onCreateNode },
      position: { x: h.x, y: h.y },
      width: TREE_CARD_WIDTH,
      height: TREE_HEADER_HEIGHT,
      draggable: false,
      selectable: false,
    })
  }
  for (const card of model.cards) {
    nodes.push({
      id: card.key,
      type: 'treeNode',
      data: { card },
      position: { x: card.x, y: card.y },
      width: TREE_CARD_WIDTH,
      height: TREE_CARD_HEIGHT,
      draggable: true,
    })
  }
  for (const ghost of model.ghosts) {
    nodes.push({
      id: ghost.key,
      type: 'treeGhost',
      data: { ghost },
      position: { x: ghost.x, y: ghost.y },
      width: TREE_GHOST_WIDTH,
      height: TREE_GHOST_HEIGHT,
      draggable: false,
      selectable: false,
      // Примара — легальне ДЖЕРЕЛО connect (кросгілковий батько), ціллю бути не може
      // (target-хендла немає).
      connectable: true,
    })
  }
  const edges: TreeFlowEdge[] = model.edges.map((e) => ({
    id: e.id,
    source: e.sourceKey,
    target: e.targetKey,
    type: 'treeEdge',
    data: { cross: e.cross },
  }))
  return { nodes, edges }
}

// ---- Форма «створити гілку» ------------------------------------------------------------------
// Branch-мета ZP_TreeBranchInfo цілком (Id/Name/Icon/SortOrder/Factions); Factions —
// ZpSelect по фракціях проєкту (залізне правило живого пошуку), накопичення чіпами —
// той самий прийом, що масове додавання сировини у вікні станка.

function BranchCreateForm({
  project,
  onCancel,
  onCreate,
}: {
  project: Project
  onCancel: () => void
  onCreate: (fileName: string, meta: { Id: string; Name: string; Icon: string; SortOrder: number; Factions: string[] }) => void
}) {
  const [fileName, setFileName] = useState('')
  const [branchId, setBranchId] = useState('')
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('')
  const [sortOrder, setSortOrder] = useState('0')
  const [factions, setFactions] = useState<string[]>([])
  const [factionEpoch, setFactionEpoch] = useState(0)
  const factionOptions = useMemo(() => collectFactionOptions(project), [project])

  function addFaction(id: string) {
    const trimmed = id.trim()
    if (trimmed === '') return
    setFactions((prev) => (prev.some((f) => f.toLowerCase() === trimmed.toLowerCase()) ? prev : [...prev, trimmed]))
    setFactionEpoch((e) => e + 1)
  }

  return (
    <div className="tree-branch-form">
      <span className="sheet-title label">Нова гілка (файл TechTree/)</span>
      <div className="rule-field">
        <label className="field-label" htmlFor="tbf-file">
          Імʼя файлу
        </label>
        <input
          id="tbf-file"
          className="field-input field-input-mono"
          value={fileName}
          onChange={(e) => setFileName(e.target.value)}
          placeholder="напр. bio_advanced"
        />
      </div>
      <div className="rule-field">
        <label className="field-label" htmlFor="tbf-id">
          Код гілки (Branch.Id)
        </label>
        <input id="tbf-id" className="field-input field-input-mono" value={branchId} onChange={(e) => setBranchId(e.target.value)} />
      </div>
      <div className="rule-field">
        <label className="field-label" htmlFor="tbf-name">
          Назва (Name)
        </label>
        <input id="tbf-name" className="field-input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="rule-field">
        <label className="field-label" htmlFor="tbf-icon">
          Іконка (Icon)
        </label>
        <input id="tbf-icon" className="field-input field-input-mono" value={icon} onChange={(e) => setIcon(e.target.value)} />
      </div>
      <div className="rule-field">
        <label className="field-label" htmlFor="tbf-sort">
          Порядок (SortOrder)
        </label>
        <input id="tbf-sort" className="field-input field-input-mono" inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
      </div>
      <div className="rule-field">
        <label className="field-label" htmlFor="tbf-faction-add">
          Фракції гілки (Factions)
        </label>
        <ZpSelect
          id="tbf-faction-add"
          key={`tbf-faction-${factionEpoch}`}
          value=""
          onChange={addFaction}
          options={factionOptions}
          placeholder={factionOptions.length === 0 ? 'у проєкті немає фракцій' : 'додати фракцію…'}
          aria-label="Додати фракцію гілки"
        />
        {factions.length > 0 && (
          <div className="station-chips">
            {factions.map((f) => (
              <span className="station-chip" key={f.toLowerCase()}>
                <code>{f}</code>
                <button type="button" onClick={() => setFactions((prev) => prev.filter((x) => x !== f))} aria-label={`Прибрати фракцію ${f}`}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="tree-branch-form-actions">
        <button
          type="button"
          className="primary"
          disabled={fileName.trim() === '' || branchId.trim() === ''}
          onClick={() =>
            onCreate(fileName, {
              Id: branchId,
              Name: name,
              Icon: icon,
              SortOrder: Math.trunc(Number(sortOrder)) || 0,
              Factions: factions,
            })
          }
        >
          Створити гілку
        </button>
        <button type="button" onClick={onCancel}>
          Скасувати
        </button>
      </div>
    </div>
  )
}

// ---- Головний компонент ----------------------------------------------------------------------

export function TreeCanvas({ project, index, onProjectChange, onSelectNode, focus }: TreeCanvasProps) {
  const view = useMemo(() => buildTreeView(project, index), [project, index])

  // Активна гілка — за filePath (стабільний крізь перерахунки; Branch.Id може дублюватись).
  // Якщо обраний файл зник із проєкту — тихий відкат на першу гілку.
  const [activePath, setActivePath] = useState<string | null>(null)
  const branchPaths = view.branches.map((b) => b.filePath)
  const effectivePath = activePath !== null && branchPaths.includes(activePath) ? activePath : (branchPaths[0] ?? null)

  const [error, setError] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [armedEdge, setArmedEdge] = useState<string | null>(null)
  const [branchFormOpen, setBranchFormOpen] = useState(false)

  // Взведене ребро саморозряджається (4 с) — паттерн другого натискання проєкту
  // (StationWindow/вкладка VPP).
  useEffect(() => {
    if (armedEdge === null) return
    const t = setTimeout(() => setArmedEdge(null), 4000)
    return () => clearTimeout(t)
  }, [armedEdge])

  const canvas = useMemo(
    () => (effectivePath !== null ? buildTreeCanvas(view, effectivePath) : buildTreeCanvas(view, '')),
    [view, effectivePath],
  )

  // ---- Панель проблем дерева (T4): збірка — чистий ui/treeProblems.ts, тут лише зшивка ----
  const problemsModel = useMemo(() => buildTreeProblems(view), [view])

  // Інстанс React Flow — через onInit, а НЕ через ReactFlowProvider+useReactFlow: провайдер
  // ззовні пережив би перемонтування <ReactFlow key={гілка}>, і fitView нового монтування
  // почав би залежати від стану збереженого стора — поведінка перемикання гілок T2/T3
  // (свіжий fitView на кожен switch) не повинна змінюватись. Ремонт по key дає СВІЖИЙ
  // інстанс — onInit кладе його в ref і доцентровує відкладений кросгілковий перехід.
  const rfRef = useRef<ReactFlowInstance<TreeFlowNode, TreeFlowEdge> | null>(null)
  const pendingCenterRef = useRef<string | null>(null)
  const canvasRef = useRef(canvas)
  canvasRef.current = canvas
  const centerTimerRef = useRef<number | null>(null)

  const centerOnKey = useCallback((key: string) => {
    const card = canvasRef.current.cards.find((c) => c.key === key)
    const inst = rfRef.current
    if (!card || !inst) return
    // Пауза перед setCenter: onInit свіжого монтування спрацьовує ДО того, як fitView
    // докладе вьюпорт, — без паузи fitView перезаписав би нашу ціль (позиція картки при
    // цьому детермінована МОДЕЛЛЮ, читати стан React Flow не потрібно).
    if (centerTimerRef.current !== null) window.clearTimeout(centerTimerRef.current)
    centerTimerRef.current = window.setTimeout(() => {
      centerTimerRef.current = null
      void inst.setCenter(card.x + TREE_CARD_WIDTH / 2, card.y + TREE_CARD_HEIGHT / 2, { zoom: 1, duration: 350 })
    }, 80)
  }, [])

  // Клік + перемикання вкладки протягом 80 мс дав би setCenter на вмираючому інстансі —
  // таймер чиститься при демонтажі (ревью T4, minor).
  useEffect(() => {
    return () => {
      if (centerTimerRef.current !== null) window.clearTimeout(centerTimerRef.current)
    }
  }, [])

  const handleInit = useCallback(
    (inst: ReactFlowInstance<TreeFlowNode, TreeFlowEdge>) => {
      rfRef.current = inst
      const pendingKey = pendingCenterRef.current
      if (pendingKey !== null) {
        pendingCenterRef.current = null
        centerOnKey(pendingKey)
      }
    },
    [centerOnKey],
  )

  // Клік по рядку панелі проблем: вибрати вузол + центрувати. Кросгілковий рядок спершу
  // перемикає гілку — центрування доїжджає через onInit свіжого інстанса (одразу не можна:
  // старий інстанс ось-ось помре разом зі старим монтуванням, нове ще не змонтоване).
  // Параметр — СТРУКТУРНА трійка (ключ картки, файл, Id), а не сам TreeProblemRow: тим самим
  // шляхом ходить і перехід із вкладки «Баланс» (W4 Task 5), у якого немає ані причин, ані
  // severity рядка панелі проблем. TreeProblemRow структурно сумісний, виклики не змінились.
  const handleCenterRow = useCallback(
    (row: { key: string; filePath: string; nodeId: string }) => {
      setSelectedKey(row.key)
      onSelectNode?.({ filePath: row.filePath, nodeId: row.nodeId, key: row.key })
      if (row.filePath === effectivePath) {
        centerOnKey(row.key)
        return
      }
      pendingCenterRef.current = row.key
      setActivePath(row.filePath)
      setArmedEdge(null)
      setError(null)
    },
    [effectivePath, onSelectNode, centerOnKey],
  )

  // Фокус ззовні («Баланс» -> сюди). Ключ картки будується ЄДИНОЮ точкою істини формату
  // (treeCardKeyBase) і збігається з ключем ПЕРШОГО екземпляра Id у файлі — саме того, що
  // buildTreeCanvas малює без суфікса '#N'. Порожній nodeId = просто відкрити гілку.
  // effectivePath/handleCenterRow свідомо поза залежностями: ефект реагує на ПОДІЮ переходу
  // (nonce), а не на кожен перерахунок полотна — інакше будь-яка правка знову смикала б
  // камеру на старий запит.
  useEffect(() => {
    if (!focus) return
    if (focus.nodeId === '') {
      setActivePath(focus.filePath)
      return
    }
    handleCenterRow({ key: treeCardKeyBase(focus.filePath, focus.nodeId), filePath: focus.filePath, nodeId: focus.nodeId })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus])

  const handleCreateNode = useCallback(
    (tier: number) => {
      if (effectivePath === null) return
      const result = createTreeNode(project, effectivePath, tier)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setError(null)
      onProjectChange(result.project)
      // Новий вузол — одразу вибраний: панель відкривається на порожньому шаблоні, адмін
      // заповнює Name першим же рухом (вузол доти чесно горить «немає Name»).
      const key = treeCardKeyBase(effectivePath, result.nodeId)
      setSelectedKey(key)
      onSelectNode?.({ filePath: effectivePath, nodeId: result.nodeId, key })
    },
    [project, effectivePath, onProjectChange, onSelectNode],
  )

  const { nodes: baseNodes, edges: baseEdges } = useMemo(() => toTreeFlowElements(canvas, handleCreateNode), [canvas, handleCreateNode])

  // Взведене ребро — похідний стан поверх baseEdges (модель ребер не мутується).
  const displayEdges = useMemo(
    () => (armedEdge === null ? baseEdges : baseEdges.map((e) => (e.id === armedEdge ? { ...e, data: { cross: e.data?.cross ?? false, armed: true } } : e))),
    [baseEdges, armedEdge],
  )

  // Контрольований стан React Flow: позиції — з моделі; драг мутує лише цей стан, а коміт
  // (applyNodeEdit) або снап-назад вирішує handleNodeDragStop. Прапор selected виставляється
  // з selectedKey (не з внутрішнього стану бібліотеки): після кожного перерахунку моделі
  // (коміт правки) візуальне виділення відновлюється з НАШОГО стану — інакше воно зникало
  // б на кожній правці (ефект нижче переписує nodes цілком).
  const withSelection = useCallback(
    (nodes: TreeFlowNode[]): TreeFlowNode[] => nodes.map((n) => (n.id === selectedKey ? { ...n, selected: true } : n)),
    [selectedKey],
  )
  const [nodes, setNodes] = useState<TreeFlowNode[]>([])
  useEffect(() => {
    setNodes(withSelection(baseNodes))
  }, [baseNodes, withSelection])

  const onNodesChange = useCallback((changes: NodeChange<TreeFlowNode>[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds))
  }, [])

  const selectNode = useCallback(
    (card: TreeCardSpec | null) => {
      if (card === null) {
        setSelectedKey(null)
        onSelectNode?.(null)
        return
      }
      setSelectedKey(card.key)
      onSelectNode?.({ filePath: card.node.filePath, nodeId: card.node.id, key: card.key })
    },
    [onSelectNode],
  )

  const handleNodeClick = useCallback(
    (_event: ReactMouseEvent, flowNode: TreeFlowNode) => {
      if (flowNode.type !== 'treeNode') return
      selectNode((flowNode.data as TreeCardNodeData).card)
    },
    [selectNode],
  )

  const handlePaneClick = useCallback(() => {
    selectNode(null)
    setArmedEdge(null)
  }, [selectNode])

  const handleNodeDragStop = useCallback(
    (_event: MouseEvent | TouchEvent, flowNode: TreeFlowNode) => {
      if (flowNode.type !== 'treeNode') return
      const card = canvas.cards.find((c) => c.key === flowNode.id)
      if (!card) return
      // Хвіст ревью T2: React Flow візуально виділяє вузол на СТАРТІ драгу без onNodeClick —
      // синкаємо selectedKey тут, щоб панель і полотно ніколи не розходились (рішення:
      // синк у onNodeDragStop, а НЕ selectNodesOnDrag=false — вузол, який адмін щойно
      // тягнув, і є вузлом його уваги, панель має піти за ним).
      selectNode(card)
      const newTier = tierForX(flowNode.position.x, canvas.tiers)
      if (newTier === card.columnTier) {
        // Той самий тір (у т.ч. драг лише по вертикалі) — правки немає, картка снапається
        // назад у позицію моделі (порядок у колонці = порядок файлу, свідомо не зберігається).
        setNodes(withSelection(baseNodes))
        return
      }
      const result = applyNodeEdit(project, card.node.filePath, card.node.id, (n) => {
        n.Tier = newTier
      })
      if (!result.ok) {
        // Типовий випадок — дубль Id у файлі (мутатор відмовляє, щоб не правити «не той»
        // із близнюків): чесний снап-назад + причина.
        setError(result.error)
        setNodes(withSelection(baseNodes))
        return
      }
      setError(null)
      onProjectChange(result.project) // модель перерахується, полотно перемалюється живцем
    },
    [canvas, project, baseNodes, onProjectChange, selectNode, withSelection],
  )

  // ---- Connect мишею: джерело (картка або примара) -> ціль (картка) = батько для цілі ----
  const handleConnect = useCallback(
    (connection: Connection) => {
      const targetCard = canvas.cards.find((c) => c.key === connection.target)
      if (!targetCard) return
      let parentId: string | undefined
      if (connection.source.startsWith('tghost::')) {
        parentId = connection.source.slice('tghost::'.length)
      } else {
        parentId = canvas.cards.find((c) => c.key === connection.source)?.node.id
      }
      if (parentId === undefined) return
      const result = addNodeParent(project, index, targetCard.node.filePath, targetCard.node.id, parentId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setError(null)
      onProjectChange(result.project)
    },
    [canvas, project, index, onProjectChange],
  )

  // ---- Видалення ребра: перший клік взводить, другий (за 4 с) видаляє батька ----
  const handleEdgeClick = useCallback(
    (_event: ReactMouseEvent, edge: TreeFlowEdge) => {
      if (armedEdge !== edge.id) {
        setArmedEdge(edge.id)
        return
      }
      setArmedEdge(null)
      const targetCard = canvas.cards.find((c) => c.key === edge.target)
      if (!targetCard) return
      let parentId: string | undefined
      if (edge.source.startsWith('tghost::')) {
        parentId = edge.source.slice('tghost::'.length)
      } else {
        parentId = canvas.cards.find((c) => c.key === edge.source)?.node.id
      }
      if (parentId === undefined) return
      const result = removeNodeParent(project, index, targetCard.node.filePath, targetCard.node.id, parentId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setError(null)
      onProjectChange(result.project)
    },
    [armedEdge, canvas, project, index, onProjectChange],
  )

  function handleCreateBranch(fileName: string, meta: { Id: string; Name: string; Icon: string; SortOrder: number; Factions: string[] }) {
    const result = createTreeBranchFile(project, fileName, meta)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    onProjectChange(result.project)
    setActivePath(result.path)
    setBranchFormOpen(false)
    selectNode(null)
  }

  const branchIdx = effectivePath !== null ? branchPaths.indexOf(effectivePath) : -1
  const branch = canvas.branch

  function switchBranch(delta: number) {
    if (branchPaths.length === 0) return
    const next = (branchIdx + delta + branchPaths.length) % branchPaths.length
    setActivePath(branchPaths[next])
    selectNode(null)
    setArmedEdge(null)
    setError(null)
  }

  const selectedCard = selectedKey !== null ? (canvas.cards.find((c) => c.key === selectedKey) ?? null) : null
  const armedEdgeSpec = armedEdge !== null ? (canvas.edges.find((e) => e.id === armedEdge) ?? null) : null

  return (
    <div className="tree-workspace">
      {/* Перемикач гілок — «< >» як в ігровому UI (файл = гілка) + «створити гілку». */}
      <div className="tree-toolbar">
        <button type="button" aria-label="Попередня гілка" onClick={() => switchBranch(-1)} disabled={branchPaths.length < 2}>
          ‹
        </button>
        <span className="tree-branch-plate">
          {branch ? (
            <>
              <span
                className={`lamp ${branch.valid ? 'lamp-ok' : 'lamp-alarm'}`}
                aria-hidden="true"
                title={branch.valid ? 'гілка валідна' : 'гілка не завантажиться сервером (див. вкладку «Файли»)'}
              />
              <span className="tree-branch-name">{branch.name !== '' ? branch.name : branch.id}</span>
              <code className="tree-branch-file">{branch.filePath}</code>
            </>
          ) : (
            <span className="tree-branch-name">немає гілок</span>
          )}
          <span className="tree-branch-count">
            гілка {branchPaths.length === 0 ? 0 : branchIdx + 1} з {branchPaths.length}
          </span>
        </span>
        <button type="button" aria-label="Наступна гілка" onClick={() => switchBranch(1)} disabled={branchPaths.length < 2}>
          ›
        </button>
        <button type="button" id="tree-create-branch" aria-expanded={branchFormOpen} onClick={() => setBranchFormOpen((v) => !v)}>
          {branchFormOpen ? 'сховати форму гілки' : 'створити гілку'}
        </button>
      </div>

      {branchFormOpen && <BranchCreateForm project={project} onCancel={() => setBranchFormOpen(false)} onCreate={handleCreateBranch} />}

      {error && (
        <p className="indicator alarm" role="alert">
          <span className="lamp lamp-alarm" aria-hidden="true" />
          {error}
        </p>
      )}

      {armedEdgeSpec && (
        <p className="indicator" role="status">
          <span className="lamp lamp-warn" aria-hidden="true" />
          Ребро взведено: клікніть по ньому ще раз, щоб від'єднати батька (само розрядиться за 4 с).
        </p>
      )}

      {view.branches.length === 0 ? (
        // Порожній стан за правилами письма DESIGN.md §7: запрошення до дії — форма
        // «створити гілку» доступна й тут (перша гілка проєкту створюється саме звідси).
        <p className="intro">
          У проєкті немає жодної гілки дерева. Натисніть «створити гілку» вгорі — файл
          з'явиться у <code>TechTree/</code>, і полотно оживе.
        </p>
      ) : (
        <div className="tree-main-row">
          <div className="tree-canvas-wrap">
            {/* key: перемонтування React Flow на зміні гілки — свіжий fitView під нову
                розкладку; правки в МЕЖАХ гілки (драг тіру) key не змінюють, зум/пан живе. */}
            <ReactFlow
              key={effectivePath ?? 'none'}
              nodes={nodes}
              edges={displayEdges}
              onNodesChange={onNodesChange}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodeClick={handleNodeClick}
              onPaneClick={handlePaneClick}
              onNodeDragStop={handleNodeDragStop}
              onConnect={handleConnect}
              onEdgeClick={handleEdgeClick}
              onInit={handleInit}
              nodesConnectable
              deleteKeyCode={null}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.1}
              maxZoom={2}
              proOptions={{ hideAttribution: true }}
            >
              <svg width={0} height={0}>
                <defs>
                  <marker id="zp-tree-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth={8} markerHeight={8} orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" className="tree-edge-arrowhead" />
                  </marker>
                </defs>
              </svg>
              <Background id="zp-tree-grid-minor" gap={8} size={1} color="var(--grid-minor)" variant={BackgroundVariant.Lines} />
              <Background id="zp-tree-grid-major" gap={40} size={1} color="var(--grid-major)" variant={BackgroundVariant.Lines} />
              <Controls showInteractive={false} />
              <TreeProblemsPanel model={problemsModel} onCenter={handleCenterRow} />
              {canvas.cards.length === 0 && (
                <Panel position="top-left" className="tree-empty-panel">
                  У цій гілці ще немає вузлів — натисніть «+» у заголовку колонки.
                </Panel>
              )}
            </ReactFlow>
          </div>

          {selectedCard && (
            <TreeNodePanel
              // key: T9-урок про витік стану між сутностями (той самий, що DataItemQuickEdit/
              // StationWindow) — перемикання вузла перемонтовує панель із чистим станом
              // (буфер Id, взведене видалення, епоха пікера батьків).
              key={selectedCard.key}
              project={project}
              index={index}
              view={view}
              filePath={selectedCard.node.filePath}
              nodeId={selectedCard.node.id}
              onProjectChange={onProjectChange}
              onNodeIdChange={(newId) => {
                const key = treeCardKeyBase(selectedCard.node.filePath, newId)
                setSelectedKey(key)
                onSelectNode?.({ filePath: selectedCard.node.filePath, nodeId: newId, key })
              }}
              onDeleted={() => selectNode(null)}
              onClose={() => selectNode(null)}
            />
          )}
        </div>
      )}
    </div>
  )
}
