// Тести терпимого парсера (Task 5, Step 1). Парсер ходить розібраний JSON.parse()-документ
// за схемою: коерсує кожне значення до типу поля, добиває відсутні ключі дефолтами,
// відкидає невідомі/застарілі ключі — і НІКОЛИ не кидає виняток, а замість цього збирає
// список попереджень. tests/fixtures/README.md пояснює провенанс фікстур.

import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseConfig } from '../src/io/parse'
import { serialize } from '../src/io/jsonWriter'
import { RULES_FILE_SCHEMA, TECH_TREE_SCHEMA, MODULES_SCHEMA } from '../src/model/schema'
import type { ObjectSchema } from '../src/model/schema'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, 'fixtures')

function fixtureText(rel: string): string {
  return readFileSync(join(FIXTURES, rel), 'utf8')
}

describe('parseConfig: застарілий ключ', () => {
  test('techTree/stale/zone.json: ResearchDevice відкидається з попередженням на кожному вузлі', () => {
    const staleZoneText = fixtureText('stale/zone.json')
    const { value, warnings } = parseConfig(TECH_TREE_SCHEMA, staleZoneText)
    expect(warnings.some((w) => w.message.includes('ResearchDevice'))).toBe(true)
    expect(JSON.stringify(value)).not.toContain('ResearchDevice')
    // Файл має 12 вузлів, ResearchDevice — на кожному: 12 попереджень про цей ключ.
    const staleWarnings = warnings.filter((w) => w.message.includes('ResearchDevice'))
    expect(staleWarnings).toHaveLength(12)
    // Шлях попередження вказує на конкретний вузол, а не просто на "десь у файлі".
    expect(staleWarnings[0].path).toMatch(/^Nodes\[0\]/)
  })
})

// Політика (рев'ю W1, Important, рішення фінального ревью 2026-08-06): парсер дзеркалить
// ЗАВАНТАЖЕННЯ рушієм, а не конструювання нового об'єкта — відсутній ключ дає НУЛЬ свого
// типу (0/false/''/[]), а не ініціалізатор Enforce-класу (Enabled=true, Quantity=1 і т.д.).
// Дефолти класу лишаються за defaultsFor()/fd.def — джерело для СТВОРЕННЯ нових сутностей
// у майбутньому UI (W2), не для парсингу старих файлів. Див. CLAUDE.md ("Мова моду" розділ
// W1) і docs/superpowers/plans/2026-08-06-web-editor-w1-foundation.md.
describe('parseConfig: відсутній ключ -> нуль свого типу (= те, що реально прочитав би рушій) + попередження', () => {
  test('ZP_Rule без більшості полів канонізується нулями типів, НЕ дефолтами класу', () => {
    const { value, warnings } = parseConfig(
      RULES_FILE_SCHEMA,
      '{"ConfigVersion":1,"Rules":[{"Id":"x","Device":"ZP_Microscope"}]}',
    )
    const r = (value as any).Rules[0]
    expect(r.Enabled).toBe(false) // НЕ дефолт класу (true) — рушій без ключа читає false
    expect(r.BasePurityMin).toBe(0)
    expect(r.BasePurityMax).toBe(0)
    expect(r.TimeSec).toBe(0)
    expect(r.Mode).toBe('')
    expect(r.InputItem).toEqual({ Classname: '', Quantity: 0, ConsumeInput: false, Content: '' })
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings.some((w) => w.path === 'Rules[0].Enabled')).toBe(true)
    expect(warnings.some((w) => w.message.includes('ключ відсутній'))).toBe(true)
    // Повідомлення явно називає і нуль, який реально прочитає рушій, і дефолт класу —
    // адміну має бути видно ймовірний намір, а не лише голий факт "чогось нема".
    const enabledWarning = warnings.find((w) => w.path === 'Rules[0].Enabled')!
    expect(enabledWarning.message).toContain('false')
    expect(enabledWarning.message).toContain('true') // типове значення класу згадане в тексті
    // W2.5 Task 3 (severity): відсутній ключ НЕ підіймається до alarm — рушій мовчки
    // кладе нуль і файл вантажиться повністю, на відміну від хибного типу присутнього
    // ключа нижче. severity лишається дефолтним (undefined == 'warn').
    expect(enabledWarning.severity).toBeUndefined()
  })

  test('шлях попередження вкладеного поля -> Rules[N].InputItem.Quantity', () => {
    const { warnings } = parseConfig(
      RULES_FILE_SCHEMA,
      '{"ConfigVersion":1,"Rules":[{"Id":"x","InputItem":{"Classname":"Apple"}}]}',
    )
    expect(warnings.some((w) => w.path === 'Rules[0].InputItem.Quantity')).toBe(true)
  })

  // Регресія поведінки (рев'ю W1): канонізація не мусить МОВЧКИ вмикати те, що адмін
  // вимкнув у старому файлі. Байт-рівна перевірка серіалізованого рядка — те саме, що
  // реально піде на диск і що реально прочитає рушій при наступному завантаженні.
  test('відсутній Enabled -> серіалізація явно фіксує "Enabled": 0 (те, що прочитав би рушій)', () => {
    const text = '{"ConfigVersion":1,"Rules":[{"Id":"x"}]}' // Enabled відсутній у файлі
    const { value } = parseConfig(RULES_FILE_SCHEMA, text)
    const out = serialize(RULES_FILE_SCHEMA, value)
    expect(out).toContain('"Enabled": 0')
    expect(out).not.toContain('"Enabled": 1')
  })
})

