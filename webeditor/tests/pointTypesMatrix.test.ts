// Тести чистих хелперів розкладки матриці типів балів (W4 Task 2, TDD — тести ПЕРЕД
// реалізацією). Дзеркала сервера, які перевіряються:
//   - осі впорядковуються за SortOrder, збіг Id ТОЧНИЙ ==, перший виграє (дзеркало
//     DimensionName/DimensionOrder, ZP_PointTypesConfig.c:237-255);
//   - запис із Category/Kind поза осями НЕ зникає — іде в окрему секцію «поза матрицею»
//     (сервер ставить такий блок у кінець із сирим Id, DimensionOrder повертає 9999);
//   - записи, які взагалі не можна адресувати за Id (порожній Id, не-об'єкт), ТЕЖ ідуть у
//     «поза матрицею» — інакше адмін не мав би ЖОДНОГО шляху ремонту (гейт збереження
//     тримає alarm, а applyPointTypeEdit/deletePointType за Id їх не бачать; єдиний шлях —
//     позиційне deletePointTypeAt, і секція мусить дати до нього кнопку);
//   - дубль Id — точний == (Validate :306-308), позначає ВСІ входження;
//   - генерація Id нового типу — шаблон `<cat>_<kind>_t<N>` через uniqueId (конвенція
//     кейс-інсенситивна, прецедент nodeEdit/ruleFileUtils).

import { describe, test, expect } from 'vitest'
import {
  buildPointTypesMatrix,
  cellKey,
  suggestPointTypeId,
  suggestPointTypeName,
  categoryColor,
  resolveMatrixSelection,
  adjustSelectionAfterDelete,
} from '../src/ui/pointTypesMatrix'

function pt(id: string, override: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Id: id,
    Name: `Назва ${id}`,
    Icon: '',
    Color: '#7CB342',
    SortOrder: 1,
    Category: 'bio',
    Kind: 'field',
    Tier: 1,
    ...override,
  }
}

function dim(id: string, name: string, order: number): Record<string, unknown> {
  return { Id: id, Name: name, SortOrder: order }
}

function doc(
  types: unknown[],
  categories: unknown[] = [dim('bio', 'Біологія', 1)],
  kinds: unknown[] = [dim('field', 'польові', 1)],
): Record<string, unknown> {
  return { ConfigVersion: 1, PointTypes: types, Categories: categories, Kinds: kinds }
}

// ---- осі -----------------------------------------------------------------------------------

describe('buildPointTypesMatrix: осі', () => {
  test('категорії та види сортуються за SortOrder (стабільно при рівних)', () => {
    const m = buildPointTypesMatrix(
      doc(
        [],
        [dim('anomaly', 'Аномалії', 2), dim('bio', 'Біологія', 1), dim('combat', 'Бойові', 2)],
        [dim('lab', 'лабораторні', 2), dim('field', 'польові', 1)],
      ),
    )
    expect(m.categories.map((c) => c.id)).toEqual(['bio', 'anomaly', 'combat'])
    expect(m.kinds.map((k) => k.id)).toEqual(['field', 'lab'])
  })

  test('дубль Id осі — перший виграє (дзеркало DimensionName/DimensionOrder: перший збіг)', () => {
    const m = buildPointTypesMatrix(doc([], [dim('bio', 'Перша', 1), dim('bio', 'Друга', 2)]))
    expect(m.categories).toHaveLength(1)
    expect(m.categories[0].name).toBe('Перша')
  })

  // Ревью T2 (minor 3): близнюк осі не рендериться рядком — без окремого списку він був
  // би невидимим мовчки. Точний == (кейс-варіант дублем НЕ вважається — окремі записи).
  test('дублі Id осей звітуються в axisDuplicates (точний ==, кейс-варіант — не дубль)', () => {
    const m = buildPointTypesMatrix(
      doc([], [dim('bio', 'Перша', 1), dim('bio', 'Друга', 2), dim('BIO', 'Кейс-варіант', 3)], [dim('field', 'польові', 1)]),
    )
    expect(m.axisDuplicates).toEqual([{ axis: 'Categories', id: 'bio', count: 2 }])
  })

  test('без дублів осей — axisDuplicates порожній', () => {
    const m = buildPointTypesMatrix(doc([], [dim('bio', 'Б', 1)], [dim('field', 'п', 1)]))
    expect(m.axisDuplicates).toEqual([])
  })

  test('index осі — позиція у масиві файлу (для applyDimensionEdit-панелі)', () => {
    const m = buildPointTypesMatrix(doc([], [dim('b', 'Б', 2), dim('a', 'А', 1)]))
    expect(m.categories.map((c) => c.index)).toEqual([1, 0])
  })
})

// ---- колонки тірів -------------------------------------------------------------------------

