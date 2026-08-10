// Тести ЄДИНОГО collectPointTypeOptions (W4 Task 1, ui/optionCollectors.ts) — злиття двох
// копій, що ВЖЕ розійшлися: TreeNodePanel.tsx:62-78 мав дедуп «перший виграє»,
// DataItemQuickEdit.tsx:35-48 — ні (дубль Id давав два ZpOption з однаковим key у
// ZpSelect). Канонічною обрано версію З ДЕДУПОМ: дзеркало ZP_PointTypesConfig.Find
// (ZP_PointTypesConfig.c:317-325 — кейс-СЕНСИТИВНИЙ `pt.Id == id`, ПЕРШИЙ збіг) — другий
// близнюк для сервера недосяжний, тож чесно не показувати його опцією. Поведінкові тести
// зібрані з ОБОХ старих сюїт (tests/treeNodePanel.test.ts + tests/dataItemQuickEdit.test.ts)
// і доповнені контрастом дедупу, якого бездедупна копія не витримала б.

import { describe, test, expect } from 'vitest'
import { parseConfig } from '../src/io/parse'
import { POINT_TYPES_SCHEMA } from '../src/model/schema'
import type { StorageBackend } from '../src/io/backend'
import type { Project, ProjectFile } from '../src/io/project'
import { collectPointTypeOptions } from '../src/ui/optionCollectors'

const dummyBackend: StorageBackend = {
  kind: 'zip',
  list: async () => [],
  read: async () => new Uint8Array(0),
  write: async () => {},
}

function project(...files: ProjectFile[]): Project {
  return { files, backend: dummyBackend }
}

function pointTypesFile(pointTypes: Record<string, unknown>[]): ProjectFile {
  const jsonText = JSON.stringify({ ConfigVersion: 1, PointTypes: pointTypes, Categories: [], Kinds: [] })
  const { value, warnings } = parseConfig(POINT_TYPES_SCHEMA, jsonText)
  return { path: 'PointTypes.json', kind: 'pointTypes', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function pointType(id: string, name: string): Record<string, unknown> {
  return { Id: id, Name: name, Icon: '', Color: '', SortOrder: 0, Category: '', Kind: '', Tier: 1 }
}

describe('collectPointTypeOptions (єдина копія)', () => {
  test('label — Name, hint — Id, у порядку файлу (сюїта TreeNodePanel + DataItemQuickEdit)', () => {
    const p = project(pointTypesFile([pointType('bio_t1', 'Біоматеріали T1'), pointType('anomaly_t1', 'Аномалії T1')]))
    expect(collectPointTypeOptions(p)).toEqual([
      { id: 'bio_t1', label: 'Біоматеріали T1', hint: 'bio_t1' },
      { id: 'anomaly_t1', label: 'Аномалії T1', hint: 'anomaly_t1' },
    ])
  })

  test('порожній Name — label падає назад на сирий Id', () => {
    const p = project(pointTypesFile([pointType('raw_id', '')]))
    expect(collectPointTypeOptions(p)).toEqual([{ id: 'raw_id', label: 'raw_id', hint: 'raw_id' }])
  })

  test('дубль Id — ПЕРШИЙ виграє (дзеркало Find :317-325), другий не потрапляє в опції', () => {
    const p = project(pointTypesFile([pointType('dup', 'Перший'), pointType('dup', 'Другий')]))
    const options = collectPointTypeOptions(p)
    expect(options).toHaveLength(1)
    expect(options[0].label).toBe('Перший')
  })

  test('дедуп регістрозалежний, як Find: Id, що різняться регістром, — РІЗНІ опції', () => {
    const p = project(pointTypesFile([pointType('dup', 'Перший'), pointType('DUP', 'Інший')]))
    expect(collectPointTypeOptions(p)).toHaveLength(2)
  })

  test('запис із порожнім Id пропускається; немає PointTypes.json — порожній список', () => {
    const p = project(pointTypesFile([pointType('', 'Безіменний'), pointType('ok', 'Ок')]))
    expect(collectPointTypeOptions(p)).toEqual([{ id: 'ok', label: 'Ок', hint: 'ok' }])
    expect(collectPointTypeOptions(project())).toEqual([])
  })
})
