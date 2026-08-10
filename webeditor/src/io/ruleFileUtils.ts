// Спільні дрібниці мутаторів "правило -> файл правил" (io/stationEdit.ts, io/
// cloneStation.ts) — ВИНЕСЕНО з обох модулів (W2.6-фінал, фінальне whole-branch ревʼю,
// IMPORTANT 2): findRulesFile/replaceFile/collectRuleIdsLower/uniqueId (+ спільний тип
// StationEditFail) існували як ДВІ окремі копії, і вони ВЖЕ РОЗІЙШЛИСЯ до дублювання цього
// таска — uniqueId у io/stationEdit.ts порівнював candidate з taken ДОСЛІВНО
// (case-sensitive), а в io/cloneStation.ts — кейс-інсенситивно (candidate.toLowerCase()).
//
// Чому розбіжність НЕ проявлялась досі: обидва call-сайти в stationEdit.ts
// (createStubRules/linkOutputToStation) завжди передають base, вже пропущений через
// sanitizeIdPart (яка беззастережно .ToLowerCase()), тож candidate там і так лишався
// нижнього регістру на кожній ітерації — старий дослівний `taken.has(candidate)`
// збігався з `taken` (він теж лишень нижнього регістру, з collectRuleIdsLower) просто
// тому, що обидві сторони порівняння вже нормалізовані незалежно один від одного, а не
// тому, що функція сама була безпечна для БУДЬ-ЯКОГО base. io/cloneStation.ts передає base
// НЕ нормалізованим (`${oldId}_копія`, де oldId — дослівний Id клонованого правила,
// довільного регістру, збережений заради читабельності клону) — САМЕ тому кейс-
// інсенситивний варіант там ВЖЕ БУВ потрібен і вже існував. Обрано ЙОГО як канонічний
// (безпечніший з двох варіантів для БУДЬ-ЯКОГО майбутнього виклику з не-санітизованим
// base — не "той, що написали першим"). Регресійний тест на мішаний регістр —
// tests/ruleFileUtils.test.ts.

import type { Project, ProjectFile } from './project'
import { compareLikeServer } from './project'
import type { ConfigKind } from '../model/schema'
import { stripExact } from '../model/classIndex'
import type { RulesFileDoc } from './ruleEdit'

export type StationEditFail = { ok: false; error: string }

// Частина генерованого Id з класнейму/вмісту/Branch.Id: стрип "|N" (пайп — позначка режиму
// порівняння, не частина імені), lower-case, усе поза [a-z0-9] → '_', стиснення повторів.
// ПЕРЕНЕСЕНО зі stationEdit.ts (W3 Task 3): io/nodeEdit.createTreeNode потребує ту саму
// санітизацію для Id вузлів — друга копія була б рівно тим дрейфом, який ця шапка описує.
export function sanitizeIdPart(s: string): string {
  return stripExact(s)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

// ---- Ім'я нового конфіг-файлу (W3 Task 3, винесено з createRulesFile) ----------------------
// Заборонені символи імені файлу Windows + роздільники шляху (редактор пише і напряму в
// теку профілю через FS Access API — ім'я мусить бути валідним для NTFS).
const BAD_NAME_CHARS = /[/\\<>:"|?*]/
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

// Керівні символи (коди < 0x20) перевіряються ЧИСЛОВИМ порівнянням charCodeAt, НЕ
// діапазоном-екранкою в регекспі: чотири NUL-інциденти W2.6 (і п'ятий — прямо в цьому
// файлі, спійманий стоячим байт-сканом) показали, що інструменти правки періодично кладуть
// сирий керівний байт замість текстової екранки; числова перевірка знімає саму можливість
// такої підміни.
function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) < 0x20) return true
  }
  return false
}

export type NormalizeFileNameResult = { ok: true; name: string } | StationEditFail

export function normalizeJsonFileName(fileName: string): NormalizeFileNameResult {
  let name = fileName.trim()
  if (name === '') return { ok: false, error: 'порожнє імʼя файлу' }
  if (BAD_NAME_CHARS.test(name) || hasControlChars(name)) return { ok: false, error: `імʼя файлу містить заборонені символи: ${name}` }
  if (!/\.json$/i.test(name)) name = `${name}.json`
  const base = name.replace(/\.json$/i, '')
  if (base === '' || /^\.+$/.test(base)) return { ok: false, error: `некоректне імʼя файлу: ${fileName}` }
  if (/^[.\s]|[.\s]$/.test(base)) return { ok: false, error: `імʼя файлу не може починатись/закінчуватись крапкою чи пробілом: ${fileName}` }
  if (RESERVED_NAMES.test(base)) return { ok: false, error: `зарезервоване імʼя Windows: ${fileName}` }
  return { ok: true, name }
}

