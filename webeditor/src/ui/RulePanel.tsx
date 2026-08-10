// Форма правки правила (W2 Task 6; W2.6 Task 3 — перетворена з бічної панелі на
// ВБУДОВУВАНУ форму RuleForm для розгорнутого рядка вікна станка, ui/StationWindow.tsx).
// Кожна правка йде через applyRuleEdit (io/ruleEdit.ts, чиста мутація), результат одразу
// стає НОВИМ Project (App.tsx.setProject) — граф ланцюгів (ChainView) перемальовується
// живцем на ТОМУ САМОМУ useMemo([project, index]), яким він уже керується: нічого
// спеціального для "живого графа" вигадувати не треба, досить дати НОВЕ посилання Project.
//
// ДИРЕКТИВА ВЛАСНИКА (надійшла ПІД ЧАС виконання цього таска, 2026-08-06/07): Content
// зразка — не мітка, яку вигадує адмін, а буквально НАЗВА СИРОВИНИ (InputItem.Classname
// того самого правила). Формат файлу НЕ змінюється (Content лишається рядком) — панель
// лише автозаповнює й підказує (model/sampleContent.ts): див. OutputContentField і
// commitInputClassname/commitOutputClassname нижче.
//
// Колокація (той самий підхід, що ZpSelect.tsx/filterOptions і ChainView.tsx/buildStationCanvas):
// чисті хелпери форми (findRuleMatches/collectContentOptions/collectNodeOptions/
// collectFactionOptions) експортовані й покриті tests/rulePanel.test.ts — вони мапують
// Project (io/project.ts) у структури, специфічні для ЦІЄЇ форми, і нікому іншому не
// потрібні.

import { useEffect, useMemo, useState } from 'react'
import type { Project } from '../io/project'
import { applyRuleEdit } from '../io/ruleEdit'
import { fmtFloat } from '../io/jsonWriter'
import type { ClassIndex } from '../model/classIndex'
import { searchClasses } from '../model/classIndex'
import { isSampleClass, isAutoContent, deriveOutputContent } from '../model/sampleContent'
import type { ProducedStream } from '../model/stationView'
import { validateRule, fieldErrors } from '../model/ruleValidation'
import type { FieldError } from '../model/ruleValidation'
import { ZpSelect } from './ZpSelect'
import type { ZpOption } from './ZpSelect'

// ---- Структурна форма ZP_Rule для форми (ширша за chainGraph.RuleLike — та лишається
// вужчою моделлю для графа, тут потрібні ВСІ поля RULE_SCHEMA) --------------------------

interface RuleInputItemRecord {
  Classname: string
  Quantity: number
  ConsumeInput: boolean
  Content: string
}

interface RuleConsumableRecord {
  Classname: string
  Quantity: number
  Content: string
}

interface RuleOutputRecord {
  Classname: string
  Quantity: number
  Chance: number
  Content: string
}

export interface RuleRecord {
  Id: string
  Enabled: boolean
  Device: string
  Mode: string
  InputItem: RuleInputItemRecord
  BasePurityMin: number
  BasePurityMax: number
  TimeSec: number
  Consumables: RuleConsumableRecord[]
  Outputs: RuleOutputRecord[]
  RequiredNode: string
  RequiredFactions: string[]
  RequiredWorn: string[]
  RequiredTools: string[]
  Notes: string
}

// ---- Пошук правила в Project за складеним ключем (той самий, яким ChainView/T5
// ідентифікує вузли графа) ------------------------------------------------------------

export function findRuleMatches(project: Project, filePath: string, ruleId: string): Record<string, unknown>[] {
  const file = project.files.find((f) => f.path === filePath)
  if (!file || file.kind !== 'rules') return []
  const doc = file.parsed as { Rules?: unknown[] } | undefined
  if (!doc || !Array.isArray(doc.Rules)) return []
  return doc.Rules.filter(
    (r): r is Record<string, unknown> => !!r && typeof r === 'object' && (r as Record<string, unknown>).Id === ruleId,
  )
}

// ---- Збір опцій для ZpSelect-полів, що посилаються на інші сутності проєкту -----------

