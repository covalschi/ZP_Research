// Дзеркала серверних валідацій PointTypes/Factions/Modules/Settings (W4 Task 1). ЧИСТИЙ
// модуль без UI-імпортів: споживачі — вкладки W4 (банери/поля) і гейт експорту в
// io/project.ts. Кожна перевірка процитована з .c-джерела (нічого не вгадано).
//
// ТРИ РІЗНІ СТРОГОСТІ СЕРВЕРА -> ТРИ РІЗНІ ДЗЕРКАЛА (self-review плану W4: «не під одну
// гребінку»):
//
// 1) PointTypes — ГЕЙТ ЦІЛОГО ФАЙЛУ. ZP_PointTypesConfig.Validate (:294-315) збирає
//    problems (порожній Id, дубль Id ТОЧНИМ ==, порожній Name, Tier поза [0..10]) і
//    повертає false; TryLoadPointTypes (ZP_ConfigService.c:177-182) на цьому робить
//    `return false` — ланцюжок відмови. Наслідки (обидва прочитані, не переказані):
//      - РЕСТАРТ: ServerLoad (:101-102) лише логує Err і йде далі — m_PointTypes лишається
//        ПОРОЖНІМ конструкторським (:30), бо файл існує і SetDefaults не викликається.
//        Каскад: КОЖЕН вузол дерева з непорожнім Cost відкидається («невідомий тип балів у
//        Cost», ZP_TechTree.c:169-170 проти порожнього реєстру), нагороди заготовок стають
//        soft-невідомими (ZP_DataItemsConfig.c:97-98) і не нараховуються.
//      - ЖИВИЙ `!zp reload` (OpReloadAll :1489-1506): атомарна відмова ЦІЛКОМ — жоден із
//        восьми конфігів не перечитується, поки PointTypes.json битий.
//    Дзеркало: severity 'alarm' + PROJECT-WIDE гейт (pointTypesGateAlarms нижче, його
//    споживають canSave/canExport в io/project.ts — див. рішення в шапці функції).
//
// 2) Modules — РУЙНІВНИЙ Validate (:104-147): невалідний запис RemoveOrdered-ВИКИДАЄТЬСЯ,
//    а LoadModules (:337-338) одразу SaveModules — файл на диску ПЕРЕЗАПИСУЄТЬСЯ вже без
//    запису. Формулювання дзеркала: «сервер ВИКИНЕ цей запис при завантаженні» (НЕ
//    «відхилить файл»). Severity 'alarm' на записі, БЕЗ project-wide гейту (решта файлу
//    живе).
//
// 3) Factions і Settings — WARN-ONLY. TryLoadFactions (:218-224) викликає Validate і
//    ІГНОРУЄ результат («Невдала валідація НЕ фатальна: краще працювати з рештою
//    фракцій»); ZP_SettingsConfig.Validate (:63-67) чистить problems і завжди повертає
//    true. Дзеркало: severity 'warn' для КОЖНОЇ перевірки.
//    РОЗБІЖНІСТЬ ІЗ БРИФОМ (задокументована свідомо): бриф називав whole-file перевірку
//    класу нашивки «жорсткою відмовою всього файлу» — за .c це НЕ так: Validate лише додає
//    рядок у problems (:262-268), а файл однаково завантажується. Тому примітка в
//    повідомленні нижче описує РЕАЛЬНИЙ наслідок (запис у server-лог WARNING), а не
//    вигадану відмову.
//
// «Клас поза індексом» — ЗАВЖДИ 'warn', ніколи 'alarm' (прецедент validateClassField,
// ruleValidation.ts: офлайн-індекс редактора ≠ живий сервер — класи чужих модів можуть
// бути відсутні на машині розробки), навіть там, де сервер за справжньої відсутності
// класу вчинив би жорсткіше; повідомлення тоді ЯВНО каже, що саме зробить сервер.

import type { Project } from '../io/project'
import type { FieldError } from './ruleValidation'
import type { ClassIndex } from './classIndex'
import { classRoot, stripExact } from './classIndex'

