// PointTypesView — вкладка «Бали» (W4 Task 2): матриця типів балів Категорія×Вид×Тір.
// Розкладка — чисті хелпери ui/pointTypesMatrix.ts (TDD), мутації — io/pointTypeEdit.ts
// (фундамент T1), дзеркало валідації — validatePointTypesDoc/pointTypesGateAlarms
// (model/configValidation.ts). Контракт той самий, що SampleTypesView: «чиста мутація ->
// onProjectChange -> живий рендер», жодного окремого стану даних у компоненті.
//
// Ключові рішення (усі — з брифа Task 2 або задокументовані як власні):
//   - вибір запису — пара {index, id} (resolveMatrixSelection): індекс потрібен позиційному
//     ремонту близнюків (deletePointTypeAt), Id — страховка від застарілого індексу (урок
//     внутрішньоігрового редактора: «виділення номером рядка їхало на сусідній запис»);
//   - дубль Id (точний ==, як сервер) — форма read-only + перелік близнюків із кнопками
//     позиційного видалення (хвіст 2 ревʼю T1) і В МАТРИЦІ кнопка «видалити» просто на
//     записі-дублі; після ремонту project-wide гейт відкривається сам (динамічний, T1);
//   - порожня клітинка — «створити» з автозаповненням Category/Kind/Tier за позицією,
//     Id за шаблоном `<cat>_<kind>_t<N>` (uniqueId), Name — з Name осей (непорожня назва
//     обовʼязкова: тип без Name — alarm, який одразу закрив би гейт збереження), Color —
//     колір категорії (categoryColor: факт даних стенду, не серверне правило);
//   - Category/Kind у панелі — ZpSelect по осях (залізне правило), allowFree: запис поза
//     осями легальний для сервера (блок у кінець із сирим Id), розсинхрон покаже warn;
//   - Color — звичайне поле + ОБОВʼЯЗКОВИЙ кольоровий чіп поруч (пастка «#» як ключ
//     stringtable — суто ігрова, Widget.TranslateString; браузера не стосується, тому
//     поле комітить напряму без буфера «показаного»);
//   - перейменування Id запису/осі НЕ переписує посилання (Cost вузлів, Points заготовок /
//     записи матриці) — підказки в UI кажуть це прямо, розсинхрон показують дзеркала.

import { useEffect, useMemo, useState } from 'react'
import type { Project } from '../io/project'
import {
  applyPointTypeEdit,
  createPointType,
  deletePointType,
  deletePointTypeAt,
  renamePointType,
  applyDimensionEdit,
  createDimension,
  renameDimension,
} from '../io/pointTypeEdit'
import type { DimensionAxis } from '../io/pointTypeEdit'
import { pointTypesGateAlarms } from '../model/configValidation'
import {
  buildPointTypesMatrix,
  cellKey,
  suggestPointTypeId,
  suggestPointTypeName,
  categoryColor,
  resolveMatrixSelection,
  adjustSelectionAfterDelete,
} from './pointTypesMatrix'
import type { MatrixAxisEntry, MatrixEntry, MatrixSelection, PointTypesMatrix } from './pointTypesMatrix'
import { PointTypesGateBody } from './AlarmGatePanel'
import { ZpSelect } from './ZpSelect'
import type { ZpOption } from './ZpSelect'
import type { FocusRequest } from './focusRequest'

// ---- дрібні поля форми ----------------------------------------------------------------------
// TextField/IntField — НАМІРЕНО невеликий дублікат приватних компонентів SampleTypesView/
// DataItemQuickEdit (не експортованих звідти) — той самий задокументований компроміс T9:
// логіка тривіальна, дублювання дешевше за міжмодульну звʼязність незалежних форм.

function TextField({ id, label, value, onCommit, hint }: { id: string; label: string; value: string; onCommit: (v: string) => void; hint?: string }) {
  return (
    <div className="rule-field">
      <label className="field-label" htmlFor={id} title={hint}>
        {label}
      </label>
      <input id={id} className="field-input" type="text" value={value} onChange={(e) => onCommit(e.target.value)} />
    </div>
  )
}

