// Мутатори вікна станка (W2.6 Task 3) — та сама дзеркальна дисципліна, що applyRuleEdit
// (io/ruleEdit.ts): чисті функції без React; structuredClone ЛИШЕ документа-цілі; updater
// працює над копією; результат — НОВИЙ Project із НОВИМ files-масивом, де замінено РІВНО
// один об'єкт файлу (dirty=true); решта файлів зберігає ТІ САМІ посилання (React
// перемальовує лише те, що змінилось).
//
// На відміну від io/sampleTypeEdit.ts/dataItemEdit.ts (які навмисно не залежать від
// model/*), цей модуль ІМПОРТУЄ model/chainGraph.matchInputMirror і model/classIndex:
// «чи існує вже аналізатор під цей вихід» — це питання МАТЧИНГУ (дзеркало серверного
// ZP_ProcessingRules.MatchInput), і друга копія цієї логіки тут була б саме тим дрейфом
// двох копій, якого весь кодекс свідомо уникає (коментар над matchInputMirror у
// chainGraph.ts). Прецедент value-імпорту io -> model уже є: project.ts імпортує SCHEMAS
// з model/schema.
//
// ============================ СЕМАНТИКА ЗАГОТОВОК (Step 1) ============================
//
// Відкрите питання плану W2.6 (доля незаповнених заготовок при збереженні) вирішено
// читанням джерела, і відповідь виявилась ТРЕТЬОЮ, не однією з двох очікуваних:
//
//   ZP_Research/scripts/3_Game/ZP_Research/ZP_ProcessingConfig.c, AddFileRules:
//     :249-254 — невалідне правило пропускається ПЕР-ПРАВИЛОВО з ZP_Log.Warn
//                («правило '<Id>' пропущено: <причина>»), ФАЙЛ ЖИВЕ (continue, не false);
//     :295-296 — порожній InputItem.Classname → саме такий skip («немає InputItem.Classname»);
//     :244-247 — дубль Id → hardErr, reload відхиляється ЦІЛКОМ (єдина жорстка відмова).
//   АЛЕ: ПОРОЖНІ Outputs НЕ ВІДХИЛЯЮТЬСЯ НІДЕ — ValidateRule (:262-350) не має перевірки
//   Outputs.Count(); цикл перевірки виходів (:324-340) на порожньому масиві просто не
//   виконується, і правило ПРИЙМАЄТЬСЯ ЯК ВАЛІДНЕ.
//
//   ZP_Research/scripts/4_World/ZP_Research/ZP_Processing.c, FindStartableCore (:121-177):
//   гейта на кількість виходів теж НЕМАЄ — увімкнене правило з заповненим входом і
//   порожніми Outputs СТАРТУВАЛО Б: станція з'їдає сировину при старті циклу
//   (lose_input, M5b) і наприкінці не видає НІЧОГО.
//
// Отже «зберегти як є» БЕЗ додаткових заходів небезпечне: заготовка масового додавання —
// це якраз «вхід заповнено, виходів немає». Політика: заготовки ЗБЕРІГАЮТЬСЯ ЯК Є, але з
// Enabled=false — власний штатний механізм рушія для інертних правил:
//   ZP_ProcessingConfig.c:48 — «вимкнено = валідується й живе в агрегаті, але не
//   матчиться і не надсилається клієнтам»;
//   ZP_Processing.c:127-128 — `if (!r.Enabled) continue;` — ПЕРША перевірка
//   FindStartableCore, раніше за Mode/Device/усе інше.
// Збереження НЕ блокується, файл валідний, сервер заготовку ігнорує, редактор показує її
// червоним (stationView: «вихід не задано» + прапор disabled). Увімкнення після
// налаштування — ЯВНА дія адміна у формі (чекбокс «Увімкнено»), не тиха підміна.

