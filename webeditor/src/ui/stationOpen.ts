// Список станків для входу у вікно станка БЕЗ полотна (W4 Task 6, хвіст капстоуна №2).
//
// ЗВІДКИ ЗАДАЧА: єдиним входом у вікно станка був клік по картці на полотні «Ланцюги», а
// картка існує лише там, де в станка вже є ПРАВИЛО (ідентичність вузла полотна =
// станок+правило, W2.6 T2). Проєкт із нуля правил не мав жодного способу відкрити вікно —
// тобто створити ПЕРШЕ правило кліками було неможливо взагалі (знахідка №2 капстоуна).
//
// Список свідомо ШИРШИЙ за view.stations (Device правил + DeviceClasses фракцій):
//   ярус 1 — станки, ВЖЕ відомі проєкту (їх адмін шукає найчастіше), з підказкою;
//   ярус 2 — будь-який клас із ClassIndex (свіжий прилад чужого мода, якого ще немає в
//            жодному конфігу) — рівно те, що вміє пікер сировини у вікні станка.
// Плюс вільний ввід у самому ZpSelect (allowFree) — клас поза індексом теж має відкриватись:
// індекс збирається з локального модпака й не зобовʼязаний знати серверні моди.
//
// Модуль ui/, але ЧИСТИЙ (без React) — та сама конвенція, що ui/optionCollectors.ts:
// тестується в environment='node' (tests/stationOpen.test.ts).

import type { ClassIndex } from '../model/classIndex'
import { searchClasses } from '../model/classIndex'
import type { StationInfo } from '../model/stationView'
import type { ZpOption } from './ZpSelect'
import { filterOptions } from './ZpSelect'

// Позначка ярусу 1 у підказці опції. Класнейм у підказці лишається ПЕРШИМ — filterOptions
// шукає по hint підрядком із префікс-пріоритетом, тож набраний класнейм і далі дає
// префіксний збіг (адміни думають класнеймами, W2.6 Task 4).
export const STATION_KNOWN_HINT = 'станок проєкту'

export function collectStationOpenOptions(stations: StationInfo[], index: ClassIndex, query: string, limit: number): ZpOption[] {
  const known: ZpOption[] = stations.map((st) => ({
    id: st.classname,
    label: st.display,
    hint: `${st.classname} · ${STATION_KNOWN_HINT}`,
  }))
  const out = filterOptions(known, query, limit)
  if (out.length >= limit) return out

  // Дедуп проти ярусу 1 — кейс-інсенситивний: у stationView класнейм станка зберігає
  // ПЕРШИЙ побачений регістр (Фаза 1), а індекс несе канонічний із config.cpp; це той
  // самий клас, і два рядки на нього були б брехнею (та ще й однаковим key у ZpSelect).
  const seen = new Set(out.map((o) => o.id.toLowerCase()))
  for (const hit of searchClasses(index, query, limit)) {
    if (out.length >= limit) break
    const lower = hit.name.toLowerCase()
    if (seen.has(lower)) continue
    seen.add(lower)
    out.push({ id: hit.name, label: hit.display !== '' ? hit.display : hit.name, hint: `${hit.name} · ${hit.mod}` })
  }
  return out
}
