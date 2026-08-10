// Модель станків "очима адміна" (W2.6 Task 1) — ЧИСТА логіка, без React/DOM (жодного
// імпорту з ui/*): станок = фізичний клас приладу (Device правила АБО DeviceClasses
// фракції), а не окреме правило. Прив'язка правило -> станок уже неявно існує в
// ProcessingRules (поле Device), тут вона стає ЯВНОЮ і збагаченою ігровими іменами/
// статусом настроєності/куди йде результат — саме те, що потребують вікна станків (T3) і
// двудольне полотно "предмет -> станок -> предмет" (T2).
//
// Побудовано ПОВЕРХ buildChainGraph (chainGraph.ts, W2 Task 4) як єдиного джерела
// "які правила є, у якому порядку, чи увімкнені" — а не другий незалежний обхід
// project.files. graph.nodes уже несе { ruleId, filePath, rule (сирий об'єкт, не копія --
// asRuleLike повертає ТОЙ САМИЙ об'єкт із іншим типом), disabled } у ТОМУ САМОМУ порядку
// (файл-пріоритет через project.files, потім порядок у файлі), що graph.edges/breaks --
// повторний виклик buildChainGraph тут ДЕШЕВИЙ (правил у проєкті — десятки, не тисячі) і
// гарантує, що "порядок рядків станка" НІКОЛИ не розійдеться з порядком, який уже бачить
// адмін на полотні ланцюга.
//
// Матчинг "вихід одного правила задовольняє вхід іншого" — РІВНО matchInputMirror
// (chainGraph.ts, дзеркало ZP_ProcessingRules.MatchInput) без жодної другої копії: друга
// копія тут була б саме тим дрейфом двох копій, якого весь цей кодекс свідомо уникає
// (той самий принцип, що вже написаний над matchClassMirror і MULTI_FILE_DIRS).
//
// Резолв ігрового імені (SampleTypes.json/DataItems.json/звичайний ClassIndex.displayName)
// — model/faceResolve.ts (винесено з ui/ChainView.tsx САМЕ ЦИМ таском, дивись коментар на
// початку faceResolve.ts): жодного імпорту UI-модуля в модельний файл.

import type { Project } from '../io/project'
import type { ClassIndex } from './classIndex'
import { displayNameOf, isKindOf, stripExact } from './classIndex'
import { isSampleClass } from './sampleContent'
import { buildChainGraph, matchInputMirror, asRuleLike } from './chainGraph'
import type { RuleLike } from './chainGraph'
import { resolveDataItemFace, resolveSampleTypeFace } from './faceResolve'
import type { FieldError, RuleValidationInput } from './ruleValidation'
import { validateRule } from './ruleValidation'

// ---- Публічна модель -----------------------------------------------------------------------

export interface StationRoles {
  // packer (пакувальник): є ХОЧА Б ОДНЕ правило цього станка (увімкнене чи вимкнене --
  // роль показує СТРУКТУРНУ спроможність, "чи вміє цей станок пакувати", а не "чи працює
  // прямо зараз"; producedStreams нижче -- окрема, СТРОГІША вибірка САМЕ живих потоків),
  // чиї Outputs містять клас родини ZP_Sample_Base.
  packer: boolean
  // analyzer (аналізатор): є ХОЧА Б ОДНЕ правило цього станка, чий InputItem.Classname --
  // клас родини ZP_Sample_Base. Станок може бути ОБОМА одночасно (пакує один зразок і тут
  // же аналізує інший); станок, що не є жодним з двох -- звичайний переробник (обидва
  // прапорці false, T3 однаково показує його рядки входів).
  analyzer: boolean
}

// Вихід ОДНОГО правила зі станка -- ігрове ім'я + чи це зразок (для polотна T2/призначення
// "куди йде" T3). isDataItem НЕ виноситься окремим прапорцем (брифом не потрібен для T1) --
// але резолв display усередині ВРАХОВУЄ родину ZP_Data_Base так само, як ChainView.tsx
// (ItemCardNode, W2.6 Task 2) -- інакше заготовка результату показувала б сирий класнейм
// замість імені з DataItems.json на вікні станка.
export interface StationOutputFace {
  classname: string
  display: string
  isSample: boolean
  content: string
}

