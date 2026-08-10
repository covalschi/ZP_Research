// Єдина копія collectPointTypeOptions (W4 Task 1) — злиття двох копій, що ВЖЕ розійшлися
// (дрейф, зафіксований планом W4): TreeNodePanel.tsx:62-78 дедупив дублі Id, DataItemQuickEdit
// .tsx:35-48 — ні (дубль давав два ZpOption з однаковим key у ZpSelect). Канонічна поведінка —
// З ДЕДУПОМ «перший виграє»: дзеркало ZP_PointTypesConfig.Find (ZP_PointTypesConfig.c:317-325 —
// кейс-СЕНСИТИВНЕ `pt.Id == id`, ПЕРШИЙ збіг, як і FindNode): другий близнюк для сервера
// недосяжний, тож показувати його опцією було б брехнею, а однакові key ламали б ZpSelect.
//
// Модуль ui/, але ЧИСТИЙ (без React): імпортує лише типи — тестується в environment='node'
// (tests/optionCollectors.test.ts), як решта чистих хелперів ui/-шару.

import type { Project } from '../io/project'
import type { ZpOption } from './ZpSelect'

// label — людська назва (Name), порожній Name — сирий Id; hint — сам Id (роздрук у списку).
export function collectPointTypeOptions(project: Project): ZpOption[] {
  const file = project.files.find((f) => f.kind === 'pointTypes')
  const doc = file?.parsed as { PointTypes?: unknown[] } | undefined
  if (!doc || !Array.isArray(doc.PointTypes)) return []
  const seen = new Set<string>()
  const out: ZpOption[] = []
  for (const raw of doc.PointTypes) {
    if (!raw || typeof raw !== 'object') continue
    const pt = raw as Record<string, unknown>
    if (typeof pt.Id !== 'string' || pt.Id === '') continue
    if (seen.has(pt.Id)) continue
    seen.add(pt.Id)
    const name = typeof pt.Name === 'string' && pt.Name !== '' ? pt.Name : pt.Id
    out.push({ id: pt.Id, label: name, hint: pt.Id })
  }
  return out
}
