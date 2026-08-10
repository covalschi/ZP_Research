// Резолв "лиця" виходів-заготовок ZP_Data_* і зразків ZP_Sample_* — ІГРОВЕ ім'я/опис/стан
// класу за даними DataItems.json/SampleTypes.json (W2 Task 9 + W2.5 Task 4). Винесено з
// ui/ChainView.tsx у модельний шар (W2.6 Task 1, рев'ю брифа): stationView.ts (чиста
// модель станків, БЕЗ UI) потребує ТІЄЇ САМОЇ логіки для "ігрового імені" сировини/виходів
// у вікнах станків -- імпортувати React-компонент (ui/ChainView.tsx) з чистого модельного
// файлу було б порушенням шару (модель не має знати про UI), а друга копія тієї самої
// логіки в stationView.ts була б РІВНО тим дрейфом двох копій, якого весь цей кодекс
// свідомо уникає (той самий принцип, що вже написаний у chainGraph.ts над matchClassMirror
// і в classIndex.ts над MULTI_FILE_DIRS). Логіка тут -- ПОБАЙТОВО та сама, що була в
// ChainView.tsx до цього переносу; ChainView.tsx тепер лише ре-експортує ці символи
// (публічний API компонента для chainView.test.ts не змінився).
//
// ВАЖЛИВО: жодного стрипу "|N" тут НЕ додано (переносилось verbatim) -- виклики цих
// функцій зі stationView.ts самі роблять stripExact() ДО передачі classname сюди (див.
// коментар над resolveStationItemDisplay у stationView.ts); виклики з ChainView.tsx й
// далі передають Outputs[].Classname/InputItem.Classname як є, без зміни поведінки.

import type { Project } from '../io/project'
import type { ClassIndex } from './classIndex'
import { isKindOf } from './classIndex'
import { isSampleClass } from './sampleContent'

// ---- Data-face виходів-заготовок ZP_Data_* (W2 Task 9) -------------------------------------
// Директива власника (2026-08-07): картка ланцюга показує ІГРОВЕ ім'я виходу, не голий
// класнейм — для заготовок результату досліджень (ZP_Data_01..90, дзеркало
// ZP_DataItemsConfig.c) ім'я/опис/бали задані окремим конфігом DataItems.json і можуть не
// збігатися з класнеймом узагалі. "Заготовка" тут — РІВНО той клас, що сервер визнає
// заготовкою: `GetGame().IsKindOf(d.Id, "ZP_Data_Base")` (ZP_DataItemsConfig.c:86,
// ValidateItem) — тому виявлення "чи це вихід-заготовка" йде ЧЕРЕЗ isKindOf(ClassIndex),
// а не рядковим префіксом "ZP_Data_": дзеркалить те САМЕ дерево спадкування, яким керується
// сервер (перевірено: ZP_Data_Base і ZP_Data_01..90 присутні в classindex.json, ZP_Data_01
// має baseIdx на ZP_Data_Base), і не зламається, якщо колись зʼявиться заготовка з іншим
// ім'ям класу. Виходи, що НЕ належать до родини (звичайна сировина, ZP_Sample-зразок із
// Content) НІКОЛИ не отримують data-face — рендеряться звичайним ItemTag, як і до цього
// таска (інакше кожен НЕналаштований звичайний вихід хибно показував би "не налаштовано").
//
// Пошук запису в DataItems.json — КЕЙС-ІНСЕНСИТИВНИЙ (дзеркало ZP_DataItemsConfig.Find,
// ZP_DataItemsConfig.c:53-69: рушій усі config-lookup'и робить без урахування регістру).
// На відміну від Find на сервері, тут НЕ фільтруються вимкнені записи (`!d.Enabled`) —
// сервер/клієнт у грі показали б запасну назву зі stringtable («Біодані / Аномальні дані /
// Технічні дані NN (не налаштовано)» — залежно від групи класу, build\gen-data-classes.ps1)
// для вимкненої заготовки (Find її пропускає), а адміну редактора важливо
// бачити САМЕ ЦЕ: "запис є, але вимкнений" —
// інакше вимкнена заготовка виглядала б так само, як і зовсім ненастроєна, і адмін не
// зрозумів би, чому в грі не спрацювало.
export interface DataItemFace {
  classname: string
  // isKindOf(classname, 'ZP_Data_Base') — чи ЦЕЙ клас узагалі належить до родини заготовок.
  isDataItem: boolean
  // Чи є запис із таким Id (кейс-інсенситивно) у DataItems.json.
  configured: boolean
  // Дублікат Id (кейс-інсенситивно) у DataItems.json -- дивись findDataItemEntry/
  // countDataItemMatches нижче. Коли true, name/description/enabled/points нижче все одно
  // заповнені (з ОСТАННЬОГО запису -- того самого, що виживе після серверного Validate),
  // АЛЕ споживачі (картка/квик-редактор) НЕ мають подавати це як звичайний "налаштовано" --
  // рушій сам зітре решту дублів при наступному Validate/reload, тож стан ненадійний, поки
  // адмін не виправить файл вручну.
  duplicate: boolean
  // Id ЯК ЗБЕРЕЖЕНО у файлі (може відрізнятись регістром від classname запиту) — саме це
  // значення передається в applyDataItemEdit як ключ мутації.
  entryId?: string
  enabled: boolean
  name: string
  description: string
  points: { Type: string; Amount: number }[]
}

