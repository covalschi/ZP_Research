// «Клонування з заміною» (W2.6 Task 5) — ОДИН чистий мутатор cloneRulesWithSubstitution:
// копіює УСІ правила заданого станка, прогонячи кожне через таблицю замін «що -> на що»
// (класнейм або фракція), і кладе результат ВИМКНЕНИМИ (Enabled=false) у файл-ціль. Дисципліна
// та сама, що io/stationEdit.ts (звідки й запозичені collectRuleIdsLower/uniqueId/findRulesFile/
// replaceFile — тепер СПІЛЬНИЙ модуль io/ruleFileUtils.ts, ВИНЕСЕНО W2.6-фінал, фінальне
// ревʼю IMPORTANT 2: друга копія тут уже РОЗІЙШЛАСЯ з першою — uniqueId, деталі в шапці
// ruleFileUtils.ts): structuredClone лише документа-цілі, недирти файли зберігають
// ідентичність посилань, явна відмова замість вгадування, дубль-гейт Id ПЕРЕД будь-яким
// записом.
//
// ============================ СЕМАНТИКА ЗАМІН ============================
//
// Таблиця замін — рядки ДВОХ типів (Substitution.kind), КОЖЕН зі своїм простором полів:
//
//   kind='class' — застосовується до ВСІХ класнеймових посилань правила: Device,
//     InputItem.Classname, Consumables[].Classname, Outputs[].Classname, RequiredWorn[],
//     RequiredTools[]. Порівняння — ЧЕРЕЗ stripExact (дзеркало matchClassMirror/isKindOf,
//     model/classIndex.ts): пайп-суфікс "|N" ("точний клас", не IsKindOf) відрізається
//     ПЕРЕД порівнянням і ПРИЛІПЛЮЄТЬСЯ НАЗАД до заміненого значення — заміна торкається
//     лише БАЗИ, а не позначки режиму порівняння.
//
//   kind='faction' — застосовується ЛИШЕ до RequiredFactions[]. Порівняння — ТОЧНА
//     рівність (кейс-інсенситивно), БЕЗ пайп-форми: сервер порівнює цей масив через
//     `array<string>.Find(factionClass)` (ZP_Factions.c:76/102, ZP_Processing.c:144,
//     ZP_ClientState.c:156/190) — простий Id фракції, не MatchClass/IsKindOf. Клас-рядок
//     з тим самим текстом НІКОЛИ не чіпає RequiredFactions, і навпаки — два простори замін
//     не перетинаються навмисно (тест cloneStation.test.ts це закріплює).
//
// Перший рядок таблиці, чий `from` (для class — stripExact-база, для faction — точний
// рядок) збігається кейс-інсенситивно, ПЕРЕМАГАЄ (порядок таблиці, `.find()`) — рядки з
// порожнім `from` АБО порожнім `to` ІГНОРУЮТЬСЯ ЦІЛКОМ (недобудований рядок таблиці не
// повинен ані матчитись, ані стирати значення на порожній рядок).
//
// Content (InputItem.Content/Consumables[].Content/Outputs[].Content) — ДВА окремі шляхи,
// обидва звірені з живим прецедентом ui/RulePanel.tsx (applyInputClassnameChange) і
// model/sampleContent.ts:
//   - АВТО (isAutoContent відносно СТАРОГО, ДО заміни, InputItem.Classname) І клас виходу
//     (ПІСЛЯ заміни) — родини ZP_Sample_Base: перераховується deriveOutputContent(...) на
//     НОВИЙ (ПІСЛЯ заміни) InputItem.Classname — той самий каскад, що форма застосовує
//     живцем при ручній правці InputItem.Classname. InputItem.Content і Consumables[].Content
//     авто-концепції НЕ мають (лише Outputs[] несе isAutoContent, sampleContent.ts) — тому
//     для них цей шлях НІКОЛИ не спрацьовує.
//   - РУЧНИЙ (усе інше, включно з InputItem.Content/Consumables[].Content завжди) —
//     табличний збіг: якщо ПОТОЧНЕ значення (ДО заміни) дослівно (кейс-інсенситивно)
//     збігається з `from` якогось class-рядка — замінюється на `to`; інакше лишається як є.
//
// RequiredNode НІКОЛИ не чіпається — Id вузла дерева, не класнейм (директива брифа Task 5:
// "tree ids are not classnames"). Enabled клону — ЗАВЖДИ false (Step 1-семантика заготовок,
// io/stationEdit.ts createStubRules: клон потребує перегляду адміном перед увімкненням,
// власний штатний механізм рушія ZP_Processing.c:127-128 гарантує інертність).

