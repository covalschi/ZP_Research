// Тести мутатора «Клонування з заміною» (W2.6 Task 5, TDD ДО коду діалогу):
// cloneRulesWithSubstitution (src/io/cloneStation.ts). Дисципліна та сама, що
// tests/stationEdit.test.ts: deep-copy до коміту (оригінал НЕ мутується), dirty=true лише
// на файлі-цілі, ідентичність об'єктів недирти файлів зберігається, явні відмови замість
// вгадування, дубль-гейт Id ДО запису.
//
// Семантика замін (бриф Task 5, звірено з живими прецедентами моду):
//   - kind='class': застосовується до Device/InputItem.Classname/Consumables[].Classname/
//     Outputs[].Classname/RequiredWorn[]/RequiredTools[] -- ЗАВЖДИ дзеркалить stripExact
//     (пайп-форма "X|N" зберігається, підміняється лише база ДО пайпа).
//   - kind='faction': застосовується ЛИШЕ до RequiredFactions[] -- точне порівняння без
//     пайпа (ZP_Factions.c:76/102, ZP_Processing.c:144 -- `array.Find`, не MatchClass).
//   - Content (InputItem.Content/Consumables[].Content/Outputs[].Content): АВТО-значення
//     (isAutoContent відносно СТАРОГО InputItem.Classname, sampleContent.ts) ПЕРЕРАХОВУЄТЬСЯ
//     через deriveOutputContent на НОВИЙ InputItem.Classname (той самий каскад, що
//     RulePanel.applyInputClassnameChange); РУЧНЕ значення підміняється лише на ТОЧНИЙ
//     (кейс-інсенситивний) збіг із `from` якогось class-рядка таблиці.
//   - RequiredNode -- НЕ чіпається НІКОЛИ (Id вузла дерева, не класнейм).
//   - Enabled клону -- ЗАВЖДИ false (та сама Step 1-семантика заготовок, що createStubRules).

import { describe, test, expect } from 'vitest'
import { parseConfig } from '../src/io/parse'
import { RULES_FILE_SCHEMA } from '../src/model/schema'
import { serialize } from '../src/io/jsonWriter'
import { loadClassIndex } from '../src/model/classIndex'
import type { ClassIndex } from '../src/model/classIndex'
import type { StorageBackend } from '../src/io/backend'
import type { Project, ProjectFile } from '../src/io/project'
import { cloneRulesWithSubstitution } from '../src/io/cloneStation'
import type { Substitution } from '../src/io/cloneStation'
import { createRulesFile } from '../src/io/stationEdit'

const idx: ClassIndex = loadClassIndex()

const dummyBackend: StorageBackend = {
  kind: 'zip',
  list: async () => [],
  read: async () => new Uint8Array(0),
  write: async () => {},
}

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

