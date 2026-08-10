// UI вбудованого імпортера класів (T7 Step 4): секція «Оновлення індексу класів» —
// вибір тек (гра / модпак / власні моди), прогрес по PBO з можливістю скасувати, звіт
// (класи/моди/скипи/час/кеш) і дві дії результату: «використати зараз» (у пам'яті цієї
// сесії) та «записати ClassIndex.json у проєкт» (пріоритет «папка > бандл» підхопить
// його при кожному наступному відкритті теки). Дизайн — токени «Мнемосхеми пульта»
// (DESIGN.md): секція-аркуш, шильдики, лампи стану.

import { useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import {
  importClassIndex,
  dirFromFileList,
  writeProjectClassIndex,
  PROJECT_CLASSINDEX_FILENAME,
} from '../io/classImport'
import type { ImportResult, ImportProgress } from '../io/classImport'
import type { DirLike } from '../io/classImportCore'
import { setActiveClassIndex } from '../model/classIndex'
import type { Project } from '../io/project'

interface SourceDir {
  label: string
  value: FileSystemDirectoryHandle | DirLike
}

interface ImportClassesProps {
  project: Project | null
  // Повідомляє оболонку, що активний індекс змінився (App перемальовує споживачів)
  onIndexApplied: (message: string) => void
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function Lamp({ tone, children }: { tone: 'ok' | 'warn' | 'alarm'; children: ReactNode }) {
  return (
    <p role={tone === 'alarm' ? 'alert' : 'status'} className={`indicator${tone === 'alarm' ? ' alarm' : ''}`}>
      <span className={`lamp lamp-${tone}`} aria-hidden="true" />
      {children}
    </p>
  )
}

export function ImportClasses({ project, onIndexApplied }: ImportClassesProps) {
  const [dirs, setDirs] = useState<SourceDir[]>([])
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const fsAccessSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window

  async function handleAddFolder() {
    setError(null)
    try {
      const handle = await showDirectoryPicker({ id: 'zp-classimport-src', mode: 'read' })
      setDirs((prev) => [...prev, { label: handle.name, value: handle }])
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return // відмова у діалозі
      setError(describeError(err))
    }
  }

  function handleDirInput(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? [...e.target.files] : []
    e.target.value = ''
    if (files.length === 0) return
    const dir = dirFromFileList(files)
    if (!dir) {
      setError('Вибір теки не дав жодного файла зі шляхом — браузер не передав webkitRelativePath')
      return
    }
    setDirs((prev) => [...prev, { label: dir.name, value: dir }])
    setError(null)
  }

  async function handleStart() {
    if (dirs.length === 0 || running) return
    setError(null)
    setNotice(null)
    setResult(null)
    setRunning(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const res = await importClassIndex(
        dirs.map((d) => d.value),
        (p) => setProgress(p),
        ctrl.signal,
      )
      setResult(res)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setNotice('Імпорт скасовано — активний індекс не змінювався.')
      } else {
        setError(describeError(err))
      }
    } finally {
      setRunning(false)
      setProgress(null)
      abortRef.current = null
    }
  }

  function applyNow(res: ImportResult): string {
    setActiveClassIndex(res.index)
    const msg = `Активний індекс класів: ${res.stats.classes} класів із ${res.stats.mods} джерел (імпортовано зараз)`
    onIndexApplied(msg)
    return msg
  }

  function handleUseNow() {
    if (!result) return
    setNotice(applyNow(result))
  }

  async function handleWriteToProject() {
    if (!result || !project) return
    try {
      const path = await writeProjectClassIndex(project.backend, result.raw)
      applyNow(result)
      setNotice(
        project.backend.kind === 'zip'
          ? `Записано ${path} у ZIP-проєкт (потрапить в експортований архів) і застосовано зараз`
          : `Записано ${path} у теку проєкту і застосовано зараз — наступні відкриття теки підхоплять його автоматично`,
      )
    } catch (err) {
      setError(describeError(err))
    }
  }

  const stats = result?.stats

  return (
    <section className="sheet import-classes">
      <span className="sheet-title label">Оновлення індексу класів</span>
      <p className="hint">
        Додайте теку гри (<code>DayZ\</code> — ваніль + <code>!Workshop</code>) і/або теку модпаку чи окремого
        мода. Індекс збирається прямо в браузері: читаються лише заголовки PBO і конфіги, повний модпак не
        вичитується. Повторний імпорт розбирає тільки змінені PBO (кеш у браузері). Якщо моди в{' '}
        <code>!Workshop</code> — це junction-посилання клієнта Steam, браузер крізь них не бачить: додайте
        окремо теку <code>steamapps\workshop\content\221100</code> (справжній вміст Workshop).
      </p>

      <div className="toolbar">
        {fsAccessSupported && (
          <button type="button" id="import-add-folder" onClick={() => void handleAddFolder()} disabled={running}>
            Додати теку…
          </button>
        )}
        <label className="button-like" htmlFor="import-dir-input">
          Додати теку (сумісний вибір)
        </label>
        <input
          id="import-dir-input"
          className="sr-only"
          type="file"
          onChange={handleDirInput}
          disabled={running}
          {...({ webkitdirectory: '' } as Record<string, string>)}
        />
        <button
          type="button"
          id="import-start"
          className="primary"
          onClick={() => void handleStart()}
          disabled={running || dirs.length === 0}
        >
          Почати імпорт
        </button>
        {running && (
          <button type="button" id="import-cancel" onClick={() => abortRef.current?.abort()}>
            Скасувати
          </button>
        )}
      </div>

      {dirs.length > 0 && (
        <ul className="import-dirs">
          {dirs.map((d, i) => (
            <li key={`${d.label}-${i}`}>
              <code>{d.label}</code>
              <button
                type="button"
                onClick={() => setDirs((prev) => prev.filter((_x, j) => j !== i))}
                disabled={running}
              >
                Прибрати
              </button>
            </li>
          ))}
        </ul>
      )}
      {dirs.length === 0 && <p className="intro">Жодної теки ще не додано.</p>}

      {running && progress && (
        <div className="import-progress" aria-live="polite">
          <progress
            id="import-progress"
            value={progress.total > 0 ? progress.done : undefined}
            max={progress.total > 0 ? progress.total : undefined}
          />
          <span className="import-progress-text">
            {progress.phase === 'scan' && 'Пошук PBO у вибраних теках…'}
            {progress.phase === 'parse' && `${progress.done}/${progress.total} PBO — ${progress.label}`}
            {progress.phase === 'finalize' && 'Збірка індексу…'}
            {progress.cacheHits > 0 && ` (з кешу: ${progress.cacheHits})`}
          </span>
        </div>
      )}

      {error && <Lamp tone="alarm">Помилка імпорту: {error}</Lamp>}
      {notice && <Lamp tone="ok">{notice}</Lamp>}

      {stats && result && (
        <div className="import-report" id="import-report">
          <Lamp tone={stats.pboFailed > 0 ? 'warn' : 'ok'}>
            Готово за {(stats.durationMs / 1000).toFixed(1)} с: {stats.classes} класів, {stats.mods} джерел;
            PBO: {stats.pboOk} з конфігами, {stats.pboNoConfig} без, {stats.pboFailed} не розібрано;
            з кешу: {stats.cacheHits} із {stats.pboTotal}; воркерів: {stats.usedWorkers}
          </Lamp>

          {result.skipped.length > 0 && (
            <details>
              <summary>Пропущені джерела ({result.skipped.length})</summary>
              <ul>
                {result.skipped.map((s, i) => (
                  <li key={i}>
                    <code>{s.source}</code>: {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {stats.failedDetails.length > 0 && (
            <details>
              <summary>PBO, що не розібрались ({stats.failedDetails.length})</summary>
              <ul>
                {stats.failedDetails.map((f, i) => (
                  <li key={i}>
                    <code>{f.source}</code>: {f.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="toolbar">
            <button type="button" id="import-use-now" onClick={handleUseNow}>
              Використати зараз
            </button>
            <button
              type="button"
              id="import-write-project"
              onClick={() => void handleWriteToProject()}
              disabled={!project}
              title={!project ? 'Спершу відкрийте теку або ZIP проєкту' : undefined}
            >
              Записати {PROJECT_CLASSINDEX_FILENAME} у проєкт
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
