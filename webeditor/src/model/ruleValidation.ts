// Дзеркальна ІНЛАЙН-валідація панелі правки (W2 Task 6 + W2-фінал, п'яте правило; ШОСТЕ
// правило — W2.6 fix-round-1, IMPORTANT 2; СЬОМЕ правило — W2.6-фінал, фінальне
// whole-branch ревʼю, IMPORTANT 1; ЗАКРИВНА ХВИЛЯ W4 — фінальне ревʼю гілки, Important 1).
// Джерело — ZP_ProcessingRules.ValidateRule, ZP_Research/scripts/3_Game/ZP_Research/
// ZP_ProcessingConfig.c:262-350 (+ ValidateContent :365-379 і підміна завантажувача
// AddFileRules :232-237). Кожне правило нижче процитоване з джерела — нічого не вгадано.
//
// ДЗЕРКАЛО ТЕПЕР ПОВНЕ (закривна хвиля W4): суцільний прохід ValidateRule зверху вниз
// закрив ДЕВʼЯТЬ форм, які сервер відкидає при завантаженні, а редактор рахував правило
// живим — зелена лампа рядка станка (model/stationView.ts) і «видобувається» на «Балансі»
// (ui/balanceView.ts) гейтяться САМЕ цією функцією, тож кожна пропущена форма була
// ХИБНИМ ЗЕЛЕНИМ у двох місцях одразу. ТРИ з девʼяти редактор створює ВЛАСНОЮ кнопкою
// «+ Додати» в один клік (ui/RulePanel.tsx: порожній рядок у RequiredWorn/RequiredTools,
// порожній Classname у Consumables) — адмін натиснув, передумав, пішов зі вкладки, і
// правило мертве на сервері при жодного сигналу в редакторі.
//
// МЕЖІ, ЩО ЛИШАЮТЬСЯ СВІДОМО (не «недоробка», а зважені рішення — деталі на кожній
// функції нижче):
//   1) клас ПОЗА локальним ClassIndex — 'warn', а не 'alarm' (мод міг бути відсутній на
//      цій машині; ClassExists на живому сервері дивиться п'ять конфіг-коренів РЕАЛЬНО
//      завантажених модів). Похідна від цього: перевірки Content, які на сервері йдуть
//      ПІСЛЯ резолву класу, на класі поза індексом мовчать.
//   2) порожній Device і порожній Outputs[i].Classname сервер ПРИЙМАЄ (ClassExists("")
//      повертає true — зонд W2.6-фіналу на стенді); тому Device має ВЛАСНИЙ alarm «мертве
//      правило» (MatchClass ніколи не збігається), а порожній вихід — 'warn'.
//   3) рядок із самих ПРОБІЛІВ у RequiredWorn/RequiredTools/Consumables сервер порівнює
//      дослівно (`rt == ""`), тобто порожнім НЕ вважає — дзеркало теж порівнює дослівно.
//   4) дубль Id правила — це hardErr рівня ФАЙЛУ (AddFileRules :244-248), не ValidateRule:
//      його показує рядок станка (StationInputRow.duplicate) і банер форми, не ця функція.

import type { ClassIndex } from './classIndex'
import { classRoot, stripExact } from './classIndex'
import { isSampleClass } from './sampleContent'

export type FieldSeverity = 'alarm' | 'warn'

export interface FieldError {
  path: string
  severity: FieldSeverity
  message: string
}

// ZP_ProcessingConfig.c:120 (MIN_TIME_SEC=5), :271-272, :283-284.
export function validateTimeSec(timeSec: number): FieldError[] {
  const out: FieldError[] = []
  if (timeSec < 5) {
    out.push({ path: 'TimeSec', severity: 'alarm', message: 'сервер відхилить: TimeSec менший за мінімум 5 с' })
  }
  if (timeSec > 604800) {
    out.push({ path: 'TimeSec', severity: 'alarm', message: 'сервер відхилить: TimeSec > 7 діб (604800 с)' })
  }
  return out
}

// ZP_ProcessingConfig.c:275-282.
export function validateBasePurity(min: number, max: number): FieldError[] {
  const out: FieldError[] = []
  if (min < 0 || min > 2) {
    out.push({ path: 'BasePurityMin', severity: 'alarm', message: 'сервер відхилить: BasePurityMin поза межами [0..2]' })
  }
  if (max < 0 || max > 2) {
    out.push({ path: 'BasePurityMax', severity: 'alarm', message: 'сервер відхилить: BasePurityMax поза межами [0..2]' })
  }
  if (max < min) {
    out.push({ path: 'BasePurityMax', severity: 'alarm', message: 'сервер відхилить: BasePurityMax менший за BasePurityMin' })
  }
  return out
}

