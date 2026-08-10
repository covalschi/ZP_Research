// Смуга «Відкрити станок» над полотном ланцюгів (W4 Task 6, хвіст капстоуна №2).
//
// Живе САМЕ ТУТ, а не всередині ChainView: полотно при нулі станків взагалі не рендериться
// (ChainViewInner повертає порожній стан замість ReactFlow), тож будь-який вхід усередині
// нього був би недосяжний рівно тоді, коли він найпотрібніший — у порожньому проєкті.
//
// Вибір відкриває вікно станка для БУДЬ-ЯКОГО класу, зокрема такого, у якого ще немає
// жодного правила: саме вікно це вже вміє (StationWindow працює на синтетичній порожній
// картці — «немає в моделі», і масове додавання сировини там доступне).

import { useMemo } from 'react'
import type { Project } from '../io/project'
import type { ClassIndex } from '../model/classIndex'
import { buildStationView } from '../model/stationView'
import { collectStationOpenOptions } from './stationOpen'
import { ZpSelect } from './ZpSelect'
import type { ZpOption } from './ZpSelect'

export interface StationOpenBarProps {
  project: Project
  index: ClassIndex
  openStation: string | null
  onOpenStation: (classname: string) => void
}

export function StationOpenBar({ project, index, openStation, onOpenStation }: StationOpenBarProps) {
  const view = useMemo(() => buildStationView(project, index), [project, index])
  const optionsSource = useMemo(
    () =>
      (query: string, limit: number): ZpOption[] =>
        collectStationOpenOptions(view.stations, index, query, limit),
    [view, index],
  )

  return (
    <section className="station-open-bar">
      <label className="field-label" htmlFor="station-open-picker">
        Відкрити станок
      </label>
      <ZpSelect
        id="station-open-picker"
        value={openStation ?? ''}
        onChange={onOpenStation}
        optionsSource={optionsSource}
        allowFree
        placeholder="прилад проєкту або будь-який клас із індексу…"
        aria-label="Відкрити вікно станка"
      />
      <span className="hint">
        {view.stations.length === 0
          ? 'У проєкті ще немає жодного станка — оберіть клас приладу, і вікно відкриється порожнім: там же створюється перше правило.'
          : 'Станок без жодного правила на полотні не малюється — відкрийте його звідси.'}
      </span>
    </section>
  )
}