import type { Project, ProjectFile } from './project'
import { classifyPath } from './project'
import type { RulesFileDoc } from './ruleEdit'
import { matchInputMirror } from '../model/chainGraph'
import type { ClassIndex } from '../model/classIndex'
import { stripExact } from '../model/classIndex'
import {
  findRulesFile,
  replaceFile,
  collectRuleIdsLower,
  uniqueId,
  sanitizeIdPart,
  normalizeJsonFileName,
  insertFileInServerOrder,
} from './ruleFileUtils'
import type { StationEditFail } from './ruleFileUtils'

export type { StationEditFail }

// ---- Спільні дрібниці — ВИНЕСЕНО в io/ruleFileUtils.ts (W2.6-фінал, фінальне ревʼю,
// IMPORTANT 2): findRulesFile/replaceFile/collectRuleIdsLower/uniqueId звідси й з
// io/cloneStation.ts були ДВОМА копіями, що вже розійшлись (uniqueId тут порівнював
// case-sensitive) — деталі й обраний (кейс-інсенситивний) варіант у шапці ruleFileUtils.ts.
// W3 Task 3 продовжив винесення: sanitizeIdPart + normalizeJsonFileName +
// insertFileInServerOrder тепер теж там (io/nodeEdit.ts потребує ті самі перевірки для
// вузлів/гілок дерева — друга копія була б рівно тим дрейфом, який ця шапка описує).

// Повна канонічна форма ZP_Rule (порядок і дефолти = RULE_SCHEMA/schema.ts, звірено з
// ZP_ProcessingConfig.c:45-78). ВСІ поля пишуться явно — «відсутній ключ ≠ дефолт
// ініціалізатора» (живий баг «чистота 0», CLAUDE.md/W1): завантажувач рушія лишає нуль
// свого типу, тож заготовка без явних BasePurity* приїхала б мертвою.
function stubRule(id: string, device: string, inputClassname: string, inputContent: string): Record<string, unknown> {
  return {
    Id: id,
    Enabled: false, // Step 1: інертність заготовки — штатний механізм рушія (див. шапку файлу)
    Device: device,
    Mode: 'background',
    InputItem: { Classname: inputClassname, Quantity: 1, ConsumeInput: true, Content: inputContent },
    BasePurityMin: 0.5,
    BasePurityMax: 0.5,
    TimeSec: 10,
    Consumables: [],
    Outputs: [],
    RequiredNode: '',
    RequiredFactions: [],
    RequiredWorn: [],
    RequiredTools: [],
    Notes: '',
  }
}

// ---- createRulesFile ------------------------------------------------------------------------

export type CreateRulesFileResult = { ok: true; project: Project; path: string } | StationEditFail

// createRulesFile: ЦІЛИЙ новий ProjectFile у ProcessingRules/ — дзеркало прецеденту
// createSampleTypesFile (io/sampleTypeEdit.ts): канонічний порожній документ
// {ConfigVersion:1, Rules:[]} (та сама форма, яку пише сам рушій при SetDefaults на
// чистому профілі — мінус демо-правило, яке рушій додає лише у СВІЙ автостворений файл),
// originalBytes порожні (файл фізично ще не існує — «чесний» конвент project.ts для
// файлів поза loadProject), dirty одразу.
//
// Валідація імені та позиція вставки — спільні normalizeJsonFileName/insertFileInServerOrder
// (io/ruleFileUtils.ts, W3 Task 3): ті самі правила діють і для гілок дерева
// (createTreeBranchFile, io/nodeEdit.ts), окремих копій більше немає.
export function createRulesFile(project: Project, fileName: string): CreateRulesFileResult {
  const norm = normalizeJsonFileName(fileName)
  if (!norm.ok) return norm
  const name = norm.name

  const path = `ProcessingRules/${name}`
  if (classifyPath(path) !== 'rules') return { ok: false, error: `шлях не класифікується як файл правил: ${path}` }
  const lower = path.toLowerCase()
  if (project.files.some((f) => f.path.toLowerCase() === lower)) {
    return { ok: false, error: `файл '${path}' вже є в проєкті` }
  }

  const newFile: ProjectFile = {
    path,
    kind: 'rules',
    originalBytes: new Uint8Array(0),
    parsed: { ConfigVersion: 1, Rules: [] } satisfies RulesFileDoc,
    warnings: [],
    dirty: true,
  }

  return { ok: true, project: insertFileInServerOrder(project, newFile, 'rules'), path }
}