export interface StationDestination {
  stationClassname: string
  display: string
}

// Один рядок = ОДНЕ правило станка (input-у сенсі "чим годуємо станок", не "вхідний файл").
// filePath+ruleId -- складений ключ ідентичності рядка (дзеркало ChainNode/ChainSelection,
// chainGraph.ts/ChainView.tsx): дублікат Id (п.6 брифа) НЕ колапсується в один рядок --
// кожне правило зі свого (filePath, у файлі -- порядковий) місця отримує ВЛАСНИЙ рядок,
// duplicate лише позначає факт колізії Id, не ховає жоден з рядків.
export interface StationInputRow {
  filePath: string
  ruleId: string
  // Правило вимкнене (Enabled=false) -- рядок ІСНУЄ (адмін бачить структуру станка), але
  // participates=false у destinations/producedStreams нижче (дзеркало chainGraph: вимкнене
  // правило виключене з матчингу як консумер І як джерело "куди йде"/"що виробляється").
  disabled: boolean
  // Той самий Id (рядковий, регістрочутливо -- дзеркало chainGraph.assignNodeKeys) стрічається
  // ще десь у проєкті (в ЦЬОМУ ж чи іншому файлі, на ЦЬОМУ ж чи іншому станку) -- сервер
  // такий конфіг не гарантовано коректно обробить, T3 має показати попередження на рядку.
  duplicate: boolean
  // Сирі значення InputItem, БЕЗ стрипу "|N" -- рівно те, що лежить у файлі (форма правки
  // T3, коли адмін розгортає рядок, читає/пише САМЕ ці поля).
  rawClassname: string
  rawContent: string
  // Ігрове ім'я rawClassname (SampleTypes.json/DataItems.json/ClassIndex.displayName --
  // resolveStationItemDisplay нижче), fallback -- сам класнейм. Порожній rawClassname дає
  // порожній rawDisplay (немає що резолвити).
  rawDisplay: string
  // Семантично повне (непорожній InputItem.Classname І хоча б один непорожній Outputs[].
  // Classname) І validateRule (ruleValidation.ts, сім дзеркальних правил) не дає жодної
  // alarm-помилки. Step 1 T3 (звірено по джерелу, УТОЧНЕННЯ колишнього припущення тут):
  // порожній InputItem.Classname сервер СПРАВДІ пропускає пер-правилово з warn
  // (ZP_ProcessingConfig.c:249-254, :295-296 -- файл живе), але порожні Outputs він НЕ
  // відхиляє ВЗАГАЛІ (ValidateRule не перевіряє Outputs.Count(); FindStartableCore теж) --
  // увімкнене правило без виходів з'їдало б сировину, не даючи нічого. Тому "не
  // налаштовано" тут -- попередження адміну (зберегти можна), а ЗАГОТОВКИ редактор пише
  // з Enabled=false (io/stationEdit.ts, семантика Step 1) -- інертність гарантує сам
  // рушій (ZP_Processing.c:127-128), а не сподівання на скіп валідатора.
  configured: boolean
  // УСІ причини (укр.): спершу семантична неповнота ("вхід не задано"/"вихід не задано"),
  // потім КОЖНЕ повідомлення validateRule (і alarm, і warn -- варте показати навіть коли
  // сам рядок вже configured, напр. "клас відсутній в індексі"). Порожній масив = рядок
  // повністю чистий. `configured` НЕ дорівнює `problems.length === 0` -- warn-повідомлення
  // потрапляють у problems, але не блокують configured (дивись формулу вище).
  problems: string[]
  outputs: StationOutputFace[]
  // "Куди йде" -- об'єднання по УСІХ outputs цього рядка станків, що мають хоча б одне
  // УВІМКНЕНЕ правило, чий InputItem матчить цей вихід (matchInputMirror). НАВМИСНО лише
  // InputItem, без Consumables (п.4 брифа -- бінарна відмінність від chainGraph.requirementsOf,
  // яка бере й Consumables теж): "куди йде результат" -- це основний шлях предмета далі
  // цепочкою, а не "хто теоретично міг би з'їсти це як побічний реагент". Self-loop (станок
  // сам собі призначення через ІНШЕ своє правило) НЕ виключається -- так само, як chainGraph
  // не спецкейсить self-loop у своїх edges.
  destinations: StationDestination[]
}

