// Тести W2.7 Task 1 (гейт експорту/збереження при кривих типах): alarmFiles і repairFile
// (io/project.ts). alarmFiles — чиста функція-предикат над Project (список файлів, що
// блокують «Зберегти зміни»/«Завантажити ZIP» в App.tsx). repairFile — мутатор «Полагодити»/
// «Канонізувати файл» (той самий контракт identity/no-mutation, що applyRuleEdit/
// applyDataItemEdit), АЛЕ без structuredClone(parsed) — тут немає правки ВСЕРЕДИНІ parsed,
// лише dirty=true + чищення ЛИШЕ alarm-попереджень (plain warn лишається — правдиво описує
// незмінний стан parsed).
//
// W2.7 фікс-раунд 1 (Important рев'ю): canSave/canExport — раніше композитна умова
// (dirty+alarm) жила ЛИШЕ inline в JSX App.tsx, і єдиним свідком коректності був
// браузерний смоук (t27-1-shoot.mjs, повільний і непрямий). Тепер це чисті функції з
// прямими юніт-тестами нижче — саме тому кожен тест перевіряє РІВНО одну грань матриці
// dirty×alarm (обидва булевих виміри незалежні), а не лише "щасливий" збіг.

import { describe, test, expect } from 'vitest'
import type { StorageBackend } from '../src/io/backend'
import type { Project, ProjectFile } from '../src/io/project'
import { alarmFiles, canExport, canSave, fileHasAlarm, repairFile } from '../src/io/project'
import type { Warning } from '../src/io/parse'
import type { ConfigKind } from '../src/model/types'

const dummyBackend: StorageBackend = {
  kind: 'zip',
  list: async () => [],
  read: async () => new Uint8Array(0),
  write: async () => {},
}

function warn(message = 'звичайне попередження'): Warning {
  return { path: 'X', message }
}
function alarm(message = 'хибний тип'): Warning {
  return { path: 'X', message, severity: 'alarm' }
}

function file(path: string, kind: ConfigKind | 'foreign', warnings: Warning[] = [], dirty = false): ProjectFile {
  return {
    path,
    kind,
    originalBytes: new Uint8Array(0),
    parsed: kind === 'foreign' ? undefined : { ConfigVersion: 1 },
    warnings,
    dirty,
  }
}

function project(...files: ProjectFile[]): Project {
  return { files, backend: dummyBackend }
}

// ---- fileHasAlarm / alarmFiles -------------------------------------------------------------

describe('fileHasAlarm', () => {
  test('true, коли серед попереджень є хоч одне alarm', () => {
    expect(fileHasAlarm(file('Modules.json', 'modules', [warn(), alarm()]))).toBe(true)
  })
  test('false для самих лише plain warn', () => {
    expect(fileHasAlarm(file('Modules.json', 'modules', [warn(), warn()]))).toBe(false)
  })
  test('false без попереджень узагалі', () => {
    expect(fileHasAlarm(file('Modules.json', 'modules', []))).toBe(false)
  })

  // W3 Task 1 (розминка): дискримінуючий тест на СУМІШ 9 warn + 1 alarm -- .some() коректно
  // ловить alarm незалежно від того, ДЕ САМЕ (не лише перший/останній) він стоїть у списку.
  // Наївна реалізація на кшталт "перевір лише warnings[0]" чи "перевір лише
  // warnings[warnings.length-1]" тут провалилась би -- alarm навмисно ПОСЕРЕДИНІ (індекс 4
  // з 10, ні перший, ні останній), і навколо РІВНО дев'ять plain warn (не один-два, аби
  // "більшість -- warn" теж не могло випадково пройти тест, якби хтось реалізував
  // "alarm лише якщо це більшість").
  test('9 warn + 1 alarm (посередині списку) -- alarm перемагає, .some() не залежить від позиції/кількості', () => {
    const warnings = [
      warn('1'), warn('2'), warn('3'), warn('4'),
      alarm('5 -- єдиний alarm, посередині'),
      warn('6'), warn('7'), warn('8'), warn('9'), warn('10'),
    ]
    expect(warnings).toHaveLength(10)
    expect(warnings.filter((w) => w.severity === 'alarm')).toHaveLength(1)
    expect(fileHasAlarm(file('ProcessingRules/mixed.json', 'rules', warnings))).toBe(true)
  })

  test('9 warn БЕЗ жодного alarm -- false (контрольний парний тест: та сама кількість warn, без alarm)', () => {
    const warnings = [warn('1'), warn('2'), warn('3'), warn('4'), warn('5'), warn('6'), warn('7'), warn('8'), warn('9')]
    expect(fileHasAlarm(file('ProcessingRules/mixed.json', 'rules', warnings))).toBe(false)
  })
})

