// Модель проєкту (Task 6): зчитує сирі шляхи бекенда, класифікує їх на вісім конфігів
// редактора + "чуже" (foreign), розбирає впізнані файли терпимим парсером (Task 5) і
// зберігає позначені dirty назад канонічним серіалізатором (Task 4).
//
// Класифікація шляхів і сортування rules/techTree — ЧИСТІ ФУНКЦІЇ БЕЗ БЕКЕНДА, навмисно:
// DirectoryBackend (File System Access API) неможливо юніт-тестувати в Node (немає
// showDirectoryPicker), тож уся логіка, яку треба перевірити тестами, живе тут і
// перевіряється через ZipBackend (тестовний бекенд-двійник) — самі backend-класи
// (backend.ts) лишаються тонкими обгортками над списком/читанням/записом байтів.

import type { StorageBackend } from './backend'
import type { ConfigKind } from '../model/types'
import { SCHEMAS } from '../model/schema'
import { parseConfig } from './parse'
import type { Warning } from './parse'
import { encodeConfig } from './jsonWriter'
import { pointTypesGateAlarms } from '../model/configValidation'

export interface ProjectFile {
  path: string
  kind: ConfigKind | 'foreign'
  originalBytes: Uint8Array
  parsed?: unknown
  warnings: Warning[]
  dirty: boolean
}

export interface Project {
  files: ProjectFile[]
  backend: StorageBackend
  // Черга ВИДАЛЕНЬ (W4 Task 6, хвіст капстоуна №1): шляхи, які адмін видалив у редакторі й
  // які saveDirty мусить прибрати зі сховища. Дзеркальна пара до dirty: правка файлу
  // доїжджає до диска на «Зберегти зміни», видалення — теж, а не миттєво по кліку (інакше
  // це була б ЄДИНА незворотна дія редактора, і ZIP-шлях, де «диск» зʼявляється лише на
  // експорті, поводився б інакше за теку).
  // Поле НЕОБОВʼЯЗКОВЕ: Project збирають вручну десятки тестових фікстур і майбутні
  // інструменти — «немає поля» означає «черга порожня» (pendingDeletions нижче — єдина
  // точка читання, ніхто не звертається до project.deleted напряму).
  deleted?: string[]
}

// Єдина точка читання черги видалень — щоб опційність поля не розповзлась `?? []` по
// коду (той самий принцип «одна копія умови», що fileHasAlarm/isMultiFileDir нижче).
export function pendingDeletions(project: Project): string[] {
  return project.deleted ?? []
}

// ---- Класифікація шляхів ------------------------------------------------------------------
// Відносні шляхи, роздільник '/' (нормалізацію '\' -> '/' роблять самі бекенди в backend.ts).
// Шість одиночних файлів (sampleTypes/SampleTypes.json додано W2.5 Task 3, дзеркало
// dataItems) — регістронезалежний збіг ІМЕНІ файлу (адмін міг зберегти файл як
// "settings.json", рушій це проковтне так само). ProcessingRules/ і TechTree/ — ТЕЖ
// регістронезалежний збіг імені каталогу (W2 Task 4, відкладений minor рев'ю W1; було
// "точний регістр каталогу", бо сервер сам створює ці каталоги саме так -- але Windows FS
// регістронезалежна, і адмін чи сторонній інструмент цілком міг зберегти "processingrules";
// сервер (рушійний FindFile) теж не розрізняє регістр каталогу при пошуку, дивись
// isMultiFileDir нижче). Рівно один сегмент підкаталогу: "ProcessingRules/nested/x.json"
// (два рівні вкладеності) — теж foreign, бо сервер (ZP_ConfigService) читає з цих каталогів
// лише плоским FindFile, без рекурсії. УСЕ інше — foreign: FactionData/, PlayerData/,
// ConfigBackup/, StaticDevices*.json, невідомі файли, будь-яка вкладеність під невідомим
// каталогом.
const SINGLE_FILE_KIND_BY_LOWER_NAME: Record<string, ConfigKind> = {
  'settings.json': 'settings',
  'pointtypes.json': 'pointTypes',
  'factions.json': 'factions',
  'dataitems.json': 'dataItems',
  'modules.json': 'modules',
  'sampletypes.json': 'sampleTypes',
}

