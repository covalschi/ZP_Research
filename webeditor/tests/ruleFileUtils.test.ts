// Тести спільного модуля io/ruleFileUtils.ts (W2.6-фінал, фінальне whole-branch ревʼю,
// IMPORTANT 2) — findRulesFile/replaceFile/collectRuleIdsLower/uniqueId були ДВОМА
// копіями (io/stationEdit.ts + io/cloneStation.ts), що вже РОЗІЙШЛИСЬ: uniqueId у
// stationEdit.ts порівнював candidate з taken ДОСЛІВНО (case-sensitive), а в
// cloneStation.ts — кейс-інсенситивно (candidate.toLowerCase()). Обраний канонічний
// варіант — кейс-інсенситивний (детальне обґрунтування — у шапці src/io/ruleFileUtils.ts).
//
// ГОЛОВНИЙ РЕГРЕСІЙНИЙ ТЕСТ ЦЬОГО ФАЙЛУ (група "uniqueId: мішаний регістр") доводить
// саме те, чого бракувало: старий stationEdit-варіант (`taken.has(candidate)` дослівно)
// НЕ виявив би колізію, якби candidate прийшов у ЗМІШАНОМУ регістрі. Через ПУБЛІЧНЕ API
// stationEdit.ts (createStubRules/linkOutputToStation) цей сценарій сьогодні НЕ
// проявляється -- обидва call-сайти пропускають base через sanitizeIdPart (яка
// беззастережно .toLowerCase()), тож candidate туди завжди йде вже нижнього регістру.
// Але io/cloneStation.ts передає base НЕ санітизованим (`${oldId}_копія`, де oldId --
// дослівний Id довільного регістру) -- САМЕ тому кейс-інсенситивний варіант там уже
// існував до цього рефакторингу. Регресія тут перевіряє САМУ ФУНКЦІЮ, яку тепер
// імпортують ОБИДВА модулі, -- а не лише той виклик, що випадково не зачепив стару
// розбіжність.

import { describe, test, expect } from 'vitest'
import { parseConfig } from '../src/io/parse'
import { RULES_FILE_SCHEMA } from '../src/model/schema'
import type { StorageBackend } from '../src/io/backend'
import type { Project, ProjectFile } from '../src/io/project'
import { findRulesFile, replaceFile, collectRuleIdsLower, uniqueId } from '../src/io/ruleFileUtils'

const dummyBackend: StorageBackend = {
  kind: 'zip',
  list: async () => [],
  read: async () => new Uint8Array(0),
  write: async () => {},
}

function rule(id: string): Record<string, unknown> {
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

describe('uniqueId: мішаний регістр (регресія фінального ревʼю W2.6-фінал IMPORTANT 2)', () => {
  test('candidate у ЗМІШАНОМУ регістрі колізує з lower-case записом у taken (те, чого старий stationEdit-варіант НЕ ловив)', () => {
    const taken = new Set<string>(['foo_bar']) // дзеркало collectRuleIdsLower -- завжди lower-case
    // Старий stationEdit-варіант: `taken.has('Foo_Bar')` -- FALSE (точний регістр не
    // збігається з "foo_bar"), колізія проґавлена, повернувся б сам base без суфіксу.
    const id = uniqueId('Foo_Bar', taken)
    // Новий (спільний, кейс-інсенситивний) варіант ловить колізію і додає суфікс.
    expect(id).toBe('Foo_Bar_2')
  })

  test('регістр ПОВЕРНЕНОГО значення зберігається таким, яким прийшов base (не примусово lower-case)', () => {
    const taken = new Set<string>()
    expect(uniqueId('MixedCase_Id', taken)).toBe('MixedCase_Id')
    expect(taken.has('mixedcase_id')).toBe(true) // а в taken лежить lower-case -- дзеркало collectRuleIdsLower
  })

  test('послідовні виклики з тим самим мішаним base дають _2, _3, ... незалежно від регістру попередніх candidate', () => {
    const taken = new Set<string>()
    expect(uniqueId('Station_Apple', taken)).toBe('Station_Apple')
    expect(uniqueId('station_apple', taken)).toBe('station_apple_2') // інший регістр того самого рядка -- усе одно колізія
    expect(uniqueId('STATION_APPLE', taken)).toBe('STATION_APPLE_3')
  })

  test('base, вже нижнього регістру (типовий шлях stationEdit.ts через sanitizeIdPart), поводиться як і раніше', () => {
    const taken = collectRuleIdsLower(project(rulesFile('ProcessingRules/a.json', rulesJson([rule('zp_samplefridge_apple')]))))
    expect(uniqueId('zp_samplefridge_apple', taken)).toBe('zp_samplefridge_apple_2')
  })
})

describe('collectRuleIdsLower / findRulesFile / replaceFile: спільна поведінка для обох викликачів', () => {
  test('collectRuleIdsLower збирає Id з УСІХ rules-файлів проєкту, lower-case, ігнорує не-rules файли', () => {
    const p = project(
      rulesFile('ProcessingRules/a.json', rulesJson([rule('Alpha'), rule('Beta')])),
      rulesFile('ProcessingRules/b.json', rulesJson([rule('Gamma')])),
    )
    const ids = collectRuleIdsLower(p)
    expect(ids).toEqual(new Set(['alpha', 'beta', 'gamma']))
  })

  test('findRulesFile: явна відмова на відсутньому файлі/не-rules файлі/нерозібраному документі', () => {
    const p = project(rulesFile('ProcessingRules/a.json', rulesJson([])))
    expect(findRulesFile(p, 'ProcessingRules/nope.json')).toMatchObject({ ok: false })
    const foreign: ProjectFile = { path: 'FactionData/x.json', kind: 'factions', originalBytes: new Uint8Array(0), parsed: {}, warnings: [], dirty: false }
    expect(findRulesFile(project(foreign), 'FactionData/x.json')).toMatchObject({ ok: false })
  })

  test('replaceFile: замінює РІВНО один обʼєкт файлу, dirty=true, решта файлів зберігають ідентичність посилань', () => {
    const a = rulesFile('ProcessingRules/a.json', rulesJson([rule('r1')]))
    const b = rulesFile('ProcessingRules/b.json', rulesJson([]))
    const p = project(a, b)
    const found = findRulesFile(p, 'ProcessingRules/a.json')
    if ('ok' in found) throw new Error('setup failed')
    const newDoc = structuredClone(found.doc)
    newDoc.Rules.push(rule('r2'))
    const p2 = replaceFile(p, found.file, newDoc)
    expect(p2.files[0]).not.toBe(a)
    expect(p2.files[1]).toBe(b) // недирти файл зберігає ідентичність
    expect((p2.files[0].parsed as { Rules: unknown[] }).Rules).toHaveLength(2)
    expect(p2.files[0].dirty).toBe(true)
    expect(a.dirty).toBe(false) // оригінал не мутовано
  })
})
