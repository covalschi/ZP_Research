// Тести інлайн-валідації RulePanel (W2 Task 6 + W2-фінал + W2.6 fix-round-1) — шість
// правил, дзеркальні до ZP_ProcessingConfig.c:ValidateRule, процитовані прямо в
// коментарях ruleValidation.ts.

import { describe, test, expect } from 'vitest'
import { loadClassIndex } from '../src/model/classIndex'
import type { ClassIndex } from '../src/model/classIndex'
import {
  validateTimeSec,
  validateBasePurity,
  validateClassField,
  validateConsumeInput,
  validateDeviceRequired,
  validateOutputNoPipe,
  validateRequiredListItem,
  validateInputClassnameRequired,
  validateQuantity,
  validateChance,
  validateContentMirror,
  validateSampleOutputContent,
  validateBasePurityLoaderDefault,
  validateRule,
  fieldErrors,
} from '../src/model/ruleValidation'

const idx: ClassIndex = loadClassIndex()

describe('validateTimeSec (ZP_ProcessingConfig.c:120,271-272,283-284)', () => {
  test('у межах [5..604800] — без помилок', () => {
    expect(validateTimeSec(10)).toEqual([])
    expect(validateTimeSec(5)).toEqual([])
    expect(validateTimeSec(604800)).toEqual([])
  })

  test('менший за 5 — alarm', () => {
    const errs = validateTimeSec(4.9)
    expect(errs).toHaveLength(1)
    expect(errs[0]).toMatchObject({ path: 'TimeSec', severity: 'alarm' })
  })

  test('більший за 604800 — alarm', () => {
    const errs = validateTimeSec(604801)
    expect(errs).toHaveLength(1)
    expect(errs[0]).toMatchObject({ path: 'TimeSec', severity: 'alarm' })
  })
})

describe('validateBasePurity (ZP_ProcessingConfig.c:275-282)', () => {
  test('у межах, Min<=Max — без помилок', () => {
    expect(validateBasePurity(0.5, 0.5)).toEqual([])
    expect(validateBasePurity(0, 2)).toEqual([])
  })

  test('Min поза [0..2] — alarm на BasePurityMin', () => {
    const errs = validateBasePurity(-0.1, 0.5)
    expect(errs.some((e) => e.path === 'BasePurityMin' && e.severity === 'alarm')).toBe(true)
  })

  test('Max поза [0..2] — alarm на BasePurityMax', () => {
    const errs = validateBasePurity(0.5, 2.1)
    expect(errs.some((e) => e.path === 'BasePurityMax' && e.severity === 'alarm')).toBe(true)
  })

  test('Max < Min — alarm на BasePurityMax (переставлений діапазон)', () => {
    const errs = validateBasePurity(0.8, 0.4)
    expect(errs.some((e) => e.path === 'BasePurityMax' && /менший за BasePurityMin/.test(e.message))).toBe(true)
  })
})

describe('validateClassField (ZP_ProcessingConfig.c:313-317 + unknown-class warning)', () => {
  test('порожній класнейм — без помилок (поле ще не заповнене)', () => {
    expect(validateClassField('Device', '', idx, false)).toEqual([])
  })

  test('CfgMagazines + magazineCheck=true — alarm', () => {
    // Ammo/magazine класи в індексі кореня 1 (CfgMagazines) — беремо перший з індексу,
    // щоб не залежати від конкретного ванільного імені (модпак може змінитись).
    const magClass = idx.classes.find((c) => c[3] === 1)?.[0]
    expect(magClass).toBeDefined()
    if (!magClass) return
    const errs = validateClassField('InputItem.Classname', magClass, idx, true)
    expect(errs).toHaveLength(1)
    expect(errs[0]).toMatchObject({ path: 'InputItem.Classname', severity: 'alarm' })
    expect(errs[0].message).toMatch(/CfgMagazines/)
  })

  test('CfgMagazines + magazineCheck=false (Device/Outputs) — сервер це НЕ перевіряє, помилки немає', () => {
    const magClass = idx.classes.find((c) => c[3] === 1)?.[0]
    if (!magClass) return
    expect(validateClassField('Device', magClass, idx, false)).toEqual([])
  })

  test('клас поза індексом — warn, не alarm (allowFree — легітимний шлях)', () => {
    const errs = validateClassField('Device', 'ZZZ_TotallyUnknownClassNoOneHas', idx, false)
    expect(errs).toHaveLength(1)
    expect(errs[0]).toMatchObject({ severity: 'warn' })
  })

  test('відомий не-магазинний клас — без помилок', () => {
    const knownClass = idx.classes.find((c) => c[3] !== 1)?.[0]
    if (!knownClass) return
    expect(validateClassField('Device', knownClass, idx, true)).toEqual([])
  })

  test('пайп-форма "|N" зрізається перед перевіркою (StripExact)', () => {
    const knownClass = idx.classes.find((c) => c[3] !== 1)?.[0]
    if (!knownClass) return
    expect(validateClassField('Device', `${knownClass}|1`, idx, true)).toEqual([])
  })
})

