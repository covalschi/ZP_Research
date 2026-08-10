// Тести дзеркал валідацій PointTypes/Factions/Modules/Settings (W4 Task 1,
// model/configValidation.ts). ТРИ РІЗНІ СТРОГОСТІ сервера дзеркаляться РІЗНИМИ рівнями
// (self-review плану W4 — «не під одну гребінку»):
//   PointTypes — whole-file гейт: БУДЬ-ЯКА проблема Validate валить завантаження файлу
//     на рестарті (реєстр типів лишається ПОРОЖНІМ) і БЛОКУЄ атомарний !zp reload ЦІЛКОМ
//     -> severity 'alarm' + project-wide гейт експорту/збереження (pointTypesGateAlarms);
//   Modules — РУЙНІВНИЙ Validate: невалідний запис ВИКИДАЄТЬСЯ, файл перезаписується без
//     нього -> 'alarm' на записі, БЕЗ project-wide гейту;
//   Factions/Settings — warn-only на сервері (файл завантажується завжди) -> 'warn'.

import { describe, test, expect } from 'vitest'
import { loadClassIndex } from '../src/model/classIndex'
import type { ClassIndex } from '../src/model/classIndex'
import type { StorageBackend } from '../src/io/backend'
import type { Project, ProjectFile } from '../src/io/project'
import { parseConfig } from '../src/io/parse'
import { POINT_TYPES_SCHEMA } from '../src/model/schema'
import {
  validatePointTypesDoc,
  pointTypesGateAlarms,
  validateFactionsDoc,
  validateFactionRecord,
  validateModulesDoc,
  validateSettingsDoc,
} from '../src/model/configValidation'

const idx: ClassIndex = loadClassIndex()

// Реальний клас з індексу (ваніль) — для перевірок "клас існує".
const KNOWN_CLASS = 'Apple'

const dummyBackend: StorageBackend = {
  kind: 'zip',
  list: async () => [],
  read: async () => new Uint8Array(0),
  write: async () => {},
}

function pointType(id: string, override: Record<string, unknown> = {}): Record<string, unknown> {
  return { Id: id, Name: 'Назва', Icon: '', Color: '', SortOrder: 1, Category: 'bio', Kind: 'field', Tier: 1, ...override }
}

function ptDoc(
  types: Record<string, unknown>[],
  categories: Record<string, unknown>[] = [{ Id: 'bio', Name: '', SortOrder: 1 }],
  kinds: Record<string, unknown>[] = [{ Id: 'field', Name: '', SortOrder: 1 }],
) {
  return { ConfigVersion: 1, PointTypes: types, Categories: categories, Kinds: kinds }
}

function alarms(list: { severity: string }[]): typeof list {
  return list.filter((e) => e.severity === 'alarm')
}
function warns(list: { severity: string }[]): typeof list {
  return list.filter((e) => e.severity === 'warn')
}

// ---- PointTypes: whole-file гейт (дзеркало ZP_PointTypesConfig.Validate :294-315) ----------