export type { FieldError } from './ruleValidation'

type Rec = Record<string, unknown>

function recOf(v: unknown): Rec | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function num(v: unknown): number {
  return typeof v === 'number' ? v : 0
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

// Дзеркало ZP_Uid.IsPathSafe (ZP_Constants.c:109-112): непорожній, без '\', '/', ':', '..'.
function isPathSafeId(s: string): boolean {
  return s !== '' && !s.includes('\\') && !s.includes('/') && !s.includes(':') && !s.includes('..')
}

// Дзеркало ZP_Uid.IsSteam64 (ZP_Constants.c:95-106): рівно 17 символів, усі — цифри.
function isSteam64(s: string): boolean {
  if (s.length !== 17) return false
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 48 || c > 57) return false
  }
  return true
}

function inIndex(index: ClassIndex, cls: string): boolean {
  return classRoot(index, stripExact(cls)) !== undefined
}

// ============================ PointTypes ====================================================

// Наслідок будь-якої alarm-проблеми — спільний хвіст повідомлення (одна формулювання, а не
// чотири різні, щоб банер Task 2 міг показати його один раз).
const POINTTYPES_CONSEQUENCE =
  'на рестарті сервер НЕ завантажить PointTypes.json (реєстр типів балів лишиться порожнім, вузли дерева з Cost буде пропущено), а живий !zp reload відмовить ЦІЛКОМ для всіх конфігів (TryLoadPointTypes, ZP_ConfigService.c:177-182; OpReloadAll :1489-1506)'

// Дзеркало whole-file Validate (ZP_PointTypesConfig.c:294-315) + warn-добавки редактора:
// SeedDimensions-підміна (:260-292) і розсинхрон запис<->вісь (сервер тут НЕ лається —
// DimensionName повертає сирий Id, DimensionOrder ставить 9999 у кінець, :237-255; але
// після перейменування осі це саме та неузгодженість, яку адмін мусить побачити).
export function validatePointTypesDoc(doc: unknown): FieldError[] {
  const out: FieldError[] = []
  const d = recOf(doc)
  if (!d) return out
  const types = Array.isArray(d.PointTypes) ? d.PointTypes : []
  const categories = Array.isArray(d.Categories) ? d.Categories : []
  const kinds = Array.isArray(d.Kinds) ? d.Kinds : []

  // ---- alarm-дзеркало Validate :298-313 (дубль — ТОЧНИМ ==, як seen.Find(pt.Id)) ----
  const seen = new Set<string>()
  types.forEach((raw, i) => {
    const pt = recOf(raw)
    const id = pt ? str(pt.Id) : ''
    if (!pt || id === '') {
      out.push({ path: `PointTypes[${i}].Id`, severity: 'alarm', message: `тип балів з порожнім Id (Validate :301-304): ${POINTTYPES_CONSEQUENCE}` })
      return
    }
    if (seen.has(id)) {
      out.push({ path: `PointTypes[${i}].Id`, severity: 'alarm', message: `дублікат Id '${id}' (Validate :306-307, точний ==): ${POINTTYPES_CONSEQUENCE}` })
    }
    seen.add(id)
    if (str(pt.Name) === '') {
      out.push({ path: `PointTypes[${i}].Name`, severity: 'alarm', message: `тип '${id}' без поля Name (Validate :309-310): ${POINTTYPES_CONSEQUENCE}` })
    }
    const tier = num(pt.Tier)
    if (tier < 0 || tier > 10) {
      out.push({ path: `PointTypes[${i}].Tier`, severity: 'alarm', message: `тип '${id}': Tier поза межами [0..10] (Validate :311-312): ${POINTTYPES_CONSEQUENCE}` })
    }
  })

  // ---- warn: SeedDimensions-підміна (:260-292) — порожня вісь при записах, які її
  // заповнять: рушій на найближчому завантаженні сам згенерує вісь (Name = сирий Id) і
  // load-then-save перезапише файл уже з нею.
  const anyCategory = types.some((raw) => {
    const pt = recOf(raw)
    return !!pt && str(pt.Category) !== ''
  })
  const anyKind = types.some((raw) => {
    const pt = recOf(raw)
    return !!pt && str(pt.Kind) !== ''
  })
  if (categories.length === 0 && anyCategory) {
    out.push({ path: 'Categories', severity: 'warn', message: 'вісь Categories порожня — рушій сам заповнить її з записів (Name = сирий Id) і перезапише файл (SeedDimensions, ZP_PointTypesConfig.c:262-276)' })
  }
  if (kinds.length === 0 && anyKind) {
    out.push({ path: 'Kinds', severity: 'warn', message: 'вісь Kinds порожня — рушій сам заповнить її з записів (Name = сирий Id) і перезапише файл (SeedDimensions, ZP_PointTypesConfig.c:277-291)' })
  }

  // ---- warn: розсинхрон запис<->вісь (лише коли вісь НЕПОРОЖНЯ — порожню покриває warn
  // вище). Збіг точний ==, як DimensionOrder (:247-255).
  const catIds = new Set(categories.map((c) => str(recOf(c)?.Id)).filter((x) => x !== ''))
  const kindIds = new Set(kinds.map((k) => str(recOf(k)?.Id)).filter((x) => x !== ''))
  types.forEach((raw, i) => {
    const pt = recOf(raw)
    if (!pt) return
    const cat = str(pt.Category)
    if (categories.length > 0 && cat !== '' && !catIds.has(cat)) {
      out.push({ path: `PointTypes[${i}].Category`, severity: 'warn', message: `категорії '${cat}' немає в осі Categories — у грі покажеться сирий Id, а блок стане в кінець (DimensionName/DimensionOrder, ZP_PointTypesConfig.c:237-255); після перейменування осі записи треба перевести руками` } )
    }
    const kind = str(pt.Kind)
    if (kinds.length > 0 && kind !== '' && !kindIds.has(kind)) {
      out.push({ path: `PointTypes[${i}].Kind`, severity: 'warn', message: `виду '${kind}' немає в осі Kinds — у грі покажеться сирий Id, а блок стане в кінець (DimensionName/DimensionOrder, ZP_PointTypesConfig.c:237-255); після перейменування осі записи треба перевести руками` })
    }
  })

  return out
}

