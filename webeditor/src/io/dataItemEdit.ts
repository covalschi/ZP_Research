// Мутатор заготовок DataItems.json (W2 Task 9) — дзеркало applyRuleEdit (io/ruleEdit.ts,
// T6) ТОЧНО за тим самим контрактом: structuredClone ЛИШЕ документа-цілі, updater працює
// над копією, результат — НОВИЙ Project із НОВИМ files-масивом, де замінено РІВНО один
// об'єкт файлу (dirty=true), решта файлів (у т.ч. САМ dataItems-файл до заклику) зберігає
// ТУ САМУ ідентичність об'єктів.
//
// На відміну від правил (багато файлів ProcessingRules/*.json, ключ — filePath+Id),
// заготовок РІВНО ОДИН файл (DataItems.json — SINGLE_FILE_KIND_BY_LOWER_NAME, project.ts) —
// тому ключ мутації тут лише Id, файл шукається за kind==='dataItems' напряму.
//
// ДВІ окремі функції, не одна: applyDataItemEdit СТРОГО відмовляє на відсутньому Id (як
// applyRuleEdit відмовляє на відсутньому ruleId) — редагування щойно-видаленого запису не
// повинно мовчки щось створювати. Створення нового запису — окрема дія createDataItem,
// яку явно викликає "не налаштовано" -> "створити запис" у DataItemQuickEdit.tsx.

import type { Project, ProjectFile } from './project'

export interface DataItemsFileDoc {
  ConfigVersion: number
  Items: Record<string, unknown>[]
}

export type ApplyDataItemEditResult = { ok: true; project: Project } | { ok: false; error: string }

function findDataItemsFile(project: Project): ProjectFile | undefined {
  return project.files.find((f) => f.kind === 'dataItems')
}

export function applyDataItemEdit(
  project: Project,
  itemId: string,
  updater: (item: Record<string, unknown>) => void,
): ApplyDataItemEditResult {
  const file = findDataItemsFile(project)
  if (!file) return { ok: false, error: 'DataItems.json не завантажено' }

  const doc = file.parsed as DataItemsFileDoc | undefined
  if (!doc || !Array.isArray(doc.Items)) return { ok: false, error: `файл заготовок не розібрано: ${file.path}` }

  const matchIdx: number[] = []
  doc.Items.forEach((it, i) => {
    if (it && typeof it === 'object' && (it as Record<string, unknown>).Id === itemId) matchIdx.push(i)
  })
  if (matchIdx.length === 0) return { ok: false, error: `заготовку '${itemId}' не знайдено у DataItems.json` }
  if (matchIdx.length > 1) return { ok: false, error: 'дубль Id у DataItems.json — виправте вручну' }

  // structuredClone ЛИШЕ ЦЬОГО документа — так само, як applyRuleEdit: жоден інший
  // ProjectFile навіть не проходить крізь клонування, тож рештки Project.files лишаються
  // ТИМИ САМИМИ посиланнями. Оригінальний doc/file.parsed після виклику — без змін.
  const newDoc = structuredClone(doc) as DataItemsFileDoc
  updater(newDoc.Items[matchIdx[0]])

  const newFile: ProjectFile = { ...file, parsed: newDoc, dirty: true }
  const newFiles = project.files.map((f) => (f === file ? newFile : f))
  return { ok: true, project: { ...project, files: newFiles } }
}

export type CreateDataItemResult = { ok: true; project: Project } | { ok: false; error: string }

// createDataItem: додає новий запис ZP_DataDef із дефолтами Enforce-класу (ZP_DataDef.c:
// Enabled=true, Name='', Description='', Points=[]) — той самий принцип "field.def для
// НОВИХ сутностей", задокументований у parse.ts (zeroValue — лише для читання наявних
// файлів, дефолт класу — для UI, що створює нове). Existence-перевірка КЕЙС-ІНСЕНСИТИВНА
// (на відміну від applyDataItemEdit вище): це питання ГРОВОЇ семантики ("сервер вважав би
// цей клас уже налаштованим?", ZP_DataItemsConfig.Find — кейс-інсенситивний лукап), а не
// пошук конкретного JSON-запису за точним ключем.
//
// НАВМИСНО без isKindOf(index, classname, 'ZP_Data_Base')-гейту тут: ця функція — io/*,
// без залежності від model/classIndex, і єдиний живий викликач (DataItemQuickEdit.
// handleCreate) уже гейтований на рівні UI — кнопка "+ Створити запис" рендериться ЛИШЕ
// коли предмет-вузол заготовки (ChainView.tsx/ItemCardNode, kind==='dataItem', W2.6
// Task 2) відкрив редактор саме для isDataItem-виходу (resolveDataItemFace). Якщо colись
// зʼявиться ДРУГИЙ викликач (напр. масове створення з
// іншої панелі), він мусить сам перевірити isKindOf ПЕРЕД викликом — ValidateItem на
// сервері (ZP_DataItemsConfig.c:86) все одно відхилить не-ZP_Data_Base клас при наступному
// Validate, тож найгірший наслідок пропуску гейту тут — запис, який сервер сам відкине, а
// не зіпсований інший клас.
export function createDataItem(project: Project, classname: string): CreateDataItemResult {
  const file = findDataItemsFile(project)
  if (!file) return { ok: false, error: 'DataItems.json не завантажено' }

  const doc = file.parsed as DataItemsFileDoc | undefined
  if (!doc || !Array.isArray(doc.Items)) return { ok: false, error: `файл заготовок не розібрано: ${file.path}` }

  const needle = classname.toLowerCase()
  const exists = doc.Items.some((it) => it && typeof it === 'object' && typeof (it as Record<string, unknown>).Id === 'string' && ((it as Record<string, unknown>).Id as string).toLowerCase() === needle)
  if (exists) return { ok: false, error: `заготовка '${classname}' уже налаштована` }

  const newDoc = structuredClone(doc) as DataItemsFileDoc
  newDoc.Items.push({ Id: classname, Enabled: true, Name: '', Description: '', Points: [] })

  const newFile: ProjectFile = { ...file, parsed: newDoc, dirty: true }
  const newFiles = project.files.map((f) => (f === file ? newFile : f))
  return { ok: true, project: { ...project, files: newFiles } }
}