import type { Project } from './project'
import { classifyPath } from './project'
import type { RulesFileDoc } from './ruleEdit'
import type { ClassIndex } from '../model/classIndex'
import { stripExact } from '../model/classIndex'
import { isAutoContent, isSampleClass, deriveOutputContent } from '../model/sampleContent'
import { findRulesFile, replaceFile, collectRuleIdsLower, uniqueId } from './ruleFileUtils'
import type { StationEditFail } from './ruleFileUtils'

export type { StationEditFail }

export type SubstitutionKind = 'class' | 'faction'

export interface Substitution {
  kind: SubstitutionKind
  from: string
  to: string
}

export interface ClonedRulePreview {
  sourceFilePath: string
  sourceRuleId: string
  newId: string
  // Українською "шлях поля" (Device, InputItem.Classname, Outputs[0].Content, ...) —
  // РІВНО ті поля, яких ФАКТИЧНО торкнулась ЦЯ заміна (не список полів схеми взагалі).
  // Enabled НЕ входить сюди навмисно — це уніфікована політика клону, а не наслідок
  // таблиці замін (діалог показує це окремим статичним підказом, не по рядку).
  touchedFields: string[]
}

export type CloneStationResult =
  | { ok: true; project: Project; filePath: string; created: ClonedRulePreview[] }
  | StationEditFail

// ---- Спільні дрібниці — ВИНЕСЕНО в io/ruleFileUtils.ts (findRulesFile/replaceFile/
// collectRuleIdsLower/uniqueId, імпортовані вище) -----------------------------------------

// ---- Заміна одного класнеймового значення: пайп-форма зберігається, база підміняється -------
function substituteClass(value: string, rows: Substitution[]): { value: string; touched: boolean } {
  const pipeAt = value.indexOf('|')
  const base = pipeAt > -1 ? value.slice(0, pipeAt) : value
  const suffix = pipeAt > -1 ? value.slice(pipeAt) : ''
  const baseTrimmed = base.trim()
  if (baseTrimmed === '') return { value, touched: false }
  const hit = rows.find((s) => s.from.toLowerCase() === baseTrimmed.toLowerCase())
  if (!hit) return { value, touched: false }
  return { value: `${hit.to.trim()}${suffix}`, touched: true }
}

// ---- Заміна одного вмісту (Content) або запису RequiredFactions: точний збіг, без пайпа -----
function substituteExact(value: string, rows: Substitution[]): { value: string; touched: boolean } {
  const trimmed = value.trim()
  if (trimmed === '') return { value, touched: false }
  const hit = rows.find((s) => s.from.toLowerCase() === trimmed.toLowerCase())
  if (!hit) return { value, touched: false }
  return { value: hit.to.trim(), touched: true }
}

// ---- cloneRulesWithSubstitution --------------------------------------------------------------