describe('alarmFiles', () => {
  test('ловить файл з хоч одним alarm-попередженням', () => {
    const f = file('Modules.json', 'modules', [warn(), alarm()])
    expect(alarmFiles(project(f))).toEqual([f])
  })

  test('НЕ ловить файл лише з plain warn-попередженнями', () => {
    const f = file('Modules.json', 'modules', [warn(), warn()])
    expect(alarmFiles(project(f))).toEqual([])
  })

  test('НЕ ловить файл без попереджень', () => {
    expect(alarmFiles(project(file('Modules.json', 'modules', [])))).toEqual([])
  })

  test('foreign-файли НЕ рахуються, навіть якби (гіпотетично) несли alarm-запис', () => {
    const f = file('FactionData/1.json', 'foreign', [alarm()])
    expect(alarmFiles(project(f))).toEqual([])
  })

  test('кілька файлів проєкту — повертає лише ті, що з alarm, у вихідному порядку files', () => {
    const a = file('A.json', 'settings', [alarm()])
    const b = file('B.json', 'modules', [warn()])
    const c = file('ProcessingRules/x.json', 'rules', [alarm(), warn()])
    const d = file('D.json', 'factions', [])
    expect(alarmFiles(project(a, b, c, d))).toEqual([a, c])
  })

  test('порожній проєкт — порожній список', () => {
    expect(alarmFiles(project())).toEqual([])
  })
})

// ---- canSave / canExport (W2.7 фікс-раунд 1) -----------------------------------------------
// Матриця dirty×alarm по чотирьох клітинках — саме той прямий тест, якого раніше не було
// (лише inline JSX + непрямий браузерний смоук). Обидва виміри незалежні: alarm-файл і
// dirty-файл у сценаріях 3/4 нижче — РІЗНІ файли проєкту, щоб довести, що alarmFiles
// блокує ЦІЛИЙ проєкт, а не лише "свій" файл.

describe('canSave / canExport: чиста матриця (mirror inline App.tsx умов)', () => {
  test('чистий проєкт, без alarm: canSave=false (нема чого зберігати), canExport=true', () => {
    const p = project(file('Settings.json', 'settings', [], false))
    expect(canSave(p)).toBe(false)
    expect(canExport(p)).toBe(true)
  })

  test('dirty без alarm: canSave=true, canExport=false (спершу збережіть)', () => {
    const p = project(file('Settings.json', 'settings', [], true))
    expect(canSave(p)).toBe(true)
    expect(canExport(p)).toBe(false)
  })

  test('alarm присутній, dirtyCount=0 (файл з alarm НЕ dirty) — заблоковано ОБИДВА', () => {
    const p = project(file('ProcessingRules/broken.json', 'rules', [alarm()], false))
    expect(canSave(p)).toBe(false)
    expect(canExport(p)).toBe(false)
  })

  test('alarm присутній І dirty (в т.ч. на РІЗНИХ файлах) — заблоковано ОБИДВА незалежно від dirty', () => {
    const dirtyFile = file('Settings.json', 'settings', [], true)
    const alarmFile = file('ProcessingRules/broken.json', 'rules', [alarm()], false)
    const p = project(dirtyFile, alarmFile)
    expect(canSave(p)).toBe(false)
    expect(canExport(p)).toBe(false)
  })

  test('alarm сам dirty (той самий файл) — теж заблоковано, ремонт іще не стався', () => {
    const p = project(file('ProcessingRules/broken.json', 'rules', [alarm()], true))
    expect(canSave(p)).toBe(false)
    expect(canExport(p)).toBe(false)
  })

  test('plain warn (не alarm) НЕ блокує — той самий поділ, що alarmFiles', () => {
    const clean = project(file('Modules.json', 'modules', [warn()], false))
    expect(canSave(clean)).toBe(false)
    expect(canExport(clean)).toBe(true)
    const dirty = project(file('Modules.json', 'modules', [warn()], true))
    expect(canSave(dirty)).toBe(true)
    expect(canExport(dirty)).toBe(false)
  })

  test('foreign-файл з (гіпотетичним) alarm не рахується — той самий інваріант, що alarmFiles', () => {
    const p = project(file('FactionData/1.json', 'foreign', [alarm()], false))
    expect(canSave(p)).toBe(false) // немає dirty, а не через alarm
    expect(canExport(p)).toBe(true)
  })

  test('порожній проєкт: canSave=false, canExport=true (нема dirty, нема alarm)', () => {
    const p = project()
    expect(canSave(p)).toBe(false)
    expect(canExport(p)).toBe(true)
  })

  test('репаір знімає блок: alarm+dirty -> repairFile -> canSave=true, canExport=false (лишився dirty)', () => {
    const p = project(file('ProcessingRules/broken.json', 'rules', [alarm()], false))
    const result = repairFile(p, 'ProcessingRules/broken.json')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(canSave(result.project)).toBe(true)
    expect(canExport(result.project)).toBe(false)
  })
})

