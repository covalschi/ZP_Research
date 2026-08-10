// Мутатор ОДНОГО правила ProcessingRules (W2 Task 6) — ЄДИНА крапка, крізь яку форма
// правила (RuleForm у RulePanel.tsx; з W2.6 T3 вбудована в рядок вікна станка) записує
// правку назад у Project. Чиста функція (без React): бере ПОТОЧНИЙ Project,
// deep-copy лише documenа файлу-цілі (structuredClone), застосовує updater на знайденому
// правилі копії, повертає НОВИЙ Project із НОВИМ files-масивом, де замінено РІВНО один
// об'єкт файлу (dirty=true) — решта файлів зберігає ТІ САМІ посилання (щоб React (T5
// useMemo([project, index]) у ChainView) перемальовував лише те, що справді змінилось,
// а не весь список файлів наново).
//
// Дублікат Id В ОДНОМУ файлі (assignNodeKeys/ChainView, T5, уже документує цю межу
// точності моделі) робить редагування "за (filePath, ruleId)" неоднозначним: правка
// ПЕРШОГО збігу — НЕ прийнятна поведінка (мовчки редагувала б не те правило, яке адмін
// щойно обрав кліком по картці графа). Функція явно відмовляє з поясненням замість
// вгадування.

import type { Project, ProjectFile } from './project'

export interface RulesFileDoc {
  ConfigVersion: number
  Rules: Record<string, unknown>[]
}

export type ApplyRuleEditResult = { ok: true; project: Project } | { ok: false; error: string }

export function applyRuleEdit(
  project: Project,
  filePath: string,
  ruleId: string,
  updater: (rule: Record<string, unknown>) => void,
): ApplyRuleEditResult {
  const file = project.files.find((f) => f.path === filePath)
  if (!file) return { ok: false, error: `файл не знайдено: ${filePath}` }
  if (file.kind !== 'rules') return { ok: false, error: `не файл правил: ${filePath}` }

  const doc = file.parsed as RulesFileDoc | undefined
  if (!doc || !Array.isArray(doc.Rules)) return { ok: false, error: `файл правил не розібрано: ${filePath}` }

  const matchIdx: number[] = []
  doc.Rules.forEach((r, i) => {
    if (r && typeof r === 'object' && (r as Record<string, unknown>).Id === ruleId) matchIdx.push(i)
  })
  if (matchIdx.length === 0) return { ok: false, error: `правило '${ruleId}' не знайдено у ${filePath}` }
  if (matchIdx.length > 1) {
    return { ok: false, error: `дубль Id у файлі — виправте вручну` }
  }

  // structuredClone ЛИШЕ ЦЬОГО документа — жоден інший ProjectFile навіть не
  // проходить крізь клонування, тож їхні об'єкти лишаються ТИМИ САМИМИ посиланнями
  // (умова брифа "недирти файли не зачеплені"). Оригінальний doc/file.parsed після
  // виклику лишається БЕЗ ЗМІН — updater працює лише над копією.
  const newDoc = structuredClone(doc) as RulesFileDoc
  updater(newDoc.Rules[matchIdx[0]])

  const newFile: ProjectFile = { ...file, parsed: newDoc, dirty: true }
  const newFiles = project.files.map((f) => (f === file ? newFile : f))
  return { ok: true, project: { ...project, files: newFiles } }
}
