// ModulesView — вкладка «Модулі» (W4 Task 3): редактор Modules.json (модулі чистоти —
// вкладення у слоті приладу, що додають бонус до чистоти виробленого зразка). Каркас —
// той самий, що FactionsView/SampleTypesView; рядки — чисті хелпери ui/moduleRows.ts
// (TDD), мутації — io/moduleEdit.ts (фундамент T1 + renameModule цього таска).
//
// Ключові рішення:
//   - Classname і Devices[] — ZpSelect по індексу класів (залізне правило; allowFree —
//     класи чужих модів можуть бути поза індексом редактора);
//   - PurityBonus — спільний RulePanel.FloatField (fround-канон: поза фокусом показується
//     РІВНО той рядок, що потрапить у файл) + alarm-дзеркало [0..2] біля поля;
//   - alarm-повідомлення дзеркала («сервер ВИКИНЕ запис») — біля полів запису; на один
//     запис можливі ДВА повідомлення (warn «класу немає в індексі» + alarm) — показуємо
//     ОБИДВА, це чесніше за сервер, який ріже на першій причині (мінор ревью T1,
//     задокументовано в moduleRows.ts);
//   - підказка вкладки — «однакові модулі НЕ складаються» (SumBonus,
//     ZP_ModulesConfig.c:79-101: кожен клас враховується один раз, вигідно ставити РІЗНЕ);
//   - дубль класу: applyModuleEdit/renameModule на дублі відмовляють, тож форма read-only,
//     АЛЕ видалення лишається активним — deleteModule прибирає ВСІ точні збіги (дзеркало
//     OpDeleteModule) і є штатним шляхом ремонту дубля (на відміну від фракцій, де ремонт
//     дубля — вручну в JSON);
//   - відсутній Modules.json — підказка без створення файлу з нуля (прецедент
//     PointTypesView: сервер сам пише файл із дефолтами при першому буті).

import { useEffect, useMemo, useState } from 'react'
import type { Project } from '../io/project'
import type { ClassIndex } from '../model/classIndex'
import { searchClasses } from '../model/classIndex'
import { fmtFloat } from '../io/jsonWriter'
import { fieldErrors } from '../model/ruleValidation'
import { applyModuleEdit, createModule, deleteModule, renameModule } from '../io/moduleEdit'
import { buildModuleRows } from './moduleRows'
import type { ModuleRow } from './moduleRows'
import { FieldMessages, FloatField, StringListEditor } from './RulePanel'
import { ZpSelect } from './ZpSelect'
import type { ZpOption } from './ZpSelect'