function rulesFile(path: string, jsonText: string): ProjectFile {
  const { value, warnings } = parseConfig(RULES_FILE_SCHEMA, jsonText)
  return { path, kind: 'rules', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function project(...files: ProjectFile[]): Project {
  return { files, backend: dummyBackend }
}

function docOf(p: Project, path: string): { ConfigVersion: number; Rules: Record<string, unknown>[] } {
  const f = p.files.find((x) => x.path === path)
  if (!f) throw new Error(`тестовий файл не знайдено: ${path}`)
  return f.parsed as { ConfigVersion: number; Rules: Record<string, unknown>[] }
}

function classSub(from: string, to: string): Substitution {
  return { kind: 'class', from, to }
}
function factionSub(from: string, to: string): Substitution {
  return { kind: 'faction', from, to }
}

// ---- Замінна станція (ідентичність = ZP_SampleFridge -> ZP_ChemBench) -----------------------

describe('cloneRulesWithSubstitution: базовий сценарій — станок + сировина', () => {
  test('клонує ОДНЕ правило: Device і InputItem.Classname підмінені, Id = old_копія, Enabled=false', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([rule('fridge_apple')])))
    const subs: Substitution[] = [classSub('ZP_SampleFridge', 'ZP_ChemBench')]
    const r = cloneRulesWithSubstitution(p, idx, 'ZP_SampleFridge', subs, 'ProcessingRules/a.json')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.created).toHaveLength(1)
    expect(r.created[0]).toMatchObject({ sourceFilePath: 'ProcessingRules/a.json', sourceRuleId: 'fridge_apple', newId: 'fridge_apple_копія' })
    expect(r.created[0].touchedFields).toContain('Device')
    const doc = docOf(r.project, 'ProcessingRules/a.json')
    expect(doc.Rules).toHaveLength(2)
    const clone = doc.Rules.find((x) => x.Id === 'fridge_apple_копія')!
    expect(clone.Device).toBe('ZP_ChemBench')
    expect(clone.Enabled).toBe(false)
    expect((clone.InputItem as Record<string, unknown>).Classname).toBe('Apple') // не в таблиці замін — лишається
    // Оригінал не зачеплений.
    const original = doc.Rules.find((x) => x.Id === 'fridge_apple')!
    expect(original.Device).toBe('ZP_SampleFridge')
    expect(original.Enabled).toBe(true)
  })

  test('клонує УСІ правила станка (кілька рядків), у порядку файлу', () => {
    const p = project(
      rulesFile(
        'ProcessingRules/a.json',
        rulesJson([rule('fridge_apple'), rule('fridge_pear', { InputItem: { Classname: 'Pear', Quantity: 1, ConsumeInput: true, Content: '' } }), rule('other', { Device: 'ZP_Microscope' })]),
      ),
    )
    const subs: Substitution[] = [classSub('ZP_SampleFridge', 'ZP_ChemBench')]
    const r = cloneRulesWithSubstitution(p, idx, 'ZP_SampleFridge', subs, 'ProcessingRules/a.json')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.created.map((c) => c.sourceRuleId)).toEqual(['fridge_apple', 'fridge_pear']) // 'other' належить іншому станку
    expect(r.created.map((c) => c.newId)).toEqual(['fridge_apple_копія', 'fridge_pear_копія'])
  })

  test('відмова: станок без жодного правила', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([rule('x', { Device: 'ZP_Microscope' })])))
    const r = cloneRulesWithSubstitution(p, idx, 'ZP_SampleFridge', [], 'ProcessingRules/a.json')
    expect(r.ok).toBe(false)
  })

  test('відмова: цільовий файл не існує', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([rule('fridge_apple')])))
    const r = cloneRulesWithSubstitution(p, idx, 'ZP_SampleFridge', [], 'ProcessingRules/nope.json')
    expect(r.ok).toBe(false)
  })
})

// ---- Пайп-форма ("X|N") зберігається через заміну -------------------------------------------

