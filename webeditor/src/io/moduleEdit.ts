// Мутатори модулів Modules.json (W4 Task 1) — контракт dataItemEdit/sampleTypeEdit:
// structuredClone ЛИШЕ документа-цілі, НОВИЙ Project із заміною РІВНО одного ProjectFile
// (dirty=true), ідентичність решти; відмова — без мутацій.
//
// Ключ запису — Classname. Дзеркала сервера:
//   - збіг ТОЧНИЙ == (OpUpsertModule, ZP_ConfigService.c:1385: `md.Classname ==
//     incoming.Classname`; Validate :136 `seen.Find(m.Classname)` — теж дослівний);
//   - createModule відмовляє на порожньому Classname (OpUpsertModule :1373-1376: «немає
//     Classname інструмента») і на дублі КЕЙС-ІНСЕНСИТИВНО (конвенція uniqueId: рантайм
//     AllowedOn/SumBonus матчить через MatchClass/IsKindOf — регістронезалежні, кейс-
//     близнюк був би міною);
//   - deleteModule видаляє ВСІ точні збіги (дзеркало OpDeleteModule :1427-1435: foreach із
//     continue на КОЖНОМУ збігу) — заодно це шлях ремонту дубля класу, який інакше сервер
//     сам виріже РАНІШИЙ запис при завантаженні (Validate :136-141, останній виграє —
//     реверсний цикл, та сама last-wins семантика, що в DataItems).

import type { Project, ProjectFile } from './project'

export interface ModulesFileDoc {
  ConfigVersion: number
  Modules: Record<string, unknown>[]
}

export type ModuleEditResult = { ok: true; project: Project } | { ok: false; error: string }

function findModulesFile(project: Project): ProjectFile | undefined {
  return project.files.find((f) => f.kind === 'modules')
}

type Located = { file: ProjectFile; doc: ModulesFileDoc } | { ok: false; error: string }

function locate(project: Project): Located {
  const file = findModulesFile(project)
  if (!file) return { ok: false, error: 'Modules.json не завантажено' }
  const doc = file.parsed as ModulesFileDoc | undefined
  if (!doc || !Array.isArray(doc.Modules)) return { ok: false, error: `файл модулів не розібрано: ${file.path}` }
  return { file, doc }
}

function commit(project: Project, file: ProjectFile, newDoc: ModulesFileDoc): { ok: true; project: Project } {
  const newFile: ProjectFile = { ...file, parsed: newDoc, dirty: true }
  const newFiles = project.files.map((f) => (f === file ? newFile : f))
  return { ok: true, project: { ...project, files: newFiles } }
}

function exactIdx(items: Record<string, unknown>[], cls: string): number[] {
  const out: number[] = []
  items.forEach((it, i) => {
    if (it && typeof it === 'object' && (it as Record<string, unknown>).Classname === cls) out.push(i)
  })
  return out
}

export function applyModuleEdit(
  project: Project,
  classname: string,
  updater: (m: Record<string, unknown>) => void,
): ModuleEditResult {
  const loc = locate(project)
  if ('ok' in loc) return loc
  const matchIdx = exactIdx(loc.doc.Modules, classname)
  if (matchIdx.length === 0) return { ok: false, error: `модуль '${classname}' не знайдено у Modules.json` }
  if (matchIdx.length > 1) return { ok: false, error: `дубль класу '${classname}' у Modules.json — видаліть зайвий запис (deleteModule прибирає всі збіги)` }

  const newDoc = structuredClone(loc.doc)
  updater(newDoc.Modules[matchIdx[0]])
  return commit(project, loc.file, newDoc)
}

