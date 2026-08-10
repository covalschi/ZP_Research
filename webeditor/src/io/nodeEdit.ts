// Мутатор ОДНОГО вузла дерева технологій (W3 Task 2) — ЄДИНА крапка, крізь яку полотно
// дерева (ui/TreeCanvas.tsx: драг між Tier-колонками; згодом панель вузла T3) записує
// правку назад у Project. ДЗЕРКАЛЬНА ДИСЦИПЛІНА applyRuleEdit (io/ruleEdit.ts) —
// свідомо та сама, рядок у рядок, лише цільова колекція інша (Nodes замість Rules):
// чиста функція без React; structuredClone ЛИШЕ документа-цілі; updater працює над
// копією; результат — НОВИЙ Project із НОВИМ files-масивом, де замінено РІВНО один
// об'єкт файлу (dirty=true); решта файлів зберігає ТІ САМІ посилання (React перемальовує
// лише те, що змінилось).
//
// Дублікат Id вузла В ОДНОМУ файлі робить правку "за (filePath, nodeId)" неоднозначною —
// явна відмова замість вгадування (та сама причина, що applyRuleEdit: мовчазна правка
// «першого-ліпшого» близнюка правила б НЕ той вузол, який адмін щойно тягнув мишею;
// обидва близнюки й так горять alarm «дубль Id» на полотні — model/treeView.ts).
// Дубль МІЖ файлами правці не заважає: composite-адреса filePath+nodeId однозначна.

import type { Project, ProjectFile } from './project'
import { classifyPath } from './project'
import { defaultsFor } from '../model/types'
import { TREE_NODE_SCHEMA } from '../model/schema'
import { buildTreeView } from '../model/treeView'
import type { TreeViewResult } from '../model/treeView'
import type { ClassIndex } from '../model/classIndex'
import { sanitizeIdPart, uniqueId, normalizeJsonFileName, insertFileInServerOrder } from './ruleFileUtils'

export interface TechTreeFileDoc {
  ConfigVersion: number
  Branch: Record<string, unknown>
  Nodes: Record<string, unknown>[]
}

export type ApplyNodeEditResult = { ok: true; project: Project } | { ok: false; error: string }

export function applyNodeEdit(
  project: Project,
  filePath: string,
  nodeId: string,
  updater: (node: Record<string, unknown>) => void,
): ApplyNodeEditResult {
  const file = project.files.find((f) => f.path === filePath)
  if (!file) return { ok: false, error: `файл не знайдено: ${filePath}` }
  if (file.kind !== 'techTree') return { ok: false, error: `не файл гілки дерева: ${filePath}` }

  const doc = file.parsed as TechTreeFileDoc | undefined
  if (!doc || !Array.isArray(doc.Nodes)) return { ok: false, error: `файл гілки не розібрано: ${filePath}` }

  // Порівняння Id — РЕГІСТРОЗАЛЕЖНЕ (дзеркало FindNode, ZP_TechTree.c:69-77: `n.Id == id`
  // без .ToLower() — на відміну від усіх інших config-lookup'ів мода).
  const matchIdx: number[] = []
  doc.Nodes.forEach((n, i) => {
    if (n && typeof n === 'object' && (n as Record<string, unknown>).Id === nodeId) matchIdx.push(i)
  })
  if (matchIdx.length === 0) return { ok: false, error: `вузол '${nodeId}' не знайдено у ${filePath}` }
  if (matchIdx.length > 1) return { ok: false, error: 'дубль Id вузла у файлі — виправте вручну' }

  // structuredClone ЛИШЕ ЦЬОГО документа — оригінальний doc/file.parsed після виклику
  // лишається БЕЗ ЗМІН, updater працює виключно над копією.
  const newDoc = structuredClone(doc) as TechTreeFileDoc
  updater(newDoc.Nodes[matchIdx[0]])

  const newFile: ProjectFile = { ...file, parsed: newDoc, dirty: true }
  const newFiles = project.files.map((f) => (f === file ? newFile : f))
  return { ok: true, project: { ...project, files: newFiles } }
}