describe('validateDeviceRequired (ZP_ProcessingConfig.c:135-151/318-320 -- W2.6 fix-round-1 IMPORTANT 2, формулювання виправлено W2.6-фінал IMPORTANT 3 зондом на стенді: Device="" ЗАВАНТАЖУЄТЬСЯ, MatchClass робить правило мертвим назавжди)', () => {
  test('порожній Device -- alarm (раніше НЕВИДИМО через generic-скіп validateClassField)', () => {
    const errs = validateDeviceRequired('')
    expect(errs).toHaveLength(1)
    expect(errs[0]).toMatchObject({ path: 'Device', severity: 'alarm' })
    expect(errs[0].message).toBe('мертве правило: ніколи не стартує (MatchClass по порожньому Device)')
  })

  test('Device лише з пробілів -- alarm (trim до перевірки)', () => {
    expect(validateDeviceRequired('   ')).toHaveLength(1)
  })

  test('Device лише з пайп-суфіксом без імені ("|1") -- alarm (StripExact до перевірки)', () => {
    expect(validateDeviceRequired('|1')).toHaveLength(1)
  })

  test('непорожній Device -- без помилок (шосте правило не спрацьовує на валідному значенні)', () => {
    expect(validateDeviceRequired('ZP_SampleFridge')).toEqual([])
    expect(validateDeviceRequired('ZZZ_TotallyUnknownClassNoOneHas')).toEqual([]) // невідомий клас -- то вже validateClassField (warn), не це правило
  })
})

describe('validateConsumeInput (ZP_ProcessingConfig.c:347-348 -- Mode=background завжди в цій формі)', () => {
  test('ConsumeInput=true -- без помилок', () => {
    expect(validateConsumeInput(true)).toEqual([])
  })

  test('ConsumeInput=false -- alarm: сервер пропустить правило при завантаженні', () => {
    const errs = validateConsumeInput(false)
    expect(errs).toHaveLength(1)
    expect(errs[0]).toMatchObject({ path: 'InputItem.ConsumeInput', severity: 'alarm' })
    expect(errs[0].message).toMatch(/ConsumeInput=false недопустимий для background/)
  })
})

describe('validateOutputNoPipe (ZP_ProcessingConfig.c:326 -- СЬОМЕ правило, W2.6-фінал IMPORTANT 1: ClassExists для Output БЕЗ StripExact, на відміну від решти шести полів-класнеймів)', () => {
  test('пайп-форма "Клас|1" у Output -- alarm (сервер не стрипає перед ClassExists)', () => {
    const errs = validateOutputNoPipe('Outputs[0].Classname', 'ZP_Sample|1')
    expect(errs).toHaveLength(1)
    expect(errs[0]).toMatchObject({ path: 'Outputs[0].Classname', severity: 'alarm' })
    expect(errs[0].message).toBe('сервер відхилить: ClassExists для Output — без StripExact (ZP_ProcessingConfig.c:326)')
  })

  test('плоска форма (без пайпа) -- без помилок від цього правила', () => {
    expect(validateOutputNoPipe('Outputs[0].Classname', 'ZP_Sample')).toEqual([])
  })

  test('порожній classname -- без помилок (пусте поле -- не ця перевірка)', () => {
    expect(validateOutputNoPipe('Outputs[0].Classname', '')).toEqual([])
  })
})