export interface StationInfo {
  // Канонічний класнейм (стрип "|N", ПЕРШИЙ побачений регістр -- п.1 брифа).
  classname: string
  display: string
  roles: StationRoles
  // Порядок = порядок графа (файл-пріоритет, потім порядок у файлі) -- той самий, що
  // chainGraph/ChainView вже встановили для полотна ланцюга.
  inputRows: StationInputRow[]
}

// Потік, що ФАКТИЧНО виробляється хоча б одним УВІМКНЕНИМ і НАЛАШТОВАНИМ пакувальним
// правилом де завгодно в проєкті -- для T4: ZpSelect входу аналізатора обмежується САМЕ
// цим списком (а не вільним вводом з усього ClassIndex), бо станок-неупаковник не має
// сенсу пропонувати клас/вміст, якого ніхто не пакує. Обмежено РОДИНОЮ ZP_Sample_Base
// навмисно (дивись collectProducedStreams нижче) -- заготовки ZP_Data_* за задумом мода
// НЕ споживаються подальшими правилами (chainGraph.ts, коментар dead-output: "здаються на
// терміналі, а не споживаються іншим правилом"), тож включати їх сюди означало б
// пропонувати аналізатору вхід, який ЖОДНЕ правило в грі ніколи не зможе матчнути.
export interface ProducedStream {
  classname: string
  content: string
  display: string
}

export interface StationViewResult {
  // Порядок = порядок першої появи станка (Device правила -> потім DeviceClasses фракцій,
  // у порядку файлів проєкту) -- детермінований для тестів, не претендує на "порядок,
  // важливий рушію" (рушій не сортує станки -- лише правила й вузли дерева).
  stations: StationInfo[]
  byClassname: Map<string, StationInfo> // ключ -- classname.toLowerCase()
  producedStreams: ProducedStream[]
}

// ---- resolveStationItemDisplay: ігрове ім'я предмета для рядків/виходів/потоків -----------
//
// Пріоритет ідентичний тому, що вже рендерить ItemCardNode у ChainView.tsx (isDataItem
// перевіряється першим просто тому, що там так написано історично -- родини ZP_Data_Base й
// ZP_Sample_Base НЕ перетинаються, "хто перший" не впливає на результат):
//   1) родина ZP_Sample_Base -> ім'я з SampleTypes.json (resolveSampleTypeFace), fallback
//      сам класнейм (той самий "чесний роздрук + бейдж «не налаштовано»", що вже усталений
//      у ChainView -- тут прапорець isSample=true несе той самий сигнал для T2/T3).
//   2) родина ZP_Data_Base -> ім'я з DataItems.json (resolveDataItemFace), той самий fallback.
//   3) звичайний предмет -> ClassIndex.displayNameOf (ігрове ім'я з config.cpp/stringtable),
//      fallback сам класнейм (displayNameOf це вже робить сама).
//
// stripExact() ЗАСТОСОВАНО тут явно ПЕРЕД усіма трьома резолвами (на відміну від
// ChainView.resolveDataItemFace/resolveSampleTypeFace, які приймають classname AS IS --
// перенесено verbatim, дивись коментар на початку faceResolve.ts).
//
// ВИПРАВЛЕНО (W2.6-фінал, фінальне whole-branch ревʼю, IMPORTANT 1): раніше тут
// стверджувалось, що "InputItem/Outputs класнейми ЛЕГІТИМНО можуть нести суфікс |N" --
// НЕВІРНО для Outputs. ЛЕГІТИМНО пайп несуть лише вхідні поля -- InputItem/Device/
// RequiredWorn/RequiredTools (сервер стрипає його ПЕРЕД ClassExists, ZP_ProcessingConfig.c
// :318-322/:287/:292); Output -- ЄДИНИЙ виняток, де ClassExists перевіряє СИРИЙ рядок без
// стрипу (:326) -- пайп-форма в Outputs[].Classname зупиняє завантаження ВСЬОГО правила,
// і саме це тепер ловить СЬОМЕ правило ruleValidation.ts (validateOutputNoPipe). Те, що
// stripExact() тут застосовується ДО ВСІХ ТРЬОХ резолвів однаково (в тому числі до
// Outputs) -- це навмисно НЕ суперечить виправленню: resolveStationItemDisplay --
// функція ВІДОБРАЖЕННЯ (як показати ім'я в T2/T3), а не валідації, і мусить лишатися
// корисною навіть для вже зіпсованого правила (Output з пайпом) -- поки адмін не побачив
// alarm і не поправив, картка на полотні все одно повинна показувати читабельне ім'я, а
// не сирий "ZP_Sample|1". Без стрипу тут "ZP_Sample|1" не знайшов би запис у
// SampleTypes.json (Id там без пайпа) і показав би адміну "не налаштовано" замість
// читабельного імені -- подвійно помилковий сигнал поверх уже наявного alarm. Ідентичність
// класу для резолву імені -- ЗАВЖДИ частина ДО пайпа; сам пайп -- лише позначка режиму
// порівняння (точний клас проти IsKindOf), імені вона не стосується.
export function resolveStationItemDisplay(project: Project, index: ClassIndex, rawClassname: string): { display: string; isSample: boolean } {
  const cls = stripExact(rawClassname).trim()
  if (cls === '') return { display: '', isSample: false }
  if (isSampleClass(index, cls)) {
    return { display: resolveSampleTypeFace(project, index, cls).name, isSample: true }
  }
  if (isKindOf(index, cls, 'ZP_Data_Base')) {
    return { display: resolveDataItemFace(project, index, cls).name, isSample: false }
  }
  return { display: displayNameOf(index, cls), isSample: false }
}

