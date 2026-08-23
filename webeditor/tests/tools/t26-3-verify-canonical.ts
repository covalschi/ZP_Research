// Незалежна перевірка байт-канонічності УСІХ конфігів, експортованих t26-3-shoot.mjs:
// кожен розпакований файл класифікується (io/project.classifyPath), парситься і
// серіалізується ТИМ САМИМ кодом, що й застосунок (io/parse.ts, io/jsonWriter.ts) --
// serialize(parse(text)) мусить дати ІДЕНТИЧНИЙ текст без жодного попередження.
// Узагальнення t9-verify-canonical.ts (той перевіряв один DataItems.json).
//
// Використання: npx tsx tests/tools/t26-3-verify-canonical.ts <тека-експорту>

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parseConfig } from '../../src/io/parse'
import { serialize } from '../../src/io/jsonWriter'
import { SCHEMAS } from '../../src/model/schema'
import { classifyPath } from '../../src/io/project'

const root = process.argv[2]
if (!root) {
  console.error('використання: npx tsx tests/tools/t26-3-verify-canonical.ts <тека>')
  process.exit(2)
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

let failures = 0
let checked = 0
for (const full of walk(root)) {
  const rel = relative(root, full).replaceAll('\\', '/')
  const kind = classifyPath(rel)
  if (kind === 'foreign') {
    console.log(`SKIP (foreign): ${rel}`)
    continue
  }
  const original = readFileSync(full, 'utf8')
  const { value, warnings } = parseConfig(SCHEMAS[kind], original)
  if (warnings.length > 0) {
    failures++
    console.error(`FAIL ${rel}: ${warnings.length} попереджень на нібито-канонічному файлі:`)
    for (const w of warnings) console.error('  -', w.path || '(корінь)', '--', w.message)
    continue
  }
  const re = serialize(SCHEMAS[kind], value)
  if (re !== original) {
    failures++
    console.error(`FAIL ${rel}: serialize(parse(text)) !== text (довжини ${original.length} / ${re.length})`)
    const n = Math.min(original.length, re.length)
    for (let i = 0; i < n; i++) {
      if (original[i] !== re[i]) {
        console.error('  перша розбіжність @', i, ':', JSON.stringify(original.slice(Math.max(0, i - 20), i + 20)), 'vs', JSON.stringify(re.slice(Math.max(0, i - 20), i + 20)))
        break
      }
    }
    continue
  }
  checked++
  console.log(`OK ${rel} (${original.length} симв., ${kind})`)
}

if (failures > 0) {
  console.error(`НЕ КАНОНІЧНО: ${failures} файл(ів)`)
  process.exit(1)
}
console.log(`Усі перевірені файли байт-канонічні: ${checked}`)
