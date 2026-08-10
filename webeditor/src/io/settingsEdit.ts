// Мутатор Settings.json (W4 Task 1) — контракт dataItemEdit/sampleTypeEdit, але Settings —
// ЄДИНИЙ конфіг без колекції записів (плаский об'єкт полів ZP_SettingsConfig), тож функція
// одна: applySettingsEdit(project, updater) — точкова правка полів над structuredClone-
// копією документа, НОВИЙ Project із заміною РІВНО одного ProjectFile (dirty=true),
// ідентичність решти файлів, відмова — без мутацій.
//
// createSettingsFile НЕ робиться свідомо: Settings.json сервер створює і перезаписує на
// КОЖНОМУ буті (load-then-save, ZP_ConfigService.c:186-197 — «дописує нові поля після
// оновлень мода»), тож у будь-якому реальному профілі/ZIP він є. Той самий аргумент, чому
// dataItemEdit.ts не має createDataItemsFile (DataItems.json живе з M1), на відміну від
// createSampleTypesFile (SampleTypes.json з'явився лише у W2.5 і в старому профілі його
// могло не бути).
//
// Валідацію значень мутатор НЕ робить (той самий поділ, що в усіх мутаторів: числа/межі
// показує дзеркало model/configValidation.ts — серверний Validate для Settings узагалі
// warn-only, ZP_SettingsConfig.c:42-68, файл не відхиляється ніколи).

import type { Project, ProjectFile } from './project'

export type SettingsFileDoc = Record<string, unknown>

export type SettingsEditResult = { ok: true; project: Project } | { ok: false; error: string }

export function applySettingsEdit(project: Project, updater: (s: SettingsFileDoc) => void): SettingsEditResult {
  const file = project.files.find((f) => f.kind === 'settings')
  if (!file) return { ok: false, error: 'Settings.json не завантажено' }
  const doc = file.parsed as SettingsFileDoc | undefined
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, error: `файл налаштувань не розібрано: ${file.path}` }
  }

  const newDoc = structuredClone(doc)
  updater(newDoc)

  const newFile: ProjectFile = { ...file, parsed: newDoc, dirty: true }
  const newFiles = project.files.map((f) => (f === file ? newFile : f))
  return { ok: true, project: { ...project, files: newFiles } }
}
