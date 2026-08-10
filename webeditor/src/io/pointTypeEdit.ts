// Мутатори типів балів PointTypes.json (W4 Task 1) — контракт dataItemEdit/sampleTypeEdit:
// structuredClone ЛИШЕ документа-цілі, updater працює над копією, результат — НОВИЙ Project
// із НОВИМ files-масивом, де замінено РІВНО один об'єкт файлу (dirty=true), решта файлів
// зберігає ТУ САМУ ідентичність об'єктів; відмова — {ok:false,error} без жодної мутації.
//
// ВІДМІННОСТІ від прецедентів (усі — дзеркала сервера, процитовані):
//   - збіг Id — ТОЧНИЙ == (ZP_PointTypesConfig.Find :317-325: `pt.Id == id` без ToLower;
//     та сама кейс-СЕНСИТИВНА семантика, що у Validate :306 і OpUpsertPointType :1260 —
//     на відміну від DataItems/SampleTypes, де лукап іде через ToLower);
//   - createPointType: SortOrder=0 -> Count()+1 ДО вставки (дзеркало OpUpsertPointType,
//     ZP_ConfigService.c:1272-1273: `if (incoming.SortOrder == 0) incoming.SortOrder =
//     next.PointTypes.Count() + 1;` — count у той момент ще БЕЗ incoming);
//   - створення відмовляє на дублі КЕЙС-ІНСЕНСИТИВНО (конвенція uniqueId/ruleFileUtils,
//     прецедент nodeEdit W3: сервер порівнює дослівно, але Id, що різняться лише
//     регістром, — міна під ноги), а порожній Id — одразу (порожній Id валить валідацію
//     ЦІЛОГО файлу, Validate :301-304);
//   - deletePointTypeAt — позиційне видалення, ЄДИНИЙ шлях ремонту дубля Id: видалення за
//     Id на дублі неоднозначне (близнюки), а сам дубль тримає project-wide гейт
//     експорту/збереження (model/configValidation.ts, pointTypesGateAlarms) — без
//     позиційного видалення адмін застряг би із заблокованим збереженням назавжди.
//     Серверного DELETE-опа для типів балів НЕ ІСНУЄ взагалі (ops: лише OpUpsertPointType)
//     — видалення можливе тільки правкою файлу, тобто саме тут.
//
// ОСІ Categories/Kinds — ДАНІ (ZP_PointDimension: Id/Name/SortOrder). Сервер їх НЕ валідує
// ніяк (Validate :294-315 ходить лише по PointTypes) і не має для них ops; лукапи
// DimensionName/DimensionOrder (:237-255) — точний ==, перший збіг, невідомий Id -> 9999 у
// кінець. Перейменування осі НЕ переписує записи PointTypes (вимога брифа: це дані,
// розсинхрон покаже дзеркало валідації, model/configValidation.ts).

import type { Project, ProjectFile } from './project'

export interface PointTypesFileDoc {
  ConfigVersion: number
  PointTypes: Record<string, unknown>[]
  Categories: Record<string, unknown>[]
  Kinds: Record<string, unknown>[]
}

export type PointTypeEditResult = { ok: true; project: Project } | { ok: false; error: string }

function findPointTypesFile(project: Project): ProjectFile | undefined {
  return project.files.find((f) => f.kind === 'pointTypes')
}

type Located = { file: ProjectFile; doc: PointTypesFileDoc } | { ok: false; error: string }

function locate(project: Project): Located {
  const file = findPointTypesFile(project)
  if (!file) return { ok: false, error: 'PointTypes.json не завантажено' }
  const doc = file.parsed as PointTypesFileDoc | undefined
  if (!doc || !Array.isArray(doc.PointTypes) || !Array.isArray(doc.Categories) || !Array.isArray(doc.Kinds)) {
    return { ok: false, error: `файл типів балів не розібрано: ${file.path}` }
  }
  return { file, doc }
}