describe('parseConfig: bool приймає і true/false, і 1/0', () => {
  test('true/false лишаються boolean, без попереджень', () => {
    const text = '{"ConfigVersion":1,"Rules":[{"Id":"x","Enabled":true}]}'
    const { value, warnings } = parseConfig(RULES_FILE_SCHEMA, text)
    const r = (value as any).Rules[0]
    expect(r.Enabled).toBe(true)
    expect(typeof r.Enabled).toBe('boolean')
    expect(warnings.some((w) => w.path === 'Rules[0].Enabled')).toBe(false)
  })

  test('1/0 (як пише рушій) також дають справжній boolean, без попереджень', () => {
    const enabled1 = parseConfig(RULES_FILE_SCHEMA, '{"ConfigVersion":1,"Rules":[{"Id":"x","Enabled":1}]}')
    const r1 = (enabled1.value as any).Rules[0]
    expect(r1.Enabled).toBe(true)
    expect(typeof r1.Enabled).toBe('boolean')
    expect(enabled1.warnings.some((w) => w.path === 'Rules[0].Enabled')).toBe(false)

    const enabled0 = parseConfig(RULES_FILE_SCHEMA, '{"ConfigVersion":1,"Rules":[{"Id":"x","Enabled":0}]}')
    const r0 = (enabled0.value as any).Rules[0]
    expect(r0.Enabled).toBe(false)
    expect(typeof r0.Enabled).toBe('boolean')
    expect(enabled0.warnings.some((w) => w.path === 'Rules[0].Enabled')).toBe(false)
  })

  // Рев'ю Task 4, фікс-раунд 1, Important: хибний тип ПРИСУТНЬОГО ключа канонізується
  // нулем свого типу (false), а НЕ дефолтом класу (true) -- те саме, що для відсутнього
  // ключа вище, і з тієї самої причини (дефолт класу тут мовчки УВІМКНУВ би вимкнене
  // адміном правило). До цього фіксу тест очікував `true` -- поведінка, яку сам W1
  // визнав небезпечною для відсутнього ключа, але залишав для присутнього хибнотипізованого.
  test('щось інше (рядок, число поза {0,1}) -> попередження + НУЛЬ типу (false), не дефолт класу', () => {
    const { value, warnings } = parseConfig(
      RULES_FILE_SCHEMA,
      '{"ConfigVersion":1,"Rules":[{"Id":"x","Enabled":"так"}]}',
    )
    const r = (value as any).Rules[0]
    expect(r.Enabled).toBe(false) // НЕ дефолт ZP_Rule.Enabled (true) -- нуль типу
    expect(typeof r.Enabled).toBe('boolean')
    expect(warnings.some((w) => w.path === 'Rules[0].Enabled')).toBe(true)
  })

  // Замикає деферований висновок ревью Task 4: emitValue (jsonWriter.ts) пише bool за
  // ІСТИННІСТЮ значення (v ? '1' : '0'), тож рядок "0" чи будь-що ще, що не пройшло через
  // parseConfig, серіалізувалося б у хибне "1". Довести композицію напряму: JSON-літерал
  // true -> parseConfig дає справжній JS boolean -> serialize пише саме "1".
  test('композиція з jsonWriter: "Enabled": true (літерал) парситься в boolean і пишеться назад як 1', () => {
    const text = '{"ConfigVersion":1,"Rules":[{"Id":"x","Enabled":true}]}'
    const { value } = parseConfig(RULES_FILE_SCHEMA, text)
    const r = (value as any).Rules[0]
    expect(r.Enabled).toBe(true)
    expect(typeof r.Enabled).toBe('boolean')
    const out = serialize(RULES_FILE_SCHEMA, value)
    expect(out).toContain('"Enabled": 1')
    expect(out).not.toContain('"Enabled": true')
  })
})