describe('cloneRulesWithSubstitution: пайп-форма класнейму', () => {
  test('Device="ZP_SampleFridge|1" -- підміняється БАЗА, пайп-суфікс лишається', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([rule('r1', { Device: 'ZP_SampleFridge|1' })])))
    const subs: Substitution[] = [classSub('ZP_SampleFridge', 'ZP_ChemBench')]
    const r = cloneRulesWithSubstitution(p, idx, 'ZP_SampleFridge|1', subs, 'ProcessingRules/a.json')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const doc = docOf(r.project, 'ProcessingRules/a.json')
    const clone = doc.Rules.find((x) => x.Id === 'r1_копія')!
    expect(clone.Device).toBe('ZP_ChemBench|1')
  })

  test('RequiredWorn/RequiredTools із пайпом підміняються так само', () => {
    const p = project(
      rulesFile(
        'ProcessingRules/a.json',
        rulesJson([rule('r1', { RequiredWorn: ['SGE_Jacket|1'], RequiredTools: ['SGE_Tool|1'] })]),
      ),
    )
    const subs: Substitution[] = [classSub('ZP_SampleFridge', 'ZP_ChemBench'), classSub('SGE_Jacket', 'SGE_Coat'), classSub('SGE_Tool', 'SGE_Multitool')]
    const r = cloneRulesWithSubstitution(p, idx, 'ZP_SampleFridge', subs, 'ProcessingRules/a.json')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const doc = docOf(r.project, 'ProcessingRules/a.json')
    const clone = doc.Rules.find((x) => x.Id === 'r1_копія')!
    expect(clone.RequiredWorn).toEqual(['SGE_Coat|1'])
    expect(clone.RequiredTools).toEqual(['SGE_Multitool|1'])
    expect(r.created[0].touchedFields).toEqual(expect.arrayContaining(['Device', 'RequiredWorn[0]', 'RequiredTools[0]']))
  })

  // Рев'ю фікс-раунду 1, IMPORTANT 1(b): Outputs[0].Classname з пайп-формою -- дзеркало
  // тесту Device/RequiredWorn вище, раніше ЖОДЕН тест не перевіряв заміну самого поля
  // Outputs[].Classname узагалі (лише його Content). Content навмисно РУЧНИЙ і не в
  // таблиці ('chimera_claw' -- не збігається ні зі старим InputItem.Classname 'Apple',
  // ні з жодним from-рядком) -- ізолює перевірку САМЕ пайп-поведінки Classname від
  // авто-каскаду Content (той окремо покритий describe 'Content' нижче).
  //
  // ПРИМІТКА (W2.6-фінал, фінальне whole-branch ревʼю, IMPORTANT 1): пайп-форма в
  // Outputs[].Classname -- САМА ПО СОБІ вже погана конфігурація (ZP_ProcessingConfig.c:326
  // -- ClassExists для Output перевіряється БЕЗ StripExact, сервер відхилить ЦІЛЕ правило
  // з таким виходом при завантаженні; ruleValidation.ts тепер підіймає на цьому alarm,
  // сьоме правило validateOutputNoPipe). Цей тест лишається ПРАВИЛЬНИМ і НЕ змінюється:
  // клонування зобов'язане чесно зберегти вхідні дані як є (навіть уже биті) -- саме
  // alarm-правило вище, а не мутатор клону, повинно повідомити адміну про проблему.
  test('Outputs[0].Classname="ZP_Sample|1" -- підміняється БАЗА, пайп-суфікс лишається', () => {
    const p = project(
      rulesFile(
        'ProcessingRules/a.json',
        rulesJson([rule('r1', { Outputs: [{ Classname: 'ZP_Sample|1', Quantity: 1, Chance: 1, Content: 'chimera_claw' }] })]),
      ),
    )
    const subs: Substitution[] = [classSub('ZP_Sample', 'ZP_Sample_07')]
    const r = cloneRulesWithSubstitution(p, idx, 'ZP_SampleFridge', subs, 'ProcessingRules/a.json')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const clone = docOf(r.project, 'ProcessingRules/a.json').Rules.find((x) => x.Id === 'r1_копія')!
    const out = (clone.Outputs as Record<string, unknown>[])[0]
    expect(out.Classname).toBe('ZP_Sample_07|1')
    expect(out.Content).toBe('chimera_claw') // ручний, без збігу в таблиці -- не займають
    expect(r.created[0].touchedFields).toContain('Outputs[0].Classname')
    expect(r.created[0].touchedFields).not.toContain('Outputs[0].Content')
  })
})

// ---- IMPORTANT 1(a): Outputs[0].Classname у ПЛОСКІЙ формі (без пайпа, не-зразковий клас) ----
// Раніше ЖОДЕН тест cloneStation.test.ts не перевіряв підміну цього поля взагалі -- увесь
// набір торкався лише Outputs[].Content. Не-зразковий клас (isSampleClass=false для
// вигаданого проміжного класнейму поза індексом) навмисно тримає авто-каскад Content
// осторонь -- рівно те саме розділення відповідальності, що demonstrated substituteClass
// vs substituteExact у коментарі io/cloneStation.ts.
describe('cloneRulesWithSubstitution: Outputs[].Classname (плоска форма)', () => {
  test('звичайний (не-зразковий) клас виходу підміняється табличним збігом, Content не займають', () => {
    const p = project(
      rulesFile(
        'ProcessingRules/a.json',
        rulesJson([rule('r1', { Outputs: [{ Classname: 'ZP_Interm_Ore', Quantity: 1, Chance: 1, Content: '' }] })]),
      ),
    )
    const subs: Substitution[] = [classSub('ZP_Interm_Ore', 'ZP_Interm_Ingot')]
    const r = cloneRulesWithSubstitution(p, idx, 'ZP_SampleFridge', subs, 'ProcessingRules/a.json')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const clone = docOf(r.project, 'ProcessingRules/a.json').Rules.find((x) => x.Id === 'r1_копія')!
    const out = (clone.Outputs as Record<string, unknown>[])[0]
    expect(out.Classname).toBe('ZP_Interm_Ingot')
    expect(out.Content).toBe('')
    expect(r.created[0].touchedFields).toContain('Outputs[0].Classname')
    expect(r.created[0].touchedFields).not.toContain('Outputs[0].Content')
  })
})