// ---- PROJECT-WIDE ГЕЙТ (рішення W4 Task 1, інтеграція з гейтом W2.7) -----------------------
//
// РІШЕННЯ: окремий ДИНАМІЧНИЙ механізм, НЕ синтетичний alarm-warning у file.warnings.
// Обґрунтування (чому не варіант «дописати Warning файлу», який пропонував бриф):
//   1. file.warnings — статичний знімок ПАРСЕРА на момент завантаження байтів; дублі Id
//      виникають і зникають від МУТАЦІЙ parsed (правки в UI), яких warnings не бачить.
//      Синтетичний запис довелося б пересчитувати в КОЖНОМУ мутаторі кожного конфігу —
//      наскрізна залежність, яку жоден наявний мутатор не має.
//   2. Кнопка «Полагодити» (repairFile, io/project.ts) знімає alarm-warnings і ставить
//      dirty — для wrong-type це чесний ремонт (канонізація виправляє типи), а дубль Id
//      канонізація НЕ виправляє: «Полагодити» зняв би alarm, розблокував експорт і
//      РОЗПОВСЮДИВ файл, який кладе сервер, — пряме порушення власницького «блок завжди
//      йде разом із ремонтом».
//   3. Динамічна перевірка parsed самоусувається: щойно адмін прибрав дубль у вкладці
//      (Task 2) — гейт відкривається без жодного синку станів.
// Ціна рішення: io/project.ts (canSave/canExport) тепер робить runtime-імпорт цього
// модуля (module -> io залишається type-only, циклу немає), і до появи банера Task 2
// заблоковані кнопки не мають пояснення в UI — прийнято свідомо (вікно живе лише всередині
// гілки W4; НЕбезпечна альтернатива — експорт битого файлу — гірша за німу кнопку).
//
// У гейт ідуть ЛИШЕ alarm-проблеми (дзеркало серверного «файл не завантажиться»); warn-
// добавки редактора (SeedDimensions, розсинхрон осей) експорт НЕ блокують.