// ZP_ProcessingConfig.c:313-317 — CfgMagazines (набої/магазини) заборонені СУВОРО для
// InputItem.Classname і Consumables[].Classname (magazineCheck=true), НЕ для Device/
// Outputs/RequiredWorn/RequiredTools — сервер там цю перевірку не робить узагалі. Клас
// поза індексом (root === undefined) — лише ПОПЕРЕДЖЕННЯ (allowFree — легітимний шлях
// для класів чужих модів, яких немає на цій машині розробки).
export function validateClassField(path: string, classname: string, index: ClassIndex, magazineCheck: boolean): FieldError[] {
  const cls = classname.trim()
  if (cls === '') return []
  const root = classRoot(index, stripExact(cls))
  if (magazineCheck && root === 1 /* CfgMagazines, ROOT_NAMES[1] */) {
    return [{ path, severity: 'alarm', message: 'сервер відхилить: CfgMagazines (набої/магазини) поки не підтримується' }]
  }
  if (root === undefined) {
    return [{ path, severity: 'warn', message: 'класу немає в індексі (мод відсутній на цій машині?)' }]
  }
  return []
}

// ШОСТЕ правило (W2.6 fix-round-1, IMPORTANT 2; формулювання ПЕРЕВІРЕНО й ВИПРАВЛЕНО
// W2.6-фінал, фінальне whole-branch ревʼю IMPORTANT 3). Старий коментар і alarm-текст
// спирались на НЕПЕРЕВІРЕНЕ припущення "ClassExists('') провалюється так само, як
// невідомий клас" — механізм насправді ІНШИЙ, доведено зондом на живому стенді.
//
// ЗОНД (2026-08-08): у ProcessingRules/ покладено одноправильний файл
// (`_zprobe_emptydevice.json`, видалено після зонда) з Device="", решта полів валідні
// (Mode=background, InputItem/Outputs заповнені, ConsumeInput=true). Бут server-only
// (`testserver\zp_run.ps1 -ServerOnly -NoBuild`) дав (script_2026-08-08_05-15-31.log:
// 34-35):
//   34: WARNING ProcessingRules\demo.json: правило 'demo_apple_analysis' пропущено:
//       Mode 'action' більше не підтримується ...     <- сусіднє демо-правило, для контрасту
//   35: [ZP_Research] configs loaded: ... rules=8 ...  <- БУЛО 7 без зонд-файла
// Жодного WARNING/ERR про zprobe-правило нема, а `rules` зросло на одиницю — правило
// ПРИЙНЯТО завантажувачем. Отже `GetGame().ConfigIsExisting("CfgVehicles " + "")`
// (ClassExists, :175-187, викликана з :318-319 на `StripExact(r.Device)` = "") повертає
// **true**, а не false: рядок "CfgVehicles " (з пробілом, без імені класу) рушій,
// вочевидь, резолвить у сам корінь "CfgVehicles", який існує. Після видалення
// зонд-файла повторний бут дав ідентичний базовій лінії рядок `rules=7` — відкат чистий.
//
// Правило НЕ відхиляється при завантаженні, але лишається МЕРТВИМ НАЗАВЖДИ: єдине
// місце, де Device реально звіряється з фізичним приладом, — `MatchClass(actualType,
// configured)` (:135-151), яку кличе `FindStartableCore`
// (ZP_Research/scripts/4_World/ZP_Research/ZP_Processing.c:133:
// `MatchClass(device.GetType(), r.Device)`) — і в ній є безумовний ранній вихід
// `if (configured == "") return false;` (:137-138). Жоден реальний класнейм приладу
// ніколи не дорівнює порожньому рядку, тож правило не стартує НІ НА ОДНОМУ приладі,
// ніколи. У станочній моделі редактора (model/stationView.ts) такий рядок до того ж
// НЕВИДИМИЙ узагалі — Device="" не належить жодному станку (Фаза 2 stationView.ts:
// "Рядок правила без Device ... НЕ потрапляє в ЖОДЕН станок") — гірше за просту
// відмову: конфіг формально валідний, рушій його рахує, а адмін не побачить рядок ніде,
// крім власне RulePanel цього конкретного правила.
//
// validateClassField (вище) для ПОРОЖНЬОГО classname мовчки повертає [] — generic-скіп
// "поле ще не заповнене". Device отримує ВЛАСНУ, окрему перевірку з severity=alarm (alarm
// лишається правильним рівнем НЕЗАЛЕЖНО від точного механізму — і "відхилено при
// завантаженні", і "мертве назавжди" однаково варті найвищої тривожності) — НЕ правку
// generic-скіпа в validateClassField: чіпати його спільну поведінку означало б тихо
// змінити семантику ще шести полів, кожне з яких має ВЛАСНУ серверну семантику порожнечі.
//
// ВИПРАВЛЕНО (закривна хвиля W4, фінальне ревʼю гілки Important 1): попередня редакція
// цього абзацу стверджувала, що порожній запис у решті полів-класнеймів — "легітимний
// проміжний стан", бо "порожні Consumables[]/Outputs[] елементи просто не існують
// масивом, порожній RequiredWorn[i] неможливий структурно". ОБИДВА твердження НЕВІРНІ:
// їх спростовує кнопка «+ Додати» самого редактора (ui/RulePanel.tsx: stringArrayHandlers
// .onAdd пушить '' у RequiredWorn/RequiredTools, addConsumable пушить {Classname:'',
// Quantity:1, Content:''}), і кожна така правка комітиться у файл ОДРАЗУ. Серверна
// семантика порожнечі РІЗНА для кожного поля й читається дослівно з ValidateRule:
//   RequiredTools[i]=="" / RequiredWorn[i]=="" -> ФАТАЛЬНО (:287, :292 — явна перевірка
//     `rt == ""` перед ClassExists) -> validateRequiredListItem нижче, alarm;
//   InputItem.Classname=="" -> ФАТАЛЬНО (:295-296) -> validateInputClassnameRequired, alarm;
//   Consumables[i].Classname=="" -> ФАТАЛЬНО (:304) -> перевірка в агрегаторі, alarm;
//   Device=="" -> завантажується, але мертве -> це правило, alarm;
//   Outputs[i].Classname=="" -> завантажується й лишається живим (ClassExists("")==true),
//     просто цей рядок нічого не спавнить -> warn.
//
// Без цієї перевірки Device="" був НЕВИДИМИЙ УСЮДИ: RulePanel (панель правки) не показує
// жодної помилки, вкладка «Файли» не рахує проблему, stationView.ts (problems[]/configured)
// теж мовчить — хоча в грі таке правило НІКОЛИ не спрацює. StripExact/trim
// застосовуються ДО перевірки на порожнечу (той самий порядок, що validateClassField
// робить для класу — інакше суто пайп-форма "|1" без нічого перед пайпом пройшла б як
// "непорожня", хоча StripExact дав би "").
export function validateDeviceRequired(device: string): FieldError[] {
  if (stripExact(device).trim() === '') {
    return [{ path: 'Device', severity: 'alarm', message: 'мертве правило: ніколи не стартує (MatchClass по порожньому Device)' }]
  }
  return []
}

