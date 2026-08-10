// Модель графа ланцюгів переробки (W2 Task 4) — ЧИСТА логіка, без React/DOM: вузол = одне
// увімкнене чи вимкнене правило з ProcessingRules/*.json, ребро = "вихід ОДНОГО правила
// може задовольнити вхід ІНШОГО" за ТІЄЮ САМОЮ функцією співставлення, яку рушій викликає
// на сервері (ZP_ProcessingRules.MatchInput). Якщо семантика тут розійдеться з сервером,
// граф покаже адміну неправду: ребро там, де правило в грі ніколи не спрацює, або "розрив"
// там, де насправді все працює. Тому Step 1 брифа (перечитати .c і зафіксувати семантику
// перед рядком коду) — обов'язковий, а не формальність.

import type { Project } from '../io/project'
import type { ClassIndex } from './classIndex'
import { isKindOf } from './classIndex'

// ---- Мінімальна типізована форма ZP_Rule -------------------------------------------------
// Терпимий парсер (parse.ts, Task 5) гарантує, що КОЖЕН ключ RULE_SCHEMA присутній у
// розібраному значенні (відсутній у файлі -> нуль свого типу, а не `undefined`) -- тому тут
// досить структурного інтерфейсу, а не повної рефлексії по ObjectSchema: rule/RulesFile,
// що приходять з Project.parsed, завжди мають цю форму, якщо file.kind === 'rules'.
// Експортовано (W2 Task 5, ChainView): полотно графа читає ті самі поля правила для
// картки вузла (Device/TimeSec/InputItem/Consumables/Outputs) і НЕ повинно тримати
// другу копію цієї структурної форми/перевірки -- саме той дрейф двох копій, якого
// цей файл сам уникає (див. коментар matchClassMirror вище). ChainNode.rule лишається
// `unknown` навмисно (ChainView re-перевіряє через asRuleLike замість сліпого каста).
export interface RuleItemLike {
  Classname: string
  Content: string
}

export interface RuleLike {
  Id: string
  Enabled: boolean
  Device: string
  InputItem: RuleItemLike
  TimeSec: number
  Consumables: RuleItemLike[]
  Outputs: RuleItemLike[]
}

interface RulesFileLike {
  Rules: unknown[]
}

export function asRuleLike(rule: unknown): RuleLike | undefined {
  if (!rule || typeof rule !== 'object') return undefined
  const r = rule as Record<string, unknown>
  if (typeof r.Id !== 'string' || typeof r.Enabled !== 'boolean' || typeof r.Device !== 'string') return undefined
  if (typeof r.TimeSec !== 'number') return undefined
  if (!Array.isArray(r.Outputs) || !Array.isArray(r.Consumables)) return undefined
  if (!r.InputItem || typeof r.InputItem !== 'object') return undefined
  return r as unknown as RuleLike
}

// ---- Публічна модель графа ----------------------------------------------------------------

export interface ChainNode {
  ruleId: string
  filePath: string
  rule: unknown // ZP_Rule-об'єкт (структурно -- RuleLike, дивись asRuleLike вище)
  // M3.5: Enabled=false -- вузол лишається (адмін бачить вимкнене правило в графі), але
  // ребра НЕ будуються ні з нього, ні в нього (дзеркало FindStartableCore: r.Enabled
  // перевіряється ПЕРШИМ, раніше за Mode/Device/усе інше -- ZP_Processing.c:127-128).
  // Поле МОДЕЛІ, не стилю -- T5 вирішує, як саме малювати "вимкнено" (пунктир/сірий/...).
  disabled: boolean
}

export interface ChainEdge {
  fromRuleId: string
  toRuleId: string
  // Клас і вміст саме ТОГО, що фактично тече ребром -- вихід правила-джерела (не вимога
  // входу-споживача: вимога могла бути порожньою "будь-який клас/вміст", а ребро описує
  // конкретний артефакт).
  classname: string
  content: string
}

export type ChainBreakKind = 'dead-output' | 'unfed-input'

