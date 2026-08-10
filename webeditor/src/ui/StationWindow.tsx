// Вікно станка (W2.6 Task 3) — ГОЛОВНА робоча поверхня адміна за затвердженим прев'ю
// 2026-08-07: список рядків сировини станка (ігрове ім'я + класнейм + статус-лампа +
// сводка «→ що дає · куди йде»), ненастроєні ЧЕРВОНИМ, масове додавання сировини
// (правила-заготовки), розворот рядка у ПОВНУ форму правила (вбудована RuleForm — та
// сама машинерія полів/валідації/авто-Content, що жила в бічній панелі), «Куди піде
// результат» (створення/знаходження аналізатора через linkOutputToStation) і видалення
// рядка з підтвердженням другим натисканням.
//
// Дані — БЕЗ власної моделі: buildStationView (model/stationView.ts, T1) — те саме
// джерело, що живить полотно (ChainView/buildStationCanvas); повторний виклик тут дешевий
// (правил — десятки, аргумент T1). Список станків для перемикача в шапці — ПОВНИЙ
// view.stations, ВКЛЮЧНО зі станками без жодного правила (оголошеними лише через
// Factions.json.DeviceClasses): полотно їх не малює за задумом (ідентичність вузла =
// станок+правило, T2), а вікно ЗОБОВ'ЯЗАНЕ листити (диспатч T3) — саме тут адмін дає
// такому станку перше правило масовим додаванням.
//
// Мутації — ТІЛЬКИ через чисті мутатори io/stationEdit.ts (createRulesFile/
// createStubRules/deleteRule/linkOutputToStation) і applyRuleEdit усередині RuleForm:
// кожен успіх стає НОВИМ Project через onProjectChange -> полотно перемальовується живцем
// на своєму useMemo([project, index]) без жодного окремого механізму.
//
// Викликач (App.tsx) монтує вікно з key={stationClassname}: перемикання станка скидає
// ВЕСЬ внутрішній стан (розгорнутий рядок, чіпи, взведене видалення) — урок T9 про
// витік стану між сутностями застосований наперед, а не знайдений рев'ю.

import { useEffect, useMemo, useState } from 'react'
import type { Project } from '../io/project'
import { createRulesFile, createStubRules, deleteRule, linkOutputToStation } from '../io/stationEdit'
import type { ClassIndex } from '../model/classIndex'
import { displayNameOf, searchClasses, stripExact } from '../model/classIndex'
import { buildStationView } from '../model/stationView'
import type { StationDestination, StationInfo, StationInputRow, StationViewResult } from '../model/stationView'
import { asRuleLike, matchInputMirror } from '../model/chainGraph'
import { RuleForm } from './RulePanel'
import { CloneStationDialog } from './CloneStationDialog'
import { ZpSelect } from './ZpSelect'
import type { ZpOption } from './ZpSelect'

// ---- Чисті хелпери (експортовані, tests/stationWindow.test.ts) -----------------------------

// Rules-файли проєкту В ПОРЯДКУ project.files — порядок = пріоритет застосування правил
// (дзеркало SortFileNames, io/project.ts) — для пікера «файл для нових правил».
export function collectRulesFileOptions(project: Project): ZpOption[] {
  return project.files.filter((f) => f.kind === 'rules').map((f) => ({ id: f.path, label: f.path }))
}