// ---- Гейт даних PointTypes (W4 Task 1) ------------------------------------------------------
// Дубль Id / порожній Name / Tier поза межами у PointTypes.json — ТОЙ САМИЙ клас ризику, що
// wrong-type W2.7: на рестарті сервер не завантажить файл (реєстр типів порожній, вузли з
// Cost відкинуто), живий !zp reload відмовляє ЦІЛКОМ. На відміну від alarm-warnings парсера
// гейт ДИНАМІЧНИЙ (перечитує parsed при кожному виклику): правка даних у вкладці одразу
// відкриває/закриває блок без жодного синку зі static-списком warnings (обґрунтування
// вибору механізму — шапка pointTypesGateAlarms, model/configValidation.ts).

import { parseConfig } from '../src/io/parse'
import { POINT_TYPES_SCHEMA } from '../src/model/schema'
import { deletePointTypeAt } from '../src/io/pointTypeEdit'

function pointTypesFileWith(types: Record<string, unknown>[], dirty = false): ProjectFile {
  const { value, warnings } = parseConfig(POINT_TYPES_SCHEMA, JSON.stringify({ ConfigVersion: 1, PointTypes: types, Categories: [{ Id: 'bio', Name: '', SortOrder: 1 }], Kinds: [{ Id: 'field', Name: '', SortOrder: 1 }] }))
  return { path: 'PointTypes.json', kind: 'pointTypes', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty }
}

function pt(id: string): Record<string, unknown> {
  return { Id: id, Name: 'Назва', Icon: '', Color: '', SortOrder: 1, Category: 'bio', Kind: 'field', Tier: 1 }
}