export interface ProjectAlarm {
  file: string
  problem: FieldError
}

export function pointTypesGateAlarms(project: Project): ProjectAlarm[] {
  const out: ProjectAlarm[] = []
  for (const f of project.files) {
    if (f.kind !== 'pointTypes') continue
    for (const problem of validatePointTypesDoc(f.parsed)) {
      if (problem.severity === 'alarm') out.push({ file: f.path, problem })
    }
  }
  return out
}

// ============================ Factions ======================================================

// Примітка до «класу нашивки немає в індексі» — спільна для обох дзеркал.
const ARMBAND_INDEX_NOTE =
  'класу немає в індексі редактора (мод міг бути відсутній на цій машині); якщо класу справді немає В ГРІ, сервер запише це у problems при завантаженні (Validate, ZP_FactionsConfig.c:262-268) і у softWarn операцій редагування (:204-210), але файл однаково завантажить (TryLoadFactions, ZP_ConfigService.c:218-224)'

// Per-record дзеркало ValidateFaction (ZP_FactionsConfig.c:183-212) — ЖОРСТКІ причини
// відмови операцій OpUpsertFaction -> 'alarm' (це рівень ПАНЕЛІ фракції, НЕ гейт експорту —
// та сама роль, що alarm-и validateRule в панелі правила), softWarn -> 'warn'.
// Порядок і рання зупинка — ті самі, що на сервері: перша жорстка причина завершує
// перевірку (сервер повертає один рядок, не список). Supertype тут НЕ перевіряється —
// його немає у ValidateFaction (лише у whole-file Validate :247-248), дзеркалимо точно.
export function validateFactionRecord(faction: unknown, allFactions: unknown[], index: ClassIndex): FieldError[] {
  const f = recOf(faction)
  if (!f || str(f.Id) === '') {
    return [{ path: 'Id', severity: 'alarm', message: 'немає Id (ValidateFaction, ZP_FactionsConfig.c:186-187)' }]
  }
  const id = str(f.Id)
  if (!isPathSafeId(id)) {
    return [{ path: 'Id', severity: 'alarm', message: `Id '${id}' небезпечний для імені файлу (ValidateFaction :188-189, дзеркало ZP_Uid.IsPathSafe)` }]
  }
  if (str(f.DisplayName) === '') {
    return [{ path: 'DisplayName', severity: 'alarm', message: 'немає DisplayName (ValidateFaction :190-191)' }]
  }
  const armbands = strArr(f.Armbands)
  if (armbands.length === 0) {
    return [{ path: 'Armbands', severity: 'alarm', message: 'жодної нашивки — фракцію не буде чим визначити (ValidateFaction :192-193)' }]
  }
  for (const other of allFactions) {
    const o = recOf(other)
    if (!o || str(o.Id) === id) continue // себе пропускаємо за Id — як `other.Id == f.Id` (:196-197)
    const theirs = strArr(o.Armbands)
    for (let i = 0; i < armbands.length; i++) {
      if (theirs.includes(armbands[i])) {
        return [{ path: `Armbands[${i}]`, severity: 'alarm', message: `нашивка '${armbands[i]}' уже належить фракції '${str(o.Id)}' (ValidateFaction :194-203, дослівний Find); до виправлення гравця з нею отримує та фракція, що стоїть РАНІШЕ у файлі (FindByArmband :67-82 — перший збіг, детерміновано)` }]
      }
    }
  }
  const out: FieldError[] = []
  for (let i = 0; i < armbands.length; i++) {
    if (armbands[i] === '') {
      return [{ path: `Armbands[${i}]`, severity: 'alarm', message: 'порожній клас нашивки (ValidateFaction :206-207)' }]
    }
    if (!inIndex(index, armbands[i])) {
      out.push({ path: `Armbands[${i}]`, severity: 'warn', message: `'${armbands[i]}': ${ARMBAND_INDEX_NOTE}` })
    }
  }
  return out
}