// «Заплановані» призначення рядка: станки, чиї правила-споживачі матчать вихід рядка
// (РІВНО matchInputMirror — єдине джерело порівняння), але яких НЕМАЄ в row.destinations
// (T1 рахує туди лише УВІМКНЕНИХ споживачів увімкненого джерела — дзеркало серверного
// матчингу). Дві законні причини «матчить, але не в destinations»:
//   1) споживач вимкнений — типово щойно створена linkOutputToStation заготовка-аналізатор;
//   2) саме ДЖЕРЕЛО вимкнене (заготовка масового додавання) — T1 тоді лишає destinations
//      порожнім узагалі, і сюди потрапляють УСІ споживачі (і увімкнені теж): адміну треба
//      бачити, куди піде результат ПІСЛЯ ввімкнення рядка.
// Дедуп кейс-інсенситивний, і проти row.destinations теж — станок не показується двічі.
export function collectPlannedDestinations(project: Project, index: ClassIndex, row: StationInputRow): StationDestination[] {
  const seen = new Set(row.destinations.map((d) => d.stationClassname.toLowerCase()))
  const out: StationDestination[] = []
  for (const file of project.files) {
    if (file.kind !== 'rules') continue
    const doc = file.parsed as { Rules?: unknown[] } | undefined
    for (const raw of doc?.Rules ?? []) {
      const r = asRuleLike(raw)
      if (!r || r.Id === '') continue
      if (r.Enabled && !row.disabled) continue // увімкнений споживач увімкненого джерела вже в row.destinations
      const stationCls = stripExact(r.Device).trim()
      if (stationCls === '') continue
      const lower = stationCls.toLowerCase()
      if (seen.has(lower)) continue
      for (const o of row.outputs) {
        if (o.classname.trim() === '') continue
        if (matchInputMirror(o.classname, o.content, r.InputItem.Classname, r.InputItem.Content, index)) {
          seen.add(lower)
          out.push({ stationClassname: stationCls, display: displayNameOf(index, stationCls) })
          break
        }
      }
    }
  }
  return out
}

// Типовий цільовий файл для НОВИХ правил станка: файл ПЕРШОГО рядка станка (нові правила
// лягають поруч зі старими того ж станка), інакше — перший rules-файл проєкту (порядок =
// пріоритет), інакше undefined (файлів правил немає — адмін мусить створити).
export function defaultTargetFileFor(view: StationViewResult, project: Project, stationClassname: string): string | undefined {
  const station = view.byClassname.get(stationClassname.toLowerCase())
  if (station && station.inputRows.length > 0) return station.inputRows[0].filePath
  return project.files.find((f) => f.kind === 'rules')?.path
}

// Цільовий файл для заготовки-аналізатора «Куди піде результат»: правила станка-
// призначення тримаються разом (файл його першого рядка); якщо в нього ще немає жодного
// правила — файл рядка-джерела (fallback передає викликач).
export function linkTargetFileFor(view: StationViewResult, destStationClassname: string, fallback: string): string {
  const dest = view.byClassname.get(destStationClassname.toLowerCase())
  if (dest && dest.inputRows.length > 0) return dest.inputRows[0].filePath
  return fallback
}

// W4 Task 6 (хвіст капстоуна №3): ЯВНИЙ вибір адміна перемагає автоматику linkTargetFileFor.
// Вибір НЕОБОВʼЯЗКОВИЙ (null/порожній рядок = «авто»), тож типова поведінка не змінюється
// мовчки — саме цього вимагає бриф. Обраний файл, який зник із проєкту (адмін видалив його
// тим самим T6-мутатором) або взагалі не є файлом правил, тихо відкочується в автоматику:
// кинути мутатор у явну відмову тут означало б заблокувати кнопку «куди піде результат»
// через застарілий стан пікера, який адмін давно не бачить.
export function resolveLinkTargetFile(
  view: StationViewResult,
  project: Project,
  destStationClassname: string,
  fallback: string,
  picked: string | null,
): string {
  if (picked && project.files.some((f) => f.path === picked && f.kind === 'rules')) return picked
  return linkTargetFileFor(view, destStationClassname, fallback)
}

// «створити N рядків» — та сама слов'янська плюралізація, що pluralizeInputs (ChainView).
export function pluralizeRows(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} рядок`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} рядки`
  return `${n} рядків`
}

// ---- Пропси / внутрішні типи ----------------------------------------------------------------

export interface StationWindowProps {
  project: Project
  index: ClassIndex
  stationClassname: string
  onProjectChange: (next: Project) => void
  // Перемикач станка в шапці (ZpSelect по view.stations) — викликач міняє свій стан
  // openStation, вікно перемонтовується з новим key (див. шапку файлу).
  onSwitchStation: (classname: string) => void
  onClose: () => void
  // ---- Два вибори файлу, ПІДНЯТІ у викликача (W4 Task 6, хвіст капстоуна №4) ----
  // Вікно перемонтовується з key={stationClassname} (шапка файлу), тому будь-який
  // useState тут ГИНЕ при перемиканні станка — знахідка №4 капстоуна: адмін обирав
  // «класти нові правила у мій файл», перемикав станок і мовчки повертався до типового
  // файлу. Ці два вибори — властивість СЕАНСУ адміна, а не конкретного станка, тож їхній
  // господар — App.tsx; решта внутрішнього стану (розгорнутий рядок, чіпи, взведене
  // видалення) навмисно лишається локальною і далі скидається разом зі станком.
  pickedTargetFile: string | null // файл для НОВИХ правил масового додавання
  onPickTargetFile: (path: string | null) => void
  pickedLinkFile: string | null // файл для заготовки-аналізатора «Куди піде результат»
  onPickLinkFile: (path: string | null) => void
}

