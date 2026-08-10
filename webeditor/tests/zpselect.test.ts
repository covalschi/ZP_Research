// Тести ZpSelect (W2 Task 3, Step 1): чиста функція filterOptions -- та сама схема
// пріоритету, що searchClasses (model/classIndex.ts): кейс-інсенситив, префіксні збіги
// йдуть ПЕРШИМИ, потім підрядкові, стабільний порядок усередині кожної групи (як у
// вихідному масиві), обрізка лімітом, порожній запит = перші N без фільтрації.

import { describe, test, expect } from 'vitest'
import { filterOptions, moveHighlight, resolveKeyAction, type ZpOption, type ZpSelectKeyContext } from '../src/ui/ZpSelect'

const OPTIONS: ZpOption[] = [
  { id: 'zp_microscope', label: 'ZP_Microscope' },
  { id: 'zp_labcomputer', label: 'ZP_LabComputer' },
  { id: 'zp_chembench', label: 'ZP_ChemBench' },
  { id: 'apple', label: 'Apple' },
  { id: 'mag_apple', label: 'Mag_Apple' }, // "apple" -- підрядок у середині
  { id: 'pineapple', label: 'Pineapple' }, // "apple" -- підрядок у кінці
]

describe('filterOptions', () => {
  test('кейс-інсенситив: запит у верхньому регістрі знаходить нижньорегістровий label', () => {
    const hits = filterOptions(OPTIONS, 'ZP_MICRO', 50)
    expect(hits.map((o) => o.id)).toEqual(['zp_microscope'])
  })

  test('префікс-пріоритет: префіксний збіг йде перед підрядковим', () => {
    const hits = filterOptions(OPTIONS, 'apple', 50)
    // Apple -- префікс (pos=0); Mag_Apple і Pineapple -- підрядок (pos>0), у вихідному порядку.
    expect(hits.map((o) => o.id)).toEqual(['apple', 'mag_apple', 'pineapple'])
  })

  // Important 4 (фікс-раунд 1): у попередньому тесті префіксний збіг випадково стояв
  // ПЕРШИМ і у вхідному масиві -- наївний фільтр без партиціонування (просто
  // includes()) пройшов би цей тест теж. Тут підрядковий збіг навмисно йде В МАСИВІ
  // ПЕРШИМ, а префіксний -- другим: якщо хтось приберe партиціонування на pos===0,
  // цей тест впаде першим.
  test('префікс-пріоритет тримається, навіть коли підрядковий збіг стоїть у вхідному масиві раніше', () => {
    const reordered: ZpOption[] = [
      { id: 'mag_apple', label: 'Mag_Apple' }, // підрядок (pos>0) -- у масиві ПЕРШИЙ
      { id: 'apple', label: 'Apple' }, // префікс (pos=0) -- у масиві другий
    ]
    const hits = filterOptions(reordered, 'apple', 50)
    expect(hits.map((o) => o.id)).toEqual(['apple', 'mag_apple'])
  })

  test('підрядок у середині назви (без префіксного збігу) також знаходиться', () => {
    const hits = filterOptions(OPTIONS, 'lab', 50)
    expect(hits.map((o) => o.id)).toEqual(['zp_labcomputer'])
  })

  test('лімітує кількість результатів', () => {
    const many: ZpOption[] = Array.from({ length: 10 }, (_, i) => ({ id: `zp_${i}`, label: `ZP_Item_${i}` }))
    const hits = filterOptions(many, 'zp_', 3)
    expect(hits).toHaveLength(3)
  })

  test('порожній запит повертає перші N без фільтрації, у вихідному порядку', () => {
    const hits = filterOptions(OPTIONS, '', 3)
    expect(hits.map((o) => o.id)).toEqual(['zp_microscope', 'zp_labcomputer', 'zp_chembench'])
  })

  test('запит із самих пробілів трактується як порожній', () => {
    const hits = filterOptions(OPTIONS, '   ', 2)
    expect(hits.map((o) => o.id)).toEqual(['zp_microscope', 'zp_labcomputer'])
  })

  test('стабільний порядок усередині групи однакового пріоритету', () => {
    const dup: ZpOption[] = [
      { id: 'b', label: 'ZP_B' },
      { id: 'a', label: 'ZP_A' },
      { id: 'c', label: 'ZP_C' },
    ]
    expect(filterOptions(dup, 'zp_', 50).map((o) => o.id)).toEqual(['b', 'a', 'c'])
  })

  test('без збігів -- порожній масив', () => {
    expect(filterOptions(OPTIONS, 'немає_такого', 50)).toEqual([])
  })

  test('дефолтний ліміт -- 50, коли третій аргумент не передано', () => {
    const many: ZpOption[] = Array.from({ length: 60 }, (_, i) => ({ id: `zp_${i}`, label: `ZP_Item_${i}` }))
    expect(filterOptions(many, 'zp_')).toHaveLength(50)
  })
})