describe('validateRule: агрегація по всіх полях правила', () => {
  function baseRule() {
    return {
      TimeSec: 10,
      BasePurityMin: 0.5,
      BasePurityMax: 0.5,
      Device: 'ZP_SampleFridge',
      InputItem: { Classname: 'Apple', Quantity: 1, ConsumeInput: true, Content: '' },
      Consumables: [] as { Classname: string; Quantity: number; Content: string }[],
      Outputs: [] as { Classname: string; Quantity: number; Chance: number; Content: string }[],
      RequiredWorn: [] as string[],
      RequiredTools: [] as string[],
    }
  }

  test('коректне правило — без помилок узагалі', () => {
    expect(validateRule(baseRule(), idx)).toEqual([])
  })

  test('InputItem.ConsumeInput=false — alarm на InputItem.ConsumeInput', () => {
    const rule = { ...baseRule(), InputItem: { ...baseRule().InputItem, ConsumeInput: false } }
    const errs = validateRule(rule, idx)
    expect(fieldErrors(errs, 'InputItem.ConsumeInput')).toHaveLength(1)
    expect(fieldErrors(errs, 'InputItem.ConsumeInput')[0].severity).toBe('alarm')
  })

  test('Device="" — alarm на Device через агрегацію validateRule (W2.6 fix-round-1, шосте правило)', () => {
    const rule = { ...baseRule(), Device: '' }
    const errs = validateRule(rule, idx)
    expect(fieldErrors(errs, 'Device')).toHaveLength(1)
    expect(fieldErrors(errs, 'Device')[0].severity).toBe('alarm')
    expect(fieldErrors(errs, 'Device')[0].message).toBe('мертве правило: ніколи не стартує (MatchClass по порожньому Device)')
  })

  test('помилки в масивах Consumables/Outputs/RequiredWorn/RequiredTools несуть індексований path', () => {
    const magClass = idx.classes.find((c) => c[3] === 1)?.[0]
    if (!magClass) return
    const rule = {
      ...baseRule(),
      Consumables: [{ Classname: magClass, Quantity: 1, Content: '' }],
      Outputs: [{ Classname: 'ZZZ_Unknown1', Quantity: 1, Chance: 1, Content: '' }],
      RequiredWorn: ['ZZZ_Unknown2'],
      RequiredTools: ['ZZZ_Unknown3'],
    }
    const errs = validateRule(rule, idx)
    expect(fieldErrors(errs, 'Consumables[0].Classname')).toHaveLength(1)
    expect(fieldErrors(errs, 'Consumables[0].Classname')[0].severity).toBe('alarm')
    expect(fieldErrors(errs, 'Outputs[0].Classname')).toHaveLength(1)
    expect(fieldErrors(errs, 'Outputs[0].Classname')[0].severity).toBe('warn')
    expect(fieldErrors(errs, 'RequiredWorn[0]')).toHaveLength(1)
    expect(fieldErrors(errs, 'RequiredTools[0]')).toHaveLength(1)
  })

  test('Outputs[0].Classname з пайпом "|1" -- alarm через агрегацію validateRule (W2.6-фінал, сьоме правило)', () => {
    const rule = { ...baseRule(), Outputs: [{ Classname: 'ZP_Sample|1', Quantity: 1, Chance: 1, Content: 'demo' }] }
    const errs = validateRule(rule, idx)
    const outErrs = fieldErrors(errs, 'Outputs[0].Classname')
    expect(outErrs.some((e) => e.severity === 'alarm' && /без StripExact/.test(e.message))).toBe(true)
  })

  test('Outputs[0].Classname у плоскій формі (без пайпа, відомий клас) -- без сьомого правила', () => {
    const knownClass = idx.classes.find((c) => c[3] !== 1)?.[0]
    if (!knownClass) return
    const rule = { ...baseRule(), Outputs: [{ Classname: knownClass, Quantity: 1, Chance: 1, Content: '' }] }
    const errs = validateRule(rule, idx)
    const outErrs = fieldErrors(errs, 'Outputs[0].Classname')
    expect(outErrs.some((e) => /без StripExact/.test(e.message))).toBe(false)
  })

  test('TimeSec і BasePurity одночасно поза межами — TimeSec alarm, Min alarm (Max додатний, підміни завантажувача немає)', () => {
    const rule = { ...baseRule(), TimeSec: 1, BasePurityMin: 3, BasePurityMax: 2 }
    const errs = validateRule(rule, idx)
    expect(fieldErrors(errs, 'TimeSec')).toHaveLength(1)
    expect(fieldErrors(errs, 'BasePurityMin')).toHaveLength(1)
    // Max у межах [0..2], але МЕНШИЙ за Min — це друга, окрема помилка сервера.
    expect(fieldErrors(errs, 'BasePurityMax')).toHaveLength(1)
  })
})

