// FactionsView — вкладка «Фракції» (W4 Task 3): редактор Factions.json. Каркас — той
// самий, що SampleTypesView (список зліва + деталь-панель справа), рядки/атрибуція
// проблем — чисті хелпери ui/factionRows.ts (TDD), мутації — io/factionEdit.ts
// (фундамент T1 + renameFaction/factionUsageSummary цього таска). Контракт незмінний:
// «чиста мутація -> onProjectChange -> живий рендер», жодного окремого стану даних.
//
// Ключові рішення:
//   - залізне правило ZpSelect: Armbands/TerminalClasses/DeviceClasses — ZpSelect по
//     індексу класів (allowFree: класи чужих модів можуть бути поза індексом редактора,
//     validateClassField-попередження показуються пер-рядково через itemErrors);
//     Supertype — ZpSelect по СПОСТЕРЕЖЕНИХ значеннях проєкту (collectSupertypeOptions)
//     з allowFree: це мітка групування без гейтів, реєстру супертипів не існує;
//   - Id редагується (renameFaction, прецедент renamePointType): посилання НЕ
//     переписуються, файл пулу FactionData\<старий Id>.json сервер не перейменує —
//     підказка біля поля + ЖИВИЙ перелік використань (factionUsageSummary);
//   - створення — createFaction (дефолти Enforce-класу ZP_FactionDef) з нагадуванням
//     «Id = ім'я файлу пулу FactionData\<Id>.json» (шлях-безпечність гардить мутатор);
//   - видалення — другим натисканням (ShowDialog у власних вікнах не працює — урок
//     2026-08-05) + гард використань deleteFaction (відмова з переліком);
//   - дубль Id — форма read-only (мутатори за Id відмовляють на дублі; ремонт — вручну
//     в JSON, як у RuleForm) з alarm-поясненням;
//   - відсутній Factions.json — підказка без створення файлу з нуля (прецедент
//     PointTypesView: сервер сам пише файл із дефолтами при першому буті).

import { useEffect, useMemo, useState } from 'react'
import type { Project } from '../io/project'
import type { ClassIndex } from '../model/classIndex'
import { searchClasses } from '../model/classIndex'
import { fieldErrors } from '../model/ruleValidation'
import { applyFactionEdit, createFaction, deleteFaction, renameFaction, factionUsageSummary } from '../io/factionEdit'
import { buildFactionRows, collectSupertypeOptions } from './factionRows'
import type { FactionRow } from './factionRows'
import { FieldMessages, TextField, StringListEditor } from './RulePanel'
import { ZpSelect } from './ZpSelect'
import type { ZpOption } from './ZpSelect'

// Буферизоване поле «коміт на blur» для перейменування Id — НАМІРЕНО невеликий дублікат
// приватного BufferedTextField із PointTypesView (не експортованого звідти): той самий
// задокументований компроміс T9 — перейменування на кожне натискання клавіші плодило б
// проміжні Id («v», «va», «var»), кожен одразу видимий у списку і в гардах.
function BufferedTextField({ id, label, value, onCommit, hint }: { id: string; label: string; value: string; onCommit: (v: string) => void; hint?: string }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(() => value)
  useEffect(() => {
    if (!editing) setText(value)
  }, [value, editing])
  return (
    <div className="rule-field">
      <label className="field-label" htmlFor={id} title={hint}>
        {label}
      </label>
      <input
        id={id}
        className="field-input field-input-mono"
        type="text"
        value={text}
        onFocus={() => setEditing(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setEditing(false)
          if (text !== value) onCommit(text)
        }}
      />
    </div>
  )
}

interface FactionPanelProps {
  project: Project
  row: FactionRow
  duplicate: boolean
  supertypeOptions: ZpOption[]
  classOptionsSource: (q: string, limit: number) => ZpOption[]
  onProjectChange: (next: Project) => void
  onSelect: (id: string | null) => void
}

