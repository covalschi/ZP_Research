// Чисті хелпери полотна дерева технологій (W3 Task 2) — БЕЗ React і БЕЗ @xyflow/react:
// мапінг TreeViewResult (model/treeView.ts, T1) у картки/примари/заголовки/ребра з ГОТОВИМИ
// координатами. Компонент ui/TreeCanvas.tsx лише перекладає це в структури React Flow.
//
// СВІДОМО БЕЗ elkjs (відмінність від полотна ланцюгів ChainView.tsx, задокументована планом
// W3): у ланцюгах позиція вузла — вільна, її законно вирішує auto-layout; у дереві колонка =
// Tier — СЕМАНТИЧНА координата (та сама, що колонки ігрового ZP_TreeMenu, «колонка=Tier»,
// CLAUDE.md/M4), її не можна віддавати солверу. Координата — детермінована функція
// (Tier, порядковий номер у колонці), звідси ж і зворотне відображення драгу (tierForX).
//
// Порядок УСЕРЕДИНІ колонки = порядок файлу (branch.nodeIds / nodes[] моделі, які самі
// дзеркалять Nodes.Insert сервера) — драг по вертикалі НЕ зберігається (задокументований
// вибір брифа: позиція в колонці не є даними конфігу, після перерахунку модель повертає
// файловий порядок).
//
// Дублі Id: малюємо ОБИДВА екземпляри (ревью T1 — ітеруємо nodes[], НЕ byId), ключ
// екземпляра — дзеркало assignNodeKeys (ChainView.tsx): base + '#N' на повторі.

import type { TreeBranchView, TreeNodeView, TreeViewResult } from '../model/treeView'

// ---- Геометрія (пікселі полотна React Flow; зум/пан поверх — справа бібліотеки) ------------

export const TREE_CARD_WIDTH = 220
export const TREE_CARD_HEIGHT = 96
export const TREE_GHOST_WIDTH = 220
export const TREE_GHOST_HEIGHT = 64
export const TREE_HEADER_HEIGHT = 30
// Крок колонок/рядків: картка + повітря (рівно стільки, щоб ортогональні ребра
// «провідників» мали місце на лікоть між колонками).
export const TREE_COL_STEP = 290
export const TREE_ROW_STEP = 124
// Верх першої картки: заголовок колонки (y=0) + відступ.
export const TREE_TOP = 56

// ---- columnTiers: які колонки існують --------------------------------------------------------
// Суцільний цілочисельний діапазон від min(1, найменший тір) до (найбільший тір + 1):
// - підтягування до Тір 1 — корені дерева живуть там (ігрове UI теж рахує колонки від 1);
//   порожня колонка ліворуч = легальна ціль драгу «підняти вузол»;
// - дірки заповнюються — порожня колонка МІЖ тірами теж ціль драгу;
// - +1 порожня колонка ПРАВОРУЧ — єдиний спосіб драгом зробити вузол глибшим за поточний
//   максимум (панелі вузла в T2 ще немає). Свідоме розширення понад «лише наявні тіри»,
//   винесено у звіт як рішення на адʼюдикацію ревью.
// Вхід — ВЖЕ округлені тіри (Math.round робить викликач: Tier у JSON може бути нецілим,
// рушію байдуже — «лише відображення», ZP_TechTree.c:26).
//
// Захист від виродженого діапазону (ревью T2, minor): рукописний "Tier": 99999 —
// легальний int32 для рушія (Tier лише відображення), але суцільна заливка породила б
// ~100к порожніх колонок і завісила вкладку. Понад TREE_MAX_COLS — фолбек на ЛИШЕ
// фактично зайняті тіри (відсортовані унікальні, + Тір 1 і max+1 як цілі драгу);
// проміжні порожні колонки-цілі в цьому режимі свідомо втрачаються. Список обмежений
// кількістю вузлів, не величиною тіру. Драг не постраждав: tierForX працює по індексах
// списку, однаковий крок колонок зберігається.
export const TREE_MAX_COLS = 60