describe('parseConfig: float-поле квантується до float32 при читанні', () => {
  test('0.4 і 0.4000000059604645 (те саме float32) дають ОДНЕ значення', () => {
    const short = parseConfig(
      RULES_FILE_SCHEMA,
      '{"ConfigVersion":1,"Rules":[{"Id":"x","BasePurityMin":0.4}]}',
    )
    const long = parseConfig(
      RULES_FILE_SCHEMA,
      '{"ConfigVersion":1,"Rules":[{"Id":"x","BasePurityMin":0.4000000059604645}]}',
    )
    const a = (short.value as any).Rules[0].BasePurityMin
    const b = (long.value as any).Rules[0].BasePurityMin
    expect(a).toBe(Math.fround(0.4))
    expect(a).toBe(b)
  })

  test('квантування само по собі не породжує попередження', () => {
    const { warnings } = parseConfig(MODULES_SCHEMA, '{"ConfigVersion":1,"Modules":[{"Classname":"X","PurityBonus":0.2}]}')
    expect(warnings.some((w) => w.path.includes('PurityBonus'))).toBe(false)
  })
})

describe('parseConfig: int32 діапазон і дробові значення', () => {
  test('дробове значення у цілочисельному полі -> попередження + Math.trunc', () => {
    const { value, warnings } = parseConfig(
      TECH_TREE_SCHEMA,
      '{"ConfigVersion":1,"Branch":{"Id":"z"},"Nodes":[{"Id":"n","Tier":3.7}]}',
    )
    const node = (value as any).Nodes[0]
    expect(node.Tier).toBe(3)
    expect(warnings.some((w) => w.path === 'Nodes[0].Tier' && w.message.includes('ціл'))).toBe(true)
  })

  test('значення поза межами int32 -> попередження, значення НЕ обрізається', () => {
    const { value, warnings } = parseConfig(
      TECH_TREE_SCHEMA,
      '{"ConfigVersion":1,"Branch":{"Id":"z"},"Nodes":[{"Id":"n","Tier":5000000000}]}',
    )
    const node = (value as any).Nodes[0]
    expect(node.Tier).toBe(5000000000)
    expect(warnings.some((w) => w.path === 'Nodes[0].Tier' && w.message.includes('int32'))).toBe(true)
  })
})