// Whole-file дзеркало Validate (ZP_FactionsConfig.c:227-282) + WarnSharedTerminals/Devices
// (:118-168). ВСЕ — 'warn': TryLoadFactions (:218-224) ігнорує результат Validate, файл
// завантажується ЗАВЖДИ (розбіжність із формулюванням брифа — див. шапку модуля).
export function validateFactionsDoc(doc: unknown, index: ClassIndex): FieldError[] {
  const out: FieldError[] = []
  const d = recOf(doc)
  if (!d) return out
  const factions = Array.isArray(d.Factions) ? d.Factions : []

  const seenIds = new Set<string>()
  const seenArmbands = new Set<string>()
  factions.forEach((raw, i) => {
    const f = recOf(raw)
    const id = f ? str(f.Id) : ''
    if (!f || id === '') {
      out.push({ path: `Factions[${i}].Id`, severity: 'warn', message: 'фракція з порожнім Id (Validate :234-237)' })
      return
    }
    if (!isPathSafeId(id)) {
      out.push({ path: `Factions[${i}].Id`, severity: 'warn', message: `Id '${id}' небезпечний для імені файлу (Validate :239-241)` })
    }
    if (seenIds.has(id)) {
      out.push({ path: `Factions[${i}].Id`, severity: 'warn', message: `дублікат Id '${id}' (Validate :242-243, точний ==; Find бере перший — близнюк недосяжний)` })
    }
    seenIds.add(id)
    if (str(f.DisplayName) === '') {
      out.push({ path: `Factions[${i}].DisplayName`, severity: 'warn', message: `фракція '${id}' без DisplayName (Validate :245-246)` })
    }
    if (str(f.Supertype) === '') {
      out.push({ path: `Factions[${i}].Supertype`, severity: 'warn', message: `фракція '${id}' без Supertype (Validate :247-248)` })
    }
    const armbands = strArr(f.Armbands)
    if (armbands.length === 0) {
      out.push({ path: `Factions[${i}].Armbands`, severity: 'warn', message: `фракція '${id}' без нашивок — визначити її буде нічим (Validate :249-250)` })
    }
    armbands.forEach((a, ai) => {
      if (a === '') {
        out.push({ path: `Factions[${i}].Armbands[${ai}]`, severity: 'warn', message: `фракція '${id}': порожній клас нашивки (Validate :253-257)` })
        return
      }
      if (seenArmbands.has(a)) {
        out.push({ path: `Factions[${i}].Armbands[${ai}]`, severity: 'warn', message: `нашивка '${a}' належить більш ніж одній фракції (Validate :258-261, дослівний Find); резолв ДЕТЕРМІНОВАНИЙ: гравця отримує фракція, що стоїть раніше у файлі (FindByArmband :67-82 — перший збіг)` })
      }
      seenArmbands.add(a)
      if (!inIndex(index, a)) {
        out.push({ path: `Factions[${i}].Armbands[${ai}]`, severity: 'warn', message: `фракція '${id}': '${a}' — ${ARMBAND_INDEX_NOTE}` })
      }
    })
  })
  if (factions.length === 0) {
    out.push({ path: 'Factions', severity: 'warn', message: 'жодної фракції — усі гравці будуть у DefaultFaction (Validate :271-272)' })
  }

  // WarnShared* — лише коли ХТОСЬ оголосив свої (гейт Validate :277-280): доки поділу
  // нема, спільний доступ через Settings — штатний режим, а не конфлікт.
  const recs = factions.map((raw) => recOf(raw)).filter((f): f is Rec => !!f)
  const anyTerminals = recs.some((f) => strArr(f.TerminalClasses).length > 0)
  if (anyTerminals) {
    for (let i = 0; i < recs.length; i++) {
      for (let j = i + 1; j < recs.length; j++) {
        for (const t of strArr(recs[i].TerminalClasses)) {
          if (strArr(recs[j].TerminalClasses).includes(t)) {
            out.push({ path: `Factions[${i}].TerminalClasses`, severity: 'warn', message: `термінал '${t}' оголошено і в '${str(recs[i].Id)}', і в '${str(recs[j].Id)}' — вони бачитимуть дерева одне одного (WarnSharedTerminals, ZP_FactionsConfig.c:130-133)` })
          }
        }
      }
    }
    recs.forEach((f, i) => {
      if (strArr(f.TerminalClasses).length === 0) {
        out.push({ path: `Factions[${i}].TerminalClasses`, severity: 'warn', message: `фракція '${str(f.Id)}' не має власних терміналів — її гравці не відкриють дерево жодним приладом (WarnSharedTerminals :137-141)` })
      }
    })
  }
  const anyDevices = recs.some((f) => strArr(f.DeviceClasses).length > 0)
  if (anyDevices) {
    for (let i = 0; i < recs.length; i++) {
      for (let j = i + 1; j < recs.length; j++) {
        for (const dc of strArr(recs[i].DeviceClasses)) {
          if (strArr(recs[j].DeviceClasses).includes(dc)) {
            out.push({ path: `Factions[${i}].DeviceClasses`, severity: 'warn', message: `прилад '${dc}' оголошено і в '${str(recs[i].Id)}', і в '${str(recs[j].Id)}' — вони користуватимуться ним спільно (WarnSharedDevices :157-161)` })
          }
        }
      }
    }
    recs.forEach((f, i) => {
      if (strArr(f.DeviceClasses).length === 0) {
        out.push({ path: `Factions[${i}].DeviceClasses`, severity: 'warn', message: `фракція '${str(f.Id)}' не має власних приладів — її гравці не скористаються жодною станцією (WarnSharedDevices :164-168)` })
      }
    })
  }

  return out
}

