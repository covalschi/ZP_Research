// ClassIndex — компактний перелік класів предметів/техніки з PBO клієнтського модпака
// (ваніль + весь @*-каталог `DayZ\!Workshop` + власні `@ZP_Research`/`@ZP_Research_VPP`),
// для дропдаунів редактора з живим пошуком і перевірки IsKindOf (спадкування класів у
// правилах/дереві). Джерело — `scripts/gen-classindex.py` (поза webeditor/, звичайний
// Python-скрипт, НЕ npm-залежність): один прохід по ~470 PBO генерує
// `src/data/classindex.json`, цей модуль лише завантажує вже готовий файл і надає над ним
// типізовані операції.
//
// Формат СВІДОМО компактний — масиви замість об'єкта на кожен клас (десятки тисяч рядків):
// `classes: [name, baseIdx, modIdx, root][]`. baseIdx — індекс БАТЬКА в цьому ж масиві
// (-1, якщо батько поза індексом або відсутній: forward-декларація без реального тіла,
// або посилання на клас, якого генератор не бачив у жодному просканованому PBO).

import raw from '../data/classindex.json'

// П'ЯТЬ коренів (W2 Task 4, рев'ю фікс-раунд 1, Important 3 -- виправляє попередню
// НЕТОЧНУ заяву коментаря нижче, яка стверджувала паритет із сервером на ТРЬОХ коренях):
// CfgVehicles/CfgMagazines/CfgNonAIVehicles/CfgAmmo/cfgWeapons — усі п'ять коренів, які
// перевіряє ZP_ProcessingRules.ClassExists на сервері (ZP_ProcessingConfig.c:175-188).
// Клас, якого немає в ЖОДНОМУ з п'яти, сервер відхилить валідацією так само, як і
// редактор мав би. До фіксу індекс покривав лише перші три -- клас зброї/боєприпасу
// (напр. ванільний "AKM" у cfgWeapons, "Bullet_762x39" у CfgAmmo), цілком валідний вхід
// правила на сервері, показувався б редактору як "клас не знайдено" і давав хибний
// unfed-input/dead-output розрив на робочому конфігу.
//
// НУМЕРАЦІЯ індексів (0/1/2/3/4) НЕ повторює порядок оголошення в самій ClassExists
// (там: CfgVehicles, CfgAmmo, CfgMagazines, cfgWeapons, CfgNonAIVehicles) -- нові
// CfgAmmo(3)/cfgWeapons(4) ДОДАНІ в кінець, а не вставлені за порядком сервера, аби не
// перенумеровувати (і тим самим не ламати) вже згенерований classindex.json та все, що
// на нього спирається; паритет тут -- це паритет МНОЖИНИ коренів і того, ЩО вважається
// "клас існує", а не буквального порядку перевірки. `cfgWeapons` -- лишається саме з
// малої літери "c": звірено НАПРЯМУ по реальному ванільному конфігу (weapons_firearms.pbo
// -> AKM/config.bin, CfgConvert.exe -txt) під час фіксу -- це не описка, а справжній
// регістр кореня в грі, і він точно збігається з рядковим літералом сервера
// ("cfgWeapons ") у ClassExists.
export type Root = 0 | 1 | 2 | 3 | 4

export const ROOT_NAMES: readonly [string, string, string, string, string] = [
  'CfgVehicles',
  'CfgMagazines',
  'CfgNonAIVehicles',
  'CfgAmmo',
  'cfgWeapons',
]

// Індекс v2 (T7 Step 0, директива власника про ігрові назви у вікнах станків W2.6):
// п'ятий елемент рядка -- РОЗВ'ЯЗАНЕ відображуване ім'я класу ('' якщо в конфігах його
// немає). Резолв $STR_-ключів через stringtable.csv робить ГЕНЕРАТОР (python-еталон і
// браузерний імпортер), пріоритет колонок original (укр. фолбек проєкту) -> english ->
// сирий ключ (лишається з '$' -- чесний маркер «не розв'язано», як показала б і гра).
export type ClassRow = [name: string, baseIdx: number, modIdx: number, root: Root, display: string]

interface RawClassIndex {
  v: number
  generated: string
  mods: string[]
  classes: ClassRow[]
}