// Дефолти Enforce-класу ZP_ModuleDef (ZP_ModulesConfig.c:14-28: PurityBonus = 0, решта —
// нулі типу) — конвенція W1 «дефолти Enforce для СТВОРЕННЯ».
export function createModule(project: Project, classname: string): ModuleEditResult {
  const cls = classname.trim()
  if (cls === '') return { ok: false, error: 'немає Classname інструмента (дзеркало OpUpsertModule, ZP_ConfigService.c:1373-1376)' }
  const loc = locate(project)
  if ('ok' in loc) return loc
  const needle = cls.toLowerCase()
  const exists = loc.doc.Modules.some(
    (m) => m && typeof m === 'object' && typeof (m as Record<string, unknown>).Classname === 'string' && ((m as Record<string, unknown>).Classname as string).toLowerCase() === needle,
  )
  if (exists) return { ok: false, error: `модуль '${cls}' уже описаний (кейс-варіанти заборонені: MatchClass регістронезалежний)` }

  const newDoc = structuredClone(loc.doc)
  newDoc.Modules.push({ Classname: cls, PurityBonus: 0, Devices: [], Notes: '' })
  return commit(project, loc.file, newDoc)
}

// Перейменування Classname модуля (W4 Task 3, деталь-панель вкладки «Модулі») — прецедент
// renamePointType (io/pointTypeEdit.ts): дубль-гард кейс-інсенситивний (рантайм AllowedOn/
// SumBonus матчить через MatchClass/IsKindOf — регістронезалежні), зміна лише регістру
// власного класу — легальна, АЛЕ не сміє карбувати ТОЧНИЙ дубль при рукописному
// кейс-варіанті-близнюку (той самий гвард, що renamePointType після ревью T2, minor 1).
export function renameModule(project: Project, classname: string, newClassname: string): ModuleEditResult {
  const next = newClassname.trim()
  if (next === '') return { ok: false, error: 'немає Classname інструмента (дзеркало OpUpsertModule, ZP_ConfigService.c:1373-1376)' }
  if (next === classname) return { ok: true, project }
  const loc = locate(project)
  if ('ok' in loc) return loc
  const nextLower = next.toLowerCase()
  const hasInsensitive = loc.doc.Modules.some(
    (m) => m && typeof m === 'object' && typeof (m as Record<string, unknown>).Classname === 'string' && ((m as Record<string, unknown>).Classname as string).toLowerCase() === nextLower,
  )
  if (nextLower !== classname.toLowerCase() && hasInsensitive) {
    return { ok: false, error: `модуль '${next}' уже описаний (кейс-варіанти заборонені: MatchClass регістронезалежний)` }
  }
  if (nextLower === classname.toLowerCase() && exactIdx(loc.doc.Modules, next).length > 0) {
    return { ok: false, error: `модуль '${next}' уже описаний ТОЧНИМ збігом — перейменування створило б дубль класу` }
  }
  const matchIdx = exactIdx(loc.doc.Modules, classname)
  if (matchIdx.length === 0) return { ok: false, error: `модуль '${classname}' не знайдено у Modules.json` }
  if (matchIdx.length > 1) return { ok: false, error: `дубль класу '${classname}' у Modules.json — видаліть зайвий запис (deleteModule прибирає всі збіги)` }

  const newDoc = structuredClone(loc.doc)
  newDoc.Modules[matchIdx[0]].Classname = next
  return commit(project, loc.file, newDoc)
}

export function deleteModule(project: Project, classname: string): ModuleEditResult {
  const loc = locate(project)
  if ('ok' in loc) return loc
  const matchIdx = exactIdx(loc.doc.Modules, classname)
  if (matchIdx.length === 0) return { ok: false, error: `модуля '${classname}' немає в реєстрі (збіг точний, як OpDeleteModule)` }

  const newDoc = structuredClone(loc.doc)
  // ВСІ збіги, з кінця — індекси ранніх не зсуваються (дзеркало OpDeleteModule :1427-1435).
  for (let i = matchIdx.length - 1; i >= 0; i--) newDoc.Modules.splice(matchIdx[i], 1)
  return commit(project, loc.file, newDoc)
}
