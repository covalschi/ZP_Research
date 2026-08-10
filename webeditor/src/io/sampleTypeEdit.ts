// Мутатор типів зразків SampleTypes.json (W2.5 Task 4) — дзеркало io/dataItemEdit.ts
// (W2 Task 9) ЗА ТИМ САМИМ КОНТРАКТОМ: structuredClone ЛИШЕ документа-цілі, updater
// працює над копією, результат — НОВИЙ Project із НОВИМ files-масивом, де замінено РІВНО
// один об'єкт файлу (dirty=true), решта файлів (у т.ч. сам sampleTypes-файл ДО заклику)
// зберігає ТУ САМУ ідентичність об'єктів.
//
// ТРИ функції, не дві (розходження з dataItemEdit.ts, задокументоване свідомо):
//   - applySampleTypeEdit -- точкова правка ІСНУЮЧОГО запису, СТРОГО відмовляє, якщо
//     SampleTypes.json не завантажено чи запису з таким Id немає (як applyDataItemEdit).
//   - createSampleType -- додає НОВИЙ запис у вже наявний SampleTypes.json (як
//     createDataItem): вимагає, щоб файл УЖЕ існував у проєкті.
//   - createSampleTypesFile -- ЄДИНЕ, чого немає в dataItemEdit.ts: SampleTypes.json --
//     конфіг, доданий лише щойно (W2.5 Task 2/3), тож на відміну від DataItems.json (він
//     живе в моді з M1 і практично гарантовано є в будь-якому реальному профілі адміна)
//     цілком реальний сценарій -- адмін відкриває СТАРИЙ профіль/ZIP, у якому файлу
//     СПРАВДІ немає в проєкті ЖОДНИМ записом ProjectFile (loadProject/io/project.ts
//     створює запис лише для шляхів, які реально повернув backend.list()). У такому разі
//     ані applySampleTypeEdit, ані createSampleType не мають на чому спрацювати -- перш
//     ніж додати ПЕРШИЙ запис типу зразка, треба спершу додати ПОРОЖНІЙ файл у сам проєкт.
//     Це перший конфіг, який редактор уміє СТВОРЮВАТИ як файл (не лише як запис
//     усередині вже наявного файлу) -- SampleTypesView.tsx викликає цю функцію з кнопки
//     «Створити SampleTypes.json», яка з'являється РІВНО коли sampleTypesLoaded===false.

import type { Project, ProjectFile } from './project'

export interface SampleTypesFileDoc {
  ConfigVersion: number
  Items: Record<string, unknown>[]
}

const SAMPLE_TYPES_PATH = 'SampleTypes.json' // канонічна назва -- та сама, що пише сам рушій (task-2-report.md)

function findSampleTypesFile(project: Project): ProjectFile | undefined {
  return project.files.find((f) => f.kind === 'sampleTypes')
}

export type ApplySampleTypeEditResult = { ok: true; project: Project } | { ok: false; error: string }

export function applySampleTypeEdit(
  project: Project,
  classId: string,
  updater: (item: Record<string, unknown>) => void,
): ApplySampleTypeEditResult {
  const file = findSampleTypesFile(project)
  if (!file) return { ok: false, error: 'SampleTypes.json не завантажено' }

  const doc = file.parsed as SampleTypesFileDoc | undefined
  if (!doc || !Array.isArray(doc.Items)) return { ok: false, error: `файл типів зразків не розібрано: ${file.path}` }

  const matchIdx: number[] = []
  doc.Items.forEach((it, i) => {
    if (it && typeof it === 'object' && (it as Record<string, unknown>).Id === classId) matchIdx.push(i)
  })
  if (matchIdx.length === 0) return { ok: false, error: `тип зразка '${classId}' не знайдено у SampleTypes.json` }
  if (matchIdx.length > 1) return { ok: false, error: 'дубль Id у SampleTypes.json — виправте вручну' }

  // structuredClone ЛИШЕ ЦЬОГО документа -- те саме застереження, що й applyDataItemEdit:
  // решта Project.files лишаються ТИМИ САМИМИ посиланнями, оригінальний doc/file.parsed
  // після виклику -- без змін.
  const newDoc = structuredClone(doc) as SampleTypesFileDoc
  updater(newDoc.Items[matchIdx[0]])

  const newFile: ProjectFile = { ...file, parsed: newDoc, dirty: true }
  const newFiles = project.files.map((f) => (f === file ? newFile : f))
  return { ok: true, project: { ...project, files: newFiles } }
}