// ============================ W3 Task 3: з'єднання, створення, видалення ====================
//
// ГВАРД НЕДОСЯЖНОСТІ — точне дзеркало серверної транзакційної операції OpUpsertNode
// (ZP_ConfigService.c:975-1005, конвенція повного діапазону): сервер знімає GetUnreachable ДО мутації, застосовує
// мутацію до КОПІЇ гілки, знімає GetUnreachable ПІСЛЯ і відмовляє, якщо з'явились НОВІ
// недосяжні вузли («відхилено: вузли стануть недосяжними (цикл або хибний батьківський
// вузол)»). Редактор не вигадує нову семантику: чернетка (draft-проєкт від applyNodeEdit,
// оригінал НЕ мутується) + перезбірка treeView + порівняння наборів unreachable-проблем.
// Порівнюються НАБОРИ до/після, а не факт наявності проблем: вузол, що ВЖЕ був недосяжним,
// не блокує подальші правки (той самий unreachBefore/unreachAfter, що на сервері).
// Розширення редактора понад сервер: якщо у чернетці з'явився НОВИЙ шлях циклу
// (model/treeView.findCycleAmong — сервер шляхів не друкує взагалі), він додається до
// причини відмови.

function unreachableIdSet(view: TreeViewResult): Set<string> {
  const out = new Set<string>()
  for (const p of view.problems) {
    if (p.kind === 'unreachable' && p.nodeId !== undefined) out.add(p.nodeId)
  }
  return out
}

function guardNewUnreachable(before: TreeViewResult, after: TreeViewResult): string | null {
  const beforeSet = unreachableIdSet(before)
  const newUnreach = [...unreachableIdSet(after)].filter((id) => !beforeSet.has(id))
  if (newUnreach.length === 0) return null
  const beforeCycles = new Set(before.problems.filter((p) => p.kind === 'cycle').map((p) => p.message))
  const newCycle = after.problems.find((p) => p.kind === 'cycle' && !beforeCycles.has(p.message))
  let error = `відхилено: вузли стануть недосяжними (цикл або хибний батьківський вузол): ${newUnreach.join(', ')} — дзеркало серверної операції UPSERT_NODE (ZP_ConfigService.c:975-1005)`
  if (newCycle) error += `; ${newCycle.message}`
  return error
}

// Спільне ядро всіх гвардованих правок одного вузла: чернетка -> перезбірка -> гвард ->
// коміт лише чистого результату. НЕ пише в проєкт до перевірки (вимога брифа).
function guardedNodeEdit(
  project: Project,
  index: ClassIndex,
  filePath: string,
  nodeId: string,
  updater: (node: Record<string, unknown>) => void,
): ApplyNodeEditResult {
  const before = buildTreeView(project, index)
  const draft = applyNodeEdit(project, filePath, nodeId, updater)
  if (!draft.ok) return draft
  const after = buildTreeView(draft.project, index)
  const guardError = guardNewUnreachable(before, after)
  if (guardError !== null) return { ok: false, error: guardError }
  return draft
}

// Поточні Parents вузла (для перевірок ДО мутації). Помилки адресації віддає сам
// applyNodeEdit — тут лише читання першого збігу (унікальність у файлі перевірить мутатор).
function currentParents(project: Project, filePath: string, nodeId: string): string[] | undefined {
  const file = project.files.find((f) => f.path === filePath)
  const doc = file?.parsed as TechTreeFileDoc | undefined
  if (!doc || !Array.isArray(doc.Nodes)) return undefined
  for (const n of doc.Nodes) {
    if (n && typeof n === 'object' && (n as Record<string, unknown>).Id === nodeId) {
      const parents = (n as Record<string, unknown>).Parents
      return Array.isArray(parents) ? parents.filter((x): x is string => typeof x === 'string') : []
    }
  }
  return undefined
}

// ---- addNodeParent: connect мишею / пікер панелі --------------------------------------------
// Додає parentId у Parents[] ЦІЛЬОВОГО вузла. ParentsMode НЕ торкається (вимога брифа:
// add не змінює mode). Порівняння Id — регістрозалежне (дзеркало FindNode, ZP_TechTree.c:69-77).

