// Таблиця файлів проєкту (Task 7). Чиста презентаційна компонента: отримує вже
// завантажений Project.files (Task 6) і колбек вибору рядка — жодної логіки
// завантаження/збереження тут немає, вона лишається в App.tsx.

import type { ProjectFile } from '../io/project'
import { fileHasAlarm } from '../io/project'
import type { ConfigKind } from '../model/types'

export const KIND_LABELS: Record<ConfigKind, string> = {
  settings: 'Налаштування',
  pointTypes: 'Типи балів',
  rules: 'Правила переробки',
  techTree: 'Дерево технологій',
  factions: 'Фракції',
  dataItems: 'Заготовки даних',
  modules: 'Модулі',
  sampleTypes: 'Типи зразків',
}

export const FOREIGN_LABEL = 'не редагується (живий стан)'

// Підпис типу для одного файлу — той самий вираз, що і в таблиці, і в панелі
// подробиць вибраного файлу (App.tsx), винесений сюди, щоб не дублювати умову.
export function kindLabel(file: ProjectFile): string {
  return file.kind === 'foreign' ? FOREIGN_LABEL : KIND_LABELS[file.kind]
}

// Файл з хоч одним alarm показує ЧЕРВОНУ лампу замість бурштинової — навіть якщо решта
// попереджень у ньому лише warn: одного зіпсованого поля досить, щоб файл не завантажився
// (fileHasAlarm — io/project.ts, спільний предикат з alarmFiles/W2.7 Task 1: одна копія
// умови, не дві незалежні).

interface FileListProps {
  files: ProjectFile[]
  selectedPath: string | null
  onSelect: (path: string) => void
}

export function FileList({ files, selectedPath, onSelect }: FileListProps) {
  if (files.length === 0) {
    return <p>Проєкт порожній — жодного файлу не знайдено.</p>
  }

  return (
    <table className="file-list">
      <thead>
        <tr>
          <th>Шлях</th>
          <th>Тип</th>
          <th>Попередження</th>
          <th>Стан</th>
        </tr>
      </thead>
      <tbody>
        {files.map((file) => {
          const isForeign = file.kind === 'foreign'
          const isSelected = file.path === selectedPath
          const rowClass = [isForeign ? 'foreign' : '', isSelected ? 'selected' : ''].filter(Boolean).join(' ')
          return (
            <tr key={file.path} className={rowClass || undefined}>
              <td>
                <button
                  type="button"
                  className="row-select"
                  aria-current={isSelected ? 'true' : undefined}
                  onClick={() => onSelect(file.path)}
                >
                  {file.path}
                </button>
              </td>
              <td>{kindLabel(file)}</td>
              <td>
                {/* Нуль — тьмяний, ненульове — з бурштиновою лампою (або червоною —
                    alarm, W2.5 Task 3): при скануванні колонки око чіпляється лише за
                    те, що потребує уваги, а alarm впадає в очі першим. */}
                {isForeign ? (
                  '—'
                ) : file.warnings.length > 0 ? (
                  <span className={`warn-count${fileHasAlarm(file) ? ' alarm' : ''}`}>
                    <span className={`lamp lamp-${fileHasAlarm(file) ? 'alarm' : 'warn'}`} aria-hidden="true" />
                    {file.warnings.length}
                  </span>
                ) : (
                  <span className="warn-zero">0</span>
                )}
              </td>
              <td>
                {file.dirty ? (
                  <span className="dirty-badge" title="є незбережені зміни">
                    змінено
                  </span>
                ) : (
                  ''
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