// ============================ Modules =======================================================

// Дзеркало РУЙНІВНОЇ Validate (ZP_ModulesConfig.c:104-147): цикл ІЗ КІНЦЯ, невалідний
// запис RemoveOrdered-вирізається (і файл перезаписується без нього — LoadModules,
// ZP_ConfigService.c:337-338 SaveModules одразу після коміту). Дубль класу ріже РАННІЙ
// запис (last-wins: реверсний цикл кладе в seen останній запис першим — та сама семантика,
// що в DataItems). Пізній близнюк, якого сервер сам виріже раніше (битий бонус/порожній
// клас), у seen НЕ потрапляє — ранній тоді виживає; дзеркалимо ту саму взаємодію.
//
// «Клас поза індексом» — 'warn' (офлайн-індекс може бути неповним), хоча за СПРАВЖНЬОЇ
// відсутності класу в грі сервер запис виріже (:117-121); для last-wins-обліку такий запис
// вважається ВЦІЛІЛИМ (оптимістично: якщо клас насправді є, він і забирає слот) —
// протилежне припущення ховало б dup-alarm на ранньому записі рівно тоді, коли він
// найімовірніше справжній.
export function validateModulesDoc(doc: unknown, index: ClassIndex): FieldError[] {
  const out: FieldError[] = []
  const d = recOf(doc)
  if (!d) return out
  const modules = Array.isArray(d.Modules) ? d.Modules : []

  const CUT = 'сервер ВИКИНЕ цей запис при завантаженні й перезапише Modules.json без нього'
  const seen = new Set<string>()
  for (let i = modules.length - 1; i >= 0; i--) {
    const m = recOf(modules[i])
    const cls = m ? str(m.Classname) : ''
    if (!m || cls === '') {
      out.push({ path: `Modules[${i}].Classname`, severity: 'alarm', message: `модуль без Classname — ${CUT} (Validate, ZP_ModulesConfig.c:111-115)` })
      continue
    }
    if (!inIndex(index, cls)) {
      out.push({ path: `Modules[${i}].Classname`, severity: 'warn', message: `класу '${cls}' немає в індексі редактора (мод міг бути відсутній на цій машині); якщо його справді немає В ГРІ — ${CUT} (Validate :117-121)` })
      // вважаємо вцілілим для last-wins-обліку — див. шапку функції
    }
    const bonus = num(m.PurityBonus)
    if (bonus < 0 || bonus > 2) {
      out.push({ path: `Modules[${i}].PurityBonus`, severity: 'alarm', message: `PurityBonus '${bonus}' поза межами [0..2] — ${CUT} (Validate :123-129)` })
      continue
    }
    strArr(m.Devices).forEach((dv, di) => {
      if (dv === '') {
        out.push({ path: `Modules[${i}].Devices[${di}]`, severity: 'warn', message: `порожній клас приладу в модулі '${cls}' — сервер лише запише попередження, запис ЛИШАЄТЬСЯ (Validate :131-135)` })
      } else if (!inIndex(index, dv)) {
        out.push({ path: `Modules[${i}].Devices[${di}]`, severity: 'warn', message: `класу приладу '${dv}' немає в індексі редактора; на сервері за справжньої відсутності — лише попередження, запис ЛИШАЄТЬСЯ (Validate :131-135)` })
      }
    })
    if (seen.has(cls)) {
      out.push({ path: `Modules[${i}].Classname`, severity: 'alarm', message: `дубль класу '${cls}' — ${CUT}: виживає ОСТАННІЙ запис (реверсний цикл Validate :108,136-141)` })
      continue
    }
    seen.add(cls)
  }

  // Проблеми зібрані реверсним циклом — віддаємо у порядку файлу (читабельність панелі).
  return out.reverse()
}