// Скалярні wrong-type тести (W2 Task 4, відкладений minor рев'ю W1; семантика виправлена
// рев'ю фікс-раунду 1, Important): досі прямо перевірялось лише bool ("так" замість
// true/false/1/0, вище) і опосередковано int (дробове значення, значення поза int32 —
// не "зовсім чужий тип"). Тут — по одному прямому кейсу "зовсім не той JS-тип" на кожен
// із трьох решта скалярних типів.
//
// ВАЖЛИВО, не плутати з розділом "відсутній ключ" вище: там немає самого ключа. Тут ключ
// ПРИСУТНІЙ, але значення хибного типу — і coerceValue (parse.ts) ТЕЖ падає на zeroValue
// цього поля (0/false/''), А НЕ на дефолт класу (field.def). Обидва шляхи тепер дають
// однаковий "нуль типу" результат — навмисно (дефолт класу мовчки протягнув би саме ту
// небезпеку, яку W1 прибрав для відсутніх ключів). Поля Tier/BasePurityMin/Mode обрані
// саме тому, що їхній дефолт КЛАСУ (1 / 0.5 / 'background') відрізняється від нуля типу
// (0 / 0 / '') — тест і справді розрізняє, який із двох шляхів спрацював, а не випадково
// збігається з обома.
// severity (W2.5 Task 3, рішення власника «поднимай тревожность»): усі чотири скалярні
// coerceXxx (Int/Float/Bool/String) тепер піднімають ЦЕЙ конкретний випадок до
// severity: 'alarm' -- T8-зонд підтвердив, що рушій відхиляє ВЕСЬ файл при рестарті на
// хибному типі присутнього ключа (раніше тут стояло "емпірично не перевірено", тепер
// підтверджено, wrongTypeNote() у parse.ts несе точний текст і цитату ZP_ConfigService.c).
describe("parseConfig: скалярні поля хибного JS-типу (ключ ПРИСУТНІЙ) -> попередження + НУЛЬ типу + alarm", () => {
  test('рядок замість int (Tier) -> попередження + нуль (0), НЕ дефолт поля (1), severity alarm', () => {
    const { value, warnings } = parseConfig(
      TECH_TREE_SCHEMA,
      '{"ConfigVersion":1,"Branch":{"Id":"z"},"Nodes":[{"Id":"n","Tier":"oops"}]}',
    )
    const node = (value as any).Nodes[0]
    expect(node.Tier).toBe(0) // НЕ дефолт ZP_TreeNode.Tier (1) -- нуль типу
    const w = warnings.find((x) => x.path === 'Nodes[0].Tier' && x.message.includes('ціле число'))
    expect(w).toBeDefined()
    expect(w!.severity).toBe('alarm')
  })

  test('bool замість float (BasePurityMin) -> попередження + нуль (0), НЕ дефолт поля (0.5), severity alarm', () => {
    const { value, warnings } = parseConfig(
      RULES_FILE_SCHEMA,
      '{"ConfigVersion":1,"Rules":[{"Id":"x","BasePurityMin":true}]}',
    )
    const r = (value as any).Rules[0]
    expect(r.BasePurityMin).toBe(0) // НЕ дефолт ZP_Rule.BasePurityMin (0.5) -- нуль типу
    const w = warnings.find((x) => x.path === 'Rules[0].BasePurityMin')
    expect(w).toBeDefined()
    expect(w!.severity).toBe('alarm')
  })

  test("число замість рядка (Mode) -> попередження + порожній рядок, НЕ дефолт поля ('background'), severity alarm", () => {
    const { value, warnings } = parseConfig(
      RULES_FILE_SCHEMA,
      '{"ConfigVersion":1,"Rules":[{"Id":"x","Mode":42}]}',
    )
    const r = (value as any).Rules[0]
    expect(r.Mode).toBe('') // НЕ дефолт ZP_Rule.Mode ('background') -- нуль типу
    expect(typeof r.Mode).toBe('string')
    const w = warnings.find((x) => x.path === 'Rules[0].Mode' && x.message.includes('рядок'))
    expect(w).toBeDefined()
    expect(w!.severity).toBe('alarm')
  })

  test('рядок замість bool (Enabled: "так") -> severity alarm (той самий шлях, що й ChainView bool-тест вище)', () => {
    const { warnings } = parseConfig(
      RULES_FILE_SCHEMA,
      '{"ConfigVersion":1,"Rules":[{"Id":"x","Enabled":"так"}]}',
    )
    const w = warnings.find((x) => x.path === 'Rules[0].Enabled')!
    expect(w.severity).toBe('alarm')
  })

  test('попередження прямо каже про T8-зонд і "рушій відхилить УВЕСЬ файл при рестарті"', () => {
    const { warnings } = parseConfig(
      RULES_FILE_SCHEMA,
      '{"ConfigVersion":1,"Rules":[{"Id":"x","BasePurityMin":true}]}',
    )
    const w = warnings.find((x) => x.path === 'Rules[0].BasePurityMin')!
    expect(w.message).toContain('T8')
    expect(w.message).toContain('рушій відхилить УВЕСЬ файл при рестарті')
    expect(w.message).toContain('ZP_ConfigService.c:383-393')
  })
})