// ---- Авто/ручний Content --------------------------------------------------------------------

describe('cloneRulesWithSubstitution: Content -- авто-перерахунок і ручна підміна', () => {
  // Рев'ю фікс-раунду 1, IMPORTANT 1(c): комбінована перевірка -- Outputs[0].Classname
  // ТЕЖ підміняється таблицею (на ІНШИЙ зразковий клас, ZP_Sample -> ZP_Sample_07), а
  // авто-Content однаково йде за (можливо заміненим) InputItem.Classname, а НЕ за новим
  // класнеймом виходу і не за старим InputItem.Classname -- підміна поля Outputs[].
  // Classname і каскад Content НЕЗАЛЕЖНІ одна від одної (substituteClass на Classname не
  // впливає на те, ЯКЕ значення підставить каскад Content). Розширено (не задубльовано)
  // з попереднього рев'ю -- цей тест і раніше перевіряв авто-каскад Content, бракувало
  // лише одночасної заміни самого класнейму виходу.
  test('авто-Content виходу (== старий InputItem.Classname) перераховується на НОВИЙ InputItem.Classname; Outputs[].Classname підміняється незалежно', () => {
    const p = project(
      rulesFile(
        'ProcessingRules/a.json',
        rulesJson([rule('pack', { Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'Apple' }] })]),
      ),
    )
    const subs: Substitution[] = [classSub('ZP_SampleFridge', 'ZP_ChemBench'), classSub('Apple', 'Pear'), classSub('ZP_Sample', 'ZP_Sample_07')]
    const r = cloneRulesWithSubstitution(p, idx, 'ZP_SampleFridge', subs, 'ProcessingRules/a.json')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const doc = docOf(r.project, 'ProcessingRules/a.json')
    const clone = doc.Rules.find((x) => x.Id === 'pack_копія')!
    const out = (clone.Outputs as Record<string, unknown>[])[0]
    expect(out.Classname).toBe('ZP_Sample_07') // клас виходу підмінений таблицею -- ІНШИЙ зразковий клас, не старий 'ZP_Sample'
    expect(out.Content).toBe('Pear') // авто -> йде за НОВИМ InputItem.Classname, а не за таблицею напряму, не за 'ZP_Sample_07' і не за старим 'Apple'
    expect((clone.InputItem as Record<string, unknown>).Classname).toBe('Pear')
    expect(r.created[0].touchedFields).toEqual(
      expect.arrayContaining(['InputItem.Classname', 'Outputs[0].Classname', 'Outputs[0].Content']),
    )
  })

  test('порожній Content виходу (авто за визначенням) теж перераховується, якщо InputItem.Classname змінився', () => {
    const p = project(
      rulesFile('ProcessingRules/a.json', rulesJson([rule('pack', { Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: '' }] })])),
    )
    const subs: Substitution[] = [classSub('Apple', 'Pear')]
    const r = cloneRulesWithSubstitution(p, idx, 'ZP_SampleFridge', subs, 'ProcessingRules/a.json')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const clone = docOf(r.project, 'ProcessingRules/a.json').Rules.find((x) => x.Id === 'pack_копія')!
    expect((clone.Outputs as Record<string, unknown>[])[0].Content).toBe('Pear')
  })

  test('РУЧНИЙ Content виходу (не дорівнює старому InputItem.Classname) НЕ перераховується каскадом -- лише табличний збіг', () => {
    const p = project(
      rulesFile(
        'ProcessingRules/a.json',
        rulesJson([rule('pack', { Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'chimera_claw' }] })]),
      ),
    )
    const subs: Substitution[] = [classSub('Apple', 'Pear'), classSub('chimera_claw', 'chimera_hide')]
    const r = cloneRulesWithSubstitution(p, idx, 'ZP_SampleFridge', subs, 'ProcessingRules/a.json')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const clone = docOf(r.project, 'ProcessingRules/a.json').Rules.find((x) => x.Id === 'pack_копія')!
    // Ручний Content не збігається зі старим InputItem.Classname ('Apple') -> НЕ авто, тому йде
    // через табличну підміну content-рядка, а не через каскад InputItem.
    expect((clone.Outputs as Record<string, unknown>[])[0].Content).toBe('chimera_hide')
  })

  test('РУЧНИЙ Content без збігу в таблиці лишається без змін', () => {
    const p = project(
      rulesFile(
        'ProcessingRules/a.json',
        rulesJson([rule('pack', { Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'chimera_claw' }] })]),
      ),
    )
    const subs: Substitution[] = [classSub('Apple', 'Pear')]
    const r = cloneRulesWithSubstitution(p, idx, 'ZP_SampleFridge', subs, 'ProcessingRules/a.json')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const clone = docOf(r.project, 'ProcessingRules/a.json').Rules.find((x) => x.Id === 'pack_копія')!
    expect((clone.Outputs as Record<string, unknown>[])[0].Content).toBe('chimera_claw')
  })

  test('InputItem.Content (аналізатор) підміняється табличним збігом (не авто-каскад)', () => {
    const analyzer = rule('an', {
      Device: 'ZP_Microscope',
      InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: true, Content: 'Apple' },
    })
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([analyzer])))
    const subs: Substitution[] = [classSub('ZP_Microscope', 'ZP_ChemBench'), classSub('Apple', 'Pear')]
    const r = cloneRulesWithSubstitution(p, idx, 'ZP_Microscope', subs, 'ProcessingRules/a.json')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const clone = docOf(r.project, 'ProcessingRules/a.json').Rules.find((x) => x.Id === 'an_копія')!
    expect((clone.InputItem as Record<string, unknown>).Content).toBe('Pear')
    expect(r.created[0].touchedFields).toContain('InputItem.Content')
  })

  test('Consumables[].Content підміняється табличним збігом', () => {
    const p = project(
      rulesFile(
        'ProcessingRules/a.json',
        rulesJson([rule('r1', { Consumables: [{ Classname: 'Rag', Quantity: 1, Content: 'Apple' }] })]),
      ),
    )
    const subs: Substitution[] = [classSub('Rag', 'Bandage'), classSub('Apple', 'Pear')]
    const r = cloneRulesWithSubstitution(p, idx, 'ZP_SampleFridge', subs, 'ProcessingRules/a.json')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const clone = docOf(r.project, 'ProcessingRules/a.json').Rules.find((x) => x.Id === 'r1_копія')!
    const cons = (clone.Consumables as Record<string, unknown>[])[0]
    expect(cons.Classname).toBe('Bandage')
    expect(cons.Content).toBe('Pear')
    expect(r.created[0].touchedFields).toEqual(expect.arrayContaining(['Consumables[0].Classname', 'Consumables[0].Content']))
  })

  test('заміна БЕЗ впливу на InputItem.Classname лишає авто-Content виходу без змін (не touched)', () => {
    const p = project(
      rulesFile(
        'ProcessingRules/a.json',
        rulesJson([rule('pack', { Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'Apple' }] })]),
      ),
    )
    const subs: Substitution[] = [classSub('ZP_SampleFridge', 'ZP_ChemBench')] // Apple не в таблиці
    const r = cloneRulesWithSubstitution(p, idx, 'ZP_SampleFridge', subs, 'ProcessingRules/a.json')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.created[0].touchedFields).not.toContain('Outputs[0].Content')
    const clone = docOf(r.project, 'ProcessingRules/a.json').Rules.find((x) => x.Id === 'pack_копія')!
    expect((clone.Outputs as Record<string, unknown>[])[0].Content).toBe('Apple')
  })
})