// ---- Вставка нового файлу в СЕРВЕРНИЙ порядок своєї групи (W3 Task 3, винесено з
// createRulesFile) ---------------------------------------------------------------------------
// Порядок файлів усередині rules/techTree = пріоритет застосування правил / черговість
// гілок (compareLikeServer по basename, дзеркало ZP_ConfigService.c:670 SortFileNames):
// новий файл мусить з'явитись у списку там, де він реально опиниться після рестарту
// сервера. Вставка: перед ПЕРШИМ файлом групи, чий basename СТРОГО більший; інакше —
// після ОСТАННЬОГО файлу групи; якщо групи немає — у кінець.
export function insertFileInServerOrder(project: Project, newFile: ProjectFile, kind: ConfigKind): Project {
  const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1)
  const newBase = basename(newFile.path)
  let insertAt = -1
  let lastIdx = -1
  for (let i = 0; i < project.files.length; i++) {
    const f = project.files[i]
    if (f.kind !== kind) continue
    lastIdx = i
    if (insertAt === -1 && compareLikeServer(basename(f.path), newBase) > 0) insertAt = i
  }
  if (insertAt === -1) insertAt = lastIdx === -1 ? project.files.length : lastIdx + 1
  const files = [...project.files.slice(0, insertAt), newFile, ...project.files.slice(insertAt)]
  return { ...project, files }
}

export function findRulesFile(project: Project, filePath: string): { file: ProjectFile; doc: RulesFileDoc } | StationEditFail {
  const file = project.files.find((f) => f.path === filePath)
  if (!file) return { ok: false, error: `файл не знайдено: ${filePath}` }
  if (file.kind !== 'rules') return { ok: false, error: `не файл правил: ${filePath}` }
  const doc = file.parsed as RulesFileDoc | undefined
  if (!doc || !Array.isArray(doc.Rules)) return { ok: false, error: `файл правил не розібрано: ${filePath}` }
  return { file, doc }
}

export function replaceFile(project: Project, oldFile: ProjectFile, newDoc: RulesFileDoc): Project {
  const newFile: ProjectFile = { ...oldFile, parsed: newDoc, dirty: true }
  return { ...project, files: project.files.map((f) => (f === oldFile ? newFile : f)) }
}

// Усі Id правил проєкту, lower-case. Унікальність генерованих Id перевіряється
// КЕЙС-ІНСЕНСИТИВНО і ПО ВСЬОМУ проєкту: серверна жорстка відмова на дублі Id
// (AddFileRules:244-247) порівнює дослівно, але решта config-lookup'ів рушія
// кейс-інсенситивні — Id, що відрізняються лише регістром, були б міною під ноги.
export function collectRuleIdsLower(project: Project): Set<string> {
  const out = new Set<string>()
  for (const file of project.files) {
    if (file.kind !== 'rules') continue
    const doc = file.parsed as RulesFileDoc | undefined
    if (!doc || !Array.isArray(doc.Rules)) continue
    for (const r of doc.Rules) {
      if (r && typeof r === 'object' && typeof (r as Record<string, unknown>).Id === 'string') {
        out.add(((r as Record<string, unknown>).Id as string).toLowerCase())
      }
    }
  }
  return out
}

// base, base_2, base_3, ... — перший вільний ВІДНОСНО taken, порівняння КЕЙС-
// ІНСЕНСИТИВНЕ (candidate.toLowerCase()) — taken зберігає й отримує лише lower-case
// (дзеркало collectRuleIdsLower). Повертає candidate у ТОМУ РЕГІСТРІ, у якому його передав
// викликач (важливо для cloneStation.ts — клон зберігає читабельність оригінального Id;
// лоуеркейзиться лише саме порівняння/запис у taken, не повернене значення).
export function uniqueId(base: string, taken: Set<string>): string {
  let candidate = base
  let n = 1
  while (taken.has(candidate.toLowerCase())) {
    n++
    candidate = `${base}_${n}`
  }
  taken.add(candidate.toLowerCase())
  return candidate
}