// ============================================================================================
// ЗАКРИВНА ХВИЛЯ W4 (фінальне ревʼю гілки, Important 1): дзеркало ValidateRule стало ПОВНИМ.
// Кожен тест нижче ПАДАВ на попередньому коді — саме ті форми, які сервер відкидає при
// завантаженні, а редактор рахував правило живим (зелена лампа рядка станка + «видобувається»
// на «Балансі»). Три з них редактор створює ВЛАСНОЮ кнопкою «+ Додати» в один клік.
// ============================================================================================

describe('порожній елемент RequiredTools/RequiredWorn (ZP_ProcessingConfig.c:285-294) — сервер відкидає ПРАВИЛО', () => {
  test('порожній рядок — alarm (кнопка «+ Додати» самого редактора кладе саме його)', () => {
    const errs = validateRequiredListItem('RequiredTools[0]', '')
    expect(errs).toHaveLength(1)
    expect(errs[0]).toMatchObject({ path: 'RequiredTools[0]', severity: 'alarm' })
    expect(errs[0].message).toMatch(/порожній/)
  })

  test('непорожній рядок — тут помилки немає (існування класу перевіряє validateClassField)', () => {
    expect(validateRequiredListItem('RequiredWorn[0]', 'ZZZ_Unknown')).toEqual([])
  })

  test('агрегація: RequiredWorn:[""] — alarm через validateRule (було 0 помилок)', () => {
    const errs = validateRule(
      {
        TimeSec: 10,
        BasePurityMin: 0.5,
        BasePurityMax: 0.5,
        Device: 'ZP_SampleFridge',
        InputItem: { Classname: 'Apple', Quantity: 1, ConsumeInput: true, Content: '' },
        Consumables: [],
        Outputs: [],
        RequiredWorn: [''],
        RequiredTools: [''],
      },
      idx,
    )
    expect(fieldErrors(errs, 'RequiredWorn[0]')).toHaveLength(1)
    expect(fieldErrors(errs, 'RequiredWorn[0]')[0].severity).toBe('alarm')
    expect(fieldErrors(errs, 'RequiredTools[0]')).toHaveLength(1)
    expect(fieldErrors(errs, 'RequiredTools[0]')[0].severity).toBe('alarm')
  })
})

describe('порожній InputItem.Classname (ZP_ProcessingConfig.c:295-296) — «немає InputItem.Classname»', () => {
  test('порожній — alarm (форми в переліку ревʼю не було: знайдено суцільним проходом ValidateRule)', () => {
    const errs = validateInputClassnameRequired('')
    expect(errs).toHaveLength(1)
    expect(errs[0]).toMatchObject({ path: 'InputItem.Classname', severity: 'alarm' })
  })

  test('непорожній — без помилок', () => {
    expect(validateInputClassnameRequired('Apple')).toEqual([])
  })
})

describe('межі Quantity [1..100] (ZP_ProcessingConfig.c:297-298, :306-307, :330-331)', () => {
  test('нуль — alarm', () => {
    const errs = validateQuantity('InputItem.Quantity', 0, 'ZP_ProcessingConfig.c:297-298')
    expect(errs).toHaveLength(1)
    expect(errs[0]).toMatchObject({ path: 'InputItem.Quantity', severity: 'alarm' })
  })

  test('101 — alarm; 1 і 100 — без помилок', () => {
    expect(validateQuantity('Outputs[0].Quantity', 101, 'x')).toHaveLength(1)
    expect(validateQuantity('Outputs[0].Quantity', 1, 'x')).toEqual([])
    expect(validateQuantity('Outputs[0].Quantity', 100, 'x')).toEqual([])
  })

  test('агрегація: InputItem.Quantity=0 і Consumables[0].Quantity=0 — обидва alarm', () => {
    const errs = validateRule(
      {
        TimeSec: 10,
        BasePurityMin: 0.5,
        BasePurityMax: 0.5,
        Device: 'ZP_SampleFridge',
        InputItem: { Classname: 'Apple', Quantity: 0, ConsumeInput: true, Content: '' },
        Consumables: [{ Classname: 'Apple', Quantity: 0, Content: '' }],
        Outputs: [],
        RequiredWorn: [],
        RequiredTools: [],
      },
      idx,
    )
    expect(fieldErrors(errs, 'InputItem.Quantity')).toHaveLength(1)
    expect(fieldErrors(errs, 'Consumables[0].Quantity')).toHaveLength(1)
  })
})