// ВОСЬМЕ правило (W4 T5 фікс-раунд ревʼю, Critical 1). ZP_ProcessingConfig.c:267-270 —
// ПЕРША ж перевірка ValidateRule, раніше за все інше:
//   267-268: `string mode = r.Mode; mode.ToLower();`
//   269-270: `if (mode != "background") return "Mode '" + r.Mode + "' більше не
//             підтримується: переробка йде лише через станцію ...";`
// Порівняння йде по ToLower-копії, тобто "Background"/"BACKGROUND" сервер приймає, а
// будь-що інше — відхиляє ЦІЛКОМ (AddFileRules :249-254 Warn+continue, правило не
// потрапляє в Rules). Порожній рядок теж відхиляється: `"" != "background"`.
//
// Чому це важливо саме тут, а не «в редакторі Mode все одно завжди background»: ключ
// ВІДСУТНІЙ у файлі канонізується парсером у нуль свого типу — порожній рядок (io/parse.ts,
// політика відсутнього ключа; той самий механізм, через який BasePurity приїжджав нулем),
// а старі конфіги адмінів досі містять `"Mode": "action"` (режим прибрано директивою
// власника 2026-08-03 — саме про них і написане серверне повідомлення «більше не
// підтримується»). Обидва випадки означають «сервер це правило викине».
//
// Поле ОПЦІОНАЛЬНЕ (`Mode?`), і undefined = «викликач Mode не подав» -> перевірки немає:
// жоден наявний виклик validateRule не ламається, а форма, що читає сирий запис правила
// (model/stationView.ts buildRuleValidationInput), подає його завжди.
export function validateMode(mode: string | undefined): FieldError[] {
  if (mode === undefined) return []
  if (mode.toLowerCase() !== 'background') {
    return [
      {
        path: 'Mode',
        severity: 'alarm',
        message: `сервер відхилить: Mode '${mode}' більше не підтримується (переробка лише через станцію, Mode=background)`,
      },
    ]
  }
  return []
}