function findDataItemsDoc(project: Project): { Items: unknown[] } | undefined {
  const file = project.files.find((f) => f.kind === 'dataItems')
  const doc = file?.parsed as { Items?: unknown[] } | undefined
  if (!doc || !Array.isArray(doc.Items)) return undefined
  return doc as { Items: unknown[] }
}

// findDataItemEntry: серед doc.Items повертає ОСТАННІЙ (за порядком масиву) запис, чий Id
// збігається кейс-інсенситивно -- дзеркало серверного Validate (ZP_DataItemsConfig.c:
// 107-137): цикл іде ВІД КІНЦЯ масиву ДО ПОЧАТКУ (`for (int i = Items.Count()-1; i >= 0;
// i--)`), кожен ключ (lower-case Id) кладеться в "seen" при ПЕРШОМУ (з кінця) траплянні, а
// БУДЬ-ЯКЕ повторне трапляння (тобто РАНІШЕ в масиві, бо йдемо у зворотному напрямку) --
// це дублікат, і саме він видаляється (`Items.RemoveOrdered(i)`), не той, що вже в "seen".
// Отже жива конфігурація сервера ЗАВЖДИ лишає ОСТАННІЙ елемент масиву з даним Id; редактор,
// що показав би ПЕРШИЙ (Array.find), брехав би адміну -- картка показувала б запис, який
// рушій сам видалить при наступному Validate/reload.
// Експортовано (W4 Task 4): ui/dataItemRows.ts читає СИРІ поля запису, що виживе (Name/
// Points), для дзеркала руйнівного ValidateItem — друга копія last-wins-обходу була б рівно
// тим дрейфом, проти якого написана шапка цього модуля.
export function findDataItemEntry(project: Project, classname: string): Record<string, unknown> | undefined {
  const doc = findDataItemsDoc(project)
  if (!doc) return undefined
  const needle = classname.toLowerCase()
  for (let i = doc.Items.length - 1; i >= 0; i--) {
    const raw = doc.Items[i]
    if (!raw || typeof raw !== 'object') continue
    const d = raw as Record<string, unknown>
    if (typeof d.Id === 'string' && d.Id.toLowerCase() === needle) return d
  }
  return undefined
}

// countDataItemMatches: скільки записів мають Id, що збігається кейс-інсенситивно з
// classname -- та сама лічба, на якій тримається серверне попередження "дубль Id"
// (ZP_DataItemsConfig.c:124-129, `seen.Find(key) > -1`). >1 означає, що
// findDataItemEntry вище повертає лише ОДИН із декількох (останній) -- решта мовчки
// зникнуть на сервері при наступному Validate, і DataItemFace.duplicate нижче про це
// попереджає, замість подавати "останній" як надійний "налаштовано".
function countDataItemMatches(project: Project, classname: string): number {
  const doc = findDataItemsDoc(project)
  if (!doc) return 0
  const needle = classname.toLowerCase()
  let n = 0
  for (const raw of doc.Items) {
    if (!raw || typeof raw !== 'object') continue
    const d = raw as Record<string, unknown>
    if (typeof d.Id === 'string' && d.Id.toLowerCase() === needle) n++
  }
  return n
}

export function resolveDataItemFace(project: Project, index: ClassIndex, classname: string): DataItemFace {
  const isDataItem = classname !== '' && isKindOf(index, classname, 'ZP_Data_Base')
  const entry = classname !== '' ? findDataItemEntry(project, classname) : undefined
  const duplicate = classname !== '' && countDataItemMatches(project, classname) > 1
  if (!entry) {
    return { classname, isDataItem, configured: false, duplicate, enabled: false, name: classname, description: '', points: [] }
  }
  const points: { Type: string; Amount: number }[] = []
  for (const raw of (entry.Points as unknown[] | undefined) ?? []) {
    if (!raw || typeof raw !== 'object') continue
    const p = raw as Record<string, unknown>
    points.push({ Type: typeof p.Type === 'string' ? p.Type : '', Amount: typeof p.Amount === 'number' ? p.Amount : 0 })
  }
  return {
    classname,
    isDataItem,
    configured: true,
    duplicate,
    entryId: typeof entry.Id === 'string' ? entry.Id : classname,
    enabled: entry.Enabled !== false,
    name: typeof entry.Name === 'string' && entry.Name ? entry.Name : classname,
    description: typeof entry.Description === 'string' ? entry.Description : '',
    points,
  }
}

export function unresolvedDataItemFace(classname: string): DataItemFace {
  return { classname, isDataItem: false, configured: false, duplicate: false, enabled: false, name: classname, description: '', points: [] }
}