describe('parseConfig: невідомий ключ', () => {
  test('чужий ключ -> попередження і відкидається (немає у value)', () => {
    const { value, warnings } = parseConfig(
      RULES_FILE_SCHEMA,
      '{"ConfigVersion":1,"Rules":[{"Id":"x","Bogus_Field":42}]}',
    )
    const r = (value as any).Rules[0]
    expect('Bogus_Field' in r).toBe(false)
    expect(
      warnings.some((w) => w.path === 'Rules[0].Bogus_Field' && w.message.includes('невідомий ключ')),
    ).toBe(true)
  })
})

// W2.5 Task 3 (severity, межа зони escalation): object/array-помилки форми ("очікувався
// об'єкт/масив, отримано X") НЕ підіймаються до alarm -- лише чотири скалярні coerceXxx
// (Int/Float/Bool/String, вище) роблять це, бо саме їх стосується T8-зонд. Тест нижче
// фіксує межу навмисно, щоб майбутня правка не розширила escalation мовчки.
describe('parseConfig: не падає на неочікуваній формі даних', () => {
  test('null замість вкладеного об\'єкта -> попередження + дефолт, без винятку, severity лишається warn', () => {
    expect(() => {
      const { value, warnings } = parseConfig(
        RULES_FILE_SCHEMA,
        '{"ConfigVersion":1,"Rules":[{"Id":"x","InputItem":null}]}',
      )
      const r = (value as any).Rules[0]
      expect(r.InputItem).toEqual({ Classname: '', Quantity: 1, ConsumeInput: true, Content: '' })
      const w = warnings.find((x) => x.path === 'Rules[0].InputItem')
      expect(w).toBeDefined()
      expect(w!.severity).toBeUndefined()
    }).not.toThrow()
  })

  test('масив замість об\'єкта (InputItem: []) -> попередження + дефолт, без винятку', () => {
    expect(() => {
      const { value, warnings } = parseConfig(
        RULES_FILE_SCHEMA,
        '{"ConfigVersion":1,"Rules":[{"Id":"x","InputItem":[]}]}',
      )
      const r = (value as any).Rules[0]
      expect(r.InputItem).toEqual({ Classname: '', Quantity: 1, ConsumeInput: true, Content: '' })
      expect(warnings.some((w) => w.path === 'Rules[0].InputItem')).toBe(true)
    }).not.toThrow()
  })

  test('об\'єкт замість масиву (Rules: {}) -> попередження + порожній масив, без винятку', () => {
    expect(() => {
      const { value, warnings } = parseConfig(RULES_FILE_SCHEMA, '{"ConfigVersion":1,"Rules":{}}')
      expect((value as any).Rules).toEqual([])
      expect(warnings.some((w) => w.path === 'Rules')).toBe(true)
    }).not.toThrow()
  })

  test('весь документ не є об\'єктом -> попередження + дефолти схеми, без винятку', () => {
    expect(() => {
      const { value, warnings } = parseConfig(RULES_FILE_SCHEMA, '[1,2,3]')
      expect(value).toEqual({ ConfigVersion: 1, Rules: [] })
      expect(warnings.length).toBeGreaterThan(0)
    }).not.toThrow()
  })

  test('битий JSON-текст -> попередження, без винятку', () => {
    expect(() => {
      const { value, warnings } = parseConfig(RULES_FILE_SCHEMA, '{ не json')
      expect(value).toEqual({ ConfigVersion: 1, Rules: [] })
      expect(warnings.length).toBeGreaterThan(0)
    }).not.toThrow()
  })

  // Ревью W4/T1 (Important 1): нечитабельний JSON на сервері = LoadFile()==false — той
  // САМИЙ клас наслідків, що кривий тип (W2.7: рестарт = порожній реєстр, reload =
  // атомарна відмова). Раніше parse-провал давав warning БЕЗ severity (= warn) і файл
  // обходив гейт експорту, хоча вбивав сервер так само. Дискримінує стару поведінку.
  test('битий JSON-текст -> ALARM-severity (гейт W2.7 мусить ловити)', () => {
    const { warnings } = parseConfig(RULES_FILE_SCHEMA, '{ не json')
    expect(warnings.length).toBe(1)
    expect(warnings[0].severity).toBe('alarm')
    expect(warnings[0].message).toContain('ВЕСЬ файл')
  })
})