// ---- Побудова валідаційного входу для validateRule (ruleValidation.ts) ---------------------
//
// RuleLike (chainGraph.ts) НЕ несе BasePurityMin/Max/RequiredWorn/RequiredTools/
// InputItem.ConsumeInput -- asRuleLike навмисно перевіряє лише ті поля, які потрібні
// chainGraph для матчингу/розривів. Тут потрібні ВСІ поля ValidateRule (ruleValidation.ts),
// тож решта читається напряму з СИРОГО об'єкта (той самий об'єкт, що rule -- asRuleLike
// повертає ТОЙ САМИЙ Record, не копію, дивись коментар угорі файлу) з захисними
// typeof-перевірками й дефолтами схеми (schema.ts: BasePurityMin/Max=0.5,
// ConsumeInput=true, RequiredWorn/RequiredTools=[]) -- НЕ дефолтом-нулем терпимого
// парсера: термінантний парсер (parse.ts) УЖЕ гарантує, що кожен ключ RULE_SCHEMA
// присутній у розібраному значенні (project.ts, коментар над ProjectFile) з канонічним
// нулем свого типу, якщо ключа не було у файлі -- тобто типи тут ЗАВЖДИ правильні для
// файлу, що пройшов parseConfig; typeof-перевірки нижче -- друга лінія захисту на
// випадок, якщо колись сюди потрапить об'єкт БЕЗ гарантії парсера (напр. рукописна
// тестова фікстура з пропущеним полем), а не сподівання "може не збігтись".
function numField(raw: Record<string, unknown>, key: string, fallback: number): number {
  const v = raw[key]
  return typeof v === 'number' ? v : fallback
}