// ---- ЗАКРИВНА ХВИЛЯ W4: девʼять форм, які сервер відкидає, а дзеркало пропускало --------
//
// ДЕВʼЯТЕ правило. ZP_ProcessingConfig.c:285-294 — ДВА однакові цикли поспіль:
//   285-289: `foreach (string rt : r.RequiredTools) { if (rt == "" || !ClassExists(
//            StripExact(rt))) return "невідомий клас у RequiredTools: '" + rt + "'"; }`
//   290-294: те саме для RequiredWorn.
// Порожній рядок перевіряється ПЕРШИМ операндом `||`, тобто ДО будь-якого резолву класу —
// це не «класу немає в індексі» (де дзеркало свідомо оптимістичне), а безумовна відмова
// самого сервера, яку локальний ClassIndex не може ні підтвердити, ні спростувати.
// Порівняння ДОСЛІВНЕ (`rt == ""`, без trim) — дзеркалимо так само.
//
// УТОЧНЕННЯ (контрольне ревʼю закривної хвилі, minor 2 — попереднє формулювання тут було
// ФАКТИЧНО НЕВІРНЕ): рядок із самих пробілів сервер порожнім не вважає й іде далі в
// ClassExists(" ") -> false -> правило ВІДХИЛЕНО. А ось дзеркало про це мовчить, і не
// через це місце: validateClassField РОБИТЬ trim перед пошуком і на порожньому результаті
// повертає [] (той самий trim ховає й ' Apple' з пробілом на краю — сервер шукав би клас
// дослівно і не знайшов). Тобто про пробільні класнейми редактор поки не попереджає
// НІДЕ — досяжність низька (ZpSelect підставляє класи з індексу, не даючи набрати пробіли),
// адреса виправлення — W7 (реєстр «тихих підмін», разом із повним дзеркалом ClassExists).
export function validateRequiredListItem(path: string, value: string): FieldError[] {
  if (value === '') {
    return [
      {
        path,
        severity: 'alarm',
        message: 'сервер відхилить правило: порожній елемент списку (ZP_ProcessingConfig.c:287/292) — приберіть рядок або оберіть клас',
      },
    ]
  }
  return []
}

// ДЕСЯТЕ правило. ZP_ProcessingConfig.c:295-296:
//   `if (!r.InputItem || r.InputItem.Classname == "") return "немає InputItem.Classname";`
// Форми НЕ БУЛО в переліку ревʼю (там названі пʼять) — знайдена суцільним проходом
// ValidateRule. Наслідок був парний: рядок станка й так червонів через власну ознаку
// `inputEmpty` (model/stationView.ts), але «Баланс» гейтить видобуток ЛИШЕ alarm-ами
// цієї функції — там правило без сировини рахувалось живим виробником.
export function validateInputClassnameRequired(classname: string): FieldError[] {
  if (classname === '') {
    return [{ path: 'InputItem.Classname', severity: 'alarm', message: 'сервер відхилить: немає InputItem.Classname (ZP_ProcessingConfig.c:295-296)' }]
  }
  return []
}

// ОДИНАДЦЯТЕ правило. Межі Quantity [1..100] — ТРИ однакові перевірки в різних місцях:
//   297-298: `if (r.InputItem.Quantity < 1 || r.InputItem.Quantity > 100) return
//            "InputItem.Quantity поза межами [1..100]";`
//   306-307: те саме для Consumable.Quantity;  330-331: те саме для Output.Quantity.
// Нуль сюди потрапляє не лише «руками»: ключ, ВІДСУТНІЙ у файлі, канонізується в нуль
// свого типу (io/parse.ts; доведено бутом на стенді для float і для string — приймання
// W4/T7, зонд N3), тож рукописне правило без рядка `"Quantity"` сервер відкине ЦІЛКОМ.
export function validateQuantity(path: string, quantity: number, cite: string): FieldError[] {
  if (quantity < 1 || quantity > 100) {
    return [{ path, severity: 'alarm', message: `сервер відхилить: Quantity '${quantity}' поза межами [1..100] (${cite})` }]
  }
  return []
}