// ---- Фракції -----------------------------------------------------------------------------

describe('cloneRulesWithSubstitution: RequiredFactions -- лише faction-рядки', () => {
  test('faction-рядок підміняє запис RequiredFactions', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([rule('r1', { RequiredFactions: ['ecolog'] })])))
    const subs: Substitution[] = [factionSub('ecolog', 'clearsky')]
    const r = cloneRulesWithSubstitution(p, idx, 'ZP_SampleFridge', subs, 'ProcessingRules/a.json')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const clone = docOf(r.project, 'ProcessingRules/a.json').Rules.find((x) => x.Id === 'r1_копія')!
    expect(clone.RequiredFactions).toEqual(['clearsky'])
    expect(r.created[0].touchedFields).toContain('RequiredFactions[0]')
  })

  test('class-рядок з тим самим текстом НЕ підміняє RequiredFactions (різні простори замін)', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([rule('r1', { RequiredFactions: ['ecolog'] })])))
    const subs: Substitution[] = [classSub('ecolog', 'clearsky')]
    const r = cloneRulesWithSubstitution(p, idx, 'ZP_SampleFridge', subs, 'ProcessingRules/a.json')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const clone = docOf(r.project, 'ProcessingRules/a.json').Rules.find((x) => x.Id === 'r1_копія')!
    expect(clone.RequiredFactions).toEqual(['ecolog'])
  })

  test('faction-рядок НЕ підміняє класнеймові поля (Device лишається)', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([rule('r1')])))
    const subs: Substitution[] = [factionSub('ZP_SampleFridge', 'ZP_ChemBench')]
    const r = cloneRulesWithSubstitution(p, idx, 'ZP_SampleFridge', subs, 'ProcessingRules/a.json')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const clone = docOf(r.project, 'ProcessingRules/a.json').Rules.find((x) => x.Id === 'r1_копія')!
    expect(clone.Device).toBe('ZP_SampleFridge')
  })
})