// Нотатки — буфер із комітом на blur (ревью T3, minor 4): покомітний ввід клонував би
// весь документ на КОЖЕН натиск (structuredClone у applyModuleEdit) — патерн buffered
// полів проєкту (editing/text, як FloatField/IdField).
function BufferedNotes({ id, value, onCommit }: { id: string; value: string; onCommit: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(value)
  useEffect(() => {
    if (!editing) setText(value)
  }, [value, editing])
  return (
    <textarea
      id={id}
      className="field-textarea"
      value={text}
      rows={3}
      onFocus={() => setEditing(true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setEditing(false)
        if (text !== value) onCommit(text)
      }}
    />
  )
}

interface ModulePanelProps {
  project: Project
  row: ModuleRow
  duplicate: boolean
  classOptionsSource: (q: string, limit: number) => ZpOption[]
  onProjectChange: (next: Project) => void
  onSelect: (classname: string | null) => void
}

function ModulePanel({ project, row, duplicate, classOptionsSource, onProjectChange, onSelect }: ModulePanelProps) {
  const [commitError, setCommitError] = useState<string | null>(null)
  const [armedDelete, setArmedDelete] = useState(false)

  function commit(updater: (m: Record<string, unknown>) => void) {
    const result = applyModuleEdit(project, row.classname, updater)
    if (result.ok) {
      setCommitError(null)
      onProjectChange(result.project)
    } else {
      setCommitError(result.error)
    }
  }

  function handleRename(newCls: string) {
    const result = renameModule(project, row.classname, newCls)
    if (result.ok) {
      setCommitError(null)
      if (result.project !== project) {
        onProjectChange(result.project)
        onSelect(newCls.trim())
      }
    } else {
      setCommitError(result.error)
    }
  }

  function handleDelete() {
    if (!armedDelete) {
      setArmedDelete(true)
      return
    }
    const result = deleteModule(project, row.classname)
    if (result.ok) {
      setCommitError(null)
      onProjectChange(result.project)
      onSelect(null)
    } else {
      setCommitError(result.error)
      setArmedDelete(false)
    }
  }

  const deviceHandlers = {
    onAdd: () =>
      commit((m) => {
        ;(m.Devices as string[]).push('')
      }),
    onRemove: (i: number) =>
      commit((m) => {
        ;(m.Devices as string[]).splice(i, 1)
      }),
    onChangeItem: (i: number, v: string) =>
      commit((m) => {
        ;(m.Devices as string[])[i] = v
      }),
  }

  return (
    <>
      <div className="sheet-title-row">
        <span className="sheet-title label">Модуль чистоти</span>
      </div>
      <p className="field-readonly">
        <code>{row.classname !== '' ? row.classname : `запис №${row.index + 1} (без класу)`}</code>
      </p>

      {commitError && (
        <p className="indicator alarm" role="alert">
          <span className="lamp lamp-alarm" aria-hidden="true" />
          {commitError}
        </p>
      )}

      {duplicate && (
        <p className="indicator alarm" role="alert">
          <span className="lamp lamp-alarm" aria-hidden="true" />
          Дублікат класу «{row.classname}» — сервер сам виріже РАННІЙ запис при завантаженні
          (реверсний Validate, останній виграє). Форма — лише для перегляду; кнопка видалення
          нижче прибирає ВСІ збіги одразу (шлях ремонту, дзеркало OpDeleteModule).
        </p>
      )}

      <fieldset className="rule-form" disabled={duplicate}>
        <div className="rule-field">
          <label className="field-label" htmlFor="md-classname" title="Клас вкладення (MatchClass: IsKindOf + суфікс '|1' = точний клас). Перейменування міняє ключ запису">
            Класнейм модуля
          </label>
          <ZpSelect id="md-classname" value={row.classname} onChange={handleRename} optionsSource={classOptionsSource} allowFree aria-label="Класнейм модуля" />
          <FieldMessages errors={fieldErrors(row.problems, 'Classname')} />
        </div>

        <div>
          <FloatField
            id="md-bonus"
            label="Бонус чистоти (PurityBonus, 0..2)"
            value={row.purityBonus}
            onCommit={(v) => commit((m) => (m.PurityBonus = v))}
            errors={fieldErrors(row.problems, 'PurityBonus')}
          />
          <p className="hint">
            Додається до чистоти виробленого зразка ОДИН раз, скільки б однакових модулів не
            стояло (SumBonus, ZP_ModulesConfig.c:79-101).
          </p>
        </div>

        <div className="rule-field">
          <span className="field-label" title="Класи приладів, які цей модуль ПРИЙМАЮТЬ; порожньо = приймають усі (AllowedOn, ZP_ModulesConfig.c:60-76)">
            Прилади (Devices)
          </span>
          <StringListEditor
            items={row.devices}
            {...deviceHandlers}
            optionsSource={classOptionsSource}
            allowFree
            ariaLabel="Прилад модуля"
            itemErrors={(i) => fieldErrors(row.problems, `Devices[${i}]`)}
          />
          <p className="hint">Порожній перелік = модуль приймає будь-який прилад.</p>
        </div>

        <div className="rule-field">
          <label className="field-label" htmlFor="md-notes">
            Нотатки
          </label>
          <BufferedNotes id="md-notes" value={row.notes} onCommit={(v) => commit((m) => (m.Notes = v))} />
        </div>
      </fieldset>

      <button
        type="button"
        className="rule-array-remove fx-delete"
        onClick={handleDelete}
        onBlur={() => setArmedDelete(false)}
        title={duplicate ? 'Прибирає ВСІ записи з цим класом одразу (шлях ремонту дубля, дзеркало OpDeleteModule)' : undefined}
      >
        {armedDelete ? 'Точно видалити? Натисніть ще раз' : duplicate ? '× Видалити ВСІ записи цього класу' : '× Видалити модуль'}
      </button>
    </>
  )
}

export interface ModulesViewProps {
  project: Project
  index: ClassIndex
  onProjectChange: (next: Project) => void
}

export function ModulesView({ project, index, onProjectChange }: ModulesViewProps) {
  const modulesFile = project.files.find((f) => f.kind === 'modules')
  const doc = modulesFile?.parsed
  const rows = useMemo(() => buildModuleRows(doc, index), [doc, index])
  const classOptionsSource = useMemo(
    () =>
      (query: string, limit: number): ZpOption[] =>
        searchClasses(index, query, limit).map((hit) => ({ id: hit.name, label: hit.name, hint: hit.mod })),
    [index],
  )

  const [selected, setSelected] = useState<string | null>(null)
  const [newCls, setNewCls] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)

  if (!modulesFile) {
    return (
      <p className="indicator" role="status">
        <span className="lamp lamp-warn" aria-hidden="true" />У проєкті немає Modules.json — відкрийте теку чи ZIP із ним. Сервер створює цей файл сам
        із дефолтами при першому запуску, редактор його з нуля не вигадує.
      </p>
    )
  }

  const selectedRows = selected !== null ? rows.filter((r) => r.classname === selected) : []
  const selectedRow = selectedRows[0]

  function handleCreate() {
    const result = createModule(project, newCls)
    if (result.ok) {
      setCreateError(null)
      onProjectChange(result.project)
      setSelected(newCls.trim())
      setNewCls('')
    } else {
      setCreateError(result.error)
    }
  }

  return (
    <div className="entity-workspace">
      <section className="sheet entity-list">
        <span className="sheet-title label">Модулі чистоти ({rows.length})</span>
        <p className="hint">
          Модуль — вкладення у слоті приладу, що додає бонус до чистоти виробленого зразка.
          Однакові модулі НЕ складаються: кожен клас враховується один раз (SumBonus,
          ZP_ModulesConfig.c:79-101) — вигідно ставити різне. Інструмент (гейт
          RequiredTools) і модуль (число) — фізично одне й те саме вкладення.
        </p>

        <table className="file-list entity-table">
          <thead>
            <tr>
              <th>Класнейм</th>
              <th>Ігрове імʼя</th>
              <th>Бонус</th>
              <th>Прилади</th>
              <th>Стан</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isSelected = selected !== null && r.classname === selected
              return (
                <tr key={`${r.index}:${r.classname}`} className={isSelected ? 'selected' : undefined}>
                  <td>
                    <button type="button" className="row-select" aria-current={isSelected ? 'true' : undefined} onClick={() => setSelected(r.classname)}>
                      <code>{r.classname !== '' ? r.classname : `(без класу, №${r.index + 1})`}</code>
                    </button>
                  </td>
                  <td>{r.displayName !== r.classname ? r.displayName : ''}</td>
                  <td className="entity-count">
                    <code>{fmtFloat(r.purityBonus)}</code>
                  </td>
                  <td>{r.devices.length > 0 ? r.devices.join(', ') : 'усі'}</td>
                  <td>
                    <span
                      className={`lamp lamp-${r.tone}`}
                      aria-hidden="true"
                      title={r.problems.length > 0 ? r.problems.map((p) => p.message).join('; ') : 'проблем немає'}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <div className="entity-create">
          <ZpSelect
            id="md-new-classname"
            value={newCls}
            onChange={setNewCls}
            optionsSource={classOptionsSource}
            allowFree
            aria-label="Класнейм нового модуля"
            placeholder="класнейм нового модуля…"
          />
          <button type="button" onClick={handleCreate} aria-label="Створити модуль">
            + Додати модуль
          </button>
        </div>
        {createError && (
          <p className="indicator alarm" role="alert">
            <span className="lamp lamp-alarm" aria-hidden="true" />
            {createError}
          </p>
        )}
      </section>

      <aside className="sheet entity-detail">
        {selectedRow ? (
          <ModulePanel
            // key: T9-урок — перемикання модуля перемонтовує панель із чистим станом
            key={selectedRow.classname}
            project={project}
            row={selectedRow}
            duplicate={selectedRows.length > 1}
            classOptionsSource={classOptionsSource}
            onProjectChange={onProjectChange}
            onSelect={setSelected}
          />
        ) : (
          <p className="intro">Виберіть модуль у переліку або додайте новий.</p>
        )}
      </aside>
    </div>
  )
}