// ДВАНАДЦЯТЕ правило. ZP_ProcessingConfig.c:328-329:
//   `if (o.Chance < 0 || o.Chance > 1) return "Output.Chance поза межами [0..1]";`
export function validateChance(path: string, chance: number): FieldError[] {
  if (chance < 0 || chance > 1) {
    return [{ path, severity: 'alarm', message: `сервер відхилить: Output.Chance '${chance}' поза межами [0..1] (ZP_ProcessingConfig.c:328-329)` }]
  }
  return []
}

// ТРИНАДЦЯТЕ правило. ValidateContent (ZP_ProcessingConfig.c:365-379), яку ValidateRule
// кличе ТРИЧІ — для InputItem (:299-301), кожного Consumable (:308-310) і кожного Output
// (:332-334). Три причини відмови, у порядку джерела:
//   367-368: порожній Content — ранній вихід, жодних перевірок далі;
//   369-370: `if (!IsSampleClass(classname)) return ... "вміст мають лише зразки (родина
//            ZP_Sample_Base)"` — вміст має сенс ЛИШЕ у зразка;
//   371-372: `if (content.Length() > 64)` — БАЙТИ, не символи (Enforce string.Length() —
//            байтова довжина, enstring.c:199, окремий натив від LengthUtf8() :212; той
//            самий висновок уже стоїть у model/treeView.ts для ItemCost Content, там він
//            був знахідкою ревʼю W3/T1: кирилична мітка на 33-64 літери = 66-128 байт);
//   373-378: пробіл на початку/в кінці (`TrimInPlace` і порівняння з оригіналом).
//
// МЕЖА (та сама, що в treeView.ts для ItemCost): якщо класу НЕМАЄ в локальному
// ClassIndex, ми не знаємо його ієрархії напевно — IsSampleClass це IsKindOf по РЕАЛЬНІЙ
// ієрархії живого сервера. АЛЕ мовчати зовсім — теж неправда (контрольне ревʼю закривної
// хвилі W4, minor 1): родина ZP_Sample_Base — класи НАШОГО мода, і в індексі, зібраному з
// модпака, вони є завжди; отже клас поза індексом майже напевно НЕ зразок, і сервер таке
// правило відхилить. Компроміс: 'warn' із чесним «якщо він не зразок» — не 'alarm', бо
// існує законний сценарій, у якому мовчання правильне: адмін імпортував ClassIndex БЕЗ
// нашого мода, і тоді поза індексом опиняються самі ZP_Sample_*.
export function validateContentMirror(path: string, where: string, classname: string, content: string, index: ClassIndex): FieldError[] {
  if (content === '') return []
  const cls = stripExact(classname).trim()
  if (cls === '') return [] // порожній клас має власні перевірки; IsKindOf("") зондом не міряли — не вгадуємо
  if (classRoot(index, cls) === undefined) {
    return [
      {
        path,
        severity: 'warn',
        message: `${where} Content задано для '${classname}', якого немає в індексі редактора: вміст мають ЛИШЕ зразки родини ZP_Sample_Base (наші класи, в індексі модпака вони є завжди), тож якщо це не зразок — сервер відхилить правило (ValidateContent, ZP_ProcessingConfig.c:369-370)`,
      },
    ]
  }
  if (!isSampleClass(index, cls)) {
    return [
      {
        path,
        severity: 'alarm',
        message: `сервер відхилить: ${where} Content задано для '${classname}', але вміст мають лише зразки родини ZP_Sample_Base (ValidateContent, ZP_ProcessingConfig.c:369-370)`,
      },
    ]
  }
  const out: FieldError[] = []
  if (new TextEncoder().encode(content).length > 64) {
    out.push({
      path,
      severity: 'alarm',
      message: `сервер відхилить: ${where} Content довший за 64 БАЙТИ у UTF-8 (кирилична літера = 2 байти) (ValidateContent, ZP_ProcessingConfig.c:371-372)`,
    })
  }
  if (content.trim() !== content) {
    out.push({
      path,
      severity: 'alarm',
      message: `сервер відхилить: ${where} Content '${content}' має пробіл на початку або в кінці (ValidateContent, ZP_ProcessingConfig.c:373-378)`,
    })
  }
  return out
}

