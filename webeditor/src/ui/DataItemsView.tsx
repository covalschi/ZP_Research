// DataItemsView — вкладка «Заготовки» (W4 Task 4): повний список УСІХ класів родини
// ZP_Data_Base (скан індексу, 90 на поточній збірці — прецедент SampleTypesView) плюс
// сироти-записи DataItems.json, чий Id поза родиною (сервер їх ВИКИНЕ — рядок це чесно
// каже). До цього таска редактор заготовок відкривався ЛИШЕ кліком по картці на полотні
// ланцюгів — заготовку, яку жодне правило не виробляє, не можна було навіть побачити.
//
// Деталь-панель — ПЕРЕВИКОРИСТАНИЙ DataItemEditForm (спільне тіло з DataItemQuickEdit
// полотна, W4 Task 4 — не копія); рядки — чисті хелпери ui/dataItemRows.ts (TDD).
// Відсутній DataItems.json — підказка без створення файлу з нуля (прецедент PointTypesView:
// сервер сам пише файл із дефолтами при першому буті; файл живе з M1) — список класів при
// цьому ПОКАЗУЄТЬСЯ (він з індексу, не з файлу), а форма сама пояснює, чому правка недоступна.

import { useEffect, useMemo, useState } from 'react'
import type { Project } from '../io/project'
import type { ClassIndex } from '../model/classIndex'
import { buildDataItemRows, filterDataItemRows } from './dataItemRows'
import { DataItemEditForm } from './DataItemEditForm'
import type { FocusRequest } from './focusRequest'

export interface DataItemsViewProps {
  project: Project
  index: ClassIndex
  onProjectChange: (next: Project) => void
  // W4 Task 5: перехід із вкладки «Баланс» — відкрити саме цей клас (див. focusRequest.ts)
  focus?: FocusRequest | null
}

export function DataItemsView({ project, index, onProjectChange, focus }: DataItemsViewProps) {
  const dataItemsLoaded = project.files.some((f) => f.kind === 'dataItems')
  // useMemo([project, index]) — той самий урок T9/SampleTypesView: без нього скан 33k-індексу
  // і резолв 90 лиць перераховувались би на кожне натискання клавіші у фільтрі.
  const { rows, docProblems } = useMemo(() => buildDataItemRows(project, index), [project, index])
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => filterDataItemRows(rows, query), [rows, query])
  const [selected, setSelected] = useState<string | null>(null)

  // Фокус ззовні: скидаємо ще й фільтр — інакше рядок міг би лишитись за межами вибірки, і
  // адмін побачив би відкриту панель без підсвіченого рядка в переліку.
  useEffect(() => {
    if (!focus) return
    setSelected(focus.value)
    setQuery('')
  }, [focus])

  return (
    <div className="entity-workspace">
      <section className="sheet entity-list">
        <span className="sheet-title label">Заготовки ZP_Data_* ({rows.length})</span>
        <p className="hint">
          Класи нейтральні й наскрізні — імʼя, опис і бали здачі задає лише DataItems.json
          (перепризначаються на льоту без нової збірки). Невалідні записи (порожній Name, клас
          поза родиною, дублі Id) сервер ВИКИДАЄ з файлу при завантаженні (руйнівний Validate,
          ZP_DataItemsConfig.c:105-137) — лампа рядка попереджає до того.
        </p>

        {!dataItemsLoaded && (
          <p className="indicator" role="status">
            <span className="lamp lamp-warn" aria-hidden="true" />У проєкті немає DataItems.json — список нижче показує класи з індексу, але редагувати
            записи нема куди. Сервер створює цей файл сам із дефолтами при першому запуску,
            редактор його з нуля не вигадує.
          </p>
        )}

        {docProblems.map((p, i) => (
          <p key={i} className="indicator alarm" role="alert">
            <span className="lamp lamp-alarm" aria-hidden="true" />
            {p.message}
          </p>
        ))}

        <div className="rule-field data-items-filter">
          <label className="field-label" htmlFor="di-filter">
            Фільтр (клас або назва)
          </label>
          <input id="di-filter" className="field-input" type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="напр. _77 або химер…" />
        </div>

        <table className="file-list entity-table">
          <thead>
            <tr>
              <th>Клас</th>
              <th>Назва</th>
              <th>Бали</th>
              <th>Стан</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const isSelected = r.classname === selected
              return (
                <tr key={r.classname} className={isSelected ? 'selected' : undefined}>
                  <td>
                    <button type="button" className="row-select" aria-current={isSelected ? 'true' : undefined} onClick={() => setSelected(r.classname)}>
                      <code>{r.classname}</code>
                    </button>
                  </td>
                  <td>
                    {r.face.duplicate ? (
                      <span className="warn-count alarm">
                        <span className="lamp lamp-alarm" aria-hidden="true" />
                        дубль Id
                      </span>
                    ) : r.face.configured ? (
                      r.face.name
                    ) : (
                      <span className="hint">не налаштовано</span>
                    )}
                  </td>
                  <td>{r.pointsSummary !== '' ? <code>{r.pointsSummary}</code> : ''}</td>
                  <td>
                    {r.tone !== 'ok' ? (
                      <span className={`lamp lamp-${r.tone}`} aria-hidden="true" title={r.problems.map((p) => p.message).join('; ')} />
                    ) : (
                      r.face.configured && <span className={`lamp ${r.face.enabled ? 'lamp-ok' : 'lamp-warn'}`} aria-hidden="true" title={r.face.enabled ? 'налаштовано й увімкнено' : 'вимкнено — у грі покажеться запасна назва'} />
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="intro">Жодного класу не відповідає фільтру.</p>}
      </section>

      <aside className="sheet entity-detail">
        {selected !== null ? (
          <>
            <div className="sheet-title-row">
              <span className="sheet-title label">Заготовка</span>
            </div>
            {/* key: T9-урок — перемикання класу перемонтовує форму з чистим станом */}
            <DataItemEditForm key={selected} project={project} index={index} classname={selected} onProjectChange={onProjectChange} />
          </>
        ) : (
          <p className="intro">Виберіть клас у переліку, щоб побачити чи змінити його ігрове імʼя, опис і бали здачі.</p>
        )}
      </aside>
    </div>
  )
}