describe('parseConfig: дефолти не діляться посиланням між викликами (deep-copy)', () => {
  test('мутація value одного виклику не протікає в інший', () => {
    const first = parseConfig(RULES_FILE_SCHEMA, '{"ConfigVersion":1,"Rules":[{"Id":"x"}]}')
    ;(first.value as any).Rules[0].InputItem.Classname = 'ЗІПСОВАНО'
    const second = parseConfig(RULES_FILE_SCHEMA, '{"ConfigVersion":1,"Rules":[{"Id":"y"}]}')
    expect((second.value as any).Rules[0].InputItem.Classname).toBe('')
  })
})

// Мінімальна допоміжна схема — перевірка, що об'єкт-схема без реєстрації в SCHEMAS
// (тобто без відомого ConfigKind) все одно коректно парситься: просто без розпізнавання
// застарілих ключів (застарілі ключі прив'язані до ConfigKind, а не до довільної схеми).
const MINI: ObjectSchema = {
  name: 'Mini',
  fields: [
    { name: 'I', type: { kind: 'int' }, def: 7 },
    { name: 'F', type: { kind: 'float' }, def: 0.5 },
    { name: 'B', type: { kind: 'bool' }, def: true },
    { name: 'S', type: { kind: 'string' }, def: 'дефолт' },
    { name: 'A', type: { kind: 'string[]' }, def: [] },
  ],
}

describe('parseConfig: схема поза реєстром SCHEMAS (без ConfigKind)', () => {
  test('парситься нормально, просто немає розпізнавання застарілих ключів', () => {
    const { value, warnings } = parseConfig(MINI, '{"I":3,"F":0.25,"B":false,"S":"x","A":["a","b"]}')
    expect(value).toEqual({ I: 3, F: 0.25, B: false, S: 'x', A: ['a', 'b'] })
    expect(warnings).toEqual([])
  })

  test('рядок замість числа у string[] -> попередження + порожній рядок для елемента', () => {
    const { value, warnings } = parseConfig(MINI, '{"A":["ok",5,null]}')
    expect(value).toMatchObject({ A: ['ok', '', ''] })
    expect(warnings.some((w) => w.path === 'A[1]')).toBe(true)
    expect(warnings.some((w) => w.path === 'A[2]')).toBe(true)
  })
})