// ЧОТИРНАДЦЯТЕ правило. ZP_ProcessingConfig.c:338-339 (з коментарем :335-337):
//   `if (IsSampleClass(o.Classname) && o.Content == "") return "вихід '" + o.Classname +
//    "' без Content: такий зразок не зможе прийняти жодне правило";`
// Це саме той випадок, коли «авто-Content» редактора (model/sampleContent.ts) НЕ
// спрацював: авто-значення — це InputItem.Classname, і якщо він порожній, вихід-зразок
// лишається без вмісту. Клас поза індексом — знову мовчання (isSampleClass не знає).
export function validateSampleOutputContent(path: string, classname: string, content: string, index: ClassIndex): FieldError[] {
  if (content !== '') return []
  const cls = stripExact(classname).trim()
  if (cls === '' || classRoot(index, cls) === undefined) return []
  if (!isSampleClass(index, cls)) return []
  return [
    {
      path,
      severity: 'alarm',
      message: `сервер відхилить: вихід '${classname}' — зразок БЕЗ Content, такий зразок не зможе прийняти жодне правило (ZP_ProcessingConfig.c:338-339)`,
    },
  ]
}

// ПʼЯТНАДЦЯТЕ правило — єдине, що робить дзеркало МʼЯКШИМ, а не суворішим, і єдине, що
// приходить не з ValidateRule, а з завантажувача ПЕРЕД нею. AddFileRules
// (ZP_ProcessingConfig.c:232-237):
//   `if (r.BasePurityMax <= 0) { ZP_Log.Warn(... "без BasePurity — узято типове 0.5 ...");
//    r.BasePurityMin = 0.5; r.BasePurityMax = 0.5; }`
// Тобто правило з BasePurityMax<=0 сервер НЕ відхиляє: він гучно переписує ОБИДВА кінці
// на 0.5 і валідує вже їх. Дзеркало, яке цього не знало, давало ТРИ ХИБНІ ТРИВОГИ на
// правилі, яке сервер приймає (напр. Min=3, Max=-1: «Min поза межами», «Max поза межами»,
// «Max менший за Min» — а в грі це просто 0.5/0.5). Тому тут warn: правило живе, але
// значення адміна в ГРУ НЕ ПОТРАПЛЯТЬ.
//
// ЧОМУ САМЕ ТУТ, А НЕ У ВИКЛИКАЧА: до закривної хвилі цю нормалізацію робив РУЧНИЙ
// префікс у ui/balanceView.ts (фікс-раунд W4/T5) — єдиний із трьох викликачів, хто про неї
// знав; рядок станка й панель правила показували хибну тривогу. Одна копія в дзеркалі
// закриває всіх трьох (ручний префікс у balanceView лишився нешкідливим і йде першим —
// після нього ця перевірка просто не спрацьовує).
export function validateBasePurityLoaderDefault(basePurityMax: number): FieldError[] {
  if (basePurityMax <= 0) {
    return [
      {
        path: 'BasePurityMax',
        severity: 'warn',
        message: 'сервер підставить 0.5 ОБОМ кінцям: BasePurityMax<=0 трактується як «не задано» (AddFileRules, ZP_ProcessingConfig.c:232-237) — задані тут значення в гру не потраплять',
      },
    ]
  }
  return []
}

// ШІСТНАДЦЯТЕ правило (warn). Порожній Outputs[i].Classname сервер ПРИЙМАЄ: ClassExists("")
// повертає true (зонд W2.6-фіналу на стенді, детально — над validateDeviceRequired), а
// окремої перевірки на порожнечу для Output, на відміну від Consumables/RequiredTools/
// RequiredWorn/InputItem, у ValidateRule немає. Правило завантажиться й працюватиме —
// просто цей рядок нічого не дасть: ResolveResult (ZP_Processing.c:427-441) кладе в план
// порожній класнейм, а CreateInInventory("") не створює нічого.
export function validateEmptyOutputClassname(path: string, classname: string): FieldError[] {
  if (classname === '') {
    return [
      {
        path,
        severity: 'warn',
        message: 'порожній вихід: сервер правило прийме (ClassExists("")==true), але цей рядок нічого не заспавнить; із заданим Content правило, найімовірніше, буде відхилено (ValidateContent :369-370)',
      },
    ]
  }
  return []
}

// Мінімальна структурна форма правила, якої потребує валідація — ширший RuleRecord
// (ui/RulePanel.tsx) структурно її задовольняє, окремого імпорту типу з UI-шару не треба.
// Поля Quantity/Chance/Content ОБОВʼЯЗКОВІ (закривна хвиля W4): їх перевіряє сам сервер,
// і необовʼязковість тут означала б, що новий викликач мовчки отримає дірку в дзеркалі —
// саме те, чим ця хвиля й займається. Єдиний збирач входу — buildRuleValidationInput
// (model/stationView.ts), він читає їх із сирого запису з дефолтами схеми.
export interface RuleValidationInput {
  // Опціональне — дивись validateMode вище (undefined = не перевіряти).
  Mode?: string
  TimeSec: number
  BasePurityMin: number
  BasePurityMax: number
  Device: string
  InputItem: { Classname: string; Quantity: number; ConsumeInput: boolean; Content: string }
  Consumables: { Classname: string; Quantity: number; Content: string }[]
  Outputs: { Classname: string; Quantity: number; Chance: number; Content: string }[]
  RequiredWorn: string[]
  RequiredTools: string[]
}

