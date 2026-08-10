// ZpSelect — випадний список із живим пошуком (W2 Task 3). Замінює будь-яке поле форми,
// що посилається на існуючу сутність (класнейм предмета, вузол дерева, тип балів,
// фракція, Content-мітка): звичайний <input>, підказка розкривається В МЕЖАХ ВІКНА
// (панель-аркуш під полем, не діалог), клавіатура працює без миші. Візуальна система —
// «Мнемосхема пульта» (DESIGN.md): усі кольори/шрифти/кроки з tokens.css, жодного нового
// літералу. Класнейми/Id (роль «роздрук») рендеряться моно-шрифтом за DESIGN.md §4.
//
// Два джерела опцій, обране викликачем (Task-бриф):
//   options       -- статичний масив, фільтрується локально чистою filterOptions()
//                     (вузли дерева, типи балів, фракції, Content-мітки -- малі списки).
//   optionsSource -- функція (query, limit) -> ZpOption[], сама відповідає за фільтрацію
//                     (класи предметів: обгортка над searchClasses із десятків тисяч
//                     записів реального індексу -- повторно фільтрувати вже відфільтроване
//                     було б зайвою роботою і розсинхроном пріоритету з isKindOf/MatchClass
//                     на сервері).

import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

export interface ZpOption {
  id: string
  label: string
  hint?: string
}

// filterOptions -- чиста функція (експортується для тестів, tests/zpselect.test.ts).
// Та сама схема пріоритету, що searchClasses (model/classIndex.ts), навмисно: адмін не
// повинен вчити дві різні логіки сортування для класів і для "маленьких" списків.
//   1. запит із самих пробілів/порожній -- перші `limit` без фільтрації (вихідний порядок);
//   2. інакше -- ДВА ЯРУСИ, кожен зі своїм префікс-пріоритетом:
//      ярус 1 (label): кейс-інсенситивний підрядок по label; префіксні збіги (pos===0)
//        йдуть ПЕРЕД підрядковими (pos>0);
//      ярус 2 (hint, W2.6 Task 4): опції, де label НЕ збігся, а `hint` (класнейм/додаткова
//        інформація -- адміни думають класнеймами, hint майже завжди і є класнейм) збігся --
//        та сама префікс/підрядок пара всередині ярусу. Ярус 2 йде ЦІЛКОМ ПІСЛЯ ярусу 1
//        (label-збіг завжди важливіший за hint-збіг), не змішується з ним у спільне
//        сортування -- саме тому це "другий ярус", а не "друге поле для того самого
//        порівняння". Опція без hint просто не потрапляє в ярус 2 (matchesHint нижче
//        зважає на це).
//      усередині кожної з чотирьох груп порядок стабільний (як у вхідному масиві -- єдиний
//      прохід, партиціонування без пересортування);
//   3. результат обрізається до `limit`.
export function filterOptions(options: ZpOption[], query: string, limit = 50): ZpOption[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return options.slice(0, limit)
  const labelPrefixHits: ZpOption[] = []
  const labelOtherHits: ZpOption[] = []
  const hintPrefixHits: ZpOption[] = []
  const hintOtherHits: ZpOption[] = []
  for (const opt of options) {
    const labelPos = opt.label.toLowerCase().indexOf(needle)
    if (labelPos === 0) {
      labelPrefixHits.push(opt)
      continue
    }
    if (labelPos > 0) {
      labelOtherHits.push(opt)
      continue
    }
    if (!opt.hint) continue
    const hintPos = opt.hint.toLowerCase().indexOf(needle)
    if (hintPos < 0) continue
    if (hintPos === 0) hintPrefixHits.push(opt)
    else hintOtherHits.push(opt)
  }
  return labelPrefixHits.concat(labelOtherHits, hintPrefixHits, hintOtherHits).slice(0, limit)
}