export function columnTiers(tiers: number[]): number[] {
  if (tiers.length === 0) return [1]
  const lo = Math.min(1, ...tiers)
  const hi = Math.max(...tiers) + 1
  if (hi - lo + 1 > TREE_MAX_COLS) {
    const set = new Set<number>(tiers)
    set.add(1)
    set.add(hi)
    return [...set].sort((a, b) => a - b)
  }
  const out: number[] = []
  for (let t = lo; t <= hi; t++) out.push(t)
  return out
}

// ---- cardPosition: координата = функція (колонка, порядковий номер) ------------------------

export function cardPosition(colIndex: number, ordinal: number): { x: number; y: number } {
  return { x: colIndex * TREE_COL_STEP, y: TREE_TOP + ordinal * TREE_ROW_STEP }
}

// ---- tierForX: зворотне відображення драгу ---------------------------------------------------
// x — ЛІВИЙ край покинутої картки у координатах полотна (React Flow position.x — той самий
// простір, у якому cardPosition розставляє колонки): найближча колонка перемагає (round),
// за межами — клемп у крайню. Порожній список — захисний фолбек 1 (не мало б статись:
// columnTiers ніколи не повертає порожньо).
export function tierForX(x: number, tiers: number[]): number {
  if (tiers.length === 0) return 1
  const idx = Math.min(tiers.length - 1, Math.max(0, Math.round(x / TREE_COL_STEP)))
  return tiers[idx]
}

// ---- Модель полотна --------------------------------------------------------------------------

export interface TreeCardSpec {
  key: string
  node: TreeNodeView
  // Тір КОЛОНКИ (округлений node.tier) — саме з ним порівнюється результат драгу.
  columnTier: number
  x: number
  y: number
}

// Примара батька з ІНШОЇ гілки: НЕ помилка (кросгілкові батьки легальні — модель T1 їх
// знає), тому стиль НЕ hazard/alarm (аварійна штриховка зарезервована ВИКЛЮЧНО за розривом
// ланцюга, DESIGN.md §6) — тихий пунктир --line-strong, дивись TreeCanvas.tsx/index.css.
export interface TreeGhostSpec {
  key: string
  id: string
  name: string
  branchLabel: string
  columnTier: number
  x: number
  y: number
}

export interface TreeHeaderSpec {
  key: string
  tier: number
  label: string
  x: number
  y: number
}

export interface TreeEdgeSpec {
  id: string
  sourceKey: string
  targetKey: string
  // true — джерело ребра лежить в ІНШІЙ гілці (примара). Візуально: пунктирний провідник.
  cross: boolean
}

export interface TreeCanvasModel {
  branch: TreeBranchView | undefined
  headers: TreeHeaderSpec[]
  cards: TreeCardSpec[]
  ghosts: TreeGhostSpec[]
  edges: TreeEdgeSpec[]
  // Тіри колонок у порядку колонок — вхід tierForX при драгу.
  tiers: number[]
}

const EMPTY_MODEL: TreeCanvasModel = { branch: undefined, headers: [], cards: [], ghosts: [], edges: [], tiers: [] }

// ---- buildTreeCanvas -------------------------------------------------------------------------

// ЄДИНА точка істини формату ключа картки (фінальне ревью W3: формат складали вручну в
// чотирьох місцях — майбутня зміна схеми тихо зламала б вибір у TreeCanvas без жодного
// червоного юніта). '#N'-суфікс повтору лишається справою buildTreeCanvas/buildTreeProblems.
export function treeCardKeyBase(filePath: string, nodeId: string): string {
  return `tnode::${filePath}::${nodeId}`
}

