// Node-реалізація StorageBackend поверх fs/promises (винесена із tests/tools/writeback.ts
// закривною хвилею W4). ОКРЕМИЙ модуль, а не експорт із writeback.ts: у того на верхньому
// рівні стоїть main(), який ПИШЕ на диск, — імпорт заради одного класу запускав би цілий
// інструмент канонізації як побічний ефект (спіймано живцем на першому ж прогоні аудиту).
//
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Dirent } from 'node:fs'
import type { StorageBackend } from '../../src/io/backend'
import { isMultiFileDir } from '../../src/io/project'

// ---- Node-бекенд StorageBackend поверх fs/promises ---------------------------------------
// Дзеркало DirectoryBackend (backend.ts) для середовища без File System Access API: та сама
// поведінка обходу — файли кореня як є, isMultiFileDir (ProcessingRules/TechTree,
// регістронезалежно — W2 Task 4) рекурсія РІВНО на один рівень углиб, будь-який інший
// каталог (FactionData/PlayerData/ConfigBackup/будь-що незнайоме) лише позначається
// записом "ім'я/" БЕЗ читання вмісту.
export class NodeFsBackend implements StorageBackend {
  readonly kind = 'directory' as const
  constructor(private readonly root: string) {}

  async list(): Promise<string[]> {
    const out: string[] = []
    const entries: Dirent[] = await readdir(this.root, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile()) {
        out.push(entry.name)
      } else if (entry.isDirectory() && isMultiFileDir(entry.name)) {
        const sub: Dirent[] = await readdir(join(this.root, entry.name), { withFileTypes: true })
        for (const child of sub) {
          if (child.isFile()) out.push(`${entry.name}/${child.name}`)
        }
      } else if (entry.isDirectory()) {
        out.push(`${entry.name}/`) // foreign-каталог: мітка без обходу вмісту
      }
    }
    return out
  }

  async read(path: string): Promise<Uint8Array> {
    const buf = await readFile(join(this.root, ...path.split('/')))
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    await writeFile(join(this.root, ...path.split('/')), data)
  }
}
