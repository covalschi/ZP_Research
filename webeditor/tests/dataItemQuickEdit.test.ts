// Тест чистих хелперів DataItemQuickEdit.tsx (W2 Task 9; collectPointTypeOptions переїхав
// у ui/optionCollectors.ts + tests/optionCollectors.test.ts, W4 Task 1):
// isReadOnly -- рев'ю фікс-раунду 1, Important 1(c): "квик-едит-рівня тест, що
// дублікат вимикає редагування" -- саме той предикат, що йде в
// <fieldset disabled={isReadOnly(face)}> усередині компонента, а не лише model-рівневий
// DataItemFace.duplicate окремо від того, як його насправді споживає форма. Сам
// React-компонент (форма, ZpSelect, кнопка "створити запис", банер дублікату) перевіряється
// браузерним смоуком у звіті.

import { describe, test, expect } from 'vitest'
import { parseConfig } from '../src/io/parse'
import { DATA_ITEMS_SCHEMA } from '../src/model/schema'
import { loadClassIndex } from '../src/model/classIndex'
import type { ClassIndex } from '../src/model/classIndex'
import type { StorageBackend } from '../src/io/backend'
import type { Project, ProjectFile } from '../src/io/project'
import { resolveDataItemFace } from '../src/ui/ChainView'
import { isReadOnly } from '../src/ui/DataItemQuickEdit'

const idx: ClassIndex = loadClassIndex()

const dummyBackend: StorageBackend = {
  kind: 'zip',
  list: async () => [],
  read: async () => new Uint8Array(0),
  write: async () => {},
}

function dataItemsFile(items: Record<string, unknown>[]): ProjectFile {
  const jsonText = JSON.stringify({ ConfigVersion: 1, Items: items })
  const { value, warnings } = parseConfig(DATA_ITEMS_SCHEMA, jsonText)
  return { path: 'DataItems.json', kind: 'dataItems', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function project(...files: ProjectFile[]): Project {
  return { files, backend: dummyBackend }
}

// Сюїта collectPointTypeOptions переїхала в tests/optionCollectors.test.ts (W4 Task 1) —
// разом із самою функцією (ui/optionCollectors.ts, злиття двох копій; тутешня копія
// НЕ дедупила дублі — поведінка форми свідомо змінена на дедуп «перший виграє»).

describe('isReadOnly: квик-редактор вимикається РІВНО тоді, коли резолв позначив дублікат', () => {
  test('дублікат Id у DataItems.json -- isReadOnly(face) === true (той самий проп, що <fieldset disabled=...>)', () => {
    const p = project(
      dataItemsFile([
        { Id: 'ZP_Data_01', Enabled: true, Name: 'A', Description: '', Points: [] },
        { Id: 'ZP_Data_01', Enabled: true, Name: 'B', Description: '', Points: [] },
      ]),
    )
    const face = resolveDataItemFace(p, idx, 'ZP_Data_01')
    expect(isReadOnly(face)).toBe(true)
  })

  test('унікальний Id -- isReadOnly(face) === false, форма редагується', () => {
    const p = project(dataItemsFile([{ Id: 'ZP_Data_01', Enabled: true, Name: 'A', Description: '', Points: [] }]))
    const face = resolveDataItemFace(p, idx, 'ZP_Data_01')
    expect(isReadOnly(face)).toBe(false)
  })

  test('незнайдений Id (не configured) -- isReadOnly(face) === false (гілка "не налаштовано", не гілка форми)', () => {
    const p = project(dataItemsFile([{ Id: 'ZP_Data_01', Enabled: true, Name: 'A', Description: '', Points: [] }]))
    const face = resolveDataItemFace(p, idx, 'ZP_Data_99')
    expect(isReadOnly(face)).toBe(false)
  })
})
