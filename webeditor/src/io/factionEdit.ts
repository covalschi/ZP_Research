// Мутатори фракцій Factions.json (W4 Task 1) — контракт dataItemEdit/sampleTypeEdit:
// structuredClone ЛИШЕ документа-цілі, результат — НОВИЙ Project із заміною РІВНО одного
// ProjectFile (dirty=true), решта файлів зберігає ідентичність; відмова — без мутацій.
//
// Дзеркала сервера:
//   - збіг Id — ТОЧНИЙ == (ZP_FactionsConfig.Find :84-92: `f.Id == id`; OpUpsertFaction,
//     ZP_ConfigService.c:861: `work.Factions[i].Id == incoming.Id`);
//   - createFaction відмовляє на порожньому та небезпечному для імені файлу Id — дзеркало
//     ZP_Uid.IsPathSafe (ZP_Constants.c:109-112: непорожній, без '\\', '/', ':', '..');
//     Id фракції — це ім'я файлу пулу FactionData\<Id>.json, ключ гілки дерева і значення
//     RequiredFactions (шапка ZP_FactionsConfig.c:7-8), тому дубль перевіряється
//     КЕЙС-ІНСЕНСИТИВНО: NTFS регістронезалежна, кейс-близнюки ділили б ОДИН файл пулу
//     (та сама конвенція uniqueId, що nodeEdit W3);
//   - deleteFaction — СВІДОМО СУВОРІШЕ за серверний OpDeleteFaction (ZP_ConfigService.c:
//     885-921: видаляє без жодного гарду, лише попереджає в message, що гравці підуть у
//     DefaultFaction). Прецедент — deleteTreeNode (суворіше за OpDeleteNode): відмова з
//     переліком використань, доки адмін їх не прибере. Використання:
//       * ProcessingRules/*.json: Rules[].RequiredFactions[] (сервер читає його простим
//         array<string>.Find — ZP_Factions.c:76/102, ZP_Processing.c:144,
//         ZP_ClientState.c:156/190);
//       * TechTree/*.json: Branch.Factions[] (володіння гілкою) і Nodes[].RequiredFactions[];
//       * Settings.DefaultFaction.
//     Порівняння використань — КЕЙС-ІНСЕНСИТИВНЕ (прецедент cloneStation, kind='faction':
//     сервер порівнює дослівно, але кейс-розбіжність — та сама міна, і гард, що її не
//     бачить, брехав би «використань нема»).
//     Settings.TreeTerminalClasses у гарді НЕМАЄ навмисно: там КЛАСНЕЙМИ приладів, не Id
//     фракцій (знак питання брифа закрито читанням ZP_SettingsConfig.c:11-13).

import type { Project, ProjectFile } from './project'

export interface FactionsFileDoc {
  ConfigVersion: number
  Factions: Record<string, unknown>[]
}

export type FactionEditResult = { ok: true; project: Project } | { ok: false; error: string }

function findFactionsFile(project: Project): ProjectFile | undefined {
  return project.files.find((f) => f.kind === 'factions')
}

type Located = { file: ProjectFile; doc: FactionsFileDoc } | { ok: false; error: string }

function locate(project: Project): Located {
  const file = findFactionsFile(project)
  if (!file) return { ok: false, error: 'Factions.json не завантажено' }
  const doc = file.parsed as FactionsFileDoc | undefined
  if (!doc || !Array.isArray(doc.Factions)) return { ok: false, error: `файл фракцій не розібрано: ${file.path}` }
  return { file, doc }
}

function commit(project: Project, file: ProjectFile, newDoc: FactionsFileDoc): { ok: true; project: Project } {
  const newFile: ProjectFile = { ...file, parsed: newDoc, dirty: true }
  const newFiles = project.files.map((f) => (f === file ? newFile : f))
  return { ok: true, project: { ...project, files: newFiles } }
}

function exactIdx(items: Record<string, unknown>[], id: string): number[] {
  const out: number[] = []
  items.forEach((it, i) => {
    if (it && typeof it === 'object' && (it as Record<string, unknown>).Id === id) out.push(i)
  })
  return out
}

// Дзеркало ZP_Uid.IsPathSafe (ZP_Constants.c:109-112).
function isPathSafeId(s: string): boolean {
  return s !== '' && !s.includes('\\') && !s.includes('/') && !s.includes(':') && !s.includes('..')
}