function FactionPanel({ project, row, duplicate, supertypeOptions, classOptionsSource, onProjectChange, onSelect }: FactionPanelProps) {
  const [commitError, setCommitError] = useState<string | null>(null)
  const [armedDelete, setArmedDelete] = useState(false)
  const usage = factionUsageSummary(project, row.id)

  function commit(updater: (f: Record<string, unknown>) => void) {
    const result = applyFactionEdit(project, row.id, updater)
    if (result.ok) {
      setCommitError(null)
      onProjectChange(result.project)
    } else {
      setCommitError(result.error)
    }
  }

  function handleRename(newId: string) {
    const result = renameFaction(project, row.id, newId)
    if (result.ok) {
      setCommitError(null)
      if (result.project !== project) {
        onProjectChange(result.project)
        onSelect(newId.trim())
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
    const result = deleteFaction(project, row.id)
    if (result.ok) {
      setCommitError(null)
      onProjectChange(result.project)
      onSelect(null)
    } else {
      setCommitError(result.error)
      setArmedDelete(false)
    }
  }

  function listHandlers(field: 'Armbands' | 'TerminalClasses' | 'DeviceClasses') {
    return {
      onAdd: () =>
        commit((f) => {
          ;(f[field] as string[]).push('')
        }),
      onRemove: (i: number) =>
        commit((f) => {
          ;(f[field] as string[]).splice(i, 1)
        }),
      onChangeItem: (i: number, v: string) =>
        commit((f) => {
          ;(f[field] as string[])[i] = v
        }),
    }
  }

  return (
    <>
      <div className="sheet-title-row">
        <span className="sheet-title label">Фракція</span>
      </div>
      <p className="field-readonly">
        <code>{row.id !== '' ? row.id : `запис №${row.index + 1} (без Id)`}</code>
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
          Дублікат Id «{row.id}» у Factions.json — Find бере ПЕРШИЙ запис, близнюк недосяжний
          (Validate :242-243); форма нижче лише для перегляду, приберіть зайвий запис вручну
          (JSON).
        </p>
      )}

      {usage !== '' && (
        <p className="indicator faction-usage" role="status">
          <span className="lamp lamp-warn" aria-hidden="true" />
          Фракцію використовують: {usage}. Перейменування Id ці посилання НЕ переписує, а
          видалення відмовить, доки вони існують.
        </p>
      )}

      <fieldset className="rule-form" disabled={duplicate}>
        <BufferedTextField
          id="fx-id"
          label="Код (Id)"
          value={row.id}
          onCommit={handleRename}
          hint="Id — це ім'я файлу пулу FactionData\<Id>.json, ключ гілки дерева і значення RequiredFactions. Перейменування НЕ переписує посилання і НЕ перейменовує файл пулу: для сервера це НОВА фракція з порожнім пулом."
        />
        <p className="hint fx-rename-hint">
          Id = ім&apos;я файлу пулу <code>FactionData\&lt;Id&gt;.json</code> — лише безпечні для
          файлу символи. Перейменування не переписує посилання (правила, гілки,
          DefaultFaction) і не переносить накопичений пул.
        </p>
        <FieldMessages errors={fieldErrors(row.problems, 'Id')} />

        <div>
          <TextField id="fx-displayname" label="Назва (DisplayName)" value={row.displayName} onCommit={(v) => commit((f) => (f.DisplayName = v))} />
          <FieldMessages errors={fieldErrors(row.problems, 'DisplayName')} />
        </div>

        <div className="rule-field">
          <label className="field-label" htmlFor="fx-supertype" title="Мітка групування без гейтів — реєстру супертипів не існує, значення вільне">
            Супертип (Supertype)
          </label>
          <ZpSelect id="fx-supertype" value={row.supertype} onChange={(v) => commit((f) => (f.Supertype = v))} options={supertypeOptions} allowFree aria-label="Супертип фракції" placeholder="science / combat / stalker…" />
          <FieldMessages errors={fieldErrors(row.problems, 'Supertype')} />
        </div>

        <div className="rule-field">
          <span className="field-label" title="Нашивка у слоті Armband визначає фракцію гравця (директива власника: фракції — по нашивці)">
            Нашивки (Armbands)
          </span>
          <StringListEditor
            items={row.armbands}
            {...listHandlers('Armbands')}
            optionsSource={classOptionsSource}
            allowFree
            ariaLabel="Нашивка"
            itemErrors={(i) => fieldErrors(row.problems, `Armbands[${i}]`)}
          />
          <FieldMessages errors={fieldErrors(row.problems, 'Armbands')} />
        </div>

        <div className="rule-field">
          <span className="field-label" title="Термінали дерева цієї фракції. Правило ізоляції: нема своїх — нема ніяких, доки ХТОСЬ не оголосив свої; спільні Settings.TreeTerminalClasses діють лише поки жодна фракція не оголосила власних">
            Термінали дерева (TerminalClasses)
          </span>
          <StringListEditor
            items={row.terminals}
            {...listHandlers('TerminalClasses')}
            optionsSource={classOptionsSource}
            allowFree
            ariaLabel="Термінал"
            itemErrors={(i) => fieldErrors(row.problems, `TerminalClasses[${i}]`)}
          />
          <FieldMessages errors={fieldErrors(row.problems, 'TerminalClasses')} />
        </div>

        <div className="rule-field">
          <span className="field-label" title="Прилади-станції цієї фракції (та сама ізоляція, що в терміналів)">
            Прилади (DeviceClasses)
          </span>
          <StringListEditor
            items={row.devices}
            {...listHandlers('DeviceClasses')}
            optionsSource={classOptionsSource}
            allowFree
            ariaLabel="Прилад"
            itemErrors={(i) => fieldErrors(row.problems, `DeviceClasses[${i}]`)}
          />
          <FieldMessages errors={fieldErrors(row.problems, 'DeviceClasses')} />
        </div>
      </fieldset>

      {!duplicate && (
        <button type="button" className="rule-array-remove fx-delete" onClick={handleDelete} onBlur={() => setArmedDelete(false)}>
          {armedDelete ? 'Точно видалити? Натисніть ще раз' : '× Видалити фракцію'}
        </button>
      )}
    </>
  )
}