export interface ClassIndex {
  v: number
  generated: string
  mods: string[]
  classes: ClassRow[]
  // Побудований один раз при завантаженні: ім'я.toLowerCase() -> індекс у classes.
  // Ключ НАВМИСНО lower-case (фікс-раунд 1, CRITICAL 1): сервер (ZP_ProcessingConfig.c:
  // 135-150 MatchClass) кейс-інсенситивний в ОБОХ гілках -- рушійний GetGame().IsKindOf
  // не розрізняє регістр classname, а "|1"-гілка явно робить .ToLower() з обох боків
  // перед порівнянням. Індекс, чутливий до регістру, розходився б із сервером: адмін міг
  // би написати "zp_microscope" (сервер прийняв би), а редактор показав би "клас не
  // знайдено". Рядки classes[] лишаються В ОРИГІНАЛЬНОМУ регістрі (це ім'я показується
  // користувачу) -- lower-case живе ЛИШЕ як ключ Map для пошуку.
  //
  // ОДНА ПЛОСКА мапа НА ВСІ П'ЯТЬ коренів, а не по мапі на корінь (знайдено при
  // регенерації під час W2 Task 4, фікс-раунд 1, Important 3, НЕ було в переліку рев'ю):
  // рушій дозволяє ОДНАКОВІЙ (регістронезалежно) назві існувати в ДВОХ РІЗНИХ коренях
  // одночасно -- це легальні окремі простори імен (CfgVehicles і cfgWeapons -- різні
  // ConfigIsExisting-шляхи). Серед 33336 класів згенерованого індексу є РІВНО ДВА такі
  // випадки ("Shotgun_Base": CfgAmmo+cfgWeapons; "DamageSystem": CfgVehicles+cfgWeapons,
  // classIndex.test.ts фіксує обидва явно). Для такого імені ця мапа може віддати лише
  // ОДНОГО "переможця" -- generate.py пише classes[] root-мажорно (усі root 0, потім усі
  // root 1, ... root 4 останній), а loadClassIndex просто йде масивом і `.set()`
  // перезаписує -- тому переможець ЗАВЖДИ найпізніший корінь у порядку 0..4 (на практиці
  // сьогодні -- завжди root 4/cfgWeapons, бо він останній). Це НЕ регресія фіксу: той
  // самий ризик існував і на трьох коренях, просто жодна пара імен там не збіглася
  // випадково. Функціонально не критично: сервер сам не дає точнішого інструменту для
  // "знайти клас САМЕ в цьому корені" (ClassExists перевіряє існування скрізь, не питаючи
  // про конкретний корінь), тож редактор не може бути точнішим за джерело істини, яке
  // мірить.
  byName: Map<string, number>
}

export interface ClassHit {
  name: string
  root: Root
  mod: string
  display: string
}

let cached: ClassIndex | undefined

// parseClassIndexJson — ЄДИНА точка побудови ClassIndex із сирого JSON: бандл (import),
// ClassIndex.json з відкритої теки/ZIP проєкту («папка > бандл») і результат браузерного
// імпортера T7. Приймає v1 (чотириелементні рядки — старий файл, який адмін міг покласти
// в теку до v2) і нормалізує до v2 (display=''); сміття відкидає з помилкою — тихе
// підсовування зіпсованого індексу означало б хибні «клас не знайдено» по всьому редактору
// без жодного сліду причини.
export function parseClassIndexJson(data: unknown): ClassIndex {
  if (typeof data !== 'object' || data === null) throw new Error('ClassIndex: не об\'єкт')
  const obj = data as Partial<RawClassIndex>
  if (typeof obj.v !== 'number' || !Array.isArray(obj.mods) || !Array.isArray(obj.classes)) {
    throw new Error('ClassIndex: відсутні обов\'язкові поля v/mods/classes')
  }
  const classes: ClassRow[] = []
  const byName = new Map<string, number>()
  for (let i = 0; i < obj.classes.length; i++) {
    const row = obj.classes[i] as unknown[]
    if (!Array.isArray(row) || typeof row[0] !== 'string' || typeof row[1] !== 'number' ||
        typeof row[2] !== 'number' || typeof row[3] !== 'number') {
      throw new Error(`ClassIndex: зіпсований рядок #${i}`)
    }
    const display = typeof row[4] === 'string' ? row[4] : '' // v1 -> нормалізація до v2
    classes.push([row[0], row[1], row[2], row[3] as Root, display])
    byName.set(row[0].toLowerCase(), i)
  }
  return {
    v: obj.v,
    generated: typeof obj.generated === 'string' ? obj.generated : '',
    mods: obj.mods,
    classes,
    byName,
  }
}

// loadClassIndex кешує результат у модульній змінній: індекс бандлиться раз при збірці
// (json import), і немає сенсу перебудовувати Map<name,index> (десятки тисяч записів) на
// кожен виклик searchClasses/isKindOf під час набору тексту в полі пошуку.
export function loadClassIndex(): ClassIndex {
  if (cached) return cached
  cached = parseClassIndexJson(raw)
  return cached
}