export function addNodeParent(
  project: Project,
  index: ClassIndex,
  filePath: string,
  nodeId: string,
  parentId: string,
): ApplyNodeEditResult {
  const parent = parentId.trim()
  if (parent === '') return { ok: false, error: 'порожній Id батьківського вузла' }
  if (parent === nodeId) return { ok: false, error: `вузол '${nodeId}' не може бути власним батьком` }
  const parents = currentParents(project, filePath, nodeId)
  if (parents && parents.includes(parent)) {
    return { ok: false, error: `'${parent}' вже є батьком вузла '${nodeId}'` }
  }
  return guardedNodeEdit(project, index, filePath, nodeId, (n) => {
    ;(n.Parents as string[]).push(parent)
  })
}

// ---- removeNodeParent: видалення ребра / кнопка «×» у панелі --------------------------------
// Видаляє ВСІ входження parentId (полотно малює одне ребро на пару вузлів — дубльні
// записи того самого батька зникають разом із ребром). Гвард недосяжності діє й тут:
// ParentsMode='any' із живим і битим батьком — видалення живого зробило б вузол
// недосяжним, сервер (OpUpsertNode з тими самими Parents) відмовив би так само.

export function removeNodeParent(
  project: Project,
  index: ClassIndex,
  filePath: string,
  nodeId: string,
  parentId: string,
): ApplyNodeEditResult {
  const parents = currentParents(project, filePath, nodeId)
  if (parents && !parents.includes(parentId)) {
    return { ok: false, error: `'${parentId}' не є батьком вузла '${nodeId}'` }
  }
  return guardedNodeEdit(project, index, filePath, nodeId, (n) => {
    n.Parents = (n.Parents as string[]).filter((p) => p !== parentId)
  })
}

// ---- replaceNodeParent: правка існуючого рядка Parents у панелі -----------------------------

export function replaceNodeParent(
  project: Project,
  index: ClassIndex,
  filePath: string,
  nodeId: string,
  position: number,
  newParentId: string,
): ApplyNodeEditResult {
  const parent = newParentId.trim()
  if (parent === '') return { ok: false, error: 'порожній Id батьківського вузла' }
  if (parent === nodeId) return { ok: false, error: `вузол '${nodeId}' не може бути власним батьком` }
  const parents = currentParents(project, filePath, nodeId)
  if (parents) {
    if (position < 0 || position >= parents.length) {
      return { ok: false, error: `позиція батька №${position + 1} не існує у вузла '${nodeId}'` }
    }
    if (parents.some((p, i) => i !== position && p === parent)) {
      return { ok: false, error: `'${parent}' вже є батьком вузла '${nodeId}'` }
    }
  }
  return guardedNodeEdit(project, index, filePath, nodeId, (n) => {
    ;(n.Parents as string[])[position] = parent
  })
}

// ---- setNodeParentsMode ---------------------------------------------------------------------
// all|any (регістронезалежно приймає сервер, ValidateNode ZP_TechTree.c:162-165; редактор
// пише канонічний нижній регістр). Гвард недосяжності: any->all із битим одним із батьків
// зробив би вузол недосяжним — сервер відмовив би той самий UPSERT.

export function setNodeParentsMode(
  project: Project,
  index: ClassIndex,
  filePath: string,
  nodeId: string,
  mode: string,
): ApplyNodeEditResult {
  const canonical = mode.trim().toLowerCase()
  if (canonical !== 'all' && canonical !== 'any') {
    return { ok: false, error: `ParentsMode '${mode}' не існує (треба all або any — ValidateNode, ZP_TechTree.c:162-165)` }
  }
  return guardedNodeEdit(project, index, filePath, nodeId, (n) => {
    n.ParentsMode = canonical
  })
}