// ============================ Settings ======================================================

// Warn-only дзеркало ZP_SettingsConfig.Validate (:42-68): сервер збирає problems, пише
// ZP_Log.Warn і ЗАВЖДИ повертає true (`problems = ""; return true;` :66-67) — файл
// застосовується як є. Жодна перевірка тут не може бути 'alarm'.
export function validateSettingsDoc(doc: unknown): FieldError[] {
  const out: FieldError[] = []
  const d = recOf(doc)
  if (!d) return out

  strArr(d.AdminIds).forEach((id, i) => {
    if (!isSteam64(id)) {
      out.push({ path: `AdminIds[${i}]`, severity: 'warn', message: `AdminIds[${i}] не схожий на Steam64: '${id}' (Validate, ZP_SettingsConfig.c:45-50 — 17 цифр, дзеркало ZP_Uid.IsSteam64)` })
    }
  })
  const df = str(d.DefaultFaction)
  if (df === '' || !isPathSafeId(df)) {
    out.push({ path: 'DefaultFaction', severity: 'warn', message: `DefaultFaction небезпечний для імені файлу — у рантаймі буде замінений на 'default' (Validate :51-52)` })
  }
  const terminals = strArr(d.TreeTerminalClasses)
  terminals.forEach((cls, i) => {
    if (cls === '') {
      out.push({ path: `TreeTerminalClasses[${i}]`, severity: 'warn', message: `TreeTerminalClasses[${i}] порожній (Validate :53-57)` })
    }
  })
  const depth = num(d.TreeVisibilityDepth)
  if (depth < 0 || depth > 10) {
    out.push({ path: 'TreeVisibilityDepth', severity: 'warn', message: 'TreeVisibilityDepth поза межами [0..10] (Validate :59-60)' })
  }
  if (terminals.length === 0) {
    out.push({ path: 'TreeTerminalClasses', severity: 'warn', message: 'TreeTerminalClasses порожній — дерево досліджень не відкриється жодним приладом (Validate :61-62; діє, ПОКИ жодна фракція не оголосила власних терміналів)' })
  }

  return out
}