export function applyFactionEdit(
  project: Project,
  factionId: string,
  updater: (f: Record<string, unknown>) => void,
): FactionEditResult {
  const loc = locate(project)
  if ('ok' in loc) return loc
  const matchIdx = exactIdx(loc.doc.Factions, factionId)
  if (matchIdx.length === 0) return { ok: false, error: `фракцію '${factionId}' не знайдено у Factions.json` }
  if (matchIdx.length > 1) return { ok: false, error: `дубль Id '${factionId}' у Factions.json — виправте вручну` }

  const newDoc = structuredClone(loc.doc)
  updater(newDoc.Factions[matchIdx[0]])
  return commit(project, loc.file, newDoc)
}

// Дефолти Enforce-класу ZP_FactionDef (ZP_FactionsConfig.c:13-32: усі рядки без
// ініціалізаторів -> '', масиви -> порожні) — конвенція W1 «дефолти Enforce для СТВОРЕННЯ».
export function createFaction(project: Project, factionId: string): FactionEditResult {
  const id = factionId.trim()
  if (id === '') return { ok: false, error: 'порожній Id фракції' }
  if (!isPathSafeId(id)) {
    return { ok: false, error: `Id '${id}' небезпечний для імені файлу (FactionData\\<Id>.json) — дзеркало ZP_Uid.IsPathSafe (ZP_Constants.c:109-112)` }
  }
  const loc = locate(project)
  if ('ok' in loc) return loc
  const needle = id.toLowerCase()
  const exists = loc.doc.Factions.some(
    (f) => f && typeof f === 'object' && typeof (f as Record<string, unknown>).Id === 'string' && ((f as Record<string, unknown>).Id as string).toLowerCase() === needle,
  )
  if (exists) return { ok: false, error: `фракція '${id}' уже існує (кейс-варіанти заборонені: FactionData\\<Id>.json на NTFS регістронезалежний)` }

  const newDoc = structuredClone(loc.doc)
  newDoc.Factions.push({ Id: id, DisplayName: '', Supertype: '', Armbands: [], TerminalClasses: [], DeviceClasses: [] })
  return commit(project, loc.file, newDoc)
}

// Перейменування Id фракції (W4 Task 3, деталь-панель вкладки «Фракції») — прецедент
// renamePointType (io/pointTypeEdit.ts): посилання НЕ переписуються — RequiredFactions
// правил/вузлів, Factions гілок і Settings.DefaultFaction лишаються зі старим Id, а файл
// пулу FactionData\<старий Id>.json сервер НЕ перейменує: перейменована фракція для нього —
// НОВА фракція з ПОРОЖНІМ пулом (ZP_FactionDB кладе стан за Id). Панель зобовʼязана нести
// цю підказку поруч із полем + живий перелік використань (factionUsageSummary нижче).
// Дубль-гард — кейс-інсенситивний (та сама NTFS-причина, що в createFaction), зміна лише
// регістру власного Id — легальна, АЛЕ не сміє карбувати ТОЧНИЙ дубль при рукописному
// кейс-варіанті-близнюку (ревью T2, minor 1 — той самий гвард, що renamePointType).
export function renameFaction(project: Project, factionId: string, newId: string): FactionEditResult {
  const next = newId.trim()
  if (next === '') return { ok: false, error: 'порожній новий Id фракції' }
  if (!isPathSafeId(next)) {
    return { ok: false, error: `Id '${next}' небезпечний для імені файлу (FactionData\\<Id>.json) — дзеркало ZP_Uid.IsPathSafe (ZP_Constants.c:109-112)` }
  }
  if (next === factionId) return { ok: true, project }
  const loc = locate(project)
  if ('ok' in loc) return loc
  const nextLower = next.toLowerCase()
  const hasInsensitive = loc.doc.Factions.some(
    (f) => f && typeof f === 'object' && typeof (f as Record<string, unknown>).Id === 'string' && ((f as Record<string, unknown>).Id as string).toLowerCase() === nextLower,
  )
  if (nextLower !== factionId.toLowerCase() && hasInsensitive) {
    return { ok: false, error: `фракція '${next}' уже існує (кейс-варіанти заборонені: FactionData\\<Id>.json на NTFS регістронезалежний)` }
  }
  if (nextLower === factionId.toLowerCase() && exactIdx(loc.doc.Factions, next).length > 0) {
    return { ok: false, error: `фракція '${next}' уже існує ТОЧНИМ збігом — перейменування створило б дубль Id` }
  }
  const matchIdx = exactIdx(loc.doc.Factions, factionId)
  if (matchIdx.length === 0) return { ok: false, error: `фракцію '${factionId}' не знайдено у Factions.json` }
  if (matchIdx.length > 1) return { ok: false, error: `дубль Id '${factionId}' у Factions.json — виправте вручну` }

  const newDoc = structuredClone(loc.doc)
  newDoc.Factions[matchIdx[0]].Id = next
  return commit(project, loc.file, newDoc)
}

