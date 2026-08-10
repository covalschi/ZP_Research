// Видалення ФАЙЛУ проєкту (W4 Task 6, хвіст капстоуна №1) — чистий мутатор + гард
// «що саме зникне». Дисципліна та сама, що io/dataItemEdit.ts:1-14: без мутацій на
// відмові, ідентичність нечіпаних ProjectFile-обʼєктів, результат — НОВИЙ Project.
//
// ЗВІДКИ ЗАДАЧА: під час капстоуна «Великий перезбір» (CLAUDE.md, знахідка №1) правила
// вдалось видаляти поштучно, а самі файли ProcessingRules/*.json і TechTree/*.json
// довелось зносити НА ДИСКУ повз редактор — тобто «перестворити контент з нуля лише
// кліками» упиралось саме в це.
//
// МЕХАНІЗМ: мутатор лише прибирає файл зі списку і ставить його шлях у чергу
// project.deleted; до сховища видалення доїжджає в io/project.saveDirty (він же вирішує
// порядок «спершу видалення, потім записи» — див. коментар там). Для теки це
// FileSystemDirectoryHandle.removeEntry (файл справді зникає з $profile:ZP_Research\), для
// ZIP — викидання запису з карти бекенда, тож наступний експорт архіву його не містить.
//
// ЩО ВИДАЛЯТИ НЕ МОЖНА (і чому це не примха УІ, а властивість сервера):
//   * шість одиночних конфігів (Settings/PointTypes/Factions/DataItems/Modules/
//     SampleTypes) — їх пише САМ рушій: ZP_ConfigService на завантаженні профілю без
//     файлу викликає SetDefaults і створює його заново (живий доказ капстоуна: бут
//     сервера переписав SampleTypes.json байт-у-байт як експорт редактора). Видалення
//     такого файлу нічого не «вимикає» — воно лише замінює налаштування адміна дефолтами.
//     Правильний спосіб прибрати запис — зняти галочку «Увімкнено» у своїй вкладці.
//   * foreign — живий стан сервера (FactionData/PlayerData/ConfigBackup/StaticDevices*):
//     редактор їх навіть не читає (io/project.loadProject), тим паче не видаляє.

import type { Project, ProjectFile } from './project'
import { pendingDeletions } from './project'

// ---- Перелік вмісту для гарда ---------------------------------------------------------
// Словʼянська плюралізація — той самий приймач, що pluralizeRows/pluralizeInputs у ui/,
// але з трьома формами як параметрами (тут потрібні дві різні сутності: правила й вузли).
function pluralUa(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} ${one}`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} ${few}`
  return `${n} ${many}`
}

function countArray(parsed: unknown, key: string): number {
  if (!parsed || typeof parsed !== 'object') return 0
  const value = (parsed as Record<string, unknown>)[key]
  return Array.isArray(value) ? value.length : 0
}

function branchIdOf(parsed: unknown): string {
  if (!parsed || typeof parsed !== 'object') return ''
  const branch = (parsed as Record<string, unknown>).Branch
  if (!branch || typeof branch !== 'object') return ''
  const id = (branch as Record<string, unknown>).Id
  return typeof id === 'string' ? id : ''
}

// «4 правила» / «2 вузли (гілка «eco_bio»)» — рядок для підтвердження видалення: адмін
// мусить бачити, ЩО саме піде разом із файлом, ще до другого натискання. Порожній рядок —
// для видів, які однаково не видаляються (гард нижче пояснює причину замість переліку).
export function describeFileContents(file: ProjectFile): string {
  if (file.kind === 'rules') {
    const n = countArray(file.parsed, 'Rules')
    return n === 0 ? 'жодного правила' : pluralUa(n, 'правило', 'правила', 'правил')
  }
  if (file.kind === 'techTree') {
    const n = countArray(file.parsed, 'Nodes')
    const head = n === 0 ? 'жодного вузла' : pluralUa(n, 'вузол', 'вузли', 'вузлів')
    const branch = branchIdOf(file.parsed)
    return branch === '' ? head : `${head} (гілка «${branch}»)`
  }
  return ''
}

export interface FileDeleteGuard {
  deletable: boolean
  // Причина відмови — лише коли deletable=false (УІ показує її замість активної кнопки).
  reason?: string
  // Перелік вмісту (describeFileContents) — лише коли є що перелічувати.
  summary: string
}

const SINGLE_CONFIG_REASON =
  'сервер пише цей файл сам: без нього ZP_ConfigService створить його заново з дефолтами (SetDefaults) — видалення не вимкне записи, а лише зітре налаштування адміна. Щоб прибрати запис із обігу, зніміть у нього галочку «Увімкнено».'

const FOREIGN_REASON = 'чужий файл не редагується редактором — це живий стан сервера (FactionData/PlayerData/ConfigBackup/StaticDevices).'

export function fileDeleteGuard(file: ProjectFile): FileDeleteGuard {
  if (file.kind === 'foreign') return { deletable: false, reason: FOREIGN_REASON, summary: '' }
  if (file.kind !== 'rules' && file.kind !== 'techTree') {
    return { deletable: false, reason: SINGLE_CONFIG_REASON, summary: '' }
  }
  return { deletable: true, summary: describeFileContents(file) }
}

export type DeleteProjectFileResult = { ok: true; project: Project } | { ok: false; error: string }

// deleteProjectFile: прибирає файл зі списку проєкту і ставить його шлях у чергу видалень.
// Шлях порівнюється ДОСЛІВНО (як усі інші мутатори io/*: findRulesFile/findFile) — УІ
// завжди подає сюди path самого ProjectFile, а не набраний адміном рядок.
export function deleteProjectFile(project: Project, path: string): DeleteProjectFileResult {
  const file = project.files.find((f) => f.path === path)
  if (!file) return { ok: false, error: `файл не знайдено у проєкті: ${path}` }

  const guard = fileDeleteGuard(file)
  if (!guard.deletable) return { ok: false, error: `${path}: ${guard.reason}` }

  return {
    ok: true,
    project: {
      ...project,
      files: project.files.filter((f) => f !== file),
      deleted: [...pendingDeletions(project), file.path],
    },
  }
}