// ---- createStubRules ------------------------------------------------------------------------

export type CreateStubRulesResult = { ok: true; project: Project; createdIds: string[] } | StationEditFail

// createStubRules: по одній ВИМКНЕНІЙ заготовці на кожен класнейм сировини (масове
// додавання у вікні станка). Id = <станок>_<сировина> lower-case + суфікс унікальності
// (_2, _3, ...) — унікальність кейс-інсенситивна по ВСЬОМУ проєкту і всередині партії.
// Дублікати сировини всередині партії (кейс-інсенситивно) схлопуються — два кліки по
// тому самому класу не мають плодити два рядки.
export function createStubRules(
  project: Project,
  stationClassname: string,
  rawClassnames: string[],
  targetFilePath: string,
): CreateStubRulesResult {
  const station = stationClassname.trim()
  if (station === '') return { ok: false, error: 'не задано класнейм станка' }

  const raws: string[] = []
  const seenRaw = new Set<string>()
  for (const raw of rawClassnames) {
    const cls = raw.trim()
    if (cls === '') continue
    const key = cls.toLowerCase()
    if (seenRaw.has(key)) continue
    seenRaw.add(key)
    raws.push(cls)
  }
  if (raws.length === 0) return { ok: false, error: 'не задано жодного класнейму сировини' }

  const found = findRulesFile(project, targetFilePath)
  if ('ok' in found) return found

  const taken = collectRuleIdsLower(project)
  const stationPart = sanitizeIdPart(station)
  const newDoc = structuredClone(found.doc)
  const createdIds: string[] = []
  for (const raw of raws) {
    const id = uniqueId(`${stationPart}_${sanitizeIdPart(raw)}`, taken)
    createdIds.push(id)
    newDoc.Rules.push(stubRule(id, station, raw, ''))
  }
  return { ok: true, project: replaceFile(project, found.file, newDoc), createdIds }
}

// ---- deleteRule -----------------------------------------------------------------------------

export type DeleteRuleResult = { ok: true; project: Project } | StationEditFail

// deleteRule: видалення рядка станка = видалення правила. Дубль Id у файлі — явна
// відмова (та сама причина, що applyRuleEdit: мовчки видалити «першого-ліпшого» близнюка
// означало б видалити не те, що адмін бачив перед собою).
export function deleteRule(project: Project, filePath: string, ruleId: string): DeleteRuleResult {
  const found = findRulesFile(project, filePath)
  if ('ok' in found) return found

  const matchIdx: number[] = []
  found.doc.Rules.forEach((r, i) => {
    if (r && typeof r === 'object' && (r as Record<string, unknown>).Id === ruleId) matchIdx.push(i)
  })
  if (matchIdx.length === 0) return { ok: false, error: `правило '${ruleId}' не знайдено у ${filePath}` }
  if (matchIdx.length > 1) return { ok: false, error: 'дубль Id у файлі — виправте вручну' }

  const newDoc = structuredClone(found.doc)
  newDoc.Rules.splice(matchIdx[0], 1)
  return { ok: true, project: replaceFile(project, found.file, newDoc), }
}

// ---- linkOutputToStation --------------------------------------------------------------------

export type LinkOutputResult =
  | { ok: true; project: Project; ruleId: string; filePath: string; created: boolean }
  | StationEditFail