export interface ChainBreak {
  kind: ChainBreakKind
  ruleId: string
  // filePath -- ДОДАНО ревʼю T5 фікс-раунду 1 (Important 1): bare ruleId НЕ визначає
  // однозначно, ЯКОМУ вузлу належить розрив, коли Id дубльований у кількох файлах
  // (модель, як і задокументовано вище, дублікати НЕ діагностує -- сервер відхилив би
  // такий конфіг). Разом з ruleId filePath утворює той самий складений ключ
  // "filePath::ruleId", яким ChainView (T5) уже індексує вузли графа
  // (assignNodeKeys) -- панель розривів тепер резолвить ціль кліку САМЕ по ньому,
  // а не по першому вузлу з таким ruleId у мапі "хтозна-якого" близнюка.
  filePath: string
  classname: string
  content: string
  message: string // українською, для панелі попереджень T5
}

export interface ChainGraph {
  nodes: ChainNode[]
  edges: ChainEdge[]
  breaks: ChainBreak[]
}

// ---- matchInputMirror: дзеркало ZP_ProcessingRules.MatchClass/MatchInput -----------------
//
// Джерело (прочитано перед написанням коду, Task 4 Step 1):
// ZP_Research/scripts/3_Game/ZP_Research/ZP_ProcessingConfig.c
//
//   static bool MatchClass(string actualType, string configured)          // рядки 135-151
//   {
//       if (configured == "")
//           return false;
//       int sep = configured.IndexOf("|");
//       if (sep > -1)
//       {
//           string exact = configured.Substring(0, sep); exact.ToLower();
//           string actual = actualType;                  actual.ToLower();
//           return actual == exact;
//       }
//       return GetGame().IsKindOf(actualType, configured);
//   }
//
//   static bool MatchInput(string actualType, string actualContent,
//                           string configuredClass, string configuredContent)  // рядки 160-171
//   {
//       if (!MatchClass(actualType, configuredClass))
//           return false;
//       if (configuredContent == "")
//           return true;
//       string want = configuredContent; want.ToLower();
//       string have = actualContent;     have.ToLower();
//       return have == want;
//   }
//
// Викликачі (усі знайдені грепом по репозиторію -- "кожне місце виклику"):
//   ZP_Factions.c:266     -- ItemCost дерева (здача заготовки/матеріалу на терміналі).
//   ZP_Processing.c:115   -- IsExcluded: автопродовження НЕ бере власний щойно вироблений
//                            вихід як вхід ТІЄЇ Ж станції (runtime-нюанс станції, до графа
//                            конфігу не застосовний -- граф моделює МОЖЛИВІ зв'язки правил,
//                            а не автопродовження ОДНІЄЇ станції; тут навмисно НЕ повторено).
//   ZP_Processing.c:229   -- BuildCargoPlan: чи конкретний предмет у карго задовольняє
//                            InputItem.
//   ZP_Processing.c:276   -- BuildCargoPlan: те саме для Consumables[i].
// Усі ЧОТИРИ місця викликають РІВНО ЦЮ функцію -- жодного альтернативного шляху
// співставлення класу/вмісту в кодовій базі мода немає (мінор рев'ю фікс-раунду 1:
// раніше тут помилково стояло "п'ять" при переліку з чотирьох пунктів).
//
// ДВА ПИТАННЯ З БРИФА, ПЕРЕВІРЕНІ ПРЯМО ПО КОДУ (не за здогадом):
//
// 1) Порівняння Content -- РЕГІСТРОНЕЗАЛЕЖНЕ по ОБИДВОХ боках (рядки 166-169: `want.ToLower()`
//    і `have.ToLower()` -- саме так, обидві сторони, не лише конфігурована). Отже
//    matchInputMirror теж лоуеркейсить обидва боки перед порівнянням вмісту -- так само,
//    як matchClassMirror(через isKindOf, T1) регістронезалежний для класу.
//
// 2) Вихід БЕЗ Content проти входу З Content -- НЕ задовольняє. `configuredContent` --
//    вимога ВХОДУ (те, що написано в правилі-споживачі); коли вона непорожня, `have` --
//    це `actualContent`, тобто вміст ВИХОДУ-кандидата. Якщо вихід не має вмісту,
//    `have == ""`, а `want != ""` (бо ми в гілці "непорожньо") -> `"" == want` дає false.
//    Симетрична половина того самого правила (уже задокументована в самому .c, рядок 164):
//    вхід БЕЗ вимоги до Content (`configuredContent == ""`) береться за класом і повертає
//    true НЕЗАЛЕЖНО від того, є в актуального предмета вміст чи ні -- порожня вимога
//    означає "вміст не важливий", а не "вміст мусить бути порожнім".
//
// matchClassMirror делегує в isKindOf (T1, classIndex.ts) замість повторення його ж
// пайп-форми/кейс-інсенситивної логіки -- classIndex.ts:79-115 уже є звіреним дзеркалом
// ЦІЄЇ Ж серверної MatchClass (коментар там прямо посилається на ZP_ProcessingConfig.c:
// 135-151, і рев'ю фікс-раунду 1 CRITICAL 1 звірило там саме пайп-форму: "X|N" для
// БУДЬ-ЯКОГО N, не лише "X|1" -- виправлено на місці визначення, тож паритет тут не
// зачепило). Друга копія цієї логіки тут була б саме тим дрейфом двох копій, якого
// позбувались у T6 раунд 1 (project.ts/backend.ts MULTI_FILE_DIRS). Єдине, чого isKindOf
// НЕ робить -- це явна відмова на порожній configured; MatchClass ловить це ДО
// пайп-гілки, тож дзеркалимо тут окремим рядком (без нього isKindOf(idx, actual, '')
// повертає false лише посередньо,
// через провал усього ланцюга спадкування -- правильно на практиці, але не з тієї ж
// причини, що на сервері; явний рядок прибирає залежність від випадковості вмісту індексу).