interface WindowMessage {
  tone: 'ok' | 'warn' | 'alarm'
  text: string
}

// ---- Компонент ------------------------------------------------------------------------------

export function StationWindow({
  project,
  index,
  stationClassname,
  onProjectChange,
  onSwitchStation,
  onClose,
  pickedTargetFile,
  onPickTargetFile,
  pickedLinkFile,
  onPickLinkFile,
}: StationWindowProps) {
  const view = useMemo(() => buildStationView(project, index), [project, index])
  const station: StationInfo | undefined = view.byClassname.get(stripExact(stationClassname).trim().toLowerCase())
  // Станок міг зникнути з моделі (видалено останній рядок, а у Factions.json його немає) —
  // вікно лишається робочим на синтетичній порожній картці: адмін може одразу додати
  // сировину назад.
  const display = station ? station.display : displayNameOf(index, stripExact(stationClassname))
  const roles = station ? station.roles : { packer: false, analyzer: false }
  const rows = station ? station.inputRows : []

  const [expanded, setExpanded] = useState<{ filePath: string; ruleId: string } | null>(null)
  const [chips, setChips] = useState<string[]>([])
  // Лічильник-ключ ZpSelect сировини: після додавання чіпа селект перемонтовується з
  // чистим полем пошуку (value завжди '' — сам ефект синку query у ZpSelect не спрацює,
  // бо value не міняється; remount — єдиний чесний спосіб очистити набране).
  const [chipsEpoch, setChipsEpoch] = useState(0)
  const [linkEpoch, setLinkEpoch] = useState(0)
  const [newFileMode, setNewFileMode] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const [armedDelete, setArmedDelete] = useState<string | null>(null)
  const [message, setMessage] = useState<WindowMessage | null>(null)
  // W2.6 Task 5: панель «Клонування з заміною» — той самий станок, тому key на неї не
  // потрібен окремо (вікно вже перемонтовується цілком при перемиканні станка, шапка
  // файлу StationWindow.tsx вище).
  const [showClone, setShowClone] = useState(false)

  // Взведене видалення саморозряджається: 4 с на друге натискання, інакше — знову
  // звичайна кнопка (той самий дух, що друге натискання у вкладці VPP внутрішньоігрового
  // редактора — паттерн проєкту після відмови ShowDialog).
  useEffect(() => {
    if (!armedDelete) return
    const t = setTimeout(() => setArmedDelete(null), 4000)
    return () => clearTimeout(t)
  }, [armedDelete])

  const stationOptions = useMemo<ZpOption[]>(
    () => view.stations.map((st) => ({ id: st.classname, label: st.display, hint: st.classname })),
    [view],
  )
  const rulesFileOptions = useMemo(() => collectRulesFileOptions(project), [project])
  // Пікер файлу для «Куди піде результат»: перший пункт — «авто» (порожній id), решта —
  // ті самі rules-файли. Явний пункт «авто» ОБОВʼЯЗКОВИЙ: без нього адмін, який раз обрав
  // файл, не мав би як повернутись до типової поведінки (ZpSelect не вміє «скинути»).
  const linkFileOptions = useMemo<ZpOption[]>(
    () => [{ id: '', label: 'авто — поруч із правилами станка-призначення' }, ...rulesFileOptions],
    [rulesFileOptions],
  )
  const classOptionsSource = useMemo(
    () =>
      (query: string, limit: number): ZpOption[] =>
        searchClasses(index, query, limit).map((hit) => ({ id: hit.name, label: hit.name, hint: hit.mod })),
    [index],
  )

  // Обраний адміном цільовий файл діє, поки існує в проєкті; інакше — типовий.
  const defaultTarget = defaultTargetFileFor(view, project, stationClassname)
  const targetFile =
    pickedTargetFile && project.files.some((f) => f.path === pickedTargetFile && f.kind === 'rules')
      ? pickedTargetFile
      : defaultTarget

  // ---- Дії -----------------------------------------------------------------------------------

  function addChip(cls: string) {
    const trimmed = cls.trim()
    if (trimmed === '') return
    setChips((prev) => (prev.some((c) => c.toLowerCase() === trimmed.toLowerCase()) ? prev : [...prev, trimmed]))
    setChipsEpoch((e) => e + 1)
  }

  function doCreateStubs() {
    if (!targetFile || chips.length === 0) return
    const result = createStubRules(project, station ? station.classname : stripExact(stationClassname).trim(), chips, targetFile)
    if (!result.ok) {
      setMessage({ tone: 'alarm', text: result.error })
      return
    }
    onProjectChange(result.project)
    setChips([])
    setMessage({
      tone: 'ok',
      text: `Створено заготовок: ${result.createdIds.length} (вимкнені, позначені червоним — розгорніть рядок, налаштуйте виходи і ввімкніть)`,
    })
  }

  function doCreateFile() {
    const result = createRulesFile(project, newFileName)
    if (!result.ok) {
      setMessage({ tone: 'alarm', text: result.error })
      return
    }
    onProjectChange(result.project)
    onPickTargetFile(result.path)
    setNewFileMode(false)
    setNewFileName('')
    setMessage({ tone: 'ok', text: `Створено файл правил: ${result.path}` })
  }

  function doDelete(row: StationInputRow, rowKey: string) {
    if (armedDelete !== rowKey) {
      setArmedDelete(rowKey)
      return
    }
    setArmedDelete(null)
    const result = deleteRule(project, row.filePath, row.ruleId)
    if (!result.ok) {
      setMessage({ tone: 'alarm', text: result.error })
      return
    }
    onProjectChange(result.project)
    if (expanded && expanded.filePath === row.filePath && expanded.ruleId === row.ruleId) setExpanded(null)
    setMessage({ tone: 'ok', text: `Правило '${row.ruleId}' видалено з ${row.filePath}` })
  }

  function doLink(row: StationInputRow, outputIndex: number, destStation: string) {
    // Явний вибір адміна (пікер нижче) перемагає автоматику; порожній вибір = «авто»,
    // тобто РІВНО те, що робилось до W4 Task 6.
    const target = resolveLinkTargetFile(view, project, destStation, row.filePath, pickedLinkFile)
    const result = linkOutputToStation(project, index, row.filePath, row.ruleId, outputIndex, destStation, target)
    if (!result.ok) {
      setMessage({ tone: 'alarm', text: result.error })
      return
    }
    onProjectChange(result.project)
    setLinkEpoch((e) => e + 1)
    if (result.created) {
      setMessage({
        tone: 'ok',
        text: `Створено заготовку-аналізатор '${result.ruleId}' у ${result.filePath} (вимкнена — відкрийте станок-призначення, налаштуйте виходи і ввімкніть)`,
      })
    } else {
      setMessage({ tone: 'ok', text: `Вже пов'язано: вихід споживає правило '${result.ruleId}' (${result.filePath})` })
    }
  }

  // ---- Рендер --------------------------------------------------------------------------------

  return (
    <aside className="sheet station-window">
      <div className="sheet-title-row">
        <span className="sheet-title label">Вікно станка</span>
        <button type="button" className="quick-edit-close" onClick={onClose} aria-label="Закрити вікно станка">
          ×
        </button>
      </div>

      <div className="rule-field">
        <label className="field-label" htmlFor="sw-station-picker">
          Станок
        </label>
        {/* Перемикач станків БЕЗ полотна: ПОВНИЙ список view.stations, включно зі станками
            без жодного правила (DeviceClasses фракцій) — на полотні їх немає за задумом T2. */}
        <ZpSelect id="sw-station-picker" value={stationClassname} onChange={onSwitchStation} options={stationOptions} aria-label="Вибір станка" />
      </div>

      <div className="station-window-header">
        <h2 className="station-window-name">{display}</h2>
        <code className="station-window-class">{station ? station.classname : stripExact(stationClassname).trim()}</code>
        <div className="station-card-meta">
          {roles.packer && <span className="station-role-badge">пакувальник</span>}
          {roles.analyzer && <span className="station-role-badge">аналізатор</span>}
          {!station && <span className="station-row-flag">немає в моделі — додайте правило або DeviceClasses у Factions.json</span>}
        </div>
        {/* W2.6 Task 5: клонування з заміною — доступне лише коли є ЩО клонувати (станок
            без жодного правила однаково відмовив би в мутаторі io/cloneStation.ts). */}
        {rows.length > 0 && (
          <button type="button" aria-expanded={showClone} onClick={() => setShowClone((v) => !v)}>
            {showClone ? 'сховати клонування' : 'Скопіювати налаштування станка…'}
          </button>
        )}
      </div>

      {showClone && station && (
        <CloneStationDialog
          project={project}
          index={index}
          view={view}
          stationClassname={station.classname}
          stationDisplay={display}
          onProjectChange={onProjectChange}
          onClose={() => setShowClone(false)}
        />
      )}

      {message && (
        <p role={message.tone === 'alarm' ? 'alert' : 'status'} className={`indicator${message.tone === 'alarm' ? ' alarm' : ''}`}>
          <span className={`lamp lamp-${message.tone}`} aria-hidden="true" />
          {message.text}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="intro">У станка ще немає жодного правила — додайте сировину нижче, і рядки з'являться тут.</p>
      ) : (
        <ul className="station-rows">
          {rows.map((row, i) => {
            const rowKey = `${row.filePath}::${row.ruleId}#${i}`
            const isExpanded = expanded !== null && expanded.filePath === row.filePath && expanded.ruleId === row.ruleId
            const planned = collectPlannedDestinations(project, index, row)
            const outputsText = row.outputs
              .filter((o) => o.classname.trim() !== '')
              .map((o) => (o.content ? `${o.display} (${o.content})` : o.display))
              .join(', ')
            return (
              <li key={rowKey} className={`station-row${row.configured ? '' : ' station-row-unconfigured'}`}>
                <button
                  type="button"
                  className="station-row-head"
                  aria-expanded={isExpanded}
                  onClick={() => setExpanded(isExpanded ? null : { filePath: row.filePath, ruleId: row.ruleId })}
                >
                  <span className={`lamp lamp-${row.configured ? 'ok' : 'alarm'}`} aria-hidden="true" />
                  <span className="station-row-title">
                    <span className="station-row-name">{row.rawDisplay || 'вхід не задано'}</span>
                    {row.rawClassname.trim() !== '' && <code className="station-row-class">{row.rawClassname}</code>}
                    {row.disabled && <span className="station-row-flag">вимкнено</span>}
                    {row.duplicate && <span className="station-row-flag alarm">дубль Id</span>}
                  </span>
                  <span className="station-row-summary">
                    {'→ '}
                    {outputsText || 'вихід не задано'}
                    {' · '}
                    {row.destinations.length > 0
                      ? `йде: ${row.destinations.map((d) => d.display).join(', ')}`
                      : planned.length > 0
                        ? `заплановано: ${planned.map((d) => d.display).join(', ')}`
                        : 'нікуди не йде'}
                  </span>
                </button>

                {isExpanded && (
                  <div className="station-row-body">
                    {row.problems.length > 0 && (
                      <ul className="station-row-problems">
                        {row.problems.map((p, pi) => (
                          <li key={pi}>
                            <span className="lamp lamp-alarm" aria-hidden="true" />
                            {p}
                          </li>
                        ))}
                      </ul>
                    )}
                    {row.disabled && row.configured && (
                      <p className="hint">
                        Правило налаштоване, але вимкнене (заготовка зберігається з Enabled=0 — сервер її ігнорує). Увімкніть
                        прапорець «Увімкнено» у формі нижче, щоб ланцюг запрацював.
                      </p>
                    )}

                    <RuleForm
                      project={project}
                      index={index}
                      filePath={row.filePath}
                      ruleId={row.ruleId}
                      onProjectChange={onProjectChange}
                      onRuleIdChange={(newId) => setExpanded({ filePath: row.filePath, ruleId: newId })}
                      producedStreams={view.producedStreams}
                    />

                    {/* «Куди піде результат» — по одному пікеру на КОЖЕН заповнений вихід:
                        вибір станка створює (або знаходить наявний) аналізатор під цей потік. */}
                    {row.outputs.some((o) => o.classname.trim() !== '') && (
                      <div className="station-link-block">
                        <span className="field-label">Куди піде результат</span>
                        {/* W4 Task 6 (хвіст капстоуна №3): куди саме ляже НОВА заготовка-
                            аналізатор. Типове значення — «авто» (файл станка-призначення),
                            тобто поведінка до T6 не змінюється мовчки. */}
                        <div className="station-link-file">
                          <label className="field-label" htmlFor={`sw-link-file-${rowKey}`}>
                            Файл для нової заготовки
                          </label>
                          <ZpSelect
                            id={`sw-link-file-${rowKey}`}
                            value={pickedLinkFile ?? ''}
                            onChange={(path) => onPickLinkFile(path === '' ? null : path)}
                            options={linkFileOptions}
                            aria-label="Файл для нової заготовки-аналізатора"
                          />
                        </div>
                        {row.outputs.map((o, oi) => {
                          if (o.classname.trim() === '') return null
                          return (
                            <div className="station-link-row" key={`${rowKey}-link-${oi}`}>
                              <span className="station-link-output">
                                {o.display}
                                {o.content && <span className="content-mark">{o.content}</span>}
                              </span>
                              <ZpSelect
                                key={`link-${linkEpoch}`}
                                value=""
                                onChange={(cls) => doLink(row, oi, cls)}
                                options={stationOptions}
                                placeholder="оберіть станок-призначення…"
                                aria-label={`Куди піде вихід ${oi + 1}`}
                              />
                            </div>
                          )
                        })}
                        {planned.length > 0 && (
                          <p className="hint">
                            Заплановано (аналізатор-заготовка або вимкнений ланцюг): {planned.map((d) => d.display).join(', ')}
                          </p>
                        )}
                      </div>
                    )}

                    <button type="button" className={`rule-array-remove station-row-delete${armedDelete === rowKey ? ' armed' : ''}`} onClick={() => doDelete(row, rowKey)}>
                      {armedDelete === rowKey ? 'Точно видалити? (натисніть ще раз)' : '× Видалити правило'}
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/* ---- Масове додавання сировини --------------------------------------------------- */}
      <div className="station-bulk">
        <span className="sheet-title label">+ Додати сировину (масово)</span>

        <div className="rule-field">
          <label className="field-label" htmlFor="sw-target-file">
            Файл для нових правил
          </label>
          <ZpSelect
            id="sw-target-file"
            value={targetFile ?? ''}
            onChange={onPickTargetFile}
            options={rulesFileOptions}
            placeholder="немає файлів правил — створіть новий"
            aria-label="Файл для нових правил"
          />
          <button type="button" className="rule-array-add" aria-expanded={newFileMode} onClick={() => setNewFileMode((v) => !v)}>
            створити новий файл правил
          </button>
          {newFileMode && (
            <div className="station-newfile">
              <input
                className="field-input field-input-mono"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                placeholder="імʼя файлу, напр. ecolog_chain"
                aria-label="Імʼя нового файлу правил"
              />
              <button type="button" onClick={doCreateFile} disabled={newFileName.trim() === ''}>
                Створити файл
              </button>
            </div>
          )}
        </div>

        <div className="rule-field">
          <label className="field-label" htmlFor="sw-raw-picker">
            Сировина (оберіть кілька — накопичується списком)
          </label>
          <ZpSelect
            id="sw-raw-picker"
            key={`chips-${chipsEpoch}`}
            value=""
            onChange={addChip}
            optionsSource={classOptionsSource}
            allowFree
            placeholder="почніть вводити класнейм…"
            aria-label="Класнейм сировини для додавання"
          />
        </div>

        {chips.length > 0 && (
          <div className="station-chips">
            {chips.map((c) => (
              <span className="station-chip" key={c.toLowerCase()}>
                <code>{c}</code>
                <button type="button" onClick={() => setChips((prev) => prev.filter((x) => x !== c))} aria-label={`Прибрати ${c}`}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <button type="button" className="primary" disabled={chips.length === 0 || !targetFile} onClick={doCreateStubs}>
          створити {pluralizeRows(chips.length)}
        </button>
      </div>
    </aside>
  )
}