describe('validatePointTypesDoc: alarm-дзеркало whole-file Validate', () => {
  test('чистий документ — жодної проблеми', () => {
    expect(validatePointTypesDoc(ptDoc([pointType('bio_field_t1')]))).toEqual([])
  })

  test('порожній Id — alarm', () => {
    const out = validatePointTypesDoc(ptDoc([pointType('')]))
    expect(alarms(out).length).toBeGreaterThan(0)
  })

  test('дубль Id ТОЧНИМ == — alarm на ПІЗНІШОМУ записі; кейс-варіант дублем НЕ вважається (дзеркало :306)', () => {
    const out = validatePointTypesDoc(ptDoc([pointType('dup'), pointType('dup')]))
    const a = alarms(out)
    expect(a).toHaveLength(1)
    expect(a[0].path).toBe('PointTypes[1].Id')
    expect(validatePointTypesDoc(ptDoc([pointType('dup'), pointType('DUP')]))).toEqual([])
  })

  test('порожній Name — alarm; Tier поза [0..10] — alarm; межі 0 і 10 — ок', () => {
    expect(alarms(validatePointTypesDoc(ptDoc([pointType('a', { Name: '' })])))).toHaveLength(1)
    expect(alarms(validatePointTypesDoc(ptDoc([pointType('a', { Tier: -1 })])))).toHaveLength(1)
    expect(alarms(validatePointTypesDoc(ptDoc([pointType('a', { Tier: 11 })])))).toHaveLength(1)
    expect(validatePointTypesDoc(ptDoc([pointType('a', { Tier: 0 }), pointType('b', { Tier: 10 })]))).toEqual([])
  })

  test('alarm-повідомлення пояснює наслідок: рестарт лишає реєстр порожнім, reload відмовляє цілком', () => {
    const out = alarms(validatePointTypesDoc(ptDoc([pointType('dup'), pointType('dup')])))
    expect(out[0].message).toMatch(/рестарт/i)
    expect(out[0].message).toMatch(/reload/i)
  })
})

describe('validatePointTypesDoc: warn-добавки редактора', () => {
  test('SeedDimensions-підміна: порожня вісь Categories при записах із Category — warn', () => {
    const out = validatePointTypesDoc(ptDoc([pointType('a')], [], [{ Id: 'field', Name: '', SortOrder: 1 }]))
    const w = warns(out)
    expect(w).toHaveLength(1)
    expect(w[0].path).toBe('Categories')
    expect(w[0].message).toMatch(/сам заповнить/i)
  })

  test('SeedDimensions-підміна: те саме для Kinds', () => {
    const out = validatePointTypesDoc(ptDoc([pointType('a')], [{ Id: 'bio', Name: '', SortOrder: 1 }], []))
    expect(warns(out).some((w) => w.path === 'Kinds')).toBe(true)
  })

  test('порожні осі БЕЗ записів із Category/Kind — без warn (SeedDimensions нічого не заповнить)', () => {
    expect(validatePointTypesDoc(ptDoc([pointType('a', { Category: '', Kind: '' })], [], []))).toEqual([])
    expect(validatePointTypesDoc(ptDoc([], [], []))).toEqual([])
  })

  test('розсинхрон осі: запис посилається на Category, якої немає в НЕПОРОЖНІЙ осі — warn', () => {
    const out = validatePointTypesDoc(ptDoc([pointType('a', { Category: 'anomaly' })]))
    const w = warns(out)
    expect(w).toHaveLength(1)
    expect(w[0].path).toBe('PointTypes[0].Category')
  })

  test('розсинхрон осі: те саме для Kind; збіг з віссю — точний == (дзеркало DimensionOrder :247-255)', () => {
    const out = validatePointTypesDoc(ptDoc([pointType('a', { Kind: 'FIELD' })]))
    expect(warns(out).some((w) => w.path === 'PointTypes[0].Kind')).toBe(true)
  })
})

// ---- pointTypesGateAlarms: project-wide гейт ------------------------------------------------