export function buildTreeCanvas(view: TreeViewResult, activeFilePath: string): TreeCanvasModel {
  const branch = view.branches.find((b) => b.filePath === activeFilePath)
  if (!branch) return EMPTY_MODEL

  // Активні вузли — у порядку файлу (nodes[] моделі вже в порядку файлів -> порядку в
  // файлі; фільтр по filePath, НЕ по branchId — дубль Branch.Id дав би два файли з одним id).
  const active = view.nodes.filter((n) => n.filePath === activeFilePath)

  // Ключі екземплярів — дзеркало assignNodeKeys (ChainView.tsx): '#N' на повторі Id.
  const seenBase = new Map<string, number>()
  const cards: TreeCardSpec[] = active.map((node) => {
    const base = treeCardKeyBase(node.filePath, node.id)
    const count = (seenBase.get(base) ?? 0) + 1
    seenBase.set(base, count)
    return {
      key: count === 1 ? base : `${base}#${count}`,
      node,
      columnTier: Math.round(node.tier),
      x: 0, // остаточні координати — після columnTiers нижче
      y: 0,
    }
  })

  // Перший АКТИВНИЙ екземпляр на Id — ціль ребер усередині гілки (регістрозалежно,
  // дзеркало FindNode/byId first-wins). Локальний екземпляр перемагає чужого навіть коли
  // view.byId (перший ПО ПРОЄКТУ) вказує в іншу гілку — ребро не сміє тікати з гілки,
  // поки батько існує в ній самій.
  const firstActiveById = new Map<string, TreeCardSpec>()
  for (const card of cards) {
    if (!firstActiveById.has(card.node.id)) firstActiveById.set(card.node.id, card)
  }

  // Ребра + примари кросгілкових батьків (одна примара на Id, дедуп ребер на пару ключів).
  const ghostsById = new Map<string, TreeGhostSpec>()
  const edges: TreeEdgeSpec[] = []
  const edgeIds = new Set<string>()
  function addEdge(sourceKey: string, targetKey: string, cross: boolean) {
    const id = `tedge::${sourceKey}=>${targetKey}`
    if (edgeIds.has(id)) return // Parents із дублем того самого Id — одне ребро, не два
    edgeIds.add(id)
    edges.push({ id, sourceKey, targetKey, cross })
  }

  for (const card of cards) {
    for (const p of card.node.parents) {
      const local = firstActiveById.get(p)
      if (local) {
        addEdge(local.key, card.key, false)
        continue
      }
      const remote = view.byId.get(p)
      if (!remote) continue // батька нема НІДЕ — лампа вузла вже горить причиною (T1), ребру нема куди йти
      let ghost = ghostsById.get(p)
      if (!ghost) {
        const remoteBranch = view.branches.find((b) => b.filePath === remote.filePath)
        ghost = {
          key: `tghost::${p}`,
          id: p,
          name: remote.name,
          branchLabel: remoteBranch ? (remoteBranch.name !== '' ? remoteBranch.name : remoteBranch.id) : remote.branchId,
          columnTier: Math.round(remote.tier),
          x: 0,
          y: 0,
        }
        ghostsById.set(p, ghost)
      }
      addEdge(ghost.key, card.key, true)
    }
  }
  const ghosts = [...ghostsById.values()]

  // Колонки: тіри активних карток + тіри примар (примара стоїть у колонці СВОГО тіру —
  // чесна глибина чужого вузла, а не «десь збоку»).
  const tiers = columnTiers([...cards.map((c) => c.columnTier), ...ghosts.map((g) => g.columnTier)])
  const colIndexByTier = new Map(tiers.map((t, i) => [t, i]))

  const headers: TreeHeaderSpec[] = tiers.map((tier) => ({
    key: `tcol::${tier}`,
    tier,
    label: `Тір ${tier}`,
    x: (colIndexByTier.get(tier) ?? 0) * TREE_COL_STEP,
    y: 0,
  }))

  // Позиції: активні картки в порядку файлу, потім примари (у порядку першого згадування) —
  // порядковий номер НАСКРІЗНИЙ у межах колонки, примари стають ПІСЛЯ реальних.
  const ordinalByTier = new Map<number, number>()
  function place(columnTier: number): { x: number; y: number } {
    const ordinal = ordinalByTier.get(columnTier) ?? 0
    ordinalByTier.set(columnTier, ordinal + 1)
    return cardPosition(colIndexByTier.get(columnTier) ?? 0, ordinal)
  }
  for (const card of cards) {
    const pos = place(card.columnTier)
    card.x = pos.x
    card.y = pos.y
  }
  for (const ghost of ghosts) {
    const pos = place(ghost.columnTier)
    ghost.x = pos.x
    ghost.y = pos.y
  }

  return { branch, headers, cards, ghosts, edges, tiers }
}