function IntField({ id, label, value, onCommit }: { id: string; label: string; value: number; onCommit: (v: number) => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(() => String(value))
  useEffect(() => {
    if (!editing) setText(String(value))
  }, [value, editing])
  return (
    <div className="rule-field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="field-input field-input-mono"
        type="text"
        inputMode="numeric"
        value={text}
        onFocus={() => setEditing(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setEditing(false)
          const n = Math.trunc(Number(text))
          if (Number.isFinite(n)) onCommit(n)
          else setText(String(value))
        }}
      />
    </div>
  )
}

// Буферизоване текстове поле «коміт на blur» — для перейменувань Id (запису й осі):
// перейменування на кожне натискання клавіші плодило б проміжні Id-и («b», «bi», «bio»),
// кожен із яких одразу видно в матриці й у дзеркалах.
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

// Кольоровий чіп — обовʼязковий супровід поля Color (бриф) і заголовків категорій.
// Невалідний CSS-колір браузер просто ігнорує (чіп лишається порожнім із рамкою) —
// властивість style, не HTML, тож ін'єкції немає.
function ColorChip({ color, title }: { color: string; title?: string }) {
  return <span className="pt-color-chip" style={color !== '' ? { background: color } : undefined} title={title ?? color} aria-hidden="true" />
}

// ---- деталь-панель запису -------------------------------------------------------------------

interface EntryPanelProps {
  project: Project
  matrix: PointTypesMatrix
  entry: MatrixEntry
  onProjectChange: (next: Project) => void
  onSelect: (sel: MatrixSelection | null) => void
}

function axisOptions(entries: MatrixAxisEntry[]): ZpOption[] {
  return entries.map((e) => ({ id: e.id, label: e.name !== '' ? e.name : e.id, hint: e.id }))
}

function EntryPanel({ project, matrix, entry, onProjectChange, onSelect }: EntryPanelProps) {
  const [commitError, setCommitError] = useState<string | null>(null)
  // Видалення типу — підтвердження ДРУГИМ натисканням (той самий механізм, що вкладка VPP
  // і вікно станка: ванільний ShowDialog у власних вікнах не працює — урок 2026-08-05).
  const [armedDelete, setArmedDelete] = useState(false)

  const categoryOptions = useMemo(() => axisOptions(matrix.categories), [matrix])
  const kindOptions = useMemo(() => axisOptions(matrix.kinds), [matrix])

  function commit(updater: (pt: Record<string, unknown>) => void) {
    const result = applyPointTypeEdit(project, entry.id, updater)
    if (result.ok) {
      setCommitError(null)
      onProjectChange(result.project)
    } else {
      setCommitError(result.error)
    }
  }

  function handleRename(newId: string) {
    const result = renamePointType(project, entry.id, newId)
    if (result.ok) {
      setCommitError(null)
      onProjectChange(result.project)
      if (result.project !== project) onSelect({ index: entry.index, id: newId.trim() })
    } else {
      setCommitError(result.error)
    }
  }

  function handleDeleteType() {
    if (!armedDelete) {
      setArmedDelete(true)
      return
    }
    const result = deletePointType(project, entry.id)
    if (result.ok) {
      setCommitError(null)
      onProjectChange(result.project)
      onSelect(null)
    } else {
      setCommitError(result.error)
      setArmedDelete(false)
    }
  }

  // Позиційне видалення близнюка (хвіст 2 ревʼю T1): після видалення вибір пересувається
  // (adjustSelectionAfterDelete), а якщо видалили САМ вибраний запис — перевибирається
  // вцілілий близнюк за Id (панель одразу показує вже РЕДАГОВНИЙ запис).
  function handleDeleteTwin(index: number) {
    const result = deletePointTypeAt(project, index)
    if (!result.ok) {
      setCommitError(result.error)
      return
    }
    setCommitError(null)
    onProjectChange(result.project)
    const sel: MatrixSelection = { index: entry.index, id: entry.id }
    const adjusted = adjustSelectionAfterDelete(sel, index)
    if (adjusted) {
      onSelect(adjusted)
      return
    }
    const doc = result.project.files.find((f) => f.kind === 'pointTypes')?.parsed as { PointTypes?: Record<string, unknown>[] } | undefined
    const survivor = doc?.PointTypes?.findIndex((pt) => pt && pt.Id === entry.id) ?? -1
    onSelect(survivor >= 0 ? { index: survivor, id: entry.id } : null)
  }

  const twins = entry.duplicate ? matrix.entries.filter((e) => e.id === entry.id) : []

  return (
    <>
      <div className="sheet-title-row">
        <span className="sheet-title label">Тип балів</span>
      </div>
      <p className="field-readonly">
        <code>{entry.id !== '' ? entry.id : `запис №${entry.index + 1} (без Id)`}</code>
      </p>

      {commitError && (
        <p className="indicator alarm" role="alert">
          <span className="lamp lamp-alarm" aria-hidden="true" />
          {commitError}
        </p>
      )}

      {entry.duplicate && (
        <>
          <p className="indicator alarm" role="alert">
            <span className="lamp lamp-alarm" aria-hidden="true" />
            Дублікат Id «{entry.id}» (точне ==, як сервер): Find бачить лише ПЕРШИЙ запис, а
            Validate валить ЦІЛИЙ файл — форма нижче лише для перегляду. Видаліть зайвого
            близнюка кнопкою — гейт збереження відкриється сам.
          </p>
          <ul className="pt-twin-list">
            {twins.map((t) => (
              <li key={t.index} className="pt-twin-row">
                <span className="pt-twin-info">
                  №{t.index + 1}: {t.name !== '' ? t.name : '(без назви)'} <code>SortOrder {t.sortOrder}</code>
                </span>
                <button type="button" className="rule-array-remove" onClick={() => handleDeleteTwin(t.index)} aria-label={`Видалити запис №${t.index + 1}`}>
                  × Видалити цей запис
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <fieldset className="rule-form" disabled={entry.duplicate}>
        <BufferedTextField
          id="pt-id"
          label="Код (Id)"
          value={entry.id}
          onCommit={handleRename}
          hint="Перейменування НЕ переписує посилання: Cost вузлів дерева і Points заготовок лишаться зі старим Id (вузол із невідомим типом сервер ВІДКИНЕ). Порівняння в грі кейс-чутливе."
        />
        <p className="hint pt-rename-hint">
          Перейменування не переписує посилання (Cost вузлів, Points заготовок) — переведіть їх
          руками, інакше вузли з цим типом сервер відкине.
        </p>
        <TextField id="pt-name" label="Назва" value={entry.name} onCommit={(v) => commit((pt) => (pt.Name = v))} />
        <div className="rule-field">
          <label className="field-label" htmlFor="pt-color">
            Колір
          </label>
          <div className="pt-color-row">
            <input id="pt-color" className="field-input field-input-mono" type="text" value={entry.color} onChange={(e) => commit((pt) => (pt.Color = e.target.value))} />
            <ColorChip color={entry.color} />
          </div>
        </div>
        <TextField id="pt-icon" label="Іконка (Icon)" value={iconOf(project, entry)} onCommit={(v) => commit((pt) => (pt.Icon = v))} />
        <IntField id="pt-sortorder" label="Порядок (SortOrder)" value={entry.sortOrder} onCommit={(v) => commit((pt) => (pt.SortOrder = v))} />
        <div className="rule-field">
          <label className="field-label" htmlFor="pt-category">
            Категорія
          </label>
          <ZpSelect id="pt-category" value={entry.category} onChange={(v) => commit((pt) => (pt.Category = v))} options={categoryOptions} allowFree aria-label="Категорія типу балів" />
        </div>
        <div className="rule-field">
          <label className="field-label" htmlFor="pt-kind">
            Вид
          </label>
          <ZpSelect id="pt-kind" value={entry.kind} onChange={(v) => commit((pt) => (pt.Kind = v))} options={kindOptions} allowFree aria-label="Вид типу балів" />
        </div>
        <IntField id="pt-tier" label="Тір (0..10)" value={entry.tier} onCommit={(v) => commit((pt) => (pt.Tier = v))} />
      </fieldset>

      {!entry.duplicate && (
        <button type="button" className="rule-array-remove pt-delete-type" onClick={handleDeleteType} onBlur={() => setArmedDelete(false)}>
          {armedDelete ? 'Точно видалити? Натисніть ще раз' : '× Видалити тип'}
        </button>
      )}
    </>
  )
}

// Icon читається з parsed напряму (MatrixEntry його не носить — матриці/клітинкам він не
// потрібен, а тягти всі поля в кожну клітинку було б зайвим). Панель — єдиний споживач.
function iconOf(project: Project, entry: MatrixEntry): string {
  const doc = project.files.find((f) => f.kind === 'pointTypes')?.parsed as { PointTypes?: Record<string, unknown>[] } | undefined
  const raw = doc?.PointTypes?.[entry.index]
  return raw && typeof raw.Icon === 'string' ? raw.Icon : ''
}

// ---- редактор осей --------------------------------------------------------------------------

interface AxisEditorProps {
  project: Project
  axis: DimensionAxis
  title: string
  entries: MatrixAxisEntry[]
  // Дублі Id ЦІЄЇ осі (ревью T2, minor 3): близнюк ніколи не рендериться рядком
  // (axisEntries — «перший виграє»), тож без цього попередження він був би невидимий
  // і неполагоджуваний мовчки (мутатори на дублі відмовляють «виправте вручну»).
  duplicates: { id: string; count: number }[]
  onProjectChange: (next: Project) => void
}

function AxisEditor({ project, axis, title, entries, duplicates, onProjectChange }: AxisEditorProps) {
  const [axisError, setAxisError] = useState<string | null>(null)
  const [newId, setNewId] = useState('')

  function run(result: { ok: true; project: Project } | { ok: false; error: string }) {
    if (result.ok) {
      setAxisError(null)
      onProjectChange(result.project)
    } else {
      setAxisError(result.error)
    }
  }

  function handleAdd() {
    const id = newId.trim()
    if (id === '') {
      setAxisError('вкажіть Id нової осі')
      return
    }
    const result = createDimension(project, axis, id)
    if (result.ok) setNewId('')
    run(result)
  }

  return (
    <div className="pt-axis">
      <span className="sheet-title label">{title}</span>
      {duplicates.length > 0 && (
        <p className="indicator" role="status">
          <span className="lamp lamp-warn" aria-hidden="true" />
          {'дублі Id осі (показано лише перше входження, сервер теж бере перше): '}
          {duplicates.map((d) => `'${d.id}' ×${d.count}`).join(', ')}
          {' — приберіть зайві рядки у файлі вручну (рушій осі не валідує, це не аварія)'}
        </p>
      )}
      {axisError && (
        <p className="indicator alarm" role="alert">
          <span className="lamp lamp-alarm" aria-hidden="true" />
          {axisError}
        </p>
      )}
      <table className="pt-axis-table">
        <thead>
          <tr>
            <th>Код (Id)</th>
            <th>Назва</th>
            <th>Порядок</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((d) => (
            <tr key={`${d.index}:${d.id}`}>
              <td>
                <BufferedTextField id={`ax-${axis}-id-${d.index}`} label="" value={d.id} onCommit={(v) => run(renameDimension(project, axis, d.id, v))} />
              </td>
              <td>
                <TextField id={`ax-${axis}-name-${d.index}`} label="" value={d.name} onCommit={(v) => run(applyDimensionEdit(project, axis, d.id, (x) => (x.Name = v)))} />
              </td>
              <td>
                <IntField id={`ax-${axis}-order-${d.index}`} label="" value={d.sortOrder} onCommit={(v) => run(applyDimensionEdit(project, axis, d.id, (x) => (x.SortOrder = v)))} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pt-axis-add">
        <input
          id={`ax-${axis}-add`}
          className="field-input field-input-mono"
          type="text"
          placeholder="новий Id"
          value={newId}
          onChange={(e) => setNewId(e.target.value)}
        />
        <button type="button" onClick={handleAdd} aria-label={`Додати вісь у ${title}`}>
          + Додати
        </button>
      </div>
    </div>
  )
}

// ---- сама вкладка ---------------------------------------------------------------------------

export interface PointTypesViewProps {
  project: Project
  onProjectChange: (next: Project) => void
  // W4 Task 5: перехід із вкладки «Баланс» — вибрати саме цей тип (див. focusRequest.ts)
  focus?: FocusRequest | null
}

export function PointTypesView({ project, onProjectChange, focus }: PointTypesViewProps) {
  const pointTypesFile = project.files.find((f) => f.kind === 'pointTypes')
  const doc = pointTypesFile?.parsed
  // Кнопка «+ тір» додає порожні колонки справа (стеля 10 — межа Validate); рішення про
  // діапазон колонок задокументоване в шапці pointTypesMatrix.ts.
  const [extraTiers, setExtraTiers] = useState(0)
  const matrix = useMemo(() => buildPointTypesMatrix(doc, extraTiers), [doc, extraTiers])
  const gateAlarms = useMemo(() => pointTypesGateAlarms(project), [project])

  const [selected, setSelected] = useState<MatrixSelection | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const selectedEntry = resolveMatrixSelection(matrix, selected)

  // Фокус ззовні («Баланс» -> сюди): шукаємо запис ТОЧНИМ ==, як сам сервер (Find :317-325).
  // Немає такого Id — вибір не чіпаємо: краще лишити адміна там, де він був, ніж підсунути
  // сусідній запис (урок внутрішньоігрового редактора про виділення номером рядка).
  useEffect(() => {
    if (!focus) return
    const entry = matrix.entries.find((e) => e.id === focus.value)
    if (entry) setSelected({ index: entry.index, id: entry.id })
    // matrix свідомо поза залежностями: реагуємо на ПОДІЮ фокуса, а не на кожен перерахунок
    // матриці (інакше будь-яка правка типу знову «телепортувала» б вибір на старий запит).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus])

  function handleCreate(cat: MatrixAxisEntry, kind: MatrixAxisEntry, tier: number) {
    const id = suggestPointTypeId(doc, cat.id, kind.id, tier)
    const result = createPointType(project, id, {
      Name: suggestPointTypeName(cat, kind, tier),
      Color: categoryColor(doc, cat.id),
      Category: cat.id,
      Kind: kind.id,
      Tier: tier,
    })
    if (result.ok) {
      setCreateError(null)
      onProjectChange(result.project)
      setSelected({ index: matrix.entries.length, id })
    } else {
      setCreateError(result.error)
    }
  }

  // Пряме (без взводу) позиційне видалення близнюка З МАТРИЦІ/секції «поза матрицею» —
  // документований шлях ремонту гейта (хвіст 2 ревʼю T1): гейт уже тримає збереження, зайве
  // підтвердження лише подовжувало б аварійний стан.
  function handleInlineDelete(index: number) {
    const result = deletePointTypeAt(project, index)
    if (!result.ok) {
      setCreateError(result.error)
      return
    }
    setCreateError(null)
    onProjectChange(result.project)
    setSelected(adjustSelectionAfterDelete(selected, index))
  }

  if (!pointTypesFile) {
    return (
      <p className="indicator" role="status">
        <span className="lamp lamp-warn" aria-hidden="true" />У проєкті немає PointTypes.json — відкрийте теку чи ZIP із ним. Сервер створює цей файл
        сам із дефолтами при першому запуску, редактор його з нуля не вигадує.
      </p>
    )
  }

  const maxTierShown = matrix.tiers[matrix.tiers.length - 1] ?? 0

  return (
    <div className="point-types-view">
      {gateAlarms.length > 0 && (
        <section className="sheet alarm-gate-panel pt-gate-banner" role="alert">
          <PointTypesGateBody alarms={gateAlarms} />
        </section>
      )}

      {createError && (
        <p className="indicator alarm" role="alert">
          <span className="lamp lamp-alarm" aria-hidden="true" />
          {createError}
        </p>
      )}

      <section className="sheet pt-matrix-sheet">
        <div className="sheet-title-row">
          <span className="sheet-title label">Матриця типів балів (Категорія × Вид × Тір)</span>
          <button type="button" onClick={() => setExtraTiers((n) => n + 1)} disabled={maxTierShown >= 10} title="Додати порожню колонку тіра праворуч (стеля 10 — сервер відхиляє Tier > 10)">
            + тір
          </button>
        </div>

        {matrix.categories.length === 0 || matrix.kinds.length === 0 ? (
          <p className="indicator" role="status">
            <span className="lamp lamp-warn" aria-hidden="true" />
            Осі порожні — додайте категорії та види в редакторі осей нижче (рушій на найближчому
            завантаженні і сам заповнить їх із записів, SeedDimensions — але з сирими Id замість назв).
          </p>
        ) : (
          <div className="pt-matrix-scroll">
            <table className="pt-matrix">
              <thead>
                <tr>
                  <th className="pt-matrix-corner" rowSpan={2}>
                    Категорія
                  </th>
                  {matrix.kinds.map((k) => (
                    <th key={k.id} colSpan={matrix.tiers.length} className="pt-kind-head">
                      {k.name !== '' ? k.name : k.id} <code>{k.id}</code>
                    </th>
                  ))}
                </tr>
                <tr>
                  {matrix.kinds.map((k) =>
                    matrix.tiers.map((t) => (
                      <th key={`${k.id}:${t}`} className="pt-tier-head">
                        Тір {t}
                      </th>
                    )),
                  )}
                </tr>
              </thead>
              <tbody>
                {matrix.categories.map((cat) => (
                  <tr key={cat.id}>
                    <th scope="row" className="pt-cat-head">
                      <ColorChip color={categoryColor(doc, cat.id)} />
                      <span className="pt-cat-name">{cat.name !== '' ? cat.name : cat.id}</span> <code>{cat.id}</code>
                    </th>
                    {matrix.kinds.map((k) =>
                      matrix.tiers.map((t) => {
                        const entries = matrix.cells.get(cellKey(cat.id, k.id, t)) ?? []
                        return (
                          <td key={`${k.id}:${t}`} className="pt-cell" data-cat={cat.id} data-kind={k.id} data-tier={t}>
                            {entries.map((e) => (
                              <div key={e.index} className={`pt-cell-entry${e.duplicate ? ' pt-cell-entry-dup' : ''}`}>
                                <button
                                  type="button"
                                  className={`pt-entry-select${selectedEntry && selectedEntry.index === e.index ? ' selected' : ''}`}
                                  onClick={() => setSelected({ index: e.index, id: e.id })}
                                  title={e.id}
                                >
                                  {e.duplicate && <span className="lamp lamp-alarm" aria-hidden="true" />}
                                  <ColorChip color={e.color} />
                                  <span className="pt-entry-name">{e.name !== '' ? e.name : e.id}</span>
                                  <span className="pt-entry-order">№{e.sortOrder}</span>
                                </button>
                                {e.duplicate && (
                                  <button type="button" className="pt-entry-delete" onClick={() => handleInlineDelete(e.index)} aria-label={`Видалити запис №${e.index + 1}`}>
                                    × видалити
                                  </button>
                                )}
                              </div>
                            ))}
                            {entries.length === 0 && (
                              <button type="button" className="pt-entry-create" onClick={() => handleCreate(cat, k, t)} aria-label={`Створити тип: ${cat.id} / ${k.id} / тір ${t}`}>
                                + створити
                              </button>
                            )}
                          </td>
                        )
                      }),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {matrix.outside.length > 0 && (
        <section className="sheet pt-outside">
          <span className="sheet-title label">Поза матрицею ({matrix.outside.length})</span>
          <p className="hint">
            Ці записи не лягають у матрицю (розсинхрон із осями чи аварійні поля). Сервер їх НЕ
            губить: блок стане в кінець із сирим Id (DimensionName/DimensionOrder,
            ZP_PointTypesConfig.c:237-255) — але після перейменування осі саме тут видно
            записи, які треба перевести руками.
          </p>
          <ul className="pt-outside-list">
            {matrix.outside.map((o) => (
              <li key={o.entry.index} className="pt-outside-row">
                <button type="button" className={`pt-entry-select${selectedEntry && selectedEntry.index === o.entry.index ? ' selected' : ''}`} onClick={() => setSelected({ index: o.entry.index, id: o.entry.id })}>
                  <ColorChip color={o.entry.color} />
                  <code>{o.entry.id !== '' ? o.entry.id : `запис №${o.entry.index + 1}`}</code>
                  <span className="pt-entry-name">{o.entry.name}</span>
                </button>
                <span className="pt-outside-reasons">{o.reasons.join('; ')}</span>
                {(o.entry.id === '' || o.entry.duplicate) && (
                  <button type="button" className="pt-entry-delete" onClick={() => handleInlineDelete(o.entry.index)} aria-label={`Видалити запис №${o.entry.index + 1}`}>
                    × видалити
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="pt-lower">
        <section className="sheet pt-axes">
          <span className="sheet-title label">Осі матриці</span>
          <p className="hint">
            Осі — дані файлу (сервер їх не валідує і не має для них операцій). Перейменування
            коду осі НЕ переписує записи матриці: вони підуть у «поза матрицею», доки ви не
            переведете їх руками.
          </p>
          <div className="pt-axes-row">
            <AxisEditor project={project} axis="Categories" title="Категорії" entries={matrix.categories} duplicates={matrix.axisDuplicates.filter((d) => d.axis === 'Categories')} onProjectChange={onProjectChange} />
            <AxisEditor project={project} axis="Kinds" title="Види" entries={matrix.kinds} duplicates={matrix.axisDuplicates.filter((d) => d.axis === 'Kinds')} onProjectChange={onProjectChange} />
          </div>
        </section>

        <aside className="sheet pt-detail">
          {selectedEntry ? (
            <EntryPanel
              // key: T9-урок — перемикання запису перемонтовує панель із чистим станом
              // (commitError, буфери полів, взведене видалення)
              key={`${selectedEntry.index}:${selectedEntry.id}`}
              project={project}
              matrix={matrix}
              entry={selectedEntry}
              onProjectChange={onProjectChange}
              onSelect={setSelected}
            />
          ) : (
            <p className="intro">Виберіть запис у матриці або створіть новий у порожній клітинці.</p>
          )}
        </aside>
      </div>
    </div>
  )
}