export type CreateSampleTypeResult = { ok: true; project: Project } | { ok: false; error: string }

// createSampleType: додає новий запис ZP_SampleTypeDef із дефолтами Enforce-класу
// (ZP_SampleTypesConfig.c:12-18: Enabled=true, Name='', Description='') -- дзеркало
// createDataItem, БЕЗ поля Points (зразок -- проміжна ланка, нагороди йому не належать,
// спека §4a). Existence-перевірка КЕЙС-ІНСЕНСИТИВНА -- та сама причина, що й у
// createDataItem: питання ГРОВОЇ семантики ("сервер вважав би цей клас уже
// налаштованим?", ZP_SampleTypesConfig.Find -- кейс-інсенситивний лукап), а не пошук
// конкретного JSON-запису за точним ключем.
//
// НАВМИСНО без isSampleClass-гейту тут: ця функція -- io/*, без залежності від
// model/classIndex чи model/sampleContent (той самий принцип розділення, що
// dataItemEdit.ts, коментар там же). Єдиний живий викликач (SampleTypesView.tsx) уже
// гейтований на рівні UI -- кнопка "+ Створити запис" рендериться лише для класів, які
// listSampleFamilyClasses (model/sampleContent.ts) і так відібрав через isKindOf.
export function createSampleType(project: Project, classId: string): CreateSampleTypeResult {
  const file = findSampleTypesFile(project)
  if (!file) return { ok: false, error: 'SampleTypes.json не завантажено' }

  const doc = file.parsed as SampleTypesFileDoc | undefined
  if (!doc || !Array.isArray(doc.Items)) return { ok: false, error: `файл типів зразків не розібрано: ${file.path}` }

  const needle = classId.toLowerCase()
  const exists = doc.Items.some((it) => it && typeof it === 'object' && typeof (it as Record<string, unknown>).Id === 'string' && ((it as Record<string, unknown>).Id as string).toLowerCase() === needle)
  if (exists) return { ok: false, error: `тип зразка '${classId}' уже налаштований` }

  const newDoc = structuredClone(doc) as SampleTypesFileDoc
  newDoc.Items.push({ Id: classId, Enabled: true, Name: '', Description: '' })

  const newFile: ProjectFile = { ...file, parsed: newDoc, dirty: true }
  const newFiles = project.files.map((f) => (f === file ? newFile : f))
  return { ok: true, project: { ...project, files: newFiles } }
}

export type CreateSampleTypesFileResult = { ok: true; project: Project } | { ok: false; error: string }

// createSampleTypesFile: додає ЦІЛИЙ НОВИЙ ProjectFile (не запис усередині наявного файлу) --
// дивись пояснення різниці нагорі файлу. Канонічний порожній документ ({ConfigVersion:1,
// Items:[]}) -- байт-у-байт та сама форма, яку сервер сам пише при першому боті на
// чистому профілі (SetDefaults() порожній, task-2-report.md, gold-фікстура
// tests/fixtures/gold/SampleTypes.json: 43 байти, той самий літерал полів).
// originalBytes лишається порожнім масивом -- той самий "чесний" конвент, що
// io/project.ts застосовує до foreign-файлів і що tests/*.ts вже використовують для
// БУДЬ-ЯКОГО ProjectFile, зібраного вручну не через loadProject (файл фізично ще не
// існує на диску, тож "оригінальні байти" -- порожні; після першого saveDirty
// originalBytes посунеться на щойно записані байти, той самий механізм, що й для
// решти конфігів, io/project.ts:217).
//
// Захист від подвійного виклику: якщо файл СЕРЕД project.files уже є (сampleTypesLoaded
// мала б заборонити саму кнопку в UI, але мутатор не покладається на це -- той самий
// принцип "io/* сам відмовляє, а не довіряє єдиному викликачу", що й applySampleTypeEdit/
// applyDataItemEdit), явна відмова замість тихого дублювання файлу з тим самим kind.
export function createSampleTypesFile(project: Project): CreateSampleTypesFileResult {
  if (findSampleTypesFile(project)) return { ok: false, error: 'SampleTypes.json уже є в проєкті' }

  const doc: SampleTypesFileDoc = { ConfigVersion: 1, Items: [] }
  const newFile: ProjectFile = {
    path: SAMPLE_TYPES_PATH,
    kind: 'sampleTypes',
    originalBytes: new Uint8Array(0),
    parsed: doc,
    warnings: [],
    dirty: true,
  }
  return { ok: true, project: { ...project, files: [...project.files, newFile] } }
}