// W2.6 Task 4: другий ярус пошуку -- hint (адміни думають класнеймами; hint у станочному
// пікері й дрібних списках майже завжди і є класнейм/додатковий текст, а не сам label).
describe('filterOptions -- ярус hint', () => {
  const WITH_HINTS: ZpOption[] = [
    { id: 'lab', label: 'Лабораторний мікроскоп', hint: 'ZP_Microscope' },
    { id: 'fridge', label: 'Холодильник зразків', hint: 'ZP_SampleFridge' },
    { id: 'bench', label: 'Хімічна лава', hint: 'ZP_ChemBench' },
    { id: 'no-hint', label: 'Без підказки' },
  ]

  test('запит збігається лише з hint -- опція знаходиться (ярус 2)', () => {
    const hits = filterOptions(WITH_HINTS, 'microscope', 50)
    expect(hits.map((o) => o.id)).toEqual(['lab'])
  })

  test('label-збіги йдуть ПЕРЕД hint-збігами, навіть якщо hint-опція стоїть у масиві раніше', () => {
    const mixed: ZpOption[] = [
      { id: 'hint-only', label: 'Інша назва', hint: 'zp_apple_thing' }, // hint містить "apple"
      { id: 'label-hit', label: 'Apple Juice' }, // label містить "apple"
    ]
    const hits = filterOptions(mixed, 'apple', 50)
    expect(hits.map((o) => o.id)).toEqual(['label-hit', 'hint-only'])
  })

  test('усередині ярусу hint префіксний збіг йде перед підрядковим', () => {
    const hits = filterOptions(WITH_HINTS, 'zp_', 50)
    // Жоден label не містить "zp_" -- усі три з hint потрапляють у ярус 2, усі префіксні
    // (hint починається з "ZP_"), порядок стабільний як у вхідному масиві.
    expect(hits.map((o) => o.id)).toEqual(['lab', 'fridge', 'bench'])
  })

  test('опція без hint не потрапляє в ярус 2 і просто відсутня в результаті', () => {
    const hits = filterOptions(WITH_HINTS, 'підказки', 50)
    // "Без підказки" -- підрядок "підказки" є в label самої опції "no-hint" -- це ярус 1,
    // не 2; перевіряємо окремо, що запит, який НЕ зустрічається ніде для цієї опції,
    // просто її не повертає (без падіння на відсутньому hint).
    expect(filterOptions(WITH_HINTS, 'microsoft', 50)).toEqual([])
    expect(hits.map((o) => o.id)).toEqual(['no-hint'])
  })

  test('немає збігу ні в label, ні в hint -- опція відсутня', () => {
    const hits = filterOptions(WITH_HINTS, 'жодного-збігу', 50)
    expect(hits).toEqual([])
  })

  test('старий тест без hint-полів лишається чинним -- ярус 2 не зачіпає опції без hint', () => {
    const hits = filterOptions(OPTIONS, 'apple', 50)
    expect(hits.map((o) => o.id)).toEqual(['apple', 'mag_apple', 'pineapple'])
  })
})