// Розбиває label на [до, збіг, після] за позицією ПЕРШОГО кейс-інсенситивного входження
// needle -- для підсвітки збігу в панелі (role="option"). needle порожній або не знайдений
// -> весь текст у першому фрагменті, збіг/хвіст порожні (компонент рендерить без <mark>).
function splitMatch(label: string, needle: string): [string, string, string] {
  if (!needle) return [label, '', '']
  const pos = label.toLowerCase().indexOf(needle.toLowerCase())
  if (pos < 0) return [label, '', '']
  return [label.slice(0, pos), label.slice(pos, pos + needle.length), label.slice(pos + needle.length)]
}

// ---- resolveKeyAction: чистий редюсер клавіатури (W3 Task 1, розминка) --------------------
// handleKeyDown нижче — замикання над React-станом (open/results/highlight/query/value),
// тому без DOM (jsdom/testing-library НЕ встановлені, vitest.environment='node' -- vite.config.ts)
// пряме тестування JSX-компонента неможливе. Винесено ЧИСТИЙ решта рішень "яка клавіша ->
// яка дія" у функцію без React/DOM (дозволено брифом: "exporting a testable pure reducer
// ... is an acceptable refactor if behavior-identical") -- handleKeyDown нижче лише виконує
// повернуту дію через ті самі setOpen/setHighlight/setQuery/onChange, що й раніше, БУКВАЛЬНО
// в тому самому порядку викликів. Жодної зміни поведінки, лише перенесення "де" рішення
// приймається.
//
// moveHighlight -- та сама формула, що була inline: `(h +/- 1 + results.length) %
// results.length`, з окремим правилом "0 результатів -> завжди 0" (uncircularizable modulo).
export function moveHighlight(current: number, delta: 1 | -1, resultsLength: number): number {
  if (resultsLength === 0) return 0
  return (current + delta + resultsLength) % resultsLength
}

export type ZpSelectKeyAction =
  | { type: 'none' } // клавіша не обробляється: disabled, невідома клавіша, або Enter/Escape при закритій панелі
  | { type: 'openPanel' } // ArrowDown/ArrowUp при закритій панелі
  | { type: 'highlight'; highlight: number } // ArrowDown/ArrowUp при відкритій панелі
  | { type: 'commit'; option: ZpOption } // Enter, results[highlight] існує
  | { type: 'commitFree'; text: string } // Enter-fallback, allowFree і набраний текст відрізняється від value
  | { type: 'revertQuery' } // Enter-fallback БЕЗ allowFree-збігу, АБО Escape -- обидва відкочують query

export interface ZpSelectKeyContext {
  disabled: boolean
  open: boolean
  key: string
  highlight: number
  results: ZpOption[]
  query: string
  value: string
  allowFree: boolean
}

// commitOrRevert (inline-функція компонента) як чиста гілка рішення -- викликається лише
// з гілки Enter-fallback (results[highlight] відсутній), той самий порядок перевірок:
// trim -> allowFree && непорожньо && відрізняється від value -> commitFree, інакше revert.
function resolveCommitOrRevert(ctx: Pick<ZpSelectKeyContext, 'query' | 'allowFree' | 'value'>): ZpSelectKeyAction {
  const trimmed = ctx.query.trim()
  if (ctx.allowFree && trimmed && trimmed !== ctx.value) {
    return { type: 'commitFree', text: trimmed }
  }
  return { type: 'revertQuery' }
}

// resolveKeyAction -- ПОБАЙТОВЕ дзеркало гілок колишнього handleKeyDown (порядок if/else-if,
// умови "!open -> return" усередині кожної гілки). preventDefault НЕ несеться дією явним
// полем -- похідна властивість (action.type !== 'none'), точно як у оригіналі: preventDefault()
// викликається в КОЖНІЙ гілці, що дійшла до діла (ArrowDown/Up -- завжди; Enter/Escape --
// лише коли панель відкрита), і НІКОЛИ, коли гілка не спрацювала (disabled/невідома
// клавіша/Enter-Escape на закритій панелі).
export function resolveKeyAction(ctx: ZpSelectKeyContext): ZpSelectKeyAction {
  if (ctx.disabled) return { type: 'none' }
  if (ctx.key === 'ArrowDown' || ctx.key === 'ArrowUp') {
    if (!ctx.open) return { type: 'openPanel' }
    const delta = ctx.key === 'ArrowDown' ? 1 : -1
    return { type: 'highlight', highlight: moveHighlight(ctx.highlight, delta, ctx.results.length) }
  }
  if (ctx.key === 'Enter') {
    if (!ctx.open) return { type: 'none' }
    const picked = ctx.results[ctx.highlight]
    if (picked) return { type: 'commit', option: picked }
    return resolveCommitOrRevert(ctx)
  }
  if (ctx.key === 'Escape') {
    if (!ctx.open) return { type: 'none' }
    return { type: 'revertQuery' }
  }
  return { type: 'none' }
}

