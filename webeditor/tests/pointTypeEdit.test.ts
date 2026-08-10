// Тести мутаторів типів балів PointTypes.json (W4 Task 1) — той самий контракт, що
// dataItemEdit/sampleTypeEdit: deep-copy до коміту (оригінал НЕ мутується), dirty=true лише
// на pointTypes-файлі, ідентичність об'єктів ІНШИХ файлів зберігається, явна відмова на
// відсутньому файлі/Id/дублі.
//
// ВІДМІННОСТІ від прецедентів (усі — дзеркала сервера, не вигадки):
//   - збіг Id — ТОЧНИЙ == (дзеркало ZP_PointTypesConfig.Find :317-325 і Validate :306 —
//     кейс-СЕНСИТИВНЕ порівняння, на відміну від DataItems/SampleTypes із ToLower);
//   - createPointType при SortOrder=0 підставляє Count()+1 (дзеркало OpUpsertPointType,
//     ZP_ConfigService.c:1272-1273);
//   - створення відмовляє на дублі КЕЙС-ІНСЕНСИТИВНО (конвенція uniqueId, прецедент
//     nodeEdit W3: сервер порівнює дослівно, але Id, що різняться лише регістром, — міна);
//   - deletePointTypeAt — позиційне видалення, ЄДИНИЙ шлях ремонту дублів Id (за Id
//     видалення близнюка неоднозначне, а дубль тримає project-wide гейт експорту).
//   - осі Categories/Kinds — ДАНІ (createDimension/applyDimensionEdit/renameDimension);
//     перейменування осі НЕ переписує записи (розсинхрон покаже дзеркало валідації).

import { describe, test, expect } from 'vitest'
import { parseConfig } from '../src/io/parse'
import { POINT_TYPES_SCHEMA, RULES_FILE_SCHEMA } from '../src/model/schema'
import { serialize } from '../src/io/jsonWriter'
import type { StorageBackend } from '../src/io/backend'
import type { Project, ProjectFile } from '../src/io/project'
import {
  applyPointTypeEdit,
  createPointType,
  deletePointType,
  deletePointTypeAt,
  renamePointType,
  applyDimensionEdit,
  createDimension,
  renameDimension,
} from '../src/io/pointTypeEdit'

const dummyBackend: StorageBackend = {
  kind: 'zip',
  list: async () => [],
  read: async () => new Uint8Array(0),
  write: async () => {},
}

function pointType(id: string, override: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Id: id,
    Name: 'Назва',
    Icon: '',
    Color: '#7CB342',
    SortOrder: 1,
    Category: 'bio',
    Kind: 'field',
    Tier: 1,
    ...override,
  }
}

function dim(id: string, override: Record<string, unknown> = {}): Record<string, unknown> {
  return { Id: id, Name: 'Вісь', SortOrder: 1, ...override }
}

function pointTypesJson(
  types: Record<string, unknown>[],
  categories: Record<string, unknown>[] = [],
  kinds: Record<string, unknown>[] = [],
): string {
  return JSON.stringify({ ConfigVersion: 1, PointTypes: types, Categories: categories, Kinds: kinds })
}

