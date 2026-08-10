// DataItemEditForm — СПІЛЬНЕ тіло редактора однієї заготовки (ZP_Data_*), винесене з
// DataItemQuickEdit.tsx (W4 Task 4). ДВА входи, ОДИН компонент (вимога брифа «не копія»):
//   1) полотно ланцюгів — floating-обгортка DataItemQuickEdit (клік по data-face-тегу
//      картки, W2 Task 9 / W2.6 Task 2);
//   2) вкладка «Заготовки» — деталь-панель списку всіх 90 класів (DataItemsView, W4 Task 4).
// Обгортки дають лише рамку (aside/заголовок/кнопку закриття) — уся логіка (створення
// запису, банер дубля, поля, Points) живе тут і не роздвоюється.
//
// Контракт незмінний з T9: "чиста мутація -> onProjectChange -> живий рендер" —
// applyDataItemEdit/createDataItem (io/dataItemEdit.ts) повертають НОВИЙ Project, обгортка
// підміняє ним стан; поточний стан щоразу перечитується з project через resolveDataItemFace
// (ту саму функцію, якою рендеряться і картка полотна, і рядок списку), тож форма ніколи не
// розходиться з тим, що бачить адмін поруч.
//
// Обидві обгортки монтуються з key={classname} (T9-урок): перемикання заготовки скидає
// internal стан (commitError, буфери полів) з чистого листа. Ids полів (di-*) спільні —
// колізія неможлива: вкладки рендеряться взаємовиключно (App.tsx, tab === '...').

import { useEffect, useMemo, useState } from 'react'
import type { Project } from '../io/project'
import { applyDataItemEdit, createDataItem } from '../io/dataItemEdit'
import type { ClassIndex } from '../model/classIndex'
import { resolveDataItemFace } from '../model/faceResolve'
import type { DataItemFace } from '../model/faceResolve'
import { ZpSelect } from './ZpSelect'
import { collectPointTypeOptions } from './optionCollectors'

// isReadOnly: РІВНО той предикат, яким форма нижче гейтує <fieldset disabled=...> --
// винесений в окрему експортовану функцію (рев'ю фікс-раунду 1 T9, Important 1c), щоб тест
// перевіряв САМЕ те булеве значення, яке реально йде в disabled-проп компонента.
export function isReadOnly(face: DataItemFace): boolean {
  return face.duplicate
}

// Поля-заглушки — той самий НАВМИСНИЙ невеликий дублікат приватних компонентів RulePanel
// (задокументований компроміс T9): логіка тривіальна, дублювання дешевше за міжмодульну
// звʼязність двох незалежних форм. Переїхали сюди з DataItemQuickEdit.tsx разом із формою.
function TextField({ id, label, value, onCommit }: { id: string; label: string; value: string; onCommit: (v: string) => void }) {
  return (
    <div className="rule-field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input id={id} className="field-input" type="text" value={value} onChange={(e) => onCommit(e.target.value)} />
    </div>
  )
}

function IntField({ id, label, value, onCommit, min }: { id: string; label: string; value: number; onCommit: (v: number) => void; min?: number }) {
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
          if (Number.isFinite(n)) onCommit(min !== undefined ? Math.max(min, n) : n)
        }}
      />
    </div>
  )
}

function CheckboxField({ id, label, checked, onCommit, title }: { id: string; label: string; checked: boolean; onCommit: (v: boolean) => void; title?: string }) {
  return (
    <label className="rule-checkbox" htmlFor={id} title={title}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onCommit(e.target.checked)} />
      {label}
    </label>
  )
}

export interface DataItemEditFormProps {
  project: Project
  index: ClassIndex
  // Класнейм заготовки — ЄДИНЕ джерело ідентичності (стан щоразу перечитується з project).
  classname: string
  onProjectChange: (next: Project) => void
}

