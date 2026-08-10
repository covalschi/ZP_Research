// Скрипт живої приймалки (Task 8): канонізує всі сім конфігів ZP_Research у ЗАДАНІЙ теці
// НА МІСЦІ — читає кожен файл терпимим парсером (Task 5), пише назад канонічним
// серіалізатором (Task 4), порівнює байти з оригіналом і переписує файл лише якщо байти
// відрізняються. Використовує ТОЙ САМИЙ шлях, що й сам застосунок (project.loadProject/
// saveDirty), тому жодної окремої логіки класифікації/сортування тут немає — тільки
// Node-реалізація StorageBackend поверх fs, аби ту саму логіку можна було прогнати з
// консолі без браузера.
//
// НІКОЛИ не чіпає FactionData/, PlayerData/, ConfigBackup/, StaticDevices*.json — вони
// класифікуються як 'foreign' у project.classifyPath і loadProject навіть не читає їхні
// байти (див. коментар у project.ts), а saveDirty пропускає 'foreign' безумовно.
//
// Використання:
//   npx tsx tests/tools/writeback.ts <шлях-до-теки-профілю> [--dry]
//   --dry — лише звіт, диск не змінюється (запускати ПЕРШИМ, перш ніж без --dry).

import { loadProject, saveDirty } from '../../src/io/project'
import { NodeFsBackend } from './nodeBackend'
import { encodeConfig } from '../../src/io/jsonWriter'
import { SCHEMAS } from '../../src/model/schema'

// Node-бекенд StorageBackend поверх fs/promises винесено в ./nodeBackend.ts (закривна
// хвиля W4) — його ділить із цим інструментом аудит правил t4-8-rule-audit.ts; окремий
// модуль потрібен саме тому, що ІМПОРТ ЦЬОГО файлу запустив би main() нижче.

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2)
  const dry = rawArgs.includes('--dry')
  const positional = rawArgs.filter((a) => a !== '--dry')
  const target = positional[0]
  if (!target) {
    console.error('Використання: npx tsx tests/tools/writeback.ts <шлях-до-теки-профілю> [--dry]')
    process.exitCode = 1
    return
  }

  console.log(`Ціль: ${target}${dry ? '  (СУХИЙ ПРОГІН — диск НЕ змінюється)' : ''}`)

  const backend = new NodeFsBackend(target)
  const project = await loadProject(backend)

  type Row = { path: string; kind: string; warnings: number; changed: boolean }
  const rows: Row[] = []
  let foreignCount = 0

  for (const file of project.files) {
    if (file.kind === 'foreign') {
      foreignCount++
      continue
    }
    const canonical = encodeConfig(SCHEMAS[file.kind], file.parsed)
    const changed = !bytesEqual(canonical, file.originalBytes)
    if (changed) file.dirty = true // саме dirty читає saveDirty нижче
    rows.push({ path: file.path, kind: file.kind, warnings: file.warnings.length, changed })
  }

  for (const r of rows) {
    const status = r.changed ? 'ЗМІНЕНО' : 'без змін'
    console.log(`  [${r.kind}] ${r.path} — попереджень: ${r.warnings} — ${status}`)
  }

  // Деталі попереджень окремо — щоб основний список рядків лишався коротким і читабельним.
  for (const file of project.files) {
    if (file.kind === 'foreign' || file.warnings.length === 0) continue
    console.log(`  Попередження у ${file.path}:`)
    for (const w of file.warnings) console.log(`    ${w.path || '(корінь)'}: ${w.message}`)
  }

  const changedCount = rows.filter((r) => r.changed).length
  const unchangedCount = rows.length - changedCount
  console.log(
    `Разом: ${rows.length} конфіг-файлів (${changedCount} змінено, ${unchangedCount} без змін), ` +
      `${foreignCount} чужих записів проігноровано (FactionData/PlayerData/ConfigBackup/StaticDevices тощо).`,
  )

  if (dry) {
    console.log(
      changedCount > 0
        ? 'СУХИЙ ПРОГІН: диск не чіпали. Перегляньте звіт і запустіть без --dry, щоб застосувати.'
        : 'СУХИЙ ПРОГІН: усі файли вже канонічні, писати нічого.',
    )
    return
  }

  // W4 Task 6: saveDirty повертає { written, removed } — цей інструмент нічого не видаляє
  // (черга project.deleted завжди порожня), тож цікавить лише written.
  const { written } = await saveDirty(project)
  if (written.length === 0) {
    console.log('Диск не чіпали: усі файли вже були канонічні.')
  } else {
    console.log(`Записано на диск (${written.length}):`)
    for (const p of written) console.log(`  ${p}`)
  }
}

main().catch((e: unknown) => {
  console.error(e)
  process.exitCode = 1
})