// Content-мітки: ПЕРВИННІ — ті, що реально ВИРОБЛЯЄ хоч одне УВІМКНЕНЕ правило (той самий
// критерій "виробляється", що dead-output у chainGraph.ts) — саме їх найчастіше треба
// обрати на боці аналізатора (InputItem.Content), тож вони йдуть у списку ПЕРШИМИ.
// ВТОРИННІ — решта Content-рядків, що зустрічаються в проєкті (у т.ч. ItemCost дерева) —
// доступні, але нижче пріоритетом (filterOptions зберігає порядок вхідного масиву при
// рівних збігах). Якщо мітка збігається з реальним класнеймом з ClassIndex (типовий
// випадок після авто-похідних значень — Content = InputItem.Classname), hint показує
// джерело-мод цього класу; для невиробленого — hint явно каже "не виробляється".
export function collectContentOptions(project: Project, index: ClassIndex): ZpOption[] {
  // produced -- КЕЙС-ІНСЕНСИТИВНИЙ (W2.6 Task 4, хвіст W2): matchInputMirror/сервер
  // (ZP_ProcessingConfig.c:166-169, `want.ToLower()`/`have.ToLower()`) порівнюють Content
  // БЕЗ УРАХУВАННЯ РЕГІСТРУ -- Content="paper" мусить класифікуватись як "виробляється",
  // якщо ХОЧ ОДИН увімкнений вихід десь у проєкті несе Content="Paper" (та сама сировина,
  // інший регістр літер того самого рядка). Звичайний Set<string> (як було) порівнює
  // ТОЧНО, тож пара такого штибу давала хибний хінт "не виробляється жодним увімкненим
  // правилом" на РОБОЧОМУ ланцюгу -- адмін бачив би тривогу там, де рушій запрацював би.
  // Ключ -- lower-case, значення -- ПЕРШИЙ побачений оригінальний регістр (той самий
  // принцип "перший побачений регістр виграє", що вже стоїть над Фазою 1 buildStationView
  // у model/stationView.ts) -- опція показує адміну живий текст, не lower-case спотворення.
  const produced = new Map<string, string>()
  const all = new Set<string>()

  function addProduced(content: string) {
    const key = content.toLowerCase()
    if (!produced.has(key)) produced.set(key, content)
  }

  for (const file of project.files) {
    if (file.kind !== 'rules') continue
    const doc = file.parsed as { Rules?: unknown[] } | undefined
    if (!doc || !Array.isArray(doc.Rules)) continue
    for (const raw of doc.Rules) {
      if (!raw || typeof raw !== 'object') continue
      const r = raw as Record<string, unknown>
      const enabled = r.Enabled !== false
      const input = r.InputItem as Record<string, unknown> | undefined
      if (input && typeof input.Content === 'string' && input.Content) all.add(input.Content)
      for (const c of (r.Consumables as Record<string, unknown>[] | undefined) ?? []) {
        if (c && typeof c.Content === 'string' && c.Content) all.add(c.Content)
      }
      for (const o of (r.Outputs as Record<string, unknown>[] | undefined) ?? []) {
        if (o && typeof o.Content === 'string' && o.Content) {
          all.add(o.Content)
          if (enabled) addProduced(o.Content)
        }
      }
    }
  }

  for (const file of project.files) {
    if (file.kind !== 'techTree') continue
    const doc = file.parsed as { Nodes?: unknown[] } | undefined
    if (!doc || !Array.isArray(doc.Nodes)) continue
    for (const raw of doc.Nodes) {
      if (!raw || typeof raw !== 'object') continue
      for (const ic of ((raw as Record<string, unknown>).ItemCost as Record<string, unknown>[] | undefined) ?? []) {
        if (ic && typeof ic.Content === 'string' && ic.Content) all.add(ic.Content)
      }
    }
  }

  function toOption(label: string, fallbackHint?: string): ZpOption {
    const idx = index.byName.get(label.toLowerCase())
    const hint = idx !== undefined ? index.mods[index.classes[idx][2]] : fallbackHint
    return { id: label, label, hint }
  }

  const primary = [...produced.values()].sort().map((label) => toOption(label))
  const secondary = [...all]
    .filter((c) => !produced.has(c.toLowerCase()))
    .sort()
    .map((label) => toOption(label, 'не виробляється жодним увімкненим правилом'))
  return [...primary, ...secondary]
}

// Вузли дерева з УСІХ завантажених файлів TechTree/*.json — label показує людську назву
// (Name), hint — сам Id (роздрук), бо Id часто не самопояснювальний.
export function collectNodeOptions(project: Project): ZpOption[] {
  const out: ZpOption[] = []
  for (const file of project.files) {
    if (file.kind !== 'techTree') continue
    const doc = file.parsed as { Nodes?: unknown[] } | undefined
    if (!doc || !Array.isArray(doc.Nodes)) continue
    for (const raw of doc.Nodes) {
      if (!raw || typeof raw !== 'object') continue
      const n = raw as Record<string, unknown>
      if (typeof n.Id !== 'string' || n.Id === '') continue
      const name = typeof n.Name === 'string' && n.Name ? n.Name : n.Id
      out.push({ id: n.Id, label: name, hint: n.Id })
    }
  }
  return out
}

// Фракції з Factions.json — label показує DisplayName, hint — Id.
export function collectFactionOptions(project: Project): ZpOption[] {
  const file = project.files.find((f) => f.kind === 'factions')
  const doc = file?.parsed as { Factions?: unknown[] } | undefined
  if (!doc || !Array.isArray(doc.Factions)) return []
  const out: ZpOption[] = []
  for (const raw of doc.Factions) {
    if (!raw || typeof raw !== 'object') continue
    const f = raw as Record<string, unknown>
    if (typeof f.Id !== 'string' || f.Id === '') continue
    const name = typeof f.DisplayName === 'string' && f.DisplayName ? f.DisplayName : f.Id
    out.push({ id: f.Id, label: name, hint: f.Id })
  }
  return out
}

// ---- Вхід аналізатора: обмеження пікера ДО того, що фактично виробляється (W2.6 Task 4) --
//
// «Аналізатор» (model/stationView.ts StationRoles.analyzer) визначається СТРУКТУРНО: правило,
// чий InputItem.Classname — клас родини ZP_Sample_Base. Для такого правила вільний вибір
// InputItem.Classname/Content з усього ClassIndex не має сенсу — станція фізично не отримає
// нічого, крім того, що РЕАЛЬНО пакує хоч один увімкнений і налаштований пакувальник
// (stationView.ProducedStream, той самий список, що вже гейтить полотно ланцюга від
// dead-end-аналізаторів). Вибір "аналізатор чи ні" — НЕ прапорець у JSON (RULE_SCHEMA його
// не має і не повинен), тому це derived-значення, а не поле форми.
//
// Тристанний override (не проста OR-функція, застосована НАЖИВО щорендеру) — свідомий вибір
// UX: якщо "аналізатор" було б чистим `streamToggle || isSampleClass(...)`, увімкнений
// перемикач НІКОЛИ не зміг би повернути рядок, чий клас УЖЕ належить родині ZP_Sample_Base,
// назад до вільного вводу — OR завжди перемагав би структурним боком. У цього редактора
// НЕМАЄ запасного шляху "правити JSON руками" для звичайного (не дубль-Id) рядка форми
// (дублі Id — єдине місце, де форма свідомо відсилає до ручного JSON, дивись повідомлення
// нижче) — тож глухий кут був би реальним, не теоретичним. override=null означає "ще не
// займали, слідувати структурі"; admin, що клацнув чекбокс, ЯВНО перемикає в БУДЬ-ЯКИЙ бік
// (checked завжди відображає ПОТОЧНИЙ ефективний стан — onChange пише саме те, що адмін
// щойно обрав, у override).
export function resolveAnalyzerInputMode(classname: string, index: ClassIndex, override: boolean | null): boolean {
  if (override !== null) return override
  return isSampleClass(index, classname)
}