// ---- Клавіатура ZpSelect (W3 Task 1, розминка) ----------------------------------------------
// handleKeyDown -- замикання над React-станом (open/results/highlight/query/value), тому
// напряму (через DOM/подію) без jsdom/testing-library не тестується -- жодне з двох НЕ
// встановлено в проєкті (package.json), і бриф прямо забороняє їх додавати. Замість
// DOM-харнесу винесено ЧИСТИЙ редюсер resolveKeyAction (ZpSelect.tsx, поруч із filterOptions):
// та сама функція, яку компонент реально викликає в handleKeyDown, а не друга копія логіки
// "яка клавіша -> яка дія" про людське око. Дозволено брифом явно: "exporting a testable
// pure reducer from ZpSelect is an acceptable refactor if behavior-identical".

const OPT_A: ZpOption = { id: 'a', label: 'Alpha' }
const OPT_B: ZpOption = { id: 'b', label: 'Beta' }
const OPT_C: ZpOption = { id: 'c', label: 'Gamma' }
const THREE = [OPT_A, OPT_B, OPT_C]

function ctx(overrides: Partial<ZpSelectKeyContext> = {}): ZpSelectKeyContext {
  return {
    disabled: false,
    open: true,
    key: 'ArrowDown',
    highlight: 0,
    results: THREE,
    query: '',
    value: '',
    allowFree: false,
    ...overrides,
  }
}

describe('moveHighlight', () => {
  test('ArrowDown (delta=1): звичайний крок без обгортання', () => {
    expect(moveHighlight(0, 1, 5)).toBe(1)
    expect(moveHighlight(2, 1, 5)).toBe(3)
  })

  test('ArrowDown обгортає з останнього індексу на 0', () => {
    expect(moveHighlight(4, 1, 5)).toBe(0)
  })

  test('ArrowUp (delta=-1): звичайний крок без обгортання', () => {
    expect(moveHighlight(3, -1, 5)).toBe(2)
  })

  test('ArrowUp обгортає з 0 на останній індекс', () => {
    expect(moveHighlight(0, -1, 5)).toBe(4)
  })

  test('0 результатів -- завжди 0, незалежно від напрямку чи поточного значення', () => {
    expect(moveHighlight(3, 1, 0)).toBe(0)
    expect(moveHighlight(3, -1, 0)).toBe(0)
    expect(moveHighlight(0, 1, 0)).toBe(0)
  })

  test('1 результат -- обидва напрямки лишають той самий (єдиний) індекс', () => {
    expect(moveHighlight(0, 1, 1)).toBe(0)
    expect(moveHighlight(0, -1, 1)).toBe(0)
  })
})

describe('resolveKeyAction: disabled -- завжди none, незалежно від клавіші/стану панелі', () => {
  test('ArrowDown при disabled=true', () => {
    expect(resolveKeyAction(ctx({ disabled: true, key: 'ArrowDown', open: false }))).toEqual({ type: 'none' })
  })
  test('Enter при disabled=true, панель відкрита, є results', () => {
    expect(resolveKeyAction(ctx({ disabled: true, key: 'Enter', open: true }))).toEqual({ type: 'none' })
  })
})

describe('resolveKeyAction: ArrowDown/ArrowUp', () => {
  test('панель закрита -- openPanel, підсвітка/результати не важливі', () => {
    expect(resolveKeyAction(ctx({ key: 'ArrowDown', open: false, highlight: 2 }))).toEqual({ type: 'openPanel' })
    expect(resolveKeyAction(ctx({ key: 'ArrowUp', open: false, highlight: 2 }))).toEqual({ type: 'openPanel' })
  })

  test('панель відкрита -- ArrowDown рухає підсвітку через moveHighlight(delta=1)', () => {
    expect(resolveKeyAction(ctx({ key: 'ArrowDown', open: true, highlight: 0, results: THREE }))).toEqual({
      type: 'highlight',
      highlight: 1,
    })
  })

  test('панель відкрита -- ArrowUp рухає підсвітку через moveHighlight(delta=-1), з обгортанням', () => {
    expect(resolveKeyAction(ctx({ key: 'ArrowUp', open: true, highlight: 0, results: THREE }))).toEqual({
      type: 'highlight',
      highlight: 2,
    })
  })

  test('панель відкрита, 0 результатів -- highlight лишається 0, дія все одно "highlight" (не none)', () => {
    expect(resolveKeyAction(ctx({ key: 'ArrowDown', open: true, highlight: 0, results: [] }))).toEqual({
      type: 'highlight',
      highlight: 0,
    })
  })
})