// ---- renameTreeNode -------------------------------------------------------------------------
// Id — КЛЮЧ посилань Parents (FindNode за точним рядком): перейменування батька рве
// посилання нащадків. Гвард недосяжності ловить рівно ті розриви, які сервер вважає
// фатальними (нащадок mode='all' стане недосяжним -> відмова з його Id); нащадок
// mode='any' із другим живим батьком лишається досяжним — перейменування дозволене, а
// битий Parents-рядок чесно горітиме warn на полотні (та сама семантика, що в сервера).
// Дубль нового Id (у БУДЬ-ЯКОМУ файлі) відмовляється ДО чернетки — КЕЙС-ІНСЕНСИТИВНО:
// сервер порівнює дослівно (hardErr AddFileNodes:140-144 ловить лише точний збіг), але
// Id, що відрізняються самим регістром, — міна конвенції uniqueId/ruleFileUtils, і
// createTreeNode/createTreeBranchFile уже тримають цю планку (вирівняно за ревью T3).

export function renameTreeNode(
  project: Project,
  index: ClassIndex,
  filePath: string,
  nodeId: string,
  newId: string,
): ApplyNodeEditResult {
  const next = newId.trim()
  if (next === '') return { ok: false, error: 'порожній Id вузла (вузол без Id сервер не завантажує — AddFileNodes, ZP_TechTree.c:135-139)' }
  if (next === nodeId) return { ok: true, project }
  const nextLower = next.toLowerCase()
  const oldLower = nodeId.toLowerCase()
  for (const file of project.files) {
    if (file.kind !== 'techTree') continue
    const doc = file.parsed as TechTreeFileDoc | undefined
    if (!doc || !Array.isArray(doc.Nodes)) continue
    for (const n of doc.Nodes) {
      if (!n || typeof n !== 'object') continue
      const id = (n as Record<string, unknown>).Id
      if (typeof id !== 'string' || id.toLowerCase() !== nextLower) continue
      // Перейменування, що міняє ЛИШЕ регістр власного Id, — легальне (це не дубль).
      if (id.toLowerCase() === oldLower && file.path === filePath) continue
      return { ok: false, error: `дубль Id: вузол '${id}' вже існує у ${file.path} (hardErr AddFileNodes, ZP_TechTree.c:140-144; кейс-варіанти заборонені конвенцією uniqueId)` }
    }
  }
  return guardedNodeEdit(project, index, filePath, nodeId, (n) => {
    n.Id = next
  })
}

// ---- createTreeNode: кнопка «+» у заголовку Tier-колонки ------------------------------------
// Шаблон — ДЕФОЛТИ Enforce-класу ZP_TreeNode (schema.ts TREE_NODE_SCHEMA; розрізнення W1:
// нуль-семантика — для ЧИТАННЯ, дефолти Enforce — для СТВОРЕННЯ). structuredClone
// ОБОВ'ЯЗКОВИЙ: defaultsFor віддає посилання на спільні def-масиви самої схеми — без
// клону мутація створеного вузла зіпсувала б дефолти всіх наступних. Name лишається
// порожнім (дефолт Enforce) — вузол чесно горить alarm «немає Name», доки адмін не
// заповнить панель (та сама семантика «червоної заготовки», що createStubRules).
// Id: <Branch.Id>_vuzol (+_2, _3...) — унікальність кейс-інсенситивна по ВСЬОМУ проєкту
// (конвенція uniqueId/ruleFileUtils: сервер порівнює дослівно, але Id, що відрізняються
// лише регістром, були б міною). Вставка в КІНЕЦЬ Nodes = низ своєї колонки (порядок у
// колонці = порядок файлу).

export type CreateTreeNodeResult = { ok: true; project: Project; nodeId: string } | { ok: false; error: string }

function collectNodeIdsLower(project: Project): Set<string> {
  const out = new Set<string>()
  for (const file of project.files) {
    if (file.kind !== 'techTree') continue
    const doc = file.parsed as TechTreeFileDoc | undefined
    if (!doc || !Array.isArray(doc.Nodes)) continue
    for (const n of doc.Nodes) {
      if (n && typeof n === 'object' && typeof (n as Record<string, unknown>).Id === 'string') {
        out.add(((n as Record<string, unknown>).Id as string).toLowerCase())
      }
    }
  }
  return out
}