describe('buildPointTypesMatrix: колонки тірів', () => {
  test('без записів — типові 1..3 (шаблон Id починається з t1, стенд має 3 тіри)', () => {
    expect(buildPointTypesMatrix(doc([])).tiers).toEqual([1, 2, 3])
  })

  test('розширюються до максимального спостереженого тіра', () => {
    const m = buildPointTypesMatrix(doc([pt('a', { Tier: 5 })]))
    expect(m.tiers).toEqual([1, 2, 3, 4, 5])
  })

  test('Tier 0 (легальний для сервера) додає колонку 0 лише коли реально є', () => {
    const m = buildPointTypesMatrix(doc([pt('a', { Tier: 0 })]))
    expect(m.tiers).toEqual([0, 1, 2, 3])
  })

  test('extraTiers додає колонки, стеля 10 (межа Validate :311-312)', () => {
    expect(buildPointTypesMatrix(doc([]), 2).tiers).toEqual([1, 2, 3, 4, 5])
    expect(buildPointTypesMatrix(doc([]), 99).tiers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  test('Tier поза [0..10] колонок НЕ розширює (запис іде «поза матрицею»)', () => {
    const m = buildPointTypesMatrix(doc([pt('a', { Tier: 99999 })]))
    expect(m.tiers).toEqual([1, 2, 3])
  })
})

// ---- клітинки ------------------------------------------------------------------------------

describe('buildPointTypesMatrix: клітинки', () => {
  test('запис лягає у свою клітинку (точний збіг Category/Kind, як DimensionOrder)', () => {
    const m = buildPointTypesMatrix(doc([pt('bio_field_t2', { Tier: 2 })]))
    const cell = m.cells.get(cellKey('bio', 'field', 2))
    expect(cell).toHaveLength(1)
    expect(cell![0].id).toBe('bio_field_t2')
    expect(cell![0].index).toBe(0)
    expect(m.outside).toHaveLength(0)
  })

  test('інший РЕГІСТР Category — НЕ збіг (сервер порівнює дослівно) — запис поза матрицею', () => {
    const m = buildPointTypesMatrix(doc([pt('a', { Category: 'BIO' })]))
    expect(m.cells.size).toBe(0)
    expect(m.outside).toHaveLength(1)
    expect(m.outside[0].reasons.join(' ')).toMatch(/BIO/)
  })

  test('двоє в одній клітинці — обидва видимі у порядку файлу', () => {
    const m = buildPointTypesMatrix(doc([pt('a', { SortOrder: 2 }), pt('b', { SortOrder: 1 })]))
    const cell = m.cells.get(cellKey('bio', 'field', 1))
    expect(cell!.map((e) => e.id)).toEqual(['a', 'b'])
  })

  test('дубль Id (точний ==) позначає ВСІ входження, різнорегістрові — ні', () => {
    const m = buildPointTypesMatrix(doc([pt('dup'), pt('dup', { Tier: 2 }), pt('DUP', { Tier: 3 })]))
    const flat = [...m.cells.values()].flat()
    expect(flat.find((e) => e.index === 0)!.duplicate).toBe(true)
    expect(flat.find((e) => e.index === 1)!.duplicate).toBe(true)
    expect(flat.find((e) => e.index === 2)!.duplicate).toBe(false)
  })
})

// ---- поза матрицею -------------------------------------------------------------------------

describe('buildPointTypesMatrix: поза матрицею', () => {
  test('невідома категорія І невідомий вид — обидві причини перелічені', () => {
    const m = buildPointTypesMatrix(doc([pt('x', { Category: 'chem', Kind: 'wild' })]))
    expect(m.outside).toHaveLength(1)
    expect(m.outside[0].reasons).toHaveLength(2)
  })

  test('порожній Id — поза матрицею з причиною (єдиний шлях ремонту — позиційне видалення)', () => {
    const m = buildPointTypesMatrix(doc([pt('')]))
    expect(m.outside).toHaveLength(1)
    expect(m.outside[0].entry.index).toBe(0)
    expect(m.outside[0].reasons.join(' ')).toMatch(/порожн/i)
  })

  test('не-об\'єкт у масиві — поза матрицею, а не мовчазний пропуск', () => {
    const m = buildPointTypesMatrix(doc([null, 42]))
    expect(m.outside).toHaveLength(2)
    expect(m.outside.map((o) => o.entry.index)).toEqual([0, 1])
  })

  test('Tier поза [0..10] — поза матрицею (дзеркало Validate :311-312)', () => {
    const m = buildPointTypesMatrix(doc([pt('a', { Tier: 11 }), pt('b', { Tier: -1 })]))
    expect(m.outside).toHaveLength(2)
  })

  test('порожні осі: всі записи поза матрицею (SeedDimensions ще не запускався)', () => {
    const m = buildPointTypesMatrix(doc([pt('a')], [], []))
    expect(m.categories).toHaveLength(0)
    expect(m.outside).toHaveLength(1)
  })
})

// ---- entries (порядок файлу) ---------------------------------------------------------------

describe('buildPointTypesMatrix: entries', () => {
  test('усі записи у порядку файлу, включно з поза-матричними', () => {
    const m = buildPointTypesMatrix(doc([pt('a'), pt('', { Category: 'chem' }), pt('b', { Tier: 2 })]))
    expect(m.entries.map((e) => e.index)).toEqual([0, 1, 2])
    expect(m.entries.map((e) => e.id)).toEqual(['a', '', 'b'])
  })
})

// ---- suggestPointTypeId / suggestPointTypeName ---------------------------------------------

describe('suggestPointTypeId', () => {
  test('шаблон <cat>_<kind>_t<N>', () => {
    expect(suggestPointTypeId(doc([]), 'bio', 'lab', 2)).toBe('bio_lab_t2')
  })

  test('зайнятий Id (кейс-інсенситивно) — суфікс _2 (конвенція uniqueId)', () => {
    expect(suggestPointTypeId(doc([pt('BIO_LAB_T2')]), 'bio', 'lab', 2)).toBe('bio_lab_t2_2')
  })
})

describe('suggestPointTypeName', () => {
  test('складається з Name осей', () => {
    expect(suggestPointTypeName({ id: 'bio', name: 'Біологія' }, { id: 'field', name: 'польові' }, 2)).toBe('Біологія — польові, тір 2')
  })

  test('порожній Name осі — сирий Id (той самий фолбек, що DimensionName :237-245)', () => {
    expect(suggestPointTypeName({ id: 'bio', name: '' }, { id: 'field', name: '' }, 1)).toBe('bio — field, тір 1')
  })
})

// ---- categoryColor -------------------------------------------------------------------------

describe('categoryColor', () => {
  test('перший непорожній Color запису категорії (порядок файлу)', () => {
    const d = doc([pt('a', { Color: '' }), pt('b', { Color: '#AB47BC' }), pt('c', { Color: '#FFFFFF' })])
    expect(categoryColor(d, 'bio')).toBe('#AB47BC')
  })

  test('немає записів категорії — порожньо', () => {
    expect(categoryColor(doc([]), 'bio')).toBe('')
  })

  test('збіг категорії точний == (не інший регістр)', () => {
    expect(categoryColor(doc([pt('a', { Color: '#123456' })]), 'BIO')).toBe('')
  })
})

// ---- resolveMatrixSelection ----------------------------------------------------------------
// Вибір зберігається парою {index, id}: індекс потрібен позиційному ремонту близнюків, а Id —
// страховка від застарілого індексу (проєкт могли переімпортувати, близнюка — видалити).

describe('resolveMatrixSelection', () => {
  test('живий вибір — повертає запис', () => {
    const m = buildPointTypesMatrix(doc([pt('a'), pt('b', { Tier: 2 })]))
    const hit = resolveMatrixSelection(m, { index: 1, id: 'b' })
    expect(hit?.id).toBe('b')
    expect(hit?.index).toBe(1)
  })

  test('індекс живий, але Id ІНШИЙ (застарілий вибір після переімпорту) — null', () => {
    const m = buildPointTypesMatrix(doc([pt('a')]))
    expect(resolveMatrixSelection(m, { index: 0, id: 'b' })).toBeNull()
  })

  test('індекс поза межами / null-вибір — null', () => {
    const m = buildPointTypesMatrix(doc([pt('a')]))
    expect(resolveMatrixSelection(m, { index: 5, id: 'a' })).toBeNull()
    expect(resolveMatrixSelection(m, null)).toBeNull()
  })
})

// ---- adjustSelectionAfterDelete ------------------------------------------------------------
// Позиційне видалення (deletePointTypeAt) зсуває індекси праворуч від видаленого — вибір
// {index, id} мусить пересунутись разом із записом, а вибір САМОГО видаленого — згаснути.

describe('adjustSelectionAfterDelete', () => {
  test('видалений лівіше за вибір — індекс зсувається на -1', () => {
    expect(adjustSelectionAfterDelete({ index: 3, id: 'x' }, 1)).toEqual({ index: 2, id: 'x' })
  })

  test('видалений САМ вибір — null', () => {
    expect(adjustSelectionAfterDelete({ index: 2, id: 'x' }, 2)).toBeNull()
  })

  test('видалений правіше — вибір не рухається', () => {
    expect(adjustSelectionAfterDelete({ index: 1, id: 'x' }, 4)).toEqual({ index: 1, id: 'x' })
  })

  test('вибору немає — null', () => {
    expect(adjustSelectionAfterDelete(null, 0)).toBeNull()
  })
})

// ---- деградація ----------------------------------------------------------------------------

describe('buildPointTypesMatrix: деградація форми', () => {
  test('не-документ (null/масив) — порожня матриця без падіння', () => {
    expect(buildPointTypesMatrix(null).entries).toHaveLength(0)
    expect(buildPointTypesMatrix([]).categories).toHaveLength(0)
    expect(buildPointTypesMatrix({ PointTypes: 'не-масив' }).entries).toHaveLength(0)
  })
})
