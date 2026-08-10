// Тести моделі графа ланцюгів (W2 Task 4). matchInputMirror мусить бути ПОБАЙТОВИМ
// дзеркалом ZP_ProcessingRules.MatchClass/MatchInput (ZP_ProcessingConfig.c:135-171,
// коментар-джерело — у самому chainGraph.ts над функцією): якщо тут розійдеться з
// сервером, граф покаже адміну ребро там, де правило в грі ніколи не спрацює, або
// "розрив" там, де все насправді працює.

import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseConfig } from '../src/io/parse'
import { RULES_FILE_SCHEMA } from '../src/model/schema'
import { loadClassIndex } from '../src/model/classIndex'
import type { ClassIndex } from '../src/model/classIndex'
import type { StorageBackend } from '../src/io/backend'
import type { Project, ProjectFile } from '../src/io/project'
import { buildChainGraph, matchInputMirror } from '../src/model/chainGraph'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, 'fixtures')

function fixtureText(rel: string): string {
  return readFileSync(join(FIXTURES, rel), 'utf8')
}

// Реальний згенерований індекс (T1) -- ТІ САМІ класи, що спот-чек classIndex.test.ts
// вважає обов'язковими (ZP_Microscope : ZP_StaticDevice_Base, ZP_Sample, ZP_Data_01,
// Apple, Rag), тож клас-матчинг тут перевіряється на реальних відносинах спадкування,
// а не на вигаданій фікстурі -- саме так, як просить бриф Task 4.
const idx: ClassIndex = loadClassIndex()

// Project без реального бекенда -- buildChainGraph читає лише project.files, бекенд йому
// не потрібен; фіктивний об'єкт лише закриває тип Project.
const dummyBackend: StorageBackend = {
  kind: 'zip',
  list: async () => [],
  read: async () => new Uint8Array(0),
  write: async () => {},
}