// ZP_ProcessingConfig.c:340-355 (ValidateRule, хвіст функції) — точна перевірена ділянка:
//   341: "// ConsumeInput=false У ФОНОВОМУ РЕЖИМІ ЗАБОРОНЕНО (рішення власника)."
//   342-346: коментар пояснює причину — автопродовження бере наступну партію, поки
//            сировина лежить у карго; неспоживаний вхід із карго не зникає ніколи, тож
//            один предмет крутився б вічно, видаючи вихід щоцикл.
//   347-348: `if (mode == "background" && r.InputItem && !r.InputItem.ConsumeInput)
//             return "ConsumeInput=false недопустимий для Mode=background (нескінченний
//             конвеєр); приберіть прапорець або зробіть правило action";`
// Це `ValidateRule` — та сама функція, що йде і при завантаженні файлу (TryLoadRules:246-254
// робить `ZP_Log.Warn(...) ; continue`, тобто правило просто НЕ потрапляє в Rules), і при
// живих ops UPSERT_RULE. RulePanel.tsx:592-597 показує Mode як read-only "background" —
// редактор не вміє редагувати жодного іншого режиму (Mode="action" прибрано директивою
// власника 2026-08-03), тому в цій формі combo mode=background завжди істинний і
// перевірка нижче діє безумовно, без окремого читання Mode.
export function validateConsumeInput(consumeInput: boolean): FieldError[] {
  if (!consumeInput) {
    return [
      {
        path: 'InputItem.ConsumeInput',
        severity: 'alarm',
        message: 'сервер відхилить: ConsumeInput=false недопустимий для background',
      },
    ]
  }
  return []
}

// СЬОМЕ правило (W2.6-фінал, фінальне whole-branch ревʼю, IMPORTANT 1). ZP_ProcessingConfig.c:326:
//   `foreach (ZP_RuleOutput o : r.Outputs) { if (!o || !ClassExists(o.Classname)) return
//   "невідомий Output"; ... }` — це ЄДИНЕ з семи полів-класнеймів правила, де сервер
//   перевіряє `ClassExists` на СИРОМУ `o.Classname`, БЕЗ `StripExact`. Порівняй решту
//   шести: Device (:318-319 `StripExact(r.Device)`), InputItem (:321-322
//   `StripExact(r.InputItem.Classname)`), Consumables (:304 `StripExact(c.Classname)`),
//   RequiredTools/RequiredWorn (:287/:292 `StripExact(rt)`/`StripExact(rw)`) — усі стрипають
//   пайп-суфікс "|N" ПЕРЕД перевіркою. Output — виняток без жодного пояснення в коді;
//   пайп-форма "ZP_Sample|1" іде в `ConfigIsExisting("CfgVehicles ZP_Sample|1")` (і решту
//   чотирьох коренів, ClassExists :175-187) ДОСЛІВНО — жоден із п'яти коренів такого рядка
//   не знає, `ClassExists` повертає false для ВСІХ п'яти, `ValidateRule` повертає непорожній
//   рядок помилки, і правило ПРОПУСКАЄТЬСЯ ЦІЛКОМ при завантаженні (AddFileRules:249-254,
//   той самий шлях відмови, що решта alarm-правил тут).
//
// Навіть якби валідація якимось дивом пропустила пайп-форму, шлях видачі результату так
// само бере СИРИЙ класнейм без стрипу: `ResolveResult`
// (ZP_Research/scripts/4_World/ZP_Research/ZP_Processing.c:427-441) кладе
// `outItems.Insert(o.Classname)` дослівно, а `SpawnOneToCargo` (:450-455) передає його в
// `device.GetInventory().CreateInInventory(classname)` — рушій не розуміє пайп-синтаксис
// поза MatchClass, тож спавн зламався б і на цьому кроці. Подвійна відмова, не одна.
//
// Раніше цей факт БУВ ПОМИЛКОВО задокументований у зворотньому напрямку: model/
// stationView.ts:165-169 (коментар над resolveStationItemDisplay) стверджував "InputItem/
// Outputs класнейми ЛЕГІТИМНО можуть нести суфікс |N" — виправлено тим самим ревʼю на
// "лише вхідні поля" (Device/InputItem/RequiredWorn/RequiredTools легітимно несуть пайп,
// Outputs — НІ). cloneStation.test.ts:179 (тест заміни пайп-форми в Outputs[].Classname
// при клонуванні) лишається валідним тестом ВІРНОСТІ клонування (клон зобов'язаний
// зберегти вхідні дані як є, навіть якщо вони вже биті) — саме ця, сьома, перевірка тепер
// піднімає тривогу на такому правилі, а не мовчить про нього.
export function validateOutputNoPipe(path: string, classname: string): FieldError[] {
  if (classname.includes('|')) {
    return [
      {
        path,
        severity: 'alarm',
        message: 'сервер відхилить: ClassExists для Output — без StripExact (ZP_ProcessingConfig.c:326)',
      },
    ]
  }
  return []
}