export function cloneRulesWithSubstitution(
  project: Project,
  index: ClassIndex,
  stationClassname: string,
  substitutions: Substitution[],
  targetFilePath: string,
  idOverrides?: (string | undefined)[],
): CloneStationResult {
  const station = stripExact(stationClassname).trim()
  if (station === '') return { ok: false, error: 'не задано класнейм станка' }
  const stationLower = station.toLowerCase()

  // Рядки з порожнім from АБО to — недобудовані рядки таблиці (адмін ще вибирає) —
  // ІГНОРУЮТЬСЯ ЦІЛКОМ, щоб не матчити «нічого» і не стирати значення в порожній рядок.
  const classRows = substitutions.filter((s) => s.kind === 'class' && s.from.trim() !== '' && s.to.trim() !== '')
  const factionRows = substitutions.filter((s) => s.kind === 'faction' && s.from.trim() !== '' && s.to.trim() !== '')

  // ---- Джерела: сканування project.files (ОРИГІНАЛ, до будь-якої мутації) в порядку файлів
  // проєкту, потім Rules у порядку файлу — той самий порядок, що graph.nodes/station.inputRows
  // (model/stationView.ts) уже встановили для адміна. Правило без Id — «невидиме для сервера»
  // (AddFileRules) і НЕ клонується (той самий гейт, що buildChainGraph/buildStationView).
  const sources: { filePath: string; raw: Record<string, unknown> }[] = []
  for (const file of project.files) {
    if (file.kind !== 'rules') continue
    const doc = file.parsed as RulesFileDoc | undefined
    if (!doc || !Array.isArray(doc.Rules)) continue
    for (const raw of doc.Rules) {
      if (!raw || typeof raw !== 'object') continue
      const r = raw as Record<string, unknown>
      if (typeof r.Id !== 'string' || r.Id === '') continue
      if (typeof r.Device !== 'string') continue
      if (stripExact(r.Device).trim().toLowerCase() !== stationLower) continue
      sources.push({ filePath: file.path, raw: r })
    }
  }
  if (sources.length === 0) return { ok: false, error: `станок '${station}' не має жодного правила для клонування` }

  const target = findRulesFile(project, targetFilePath)
  if ('ok' in target) return target
  if (classifyPath(targetFilePath) !== 'rules') return { ok: false, error: `шлях не класифікується як файл правил: ${targetFilePath}` }

  const takenLower = collectRuleIdsLower(project)
  const created: ClonedRulePreview[] = []
  const newRules: Record<string, unknown>[] = []
  const idErrors: string[] = []

  sources.forEach((src, i) => {
    const clone = structuredClone(src.raw)
    const touched: string[] = []

    // Device
    {
      const device = typeof clone.Device === 'string' ? clone.Device : ''
      const r = substituteClass(device, classRows)
      if (r.touched) {
        clone.Device = r.value
        touched.push('Device')
      }
    }

    // InputItem.Classname/Content
    const inputItem = (clone.InputItem && typeof clone.InputItem === 'object' ? clone.InputItem : {}) as Record<string, unknown>
    clone.InputItem = inputItem
    const prevInputClassname = typeof inputItem.Classname === 'string' ? inputItem.Classname : ''
    {
      const r = substituteClass(prevInputClassname, classRows)
      if (r.touched) {
        inputItem.Classname = r.value
        touched.push('InputItem.Classname')
      }
    }
    const newInputClassname = typeof inputItem.Classname === 'string' ? inputItem.Classname : ''
    {
      const content = typeof inputItem.Content === 'string' ? inputItem.Content : ''
      const r = substituteExact(content, classRows)
      if (r.touched) {
        inputItem.Content = r.value
        touched.push('InputItem.Content')
      }
    }

    // Consumables[]
    const consumables = Array.isArray(clone.Consumables) ? (clone.Consumables as Record<string, unknown>[]) : []
    consumables.forEach((c, ci) => {
      if (!c || typeof c !== 'object') return
      const cls = typeof c.Classname === 'string' ? c.Classname : ''
      const rc = substituteClass(cls, classRows)
      if (rc.touched) {
        c.Classname = rc.value
        touched.push(`Consumables[${ci}].Classname`)
      }
      const content = typeof c.Content === 'string' ? c.Content : ''
      const rcon = substituteExact(content, classRows)
      if (rcon.touched) {
        c.Content = rcon.value
        touched.push(`Consumables[${ci}].Content`)
      }
    })

    // Outputs[] — Content: авто-каскад (родина ZP_Sample_Base, стосовно СТАРОГО InputItem.
    // Classname) АБО табличний збіг (ручне значення) — див. велику примітку вгорі файлу.
    const outputs = Array.isArray(clone.Outputs) ? (clone.Outputs as Record<string, unknown>[]) : []
    outputs.forEach((o, oi) => {
      if (!o || typeof o !== 'object') return
      const origContent = typeof o.Content === 'string' ? o.Content : ''
      const cls = typeof o.Classname === 'string' ? o.Classname : ''
      const ro = substituteClass(cls, classRows)
      if (ro.touched) {
        o.Classname = ro.value
        touched.push(`Outputs[${oi}].Classname`)
      }
      const newOutputClassname = typeof o.Classname === 'string' ? o.Classname : ''
      const wasAuto = isAutoContent(origContent, prevInputClassname)
      if (wasAuto && isSampleClass(index, newOutputClassname)) {
        const derived = deriveOutputContent(origContent, prevInputClassname, newInputClassname)
        if (derived !== origContent) {
          o.Content = derived
          touched.push(`Outputs[${oi}].Content`)
        }
      } else {
        const rcon = substituteExact(origContent, classRows)
        if (rcon.touched) {
          o.Content = rcon.value
          touched.push(`Outputs[${oi}].Content`)
        }
      }
    })

    // RequiredWorn[] / RequiredTools[] — клас-рядки, пайп-форма зберігається.
    const worn = Array.isArray(clone.RequiredWorn) ? (clone.RequiredWorn as string[]) : []
    worn.forEach((v, wi) => {
      if (typeof v !== 'string') return
      const r = substituteClass(v, classRows)
      if (r.touched) {
        worn[wi] = r.value
        touched.push(`RequiredWorn[${wi}]`)
      }
    })
    const tools = Array.isArray(clone.RequiredTools) ? (clone.RequiredTools as string[]) : []
    tools.forEach((v, ti) => {
      if (typeof v !== 'string') return
      const r = substituteClass(v, classRows)
      if (r.touched) {
        tools[ti] = r.value
        touched.push(`RequiredTools[${ti}]`)
      }
    })

    // RequiredFactions[] — ЛИШЕ faction-рядки, точний збіг без пайпа.
    const factions = Array.isArray(clone.RequiredFactions) ? (clone.RequiredFactions as string[]) : []
    factions.forEach((v, fi) => {
      if (typeof v !== 'string') return
      const r = substituteExact(v, factionRows)
      if (r.touched) {
        factions[fi] = r.value
        touched.push(`RequiredFactions[${fi}]`)
      }
    })

    // RequiredNode — НЕ чіпається (Id вузла дерева, не класнейм); structuredClone уже
    // переніс його дослівно, жодного коду тут не потрібно.

    // Enabled клону — ЗАВЖДИ false (Step 1-семантика заготовок, io/stationEdit.ts).
    clone.Enabled = false

    // ---- Id ----------------------------------------------------------------------------
    const oldId = typeof src.raw.Id === 'string' ? src.raw.Id : ''
    const overrideRaw = idOverrides?.[i]
    let newId: string
    if (overrideRaw !== undefined && overrideRaw.trim() !== '') {
      const desired = overrideRaw.trim()
      if (takenLower.has(desired.toLowerCase())) {
        idErrors.push(`'${desired}' (для правила '${oldId}')`)
        newId = desired // тримаємо для повноти прев'ю; на ok:false все одно не піде в запис
      } else {
        takenLower.add(desired.toLowerCase())
        newId = desired
      }
    } else {
      newId = uniqueId(`${oldId}_копія`, takenLower)
    }
    clone.Id = newId

    created.push({ sourceFilePath: src.filePath, sourceRuleId: oldId, newId, touchedFields: touched })
    newRules.push(clone)
  })

  if (idErrors.length > 0) {
    return { ok: false, error: `дублікат Id, виправте перед застосуванням: ${idErrors.join('; ')}` }
  }

  const newDoc = structuredClone(target.doc)
  newDoc.Rules.push(...newRules)
  return { ok: true, project: replaceFile(project, target.file, newDoc), filePath: targetFilePath, created }
}