// ---- Data-face входів/виходів-зразків ZP_Sample_* (W2.5 Task 4) ----------------------------
// Дзеркало DataItemFace/resolveDataItemFace ВИЩЕ, АЛЕ для іншої родини й з іншим джерелом
// файлу (SampleTypes.json, kind==='sampleTypes'): зразок — ПРОМІЖНА ланка ланцюга (спека
// §4a), тому в нього немає Points/Depositable (ZP_SampleTypeDef, task-2-report.md), а
// родина визначається через isSampleClass (model/sampleContent.ts, isKindOf на
// 'ZP_Sample_Base') — той самий спільний хелпер, яким уже користується авто-визначення
// Content (W2 Task 6), а не власна копія isKindOf-виклику.
//
// На відміну від DataFaceTag (виходи заготовок), тег зразка застосовується і до ВХОДУ
// правила (input), і до кожного виходу — обидві позиції в мод-дизайні цілком легально
// несуть клас родини ZP_Sample_Base (сирий матеріал -> зразок [вихід одного правила] ->
// зразок як вхід НАСТУПНОГО правила аналізу).
export interface SampleTypeFace {
  classname: string
  // isKindOf(classname, 'ZP_Sample_Base') через isSampleClass — чи ЦЕЙ клас узагалі
  // належить до родини зразків.
  isSample: boolean
  // Чи є запис із таким Id (кейс-інсенситивно) у SampleTypes.json.
  configured: boolean
  // Дублікат Id (кейс-інсенситивно) у SampleTypes.json — та сама семантика, що
  // DataItemFace.duplicate: name/description/enabled нижче взяті з ОСТАННЬОГО запису (той,
  // що виживе на сервері), але сам факт дублю означає ненадійний стан до ручного фіксу.
  duplicate: boolean
  // Id ЯК ЗБЕРЕЖЕНО у файлі -- значення, яке йде в applySampleTypeEdit як ключ мутації.
  entryId?: string
  enabled: boolean
  name: string
  description: string
}

function findSampleTypesDoc(project: Project): { Items: unknown[] } | undefined {
  const file = project.files.find((f) => f.kind === 'sampleTypes')
  const doc = file?.parsed as { Items?: unknown[] } | undefined
  if (!doc || !Array.isArray(doc.Items)) return undefined
  return doc as { Items: unknown[] }
}

// findSampleTypeEntry: ОСТАННІЙ (за порядком масиву) запис із кейс-інсенситивно
// збіжним Id -- дзеркало серверного Validate (ZP_SampleTypesConfig.c:78-108, той самий
// зворотний обхід і "seen"-механізм, що ZP_DataItemsConfig.Validate), last-wins.
function findSampleTypeEntry(project: Project, classname: string): Record<string, unknown> | undefined {
  const doc = findSampleTypesDoc(project)
  if (!doc) return undefined
  const needle = classname.toLowerCase()
  for (let i = doc.Items.length - 1; i >= 0; i--) {
    const raw = doc.Items[i]
    if (!raw || typeof raw !== 'object') continue
    const d = raw as Record<string, unknown>
    if (typeof d.Id === 'string' && d.Id.toLowerCase() === needle) return d
  }
  return undefined
}

// countSampleTypeMatches: та сама лічба, на якій тримається серверне попередження "дубль
// Id" (ZP_SampleTypesConfig.c:95-97, `seen.Find(key) > -1`) -- дзеркало countDataItemMatches.
function countSampleTypeMatches(project: Project, classname: string): number {
  const doc = findSampleTypesDoc(project)
  if (!doc) return 0
  const needle = classname.toLowerCase()
  let n = 0
  for (const raw of doc.Items) {
    if (!raw || typeof raw !== 'object') continue
    const d = raw as Record<string, unknown>
    if (typeof d.Id === 'string' && d.Id.toLowerCase() === needle) n++
  }
  return n
}

export function resolveSampleTypeFace(project: Project, index: ClassIndex, classname: string): SampleTypeFace {
  const isSample = classname !== '' && isSampleClass(index, classname)
  const entry = classname !== '' ? findSampleTypeEntry(project, classname) : undefined
  const duplicate = classname !== '' && countSampleTypeMatches(project, classname) > 1
  if (!entry) {
    return { classname, isSample, configured: false, duplicate, enabled: false, name: classname, description: '' }
  }
  return {
    classname,
    isSample,
    configured: true,
    duplicate,
    entryId: typeof entry.Id === 'string' ? entry.Id : classname,
    enabled: entry.Enabled !== false,
    name: typeof entry.Name === 'string' && entry.Name ? entry.Name : classname,
    description: typeof entry.Description === 'string' ? entry.Description : '',
  }
}

export function unresolvedSampleTypeFace(classname: string): SampleTypeFace {
  return { classname, isSample: false, configured: false, duplicate: false, enabled: false, name: classname, description: '' }
}

// Контекст резолву обох лиць, ПРОКИДАНИЙ ЯВНО (не через ambient/контекст React) — спільний
// для ChainView.tsx (T5/T9/W2.5) і stationView.ts (W2.6 T1): обидва лише читають Project +
// ClassIndex, тож форма контексту РОДОВА і живе тут, а не в ui-шарі.
export interface FaceResolveCtx {
  project: Project
  index: ClassIndex
}