function rulesFile(path: string, jsonText: string): ProjectFile {
  const { value, warnings } = parseConfig(RULES_FILE_SCHEMA, jsonText)
  return { path, kind: 'rules', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function project(...files: ProjectFile[]): Project {
  return { files, backend: dummyBackend }
}

// Мінімальний ZP_Rule-об'єкт у JSON-тексті -- усі обов'язкові поля схеми присутні (щоб не
// піднімати попереджень "ключ відсутній", які тут не тестуються), значення підставляються
// через override.
function rule(id: string, override: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Id: id,
    Enabled: true,
    Device: 'ZP_SampleFridge',
    Mode: 'background',
    InputItem: { Classname: 'Apple', Quantity: 1, ConsumeInput: true, Content: '' },
    BasePurityMin: 0.5,
    BasePurityMax: 0.5,
    TimeSec: 10,
    Consumables: [],
    Outputs: [],
    RequiredNode: '',
    RequiredFactions: [],
    RequiredWorn: [],
    RequiredTools: [],
    Notes: '',
    ...override,
  }
}

function rulesJson(rules: Record<string, unknown>[]): string {
  return JSON.stringify({ ConfigVersion: 1, Rules: rules })
}

// ---- matchInputMirror: прямі тести семантики (Task 4 Step 1, два питання брифа) ----------

describe('matchInputMirror: клас', () => {
  test('точний збіг класу (реальний ванільний клас Apple)', () => {
    expect(matchInputMirror('Apple', '', 'Apple', '', idx)).toBe(true)
  })

  test('IsKindOf через індекс: нащадок задовольняє базовий клас (ZP_Microscope : ZP_StaticDevice_Base)', () => {
    // Ті самі два реальних класи, що вже звірені в classIndex.test.ts (T1 CRITICAL 1
    // repro): ZP_Microscope успадковується від ZP_StaticDevice_Base.
    expect(matchInputMirror('ZP_Microscope', '', 'ZP_StaticDevice_Base', '', idx)).toBe(true)
  })

  test('"|1" НЕ матчить нащадка -- лише точне ім\'я', () => {
    expect(matchInputMirror('ZP_Microscope', '', 'ZP_StaticDevice_Base|1', '', idx)).toBe(false)
    expect(matchInputMirror('ZP_StaticDevice_Base', '', 'ZP_StaticDevice_Base|1', '', idx)).toBe(true)
  })

  // Рев'ю фікс-раунду 1, CRITICAL 1 (емпірично доведено): сервер шукає ПЕРШИЙ "|" де
  // завгодно в configuredClass і бере точну назву як усе ДО НЬОГО -- "|1" є лише
  // найпоширенішою конвенцією позначки в конфігах адмінів, не єдиною формою, яку приймає
  // сервер. "ZP_Sample|2"/"ZP_Sample|" валідувались і матчились би в грі так само.
  test('пайп-форма НЕ обмежена суфіксом "|1" -- будь-яке число чи порожньо після пайпа', () => {
    expect(matchInputMirror('ZP_StaticDevice_Base', '', 'ZP_StaticDevice_Base|2', '', idx)).toBe(true)
    expect(matchInputMirror('ZP_StaticDevice_Base', '', 'ZP_StaticDevice_Base|', '', idx)).toBe(true) // порожньо після пайпа
    // ...і так само НЕ матчить нащадка незалежно від того, що після пайпа.
    expect(matchInputMirror('ZP_Microscope', '', 'ZP_StaticDevice_Base|2', '', idx)).toBe(false)
    expect(matchInputMirror('ZP_Microscope', '', 'ZP_StaticDevice_Base|', '', idx)).toBe(false)
  })

  test('порожній configuredClass -- false (MatchClass: `if (configured == "") return false`)', () => {
    expect(matchInputMirror('Apple', '', '', '', idx)).toBe(false)
  })

  test('непов\'язані класи -- false', () => {
    expect(matchInputMirror('Apple', '', 'Rag', '', idx)).toBe(false)
  })

  test('кейс-інсенситивність класу: вихід у нижньому регістрі задовольняє вхід у канонічному', () => {
    expect(matchInputMirror('zp_sample', '', 'ZP_Sample', '', idx)).toBe(true)
  })
})

describe('matchInputMirror: Content (два питання брифа, перевірено по .c)', () => {
  test('порожній вхідний Content = "будь-який" -- матчиться НЕЗАЛЕЖНО від Content виходу', () => {
    expect(matchInputMirror('ZP_Sample', 'chimera_claw', 'ZP_Sample', '', idx)).toBe(true)
    expect(matchInputMirror('ZP_Sample', '', 'ZP_Sample', '', idx)).toBe(true)
  })

  test('непорожній Content: точний збіг (регістронезалежно з ОБОХ боків -- want.ToLower()/have.ToLower())', () => {
    expect(matchInputMirror('ZP_Sample', 'Chimera_Claw', 'ZP_Sample', 'chimera_claw', idx)).toBe(true)
    expect(matchInputMirror('ZP_Sample', 'chimera_claw', 'ZP_Sample', 'CHIMERA_CLAW', idx)).toBe(true)
  })

  test('непорожній Content: різні рядки -- false', () => {
    expect(matchInputMirror('ZP_Sample', 'bloodsucker_gland', 'ZP_Sample', 'chimera_claw', idx)).toBe(false)
  })

  // Питання 2 брифа: "вихід без Content проти входу з Content" -- перевірено рядками
  // 164-169 ZP_ProcessingConfig.c: have="" != want="chimera_claw" -> false.
  test('вихід БЕЗ Content НЕ задовольняє вхід із вимогою до Content', () => {
    expect(matchInputMirror('ZP_Sample', '', 'ZP_Sample', 'chimera_claw', idx)).toBe(false)
  })
})

// ---- buildChainGraph: інтеграційні тести ---------------------------------------------------

describe('buildChainGraph: ребра', () => {
  test('chain.json: pack -> analyze ребра за Content, крос-пари відсутні', () => {
    const p = project(rulesFile('ProcessingRules/chain.json', fixtureText('live/chain.json')))
    const { nodes, edges } = buildChainGraph(p, idx)

    expect(nodes.map((n) => n.ruleId).sort()).toEqual(
      ['chain_analyze_bloodsucker', 'chain_analyze_chimera', 'chain_pack_bloodsucker', 'chain_pack_chimera'].sort(),
    )

    expect(edges).toContainEqual({
      fromRuleId: 'chain_pack_chimera',
      toRuleId: 'chain_analyze_chimera',
      classname: 'ZP_Sample',
      content: 'chimera_claw',
    })
    expect(edges).toContainEqual({
      fromRuleId: 'chain_pack_bloodsucker',
      toRuleId: 'chain_analyze_bloodsucker',
      classname: 'ZP_Sample',
      content: 'bloodsucker_gland',
    })
    // Різний Content -- pack_chimera НЕ живить analyze_bloodsucker і навпаки.
    expect(edges.some((e) => e.fromRuleId === 'chain_pack_chimera' && e.toRuleId === 'chain_analyze_bloodsucker')).toBe(false)
    expect(edges.some((e) => e.fromRuleId === 'chain_pack_bloodsucker' && e.toRuleId === 'chain_analyze_chimera')).toBe(false)
    expect(edges.length).toBe(2)
    expect(nodes.every((n) => !n.disabled)).toBe(true)
  })

  test('вимкнене правило (Enabled=false): вузол є, ребра ЗІ і ДО нього відсутні', () => {
    const producer = rule('producer', { Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'x' }], Enabled: false })
    const consumer = rule('consumer', {
      Device: 'ZP_Microscope',
      InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: true, Content: 'x' },
    })
    const p = project(rulesFile('ProcessingRules/r.json', rulesJson([producer, consumer])))
    const { nodes, edges } = buildChainGraph(p, idx)

    const producerNode = nodes.find((n) => n.ruleId === 'producer')
    expect(producerNode?.disabled).toBe(true)
    expect(nodes.find((n) => n.ruleId === 'consumer')?.disabled).toBe(false)
    expect(edges).toEqual([]) // вимкнений вихід не рахується виробленим -- ребра немає
  })

  test('Consumable теж бере участь у матчингу ребра (та сама MatchInput, що й InputItem)', () => {
    const producer = rule('producer', { Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'reagent' }] })
    const consumer = rule('consumer', {
      Device: 'ZP_Microscope',
      InputItem: { Classname: 'Apple', Quantity: 1, ConsumeInput: true, Content: '' },
      Consumables: [{ Classname: 'ZP_Sample', Quantity: 1, Content: 'reagent' }],
    })
    const p = project(rulesFile('ProcessingRules/r.json', rulesJson([producer, consumer])))
    const { edges } = buildChainGraph(p, idx)
    expect(edges).toContainEqual({ fromRuleId: 'producer', toRuleId: 'consumer', classname: 'ZP_Sample', content: 'reagent' })
  })

  test('той самий вихід, що задовольняє і InputItem, і Consumable того самого правила -- ОДНЕ ребро', () => {
    const producer = rule('producer', { Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'x' }] })
    const consumer = rule('consumer', {
      Device: 'ZP_Microscope',
      InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: true, Content: '' }, // "" = будь-який -- теж матчиться
      Consumables: [{ Classname: 'ZP_Sample', Quantity: 1, Content: 'x' }],
    })
    const p = project(rulesFile('ProcessingRules/r.json', rulesJson([producer, consumer])))
    const { edges } = buildChainGraph(p, idx)
    expect(edges.filter((e) => e.fromRuleId === 'producer' && e.toRuleId === 'consumer')).toHaveLength(1)
  })
})

