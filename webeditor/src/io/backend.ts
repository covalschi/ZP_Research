// Бекенди сховища проєкту (Task 6): ОДИН інтерфейс StorageBackend (список відносних шляхів
// + читання/запис байтів за шляхом), дві реалізації — ZIP-архів у пам'яті (fflate,
// юніт-тестовний шлях) і тека на диску (File System Access API, браузерний шлях). Уся
// логіка, яку МОЖНА перевірити без браузера (класифікація шляхів, сортування, load/save),
// винесена в project.ts — тут лишається тільки тонка обгортка над байтами.

import { unzipSync, zipSync } from 'fflate'
import type { Zippable } from 'fflate'
import { isMultiFileDir } from './project'

export interface StorageBackend {
  kind: 'directory' | 'zip'
  list(): Promise<string[]> // відносні шляхи, роздільник '/'
  read(path: string): Promise<Uint8Array>
  write(path: string, data: Uint8Array): Promise<void>
  // Видалення файлу (W4 Task 6, хвіст капстоуна №1). НЕОБОВʼЯЗКОВИЙ метод: обидві РЕАЛЬНІ
  // реалізації нижче його мають, але StorageBackend — це ще й вручну зібрані двійники в
  // тестах (десятки фікстур) і Node-бекенд tests/tools/writeback.ts, які нічого не
  // видаляють узагалі. Замість того, щоб змусити кожного з них писати порожню заглушку
  // (тобто МОВЧКИ вдавати видалення), метод лишається опційним, а io/project.saveDirty
  // на бекенді без нього ЯВНО відмовляє з поясненням — черга видалень при цьому не
  // спорожняється, тож адмін бачить, що нічого не сталось.
  // Відсутній файл — НЕ помилка (ідемпотентність): у черзі може стояти шлях, створений у
  // редакторі й жодного разу не збережений на диск.
  remove?(path: string): Promise<void>
}

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/')
}

// ---- ZIP (fflate) --------------------------------------------------------------------------

export class ZipBackend implements StorageBackend {
  readonly kind = 'zip' as const
  private readonly files: Map<string, Uint8Array>

  private constructor(files: Map<string, Uint8Array>) {
    this.files = files
  }

  // Приймає ZIP-байти (fflate.unzipSync або сумісний архів) і будує редаговану в пам'яті
  // карту шлях -> байти. Шляхи нормалізуються '\' -> '/' (деякі архіватори на Windows
  // пишуть зворотні слеші, хоч специфікація ZIP цього й не вимагає); записи-каталоги
  // (ключ закінчується на '/', без вмісту) відкидаються — list() повертає тільки файли.
  static fromBytes(zip: Uint8Array): ZipBackend {
    const unzipped = unzipSync(zip)
    const files = new Map<string, Uint8Array>()
    for (const [rawPath, data] of Object.entries(unzipped)) {
      const path = normalizeSlashes(rawPath)
      if (path.endsWith('/')) continue
      files.set(path, data)
    }
    return new ZipBackend(files)
  }

  async list(): Promise<string[]> {
    return [...this.files.keys()]
  }

  async read(path: string): Promise<Uint8Array> {
    const data = this.files.get(normalizeSlashes(path))
    if (!data) throw new Error(`ZipBackend.read: файл не знайдено у архіві: ${path}`)
    return data
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    this.files.set(normalizeSlashes(path), data)
  }

  // Викидає запис із карти — після цього його немає ні в list(), ні в export() (той самий
  // архів, який адмін завантажує кнопкою «Завантажити ZIP»). Відсутній ключ — тихо нічого.
  async remove(path: string): Promise<void> {
    this.files.delete(normalizeSlashes(path))
  }

  // Поточний стан карти -> нові ZIP-байти. ВАЖЛИВО: побайтова рівність ЦІЛОГО архіву з
  // оригіналом не гарантується навіть без жодної правки вмісту — fflate.zipSync пише mtime
  // кожного запису (за умовчанням момент виклику, якщо джерело не несло свій), тож два
  // виклики export() у різні секунди дають різні байти архіву при тотожному вмісті файлів.
  // Порівнювати результат треба ПОФАЙЛОВО (unzipSync(export()) -> байти кожного шляху),
  // не сирий архів цілком — так і зроблено в tests/zip.test.ts.
  export(): Uint8Array {
    const zippable: Zippable = {}
    for (const [path, data] of this.files) {
      zippable[path] = data
    }
    return zipSync(zippable)
  }
}

// ---- Тека (File System Access API) ----------------------------------------------------------

// Каталоги, у які бекенд рекурсує — isMultiFileDir з project.ts, ЄДИНЕ джерело істини
// (рев'ю T6, раунд 1: раніше тут була власна копія {'ProcessingRules', 'TechTree'}, паралельна
// до classifyPath і неперевірювана тестами напряму — ZipBackend не викликає цей код узагалі,
// бо ZIP плоский, тож розбіжність двох копій пройшла б повз усю тестову підбірку мовчки).
// isMultiFileDir (не голий MULTI_FILE_DIRS.has) — регістронезалежно (W2 Task 4, minor
// рев'ю W1): та сама причина, що й у classifyPath нижче за течією.
// FactionData/, PlayerData/, ConfigBackup/ та будь-який інший каталог НЕ обходяться взагалі —
// сервер сам керує їхнім вмістом (персональні Steam64, бекапи конфігів), редактору вони не
// потрібні. Такий каталог з'являється у списку одним записом-міткою (ім'я + завершальний '/');
// project.classifyPath бачить у ньому єдиний сегмент і класифікує як foreign, не намагаючись
// його прочитати як файл.