export function createTreeNode(project: Project, filePath: string, tier: number): CreateTreeNodeResult {
  const file = project.files.find((f) => f.path === filePath)
  if (!file) return { ok: false, error: `файл не знайдено: ${filePath}` }
  if (file.kind !== 'techTree') return { ok: false, error: `не файл гілки дерева: ${filePath}` }
  const doc = file.parsed as TechTreeFileDoc | undefined
  if (!doc || !Array.isArray(doc.Nodes)) return { ok: false, error: `файл гілки не розібрано: ${filePath}` }

  const branchId = doc.Branch && typeof doc.Branch === 'object' && typeof doc.Branch.Id === 'string' ? doc.Branch.Id : ''
  const branchPart = sanitizeIdPart(branchId)
  const base = branchPart !== '' ? `${branchPart}_vuzol` : 'vuzol'
  const nodeId = uniqueId(base, collectNodeIdsLower(project))

  const node = structuredClone(defaultsFor(TREE_NODE_SCHEMA)) as Record<string, unknown>
  node.Id = nodeId
  node.Tier = Math.round(tier)

  const newDoc = structuredClone(doc) as TechTreeFileDoc
  newDoc.Nodes.push(node)
  const newFile: ProjectFile = { ...file, parsed: newDoc, dirty: true }
  const newFiles = project.files.map((f) => (f === file ? newFile : f))
  return { ok: true, project: { ...project, files: newFiles }, nodeId }
}

// ---- createTreeBranchFile: «створити гілку» -------------------------------------------------
// Канонічний порожній ZP_TechTreeFile із Branch-метою — дзеркало прецедентів
// createRulesFile/createSampleTypesFile (валідація імені та серверний порядок вставки —
// спільні normalizeJsonFileName/insertFileInServerOrder). Порожній Branch.Id — відмова
// одразу: файл без нього сервер НЕ реєструє взагалі, ба гірше — рве перезавантаження
// ЦІЛОГО дерева (hardErr AddFileNodes, ZP_TechTree.c:119-123). Дубль Branch.Id —
// відмова кейс-інсенситивно (сервер б'є hardErr на дослівному збігу :124-128; Id, що
// відрізняються лише регістром, — та сама міна, що й у конвенції uniqueId).

export interface TreeBranchMeta {
  Id: string
  Name: string
  Icon: string
  SortOrder: number
  Factions: string[]
}

export type CreateTreeBranchFileResult = { ok: true; project: Project; path: string } | { ok: false; error: string }

export function createTreeBranchFile(project: Project, fileName: string, meta: TreeBranchMeta): CreateTreeBranchFileResult {
  const norm = normalizeJsonFileName(fileName)
  if (!norm.ok) return norm

  const branchId = meta.Id.trim()
  if (branchId === '') {
    return { ok: false, error: 'порожній Branch.Id — без нього сервер не зареєструє гілку і відхилить перезавантаження ЦІЛОГО дерева (AddFileNodes, ZP_TechTree.c:119-123)' }
  }
  const branchLower = branchId.toLowerCase()
  for (const file of project.files) {
    if (file.kind !== 'techTree') continue
    const doc = file.parsed as TechTreeFileDoc | undefined
    const existing = doc?.Branch && typeof doc.Branch === 'object' && typeof doc.Branch.Id === 'string' ? doc.Branch.Id : ''
    if (existing !== '' && existing.toLowerCase() === branchLower) {
      return { ok: false, error: `дубль гілки: Branch.Id '${branchId}' вже зайнятий файлом ${file.path} (hardErr AddFileNodes, ZP_TechTree.c:124-128)` }
    }
  }

  const path = `TechTree/${norm.name}`
  if (classifyPath(path) !== 'techTree') return { ok: false, error: `шлях не класифікується як файл гілки дерева: ${path}` }
  const pathLower = path.toLowerCase()
  if (project.files.some((f) => f.path.toLowerCase() === pathLower)) {
    return { ok: false, error: `файл '${path}' вже є в проєкті` }
  }

  const doc: TechTreeFileDoc = {
    ConfigVersion: 1,
    Branch: {
      Id: branchId,
      Name: meta.Name,
      Icon: meta.Icon,
      SortOrder: Math.trunc(meta.SortOrder) || 0,
      Factions: meta.Factions.map((f) => f.trim()).filter((f) => f !== ''),
    },
    Nodes: [],
  }
  const newFile: ProjectFile = {
    path,
    kind: 'techTree',
    originalBytes: new Uint8Array(0),
    parsed: doc,
    warnings: [],
    dirty: true,
  }
  return { ok: true, project: insertFileInServerOrder(project, newFile, 'techTree'), path }
}