// Експортовано (W4 Task 5): дзеркало IsDeviceFor у ui/balanceView.ts питає РІВНО ту саму
// MatchClass, якою сервер звіряє клас приладу з переліком приладів фракції
// (ZP_ConfigService.c:1578-1586). Друга копія цих трьох рядків там була б тим самим дрейфом,
// проти якого написана шапка цього модуля.
export function matchClassMirror(actualType: string, configured: string, index: ClassIndex): boolean {
  if (configured === '') return false
  return isKindOf(index, actualType, configured)
}

export function matchInputMirror(
  outputCls: string,
  outputContent: string,
  inputCls: string,
  inputContent: string,
  index: ClassIndex,
): boolean {
  if (!matchClassMirror(outputCls, inputCls, index)) return false
  if (inputContent === '') return true
  return outputContent.toLowerCase() === inputContent.toLowerCase()
}

// ---- buildChainGraph -----------------------------------------------------------------------

// Усі "вимоги входу" одного правила -- ГОЛОВНИЙ InputItem і кожен Consumable -- рівноправні
// для МАТЧИНГУ (сервер жене їх крізь ту саму MatchInput, ZP_Processing.c:229 і :276) і тому
// рівноправні для аналізу розривів: витратний матеріал із вимогою до Content, якого ніхто
// не виробляє, "мертвий" так само, як і головний вхід. Ребра/розриви не розрізняють, ЯКА
// саме вимога правила спрацювала -- інтерфейс ChainEdge/ChainBreak цього не несе (немає
// поля "роль"), тож і немає сенсу вигадувати внутрішній розподіл, якого нізвідки прочитати.
function requirementsOf(rule: RuleLike): RuleItemLike[] {
  return [rule.InputItem, ...rule.Consumables]
}