export interface ZpSelectProps {
  value: string
  onChange: (value: string) => void
  options?: ZpOption[]
  optionsSource?: (query: string, limit: number) => ZpOption[]
  placeholder?: string
  allowFree?: boolean
  limit?: number
  id?: string
  'aria-label'?: string
  disabled?: boolean
}

// Знаходить опцію за id серед поточного видимого списку АБО (якщо не знайдена там --
// список могло вже відфільтрувати) повертає undefined; використовується лише для
// відображення label поточного value при монтуванні/зміні ззовні, не для валідації.
function findLabelFor(value: string, options: ZpOption[] | undefined, source: ((q: string, n: number) => ZpOption[]) | undefined): string {
  if (!value) return ''
  if (options) {
    const hit = options.find((o) => o.id === value)
    if (hit) return hit.label
  }
  if (source) {
    // Точковий пошук за самим значенням -- джерела (searchClasses) кейс-інсенситивні й
    // повертають точний збіг першим (пріоритет префікса на повному рядку == точний збіг).
    const hit = source(value, 5).find((o) => o.id.toLowerCase() === value.toLowerCase())
    if (hit) return hit.label
  }
  // allowFree: значення не знайдене в жодному джерелі -- показуємо як є (вільний текст).
  return value
}

let nextInstanceId = 0