// linkOutputToStation: «Куди піде результат» — створює (або знаходить наявне) правило-
// аналізатор на станку-призначенні, що споживає ЦЕЙ вихід: InputItem = клас + вміст
// виходу, решта — заготовка (Enabled=false, Step 1-семантика та сама, що createStubRules).
//
// «Відповідність» наявного аналізатора — РІВНО matchInputMirror (chainGraph.ts, дзеркало
// ZP_ProcessingRules.MatchInput): клас через IsKindOf (аналізатор під базовий клас родини
// ловить і конкретний вихід), вміст кейс-інсенситивно, порожня вимога вмісту = «будь-який».
// Належність станку — ДОСЛІВНА рівність stripExact(Device) без IsKindOf: ідентичність
// станка в редакторі — літеральний класнейм Device (T1, stationView п.1), а не
// спадкування; правило з Device='ZP_Device_Base' — окремий «станок» очима адміна.
// Enabled наявного НЕ перевіряється навмисно: вимкнена заготовка-аналізатор, створена
// хвилину тому, — це вже призначення; плодити її близнюка не можна.
//
// Id нового аналізатора — з ВМІСТУ виходу (а не класу), коли вміст є: клас зразка
// спільний для всіх потоків (ZP_Sample_*), розрізнює їх саме Content — Id
// zp_microscope_chimera_claw читається, zp_microscope_zp_sample колізив би на другому
// потоці того самого класу.
export function linkOutputToStation(
  project: Project,
  index: ClassIndex,
  fromFilePath: string,
  fromRuleId: string,
  outputIndex: number,
  stationClassname: string,
  targetFilePath: string,
): LinkOutputResult {
  const station = stationClassname.trim()
  if (station === '') return { ok: false, error: 'не задано станок-призначення' }

  const src = findRulesFile(project, fromFilePath)
  if ('ok' in src) return src
  const matches = src.doc.Rules.filter((r) => r && typeof r === 'object' && (r as Record<string, unknown>).Id === fromRuleId)
  if (matches.length === 0) return { ok: false, error: `правило '${fromRuleId}' не знайдено у ${fromFilePath}` }
  if (matches.length > 1) return { ok: false, error: 'дубль Id у файлі — виправте вручну' }

  const outputs = (matches[0] as Record<string, unknown>).Outputs
  if (!Array.isArray(outputs) || outputIndex < 0 || outputIndex >= outputs.length) {
    return { ok: false, error: `вихід №${outputIndex + 1} не існує у правилі '${fromRuleId}'` }
  }
  const output = outputs[outputIndex] as Record<string, unknown>
  const outCls = typeof output?.Classname === 'string' ? output.Classname.trim() : ''
  const outContent = typeof output?.Content === 'string' ? output.Content : ''
  if (outCls === '') return { ok: false, error: 'вихід порожній — спершу задайте клас виходу' }

  // Пошук наявного відповідного аналізатора — у порядку файлів проєкту (той самий
  // пріоритет, яким сервер перебирає правила).
  const stationLower = stripExact(station).trim().toLowerCase()
  for (const file of project.files) {
    if (file.kind !== 'rules') continue
    const doc = file.parsed as RulesFileDoc | undefined
    if (!doc || !Array.isArray(doc.Rules)) continue
    for (const raw of doc.Rules) {
      if (!raw || typeof raw !== 'object') continue
      const r = raw as Record<string, unknown>
      if (typeof r.Id !== 'string' || r.Id === '') continue // без Id — невидиме для сервера (AddFileRules:216-220)
      if (typeof r.Device !== 'string') continue
      if (stripExact(r.Device).trim().toLowerCase() !== stationLower) continue
      const input = r.InputItem as Record<string, unknown> | undefined
      const inCls = input && typeof input.Classname === 'string' ? input.Classname : ''
      const inContent = input && typeof input.Content === 'string' ? input.Content : ''
      if (inCls === '') continue
      if (matchInputMirror(outCls, outContent, inCls, inContent, index)) {
        return { ok: true, project, ruleId: r.Id, filePath: file.path, created: false }
      }
    }
  }

  // Наявного немає — створюємо заготовку-аналізатор у цільовому файлі.
  const target = findRulesFile(project, targetFilePath)
  if ('ok' in target) return target
  const taken = collectRuleIdsLower(project)
  const streamPart = sanitizeIdPart(outContent !== '' ? outContent : outCls)
  const id = uniqueId(`${sanitizeIdPart(station)}_${streamPart}`, taken)
  const newDoc = structuredClone(target.doc)
  newDoc.Rules.push(stubRule(id, station, outCls, outContent))
  return { ok: true, project: replaceFile(project, target.file, newDoc), ruleId: id, filePath: targetFilePath, created: true }
}