describe('resolveKeyAction: Enter', () => {
  test('панель закрита -- none (Enter не обробляється)', () => {
    expect(resolveKeyAction(ctx({ key: 'Enter', open: false }))).toEqual({ type: 'none' })
  })

  // Дискримінуючий тест: підсвічена опція -- ДРУГА в списку (highlight=1), не перша й не
  // остання -- наївна реалізація, що завжди коммітить results[0] або results[results.length-1],
  // тут провалиться (очікує саме OPT_B, а не OPT_A/OPT_C).
  test('панель відкрита, results[highlight] існує -- commit САМЕ підсвіченої опції', () => {
    expect(resolveKeyAction(ctx({ key: 'Enter', open: true, highlight: 1, results: THREE }))).toEqual({
      type: 'commit',
      option: OPT_B,
    })
  })

  test('панель відкрита, highlight указує ЗА межі results (порожній список) -- fallback (не commit)', () => {
    const action = resolveKeyAction(ctx({ key: 'Enter', open: true, highlight: 0, results: [], allowFree: false }))
    expect(action).toEqual({ type: 'revertQuery' })
  })

  test('Enter-fallback, allowFree=false -- завжди revertQuery, незалежно від тексту query', () => {
    const action = resolveKeyAction(
      ctx({ key: 'Enter', open: true, highlight: 5, results: [], allowFree: false, query: 'щось набране', value: 'стара' }),
    )
    expect(action).toEqual({ type: 'revertQuery' })
  })

  // Дискримінуючий тест: query несе пробіли на краях -- commitFree.text МАЄ бути ТРИМЛЕНИЙ
  // (mirror `query.trim()`, не сирий query) -- наївна реалізація, що передає query як є,
  // тут провалиться (порівняння з нетримленим рядком).
  test('Enter-fallback, allowFree=true, query відрізняється від value -- commitFree з ТРИМЛЕНИМ текстом', () => {
    const action = resolveKeyAction(
      ctx({ key: 'Enter', open: true, highlight: 0, results: [], allowFree: true, query: '  вільний текст  ', value: 'стара' }),
    )
    expect(action).toEqual({ type: 'commitFree', text: 'вільний текст' })
  })

  test('Enter-fallback, allowFree=true, АЛЕ query.trim() дорівнює value -- revertQuery (нема реальної зміни)', () => {
    const action = resolveKeyAction(
      ctx({ key: 'Enter', open: true, highlight: 0, results: [], allowFree: true, query: '  збіг  ', value: 'збіг' }),
    )
    expect(action).toEqual({ type: 'revertQuery' })
  })

  test('Enter-fallback, allowFree=true, query -- самі пробіли (trim дає порожньо) -- revertQuery, не commitFree("")', () => {
    const action = resolveKeyAction(
      ctx({ key: 'Enter', open: true, highlight: 0, results: [], allowFree: true, query: '   ', value: 'стара' }),
    )
    expect(action).toEqual({ type: 'revertQuery' })
  })
})

describe('resolveKeyAction: Escape', () => {
  test('панель закрита -- none', () => {
    expect(resolveKeyAction(ctx({ key: 'Escape', open: false }))).toEqual({ type: 'none' })
  })

  test('панель відкрита -- revertQuery БЕЗУМОВНО, навіть при allowFree=true й зміненому query', () => {
    const action = resolveKeyAction(ctx({ key: 'Escape', open: true, allowFree: true, query: 'набране, але не застосоване', value: 'стара' }))
    expect(action).toEqual({ type: 'revertQuery' })
  })
})

describe('resolveKeyAction: невідома клавіша -- завжди none', () => {
  test('звичайна буква не відкриває й не змінює підсвітку', () => {
    expect(resolveKeyAction(ctx({ key: 'a', open: false }))).toEqual({ type: 'none' })
    expect(resolveKeyAction(ctx({ key: 'a', open: true, highlight: 1 }))).toEqual({ type: 'none' })
  })

  test('Tab -- none (панель не перехоплює фокус-навігацію)', () => {
    expect(resolveKeyAction(ctx({ key: 'Tab', open: true }))).toEqual({ type: 'none' })
  })
})