// Пріоритет «папка > бандл» (план W2, Interfaces T7): якщо у відкритій теці/ZIP проєкту
// лежить свіжий ClassIndex.json (або адмін щойно зібрав індекс вбудованим імпортером і
// натиснув «використати зараз»), він ПЕРЕКРИВАЄ вшитий бандл. Модульна змінна, а не
// React-стан: споживачі (isKindOf/searchClasses) — чисті функції поза React; оболонка
// після setActiveClassIndex сама тригерить ререндер (лічильник у стані App).
let activeOverride: ClassIndex | null = null

export function setActiveClassIndex(index: ClassIndex | null): void {
  activeOverride = index
}

export function activeClassIndex(): ClassIndex {
  return activeOverride ?? loadClassIndex()
}

// displayNameOf — ігрова назва класу для карток/вікон станків (W2.6). Порожнє власне
// display УСПАДКОВУЄТЬСЯ по ланцюгу baseIdx: рушій мерджить властивості конфігів по
// спадкуванню, тож клас без власного displayName= у грі показує ім'я найближчого предка,
// який його має. Фолбек — класснейм (збережений регістр для відомого класу, сирий рядок
// запиту для невідомого). Той самий захист від циклу, що в isKindOf.
export function displayNameOf(index: ClassIndex, cls: string): string {
  const start = index.byName.get(cls.toLowerCase())
  if (start === undefined) return cls
  const seen = new Set<number>()
  let cursor: number = start
  let depth = 0
  while (depth < MAX_CHAIN_DEPTH) {
    if (seen.has(cursor)) break
    seen.add(cursor)
    const row: ClassRow = index.classes[cursor]
    if (row[4] !== '') return row[4]
    if (row[1] < 0) break
    cursor = row[1]
    depth++
  }
  return index.classes[start][0]
}

// Захист від зіпсованого/рукописного індексу з циклом у baseIdx (генератор такого не
// створює -- дерево спадкування в конфігах ациклічне за визначенням, -- але isKindOf не
// повинен зациклитись, якщо хтось колись відредагує classindex.json руками).
const MAX_CHAIN_DEPTH = 64

// isKindOf: чи `cls` є класом `base`, чи успадковується від нього по ланцюгу baseIdx.
// Пайп-форма "X|N" -- ТОЧНИЙ збіг імені без проходу по спадкуванню; той самий синтаксис,
// що ZP_ProcessingRules.MatchClass на сервері (паритет навмисний, не збіг).
//
// ПАЙП-ФОРМА (W2 Task 4, рев'ю фікс-раунд 1, CRITICAL 1): сервер (ZP_ProcessingConfig.c:
// 139-148) шукає ПЕРШИЙ символ "|" де завгодно в рядку (`configured.IndexOf("|")`) і бере
// точну назву як усе ДО НЬОГО -- те, що йде ПІСЛЯ (сама цифра "1", "2", будь-що чи навіть
// нічого), рушій не читає взагалі, це просто конвенція позначки в конфігах адмінів
// ("|1" = перша й типова, але не єдина). До фіксу тут стояла перевірка рівно суфікса
// "|1" (`base.endsWith('|1')`) -- конфіг з "ZP_Sample|2" чи "ZP_Sample|" (порожньо після
// пайпа) успішно валидувався б і матчився б у грі, а дзеркало віддавало б false: не
// збігається жоден клас з буквальним ім'ям "ZP_Sample|2" (isKindOf пішов би в гілку
// спадкування замість точного збігу) -- редактор показав би відсутнє ребро/хибний розрив
// на конфігу, який насправді працює.
//
// КЕЙС-ІНСЕНСИТИВНІСТЬ (фікс-раунд 1, CRITICAL 1): сервер (та сама MatchClass) не
// розрізняє регістр НІДЕ -- ані в пайп-гілці (явний .ToLower() з обох боків перед
// порівнянням рядків), ані в звичайній гілці (GetGame().IsKindOf рушія теж
// кейс-інсенситивний). До фіксу `isKindOf('zp_microscope','ZP_StaticDevice_Base')`
// повертав false, хоча сервер прийняв би це правило -- редактор показував би "клас
// невідомий" на класнеймі, який чудово спрацював би в грі. Порівняння лишається
// case-insensitive НА КОЖНОМУ кроці ланцюга (не лише на старті): проміжний клас у
// ланцюгу baseIdx теоретично міг вийти в іншому регістрі з іншого PBO.
export function isKindOf(index: ClassIndex, cls: string, base: string): boolean {
  const pipeAt = base.indexOf('|')
  if (pipeAt > -1) {
    return cls.toLowerCase() === base.slice(0, pipeAt).toLowerCase()
  }
  const clsLower = cls.toLowerCase()
  const baseLower = base.toLowerCase()
  if (clsLower === baseLower) return true
  const start = index.byName.get(clsLower)
  if (start === undefined) return false
  const seen = new Set<number>()
  let depth = 0
  let cursor: number = start
  while (depth < MAX_CHAIN_DEPTH) {
    if (seen.has(cursor)) return false // цикл у baseIdx -- зіпсований індекс, не наша провина
    seen.add(cursor)
    const row: ClassRow = index.classes[cursor]
    const name: string = row[0]
    const parentIdx: number = row[1]
    if (name.toLowerCase() === baseLower) return true
    if (parentIdx < 0) return false
    cursor = parentIdx
    depth++
  }
  return false
}