export function DataItemEditForm({ project, index, classname, onProjectChange }: DataItemEditFormProps) {
  const dataItemsLoaded = project.files.some((f) => f.kind === 'dataItems')
  const face: DataItemFace = resolveDataItemFace(project, index, classname)
  // useMemo([project]) — рев'ю фікс-раунду 1 T9, Important 2: без нього перебір
  // PointTypes.json перераховувався б на КОЖНЕ натискання клавіші в di-name/di-description.
  const pointTypeOptions = useMemo(() => collectPointTypeOptions(project), [project])
  // Рев'ю фікс-раунду 1 T9, Important 1(b): помилка мутатора ПОКАЗУЄТЬСЯ, а не мовчки
  // відкидається — адмін бачить, ЧОМУ поле «не тримається».
  const [commitError, setCommitError] = useState<string | null>(null)

  function commit(updater: (item: Record<string, unknown>) => void) {
    if (!face.entryId) return // не мало б статись: кнопки правки показуються лише коли face.configured
    const result = applyDataItemEdit(project, face.entryId, updater)
    if (result.ok) {
      setCommitError(null)
      onProjectChange(result.project)
    } else {
      setCommitError(result.error)
    }
  }

  function handleCreate() {
    const result = createDataItem(project, classname)
    if (result.ok) {
      setCommitError(null)
      onProjectChange(result.project)
    } else {
      setCommitError(result.error)
    }
  }

  function addPoint() {
    commit((item) => {
      ;(item.Points as unknown[]).push({ Type: '', Amount: 0 })
    })
  }
  function removePoint(i: number) {
    commit((item) => {
      ;(item.Points as unknown[]).splice(i, 1)
    })
  }
  function commitPointType(i: number, value: string) {
    commit((item) => {
      ;(item.Points as Record<string, unknown>[])[i].Type = value
    })
  }
  function commitPointAmount(i: number, value: number) {
    commit((item) => {
      ;(item.Points as Record<string, unknown>[])[i].Amount = value
    })
  }

  return (
    <>
      <p className="field-readonly">
        <code>{classname}</code>
      </p>

      {!dataItemsLoaded && (
        <p className="indicator" role="status">
          <span className="lamp lamp-warn" aria-hidden="true" />
          DataItems.json не завантажено — відкрийте теку або ZIP із цим файлом, щоб редагувати заготовки.
        </p>
      )}

      {commitError && (
        <p className="indicator alarm" role="alert">
          <span className="lamp lamp-alarm" aria-hidden="true" />
          {commitError}
        </p>
      )}

      {dataItemsLoaded && !face.configured && (
        <>
          <p className="indicator" role="status">
            <span className="lamp lamp-warn" aria-hidden="true" />
            Ця заготовка не налаштована — у грі показується запасна назва зі stringtable («Біодані/Аномальні дані/Технічні дані NN (не налаштовано)» — залежно від групи класу), бо ZP_DataInfo.Lookup не знаходить запис.
          </p>
          <button type="button" onClick={handleCreate}>
            + Створити запис
          </button>
        </>
      )}

      {/* Рев'ю фікс-раунду 1 T9, Important 1(b): "дубль Id -- форма лише для перегляду" --
          дубль неможливий БЕЗ configured=true (findDataItemEntry знаходить запис, лише якщо
          він є хоч один), тому банер живе всередині гілки face.configured. */}
      {dataItemsLoaded && face.configured && face.duplicate && (
        <p className="indicator alarm" role="alert">
          <span className="lamp lamp-alarm" aria-hidden="true" />
          Дублікат Id «{classname}» у DataItems.json — рушій залишить ОСТАННІЙ запис;
          виправте вручну (форма нижче — лише для перегляду).
        </p>
      )}

      {dataItemsLoaded && face.configured && (
        <fieldset className="rule-form" disabled={isReadOnly(face)}>
          <TextField id="di-name" label="Назва" value={face.name} onCommit={(v) => commit((it) => (it.Name = v))} />
          <div className="rule-field">
            <label className="field-label" htmlFor="di-description">
              Опис
            </label>
            <textarea
              id="di-description"
              className="field-textarea"
              value={face.description}
              onChange={(e) => commit((it) => (it.Description = e.target.value))}
              rows={3}
            />
          </div>
          <CheckboxField
            id="di-enabled"
            label="Увімкнено"
            checked={face.enabled}
            onCommit={(v) => commit((it) => (it.Enabled = v))}
            title="Вимкнена заготовка виводиться в грі із запасною назвою зі stringtable (за групою класу: «Біодані/Аномальні дані/Технічні дані NN (не налаштовано)») — сервер (ZP_DataItemsConfig.Find) ігнорує вимкнені записи"
          />

          <fieldset className="rule-group">
            <legend className="field-label">Бали при здачі (Points)</legend>
            {face.points.map((p, i) => (
              <div className="rule-row-card" key={i}>
                <div className="rule-field">
                  <label className="field-label" htmlFor={`di-point-type-${i}`}>
                    Тип балів
                  </label>
                  <ZpSelect
                    id={`di-point-type-${i}`}
                    value={p.Type}
                    onChange={(v) => commitPointType(i, v)}
                    options={pointTypeOptions}
                    allowFree
                    aria-label={`Тип балів ${i + 1}`}
                  />
                </div>
                <IntField id={`di-point-amount-${i}`} label="Кількість" value={p.Amount} min={0} onCommit={(v) => commitPointAmount(i, v)} />
                <button type="button" className="rule-array-remove" onClick={() => removePoint(i)} aria-label={`Прибрати нагороду ${i + 1}`}>
                  × Прибрати
                </button>
              </div>
            ))}
            <button type="button" className="rule-array-add" onClick={addPoint}>
              + Додати нагороду
            </button>
          </fieldset>
        </fieldset>
      )}
    </>
  )
}