// Роздільник composite-id пікера потоку — той самий НУЛЬ-байт і те саме обґрунтування, що
// вже задокументовано над streamsByKey у model/stationView.ts: звичайний пробіл/порожній
// рядок-роздільник міг би дати колізію ('ab'+'c d' проти 'ab c'+'d'), нуль-байт — ні
// (обидва боки — звичайний ігровий текст без керівних символів).
const STREAM_OPTION_SEP = '\u0000'

export function encodeStreamOptionId(classname: string, content: string): string {
  return `${classname}${STREAM_OPTION_SEP}${content}`
}

export function decodeStreamOptionId(id: string): { classname: string; content: string } {
  const sep = id.indexOf(STREAM_OPTION_SEP)
  if (sep < 0) return { classname: id, content: '' } // захист: сторонній value без роздільника (не мало б статись через ZpSelect)
  return { classname: id.slice(0, sep), content: id.slice(sep + STREAM_OPTION_SEP.length) }
}

// Опції обмеженого пікера входу аналізатора — РІВНО stationView.producedStreams (жодного
// вільного вводу, жодного повного ClassIndex): label — ігрове ім'я (+ Content у дужках, той
// самий патерн, що зведення "→ що дає" у StationWindow.tsx), hint — моно класнейм+вміст
// (роздрук, DESIGN.md §4) для адмінів, які думають класнеймами.
export function collectProducedStreamOptions(streams: ProducedStream[]): ZpOption[] {
  return streams.map((s) => ({
    id: encodeStreamOptionId(s.classname, s.content),
    label: s.content ? `${s.display} (${s.content})` : s.display,
    hint: s.content ? `${s.classname} · ${s.content}` : s.classname,
  }))
}

// ---- Дрібні поля форми ------------------------------------------------------------------
// Експортовані (W3 Task 3): панель вузла дерева (ui/TreeNodePanel.tsx) використовує ТУ САМУ
// машинерію полів — спільні компоненти, не другу копію (вимога брифа «паттерни, не
// копіпаста» виконана буквально: копії немає взагалі).

export function FieldMessages({ errors }: { errors: FieldError[] }) {
  if (errors.length === 0) return null
  return (
    <div className="field-messages">
      {errors.map((e, i) => (
        <p key={i} className={`field-message field-message-${e.severity}`}>
          <span className={`lamp lamp-${e.severity}`} aria-hidden="true" />
          {e.message}
        </p>
      ))}
    </div>
  )
}

export function TextField({
  id,
  label,
  value,
  onCommit,
  mono,
}: {
  id: string
  label: string
  value: string
  onCommit: (v: string) => void
  mono?: boolean
}) {
  return (
    <div className="rule-field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={`field-input${mono ? ' field-input-mono' : ''}`}
        type="text"
        value={value}
        onChange={(e) => onCommit(e.target.value)}
      />
    </div>
  )
}