// ---- RequiredNode ніколи не чіпається ---------------------------------------------------

describe('cloneRulesWithSubstitution: RequiredNode', () => {
  test('RequiredNode лишається дослівно, навіть якщо його текст збігається з рядком таблиці', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([rule('r1', { RequiredNode: 'Apple' })])))
    const subs: Substitution[] = [classSub('Apple', 'Pear')]
    const r = cloneRulesWithSubstitution(p, idx, 'ZP_SampleFridge', subs, 'ProcessingRules/a.json')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const clone = docOf(r.project, 'ProcessingRules/a.json').Rules.find((x) => x.Id === 'r1_копія')!
    expect(clone.RequiredNode).toBe('Apple')
    expect(r.created[0].touchedFields).not.toContain('RequiredNode')
  })
})

// ---- Id: дефолт+суфікс, overrides, дубль-гейт --------------------------------------------

describe('cloneRulesWithSubstitution: генерація Id', () => {
  test('колізія дефолтного "_копія" з уже наявним Id -- автосуфікс _2 (той самий uniqueId, що createStubRules)', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([rule('r1'), rule('r1_копія', { Device: 'ZP_Microscope' })])))
    const r = cloneRulesWithSubstitution(p, idx, 'ZP_SampleFridge', [], 'ProcessingRules/a.json')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.created[0].newId).toBe('r1_копія_2')
  })

  test('idOverrides: непорожній рядок для позиції -- явний Id замість дефолту', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([rule('r1')])))
    const r = cloneRulesWithSubstitution(p, idx, 'ZP_SampleFridge', [], 'ProcessingRules/a.json', ['r1_chembench'])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.created[0].newId).toBe('r1_chembench')
  })

  test('idOverrides: порожній рядок для позиції -- падає назад на дефолт', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([rule('r1')])))
    const r = cloneRulesWithSubstitution(p, idx, 'ZP_SampleFridge', [], 'ProcessingRules/a.json', [''])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.created[0].newId).toBe('r1_копія')
  })

  test('idOverrides, що колізує з наявним Id проєкту -- ВІДМОВА (не автосуфіксується мовчки)', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([rule('r1'), rule('taken', { Device: 'ZP_Microscope' })])))
    const r = cloneRulesWithSubstitution(p, idx, 'ZP_SampleFridge', [], 'ProcessingRules/a.json', ['taken'])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('taken')
  })

  test('idOverrides кейс-інсенситивно колізує з наявним Id -- відмова', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([rule('r1'), rule('Taken', { Device: 'ZP_Microscope' })])))
    const r = cloneRulesWithSubstitution(p, idx, 'ZP_SampleFridge', [], 'ProcessingRules/a.json', ['taken'])
    expect(r.ok).toBe(false)
  })

  test('два idOverrides, що колізують ОДИН З ОДНИМ усередині партії -- відмова, повідомлення перелічує обидва', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([rule('r1'), rule('r2', { Device: 'ZP_SampleFridge' })])))
    const r = cloneRulesWithSubstitution(p, idx, 'ZP_SampleFridge', [], 'ProcessingRules/a.json', ['dup', 'dup'])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('dup')
  })

  test('відмова на дублі НЕ мутує project (ідентичність файлів збережена)', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([rule('r1'), rule('taken', { Device: 'ZP_Microscope' })])))
    const beforeFile = p.files[0]
    const r = cloneRulesWithSubstitution(p, idx, 'ZP_SampleFridge', [], 'ProcessingRules/a.json', ['taken'])
    expect(r.ok).toBe(false)
    expect(p.files[0]).toBe(beforeFile)
    expect((beforeFile.parsed as { Rules: unknown[] }).Rules).toHaveLength(2)
  })
})