export function validateRule(rule: RuleValidationInput, index: ClassIndex): FieldError[] {
  const out: FieldError[] = []
  // Порядок — як у ValidateRule на сервері: Mode перевіряється ПЕРШИМ (:267-270).
  out.push(...validateMode(rule.Mode))
  out.push(...validateTimeSec(rule.TimeSec))
  // BasePurity: спершу підміна завантажувача (:232-237 — вона йде ДО ValidateRule), і лише
  // якщо її НЕ було — власне межі ValidateRule (:275-282). Порядок тут — не косметика:
  // переставивши, отримаємо три хибні тривоги на правилі, яке сервер приймає.
  const purityDefaulted = validateBasePurityLoaderDefault(rule.BasePurityMax)
  if (purityDefaulted.length > 0) {
    out.push(...purityDefaulted)
  } else {
    out.push(...validateBasePurity(rule.BasePurityMin, rule.BasePurityMax))
  }
  out.push(...validateConsumeInput(rule.InputItem.ConsumeInput))
  out.push(...validateDeviceRequired(rule.Device))
  out.push(...validateClassField('Device', rule.Device, index, false))
  rule.RequiredTools.forEach((rt, i) => {
    const path = `RequiredTools[${i}]`
    const empty = validateRequiredListItem(path, rt)
    out.push(...empty)
    if (empty.length === 0) out.push(...validateClassField(path, rt, index, false))
  })
  rule.RequiredWorn.forEach((rw, i) => {
    const path = `RequiredWorn[${i}]`
    const empty = validateRequiredListItem(path, rw)
    out.push(...empty)
    if (empty.length === 0) out.push(...validateClassField(path, rw, index, false))
  })
  out.push(...validateInputClassnameRequired(rule.InputItem.Classname))
  out.push(...validateClassField('InputItem.Classname', rule.InputItem.Classname, index, true))
  out.push(...validateQuantity('InputItem.Quantity', rule.InputItem.Quantity, 'ZP_ProcessingConfig.c:297-298'))
  out.push(...validateContentMirror('InputItem.Content', 'InputItem', rule.InputItem.Classname, rule.InputItem.Content, index))
  rule.Consumables.forEach((c, i) => {
    const clsPath = `Consumables[${i}].Classname`
    if (c.Classname === '') {
      out.push({ path: clsPath, severity: 'alarm', message: 'сервер відхилить правило: витратний без класнейму (ZP_ProcessingConfig.c:302-305)' })
    } else {
      out.push(...validateClassField(clsPath, c.Classname, index, true))
    }
    out.push(...validateQuantity(`Consumables[${i}].Quantity`, c.Quantity, 'ZP_ProcessingConfig.c:306-307'))
    out.push(...validateContentMirror(`Consumables[${i}].Content`, 'Consumable', c.Classname, c.Content, index))
  })
  rule.Outputs.forEach((o, i) => {
    const clsPath = `Outputs[${i}].Classname`
    out.push(...validateEmptyOutputClassname(clsPath, o.Classname))
    out.push(...validateClassField(clsPath, o.Classname, index, false))
    out.push(...validateOutputNoPipe(clsPath, o.Classname))
    out.push(...validateChance(`Outputs[${i}].Chance`, o.Chance))
    out.push(...validateQuantity(`Outputs[${i}].Quantity`, o.Quantity, 'ZP_ProcessingConfig.c:330-331'))
    out.push(...validateContentMirror(`Outputs[${i}].Content`, 'Output', o.Classname, o.Content, index))
    out.push(...validateSampleOutputContent(`Outputs[${i}].Content`, o.Classname, o.Content, index))
  })
  return out
}

export function fieldErrors(errors: FieldError[], path: string): FieldError[] {
  return errors.filter((e) => e.path === path)
}