export interface FactionsViewProps {
  project: Project
  index: ClassIndex
  onProjectChange: (next: Project) => void
}

export function FactionsView({ project, index, onProjectChange }: FactionsViewProps) {
  const factionsFile = project.files.find((f) => f.kind === 'factions')
  const doc = factionsFile?.parsed
  const { rows, docProblems } = useMemo(() => buildFactionRows(doc, index), [doc, index])
  const supertypeOptions = useMemo(() => collectSupertypeOptions(doc), [doc])
  // ОДНА стабільна функція на index для ВСІХ ZpSelect-полів класів (застереження брифа W2:
  // inline-лямбда щорендеру зайво тригерить внутрішні мемо ZpSelect).
  const classOptionsSource = useMemo(
    () =>
      (query: string, limit: number): ZpOption[] =>
        searchClasses(index, query, limit).map((hit) => ({ id: hit.name, label: hit.name, hint: hit.mod })),
    [index],
  )

  const [selected, setSelected] = useState<string | null>(null)
  const [newId, setNewId] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)

  if (!factionsFile) {
    return (
      <p className="indicator" role="status">
        <span className="lamp lamp-warn" aria-hidden="true" />У проєкті немає Factions.json — відкрийте теку чи ZIP із ним. Сервер створює цей файл сам
        із дефолтами при першому запуску, редактор його з нуля не вигадує.
      </p>
    )
  }

  const selectedRows = selected !== null ? rows.filter((r) => r.id === selected) : []
  const selectedRow = selectedRows[0]

  function handleCreate() {
    const result = createFaction(project, newId)
    if (result.ok) {
      setCreateError(null)
      onProjectChange(result.project)
      setSelected(newId.trim())
      setNewId('')
    } else {
      setCreateError(result.error)
    }
  }

  return (
    <div className="entity-workspace">
      <section className="sheet entity-list">
        <span className="sheet-title label">Фракції ({rows.length})</span>

        {docProblems.map((p, i) => (
          <p key={i} className="indicator" role="status">
            <span className={`lamp lamp-${p.severity}`} aria-hidden="true" />
            {p.message}
          </p>
        ))}

        <table className="file-list entity-table">
          <thead>
            <tr>
              <th>Код (Id)</th>
              <th>Назва</th>
              <th>Нашивки</th>
              <th>Термінали</th>
              <th>Прилади</th>
              <th>Стан</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isSelected = selected !== null && r.id === selected
              return (
                <tr key={`${r.index}:${r.id}`} className={isSelected ? 'selected' : undefined}>
                  <td>
                    <button type="button" className="row-select" aria-current={isSelected ? 'true' : undefined} onClick={() => setSelected(r.id)}>
                      <code>{r.id !== '' ? r.id : `(без Id, №${r.index + 1})`}</code>
                    </button>
                  </td>
                  <td>{r.displayName}</td>
                  <td className="entity-count">{r.armbands.length}</td>
                  <td className="entity-count">{r.terminals.length}</td>
                  <td className="entity-count">{r.devices.length}</td>
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
          <input
            id="fx-new-id"
            className="field-input field-input-mono"
            type="text"
            placeholder="Id нової фракції"
            value={newId}
            onChange={(e) => setNewId(e.target.value)}
          />
          <button type="button" onClick={handleCreate} aria-label="Створити фракцію">
            + Створити фракцію
          </button>
        </div>
        <p className="hint">
          Id стане ім&apos;ям файлу пулу <code>FactionData\&lt;Id&gt;.json</code> — лише безпечні
          для файлу символи (без <code>\ / : ..</code>).
        </p>
        {createError && (
          <p className="indicator alarm" role="alert">
            <span className="lamp lamp-alarm" aria-hidden="true" />
            {createError}
          </p>
        )}
      </section>

      <aside className="sheet entity-detail">
        {selectedRow ? (
          <FactionPanel
            // key: T9-урок — перемикання фракції перемонтовує панель із чистим станом
            // (commitError, буфер Id, взведене видалення)
            key={selectedRow.id}
            project={project}
            row={selectedRow}
            duplicate={selectedRows.length > 1}
            supertypeOptions={supertypeOptions}
            classOptionsSource={classOptionsSource}
            onProjectChange={onProjectChange}
            onSelect={setSelected}
          />
        ) : (
          <p className="intro">Виберіть фракцію в переліку або створіть нову.</p>
        )}
      </aside>
    </div>
  )
}