// ---- гард використань для deleteFaction -----------------------------------------------------

interface FactionUsage {
  rules: string[] // Id правил із фракцією в RequiredFactions
  branches: string[] // Branch.Id (або шлях файлу) гілок, що володіють фракцією
  nodes: string[] // Id вузлів із фракцією в RequiredFactions
  defaultFaction: boolean // Settings.DefaultFaction вказує на неї
}

function containsInsensitive(arr: unknown, needleLower: string): boolean {
  return Array.isArray(arr) && arr.some((v) => typeof v === 'string' && v.trim().toLowerCase() === needleLower)
}

function collectFactionUsage(project: Project, factionId: string): FactionUsage {
  const needle = factionId.trim().toLowerCase()
  const usage: FactionUsage = { rules: [], branches: [], nodes: [], defaultFaction: false }
  for (const f of project.files) {
    if (f.kind === 'rules') {
      const doc = f.parsed as { Rules?: unknown[] } | undefined
      if (!doc || !Array.isArray(doc.Rules)) continue
      for (const raw of doc.Rules) {
        if (!raw || typeof raw !== 'object') continue
        const r = raw as Record<string, unknown>
        if (containsInsensitive(r.RequiredFactions, needle)) {
          usage.rules.push(typeof r.Id === 'string' && r.Id !== '' ? r.Id : `(без Id, ${f.path})`)
        }
      }
    } else if (f.kind === 'techTree') {
      const doc = f.parsed as { Branch?: Record<string, unknown>; Nodes?: unknown[] } | undefined
      if (!doc) continue
      const branch = doc.Branch
      if (branch && typeof branch === 'object' && containsInsensitive(branch.Factions, needle)) {
        usage.branches.push(typeof branch.Id === 'string' && branch.Id !== '' ? branch.Id : f.path)
      }
      if (Array.isArray(doc.Nodes)) {
        for (const raw of doc.Nodes) {
          if (!raw || typeof raw !== 'object') continue
          const n = raw as Record<string, unknown>
          if (containsInsensitive(n.RequiredFactions, needle)) {
            usage.nodes.push(typeof n.Id === 'string' && n.Id !== '' ? n.Id : `(без Id, ${f.path})`)
          }
        }
      }
    } else if (f.kind === 'settings') {
      const doc = f.parsed as Record<string, unknown> | undefined
      if (doc && typeof doc.DefaultFaction === 'string' && doc.DefaultFaction.trim().toLowerCase() === needle) {
        usage.defaultFaction = true
      }
    }
  }
  return usage
}

function describeUsage(u: FactionUsage): string {
  const parts: string[] = []
  if (u.rules.length > 0) parts.push(`правила (RequiredFactions): ${u.rules.join(', ')}`)
  if (u.branches.length > 0) parts.push(`гілки дерева (Branch.Factions): ${u.branches.join(', ')}`)
  if (u.nodes.length > 0) parts.push(`вузли дерева (RequiredFactions): ${u.nodes.join(', ')}`)
  if (u.defaultFaction) parts.push('Settings.DefaultFaction')
  return parts.join('; ')
}

// Живий перелік використань фракції для UI (W4 Task 3): '' = не використовується.
// Той самий збирач, що гард deleteFaction — панель показує його поруч із полем Id
// (перейменування посилань НЕ переписує) і не винаходить другу копію обходу проєкту.
export function factionUsageSummary(project: Project, factionId: string): string {
  return describeUsage(collectFactionUsage(project, factionId))
}

export function deleteFaction(project: Project, factionId: string): FactionEditResult {
  const loc = locate(project)
  if ('ok' in loc) return loc
  const matchIdx = exactIdx(loc.doc.Factions, factionId)
  if (matchIdx.length === 0) return { ok: false, error: `фракцію '${factionId}' не знайдено у Factions.json` }
  if (matchIdx.length > 1) return { ok: false, error: `дубль Id '${factionId}' у Factions.json — виправте вручну` }

  const usage = collectFactionUsage(project, factionId)
  const described = describeUsage(usage)
  if (described !== '') {
    return { ok: false, error: `фракцію '${factionId}' використовують: ${described} — спершу приберіть посилання` }
  }

  const newDoc = structuredClone(loc.doc)
  newDoc.Factions.splice(matchIdx[0], 1)
  return commit(project, loc.file, newDoc)
}