// Канонічний (як його завжди пише сам сервер) реєстр "яка директорія несе багато файлів
// одного ConfigKind" — джерело і для MULTI_FILE_DIRS (нижче), і для регістронезалежного
// MULTI_FILE_DIR_KIND_LOWER/isMultiFileDir (W2 Task 4), які й виконують РЕАЛЬНУ роботу
// класифікації/рекурсії тепер (рев'ю T6 раунд 1: одна незалежна копія цього переліку в
// backend.ts вже спричиняла дрейф — увесь наступний код у файлі будує похідні структури
// з ЦІЄЇ константи, а не дублює її).
const MULTI_FILE_DIR_KIND: Record<string, ConfigKind> = {
  ProcessingRules: 'rules',
  TechTree: 'techTree',
}

// Канонічний реєстр для тестів консистентності (tests/zip.test.ts: перебір "кожне ім'я
// звідси класифікується як rules/techTree", "кожен НЕ-одиночний ConfigKind має каталог
// тут"). Рекурсія/класифікація САМІ по собі більше НЕ звертаються до цього Set напряму —
// і backend.ts.DirectoryBackend.list(), і classifyPath нижче, і writeback.ts ідуть через
// регістронезалежний isMultiFileDir (W2 Task 4) — MULTI_FILE_DIRS лишається канонічним
// джерелом імен САМЕ для перевірки повноти, не точкою класифікації в рантаймі.
export const MULTI_FILE_DIRS: ReadonlySet<string> = new Set(Object.keys(MULTI_FILE_DIR_KIND))

// Регістронезалежне дзеркало тієї самої таблиці (W2 Task 4, відкладений minor рев'ю W1):
// Windows FS регістронезалежна, і адмін цілком міг зберегти каталог як "processingrules" —
// сервер (рушійний FindFile) теж не розрізняє регістр каталогу при пошуку. Один додатковий
// Map ПОВЕРХ MULTI_FILE_DIR_KIND, а не друга незалежна таблиця -- саме та розбіжність двох
// копій ("classifyPath" і backend.ts мали кожен свій список), яку вже ловило рев'ю T6,
// раунд 1 (див. коментар до MULTI_FILE_DIRS/isMultiFileDir нижче).
const MULTI_FILE_DIR_KIND_LOWER = new Map<string, ConfigKind>(
  Object.entries(MULTI_FILE_DIR_KIND).map(([dir, kind]) => [dir.toLowerCase(), kind]),
)

// Єдина точка "чи це каталог із багатьма файлами" для ОБОХ споживачів, які мусять
// узгоджено бачити регістр каталогу як несуттєвий: classifyPath нижче (класифікація шляху
// проєкту) і DirectoryBackend.list() у backend.ts (рекурсія при обході File System Access
// API). Раніше backend.ts дивився на MULTI_FILE_DIRS.has(name) напряму (case-sensitive
// Set) — рекурсія в "processingrules/x.json" мовчки не спрацьовувала б, хоча classifyPath
// (після цього фіксу) уже класифікував би такий шлях як 'rules'; на диску такий каталог
// узагалі не потрапив би у список файлів. Тепер обидва місця йдуть через ЦЮ функцію.
export function isMultiFileDir(name: string): boolean {
  return MULTI_FILE_DIR_KIND_LOWER.has(name.toLowerCase())
}

// Для тесту повноти (tests/zip.test.ts): дзеркальний до MULTI_FILE_DIRS набір з боку
// "одиночних" ConfigKind — щоб перевірити, що кожен ConfigKind зі SCHEMAS потрапляє РІВНО в
// одну з двох категорій (жоден новий kind не забутий в обох мапах одночасно).
export const SINGLE_FILE_KINDS: ReadonlySet<ConfigKind> = new Set(Object.values(SINGLE_FILE_KIND_BY_LOWER_NAME))

// Огорожений lookup у голому об'єкт-літералі (рев'ю W1, Important): бракетний доступ на
// звичайному Record успадковує Object.prototype, тож ім'я файлу/каталогу "constructor"
// повертало б Object.prototype.constructor (СПРАВЖНЯ функція, істинне значення!) замість
// undefined — classifyPath('constructor/x.json') віддавав би цей об'єкт як "kind", а
// loadProject падав на SCHEMAS[kind].fields (kind — не рядковий ключ SCHEMAS). Те саме для
// '__proto__', 'toString', 'hasOwnProperty' і решти успадкованих імен. Object.hasOwn —
// єдина точка захисту для ОБОХ таблиць нижче.
function lookup<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined
}