function commit(project: Project, file: ProjectFile, newDoc: PointTypesFileDoc): { ok: true; project: Project } {
  const newFile: ProjectFile = { ...file, parsed: newDoc, dirty: true }
  const newFiles = project.files.map((f) => (f === file ? newFile : f))
  return { ok: true, project: { ...project, files: newFiles } }
}

// Індекси записів із точним збігом Id (дзеркало Find/Validate — кейс-сенситивно).
function exactIdx(items: Record<string, unknown>[], id: string): number[] {
  const out: number[] = []
  items.forEach((it, i) => {
    if (it && typeof it === 'object' && (it as Record<string, unknown>).Id === id) out.push(i)
  })
  return out
}

function hasIdInsensitive(items: Record<string, unknown>[], id: string): boolean {
  const needle = id.toLowerCase()
  return items.some(
    (it) => it && typeof it === 'object' && typeof (it as Record<string, unknown>).Id === 'string' && ((it as Record<string, unknown>).Id as string).toLowerCase() === needle,
  )
}

// ---- записи PointTypes ----------------------------------------------------------------------

export function applyPointTypeEdit(
  project: Project,
  typeId: string,
  updater: (pt: Record<string, unknown>) => void,
): PointTypeEditResult {
  const loc = locate(project)
  if ('ok' in loc) return loc
  const matchIdx = exactIdx(loc.doc.PointTypes, typeId)
  if (matchIdx.length === 0) return { ok: false, error: `тип балів '${typeId}' не знайдено у PointTypes.json` }
  if (matchIdx.length > 1) return { ok: false, error: `дубль Id '${typeId}' у PointTypes.json — приберіть близнюка (позиційне видалення), правка неоднозначна` }

  const newDoc = structuredClone(loc.doc)
  updater(newDoc.PointTypes[matchIdx[0]])
  return commit(project, loc.file, newDoc)
}

// Схема-дефолти ZP_PointType (усі поля без ініціалізаторів у ZP_Types.c -> нулі типу).
// НЕ імпортуємо POINT_TYPE_SCHEMA зі schema.ts напряму: вона там не експортована окремо,
// а потрібні лише дефолти полів — тримаємо міні-дзеркало полів тут із тим самим порядком
// (порядок серіалізації однаково диктує schema.ts, а не цей літерал).
const POINT_TYPE_DEFAULTS: Record<string, unknown> = {
  Id: '',
  Name: '',
  Icon: '',
  Color: '',
  SortOrder: 0,
  Category: '',
  Kind: '',
  Tier: 0,
}

export function createPointType(project: Project, typeId: string, init: Record<string, unknown> = {}): PointTypeEditResult {
  const id = typeId.trim()
  if (id === '') return { ok: false, error: 'порожній Id типу балів (порожній Id валить валідацію ЦІЛОГО файлу — ZP_PointTypesConfig.Validate :301-304)' }
  const loc = locate(project)
  if ('ok' in loc) return loc
  if (hasIdInsensitive(loc.doc.PointTypes, id)) {
    return { ok: false, error: `тип балів '${id}' уже існує (кейс-варіанти заборонені конвенцією uniqueId)` }
  }

  const record: Record<string, unknown> = { ...structuredClone(POINT_TYPE_DEFAULTS), ...structuredClone(init), Id: id }
  // Дзеркало OpUpsertPointType (ZP_ConfigService.c:1272-1273): SortOrder=0 у НОВОГО запису
  // підставляється як Count()+1, де Count — ДО вставки самого запису.
  if (record.SortOrder === 0) record.SortOrder = loc.doc.PointTypes.length + 1

  const newDoc = structuredClone(loc.doc)
  newDoc.PointTypes.push(record)
  return commit(project, loc.file, newDoc)
}