export function buildChainGraph(project: Project, index: ClassIndex): ChainGraph {
  const nodes: ChainNode[] = []

  for (const file of project.files) {
    if (file.kind !== 'rules') continue
    const parsed = file.parsed as RulesFileLike | undefined
    if (!parsed || !Array.isArray(parsed.Rules)) continue
    for (const raw of parsed.Rules) {
      const rule = asRuleLike(raw)
      if (!rule) continue
      // Сервер сам пропускає правило без Id ще при завантаженні (AddFileRules,
      // ZP_ProcessingConfig.c:216-220: "правило без Id пропущено") -- воно ніколи не
      // потрапляє в робочий реєстр і ніколи не зможе матчитись. Граф, який показав би
      // такий вузол як живий, брехав би так само, як і невірне ребро.
      if (rule.Id === '') continue
      nodes.push({ ruleId: rule.Id, filePath: file.path, rule, disabled: !rule.Enabled })
    }
  }

  // Вимкнені правила існують як вузли (адмін має їх бачити), але НЕ беруть участі в
  // матчингу -- ні як джерело ребра, ні як споживач, ні в аналізі розривів. Дзеркало
  // FindStartableCore (ZP_Processing.c:127-128): `if (!r.Enabled) continue;` -- це ПЕРША
  // перевірка, раніше за все інше.
  const enabled: { node: ChainNode; rule: RuleLike }[] = nodes
    .filter((n) => !n.disabled)
    .map((n) => ({ node: n, rule: n.rule as RuleLike }))

  // ---- ребра ------------------------------------------------------------------------------
  const edgeKeys = new Set<string>()
  const edges: ChainEdge[] = []
  for (const from of enabled) {
    for (const output of from.rule.Outputs) {
      for (const to of enabled) {
        const satisfied = requirementsOf(to.rule).some((req) =>
          matchInputMirror(output.Classname, output.Content, req.Classname, req.Content, index),
        )
        if (!satisfied) continue
        const key = `${from.node.ruleId}\u0000${to.node.ruleId}\u0000${output.Classname}\u0000${output.Content}`
        if (edgeKeys.has(key)) continue // той самий вихід задовольняє і InputItem, і Consumable -- одне ребро, не два
        edgeKeys.add(key)
        edges.push({
          fromRuleId: from.node.ruleId,
          toRuleId: to.node.ruleId,
          classname: output.Classname,
          content: output.Content,
        })
      }
    }
  }

  // ---- розриви ----------------------------------------------------------------------------
  const breaks: ChainBreak[] = []

  // dead-output: вихід НЕСЕ Content -- це проміжний ZP_Sample (ValidateContent на сервері,
  // ZP_ProcessingConfig.c:363, дозволяє непорожній Content ЛИШЕ класам ZP_Sample), і
  // ЖОДНЕ увімкнене правило його не бере -- ні в InputItem, ні в Consumables. Вихід БЕЗ
  // Content (ZP_Data_* заготовки, звичайне сировинне ItemBase) свідомо НЕ перевіряється:
  // заготовки за задумом здаються на терміналі, а не споживаються іншим правилом
  // (CLAUDE.md, розділ "КОНВЕЙЕР 3D-МОДЕЛЕЙ"/"два дефекти карго" і вище -- "результат
  // читає ЛЮДИНА").
  for (const from of enabled) {
    for (const output of from.rule.Outputs) {
      if (output.Content === '') continue
      const consumed = enabled.some((to) =>
        requirementsOf(to.rule).some((req) => matchInputMirror(output.Classname, output.Content, req.Classname, req.Content, index)),
      )
      if (consumed) continue
      breaks.push({
        kind: 'dead-output',
        ruleId: from.node.ruleId,
        filePath: from.node.filePath,
        classname: output.Classname,
        content: output.Content,
        message:
          `Вихід '${output.Classname}' (Content='${output.Content}') правила '${from.node.ruleId}' ` +
          `не бере жодне увімкнене правило — зразок стане глухим кутом.`,
      })
    }
  }

  // unfed-input: вимога (InputItem АБО будь-який Consumable) НЕСЕ Content -- і ЖОДНЕ
  // увімкнене правило не виробляє відповідний вихід. Вимога БЕЗ Content (звичайна
  // сировина на кшталт Apple/Rag, яку бере світ/CE, а не інше правило мода) свідомо НЕ
  // перевіряється -- "вхід без вимоги до вмісту" за визначенням бере предмет ЗА КЛАСОМ,
  // джерело якого поза графом переробки.
  for (const to of enabled) {
    const labeled: { req: RuleItemLike; label: string }[] = [
      { req: to.rule.InputItem, label: 'InputItem' },
      ...to.rule.Consumables.map((c, i) => ({ req: c, label: `Consumables[${i}]` })),
    ]
    for (const { req, label } of labeled) {
      if (req.Content === '') continue
      const produced = enabled.some((from) =>
        from.rule.Outputs.some((o) => matchInputMirror(o.Classname, o.Content, req.Classname, req.Content, index)),
      )
      if (produced) continue
      breaks.push({
        kind: 'unfed-input',
        ruleId: to.node.ruleId,
        filePath: to.node.filePath,
        classname: req.Classname,
        content: req.Content,
        message:
          `${label} правила '${to.node.ruleId}' вимагає '${req.Classname}' (Content='${req.Content}'), ` +
          `якого не виробляє жодне увімкнене правило — станція ніколи не матиме потрібного входу.`,
      })
    }
  }

  return { nodes, edges, breaks }
}