// searchClasses: підрядок, кейс-інсенситив (уже було коректно до фікс-раунду 1 -- окремо
// перевірено при аудиті CRITICAL 1, тут не чіпалось), префіксні збіги йдуть ПЕРШИМИ (адмін
// частіше пам'ятає початок імені класу -- "ZP_Mic..." -- ніж середину чи кінець). Лімітуємо
// збір префіксних збігів достроково: якщо їх уже достатньо на заповнення `limit`, нефіксні
// все одно ніколи не потраплять у видиму частину результату.
// MINOR (ledger, фікс-раунд 1): гілка otherHits (нефіксні збіги) не має свого дострокового
// виходу -- на дуже частому підрядку (напр. одна літера) вона пройде весь масив класів
// (десятки тисяч рядків) перш ніж .slice(0, limit) обріже результат. При типовому
// адмінському запиті (кілька символів реального імені класу) це не помітно; вартувало б
// early-exit, якщо колись стане вузьким місцем UI (не зараз -- ціна складності вища).
// Індекс v2: третій ярус збігів — display-імена (вторинний пріоритет після класснеймів,
// директива власника: адмін шукає «яблуко» так само законно, як «Apple»). Порядок ярусів:
// префікс класснейму -> підрядок класснейму -> підрядок display. Клас, що збігся по
// класснейму, НЕ дублюється display-ярусом (один hit на клас). Display-збіг шукається по
// ВЛАСНОМУ полю рядка (без успадкування displayNameOf: прохід ланцюга на кожен із 33k
// рядків на кожне натискання клавіші — невиправдана ціна, а успадковане ім'я адмін бачить
// у випадному списку все одно через hit.display споживача).
export function searchClasses(index: ClassIndex, query: string, limit: number): ClassHit[] {
  const needle = query.toLowerCase()
  const prefixHits: ClassHit[] = []
  const otherHits: ClassHit[] = []
  const displayHits: ClassHit[] = []
  for (const row of index.classes) {
    const name = row[0]
    const low = name.toLowerCase()
    const pos = low.indexOf(needle)
    const hit = (): ClassHit => ({ name, root: row[3], mod: index.mods[row[2]], display: row[4] })
    if (pos === 0) {
      prefixHits.push(hit())
      if (prefixHits.length >= limit) break
      continue
    }
    if (pos > 0) {
      otherHits.push(hit())
      continue
    }
    if (row[4] !== '' && row[4].toLowerCase().includes(needle)) {
      displayHits.push(hit())
    }
  }
  return prefixHits.concat(otherHits, displayHits).slice(0, limit)
}

// classRoot: у якому з п'яти коренів визначений клас (undefined -- клас поза індексом,
// сервер такий рядок відхилить валідацією так само, як і редактор мав би). Кейс-
// інсенситивний з тієї ж причини, що isKindOf (фікс-раунд 1, CRITICAL 1).
export function classRoot(index: ClassIndex, cls: string): Root | undefined {
  const idx = index.byName.get(cls.toLowerCase())
  return idx === undefined ? undefined : index.classes[idx][3]
}

// Дзеркало ZP_ProcessingConfig.c:376-384 StripExact: суфікс "|N" (позначка "точний клас
// без спадкування" для MatchClass/isKindOf вище) треба зрізати ПЕРЕД будь-якою перевіркою
// існування/спадкування в індексі -- інакше пошук шукав би буквальний клас з ім'ям
// "ZP_Sample|1", якого в жодному PBO немає. Сервер викликає StripExact у КОЖНОМУ місці,
// де класнейм іде в ConfigIsExisting/ClassExists (ValidateRule, реєстр модулів) -- W2
// Task 6 (RulePanel/ruleValidation/sampleContent) потребує того самого перед classRoot/
// isKindOf, тому хелпер живе тут поруч із рештою дзеркал цього самого .c-файлу, а не
// дублюється в кожному споживачі.
export function stripExact(configured: string): string {
  const sep = configured.indexOf('|')
  return sep > -1 ? configured.slice(0, sep) : configured
}