function ptFile(types: Record<string, unknown>[], path = 'PointTypes.json'): ProjectFile {
  const { value, warnings } = parseConfig(POINT_TYPES_SCHEMA, JSON.stringify(ptDoc(types)))
  return { path, kind: 'pointTypes', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function project(...files: ProjectFile[]): Project {
  return { files, backend: dummyBackend }
}

describe('pointTypesGateAlarms', () => {
  test('без файлу PointTypes / з чистим файлом — порожньо', () => {
    expect(pointTypesGateAlarms(project())).toEqual([])
    expect(pointTypesGateAlarms(project(ptFile([pointType('a')])))).toEqual([])
  })

  test('дубль Id — alarm-список непорожній; warn-добавки в гейт НЕ потрапляють', () => {
    expect(pointTypesGateAlarms(project(ptFile([pointType('dup'), pointType('dup')]))).length).toBeGreaterThan(0)
    // розсинхрон осі — лише warn, гейт мовчить
    expect(pointTypesGateAlarms(project(ptFile([pointType('a', { Category: 'no_such' })])))).toEqual([])
  })
})

// ---- Factions: warn-only дзеркало (файл сервер завантажує ЗАВЖДИ) ---------------------------

function factionDef(id: string, override: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Id: id,
    DisplayName: 'Фракція',
    Supertype: 'science',
    Armbands: [KNOWN_CLASS],
    TerminalClasses: [],
    DeviceClasses: [],
    ...override,
  }
}

function fDoc(factions: Record<string, unknown>[]) {
  return { ConfigVersion: 1, Factions: factions }
}

describe('validateFactionsDoc: whole-file дзеркало Validate :227-282 — УСЕ warn', () => {
  test('чистий документ — лише warn про нуль фракцій відсутній (непорожній список)', () => {
    expect(validateFactionsDoc(fDoc([factionDef('ecolog')]), idx)).toEqual([])
  })

  test('жодне попередження не має severity alarm (сервер завантажує файл завжди — TryLoadFactions :218-224)', () => {
    const out = validateFactionsDoc(
      fDoc([factionDef('', { DisplayName: '', Supertype: '', Armbands: [] }), factionDef('dup'), factionDef('dup')]),
      idx,
    )
    expect(out.length).toBeGreaterThan(0)
    expect(alarms(out)).toEqual([])
  })

  test('порожній Id / дубль Id / без DisplayName / без Supertype / без нашивок — warn кожен', () => {
    const out = validateFactionsDoc(
      fDoc([
        factionDef(''),
        factionDef('dup'),
        factionDef('dup'),
        factionDef('a', { DisplayName: '' }),
        factionDef('b', { Supertype: '' }),
        factionDef('c', { Armbands: [] }),
      ]),
      idx,
    )
    expect(out.some((w) => w.message.match(/порожнім Id/i))).toBe(true)
    expect(out.some((w) => w.message.match(/дублікат Id 'dup'/i))).toBe(true)
    expect(out.some((w) => w.message.match(/без DisplayName/i))).toBe(true)
    expect(out.some((w) => w.message.match(/без Supertype/i))).toBe(true)
    expect(out.some((w) => w.message.match(/без нашивок/i))).toBe(true)
  })

  test('небезпечний для імені файлу Id — warn (дзеркало ZP_Uid.IsPathSafe)', () => {
    const out = validateFactionsDoc(fDoc([factionDef('a/b')]), idx)
    expect(out.some((w) => w.message.match(/небезпечний/i))).toBe(true)
  })

  test('нашивка у двох фракцій (дослівний збіг) — warn', () => {
    const out = validateFactionsDoc(fDoc([factionDef('a'), factionDef('b')]), idx)
    expect(out.some((w) => w.message.match(/більш ніж одній фракції/i))).toBe(true)
  })

  test('клас нашивки поза індексом — warn із приміткою про поведінку сервера', () => {
    const out = validateFactionsDoc(fDoc([factionDef('a', { Armbands: ['No_Such_Class_XYZ'] })]), idx)
    const hit = out.find((w) => w.path === 'Factions[0].Armbands[0]')
    expect(hit).toBeDefined()
    expect(hit!.severity).toBe('warn')
    expect(hit!.message).toMatch(/індекс/i)
  })

  test('порожній клас нашивки — warn', () => {
    const out = validateFactionsDoc(fDoc([factionDef('a', { Armbands: [''] })]), idx)
    expect(out.some((w) => w.message.match(/порожній клас нашивки/i))).toBe(true)
  })

  test('жодної фракції — warn «усі гравці в DefaultFaction»', () => {
    const out = validateFactionsDoc(fDoc([]), idx)
    expect(out.some((w) => w.message.match(/DefaultFaction/i))).toBe(true)
  })

  test('спільний термінал у двох фракцій — warn; фракція без терміналів (коли хтось оголосив) — warn', () => {
    const out = validateFactionsDoc(
      fDoc([
        factionDef('a', { Armbands: [KNOWN_CLASS], TerminalClasses: ['ZP_LabComputer'] }),
        factionDef('b', { Armbands: ['SodaCan_Cola'], TerminalClasses: ['ZP_LabComputer'] }),
        factionDef('c', { Armbands: ['SodaCan_Spite'], TerminalClasses: [] }),
      ]),
      idx,
    )
    expect(out.some((w) => w.message.match(/дерева одне одного/i))).toBe(true)
    expect(out.some((w) => w.message.match(/не відкриють дерево/i))).toBe(true)
  })

  test('НІХТО не оголосив терміналів — warn про спільні/відсутні термінали НЕ видаються (гейт :277-280)', () => {
    const out = validateFactionsDoc(fDoc([factionDef('a'), factionDef('b', { Armbands: ['SodaCan_Cola'] })]), idx)
    expect(out.some((w) => w.message.match(/термінал/i))).toBe(false)
  })

  test('спільний прилад у двох фракцій — warn (дзеркало WarnSharedDevices)', () => {
    const out = validateFactionsDoc(
      fDoc([
        factionDef('a', { DeviceClasses: ['ZP_Microscope'] }),
        factionDef('b', { Armbands: ['SodaCan_Cola'], DeviceClasses: ['ZP_Microscope'] }),
      ]),
      idx,
    )
    expect(out.some((w) => w.message.match(/користуватимуться ним спільно/i))).toBe(true)
    // обидві фракції МАЮТЬ прилади — warn «не скористаються жодною станцією» не видається
    expect(out.some((w) => w.message.match(/жодною станцією/i))).toBe(false)
  })
})

describe('validateFactionRecord: per-record дзеркало ValidateFaction :183-212 (hard -> alarm, soft -> warn)', () => {
  test('валідний запис — порожньо', () => {
    const f = factionDef('ecolog')
    expect(validateFactionRecord(f, [f], idx)).toEqual([])
  })

  test('немає Id / небезпечний Id / немає DisplayName / жодної нашивки — alarm', () => {
    expect(alarms(validateFactionRecord(factionDef(''), [], idx)).length).toBe(1)
    expect(alarms(validateFactionRecord(factionDef('a:b'), [], idx)).length).toBe(1)
    expect(alarms(validateFactionRecord(factionDef('a', { DisplayName: '' }), [], idx)).length).toBe(1)
    expect(alarms(validateFactionRecord(factionDef('a', { Armbands: [] }), [], idx)).length).toBe(1)
  })

  test('Supertype per-record НЕ перевіряється (дзеркало: ValidateFaction його не має, лише whole-file)', () => {
    expect(validateFactionRecord(factionDef('a', { Supertype: '' }), [], idx)).toEqual([])
  })

  test('нашивка вже належить іншій фракції — alarm; сама себе не блокує', () => {
    const mine = factionDef('a')
    const other = factionDef('b') // та сама нашивка KNOWN_CLASS
    expect(alarms(validateFactionRecord(mine, [mine, other], idx)).length).toBe(1)
    expect(validateFactionRecord(mine, [mine], idx)).toEqual([])
  })

  test('порожній клас нашивки — alarm; клас поза індексом — warn', () => {
    expect(alarms(validateFactionRecord(factionDef('a', { Armbands: [''] }), [], idx)).length).toBe(1)
    const out = validateFactionRecord(factionDef('a', { Armbands: ['No_Such_Class_XYZ'] }), [], idx)
    expect(alarms(out)).toEqual([])
    expect(warns(out).length).toBe(1)
  })
})

// ---- Modules: руйнівний Validate (:104-147) — записи ВИКИДАЮТЬСЯ ----------------------------

function moduleDef(cls: string, override: Record<string, unknown> = {}): Record<string, unknown> {
  return { Classname: cls, PurityBonus: 0.2, Devices: [], Notes: '', ...override }
}

function mDoc(modules: Record<string, unknown>[]) {
  return { ConfigVersion: 1, Modules: modules }
}

describe('validateModulesDoc: дзеркало руйнівної Validate', () => {
  test('чистий документ — порожньо', () => {
    expect(validateModulesDoc(mDoc([moduleDef(KNOWN_CLASS)]), idx)).toEqual([])
  })

  test('порожній Classname — alarm «сервер ВИКИНЕ цей запис»', () => {
    const out = validateModulesDoc(mDoc([moduleDef('')]), idx)
    const a = alarms(out)
    expect(a).toHaveLength(1)
    expect(a[0].message).toMatch(/викине/i)
  })

  test('PurityBonus поза [0..2] — alarm; межі 0 і 2 — ок', () => {
    expect(alarms(validateModulesDoc(mDoc([moduleDef(KNOWN_CLASS, { PurityBonus: -0.1 })]), idx))).toHaveLength(1)
    expect(alarms(validateModulesDoc(mDoc([moduleDef(KNOWN_CLASS, { PurityBonus: 2.1 })]), idx))).toHaveLength(1)
    expect(validateModulesDoc(mDoc([moduleDef(KNOWN_CLASS, { PurityBonus: 0 })]), idx)).toEqual([])
    expect(validateModulesDoc(mDoc([moduleDef(KNOWN_CLASS, { PurityBonus: 2 })]), idx)).toEqual([])
  })

  test('клас поза індексом — warn (офлайн-індекс може бути неповним) із приміткою, що сервер запис ВИКИНЕ', () => {
    const out = validateModulesDoc(mDoc([moduleDef('No_Such_Class_XYZ')]), idx)
    expect(alarms(out)).toEqual([])
    const w = warns(out)
    expect(w).toHaveLength(1)
    expect(w[0].message).toMatch(/викине/i)
  })

  test('пайп-суфікс |1 у Classname стрипається перед пошуком в індексі (дзеркало StripExact :117)', () => {
    expect(validateModulesDoc(mDoc([moduleDef(`${KNOWN_CLASS}|1`)]), idx)).toEqual([])
  })

  test('порожній/невідомий клас у Devices — warn (сервер лише пише в лог, запис ЛИШАЄТЬСЯ :131-135)', () => {
    const out = validateModulesDoc(mDoc([moduleDef(KNOWN_CLASS, { Devices: ['', 'No_Such_Class_XYZ'] })]), idx)
    expect(alarms(out)).toEqual([])
    expect(warns(out)).toHaveLength(2)
  })

  test('дубль класу ТОЧНИМ == — alarm на РАННЬОМУ записі (last-wins: реверсний цикл :108, дубль ріже саме ранній)', () => {
    const out = validateModulesDoc(mDoc([moduleDef(KNOWN_CLASS, { Notes: 'ранній' }), moduleDef(KNOWN_CLASS, { Notes: 'пізній' })]), idx)
    const a = alarms(out)
    expect(a).toHaveLength(1)
    expect(a[0].path).toBe('Modules[0].Classname')
  })

  // Закривна хвиля W4 (minor 3 фінального ревʼю: осиротілий тест із ревʼю T1). ЄДИНА
  // гілка, де дзеркало СВІДОМО розходиться з сервером — оптимістичне виживання запису,
  // чийого класу немає в ЛОКАЛЬНОМУ індексі (configValidation.ts:378-381 і коментар над
  // функцією): на сервері такий запис може бути й вирізаний, але якщо клас насправді є
  // (мод просто не розпакований на цій машині) — саме він забирає слот last-wins. Тест
  // дискримінує: якби «не в індексі» вважалось вирізаним, дубль-alarm на ранньому записі
  // ЗНИК би (ранній лишився б єдиним живим), і тут було б лише два warn.
  test('обидва близнюки з класом ПОЗА індексом — оптимістично живі, тож ранній усе одно дістає дубль-alarm', () => {
    const unknown = 'ZZZ_NoSuchModuleClassAnywhere'
    const out = validateModulesDoc(mDoc([moduleDef(unknown, { Notes: 'ранній' }), moduleDef(unknown, { Notes: 'пізній' })]), idx)
    const a = alarms(out)
    expect(a).toHaveLength(1)
    expect(a[0].path).toBe('Modules[0].Classname')
    expect(a[0].message).toMatch(/дубль класу/)
    // Обидва записи додатково несуть власний warn «немає в індексі» — оптимізм не мовчазний.
    expect(warns(out).filter((w) => /немає в індексі/.test(w.message))).toHaveLength(2)
  })

  test('пізній близнюк, якого сервер сам виріже (битий бонус), НЕ забирає клас у раннього (дзеркало взаємодії відсіву й seen)', () => {
    const out = validateModulesDoc(mDoc([moduleDef(KNOWN_CLASS, { Notes: 'ранній' }), moduleDef(KNOWN_CLASS, { PurityBonus: 9 })]), idx)
    const a = alarms(out)
    expect(a).toHaveLength(1) // лише бонус пізнього; ранній вижив — дубль-alarm на ньому НЕМАЄ
    expect(a[0].path).toBe('Modules[1].PurityBonus')
  })
})

// ---- Settings: warn-only (:42-68 — Validate завжди true) ------------------------------------

function sDoc(override: Record<string, unknown> = {}) {
  return {
    ConfigVersion: 1,
    DebugMode: true,
    AdminIds: ['76561198000000001'],
    DefaultFaction: 'default',
    TreeTerminalClasses: ['ZP_LabComputer'],
    TreeVisibilityDepth: 1,
    TreeBackgroundImage: '',
    ...override,
  }
}

describe('validateSettingsDoc: warn-only дзеркало', () => {
  test('чистий документ — порожньо; жодне попередження ніколи не alarm', () => {
    expect(validateSettingsDoc(sDoc())).toEqual([])
    const out = validateSettingsDoc(sDoc({ AdminIds: ['x'], DefaultFaction: '', TreeTerminalClasses: [], TreeVisibilityDepth: 99 }))
    expect(out.length).toBeGreaterThan(0)
    expect(alarms(out)).toEqual([])
  })

  test('AdminIds не Steam64 (17 цифр, лише цифри — дзеркало ZP_Uid.IsSteam64 :95-106) — warn', () => {
    expect(warns(validateSettingsDoc(sDoc({ AdminIds: ['7656119800000000'] })))).toHaveLength(1) // 16 цифр
    expect(warns(validateSettingsDoc(sDoc({ AdminIds: ['7656119800000000a'] })))).toHaveLength(1) // літера
    expect(validateSettingsDoc(sDoc({ AdminIds: ['76561198000000001'] }))).toEqual([])
  })

  test('DefaultFaction порожній або небезпечний — warn «у рантаймі буде замінений на default»', () => {
    const out = validateSettingsDoc(sDoc({ DefaultFaction: 'a/b' }))
    expect(warns(out)).toHaveLength(1)
    expect(out[0].message).toMatch(/default/i)
  })

  test('порожній елемент TreeTerminalClasses — warn; порожній СПИСОК — warn «дерево не відкриється»', () => {
    expect(warns(validateSettingsDoc(sDoc({ TreeTerminalClasses: [''] })))).toHaveLength(1)
    const out = validateSettingsDoc(sDoc({ TreeTerminalClasses: [] }))
    expect(warns(out)).toHaveLength(1)
    expect(out[0].message).toMatch(/не відкриється/i)
  })

  test('TreeVisibilityDepth поза [0..10] — warn; межі ок', () => {
    expect(warns(validateSettingsDoc(sDoc({ TreeVisibilityDepth: -1 })))).toHaveLength(1)
    expect(warns(validateSettingsDoc(sDoc({ TreeVisibilityDepth: 11 })))).toHaveLength(1)
    expect(validateSettingsDoc(sDoc({ TreeVisibilityDepth: 0 }))).toEqual([])
    expect(validateSettingsDoc(sDoc({ TreeVisibilityDepth: 10 }))).toEqual([])
  })
})