describe('buildChainGraph: розриви', () => {
  test('dead-output: вихід ZP_Sample із Content, якого ніхто не бере', () => {
    const producer = rule('producer', { Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'orphan' }] })
    const p = project(rulesFile('ProcessingRules/r.json', rulesJson([producer])))
    const { breaks } = buildChainGraph(p, idx)
    expect(breaks).toContainEqual({
      kind: 'dead-output',
      ruleId: 'producer',
      filePath: 'ProcessingRules/r.json',
      classname: 'ZP_Sample',
      content: 'orphan',
      message: expect.stringContaining('orphan'),
    })
  })

  // Мінор (a) рев'ю фікс-раунду 1: раніше не було прямого тесту, що прив'язує "вимкнений
  // СПОЖИВАЧ не рятує від dead-output" -- на відміну від "вимкнений виробник" (тест нижче
  // в цьому ж describe), тут виробник УВІМКНЕНИЙ, а вимкнено саме той ЄДИНИЙ консумер, що
  // міг би взяти вихід. Розрив мусить лишитись: вимкнене правило виключене з матчингу
  // повністю (не рахується консумером), а не лише "не отримує ребра".
  test('dead-output лишається, якщо ЄДИНИЙ можливий споживач вимкнений (виробник увімкнений)', () => {
    const producer = rule('producer', { Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'x' }] })
    const disabledConsumer = rule('consumer', {
      Enabled: false,
      Device: 'ZP_Microscope',
      InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: true, Content: 'x' },
    })
    const p = project(rulesFile('ProcessingRules/r.json', rulesJson([producer, disabledConsumer])))
    const { edges, breaks } = buildChainGraph(p, idx)
    expect(edges).toEqual([]) // вимкнений консумер не отримує ребра
    expect(breaks).toContainEqual({
      kind: 'dead-output',
      ruleId: 'producer',
      filePath: 'ProcessingRules/r.json',
      classname: 'ZP_Sample',
      content: 'x',
      message: expect.stringContaining('x'),
    })
  })

  test('unfed-input: InputItem вимагає Content, якого ніхто не виробляє', () => {
    const consumer = rule('consumer', {
      Device: 'ZP_Microscope',
      InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: true, Content: 'missing' },
    })
    const p = project(rulesFile('ProcessingRules/r.json', rulesJson([consumer])))
    const { breaks } = buildChainGraph(p, idx)
    expect(breaks).toContainEqual({
      kind: 'unfed-input',
      ruleId: 'consumer',
      filePath: 'ProcessingRules/r.json',
      classname: 'ZP_Sample',
      content: 'missing',
      message: expect.stringContaining('missing'),
    })
  })

  test('unfed-input: Consumable теж може бути "розривом", якщо ніхто не виробляє', () => {
    const consumer = rule('consumer', {
      Consumables: [{ Classname: 'ZP_Sample', Quantity: 1, Content: 'missing_reagent' }],
    })
    const p = project(rulesFile('ProcessingRules/r.json', rulesJson([consumer])))
    const { breaks } = buildChainGraph(p, idx)
    expect(breaks.some((b) => b.kind === 'unfed-input' && b.content === 'missing_reagent' && b.ruleId === 'consumer')).toBe(true)
  })

  test('замкнений ланцюг (chain.json) без розривів -- pack/analyze закривають одне одного', () => {
    const p = project(rulesFile('ProcessingRules/chain.json', fixtureText('live/chain.json')))
    const { breaks } = buildChainGraph(p, idx)
    expect(breaks).toEqual([])
  })

  test('ZP_Data_* вихід БЕЗ Content і без споживача -- НЕ розрив (термінал здачі за задумом)', () => {
    const analyze = rule('analyze', {
      Device: 'ZP_Microscope',
      InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: true, Content: 'x' },
      Outputs: [{ Classname: 'ZP_Data_01', Quantity: 1, Chance: 1, Content: '' }],
    })
    const pack = rule('pack', { Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'x' }] })
    const p = project(rulesFile('ProcessingRules/r.json', rulesJson([pack, analyze])))
    const { breaks } = buildChainGraph(p, idx)
    expect(breaks.some((b) => b.classname === 'ZP_Data_01')).toBe(false)
  })

  test('звичайна сировина (Apple) БЕЗ виробника -- НЕ розрив (джерело світу/CE, а не іншого правила)', () => {
    const pack = rule('pack', { InputItem: { Classname: 'Apple', Quantity: 1, ConsumeInput: true, Content: '' } })
    const p = project(rulesFile('ProcessingRules/r.json', rulesJson([pack])))
    const { breaks } = buildChainGraph(p, idx)
    expect(breaks).toEqual([])
  })

  test('вимкнене правило не породжує і не гасить розриви (виключене з аналізу повністю)', () => {
    // Вимкнений виробник -- увімкнений споживач БЕЗ жодного іншого джерела: unfed-input,
    // бо вимкнений виробник не рахується таким, що щось виробляє.
    const producer = rule('producer', { Enabled: false, Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'x' }] })
    const consumer = rule('consumer', {
      Device: 'ZP_Microscope',
      InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: true, Content: 'x' },
    })
    const p = project(rulesFile('ProcessingRules/r.json', rulesJson([producer, consumer])))
    const { breaks } = buildChainGraph(p, idx)
    expect(breaks.some((b) => b.kind === 'unfed-input' && b.ruleId === 'consumer' && b.content === 'x')).toBe(true)
    // І вимкнений виробник теж НЕ дає dead-output за себе -- вимкнене правило не аналізується.
    expect(breaks.some((b) => b.ruleId === 'producer')).toBe(false)
  })
})

describe('buildChainGraph: правило без Id пропускається (дзеркало AddFileRules)', () => {
  test('порожній Id -- вузол не створюється', () => {
    const withId = rule('ok')
    const withoutId = rule('') // Id: ''
    const p = project(rulesFile('ProcessingRules/r.json', rulesJson([withId, withoutId])))
    const { nodes } = buildChainGraph(p, idx)
    expect(nodes.map((n) => n.ruleId)).toEqual(['ok'])
  })
})

describe('buildChainGraph: некоректний/чужий файл ігнорується без падіння', () => {
  test('файл kind !== "rules" не бере участі в графі', () => {
    const foreign: ProjectFile = {
      path: 'StaticDevices.json',
      kind: 'foreign',
      originalBytes: new Uint8Array(0),
      warnings: [],
      dirty: false,
    }
    const p = project(foreign, rulesFile('ProcessingRules/r.json', rulesJson([rule('ok')])))
    const { nodes } = buildChainGraph(p, idx)
    expect(nodes.map((n) => n.ruleId)).toEqual(['ok'])
  })
})