// Числові поля тримають ЛОКАЛЬНИЙ буфер тексту, поки в фокусі (щоб проміжне "0." чи "-"
// не зривалось на кожен натиск клавіші), і комітять КВАНТОВАНЕ float32/ціле значення на
// blur — саме та вимога брифа "показувати те, що реально збережеться": відображуваний
// текст поза фокусом ЗАВЖДИ канонічний друк рушія (fmtFloat), той самий рядок, який
// потрапить у файл. Той самий патерн, що query/findLabelFor у ZpSelect.tsx.
// Експортовано (W4 Task 3): вкладка «Модулі» (ui/ModulesView.tsx) використовує ТОЙ САМИЙ
// fround-канон бонуса чистоти — спільний компонент, не друга копія.
export function FloatField({
  id,
  label,
  value,
  onCommit,
  errors,
}: {
  id: string
  label: string
  value: number
  onCommit: (v: number) => void
  errors?: FieldError[]
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(() => fmtFloat(value))
  useEffect(() => {
    if (!editing) setText(fmtFloat(value))
  }, [value, editing])
  return (
    <div className="rule-field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="field-input field-input-mono"
        type="text"
        inputMode="decimal"
        value={text}
        onFocus={() => setEditing(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setEditing(false)
          const n = Number(text)
          if (Number.isFinite(n)) onCommit(Math.fround(n))
        }}
      />
      {errors && <FieldMessages errors={errors} />}
    </div>
  )
}

// errors — необовʼязковий додаток закривної хвилі W4: межі Quantity [1..100] сервер
// перевіряє САМ (ZP_ProcessingConfig.c:297-298/:306-307/:330-331) і на порушенні викидає
// ВСЕ правило, тож повідомлення мусить стояти РІВНО біля поля, як це вже зроблено у
// FloatField. Наявні виклики без пропа не змінюються.
export function IntField({
  id,
  label,
  value,
  onCommit,
  min,
  errors,
}: {
  id: string
  label: string
  value: number
  onCommit: (v: number) => void
  min?: number
  errors?: FieldError[]
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(() => String(value))
  useEffect(() => {
    if (!editing) setText(String(value))
  }, [value, editing])
  return (
    <div className="rule-field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="field-input field-input-mono"
        type="text"
        inputMode="numeric"
        value={text}
        onFocus={() => setEditing(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setEditing(false)
          const n = Math.trunc(Number(text))
          if (Number.isFinite(n)) onCommit(min !== undefined ? Math.max(min, n) : n)
        }}
      />
      {errors && <FieldMessages errors={errors} />}
    </div>
  )
}

// Експортовано (W4 Task 4): вкладка «Налаштування» (ui/SettingsView.tsx) використовує ТОЙ
// САМИЙ чекбокс для DebugMode — спільний компонент, не четверта копія (прецедент FloatField
// у T3: «спільні компоненти, не копія»).
export function CheckboxField({
  id,
  label,
  checked,
  onCommit,
  title,
}: {
  id: string
  label: string
  checked: boolean
  onCommit: (v: boolean) => void
  title?: string
}) {
  return (
    <label className="rule-checkbox" htmlFor={id} title={title}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onCommit(e.target.checked)} />
      {label}
    </label>
  )
}

// Список рядків-класнеймів (RequiredFactions/RequiredWorn/RequiredTools) — уніфікований
// add/remove редактор поверх ZpSelect.
export function StringListEditor({
  items,
  onAdd,
  onRemove,
  onChangeItem,
  options,
  optionsSource,
  allowFree,
  ariaLabel,
  itemErrors,
}: {
  items: string[]
  onAdd: () => void
  onRemove: (i: number) => void
  onChangeItem: (i: number, value: string) => void
  options?: ZpOption[]
  optionsSource?: (q: string, limit: number) => ZpOption[]
  allowFree?: boolean
  ariaLabel: string
  // W4 Task 3 (вкладка «Фракції»): пер-рядкові повідомлення дзеркал (конфлікт нашивки,
  // клас поза індексом) — необовʼязковий додаток, наявні виклики без нього не змінюються.
  itemErrors?: (i: number) => FieldError[]
}) {
  return (
    <div className="rule-array">
      {items.map((v, i) => (
        <div className="rule-array-item" key={i}>
          <div className="rule-array-row">
            <ZpSelect
              value={v}
              onChange={(nv) => onChangeItem(i, nv)}
              options={options}
              optionsSource={optionsSource}
              allowFree={allowFree}
              aria-label={`${ariaLabel} ${i + 1}`}
            />
            <button type="button" className="rule-array-remove" onClick={() => onRemove(i)} aria-label={`Прибрати ${ariaLabel} ${i + 1}`}>
              ×
            </button>
          </div>
          {itemErrors && <FieldMessages errors={itemErrors(i)} />}
        </div>
      ))}
      <button type="button" className="rule-array-add" onClick={onAdd}>
        + Додати
      </button>
    </div>
  )
}

// ---- Пропси й головний компонент --------------------------------------------------------

// W2.6 Task 3: колишня бічна панель RulePanel (aside + стан вибору ChainSelection, який
// після двудольного полотна T2 ніхто вже не встановлював) стала ВБУДОВУВАНОЮ формою
// RuleForm: правка правила живе в розгорнутому рядку вікна станка (ui/StationWindow.tsx).
// Машинерія полів/валідації/авто-Content — ТА САМА, жодного форку логіки: змінились лише
// пропси (filePath+ruleId напряму замість selection) і обгортка (без aside/sheet —
// обгортку дає рядок вікна станка).
export interface RuleFormProps {
  project: Project
  index: ClassIndex
  filePath: string
  ruleId: string
  onProjectChange: (next: Project) => void
  // Викликається ЛИШЕ коли міняється сам Id правила (переіменування) -- розгорнутий
  // рядок вікна станка мусить піти за новим Id, інакше наступний рендер шукав би СТАРИЙ
  // ruleId і показав би щойно відредаговане правило як "не знайдено". Для решти полів
  // filePath+ruleId не змінюється -- цей колбек не викликається.
  onRuleIdChange?: (newId: string) => void
  // W2.6 Task 4: проєкт-широкий список ФАКТИЧНО вироблюваних потоків (stationView.
  // producedStreams, той самий об'єкт, що вже гейтить полотно ланцюга від dead-end-
  // аналізаторів) -- джерело обмеженого пікера входу аналізатора нижче. StationWindow
  // рахує buildStationView РІВНО ОДИН РАЗ на рендер і передає сюди готовий масив --
  // друга копія buildStationView тут була б саме тим дрейфом двох копій, якого весь цей
  // кодекс свідомо уникає (той самий принцип, що matchClassMirror/MULTI_FILE_DIRS).
  producedStreams: ProducedStream[]
}

export function RuleForm({ project, index, filePath, ruleId, onProjectChange, onRuleIdChange, producedStreams }: RuleFormProps) {
  // Override пікера входу аналізатора (W2.6 Task 4) -- ТРИСТАННИЙ, дивись коментар над
  // resolveAnalyzerInputMode вище. useState(null) на КОЖНОМУ монтуванні -- і це коректно:
  // RuleForm повністю розмонтовується/монтується заново при перемиканні НА ІНШИЙ рядок
  // вікна станка (кожен рядок -- окремий <li>, лише ОДИН розгорнутий одночасно,
  // StationWindow.tsx), тож витоку стану між правилами немає (той самий Т9-урок, що вже
  // застосований у ключі StationWindow-монтування станка).
  const [analyzerModeOverride, setAnalyzerModeOverride] = useState<boolean | null>(null)
  const producedStreamOptions = useMemo(() => collectProducedStreamOptions(producedStreams), [producedStreams])
  // ОДНА стабільна функція на index (він і так кешований loadClassIndex-синглтон — це
  // посилання практично ніколи не змінюється) обслуговує ВСІ ZpSelect-поля класів у
  // формі. Застереження брифа: inline-лямбда, пересворювана щорендеру, зайво тригерить
  // внутрішні мемо ZpSelect/React.
  const classOptionsSource = useMemo(
    () =>
      (query: string, limit: number): ZpOption[] =>
        searchClasses(index, query, limit).map((hit) => ({ id: hit.name, label: hit.name, hint: hit.mod })),
    [index],
  )
  const contentOptions = useMemo(() => collectContentOptions(project, index), [project, index])
  const nodeOptions = useMemo(() => collectNodeOptions(project), [project])
  const factionOptions = useMemo(() => collectFactionOptions(project), [project])

  const matches = findRuleMatches(project, filePath, ruleId)

  if (matches.length === 0) {
    // Розгорнутий рядок пережив саме правило (напр. видалено з іншого місця) -- чесне
    // повідомлення замість порожньої форми; вікно станка саме згорне рядок наступним
    // перерахунком buildStationView.
    return (
      <p className="indicator" role="status">
        <span className="lamp lamp-warn" aria-hidden="true" />
        Правило «{ruleId}» не знайдено у {filePath} — можливо, видалено.
      </p>
    )
  }

  const duplicate = matches.length > 1
  const rule = matches[0] as unknown as RuleRecord
  const errors = duplicate ? [] : validateRule(rule, index)

  // W2.6 Task 4: чи показувати обмежений пікер "вхід із потоку" замість вільного класу +
  // окремого поля Content -- resolveAnalyzerInputMode вище (тристанний override поверх
  // структурного isSampleClass). streamFieldValue -- значення combobox: якщо ПОТОЧНА пара
  // (Classname, Content) правила збігається з якимось РЕАЛЬНИМ виробленим потоком --
  // показуємо саме його ласкаву мітку (через власний findLabelFor у ZpSelect); інакше --
  // читабельний fallback (Content, якщо є, бо саме він розрізняє потоки одного класу,
  // інакше сам класнейм) НІКОЛИ сирий id з нуль-байтом-роздільником -- те, що адмін
  // побачив би в полі, поки нічого не обрано зі списку.
  const analyzerMode = resolveAnalyzerInputMode(rule.InputItem.Classname, index, analyzerModeOverride)
  const currentStreamId = encodeStreamOptionId(rule.InputItem.Classname, rule.InputItem.Content)
  const matchedStreamOption = producedStreamOptions.find((o) => o.id === currentStreamId)
  const streamFieldValue = matchedStreamOption ? matchedStreamOption.id : rule.InputItem.Content || rule.InputItem.Classname

  function commit(updater: (r: Record<string, unknown>) => void) {
    const result = applyRuleEdit(project, filePath, ruleId, updater)
    // ok:false тут означало б дубль/зникле правило -- форма вже дизейблена fieldset'ом при
    // duplicate=true, а filePath+ruleId завжди вказують на щойно знайдене правило, тож на
    // практиці ця гілка не спрацьовує; мовчазна відмова безпечніша за виняток посеред кліку.
    if (result.ok) onProjectChange(result.project)
  }

  // Переіменування Id -- ЄДИНЕ поле, що змінює сам ключ рядка. commit() вище шукає
  // правило за СТАРИМ ruleId (він і має лишитись коректним ключем У ЦЕЙ МОМЕНТ --
  // застосовується ДО перейменування), тому звичайний applyRuleEdit підходить для самого
  // запису; окремо після успіху повідомляємо викликача, що розгорнутий рядок має піти за
  // новим Id.
  function commitId(newId: string) {
    const result = applyRuleEdit(project, filePath, ruleId, (r) => {
      r.Id = newId
    })
    if (result.ok) {
      onProjectChange(result.project)
      onRuleIdChange?.(newId)
    }
  }

  // Спільне тіло commitInputClassname/commitInputFromStream (W2.6 Task 4 винесення) --
  // ОБИДВА шляхи змінюють InputItem.Classname і мусять каскадом підхопити КОЖЕН вихід-
  // зразок, що й досі "авто" (той самий коментар-директива, що був тут раніше). Другий
  // шлях (пікер потоку) додатково пише Content АТОМАРНО в ТІЙ САМІЙ мутації -- "комітити
  // узгоджено обидва поля" з брифа означає саме одну мутацію applyRuleEdit, а не дві
  // послідовні (друга виглядала б як окремий крок історії й могла б лишити проміжний
  // неузгоджений стан, якби форма впала між ними).
  function applyInputClassnameChange(r: Record<string, unknown>, newClassname: string, newContent?: string) {
    const input = r.InputItem as Record<string, unknown>
    const prevAuto = input.Classname as string
    input.Classname = newClassname
    if (newContent !== undefined) input.Content = newContent
    for (const o of (r.Outputs as Record<string, unknown>[]) ?? []) {
      if (isSampleClass(index, o.Classname as string)) {
        o.Content = deriveOutputContent(o.Content as string, prevAuto, newClassname)
      }
    }
  }

  function commitInputClassname(newValue: string) {
    commit((r) => applyInputClassnameChange(r, newValue))
  }

  // Обраний варіант обмеженого пікера входу аналізатора (W2.6 Task 4) -- id кодує ОБИДВА
  // поля (encodeStreamOptionId), decodeStreamOptionId розпаковує назад; Classname і Content
  // пишуться ОДНІЄЮ мутацією через applyInputClassnameChange вище.
  function commitInputFromStream(streamId: string) {
    const { classname, content } = decodeStreamOptionId(streamId)
    commit((r) => applyInputClassnameChange(r, classname, content))
  }

  function commitOutputClassname(i: number, newValue: string) {
    commit((r) => {
      const outputs = r.Outputs as Record<string, unknown>[]
      const row = outputs[i]
      row.Classname = newValue
      const inputClassname = (r.InputItem as Record<string, unknown>).Classname as string
      // Рядок ЩОЙНО став зразком (чи ним і був) І його вміст і досі авто відносно
      // ПОТОЧНОГО InputItem.Classname -- негайно підхопити (найтиповіший випадок: новий
      // рядок, Content=='' ще не мав шансу пройти каскад InputItem-зміни взагалі).
      if (isSampleClass(index, newValue) && isAutoContent(row.Content as string, inputClassname)) {
        row.Content = inputClassname
      }
    })
  }

  function resetOutputContentToAuto(i: number) {
    commit((r) => {
      const outputs = r.Outputs as Record<string, unknown>[]
      outputs[i].Content = (r.InputItem as Record<string, unknown>).Classname as string
    })
  }

  function addConsumable() {
    commit((r) => {
      ;(r.Consumables as unknown[]).push({ Classname: '', Quantity: 1, Content: '' })
    })
  }
  function removeConsumable(i: number) {
    commit((r) => {
      ;(r.Consumables as unknown[]).splice(i, 1)
    })
  }
  function commitConsumableField(i: number, field: 'Classname' | 'Content', value: string) {
    commit((r) => {
      ;(r.Consumables as Record<string, unknown>[])[i][field] = value
    })
  }
  function commitConsumableQuantity(i: number, value: number) {
    commit((r) => {
      ;(r.Consumables as Record<string, unknown>[])[i].Quantity = value
    })
  }

  function addOutput() {
    commit((r) => {
      ;(r.Outputs as unknown[]).push({ Classname: '', Quantity: 1, Chance: 1, Content: '' })
    })
  }
  function removeOutput(i: number) {
    commit((r) => {
      ;(r.Outputs as unknown[]).splice(i, 1)
    })
  }
  function commitOutputQuantity(i: number, value: number) {
    commit((r) => {
      ;(r.Outputs as Record<string, unknown>[])[i].Quantity = value
    })
  }
  function commitOutputChance(i: number, value: number) {
    commit((r) => {
      ;(r.Outputs as Record<string, unknown>[])[i].Chance = value
    })
  }
  function commitOutputContent(i: number, value: string) {
    commit((r) => {
      ;(r.Outputs as Record<string, unknown>[])[i].Content = value
    })
  }

  function stringArrayHandlers(field: 'RequiredFactions' | 'RequiredWorn' | 'RequiredTools') {
    return {
      onAdd: () =>
        commit((r) => {
          ;(r[field] as string[]).push('')
        }),
      onRemove: (i: number) =>
        commit((r) => {
          ;(r[field] as string[]).splice(i, 1)
        }),
      onChangeItem: (i: number, v: string) =>
        commit((r) => {
          ;(r[field] as string[])[i] = v
        }),
    }
  }

  const requiredFactionsHandlers = stringArrayHandlers('RequiredFactions')
  const requiredWornHandlers = stringArrayHandlers('RequiredWorn')
  const requiredToolsHandlers = stringArrayHandlers('RequiredTools')

  return (
    <>
      {duplicate && (
        <p className="indicator alarm" role="alert">
          <span className="lamp lamp-alarm" aria-hidden="true" />
          Дублікат Id у файлі «{filePath}» — виправте вручну (JSON); форма нижче лише для перегляду.
        </p>
      )}
      {/* НЕ key={filePath+ruleId} (ні тут, ні у викликача-StationWindow): перейменування
          Id (commitId) саме собою змінює ruleId на КОЖНЕ натискання клавіші --
          remount-за-ключем зняв би фокус з поля Id після першого ж символу. Замість цього
          FloatField/IntField самі підхоплюють зовнішню зміну value ефектом (той самий
          патерн, що query/value в ZpSelect.tsx) -- при перемиканні на ІНШИЙ рядок вікна
          станка локальні буфери досинхронізуються на наступному рендері. */}
      <fieldset className="rule-form" disabled={duplicate}>
        <TextField id="rp-id" label="Id" value={rule.Id} onCommit={commitId} mono />
        <CheckboxField id="rp-enabled" label="Увімкнено" checked={rule.Enabled} onCommit={(v) => commit((r) => (r.Enabled = v))} />

        <div className="rule-field">
          <label className="field-label" htmlFor="rp-device">
            Прилад (Device)
          </label>
          <ZpSelect id="rp-device" value={rule.Device} onChange={(v) => commit((r) => (r.Device = v))} optionsSource={classOptionsSource} allowFree aria-label="Прилад" />
          <FieldMessages errors={fieldErrors(errors, 'Device')} />
        </div>

        <div className="rule-field">
          <span className="field-label">Режим</span>
          <p className="field-readonly" title="Єдиний підтримуваний режим — фонова станція (рішення власника 2026-08-03): переробка з рук прибрана разом із польовими інструментами">
            {rule.Mode || 'background'}
          </p>
        </div>

        <fieldset className="rule-group">
          <legend className="field-label">Вхід (InputItem)</legend>

          {/* W2.6 Task 4: "аналізатор" -- структурно (поточний Classname уже родини
              ZP_Sample_Base) АБО адмін явно попросив -- у цьому режимі пікер нижче
              обмежується РЕАЛЬНО виробленими потоками (жодного вільного вводу). checked
              завжди показує ЕФЕКТИВНИЙ стан (resolveAnalyzerInputMode), onChange пише
              ЯВНИЙ override у БУДЬ-ЯКИЙ бік -- інакше структурно-зразковий рядок ніколи
              не зміг би повернутись до вільного вводу (у формі немає запасного шляху
              "правте JSON руками" для звичайного рядка -- лише для дубля Id вище). */}
          <CheckboxField
            id="rp-input-stream-mode"
            label="Вхід із потоку (аналізатор)"
            checked={analyzerMode}
            onCommit={(v) => setAnalyzerModeOverride(v)}
            title="Обмежує сировину лише тим, що ФАКТИЧНО виробляє хоч один увімкнений і налаштований пакувальник -- той самий список потоків, що вже захищає полотно ланцюга від глухих кутів аналізатора"
          />

          {analyzerMode ? (
            <div className="rule-field">
              <label className="field-label" htmlFor="rp-input-stream">
                Сировина (з потоку)
              </label>
              <ZpSelect
                id="rp-input-stream"
                value={streamFieldValue}
                onChange={commitInputFromStream}
                options={producedStreamOptions}
                aria-label="Сировина (з потоку), вхід аналізатора"
                placeholder={producedStreamOptions.length === 0 ? 'ще жоден пакувальник нічого не виробляє' : 'почніть вводити…'}
              />
              <FieldMessages errors={fieldErrors(errors, 'InputItem.Classname')} />
            </div>
          ) : (
            <div className="rule-field">
              <label className="field-label" htmlFor="rp-input-classname">
                Класнейм сировини
              </label>
              <ZpSelect
                id="rp-input-classname"
                value={rule.InputItem.Classname}
                onChange={commitInputClassname}
                optionsSource={classOptionsSource}
                allowFree
                aria-label="Класнейм сировини"
              />
              <FieldMessages errors={fieldErrors(errors, 'InputItem.Classname')} />
            </div>
          )}

          <IntField
            id="rp-input-qty"
            label="Кількість"
            value={rule.InputItem.Quantity}
            min={1}
            onCommit={(v) => commit((r) => ((r.InputItem as Record<string, unknown>).Quantity = v))}
            errors={fieldErrors(errors, 'InputItem.Quantity')}
          />
          <div className="rule-field">
            <CheckboxField
              id="rp-input-consume"
              label="Списувати вхід (ConsumeInput)"
              checked={rule.InputItem.ConsumeInput}
              onCommit={(v) => commit((r) => ((r.InputItem as Record<string, unknown>).ConsumeInput = v))}
            />
            <FieldMessages errors={fieldErrors(errors, 'InputItem.ConsumeInput')} />
          </div>

          {/* Content входу -- ЛИШЕ у вільному режимі: у режимі "з потоку" combobox вище
              вже пише Classname+Content ОДНІЄЮ мутацією (commitInputFromStream), окреме
              поле дублювало б той самий запис і плутало б, яке з двох щойно застосувалось. */}
          {!analyzerMode && (
            <div className="rule-field">
              <label className="field-label" htmlFor="rp-input-content" title="Зберігається як звичайний рядок Content — має сенс лише коли Класнейм сировини є зразком (ZP_Sample)">
                Сировина (вміст зразка)
              </label>
              <ZpSelect
                id="rp-input-content"
                value={rule.InputItem.Content}
                onChange={(v) => commit((r) => ((r.InputItem as Record<string, unknown>).Content = v))}
                options={contentOptions}
                allowFree
                aria-label="Сировина (вміст зразка), вхід"
              />
              {/* Закривна хвиля W4: Content має сенс ЛИШЕ у зразка — на будь-якому іншому
                  класі сервер відкидає правило цілком (ValidateContent :369-370), плюс межі
                  довжини/пробілів. Поле показується завжди, тож і повідомлення мусить бути. */}
              <FieldMessages errors={fieldErrors(errors, 'InputItem.Content')} />
            </div>
          )}
        </fieldset>

        <FloatField id="rp-purity-min" label="Чистота, мін (BasePurityMin)" value={rule.BasePurityMin} onCommit={(v) => commit((r) => (r.BasePurityMin = v))} errors={fieldErrors(errors, 'BasePurityMin')} />
        <FloatField id="rp-purity-max" label="Чистота, макс (BasePurityMax)" value={rule.BasePurityMax} onCommit={(v) => commit((r) => (r.BasePurityMax = v))} errors={fieldErrors(errors, 'BasePurityMax')} />
        <FloatField id="rp-time" label="Тривалість, с (TimeSec)" value={rule.TimeSec} onCommit={(v) => commit((r) => (r.TimeSec = v))} errors={fieldErrors(errors, 'TimeSec')} />

        <fieldset className="rule-group">
          <legend className="field-label">Витратні (Consumables)</legend>
          {rule.Consumables.map((c, i) => (
            <div className="rule-row-card" key={i}>
              <div className="rule-field">
                <label className="field-label" htmlFor={`rp-cons-cls-${i}`}>
                  Класнейм
                </label>
                <ZpSelect
                  id={`rp-cons-cls-${i}`}
                  value={c.Classname}
                  onChange={(v) => commitConsumableField(i, 'Classname', v)}
                  optionsSource={classOptionsSource}
                  allowFree
                  aria-label={`Витратний ${i + 1}: класнейм`}
                />
                <FieldMessages errors={fieldErrors(errors, `Consumables[${i}].Classname`)} />
              </div>
              <IntField
                id={`rp-cons-qty-${i}`}
                label="Кількість"
                value={c.Quantity}
                min={1}
                onCommit={(v) => commitConsumableQuantity(i, v)}
                errors={fieldErrors(errors, `Consumables[${i}].Quantity`)}
              />
              <div className="rule-field">
                <label className="field-label" htmlFor={`rp-cons-content-${i}`} title="Зберігається як звичайний рядок Content">
                  Сировина (вміст зразка)
                </label>
                <ZpSelect
                  id={`rp-cons-content-${i}`}
                  value={c.Content}
                  onChange={(v) => commitConsumableField(i, 'Content', v)}
                  options={contentOptions}
                  allowFree
                  aria-label={`Витратний ${i + 1}: вміст зразка`}
                />
                <FieldMessages errors={fieldErrors(errors, `Consumables[${i}].Content`)} />
              </div>
              <button type="button" className="rule-array-remove" onClick={() => removeConsumable(i)} aria-label={`Прибрати витратний ${i + 1}`}>
                × Прибрати
              </button>
            </div>
          ))}
          <button type="button" className="rule-array-add" onClick={addConsumable}>
            + Додати витратний
          </button>
        </fieldset>

        <fieldset className="rule-group">
          <legend className="field-label">Виходи (Outputs)</legend>
          {rule.Outputs.map((o, i) => {
            const sample = isSampleClass(index, o.Classname)
            const auto = isAutoContent(o.Content, rule.InputItem.Classname)
            return (
              <div className="rule-row-card" key={i}>
                <div className="rule-field">
                  <label className="field-label" htmlFor={`rp-out-cls-${i}`}>
                    Класнейм
                  </label>
                  <ZpSelect
                    id={`rp-out-cls-${i}`}
                    value={o.Classname}
                    onChange={(v) => commitOutputClassname(i, v)}
                    optionsSource={classOptionsSource}
                    allowFree
                    aria-label={`Вихід ${i + 1}: класнейм`}
                  />
                  <FieldMessages errors={fieldErrors(errors, `Outputs[${i}].Classname`)} />
                </div>
                <IntField
                  id={`rp-out-qty-${i}`}
                  label="Кількість"
                  value={o.Quantity}
                  min={1}
                  onCommit={(v) => commitOutputQuantity(i, v)}
                  errors={fieldErrors(errors, `Outputs[${i}].Quantity`)}
                />
                <FloatField
                  id={`rp-out-chance-${i}`}
                  label="Шанс (Chance)"
                  value={o.Chance}
                  onCommit={(v) => commitOutputChance(i, v)}
                  errors={fieldErrors(errors, `Outputs[${i}].Chance`)}
                />
                {/* Закривна хвиля W4: поле показуємо ще й тоді, коли клас НЕ зразок, але
                    Content усе одно непорожній — інакше правило, приїхале з чужого файлу
                    (чи після зміни класнейму виходу), несло б фатальний для сервера рядок
                    (ValidateContent :369-370), а прибрати його в редакторі не було б де:
                    запасного шляху «правте JSON руками» для звичайного рядка форми немає. */}
                {(sample || o.Content !== '') && (
                  <div className="rule-field">
                    <div className="field-label-row">
                      <label className="field-label" htmlFor={`rp-out-content-${i}`} title="Зберігається як звичайний рядок Content — авто-похідне з класнейму сировини (директива власника)">
                        Вміст зразка
                      </label>
                      {auto ? (
                        <span className="content-auto-badge" title="Підхоплює зміну класнейму сировини автоматично">
                          авто
                        </span>
                      ) : (
                        <span className="content-manual-badge">
                          ручне значення
                          <button type="button" className="content-reset-btn" onClick={() => resetOutputContentToAuto(i)}>
                            повернути авто
                          </button>
                        </span>
                      )}
                    </div>
                    <ZpSelect
                      id={`rp-out-content-${i}`}
                      value={o.Content}
                      onChange={(v) => commitOutputContent(i, v)}
                      options={contentOptions}
                      allowFree
                      aria-label={`Вихід ${i + 1}: вміст зразка`}
                    />
                    <FieldMessages errors={fieldErrors(errors, `Outputs[${i}].Content`)} />
                  </div>
                )}
                <button type="button" className="rule-array-remove" onClick={() => removeOutput(i)} aria-label={`Прибрати вихід ${i + 1}`}>
                  × Прибрати
                </button>
              </div>
            )
          })}
          <button type="button" className="rule-array-add" onClick={addOutput}>
            + Додати вихід
          </button>
        </fieldset>

        <div className="rule-field">
          <label className="field-label" htmlFor="rp-required-node">
            Потрібен вузол дерева (RequiredNode)
          </label>
          <ZpSelect id="rp-required-node" value={rule.RequiredNode} onChange={(v) => commit((r) => (r.RequiredNode = v))} options={nodeOptions} allowFree aria-label="Потрібен вузол дерева" placeholder="без вимоги" />
        </div>

        <div className="rule-field">
          <span className="field-label">Потрібні фракції (RequiredFactions)</span>
          <StringListEditor items={rule.RequiredFactions} {...requiredFactionsHandlers} options={factionOptions} ariaLabel="Потрібна фракція" />
        </div>

        {/* itemErrors (закривна хвиля W4): порожній елемент цих двох списків сервер
            трактує як ФАТАЛЬНУ помилку правила (ZP_ProcessingConfig.c:287/292), а створює
            його кнопка «+ Додати» цієї ж форми — повідомлення мусить стояти РІВНО на тому
            рядку, який щойно додали, а не лише в переліку проблем рядка станка. */}
        <div className="rule-field">
          <span className="field-label">Потрібно надіто (RequiredWorn)</span>
          <StringListEditor
            items={rule.RequiredWorn}
            {...requiredWornHandlers}
            optionsSource={classOptionsSource}
            allowFree
            ariaLabel="Потрібно надіто"
            itemErrors={(i) => fieldErrors(errors, `RequiredWorn[${i}]`)}
          />
        </div>

        <div className="rule-field">
          <span className="field-label">Потрібні інструменти (RequiredTools)</span>
          <StringListEditor
            items={rule.RequiredTools}
            {...requiredToolsHandlers}
            optionsSource={classOptionsSource}
            allowFree
            ariaLabel="Потрібний інструмент"
            itemErrors={(i) => fieldErrors(errors, `RequiredTools[${i}]`)}
          />
        </div>

        <div className="rule-field">
          <label className="field-label" htmlFor="rp-notes">
            Нотатки
          </label>
          <textarea id="rp-notes" className="field-textarea" value={rule.Notes} onChange={(e) => commit((r) => (r.Notes = e.target.value))} rows={3} />
        </div>
      </fieldset>
    </>
  )
}