function pointTypesFile(jsonText: string, path = 'PointTypes.json'): ProjectFile {
  const { value, warnings } = parseConfig(POINT_TYPES_SCHEMA, jsonText)
  return { path, kind: 'pointTypes', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function rulesFile(path: string): ProjectFile {
  const { value, warnings } = parseConfig(RULES_FILE_SCHEMA, JSON.stringify({ ConfigVersion: 1, Rules: [] }))
  return { path, kind: 'rules', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function project(...files: ProjectFile[]): Project {
  return { files, backend: dummyBackend }
}

function docOf(p: Project): { PointTypes: Record<string, unknown>[]; Categories: Record<string, unknown>[]; Kinds: Record<string, unknown>[] } {
  const f = p.files.find((x) => x.kind === 'pointTypes')!
  return f.parsed as { PointTypes: Record<string, unknown>[]; Categories: Record<string, unknown>[]; Kinds: Record<string, unknown>[] }
}

// ---- applyPointTypeEdit ---------------------------------------------------------------------

describe('applyPointTypeEdit: щасливий шлях', () => {
  test('оновлює поле типу й позначає файл dirty', () => {
    const p = project(pointTypesFile(pointTypesJson([pointType('bio_field_t1', { Name: 'стара' })])))
    const result = applyPointTypeEdit(p, 'bio_field_t1', (it) => {
      it.Name = 'нова'
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(docOf(result.project).PointTypes[0].Name).toBe('нова')
    expect(result.project.files[0].dirty).toBe(true)
  })

  test('НЕ мутує оригінальний Project/parsed — deep-copy до коміту', () => {
    const p = project(pointTypesFile(pointTypesJson([pointType('bio_field_t1', { Name: 'стара' })])))
    const originalDoc = p.files[0].parsed
    const result = applyPointTypeEdit(p, 'bio_field_t1', (it) => {
      it.Name = 'мутована-б-якби'
    })
    expect(result.ok).toBe(true)
    expect(p.files[0].dirty).toBe(false)
    expect(p.files[0].parsed).toBe(originalDoc)
    expect(docOf(p).PointTypes[0].Name).toBe('стара')
  })

  test('ІНШІ файли проєкту зберігають ІДЕНТИЧНІСТЬ об\'єкта', () => {
    const rulesF = rulesFile('ProcessingRules/a.json')
    const p = project(rulesF, pointTypesFile(pointTypesJson([pointType('bio_field_t1')])))
    const result = applyPointTypeEdit(p, 'bio_field_t1', (it) => {
      it.Tier = 2
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.files[0]).toBe(rulesF)
    expect(result.project.files[1]).not.toBe(p.files[1])
    expect(result.project.files[1].dirty).toBe(true)
  })
})

describe('applyPointTypeEdit: відмови', () => {
  test('PointTypes.json не завантажено — явна відмова', () => {
    const p = project(rulesFile('ProcessingRules/a.json'))
    const result = applyPointTypeEdit(p, 'bio_field_t1', () => {})
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/не завантажено/i)
  })

  test('Id не знайдено — відмова', () => {
    const p = project(pointTypesFile(pointTypesJson([pointType('bio_field_t1')])))
    const result = applyPointTypeEdit(p, 'no_such', () => {})
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/не знайдено/i)
  })

  test('збіг Id ТОЧНИЙ == (дзеркало Find, ZP_PointTypesConfig.c:317-325) — інший регістр НЕ збігається', () => {
    const p = project(pointTypesFile(pointTypesJson([pointType('bio_field_t1')])))
    const result = applyPointTypeEdit(p, 'BIO_FIELD_T1', () => {})
    expect(result.ok).toBe(false)
  })

  test('дубль Id — відмова, нічого не змінено', () => {
    const p = project(pointTypesFile(pointTypesJson([pointType('dup', { Name: 'a' }), pointType('dup', { Name: 'b' })])))
    const result = applyPointTypeEdit(p, 'dup', (it) => {
      it.Name = 'edited'
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/дубль/i)
    expect(docOf(p).PointTypes[0].Name).toBe('a')
  })
})

// ---- createPointType ------------------------------------------------------------------------

describe('createPointType', () => {
  test('додає запис із дефолтами Enforce-класу ZP_PointType + init, dirty=true', () => {
    const p = project(pointTypesFile(pointTypesJson([])))
    const result = createPointType(p, 'bio_lab_t2', { Category: 'bio', Kind: 'lab', Tier: 2 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const doc = docOf(result.project)
    expect(doc.PointTypes).toHaveLength(1)
    expect(doc.PointTypes[0]).toEqual({
      Id: 'bio_lab_t2',
      Name: '',
      Icon: '',
      Color: '',
      SortOrder: 1, // 0 записів до вставки -> Count()+1 = 1 (OpUpsertPointType :1272-1273)
      Category: 'bio',
      Kind: 'lab',
      Tier: 2,
    })
    expect(result.project.files[0].dirty).toBe(true)
  })

  test('SortOrder=0 підставляється як Count()+1 ДО вставки (дзеркало OpUpsertPointType :1272-1273)', () => {
    const p = project(pointTypesFile(pointTypesJson([pointType('a'), pointType('b')])))
    const result = createPointType(p, 'c')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(docOf(result.project).PointTypes[2].SortOrder).toBe(3)
  })

  test('явний SortOrder в init НЕ переписується', () => {
    const p = project(pointTypesFile(pointTypesJson([pointType('a')])))
    const result = createPointType(p, 'b', { SortOrder: 42 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(docOf(result.project).PointTypes[1].SortOrder).toBe(42)
  })

  test('порожній Id — відмова (порожній Id валить ЦІЛИЙ файл на сервері, Validate :301-304)', () => {
    const p = project(pointTypesFile(pointTypesJson([])))
    const result = createPointType(p, '  ')
    expect(result.ok).toBe(false)
  })

  test('дубль Id — відмова, у т.ч. ІНШИМ регістром (конвенція uniqueId, прецедент nodeEdit W3)', () => {
    const p = project(pointTypesFile(pointTypesJson([pointType('bio_field_t1')])))
    expect(createPointType(p, 'bio_field_t1').ok).toBe(false)
    expect(createPointType(p, 'BIO_FIELD_T1').ok).toBe(false)
  })

  test('НЕ мутує оригінал', () => {
    const p = project(pointTypesFile(pointTypesJson([])))
    createPointType(p, 'x')
    expect(docOf(p).PointTypes).toHaveLength(0)
    expect(p.files[0].dirty).toBe(false)
  })
})

// ---- deletePointType / deletePointTypeAt ----------------------------------------------------

describe('deletePointType', () => {
  test('видаляє запис за точним Id', () => {
    const p = project(pointTypesFile(pointTypesJson([pointType('a'), pointType('b')])))
    const result = deletePointType(p, 'a')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const doc = docOf(result.project)
    expect(doc.PointTypes).toHaveLength(1)
    expect(doc.PointTypes[0].Id).toBe('b')
    expect(result.project.files[0].dirty).toBe(true)
  })

  test('Id не знайдено — відмова', () => {
    const p = project(pointTypesFile(pointTypesJson([pointType('a')])))
    expect(deletePointType(p, 'zzz').ok).toBe(false)
  })

  test('дубль Id — відмова (неоднозначно, ремонт — deletePointTypeAt)', () => {
    const p = project(pointTypesFile(pointTypesJson([pointType('dup'), pointType('dup')])))
    const result = deletePointType(p, 'dup')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/дубль/i)
  })
})

describe('deletePointTypeAt: позиційний ремонт дублів', () => {
  test('видаляє РІВНО вказаний індекс — другий близнюк лишається', () => {
    const p = project(pointTypesFile(pointTypesJson([pointType('dup', { Name: 'перший' }), pointType('dup', { Name: 'другий' })])))
    const result = deletePointTypeAt(p, 0)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const doc = docOf(result.project)
    expect(doc.PointTypes).toHaveLength(1)
    expect(doc.PointTypes[0].Name).toBe('другий')
  })

  test('індекс поза межами — відмова', () => {
    const p = project(pointTypesFile(pointTypesJson([pointType('a')])))
    expect(deletePointTypeAt(p, 1).ok).toBe(false)
    expect(deletePointTypeAt(p, -1).ok).toBe(false)
  })
})

// ---- renamePointType (W4 Task 2) ------------------------------------------------------------
// Дзеркало підходу renameDimension: перейменування НЕ переписує посилання на тип (Cost вузлів
// дерева, Points заготовок) — розсинхрон чесно покажуть дзеркала валідації (validateNode:
// «невідомий тип балів у Cost» — вузол сервер ВІДКИНЕ, ZP_TechTree.c:168-170).

describe('renamePointType', () => {
  test('перейменовує Id запису, dirty=true', () => {
    const p = project(pointTypesFile(pointTypesJson([pointType('old_id')])))
    const result = renamePointType(p, 'old_id', 'new_id')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(docOf(result.project).PointTypes[0].Id).toBe('new_id')
    expect(result.project.files[0].dirty).toBe(true)
  })

  test('той самий Id — no-op ok, проєкт той самий обʼєкт', () => {
    const p = project(pointTypesFile(pointTypesJson([pointType('a')])))
    const result = renamePointType(p, 'a', 'a')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project).toBe(p)
  })

  test('зміна ЛИШЕ регістру власного Id — легальна (це не дубль)', () => {
    const p = project(pointTypesFile(pointTypesJson([pointType('bio_field_t1')])))
    const result = renamePointType(p, 'bio_field_t1', 'BIO_field_t1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(docOf(result.project).PointTypes[0].Id).toBe('BIO_field_t1')
  })

  test('новий Id зайнятий іншим записом (кейс-інсенситивно) — відмова', () => {
    const p = project(pointTypesFile(pointTypesJson([pointType('a'), pointType('b')])))
    expect(renamePointType(p, 'a', 'b').ok).toBe(false)
    expect(renamePointType(p, 'a', 'B').ok).toBe(false)
  })

  // Ревью T2 (minor 1): кейс-only гілка обходила дубль-чек — rename 'a'->'A' при
  // рукописному кейс-варіанті 'A' у файлі карбував би ТОЧНИЙ == дубль (аварія Validate
  // :306-307). Дискримінує стару поведінку (та повертала ok і створювала дубль).
  test("кейс-only rename при наявному ТОЧНОМУ збігу нового Id — відмова, дубль не карбується", () => {
    const p = project(pointTypesFile(pointTypesJson([pointType('a'), pointType('A')])))
    const result = renamePointType(p, 'a', 'A')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('ТОЧНИМ збігом')
  })

  test('старий Id не знайдено / дубль старого — відмова', () => {
    const dupP = project(pointTypesFile(pointTypesJson([pointType('dup'), pointType('dup')])))
    expect(renamePointType(dupP, 'zzz', 'x').ok).toBe(false)
    expect(renamePointType(dupP, 'dup', 'x').ok).toBe(false)
  })

  test('порожній новий Id — відмова (порожній Id валить ЦІЛИЙ файл, Validate :301-304)', () => {
    const p = project(pointTypesFile(pointTypesJson([pointType('a')])))
    expect(renamePointType(p, 'a', '  ').ok).toBe(false)
  })

  test('НЕ мутує оригінал', () => {
    const p = project(pointTypesFile(pointTypesJson([pointType('a')])))
    renamePointType(p, 'a', 'b')
    expect(docOf(p).PointTypes[0].Id).toBe('a')
    expect(p.files[0].dirty).toBe(false)
  })
})

// ---- осі Categories/Kinds -------------------------------------------------------------------

describe('createDimension', () => {
  test('додає вісь у вказану колекцію з SortOrder=Count()+1 при 0 (конвенція редактора)', () => {
    const p = project(pointTypesFile(pointTypesJson([], [dim('bio')], [])))
    const result = createDimension(p, 'Categories', 'anomaly')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const doc = docOf(result.project)
    expect(doc.Categories).toHaveLength(2)
    expect(doc.Categories[1]).toEqual({ Id: 'anomaly', Name: '', SortOrder: 2 })
    expect(doc.Kinds).toHaveLength(0)
  })

  test('Kinds — окрема колекція, дубль Id у Categories їй не заважає', () => {
    const p = project(pointTypesFile(pointTypesJson([], [dim('field')], [])))
    const result = createDimension(p, 'Kinds', 'field')
    expect(result.ok).toBe(true)
  })

  test('дубль Id в осі — відмова, у т.ч. іншим регістром (конвенція uniqueId)', () => {
    const p = project(pointTypesFile(pointTypesJson([], [dim('bio')], [])))
    expect(createDimension(p, 'Categories', 'bio').ok).toBe(false)
    expect(createDimension(p, 'Categories', 'BIO').ok).toBe(false)
  })

  test('порожній Id — відмова', () => {
    const p = project(pointTypesFile(pointTypesJson([])))
    expect(createDimension(p, 'Categories', ' ').ok).toBe(false)
  })
})

describe('applyDimensionEdit', () => {
  test('править Name/SortOrder осі', () => {
    const p = project(pointTypesFile(pointTypesJson([], [dim('bio', { Name: 'стара' })], [])))
    const result = applyDimensionEdit(p, 'Categories', 'bio', (d) => {
      d.Name = 'Біологія'
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(docOf(result.project).Categories[0].Name).toBe('Біологія')
  })

  test('Id не знайдено / дубль — відмова', () => {
    const p = project(pointTypesFile(pointTypesJson([], [dim('dup'), dim('dup')], [])))
    expect(applyDimensionEdit(p, 'Categories', 'zzz', () => {}).ok).toBe(false)
    expect(applyDimensionEdit(p, 'Categories', 'dup', () => {}).ok).toBe(false)
  })
})

describe('renameDimension', () => {
  test('перейменовує вісь і НЕ чіпає записи PointTypes (розсинхрон покаже дзеркало)', () => {
    const p = project(pointTypesFile(pointTypesJson([pointType('t1', { Category: 'bio' })], [dim('bio')], [])))
    const result = renameDimension(p, 'Categories', 'bio', 'biology')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const doc = docOf(result.project)
    expect(doc.Categories[0].Id).toBe('biology')
    expect(doc.PointTypes[0].Category).toBe('bio') // запис НАВМИСНО не переписаний
  })

  test('той самий Id — no-op ok, проєкт той самий', () => {
    const p = project(pointTypesFile(pointTypesJson([], [dim('bio')], [])))
    const result = renameDimension(p, 'Categories', 'bio', 'bio')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project).toBe(p)
  })

  test('зміна ЛИШЕ регістру власного Id — легальна (це не дубль)', () => {
    const p = project(pointTypesFile(pointTypesJson([], [dim('bio')], [])))
    const result = renameDimension(p, 'Categories', 'bio', 'BIO')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(docOf(result.project).Categories[0].Id).toBe('BIO')
  })

  test('новий Id зайнятий іншою віссю (кейс-інсенситивно) — відмова', () => {
    const p = project(pointTypesFile(pointTypesJson([], [dim('bio'), dim('anomaly')], [])))
    expect(renameDimension(p, 'Categories', 'bio', 'ANOMALY').ok).toBe(false)
  })

  // Той самий гвард, що в renamePointType (ревью T2, minor 1) — для осей.
  test('кейс-only rename осі при наявному ТОЧНОМУ збігу — відмова', () => {
    const p = project(pointTypesFile(pointTypesJson([], [dim('bio'), dim('BIO')], [])))
    expect(renameDimension(p, 'Categories', 'bio', 'BIO').ok).toBe(false)
  })

  test('порожній новий Id — відмова', () => {
    const p = project(pointTypesFile(pointTypesJson([], [dim('bio')], [])))
    expect(renameDimension(p, 'Categories', 'bio', '  ').ok).toBe(false)
  })
})

// ---- байт-стабільність ----------------------------------------------------------------------

describe('pointTypeEdit: байт-стабільність повторної канонізації', () => {
  test('serialize -> parse -> serialize ідентичний після createPointType + applyPointTypeEdit', () => {
    const p = project(pointTypesFile(pointTypesJson([pointType('bio_field_t1')], [dim('bio')], [dim('field')])))
    const r1 = createPointType(p, 'bio_lab_t1', { Category: 'bio', Kind: 'lab', Tier: 1 })
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    const r2 = applyPointTypeEdit(r1.project, 'bio_lab_t1', (it) => {
      it.Name = 'Лабораторна біологія з "лапками"'
    })
    expect(r2.ok).toBe(true)
    if (!r2.ok) return

    const doc = r2.project.files[0].parsed
    const firstPass = serialize(POINT_TYPES_SCHEMA, doc)
    const reparsed = parseConfig(POINT_TYPES_SCHEMA, firstPass)
    expect(reparsed.warnings).toEqual([])
    const secondPass = serialize(POINT_TYPES_SCHEMA, reparsed.value)
    expect(secondPass).toBe(firstPass)
  })
})