describe('порожній Consumables[i].Classname (ZP_ProcessingConfig.c:302-305)', () => {
  test('порожній класнейм витратного — alarm (кнопка «+ Додати витратний» кладе саме такий рядок)', () => {
    const errs = validateRule(
      {
        TimeSec: 10,
        BasePurityMin: 0.5,
        BasePurityMax: 0.5,
        Device: 'ZP_SampleFridge',
        InputItem: { Classname: 'Apple', Quantity: 1, ConsumeInput: true, Content: '' },
        Consumables: [{ Classname: '', Quantity: 1, Content: '' }],
        Outputs: [],
        RequiredWorn: [],
        RequiredTools: [],
      },
      idx,
    )
    expect(fieldErrors(errs, 'Consumables[0].Classname')).toHaveLength(1)
    expect(fieldErrors(errs, 'Consumables[0].Classname')[0].severity).toBe('alarm')
  })
})

describe('межі Output.Chance [0..1] (ZP_ProcessingConfig.c:328-329)', () => {
  test('1.5 і -0.1 — alarm; 0 і 1 — без помилок', () => {
    expect(validateChance('Outputs[0].Chance', 1.5)).toHaveLength(1)
    expect(validateChance('Outputs[0].Chance', -0.1)).toHaveLength(1)
    expect(validateChance('Outputs[0].Chance', 0)).toEqual([])
    expect(validateChance('Outputs[0].Chance', 1)).toEqual([])
  })
})

describe('ValidateContent (ZP_ProcessingConfig.c:365-379) — три причини відмови', () => {
  test('Content на НЕ-зразку (клас є в індексі) — alarm', () => {
    const errs = validateContentMirror('InputItem.Content', 'InputItem', 'Apple', 'chimera_claw', idx)
    expect(errs).toHaveLength(1)
    expect(errs[0]).toMatchObject({ path: 'InputItem.Content', severity: 'alarm' })
    expect(errs[0].message).toMatch(/лише зразки/)
  })

  // Контрольне ревʼю закривної хвилі, minor 1: раніше тут було ПОВНЕ мовчання, і це
  // неправда — родина ZP_Sample_Base це класи НАШОГО мода, вони в індексі модпака завжди,
  // тож клас поза індексом майже напевно не зразок і сервер правило відхилить. Але й
  // 'alarm' зайвий: існує законний випадок «імпортовано ClassIndex без нашого мода».
  // Компроміс — warn із чесним «якщо це не зразок».
  test('Content на класі ПОЗА індексом — warn (не мовчання і не alarm)', () => {
    const errs = validateContentMirror('InputItem.Content', 'InputItem', 'ZZZ_TotallyUnknownClassNoOneHas', 'x', idx)
    expect(errs).toHaveLength(1)
    expect(errs[0]).toMatchObject({ path: 'InputItem.Content', severity: 'warn' })
    expect(errs[0].message).toMatch(/якщо це не зразок/)
  })

  test('33 кириличні літери на зразку — alarm: рушій рахує БАЙТИ (66 > 64), а JS .length дав би 33', () => {
    const content = 'я'.repeat(33)
    expect(content.length).toBe(33) // UTF-16-одиниці: наївна перевірка сказала б «ок»
    expect(new TextEncoder().encode(content).length).toBe(66)
    const errs = validateContentMirror('Outputs[0].Content', 'Output', 'ZP_Sample', content, idx)
    expect(errs.some((e) => e.severity === 'alarm' && /64 БАЙТ/.test(e.message))).toBe(true)
  })

  test('64 байти рівно — без помилок (межа не інклюзивна для відмови)', () => {
    expect(validateContentMirror('Outputs[0].Content', 'Output', 'ZP_Sample', 'a'.repeat(64), idx)).toEqual([])
  })

  test('пробіл на краю — alarm', () => {
    const errs = validateContentMirror('Outputs[0].Content', 'Output', 'ZP_Sample', 'chimera_claw ', idx)
    expect(errs.some((e) => e.severity === 'alarm' && /пробіл/.test(e.message))).toBe(true)
  })

  test('порожній Content — жодної перевірки (ранній вихід сервера :367-368)', () => {
    expect(validateContentMirror('InputItem.Content', 'InputItem', 'Apple', '', idx)).toEqual([])
  })
})