export class DirectoryBackend implements StorageBackend {
  readonly kind = 'directory' as const
  private readonly root: FileSystemDirectoryHandle

  private constructor(root: FileSystemDirectoryHandle) {
    this.root = root
  }

  // Фіча-детект для UI (Task 7): ховати кнопку "Відкрити теку" в браузерах без File System
  // Access API замість кидати виняток при кліку. Явна перевірка typeof window !== 'undefined'
  // — цей модуль підвантажується і в тестовому середовищі vitest (environment: 'node'), де
  // глобального `window` немає взагалі (не лише без showDirectoryPicker): звернення до
  // відсутньої властивості впало б з ReferenceError ще до перевірки 'in'.
  static isSupported(): boolean {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window
  }

  static async pick(): Promise<DirectoryBackend> {
    if (!DirectoryBackend.isSupported()) {
      throw new Error('File System Access API недоступний у цьому браузері')
    }
    const handle = await showDirectoryPicker({ id: 'zp-research-config', mode: 'readwrite' })
    return new DirectoryBackend(handle)
  }

  async list(): Promise<string[]> {
    const out: string[] = []
    for await (const [name, handle] of this.root.entries()) {
      if (handle.kind === 'file') {
        out.push(name)
      } else if (isMultiFileDir(name)) {
        // Рекурсія РІВНО на один рівень углиб. Асиметрія видимості проти ZipBackend
        // (задокументована рев'ю T6, раунд 1): файл на два+ рівні глибше
        // (ProcessingRules/sub/x.json) тут НЕ потрапляє у список ВЗАГАЛІ — ні як rules,
        // ні навіть як foreign-запис. У ZipBackend той самий шлях присутній у списку і
        // класифікується classifyPath як foreign (архів плоский, там немає "не спускатись
        // глибше" — просто йде увесь перелік записів). Сервер сам туди нічого не пише
        // (ZP_ConfigService читає ці каталоги лише плоским FindFile), але сторонній
        // інструмент чи ручна правка адміна могли залишити вкладений підкаталог — T7 не
        // повинен подавати перегляд теки як вичерпний список усього, що фізично лежить під
        // ProcessingRules/TechTree.
        for await (const [childName, childHandle] of handle.entries()) {
          if (childHandle.kind === 'file') out.push(`${name}/${childName}`)
        }
      } else {
        out.push(`${name}/`) // foreign-каталог: сам факт існування, без обходу вмісту
      }
    }
    return out
  }

  async read(path: string): Promise<Uint8Array> {
    const handle = await this.resolveFileHandle(path, false)
    const file = await handle.getFile()
    return new Uint8Array(await file.arrayBuffer())
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    const handle = await this.resolveFileHandle(path, true)
    const writable = await handle.createWritable()
    // Cast: наш Uint8Array (backend-агностичний, з можливо ArrayBufferLike-буфером) є
    // валідним BufferSource у рантаймі завжди, але тип FileSystemWriteChunkType у lib.dom
    // вимагає ArrayBufferView<ArrayBuffer> саме (не ArrayBufferLike/SharedArrayBuffer) —
    // над-строге обмеження типів, не реальна відмінність поведінки.
    await writable.write(data as BufferSource)
    await writable.close()
  }

  // Видалення НА ДИСКУ через FileSystemDirectoryHandle.removeEntry — File System Access API
  // це вміє (дозвіл 'readwrite' уже взято в pick()), тож ніякого «редактор може лише
  // експортувати ZIP без файлу» не потрібно: у режимі теки файл справді зникає з
  // $profile:ZP_Research\ на «Зберегти зміни».
  // NotFoundError проковтується (файл уже прибрали руками/його ніколи не було на диску —
  // мета «файлу там немає» досягнута); будь-яка інша помилка (немає дозволу, файл
  // заблокований) ПІДНІМАЄТЬСЯ вище — saveDirty покаже її адміну і лишить шлях у черзі.
  async remove(path: string): Promise<void> {
    const parts = normalizeSlashes(path)
      .split('/')
      .filter((s) => s.length > 0)
    if (parts.length === 0) throw new Error('DirectoryBackend.remove: порожній шлях')
    let dir = this.root
    try {
      for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i], { create: false })
      }
      await dir.removeEntry(parts[parts.length - 1])
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotFoundError') return
      throw err
    }
  }

  private async resolveFileHandle(path: string, create: boolean): Promise<FileSystemFileHandle> {
    const parts = normalizeSlashes(path)
      .split('/')
      .filter((s) => s.length > 0)
    let dir = this.root
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i], { create })
    }
    return dir.getFileHandle(parts[parts.length - 1], { create })
  }
}
