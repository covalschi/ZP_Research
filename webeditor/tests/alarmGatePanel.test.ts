// Тести чистих предикатів аварійної панелі (W4 Task 2, хвости ревʼю T1):
//   - isUnparseableFile: файл, який ВЗАГАЛІ не розібрався як JSON (parse.ts повертає
//     дефолти схеми + alarm із префіксом UNPARSEABLE_JSON_PREFIX). Для такого файлу
//     «Полагодити» означає ПЕРЕЗАПИС ДЕФОЛТАМИ СХЕМИ — з битого файлу нічого прочитати не
//     можна (фікс-волна ab9e01e вимагала чесного формулювання в панелі; предикат — те
//     булеве, яким панель вмикає це формулювання).
//   - префікс НЕ збігається на «звичайному» wrong-type alarm (там parsed несе живі дані,
//     і «Полагодити» чесно лагодить лише типи).

import { describe, test, expect } from 'vitest'
import { parseConfig, UNPARSEABLE_JSON_PREFIX } from '../src/io/parse'
import { POINT_TYPES_SCHEMA, SETTINGS_SCHEMA } from '../src/model/schema'
import { isUnparseableFile } from '../src/ui/AlarmGatePanel'
import type { Warning } from '../src/io/parse'

function fileWith(warnings: Warning[]): { warnings: Warning[] } {
  return { warnings }
}

describe('isUnparseableFile', () => {
  test('битий JSON: parseConfig ставить alarm із UNPARSEABLE_JSON_PREFIX — предикат true', () => {
    const { warnings } = parseConfig(POINT_TYPES_SCHEMA, '{ це не JSON')
    expect(warnings).toHaveLength(1)
    expect(warnings[0].severity).toBe('alarm')
    expect(warnings[0].message.startsWith(UNPARSEABLE_JSON_PREFIX)).toBe(true)
    expect(isUnparseableFile(fileWith(warnings))).toBe(true)
  })

  test('wrong-type alarm (JSON читається, тип поля хибний) — предикат false: «Полагодити» тут чесно лагодить типи', () => {
    const { warnings } = parseConfig(SETTINGS_SCHEMA, JSON.stringify({ DebugMode: 'так' }))
    expect(warnings.some((w) => w.severity === 'alarm')).toBe(true)
    expect(isUnparseableFile(fileWith(warnings))).toBe(false)
  })

  test('чистий файл — false', () => {
    expect(isUnparseableFile(fileWith([]))).toBe(false)
  })

  test('warn (не alarm) з таким самим текстом — false: предикат вимагає саме alarm', () => {
    expect(isUnparseableFile(fileWith([{ path: '', message: `${UNPARSEABLE_JSON_PREFIX} — щось`, severity: 'warn' }]))).toBe(false)
  })
})