// ---- deleteTreeNode -------------------------------------------------------------------------
// Гард «має нащадків» (бриф Task 3): якщо ХОЧ ОДИН вузол у БУДЬ-ЯКІЙ гілці (кросгілкові
// теж) посилається на цей Id у Parents — відмова з переліком нащадків, доки адмін не
// перепідвісить їх. СВІДОМО СУВОРІШЕ за серверний OpDeleteNode (ZP_ConfigService.c:
// 1047-1059 — той відмовляє лише коли нащадки стануть НЕДОСЯЖНИМИ, тобто дозволяє лишити
// битий Parents-рядок у нащадка mode='any' з другим живим батьком): бриф вимагає саме
// перелік нащадків до перевішування, і битий рядок Parents — сміття, яке горіло б warn
// вічно. Самопосилання (вузол сам у своїх Parents) нащадком не вважається — після
// видалення битого посилання не лишиться. Підтвердження другим натисканням — рівень UI
// (панель), не мутатора.
//
// ВІДОМА ДІРА (фінальне ревью W3, адреса — W7 «повне дзеркало серверної валідації»):
// ані deleteTreeNode, ані renameTreeNode НЕ перевіряють ZP_Rule.RequiredNode — видалення/
// перейменування вузла, на який посилається правило, робить правило назавжди невиконанним
// МОВЧКИ (сервер теж дозволяє це з warn при завантаженні правил, не блокує). W7 має додати
// warn у панель проблем і/або перелік залежних правил у відмову мутатора.

export type DeleteTreeNodeResult = { ok: true; project: Project } | { ok: false; error: string }

export function deleteTreeNode(project: Project, filePath: string, nodeId: string): DeleteTreeNodeResult {
  const file = project.files.find((f) => f.path === filePath)
  if (!file) return { ok: false, error: `файл не знайдено: ${filePath}` }
  if (file.kind !== 'techTree') return { ok: false, error: `не файл гілки дерева: ${filePath}` }
  const doc = file.parsed as TechTreeFileDoc | undefined
  if (!doc || !Array.isArray(doc.Nodes)) return { ok: false, error: `файл гілки не розібрано: ${filePath}` }

  const matchIdx: number[] = []
  doc.Nodes.forEach((n, i) => {
    if (n && typeof n === 'object' && (n as Record<string, unknown>).Id === nodeId) matchIdx.push(i)
  })
  if (matchIdx.length === 0) return { ok: false, error: `вузол '${nodeId}' не знайдено у ${filePath}` }
  if (matchIdx.length > 1) return { ok: false, error: 'дубль Id вузла у файлі — виправте вручну' }

  const children: string[] = []
  for (const f of project.files) {
    if (f.kind !== 'techTree') continue
    const d = f.parsed as TechTreeFileDoc | undefined
    if (!d || !Array.isArray(d.Nodes)) continue
    for (const raw of d.Nodes) {
      if (!raw || typeof raw !== 'object') continue
      const n = raw as Record<string, unknown>
      if (typeof n.Id !== 'string' || n.Id === nodeId) continue // самопосилання/дубль не блокує
      if (Array.isArray(n.Parents) && n.Parents.includes(nodeId) && !children.includes(n.Id)) {
        children.push(n.Id)
      }
    }
  }
  if (children.length > 0) {
    return { ok: false, error: `вузол '${nodeId}' має нащадків: ${children.join(', ')} — спершу перепідвісьте або видаліть їх` }
  }

  const newDoc = structuredClone(doc) as TechTreeFileDoc
  newDoc.Nodes.splice(matchIdx[0], 1)
  const newFile: ProjectFile = { ...file, parsed: newDoc, dirty: true }
  const newFiles = project.files.map((f) => (f === file ? newFile : f))
  return { ok: true, project: { ...project, files: newFiles } }
}
