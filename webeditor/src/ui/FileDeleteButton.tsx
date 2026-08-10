// Видалення файлу з паспорта файлу (W4 Task 6, хвіст капстоуна №1). Окремий компонент, а
// не інлайн у App.tsx: уся машинерія «взведення другим натисканням + гард-перелік вмісту»
// живе в одному місці, а оболонка лишається тонкою (один тег і два колбеки).
//
// Підтвердження ДРУГИМ НАТИСКАННЯМ — паттерн проєкту (FactionsView/ModulesView/
// PointTypesView/StationWindow; у внутрішньоігровому редакторі до нього прийшли після
// відмови ванільного ShowDialog, CLAUDE.md 2026-08-05 п.6). Взведення саморозряджається
// за 4 с — той самий таймер, що у вікні станка: випадково взведена кнопка не має чекати
// на клік вічно.
//
// Гард-перелік («у файлі 4 правила — їх буде видалено разом із файлом») показується ДО
// другого натискання, а не після: адмін мусить бачити ціну дії, поки її ще можна не робити.

import { useEffect, useState } from 'react'
import type { Project, ProjectFile } from '../io/project'
import { deleteProjectFile, fileDeleteGuard } from '../io/fileDelete'

export interface FileDeleteButtonProps {
  project: Project
  file: ProjectFile
  onProjectChange: (next: Project) => void
  // Файл зник зі списку — викликач знімає з нього вибір (інакше паспорт показував би
  // «виберіть файл» із живим selectedPath на неіснуючий шлях).
  onDeleted: (path: string) => void
  // Іде збереження — кнопка недоступна (ревью T6, minor 3: сусідня «Канонізувати файл»
  // гаситься по busy, а ця лишалась активною; кінцевий стан і так вийшов би правильний,
  // але розбіжність безкоштовно прибрати).
  busy?: boolean
}

export function FileDeleteButton({ project, file, onProjectChange, onDeleted, busy = false }: FileDeleteButtonProps) {
  const [armed, setArmed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const guard = fileDeleteGuard(file)

  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(t)
  }, [armed])

  // Перемикання файлу в реєстрі не має лишати взведену кнопку на НОВОМУ файлі.
  useEffect(() => {
    setArmed(false)
    setError(null)
  }, [file.path])

  if (!guard.deletable) {
    return (
      <p className="hint file-delete-blocked">
        Видалити цей файл не можна: {guard.reason}
      </p>
    )
  }

  function handleClick() {
    if (!armed) {
      setArmed(true)
      return
    }
    setArmed(false)
    const result = deleteProjectFile(project, file.path)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    onProjectChange(result.project)
    onDeleted(file.path)
  }

  return (
    <div className="file-delete">
      <button
        type="button"
        id="file-delete-button"
        className={`rule-array-remove file-delete-action${armed ? ' armed' : ''}`}
        onClick={handleClick}
        onBlur={() => setArmed(false)}
        disabled={busy}
      >
        {armed ? 'Точно видалити файл? Натисніть ще раз' : '× Видалити файл'}
      </button>
      <p className="hint file-delete-guard">
        {guard.summary === ''
          ? 'Файл буде видалено з проєкту.'
          : `У файлі ${guard.summary} — їх буде видалено разом із файлом.`}{' '}
        Зі сховища (тека профілю або ZIP) файл зникне на «Зберегти зміни».
      </p>
      {error && (
        <p role="alert" className="indicator alarm">
          <span className="lamp lamp-alarm" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  )
}