export function ZpSelect(props: ZpSelectProps) {
  const { value, onChange, options, optionsSource, placeholder, allowFree = false, limit = 50, disabled = false } = props
  const instanceId = useRef(`zp-select-${++nextInstanceId}`).current
  const rootId = props.id ?? instanceId

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(() => findLabelFor(value, options, optionsSource))
  const [highlight, setHighlight] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  // Зовнішня зміна value (напр. вибір деінде у формі) -- підтягуємо відображуваний текст,
  // поки панель закрита (щоб не переписувати те, що адмін саме набирає).
  useEffect(() => {
    if (!open) setQuery(findLabelFor(value, options, optionsSource))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const needle = open ? query : ''
  const results = useMemo<ZpOption[]>(() => {
    if (!open) return []
    if (optionsSource) return optionsSource(query, limit)
    return filterOptions(options ?? [], query, limit)
  }, [open, query, options, optionsSource, limit])

  // Клік поза компонентом закриває панель без зміни value (як Esc), окрім allowFree, де
  // вільний текст комітиться -- адмін очікує, що набране приймається, а не зникає.
  useEffect(() => {
    if (!open) return
    function onDocPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        commitOrRevert()
      }
    }
    document.addEventListener('mousedown', onDocPointerDown)
    return () => document.removeEventListener('mousedown', onDocPointerDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, results])

  function openPanel() {
    if (disabled) return
    setOpen(true)
    setHighlight(0)
  }

  function commit(opt: ZpOption) {
    onChange(opt.id)
    setQuery(opt.label)
    setOpen(false)
  }

  // Закриття без явного вибору зі списку: allowFree приймає набраний текст як є (класи
  // чужих модів поза індексом, довільні Content-мітки); інакше -- відкат до попереднього
  // committed value (не залишаємо форму в стані "не збігається жодна опція").
  function commitOrRevert() {
    const trimmed = query.trim()
    if (allowFree && trimmed && trimmed !== value) {
      onChange(trimmed)
    } else {
      setQuery(findLabelFor(value, options, optionsSource))
    }
    setOpen(false)
  }

  // Виконує дію resolveKeyAction -- ТОЙ САМИЙ порядок setState/onChange-викликів, що був
  // inline до цього рефакторингу (дивись коментар над resolveKeyAction вище). 'openPanel'
  // делегує в openPanel() (не дублює її внутрішній disabled-гард/setHighlight(0) -- та сама
  // функція, яку кличе onFocus).
  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const action = resolveKeyAction({ disabled, open, key: e.key, highlight, results, query, value, allowFree })
    if (action.type === 'none') return
    e.preventDefault()
    switch (action.type) {
      case 'openPanel':
        openPanel()
        break
      case 'highlight':
        setHighlight(action.highlight)
        break
      case 'commit':
        commit(action.option)
        break
      case 'commitFree':
        onChange(action.text)
        setOpen(false)
        break
      case 'revertQuery':
        setQuery(findLabelFor(value, options, optionsSource))
        setOpen(false)
        break
    }
  }

  const listboxId = `${rootId}-listbox`
  const activeOptionId = open && results[highlight] ? `${rootId}-opt-${highlight}` : undefined

  return (
    <div className="zp-select" ref={rootRef}>
      <input
        id={rootId}
        type="text"
        role="combobox"
        aria-expanded={open}
        // Minor 1 (фікс-раунд 1): панель -- умовний рендер (немає сенсу тримати
        // багатотисячний listbox у DOM, поки закрито), тож aria-controls не повинен
        // посилатись на вузол, якого зараз немає -- лише коли панель змонтована.
        aria-controls={open ? listboxId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={activeOptionId}
        aria-label={props['aria-label']}
        className="zp-select-input"
        placeholder={placeholder}
        value={query}
        disabled={disabled}
        onFocus={openPanel}
        onChange={(e) => {
          setQuery(e.target.value)
          setHighlight(0)
          if (!open) setOpen(true)
        }}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        spellCheck={false}
      />
      {open && (
        <ul className="zp-select-panel" role="listbox" id={listboxId}>
          {results.length === 0 ? (
            <li className="zp-select-empty">
              {allowFree && query.trim() ? 'Нічого не знайдено -- Enter застосує введений текст' : 'Нічого не знайдено'}
            </li>
          ) : (
            results.map((opt, i) => {
              const [before, match, after] = splitMatch(opt.label, needle.trim())
              // Ярус 2 (W2.6 Task 4): якщо запит не знайшовся в label (match порожній), а
              // hint є -- підсвічуємо збіг ТАМ, де він фактично стався (адмін набрав
              // класнейм, бачить його підсвіченим у другому рядку опції, а не гадає, чому
              // рядок узагалі показаний).
              const hintSplit = !match && opt.hint ? splitMatch(opt.hint, needle.trim()) : undefined
              const isHighlighted = i === highlight
              return (
                // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
                <li
                  key={opt.id}
                  id={`${rootId}-opt-${i}`}
                  role="option"
                  // Important 3 (фікс-раунд 1): у стандартному патерні combobox-listbox
                  // aria-selected відображає ПІДСВІЧЕНУ (навігація стрілками) опцію, не
                  // закоммічене value -- саме на неї вказує aria-activedescendant.
                  aria-selected={i === highlight}
                  className={`zp-select-option${isHighlighted ? ' highlighted' : ''}`}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => {
                    // preventDefault: не давати input втратити фокус ДО обробки кліку --
                    // інакше onBlur-подібна логіка (тут -- document mousedown) відпрацює
                    // першою і закриє панель раніше, ніж дійде клік по опції.
                    e.preventDefault()
                    commit(opt)
                  }}
                >
                  <span className="zp-select-option-label" title={opt.label}>
                    {match ? (
                      <>
                        {before}
                        <mark>{match}</mark>
                        {after}
                      </>
                    ) : (
                      opt.label
                    )}
                  </span>
                  {opt.hint && (
                    <span className="zp-select-option-hint">
                      {hintSplit ? (
                        <>
                          {hintSplit[0]}
                          <mark>{hintSplit[1]}</mark>
                          {hintSplit[2]}
                        </>
                      ) : (
                        opt.hint
                      )}
                    </span>
                  )}
                </li>
              )
            })
          )}
        </ul>
      )}
    </div>
  )
}