describe('зразок на виході БЕЗ Content (ZP_ProcessingConfig.c:338-339)', () => {
  test('вихід-зразок із порожнім Content — alarm', () => {
    const errs = validateSampleOutputContent('Outputs[0].Content', 'ZP_Sample', '', idx)
    expect(errs).toHaveLength(1)
    expect(errs[0]).toMatchObject({ path: 'Outputs[0].Content', severity: 'alarm' })
  })

  test('вихід-зразок із Content — без помилок; НЕ-зразок без Content — теж', () => {
    expect(validateSampleOutputContent('Outputs[0].Content', 'ZP_Sample', 'demo', idx)).toEqual([])
    expect(validateSampleOutputContent('Outputs[0].Content', 'Apple', '', idx)).toEqual([])
  })

  test('агрегація: правило-пакувальник із виходом ZP_Sample без Content — alarm (було мовчання)', () => {
    const errs = validateRule(
      {
        TimeSec: 10,
        BasePurityMin: 0.5,
        BasePurityMax: 0.5,
        Device: 'ZP_SampleFridge',
        InputItem: { Classname: 'Apple', Quantity: 1, ConsumeInput: true, Content: '' },
        Consumables: [],
        Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: '' }],
        RequiredWorn: [],
        RequiredTools: [],
      },
      idx,
    )
    expect(fieldErrors(errs, 'Outputs[0].Content')).toHaveLength(1)
    expect(fieldErrors(errs, 'Outputs[0].Content')[0].severity).toBe('alarm')
  })
})

describe('підміна завантажувача BasePurityMax<=0 (AddFileRules, ZP_ProcessingConfig.c:232-237)', () => {
  test('нуль — warn (не alarm): сервер ГУЧНО підставляє 0.5 обом кінцям і приймає правило', () => {
    const errs = validateBasePurityLoaderDefault(0)
    expect(errs).toHaveLength(1)
    expect(errs[0]).toMatchObject({ path: 'BasePurityMax', severity: 'warn' })
  })

  test('додатний — без повідомлення', () => {
    expect(validateBasePurityLoaderDefault(0.5)).toEqual([])
  })

  test('агрегація: Min=3, Max=-1 — ЖОДНОГО alarm (сервер перезаписує ОБИДВА кінці на 0.5), лише warn', () => {
    const errs = validateRule(
      {
        TimeSec: 10,
        BasePurityMin: 3,
        BasePurityMax: -1,
        Device: 'ZP_SampleFridge',
        InputItem: { Classname: 'Apple', Quantity: 1, ConsumeInput: true, Content: '' },
        Consumables: [],
        Outputs: [],
        RequiredWorn: [],
        RequiredTools: [],
      },
      idx,
    )
    expect(errs.filter((e) => e.severity === 'alarm')).toEqual([])
    expect(fieldErrors(errs, 'BasePurityMax')).toHaveLength(1)
    expect(fieldErrors(errs, 'BasePurityMax')[0].severity).toBe('warn')
    expect(fieldErrors(errs, 'BasePurityMin')).toEqual([])
  })
})

describe('порожній Outputs[i].Classname — сервер ПРИЙМАЄ (ClassExists("")==true, зонд W2.6-фіналу)', () => {
  test('warn, а не alarm: правило завантажиться, але цей рядок не дасть нічого', () => {
    const errs = validateRule(
      {
        TimeSec: 10,
        BasePurityMin: 0.5,
        BasePurityMax: 0.5,
        Device: 'ZP_SampleFridge',
        InputItem: { Classname: 'Apple', Quantity: 1, ConsumeInput: true, Content: '' },
        Consumables: [],
        Outputs: [{ Classname: '', Quantity: 1, Chance: 1, Content: '' }],
        RequiredWorn: [],
        RequiredTools: [],
      },
      idx,
    )
    const outErrs = fieldErrors(errs, 'Outputs[0].Classname')
    expect(outErrs).toHaveLength(1)
    expect(outErrs[0].severity).toBe('warn')
  })
})
