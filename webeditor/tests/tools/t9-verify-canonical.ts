// Незалежна перевірка байт-канонічності DataItems.json, експортованого t9-shoot.mjs (крок d):
// parse -> serialize має дати ІДЕНТИЧНИЙ текст (файл уже канонічний, повторна канонізація —
// no-op). Той самий парсер/серіалізатор, яким користується сам застосунок (io/parse.ts,
// io/jsonWriter.ts) — не окрема перевірка "начебто схожого" формату.
//
// Використання: npx tsx tests/tools/t9-verify-canonical.ts <шлях-до-DataItems.json>

import { readFileSync } from 'node:fs'
import { parseConfig } from '../../src/io/parse'
import { serialize } from '../../src/io/jsonWriter'
import { DATA_ITEMS_SCHEMA } from '../../src/model/schema'

const path = process.argv[2]
if (!path) {
  console.error('використання: npx tsx tests/tools/t9-verify-canonical.ts <шлях>')
  process.exit(2)
}

const original = readFileSync(path, 'utf8')
const { value, warnings } = parseConfig(DATA_ITEMS_SCHEMA, original)
if (warnings.length > 0) {
  console.error('ПАРСЕР ЗНАЙШОВ ПОПЕРЕДЖЕННЯ на нібито-канонічному файлі (не має бути жодного):')
  for (const w of warnings) console.error('  -', w.path || '(корінь)', '--', w.message)
  process.exit(1)
}
const reSerialized = serialize(DATA_ITEMS_SCHEMA, value)
if (reSerialized !== original) {
  console.error('НЕ байт-канонічний: serialize(parse(text)) !== text')
  console.error('довжина оригіналу:', original.length, ', довжина повторної серіалізації:', reSerialized.length)
  const n = Math.min(original.length, reSerialized.length)
  for (let i = 0; i < n; i++) {
    if (original[i] !== reSerialized[i]) {
      console.error('перша розбіжність на позиції', i, ':', JSON.stringify(original.slice(Math.max(0, i - 20), i + 20)), 'vs', JSON.stringify(reSerialized.slice(Math.max(0, i - 20), i + 20)))
      break
    }
  }
  process.exit(1)
}
console.log('OK: DataItems.json байт-канонічний (', original.length, 'символів,', warnings.length, 'попереджень)')