export function deletePointType(project: Project, typeId: string): PointTypeEditResult {
  const loc = locate(project)
  if ('ok' in loc) return loc
  const matchIdx = exactIdx(loc.doc.PointTypes, typeId)
  if (matchIdx.length === 0) return { ok: false, error: `тип балів '${typeId}' не знайдено у PointTypes.json` }
  if (matchIdx.length > 1) return { ok: false, error: `дубль Id '${typeId}' — видалення за Id неоднозначне, приберіть близнюка позиційно (deletePointTypeAt)` }

  const newDoc = structuredClone(loc.doc)
  newDoc.PointTypes.splice(matchIdx[0], 1)
  return commit(project, loc.file, newDoc)
}

// Позиційний ремонт дубля: видаляє РІВНО запис за індексом у масиві PointTypes (порядок
// масиву стабільний — це порядок файлу, той самий, що бачить будь-який список/матриця UI).
export function deletePointTypeAt(project: Project, index: number): PointTypeEditResult {
  const loc = locate(project)
  if ('ok' in loc) return loc
  if (!Number.isInteger(index) || index < 0 || index >= loc.doc.PointTypes.length) {
    return { ok: false, error: `запису №${index + 1} немає у PointTypes.json` }
  }
  const newDoc = structuredClone(loc.doc)
  newDoc.PointTypes.splice(index, 1)
  return commit(project, loc.file, newDoc)
}

// Перейменування Id запису (W4 Task 2, деталь-панель вкладки «Бали») — дзеркало підходу
// renameDimension нижче: НЕ переписує посилання на тип (Cost вузлів дерева, Points
// заготовок) — розсинхрон чесно покажуть дзеркала валідації (validateNode: «невідомий тип
// балів у Cost», вузол сервер ВІДКИНЕ ЦІЛКОМ — ZP_TechTree.c:168-170; Find типів балів
// кейс-СЕНСИТИВНИЙ, тож навіть зміна лише регістру рве посилання так само). Панель мусить
// нести цю підказку поруч із полем.
export function renamePointType(project: Project, typeId: string, newId: string): PointTypeEditResult {
  const next = newId.trim()
  if (next === '') return { ok: false, error: 'порожній новий Id типу балів (порожній Id валить валідацію ЦІЛОГО файлу — Validate :301-304)' }
  if (next === typeId) return { ok: true, project }
  const loc = locate(project)
  if ('ok' in loc) return loc
  // Зміна ЛИШЕ регістру власного Id — легальна (це не дубль) — прецедент renameDimension.
  if (next.toLowerCase() !== typeId.toLowerCase() && hasIdInsensitive(loc.doc.PointTypes, next)) {
    return { ok: false, error: `тип балів '${next}' уже існує (кейс-варіанти заборонені конвенцією uniqueId)` }
  }
  // Ревью T2 (minor 1): кейс-only гілка обходила дубль-чек — якщо рукописний файл УЖЕ
  // містить кейс-варіант-близнюка (сервер-легально), rename 'a'->'A' карбував би ТОЧНИЙ
  // == дубль (миттєвий алярм-гейт). Відмова чесніша за створення аварії.
  if (next.toLowerCase() === typeId.toLowerCase() && exactIdx(loc.doc.PointTypes, next).length > 0) {
    return { ok: false, error: `тип балів '${next}' уже існує ТОЧНИМ збігом — перейменування створило б дубль, який валить весь файл (Validate :306-307)` }
  }
  const matchIdx = exactIdx(loc.doc.PointTypes, typeId)
  if (matchIdx.length === 0) return { ok: false, error: `тип балів '${typeId}' не знайдено у PointTypes.json` }
  if (matchIdx.length > 1) return { ok: false, error: `дубль Id '${typeId}' — перейменування неоднозначне, приберіть близнюка позиційно (deletePointTypeAt)` }

  const newDoc = structuredClone(loc.doc)
  newDoc.PointTypes[matchIdx[0]].Id = next
  return commit(project, loc.file, newDoc)
}

// ---- осі Categories/Kinds -------------------------------------------------------------------

export type DimensionAxis = 'Categories' | 'Kinds'