describe('canSave/canExport: гейт даних PointTypes (дубль Id тощо)', () => {
  test('чистий PointTypes.json нічого не блокує', () => {
    expect(canExport(project(pointTypesFileWith([pt('a')], false)))).toBe(true)
    expect(canSave(project(pointTypesFileWith([pt('a')], true)))).toBe(true)
  })

  test('дубль Id блокує ОБИДВА, навіть коли файл не dirty і parse-alarm-ів немає', () => {
    const broken = pointTypesFileWith([pt('dup'), pt('dup')], false)
    expect(alarmFiles(project(broken))).toEqual([]) // парсер тут НІЧОГО не бачить — гейт даних окремий
    expect(canExport(project(broken))).toBe(false)
    const dirtyElsewhere = file('Settings.json', 'settings', [], true)
    expect(canSave(project(dirtyElsewhere, broken))).toBe(false)
  })

  test('ремонт МУТАТОРОМ (deletePointTypeAt прибирає близнюка) одразу відкриває гейт — без repairFile', () => {
    const broken = pointTypesFileWith([pt('dup'), pt('dup')], false)
    const p = project(broken)
    const result = deletePointTypeAt(p, 1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(canSave(result.project)).toBe(true) // файл став dirty, дубль зник
    expect(canExport(result.project)).toBe(false) // лишився dirty — спершу збереження
  })
})

// ---- repairFile: щасливий шлях -------------------------------------------------------------

describe('repairFile: щасливий шлях', () => {
  test('позначає файл dirty і прибирає ЛИШЕ alarm-попередження, plain warn лишаються', () => {
    const f = file('Modules.json', 'modules', [warn('перше'), alarm('друге'), warn('третє')])
    const result = repairFile(project(f), 'Modules.json')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const newFile = result.project.files[0]
    expect(newFile.dirty).toBe(true)
    expect(newFile.warnings).toEqual([warn('перше'), warn('третє')])
  })

  test('файл без alarm — просто позначає dirty (той самий шлях, що колишнє "Канонізувати файл")', () => {
    const f = file('Modules.json', 'modules', [warn('єдине')])
    const result = repairFile(project(f), 'Modules.json')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.files[0].dirty).toBe(true)
    expect(result.project.files[0].warnings).toEqual([warn('єдине')])
  })

  test('файл без попереджень узагалі — позначає dirty, warnings лишається порожнім', () => {
    const f = file('Settings.json', 'settings', [])
    const result = repairFile(project(f), 'Settings.json')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.files[0].dirty).toBe(true)
    expect(result.project.files[0].warnings).toEqual([])
  })

  test('НЕ мутує оригінальний Project/файл — вхід лишається без змін', () => {
    const originalWarnings = [warn(), alarm()]
    const f = file('Modules.json', 'modules', originalWarnings)
    const p = project(f)
    repairFile(p, 'Modules.json')
    expect(p.files[0]).toBe(f)
    expect(p.files[0].dirty).toBe(false)
    expect(p.files[0].warnings).toBe(originalWarnings)
    expect(p.files[0].warnings).toHaveLength(2)
  })

  test('повертає НОВИЙ Project і НОВИЙ files-масив (нове посилання)', () => {
    const f = file('Modules.json', 'modules', [alarm()])
    const p = project(f)
    const result = repairFile(p, 'Modules.json')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project).not.toBe(p)
    expect(result.project.files).not.toBe(p.files)
  })

  test('ІНШІ файли проєкту зберігають ІДЕНТИЧНІСТЬ обʼєкта (не лише рівність вмісту)', () => {
    const other = file('Settings.json', 'settings', [])
    const target = file('Modules.json', 'modules', [alarm()])
    const p = project(other, target)
    const result = repairFile(p, 'Modules.json')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.files[0]).toBe(other) // не торкнулись
    expect(result.project.files[1]).not.toBe(target) // цільовий -- новий обʼєкт
    expect(result.project.files[0].dirty).toBe(false)
  })

  test('parsed лишається ТИМ САМИМ посиланням — repair не переписує значення, лише dirty+warnings', () => {
    const f = file('Modules.json', 'modules', [alarm()])
    const result = repairFile(project(f), 'Modules.json')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.files[0].parsed).toBe(f.parsed)
  })

  test('після ремонту alarmFiles(project) більше не бачить цей файл', () => {
    const f = file('Modules.json', 'modules', [alarm()])
    const result = repairFile(project(f), 'Modules.json')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(alarmFiles(result.project)).toEqual([])
  })

  test('послідовний ремонт кількох alarm-файлів (симуляція «Полагодити все»)', () => {
    const a = file('A.json', 'settings', [alarm()])
    const b = file('ProcessingRules/x.json', 'rules', [alarm(), warn()])
    let current = project(a, b)
    for (const target of alarmFiles(current)) {
      const result = repairFile(current, target.path)
      expect(result.ok).toBe(true)
      if (result.ok) current = result.project
    }
    expect(alarmFiles(current)).toEqual([])
    expect(current.files.every((f) => f.dirty)).toBe(true)
    expect(current.files[1].warnings).toEqual([warn()]) // plain warn на другому файлі уцілів
  })
})

// ---- repairFile: відмови ---------------------------------------------------------------------

describe('repairFile: відмови', () => {
  test('файл не знайдено у проєкті — явна відмова, project не повертається', () => {
    const p = project(file('Modules.json', 'modules', [alarm()]))
    const result = repairFile(p, 'Nonexistent.json')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/не знайдено/i)
  })

  test('foreign-файл — явна відмова, редактор його ніколи не пише', () => {
    const p = project(file('FactionData/1.json', 'foreign', []))
    const result = repairFile(p, 'FactionData/1.json')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/чуж/i)
  })
})