export function classifyPath(path: string): ConfigKind | 'foreign' {
  const segments = path.split('/').filter((s) => s.length > 0)
  if (segments.length === 1) {
    return lookup(SINGLE_FILE_KIND_BY_LOWER_NAME, segments[0].toLowerCase()) ?? 'foreign'
  }
  if (segments.length === 2 && segments[1].toLowerCase().endsWith('.json')) {
    const kind = MULTI_FILE_DIR_KIND_LOWER.get(segments[0].toLowerCase())
    if (kind) return kind
  }
  return 'foreign'
}

// ---- Сортування = дзеркало ZP_ConfigService.c:670 SortFileNames ---------------------------
// Стабільне сортування за ASCII-нижнім регістром ІМЕНІ (лише A-Z -> a-z: рушійний
// String.ToLower на іменах файлів — це не гарантована повна Unicode-семантика, а самі імена
// конфігів у проєкті завжди ASCII; тому тут НАВМИСНО не використовується
// String.prototype.toLowerCase(), яка лишень регістру ASCII не обмежується). Порядок при
// рівних ключах — порядок появи у вхідному масиві: рушійне SortFileNames — вставкове
// сортування, що зсуває елемент лише коли попередній СТРОГО більший (`prevLow <= curLow`
// зупиняє зсув), тобто воно стабільне; Array.prototype.sort у сучасних рушіях теж стабільний
// за специфікацією (ES2019+), явний tie-break за індексом нижче — подвійна страховка, а не
// обхід нестабільності.
function asciiLowerKey(name: string): string {
  let out = ''
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i)
    out += c >= 0x41 && c <= 0x5a ? String.fromCharCode(c + 0x20) : name[i]
  }
  return out
}

// Порівняння ДВОХ імен тим самим серверним ключем (експортовано для io/stationEdit.ts,
// W2.6 Task 3): новий файл правил мусить стати в той самий порядок, який встановить
// SortFileNames при наступному завантаженні на сервері — інакше редактор показував би
// пріоритет правил (порядок файлів = порядок застосування, FindStartableBackgroundRule
// бере перше підхоже) інакшим, ніж він буде в грі після рестарту. Однакові ключі — 0:
// викликач зберігає порядок появи (та сама стабільність, що й у sortLikeServer нижче).
export function compareLikeServer(a: string, b: string): number {
  const ka = asciiLowerKey(a)
  const kb = asciiLowerKey(b)
  return ka < kb ? -1 : ka > kb ? 1 : 0
}