// ---- Цільовий файл: новий файл, той самий файл, дисципліна дзеркала ------------------------

describe('cloneRulesWithSubstitution: цільовий файл і дисципліна мутації', () => {
  test('клони лягають у НОВОСТВОРЕНИЙ файл (createRulesFile + targetFilePath)', () => {
    const created = createRulesFile(project(rulesFile('ProcessingRules/a.json', rulesJson([rule('r1')]))), 'nova')
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const r = cloneRulesWithSubstitution(created.project, idx, 'ZP_SampleFridge', [], created.path)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const doc = docOf(r.project, created.path)
    expect(doc.Rules).toHaveLength(1)
    expect(doc.Rules[0].Id).toBe('r1_копія')
    // Файл-джерело (a.json) НЕ зачеплений.
    const src = docOf(r.project, 'ProcessingRules/a.json')
    expect(src.Rules).toHaveLength(1)
  })

  test('НЕ-target файли проєкту зберігають ІДЕНТИЧНІСТЬ посилання (дрібна мутація не чіпає решту)', () => {
    const p = project(
      rulesFile('ProcessingRules/a.json', rulesJson([rule('r1')])),
      rulesFile('ProcessingRules/b.json', rulesJson([rule('other', { Device: 'ZP_Microscope' })])),
    )
    const untouchedFile = p.files[1]
    const r = cloneRulesWithSubstitution(p, idx, 'ZP_SampleFridge', [], 'ProcessingRules/a.json')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.project.files[1]).toBe(untouchedFile)
    const targetFile = r.project.files.find((f) => f.path === 'ProcessingRules/a.json')!
    expect(targetFile.dirty).toBe(true)
  })

  test('оригінальний Project.files[0] (джерело=ціль, той самий файл) лишається НЕЗМІНЕНИМ об\'єктом -- мутація йде по копії', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([rule('r1')])))
    const originalFileObj = p.files[0]
    const originalParsed = originalFileObj.parsed
    const r = cloneRulesWithSubstitution(p, idx, 'ZP_SampleFridge', [classSub('ZP_SampleFridge', 'ZP_ChemBench')], 'ProcessingRules/a.json')
    expect(r.ok).toBe(true)
    expect(p.files[0]).toBe(originalFileObj)
    expect(p.files[0].parsed).toBe(originalParsed)
    expect((originalParsed as { Rules: unknown[] }).Rules).toHaveLength(1) // оригінал не приріс клоном
  })

  test('джерело=ціль: клон додається в ТОЙ САМИЙ файл, що і оригінал (2 правила на виході)', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([rule('r1')])))
    const r = cloneRulesWithSubstitution(p, idx, 'ZP_SampleFridge', [], 'ProcessingRules/a.json')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(docOf(r.project, 'ProcessingRules/a.json').Rules).toHaveLength(2)
  })
})

// ---- Канонічність запису -----------------------------------------------------------------

describe('cloneRulesWithSubstitution: канонічність результату', () => {
  test('клонований документ серіалізується канонічно (усі поля схеми, без попереджень при повторному розборі)', () => {
    const p = project(
      rulesFile(
        'ProcessingRules/a.json',
        rulesJson([
          rule('r1', {
            Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'Apple' }],
            RequiredFactions: ['ecolog'],
            RequiredWorn: ['SGE_Jacket|1'],
          }),
        ]),
      ),
    )
    const subs: Substitution[] = [classSub('ZP_SampleFridge', 'ZP_ChemBench'), classSub('Apple', 'Pear'), factionSub('ecolog', 'clearsky')]
    const r = cloneRulesWithSubstitution(p, idx, 'ZP_SampleFridge', subs, 'ProcessingRules/a.json')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const file = r.project.files.find((f) => f.path === 'ProcessingRules/a.json')!
    const text = serialize(RULES_FILE_SCHEMA, file.parsed)
    const re = parseConfig(RULES_FILE_SCHEMA, text)
    expect(re.warnings).toEqual([])
    expect(serialize(RULES_FILE_SCHEMA, re.value)).toBe(text)
  })
})