export function applyDimensionEdit(
  project: Project,
  axis: DimensionAxis,
  dimId: string,
  updater: (d: Record<string, unknown>) => void,
): PointTypeEditResult {
  const loc = locate(project)
  if ('ok' in loc) return loc
  const matchIdx = exactIdx(loc.doc[axis], dimId)
  if (matchIdx.length === 0) return { ok: false, error: `вісь '${dimId}' не знайдено у ${axis}` }
  if (matchIdx.length > 1) return { ok: false, error: `дубль Id '${dimId}' у ${axis} — виправте вручну` }

  const newDoc = structuredClone(loc.doc)
  updater(newDoc[axis][matchIdx[0]])
  return commit(project, loc.file, newDoc)
}

// SortOrder=Count()+1 при 0 — КОНВЕНЦІЯ РЕДАКТОРА, а не дзеркало: серверного опа для осей
// не існує, а SeedDimensions (:260-292) нумерує послідовно з 1 — конвенція збігається з
// обома сусідніми практиками (SeedDimensions і OpUpsertPointType) і документована тут.
export function createDimension(project: Project, axis: DimensionAxis, dimId: string, init: Record<string, unknown> = {}): PointTypeEditResult {
  const id = dimId.trim()
  if (id === '') return { ok: false, error: 'порожній Id осі' }
  const loc = locate(project)
  if ('ok' in loc) return loc
  if (hasIdInsensitive(loc.doc[axis], id)) {
    return { ok: false, error: `вісь '${id}' уже існує у ${axis} (кейс-варіанти заборонені конвенцією uniqueId)` }
  }

  const record: Record<string, unknown> = { Id: id, Name: '', SortOrder: 0, ...structuredClone(init) }
  record.Id = id // Id завжди з аргументу — init його не переписує
  if (record.SortOrder === 0) record.SortOrder = loc.doc[axis].length + 1

  const newDoc = structuredClone(loc.doc)
  newDoc[axis].push(record)
  return commit(project, loc.file, newDoc)
}

// Перейменування осі НЕ переписує записи PointTypes (вимога брифа: вісь — дані; запис із
// старим Id категорії/виду — розсинхрон, який чесно покаже дзеркало валідації, а сервер
// покаже сирий Id і поставить блок у кінець — DimensionName/DimensionOrder :237-255).
export function renameDimension(project: Project, axis: DimensionAxis, dimId: string, newId: string): PointTypeEditResult {
  const next = newId.trim()
  if (next === '') return { ok: false, error: 'порожній новий Id осі' }
  if (next === dimId) return { ok: true, project }
  const loc = locate(project)
  if ('ok' in loc) return loc
  const nextLower = next.toLowerCase()
  // Зміна ЛИШЕ регістру власного Id — легальна (це не дубль) — прецедент renameTreeNode.
  if (nextLower !== dimId.toLowerCase() && hasIdInsensitive(loc.doc[axis], next)) {
    return { ok: false, error: `вісь '${next}' уже існує у ${axis} (кейс-варіанти заборонені конвенцією uniqueId)` }
  }
  // Той самий гвард, що в renamePointType (ревью T2, minor 1): кейс-only гілка не сміє
  // карбувати ТОЧНИЙ дубль, якщо кейс-варіант-близнюк уже лежить у файлі рукописно.
  if (nextLower === dimId.toLowerCase() && exactIdx(loc.doc[axis], next).length > 0) {
    return { ok: false, error: `вісь '${next}' уже існує у ${axis} ТОЧНИМ збігом — перейменування створило б дубль` }
  }
  const matchIdx = exactIdx(loc.doc[axis], dimId)
  if (matchIdx.length === 0) return { ok: false, error: `вісь '${dimId}' не знайдено у ${axis}` }
  if (matchIdx.length > 1) return { ok: false, error: `дубль Id '${dimId}' у ${axis} — виправте вручну` }

  const newDoc = structuredClone(loc.doc)
  newDoc[axis][matchIdx[0]].Id = next
  return commit(project, loc.file, newDoc)
}