export function sortLikeServer(names: string[]): string[] {
  return names
    .map((name, index) => ({ name, index, key: asciiLowerKey(name) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.index - b.index))
    .map((x) => x.name)
}

function basename(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? path : path.slice(idx + 1)
}

// Той самий ключ і порядок, що й sortLikeServer, але застосований до ПОВНИХ шляхів за їхнім
// basename — sortLikeServer (сигнатура з брифа/тесту) сортує голі імена без каталогу, а тут
// потрібно впорядкувати "ProcessingRules/X.json", зберігаючи префікс каталогу. Дублікати
// імені, що різняться лише регістром (напр. "Alpha.json" і "alpha.json" в одному каталозі),
// НЕ зливаються — це різні елементи масиву шляхів; порядок між ними — порядок появи на
// вході (той самий стабільний tie-break, що й у sortLikeServer).
function sortPathsByBasename(paths: string[]): string[] {
  return paths
    .map((path, index) => ({ path, index, key: asciiLowerKey(basename(path)) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.index - b.index))
    .map((x) => x.path)
}

// ---- Завантаження проєкту ------------------------------------------------------------------

export async function loadProject(backend: StorageBackend): Promise<Project> {
  const orderedPaths = orderPaths(await backend.list())
  const files: ProjectFile[] = []
  for (const path of orderedPaths) {
    const kind = classifyPath(path)
    if (kind === 'foreign') {
      // Свідомо НЕ читаємо байти чужих файлів/каталогів: FactionData/PlayerData несуть
      // персональні Steam64, ConfigBackup може бути великим, а редактору вони потрібні лише
      // як пункт списку ("це є в проєкті, ми це не чіпаємо") — не як вміст для розбору.
      // originalBytes лишається порожнім масивом (не undefined) — поле в ProjectFile не
      // опціональне.
      files.push({ path, kind, originalBytes: new Uint8Array(0), warnings: [], dirty: false })
      continue
    }
    const bytes = await backend.read(path)
    const text = new TextDecoder('utf-8').decode(bytes)
    const { value, warnings } = parseConfig(SCHEMAS[kind], text)
    files.push({ path, kind, originalBytes: bytes, parsed: value, warnings, dirty: false })
  }
  return { files, backend, deleted: [] }
}

// Впорядковує rules- і techTree-групи через sortPathsByBasename (сервер: пріоритет
// застосування правил і черговість гілок дерева = порядок файлів у каталозі), решту
// (шість одиночних файлів + foreign) лишає в порядку, який віддав backend.list() — на них
// сервер жодного порядку не накладає.
function orderPaths(paths: string[]): string[] {
  const rest: string[] = []
  const rules: string[] = []
  const techTree: string[] = []
  for (const p of paths) {
    const kind = classifyPath(p)
    if (kind === 'rules') rules.push(p)
    else if (kind === 'techTree') techTree.push(p)
    else rest.push(p)
  }
  return [...rest, ...sortPathsByBasename(rules), ...sortPathsByBasename(techTree)]
}

// ---- Збереження -------------------------------------------------------------------------

export interface SaveResult {
  written: string[]
  removed: string[]
}

// saveDirty застосовує до сховища ОБИДВІ відкладені дії редактора: спершу чергу видалень
// (deleted), потім записи dirty-файлів.
//
// ПОРЯДОК ВАЖЛИВИЙ і саме такий навмисно: адмін цілком може видалити файл і одразу
// створити НОВИЙ під тим самим імʼям (типовий «почати цю гілку/ланцюг з нуля» —
// createRulesFile/createTreeBranchFile перевіряють зайнятість шляху ПО ПРОЄКТУ, а не по
// диску, тож після видалення шлях знову вільний). Зворотний порядок стер би щойно
// записаний файл — регресія, закріплена тестом (tests/fileDelete.test.ts).
//
// Стан оновлюється ПОШЛЯХОВО, одразу після успіху кожної операції (`file.dirty = false`
// тут був завжди — це той самий стиль мутації на місці, який App.tsx компенсує touch()):
// якщо видалення на середині черги впаде (немає дозволу на теку, файл заблокований),
// уже видалені шляхи з черги зникнуть, а той, що впав, і всі наступні — лишаться, і
// повторне «Зберегти зміни» доробить решту.
//
// ЗАПИСИ НЕ ЗАРУЧНИКИ ВИДАЛЕНЬ (ревью T6, Important 2): збій `remove` (заблокований файл,
// відкликаний дозвіл на теку) РАНІШЕ кидав виняток одразу і жоден dirty-файл не
// записувався — рідкісна умова ОС перетворювалась на «нічого не зберегти взагалі», а
// єдиним виходом було перевідкрити проєкт, втративши всі незбережені правки. Тепер помилки
// видалення КОПИЧАТЬСЯ, записи все одно виконуються, і аж наприкінці кидається зведена
// помилка: адмін бачить, що саме не видалилось, але його правки вже на диску.
export async function saveDirty(project: Project): Promise<SaveResult> {
  const removed: string[] = []
  const removeErrors: string[] = []
  const pending = pendingDeletions(project)
  if (pending.length > 0) {
    const remove = project.backend.remove
    if (!remove) {
      throw new Error('цей бекенд не вміє видаляти файли — видалення не застосовано (черга лишилась)')
    }
    // Дублі в черзі (видалити -> створити під тим самим імʼям -> видалити знову) не мають
    // рахуватись двічі у звіті (ревью T6, minor 4): проходимо по УНІКАЛЬНИХ шляхах.
    for (const path of [...new Set(pending)]) {
      try {
        await remove.call(project.backend, path)
        removed.push(path)
        project.deleted = pendingDeletions(project).filter((p) => p !== path)
      } catch (e) {
        removeErrors.push(`${path}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  const written: string[] = []
  for (const file of project.files) {
    if (!file.dirty) continue
    if (file.kind === 'foreign') continue // foreign НІКОЛИ не пишеться, навіть якщо dirty
    const bytes = encodeConfig(SCHEMAS[file.kind], file.parsed)
    await project.backend.write(file.path, bytes)
    file.originalBytes = bytes // диск щойно перезаписано — базова лінія теж посувається
    file.dirty = false
    written.push(file.path)
  }
  if (removeErrors.length > 0) {
    throw new Error(
      `правки збережено (файлів: ${written.length}), але видалення не вдалося: ${removeErrors.join('; ')} — шляхи лишились у черзі, спробуйте ще раз`,
    )
  }
  return { written, removed }
}

// ---- Гейт при кривих типах (W2.7 Task 1) -------------------------------------------------
// Рішення власника (CLAUDE.md, «РІШЕННЯ ВЛАСНИКА (2026-08-07, після приймання W2.6)», п.2):
// поки в проєкті лишається бодай один файл із alarm-попередженням (io/parse.ts:
// coerceInt/Float/Bool/String — хибнотипізоване ПРИСУТНЄ скалярне значення), збереження й
// експорт відмовляють ЦІЛКОМ. Обґрунтування — T8-зонд (W2, задокументовано в parse.ts:
// wrongTypeNote): ZP_ConfigService.c:383-393 TryLoadX() на хибному типі повертає false, і
// рушій відхиляє ВЕСЬ файл (усі його правила/вузли/записи) на найближчому перезавантаженні
// сервера — не лише зіпсоване поле. Недоторканий (не-dirty) файл ZIP-експорт пакує його
// ОРИГІНАЛЬНИМИ байтами (W1: dirty=false нічого не переписує) — тобто без гейту експорт
// міг би непомітно поширити саме ці биті байти.

// Чи є серед попереджень ОДНОГО файлу хоч одне alarm-рівня. Спільний предикат для
// FileList.tsx (лампа рядка реєстру) і alarmFiles нижче — один вираз, а не дві незалежні
// копії (та сама дисципліна, що звела MULTI_FILE_DIR_KIND_LOWER в одну таблицю вище: рев'ю
// T6 раунд 1 уже ловило дрейф двох копій того самого списку).
export function fileHasAlarm(file: ProjectFile): boolean {
  return file.warnings.some((w) => w.severity === 'alarm')
}

// Усі файли проєкту з хоч одним alarm-попередженням — саме цей список і дизейблить
// «Зберегти зміни»/«Завантажити ZIP» та наповнює аварійну панель в App.tsx. foreign-файли
// НІКОЛИ сюди не потрапляють: явна перевірка kind нижче — не покладання на мовчазний
// інваріант (loadProject вище свідомо не читає байти foreign-файлів, тож їхній warnings
// завжди порожній масив), а самодокументований захист про всяк випадок.
export function alarmFiles(project: Project): ProjectFile[] {
  return project.files.filter((f) => f.kind !== 'foreign' && fileHasAlarm(f))
}

// ---- Гейт кнопок (W2.7 фікс-раунд 1, Important рев'ю) -------------------------------------
// canSave/canExport — чисті предикати, ТОЧНЕ дзеркало композитних умов, які раніше жили
// лише inline в JSX App.tsx (`disabled={busy || dirtyCount === 0 || alarmList.length > 0}` /
// `disabled={busy || dirtyCount > 0 || alarmList.length > 0}`) і мали лише непрямого свідка —
// браузерний смоук (t27-1-shoot.mjs). За де-морганівським тотожністю:
//   busy || dirtyCount===0 || alarm>0   ==  busy || !(dirtyCount>0 && alarm===0)
//   busy || dirtyCount>0   || alarm>0   ==  busy || !(dirtyCount===0 && alarm===0)
// тобто App.tsx лишає `busy ||` ЗОВНІ (busy — транзиентний UI-стан, якого немає в Project),
// а `!canSave(project)`/`!canExport(project)` підставляється на місце решти виразу без
// жодної зміни семантики. dirtyCount мірять через `.some(...)`, а не через
// `.filter(...).length` App.tsx — коротке замикання на першому dirty-файлі, результат
// той самий булевий тест (>0 / ===0).
// W4 Task 1: до parse-alarm-ів (кривих ТИПІВ значень) додається гейт ДАНИХ PointTypes —
// дубль Id / порожній Name / Tier поза межами валять завантаження цілого файлу на рестарті
// й блокують атомарний !zp reload (той самий клас ризику, що wrong-type W2.7, докази —
// шапка pointTypesGateAlarms у model/configValidation.ts). Гейт динамічний (перевіряє
// ПОТОЧНИЙ parsed при кожному виклику), тож ремонт мутатором вкладки відкриває кнопки
// одразу; repairFile до нього НЕ причетний (канонізація дубль не лагодить — саме тому це
// НЕ синтетичний alarm-warning у file.warnings, обґрунтування там само).
// Runtime-імпорт model/configValidation з io/ циклу не створює: той модуль тягне з io/
// лише типи (import type — стирається компілятором).
// W4 Task 6: черга видалень рахується НАРІВНІ з dirty в обох предикатах. Без цього
// видалення файлу в проєкті, де більше нічого не змінено, не мало б жодного способу
// доїхати до сховища: «Зберегти зміни» лишалось би заблокованим («немає dirty-файлів»), а
// «Завантажити ZIP» — навпаки дозволеним і спакував би стан ДО видалення (експорт бере
// байти зі сховища бекенда, а не з project.files).
export function canSave(project: Project): boolean {
  const hasWork = project.files.some((f) => f.dirty) || pendingDeletions(project).length > 0
  return hasWork && alarmFiles(project).length === 0 && pointTypesGateAlarms(project).length === 0
}

export function canExport(project: Project): boolean {
  const hasWork = project.files.some((f) => f.dirty) || pendingDeletions(project).length > 0
  return !hasWork && alarmFiles(project).length === 0 && pointTypesGateAlarms(project).length === 0
}

export type RepairFileResult = { ok: true; project: Project } | { ok: false; error: string }

// «Полагодити»/«Канонізувати файл» — ОДИН мутатор на обидві дії (App.tsx: handleCanonicalize
// і кнопка «Полагодити все» аварійної панелі): позначає файл dirty, нічого НЕ дописуючи в
// сам parsed (він УЖЕ несе нуль-семантику завантаження рушія — parse.ts coerceInt/Float/
// Bool/String падають на zeroValue поля, а не на дефолт Enforce-класу, — саме тому просте
// dirty=true + наступний saveDirty/encodeConfig ВЖЕ пише канонічні байти з правильними
// типами; жодної мутації самого parsed тут не потрібно). Єдина мутація, яку виконує repair
// сам, — знімає з файлу ЛИШЕ alarm-попередження (вони описували СТАРІ, тепер заплановані на
// заміну байти; plain warn лишається — він і далі правдиво описує стан parsed, наприклад
// "ключ відсутній", яке саме собою НЕ зникає від dirty=true).
//
// Дисципліна мутатора — той самий контракт, що applyRuleEdit/applyDataItemEdit (identity/
// no-mutation), АЛЕ БЕЗ structuredClone: тут немає жодної правки ВСЕРЕДИНІ parsed (на
// відміну від updater(item) у тих мутаторах), тож глибоке клонування дерева parsed було б
// зайвою роботою і зайвим ризиком (перевизначення посилання на об'єкт, що нічим не
// відрізняється від оригіналу). Замінюється лише С ЗАПИС файлу верхнього рівня (spread) —
// це й є "ціль" мутації тут; сам parsed лишається ТИМ САМИМ посиланням.
//
// Навмисно ЄДИНИЙ шлях для обох кнопок (не два незалежні): якби «Канонізувати файл» (per-
// file, T7-W1) лишався окремою реалізацією, що dirty=true проставляє, а alarm-попередження
// не чистить, — клік по ньому на alarm-файлі не розблокував би гейт (alarmFiles бачила б
// файл і далі), і адмін застряг би з "start dirty, save заблоковано" без жодного очевидного
// виходу. План W2.7 прямо вимагає: "адмін не може застрягти".
export function repairFile(project: Project, path: string): RepairFileResult {
  const file = project.files.find((f) => f.path === path)
  if (!file) return { ok: false, error: `файл не знайдено у проєкті: ${path}` }
  if (file.kind === 'foreign') return { ok: false, error: `чужий файл не редагується: ${path}` }

  const newFile: ProjectFile = {
    ...file,
    dirty: true,
    warnings: fileHasAlarm(file) ? file.warnings.filter((w) => w.severity !== 'alarm') : file.warnings,
  }
  const newFiles = project.files.map((f) => (f === file ? newFile : f))
  return { ok: true, project: { ...project, files: newFiles } }
}