function strArrField(raw: Record<string, unknown>, key: string): string[] {
  const v = raw[key]
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

// Закривна хвиля W4: дзеркало ValidateRule стало ПОВНИМ, тож збирачу потрібні ще й
// Quantity/Chance/Content кожного рядка. RuleLike (chainGraph.ts) їх не несе, а елементи
// його масивів взагалі НЕ перевірені на типи (asRuleLike дивиться лише "це масив"), тож
// читаємо їх із САМОГО елемента (він же сирий запис) з тими самими захисними typeof і
// дефолтами СХЕМИ (schema.ts: Quantity=1, Chance=1, Content=''), що вже стоять вище для
// BasePurity — а не з нулем терпимого парсера: для файлу, що пройшов parseConfig, ключі
// присутні завжди, а рукописна фікстура без ключа не повинна діставати чужу тривогу
// «Quantity поза межами». Заразом це прибирає стару приховану пастку: validateClassField
// робить classname.trim(), і НЕ-рядок у Classname кинув би TypeError замість повідомлення.
function itemStr(raw: Record<string, unknown>, key: string): string {
  const v = raw[key]
  return typeof v === 'string' ? v : ''
}

function itemNum(raw: Record<string, unknown>, key: string, fallback: number): number {
  const v = raw[key]
  return typeof v === 'number' ? v : fallback
}

function asRec(x: unknown): Record<string, unknown> {
  return x && typeof x === 'object' ? (x as Record<string, unknown>) : {}
}

// Експортовано (W4 T5 фікс-раунд ревʼю, Critical 1): ui/balanceView.ts гейтить «чи дає це
// правило видобуток» тим САМИМ дзеркалом ValidateRule, що й рядки вікна станка — друга копія
// збирання входу валідації розійшлася б із цією при першій же новій перевірці.
export function buildRuleValidationInput(rule: RuleLike, raw: Record<string, unknown>): RuleValidationInput {
  const inputRaw = raw.InputItem && typeof raw.InputItem === 'object' ? (raw.InputItem as Record<string, unknown>) : {}
  const consumeInput = typeof inputRaw.ConsumeInput === 'boolean' ? inputRaw.ConsumeInput : true
  return {
    // Mode подається, ЛИШЕ коли він справді є рядком у записі: рукописна фікстура без
    // ключа (не пропущена через parseConfig) не має отримувати чужу помилку «Mode ''» —
    // дивись семантику undefined над validateMode (ruleValidation.ts).
    Mode: typeof raw.Mode === 'string' ? raw.Mode : undefined,
    TimeSec: rule.TimeSec,
    BasePurityMin: numField(raw, 'BasePurityMin', 0.5),
    BasePurityMax: numField(raw, 'BasePurityMax', 0.5),
    Device: rule.Device,
    InputItem: {
      Classname: itemStr(inputRaw, 'Classname'),
      Quantity: itemNum(inputRaw, 'Quantity', 1),
      ConsumeInput: consumeInput,
      Content: itemStr(inputRaw, 'Content'),
    },
    Consumables: rule.Consumables.map((c) => {
      const rc = asRec(c)
      return { Classname: itemStr(rc, 'Classname'), Quantity: itemNum(rc, 'Quantity', 1), Content: itemStr(rc, 'Content') }
    }),
    Outputs: rule.Outputs.map((o) => {
      const ro = asRec(o)
      return {
        Classname: itemStr(ro, 'Classname'),
        Quantity: itemNum(ro, 'Quantity', 1),
        Chance: itemNum(ro, 'Chance', 1),
        Content: itemStr(ro, 'Content'),
      }
    }),
    RequiredWorn: strArrField(raw, 'RequiredWorn'),
    RequiredTools: strArrField(raw, 'RequiredTools'),
  }
}

// ---- Збір Factions[].DeviceClasses (для станків, що ще не мають ЖОДНОГО правила) ------------

function collectFactionDeviceClasses(project: Project): string[] {
  const out: string[] = []
  for (const file of project.files) {
    if (file.kind !== 'factions') continue
    const parsed = file.parsed as { Factions?: unknown[] } | undefined
    for (const raw of parsed?.Factions ?? []) {
      if (!raw || typeof raw !== 'object') continue
      const f = raw as Record<string, unknown>
      const deviceClasses = Array.isArray(f.DeviceClasses) ? f.DeviceClasses : []
      for (const dc of deviceClasses) {
        if (typeof dc === 'string') out.push(dc)
      }
    }
  }
  return out
}

// ---- buildStationView -----------------------------------------------------------------------

export function buildStationView(project: Project, index: ClassIndex): StationViewResult {
  const graph = buildChainGraph(project, index)

  // Проєкт-широкий лічильник ruleId (регістрочутливо, дзеркало chainGraph.assignNodeKeys:
  // byRuleId групує за bare ruleId незалежно від файлу/станка) -- джерело StationInputRow.
  // duplicate (п.6 брифа).
  const ruleIdCounts = new Map<string, number>()
  for (const n of graph.nodes) ruleIdCounts.set(n.ruleId, (ruleIdCounts.get(n.ruleId) ?? 0) + 1)

  // ---- Фаза 1: канонічні станки (Device правил + DeviceClasses фракцій), кейс-інсенситивний
  // дедуп, ПЕРШИЙ побачений регістр виграє (п.1 брифа). Порядок сканування: спершу Device усіх
  // правил (у порядку graph.nodes -- файл-пріоритет + порядок у файлі), потім DeviceClasses
  // фракцій -- станок, який уже має правило, НЕ змінює регістр/порядок через пізнішу згадку у
  // Factions.json.
  const order: string[] = [] // lower-ключі в порядку першої появи
  const byLower = new Map<string, StationInfo>()
  function ensureStation(rawClassname: string): void {
    const cls = stripExact(rawClassname).trim()
    if (cls === '') return
    const lower = cls.toLowerCase()
    if (byLower.has(lower)) return
    byLower.set(lower, { classname: cls, display: displayNameOf(index, cls), roles: { packer: false, analyzer: false }, inputRows: [] })
    order.push(lower)
  }
  for (const n of graph.nodes) {
    const rule = asRuleLike(n.rule)
    if (rule) ensureStation(rule.Device)
  }
  for (const dc of collectFactionDeviceClasses(project)) ensureStation(dc)

  // ---- Фаза 2: рядки входів -- один на правило, у порядку graph.nodes (той самий порядок,
  // що вже бачить адмін на полотні ланцюга). Рядок правила без Device (порожній рядок після
  // стрипу) НЕ потрапляє в ЖОДЕН станок -- йому нема де з'явитись у моделі "станок -> рядки"
  // (Device -- єдина ознака належності станку; це вже само по собі несправний конфіг --
  // сервер (FindStartableCore) так само ніколи не запустить правило без валідного Device).
  const allRows: StationInputRow[] = []
  for (const n of graph.nodes) {
    const rule = asRuleLike(n.rule)
    if (!rule) continue
    const stationCls = stripExact(rule.Device).trim()
    if (stationCls === '') continue
    const station = byLower.get(stationCls.toLowerCase())
    if (!station) continue // не повинно статись (Фаза 1 вже додала цей станок) -- захист від майбутнього дрейфу

    const raw = n.rule as unknown as Record<string, unknown>
    const validation = validateRule(buildRuleValidationInput(rule, raw), index)
    const inputEmpty = rule.InputItem.Classname.trim() === ''
    const outputsEmpty = !rule.Outputs.some((o) => o.Classname.trim() !== '')
    const problems: string[] = []
    if (inputEmpty) problems.push('вхід не задано')
    if (outputsEmpty) problems.push('вихід не задано')
    for (const e of validation) problems.push(e.message)
    const hasAlarm = validation.some((e: FieldError) => e.severity === 'alarm')
    const configured = !inputEmpty && !outputsEmpty && !hasAlarm

    const outputs: StationOutputFace[] = rule.Outputs.map((o) => {
      const face = resolveStationItemDisplay(project, index, o.Classname)
      return { classname: o.Classname, display: face.display, isSample: face.isSample, content: o.Content }
    })
    const inputFace = resolveStationItemDisplay(project, index, rule.InputItem.Classname)

    const row: StationInputRow = {
      filePath: n.filePath,
      ruleId: rule.Id,
      disabled: n.disabled,
      duplicate: (ruleIdCounts.get(rule.Id) ?? 0) > 1,
      rawClassname: rule.InputItem.Classname,
      rawContent: rule.InputItem.Content,
      rawDisplay: inputFace.display,
      configured,
      problems,
      outputs,
      destinations: [], // Фаза 3 нижче -- потребує ПОВНОГО списку станків/увімкнених правил
    }
    allRows.push(row)
    station.inputRows.push(row)
  }

  // ---- Фаза 3: "куди йде" -- для кожного виходу кожного рядка шукаємо станки з хоча б одним
  // УВІМКНЕНИМ правилом, чий InputItem матчить (matchInputMirror, єдине джерело порівняння).
  // Consumables НАВМИСНО не враховуються (дивись коментар на StationInputRow.destinations).
  //
  // ФІКС W2.6 fix-round-1 CRITICAL 1: ВИМКНЕНИЙ рядок-ДЖЕРЕЛО теж виключений (не лише
  // вимкнений споживач-кандидат нижче) -- дзеркало chainGraph/коментаря StationInputRow.
  // disabled (:76-78): "вимкнене правило виключене з матчингу як консумер І як джерело
  // "куди йде"/"що виробляється"". Раніше тут цього гейту не було: вимкнений пакувальник
  // усе одно показував би "куди йде" так, ніби він активно щось виробляє -- та сама
  // помилка, якої вже уникає producedStreams (Фаза 5 нижче, `row.disabled` перевіряється
  // там з самого початку).
  const enabledConsumers: { rule: RuleLike }[] = []
  for (const n of graph.nodes) {
    if (n.disabled) continue
    const rule = asRuleLike(n.rule)
    if (rule) enabledConsumers.push({ rule })
  }
  for (const row of allRows) {
    if (row.disabled) {
      row.destinations = []
      continue
    }
    const seenLower = new Set<string>()
    const dest: StationDestination[] = []
    for (const output of row.outputs) {
      for (const { rule: cons } of enabledConsumers) {
        if (!matchInputMirror(output.classname, output.content, cons.InputItem.Classname, cons.InputItem.Content, index)) continue
        const consCls = stripExact(cons.Device).trim()
        if (consCls === '') continue
        const lower = consCls.toLowerCase()
        if (seenLower.has(lower)) continue
        seenLower.add(lower)
        const station = byLower.get(lower)
        dest.push({ stationClassname: station ? station.classname : consCls, display: station ? station.display : displayNameOf(index, consCls) })
      }
    }
    row.destinations = dest
  }

  // ---- Фаза 4: ролі -- з УСІХ рядків станка (і увімкнених, і вимкнених; п.2 брифа не
  // ставить умови Enabled на роль -- роль показує СТРУКТУРУ, а не "чи зараз працює").
  for (const lower of order) {
    const station = byLower.get(lower)!
    let packer = false
    let analyzer = false
    for (const row of station.inputRows) {
      if (row.outputs.some((o) => o.isSample)) packer = true
      if (isSampleClass(index, stripExact(row.rawClassname))) analyzer = true
    }
    station.roles = { packer, analyzer }
  }

  // ---- Фаза 5: producedStreams -- лише УВІМКНЕНІ й НАЛАШТОВАНІ рядки, лише виходи родини
  // ZP_Sample_Base (дивись коментар над ProducedStream). Дедуп кейс-інсенситивний по
  // (classname, content), перший побачений регістр/display виграє -- той самий принцип, що
  // й станки у Фазі 1. Роздільник ключа -- НУЛЬ-байт (символ, якого не буває в класнеймі
  // чи Content) -- захист від колізії конкатенації: звичайний пробіл чи порожній рядок НЕ
  // рятує, бо classname='ab', content='c d' і classname='ab c', content='d' дали б той
  // самий ключ 'ab c d' при пробілі-роздільнику; нуль-байт такої колізії не допускає ні
  // за яких вхідних рядків (обидва — звичайний ігровий текст без керівних символів).
  const streamsByKey = new Map<string, ProducedStream>()
  for (const row of allRows) {
    if (row.disabled || !row.configured) continue
    for (const o of row.outputs) {
      if (!o.isSample) continue
      const key = `${o.classname.toLowerCase()}\u0000${o.content.toLowerCase()}`
      if (!streamsByKey.has(key)) streamsByKey.set(key, { classname: o.classname, content: o.content, display: o.display })
    }
  }

  const stations = order.map((lower) => byLower.get(lower)!)
  return { stations, byClassname: byLower, producedStreams: [...streamsByKey.values()] }
}
