// Оболонка застосунку (Task 7): відкриття проєкту (тека через File System Access API або
// імпорт ZIP), список файлів, панель попереджень вибраного файлу, канонізація (єдина
// мутація на W1 — позначає файл dirty без зміни значень) і збереження. Уся логіка
// класифікації/розбору/серіалізації живе в io/* (Tasks 4-6) — тут лише React-стан і
// виклики цих функцій. Візуальна система — «Мнемосхема пульта» (DESIGN.md):
// шапка-корпус із шильдиком, клавіші пульта, індикаторні лампи стану, секції-аркуші.

import { useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { DirectoryBackend, ZipBackend } from './io/backend'
import { loadProject, saveDirty, alarmFiles, repairFile, canSave, canExport, pendingDeletions } from './io/project'
import type { Project, ProjectFile } from './io/project'
import { FileList, kindLabel } from './ui/FileList'
import { FileDeleteButton } from './ui/FileDeleteButton'
import { AlarmGatePanel } from './ui/AlarmGatePanel'
import { ChainView } from './ui/ChainView'
import { StationOpenBar } from './ui/StationOpenBar'
import { TreeCanvas } from './ui/TreeCanvas'
import { StationWindow } from './ui/StationWindow'
import { DataItemQuickEdit } from './ui/DataItemQuickEdit'
import { SampleTypesView } from './ui/SampleTypesView'
import { PointTypesView } from './ui/PointTypesView'
import { FactionsView } from './ui/FactionsView'
import { ModulesView } from './ui/ModulesView'
import { DataItemsView } from './ui/DataItemsView'
import { SettingsView } from './ui/SettingsView'
import { BalanceTab } from './ui/BalanceTab'
import type { FocusRequest, TreeFocusRequest } from './ui/focusRequest'
import { pointTypesGateAlarms } from './model/configValidation'
import { activeClassIndex, setActiveClassIndex } from './model/classIndex'
import { readProjectClassIndex } from './io/classImport'
import { ImportClasses } from './ui/ImportClasses'

type Tab = 'files' | 'chains' | 'tree' | 'points' | 'samples' | 'dataItems' | 'factions' | 'modules' | 'settings' | 'balance'

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

// Індикаторний рядок: лампа стану + повідомлення (кольори — семантика DESIGN.md §3).
function Indicator({ tone, children }: { tone: 'ok' | 'warn' | 'alarm'; children: ReactNode }) {
  return (
    <p role={tone === 'alarm' ? 'alert' : 'status'} className={`indicator${tone === 'alarm' ? ' alarm' : ''}`}>
      <span className={`lamp lamp-${tone}`} aria-hidden="true" />
      {children}
    </p>
  )
}

function App() {
  const [project, setProject] = useState<Project | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('files')
  // W2.6 Task 3: канонічний класнейм станка, чиє вікно відкрите (клік «налаштувати» на
  // полотні АБО перемикач у шапці самого вікна). null -- вікно закрите. Колишній стан
  // selectedRule/ChainSelection (панель правки правила) видалений: правка правила тепер
  // живе в розгорнутому рядку вікна станка.
  const [openStation, setOpenStation] = useState<string | null>(null)
  // W4 Task 6 (хвіст капстоуна №4): два вибори файлу вікна станка живуть ТУТ, а не в
  // самому вікні — воно монтується з key={openStation} і будь-який його useState гине при
  // перемиканні станка (адмін мовчки втрачав обраний файл для нових правил).
  const [stationTargetFile, setStationTargetFile] = useState<string | null>(null)
  const [stationLinkFile, setStationLinkFile] = useState<string | null>(null)
  // T9: класнейм заготовки (ZP_Data_*), клікнутої на предметі-вузлі полотна — незалежний
  // від selectedRule (клік по предмету зупиняє спливання, дивись ChainView.tsx/
  // ItemCardNode, W2.6 Task 2). null -- квик-редактор не показується.
  const [selectedDataItem, setSelectedDataItem] = useState<string | null>(null)
  // T7: активний індекс класів живе МОДУЛЬНОЮ змінною (activeClassIndex — його читають
  // чисті функції поза React); епоха лише змушує React перечитати її після
  // setActiveClassIndex (імпорт «використати зараз» або ClassIndex.json із проєкту).
  const [indexEpoch, setIndexEpoch] = useState(0)
  const [showImport, setShowImport] = useState(false)
  // W4 Task 5: переходи з read-only вкладки «Баланс» у робочі вкладки. Кожен запит несе
  // nonce (ui/focusRequest.ts), тож повторний клік по тому самому рядку спрацьовує знову, а
  // між кліками вкладка-приймач лишається повним господарем свого вибору.
  const [focusNonce, setFocusNonce] = useState(0)
  const [dataItemFocus, setDataItemFocus] = useState<FocusRequest | null>(null)
  const [pointTypeFocus, setPointTypeFocus] = useState<FocusRequest | null>(null)
  const [treeFocus, setTreeFocus] = useState<TreeFocusRequest | null>(null)

  // Читається щоразу при рендері; indexEpoch у залежностях НЕ потрібен — саме зміна
  // епохи і викликає новий рендер. void, щоб лінтер бачив використання епохи чесно:
  void indexEpoch
  const classIdx = activeClassIndex()

  const selectedFile: ProjectFile | undefined = project?.files.find((f) => f.path === selectedPath)
  const dirtyCount = project ? project.files.filter((f) => f.dirty).length : 0
  const canDownloadZip = project !== null && project.backend.kind === 'zip'
  // W2.7 Task 1: список файлів з alarm-попередженням (io/project.ts) — заголовок панелі й
  // title-тексти нижче читають ЦЕЙ САМИЙ масив, перерахований щоразу при рендері (той самий
  // принцип, що dirtyCount вище — жодного окремого useState).
  const alarmList = project ? alarmFiles(project) : []
  // W4 Task 2 (хвіст 1 ревʼю T1): гейт ДАНИХ PointTypes (дубль Id/порожній Name/Tier поза
  // межами) блокує ті самі кнопки, що й alarm-файли (canSave/canExport уже рахують його з
  // T1) — тепер аварійна панель це ПОЯСНЮЄ і веде на вкладку «Бали», де живе ремонт.
  const dataAlarmList = project ? pointTypesGateAlarms(project) : []
  // Черга видалень — така сама «незбережена дія», як dirty (гейт canSave/canExport її вже
  // рахує); тут потрібна лише для ЧЕСНОЇ підказки, чому кнопка згасла (ревью T6, Imp. 1).
  const pendingDeleteCount = project ? pendingDeletions(project).length : 0
  // W2.7 фікс-раунд 1: сам disabled кнопок тепер іде через ЧИСТІ canSave/canExport
  // (io/project.ts) — той самий busy-поділ, що й раніше (busy — транзиентний UI-стан поза
  // Project, лишається окремим `||` в JSX нижче), лише композитна dirty+alarm умова
  // винесена з inline JSX у функцію з прямими юніт-тестами (tests/alarmGate.test.ts).
  const saveAllowed = project !== null && canSave(project)
  const exportAllowed = project !== null && canExport(project)

  // ProjectFile-об'єкти в project.files мутуються НА МІСЦІ і canonicalize (нижче), і
  // saveDirty (io/project.ts) — React про це не знає без нового посилання, тож кожна дія
  // після мутації підміняє і сам Project, і масив files новими обгортками того самого
  // вмісту, щоб компонент перемалювався.
  function touch(p: Project) {
    setProject({ ...p, files: [...p.files] })
  }

  async function openProject(loader: () => Promise<Project>) {
    setError(null)
    setStatus(null)
    setBusy(true)
    try {
      const proj = await loader()
      setProject(proj)
      setSelectedPath(null)
      // Пріоритет «папка > бандл» (T7): свіжий ClassIndex.json у відкритому проєкті
      // перекриває вшитий індекс; відсутній — повертаємось до бандла (перемикання між
      // проєктами не сміє тягти чужий індекс за собою).
      try {
        const projIdx = await readProjectClassIndex(proj.backend)
        setActiveClassIndex(projIdx)
        if (projIdx) {
          setStatus(`Індекс класів із проєкту: ${projIdx.classes.length} класів (перекриває вбудований)`)
        }
      } catch (idxErr) {
        setActiveClassIndex(null)
        setStatus(`Увага: ClassIndex.json у проєкті не читається (${describeError(idxErr)}) — використано вбудований індекс`)
      }
      setIndexEpoch((e) => e + 1)
    } catch (err) {
      // Користувач закрив системний діалог вибору теки — це не помилка, а відмова.
      if (err instanceof DOMException && err.name === 'AbortError') return
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  function handleOpenFolder() {
    void openProject(async () => loadProject(await DirectoryBackend.pick()))
  }

  function handleZipFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // дозволяє повторно обрати той самий файл пізніше
    if (!file) return
    void openProject(async () => {
      const bytes = new Uint8Array(await file.arrayBuffer())
      return loadProject(ZipBackend.fromBytes(bytes))
    })
  }

  async function handleSave() {
    if (!project) return
    setError(null)
    setStatus(null)
    setBusy(true)
    try {
      const { written, removed } = await saveDirty(project)
      touch(project)
      // W4 Task 6: видалення файлів застосовується тим самим «Зберегти зміни», тож і в
      // звіті вони мусять бути видимі окремим числом — інакше адмін не знає, чи дійшло.
      if (written.length > 0 && removed.length > 0) {
        setStatus(`Збережено файлів: ${written.length}, видалено: ${removed.length}`)
      } else if (written.length > 0) {
        setStatus(`Збережено файлів: ${written.length}`)
      } else if (removed.length > 0) {
        setStatus(`Видалено файлів: ${removed.length}`)
      } else {
        setStatus('Немає незбережених змін')
      }
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  // W2.7 Task 1: тепер тонка обгортка над repairFile (io/project.ts) замість прямої мутації
  // selectedFile.dirty — той самий мутатор, що й «Полагодити все» нижче. Єдиний шлях
  // навмисно один: якби «Канонізувати файл» лишався окремою реалізацією, яка не чистить
  // alarm-попередження, клік по ньому на alarm-файлі позначив би файл dirty, але
  // alarmFiles(project) і далі бачила б його — «Зберегти зміни» лишалось би заблокованим
  // без жодного очевидного виходу (план W2.7: «адмін не може застрягти»).
  function handleCanonicalize() {
    if (!project || !selectedFile || selectedFile.kind === 'foreign') return
    const result = repairFile(project, selectedFile.path)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setStatus(null)
    setError(null)
    setProject(result.project)
  }

  // «Полагодити все» аварійної панелі — той самий repairFile, застосований до КОЖНОГО
  // поточного alarm-файлу по черзі (кожен виклик бере РЕЗУЛЬТАТ попереднього, той самий
  // патерн послідовних правок, що й applyDataItemEdit/applyRuleEdit у тестах). targets
  // знімається ДО цикла — довжина списку в підсумковому статусі рахує саме те, що було на
  // момент натискання, а не те, що лишилось (яке завжди 0, бо repairFile завжди встигає).
  function handleRepairAll() {
    if (!project) return
    const targets = alarmFiles(project)
    let current = project
    for (const target of targets) {
      const result = repairFile(current, target.path)
      if (result.ok) current = result.project
    }
    setProject(current)
    setError(null)
    setStatus(`Полагоджено файлів: ${targets.length} — «Зберегти зміни» перепише їх на диску правильними типами`)
  }

  // Клік по шляху в аварійній панелі — перемикає на вкладку «Файли» й одразу вибирає файл
  // (той самий UX, що клік по рядку реєстру, лише з іншого місця).
  // selectTab, а НЕ голий setTab (закривна хвиля W4, minor 2 фінального ревʼю): будь-який
  // перехід по вкладках мусить гасити невиконані запити фокуса, інакше повертається дірка,
  // закрита у фікс-раунді T5 — «Баланс» попросив фокус, адмін пішов сам, потім прийшов
  // сюди з аварійної панелі, вкладка перемонтувалась і переграла СТАРИЙ запит.
  function handleSelectFromAlarm(path: string) {
    selectTab('files')
    setSelectedPath(path)
  }

  // Ручний перехід по вкладках ГАСИТЬ невиконані запити фокуса (фікс-раунд ревʼю W4/T5,
  // minor 7). Вкладки монтуються/розмонтовуються разом із перемиканням, тож ефект приймача
  // (`useEffect(..., [focus])`) відпрацьовує ЩЕ РАЗ на кожному монтуванні — а nonce у пропі
  // той самий, і ref усередині приймача тут не допоміг би, бо він теж створюється заново.
  // Тому запит мусить бути ОДНОРАЗОВИМ, і власник його одноразовості — той, хто його
  // видав: повернувшись на «Заготовки» руками, адмін бачить СВІЙ вибір, а не переграний
  // останній клік із «Балансу».
  function selectTab(next: Tab) {
    setDataItemFocus(null)
    setPointTypeFocus(null)
    setTreeFocus(null)
    setTab(next)
  }
  // Переходи з «Балансу»: спершу вкладка (гасить попередній запит), потім новий запит із
  // новим nonce — React застосовує setState у порядку виклику, тож перемога за новим.
  function nextNonce(): number {
    const n = focusNonce + 1
    setFocusNonce(n)
    return n
  }
  function handleOpenDataItem(classname: string) {
    selectTab('dataItems')
    setDataItemFocus({ value: classname, nonce: nextNonce() })
  }
  function handleOpenPointType(id: string) {
    selectTab('points')
    setPointTypeFocus({ value: id, nonce: nextNonce() })
  }
  function handleOpenTreeNode(filePath: string, nodeId: string) {
    selectTab('tree')
    setTreeFocus({ filePath, nodeId, nonce: nextNonce() })
  }
  // Станок відкривається тим самим станом, що й клік по картці на полотні ланцюгів.
  function handleOpenStationFromBalance(classname: string) {
    selectTab('chains')
    setOpenStation(classname)
  }

  function handleDownloadZip() {
    if (!project || project.backend.kind !== 'zip') return
    const bytes = (project.backend as ZipBackend).export()
    // Cast: та сама над-строга ArrayBufferView<ArrayBuffer> вимога lib.dom, що й у
    // backend.ts DirectoryBackend.write — наш Uint8Array валідний BlobPart у рантаймі.
    const blob = new Blob([bytes as BlobPart], { type: 'application/zip' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'ZP_Research.zip'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <header className="housing">
        <div className="housing-inner">
          <h1 className="nameplate">
            <span className="nameplate-id">ZP_Research</span>
            <span className="nameplate-role label">Редактор конфігів</span>
          </h1>
        </div>
      </header>

      <main>
        <section className="toolbar">
          {DirectoryBackend.isSupported() && (
            <button type="button" onClick={handleOpenFolder} disabled={busy}>
              Відкрити теку ZP_Research
            </button>
          )}

          <label className="button-like" htmlFor="import-zip-input">
            Імпортувати ZIP
          </label>
          <input
            id="import-zip-input"
            className="sr-only"
            type="file"
            accept=".zip"
            onChange={handleZipFile}
            disabled={busy}
          />

          <button
            type="button"
            className="primary"
            onClick={() => void handleSave()}
            disabled={busy || !saveAllowed}
            title={
              alarmList.length > 0
                ? 'Заблоковано: у проєкті є файли з хибними типами значень — див. панель нижче'
                : dataAlarmList.length > 0
                  ? 'Заблоковано: аварійні записи типів балів (дубль Id тощо) — див. панель нижче'
                  : undefined
            }
          >
            Зберегти зміни
          </button>

          {canDownloadZip && (
            <button
              type="button"
              onClick={handleDownloadZip}
              disabled={busy || !exportAllowed}
              title={
                alarmList.length > 0
                  ? 'Заблоковано: у проєкті є файли з хибними типами значень — див. панель нижче'
                  : dataAlarmList.length > 0
                    ? 'Заблоковано: аварійні записи типів балів (дубль Id тощо) — див. панель нижче'
                    : dirtyCount > 0
                      ? 'Спершу збережіть зміни — ZIP пакує тільки те, що вже на диску'
                      : // Ревью T6, Important 1: canExport рахує ще й чергу видалень
                        // (io/project.ts) — без цієї гілки кнопка гасла БЕЗ пояснення,
                        // коли єдина незбережена дія — саме видалення файлу.
                        pendingDeleteCount > 0
                        ? 'Спершу збережіть зміни — є невиконані видалення файлів'
                        : undefined
              }
            >
              Завантажити ZIP
            </button>
          )}

          <button
            type="button"
            id="toggle-import-classes"
            aria-expanded={showImport}
            onClick={() => setShowImport((v) => !v)}
          >
            Оновити індекс класів
          </button>
        </section>

        {project && (alarmList.length > 0 || dataAlarmList.length > 0) && (
          <AlarmGatePanel
            files={alarmList}
            dataAlarms={dataAlarmList}
            busy={busy}
            onSelectFile={handleSelectFromAlarm}
            onRepairAll={handleRepairAll}
            onOpenPointTypes={() => selectTab('points')}
          />
        )}

        {showImport && (
          <ImportClasses
            project={project}
            onIndexApplied={(message) => {
              setIndexEpoch((e) => e + 1)
              setStatus(message)
            }}
          />
        )}

        {busy && <Indicator tone="warn">Завантаження…</Indicator>}
        {status && <Indicator tone="ok">{status}</Indicator>}
        {error && <Indicator tone="alarm">Помилка: {error}</Indicator>}

        {!project && !busy && (
          <p className="intro">
            Відкрийте теку профілю <code>ZP_Research</code> або імпортуйте ZIP-архів — редактор
            покаже всі конфіги, їхні типи та попередження формату.
          </p>
        )}

        {project && (
          <div className="tabbar" role="tablist" aria-label="Розділи редактора">
            <button
              type="button"
              role="tab"
              id="tab-files"
              aria-selected={tab === 'files'}
              aria-controls="tabpanel-files"
              className="tab-button"
              onClick={() => selectTab('files')}
            >
              Файли
            </button>
            <button
              type="button"
              role="tab"
              id="tab-chains"
              aria-selected={tab === 'chains'}
              aria-controls="tabpanel-chains"
              className="tab-button"
              onClick={() => selectTab('chains')}
            >
              Ланцюги
            </button>
            <button
              type="button"
              role="tab"
              id="tab-tree"
              aria-selected={tab === 'tree'}
              aria-controls="tabpanel-tree"
              className="tab-button"
              onClick={() => selectTab('tree')}
            >
              Дерево
            </button>
            <button
              type="button"
              role="tab"
              id="tab-points"
              aria-selected={tab === 'points'}
              aria-controls="tabpanel-points"
              className="tab-button"
              onClick={() => selectTab('points')}
            >
              Бали
            </button>
            <button
              type="button"
              role="tab"
              id="tab-samples"
              aria-selected={tab === 'samples'}
              aria-controls="tabpanel-samples"
              className="tab-button"
              onClick={() => selectTab('samples')}
            >
              Зразки
            </button>
            <button
              type="button"
              role="tab"
              id="tab-dataitems"
              aria-selected={tab === 'dataItems'}
              aria-controls="tabpanel-dataitems"
              className="tab-button"
              onClick={() => selectTab('dataItems')}
            >
              Заготовки
            </button>
            <button
              type="button"
              role="tab"
              id="tab-factions"
              aria-selected={tab === 'factions'}
              aria-controls="tabpanel-factions"
              className="tab-button"
              onClick={() => selectTab('factions')}
            >
              Фракції
            </button>
            <button
              type="button"
              role="tab"
              id="tab-modules"
              aria-selected={tab === 'modules'}
              aria-controls="tabpanel-modules"
              className="tab-button"
              onClick={() => selectTab('modules')}
            >
              Модулі
            </button>
            <button
              type="button"
              role="tab"
              id="tab-settings"
              aria-selected={tab === 'settings'}
              aria-controls="tabpanel-settings"
              className="tab-button"
              onClick={() => selectTab('settings')}
            >
              Налаштування
            </button>
            <button
              type="button"
              role="tab"
              id="tab-balance"
              aria-selected={tab === 'balance'}
              aria-controls="tabpanel-balance"
              className="tab-button"
              onClick={() => selectTab('balance')}
            >
              Баланс
            </button>
          </div>
        )}

        {project?.backend.kind === 'directory' && tab === 'files' && (
          <p className="hint">
            Увага: у режимі теки файли, вкладені на два й більше рівні під ProcessingRules/TechTree,
            у списку не показуються — це обмеження перегляду теки в браузері, а не вичерпний
            перелік усього, що фізично лежить на диску.
          </p>
        )}

        {project && tab === 'files' && (
          <div role="tabpanel" id="tabpanel-files" aria-labelledby="tab-files">
            <section className="sheet">
              <span className="sheet-title label">Реєстр файлів</span>
              <FileList files={project.files} selectedPath={selectedPath} onSelect={setSelectedPath} />
            </section>

            <section className="sheet detail">
              <span className="sheet-title label">Паспорт файлу</span>
              {selectedFile ? (
                <>
                  <h2>{selectedFile.path}</h2>
                  <p className="detail-kind">Тип: {kindLabel(selectedFile)}</p>
                  {selectedFile.kind === 'foreign' ? (
                    <p className="hint">Файл не редагується редактором — це живий стан сервера.</p>
                  ) : (
                    <>
                      <button type="button" onClick={handleCanonicalize} disabled={busy}>
                        Канонізувати файл
                      </button>
                      {/* W4 Task 6: видалення файлу — підтвердження другим натисканням і
                          перелік вмісту всередині самого компонента. */}
                      <FileDeleteButton
                        key={selectedFile.path}
                        project={project}
                        file={selectedFile}
                        busy={busy}
                        onProjectChange={setProject}
                        onDeleted={() => setSelectedPath(null)}
                      />
                      {selectedFile.warnings.length === 0 ? (
                        <p className="no-warnings">
                          <span className="lamp lamp-ok" aria-hidden="true" />
                          Попереджень немає.
                        </p>
                      ) : (
                        <ul className="warnings">
                          {selectedFile.warnings.map((w, i) => (
                            <li key={i} className={w.severity === 'alarm' ? 'alarm' : undefined}>
                              <code>{w.path || '(корінь)'}</code>: {w.message}
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </>
              ) : (
                <p className="intro">Виберіть файл у реєстрі, щоб побачити подробиці.</p>
              )}
            </section>
          </div>
        )}

        {project && tab === 'chains' && (
          <div role="tabpanel" id="tabpanel-chains" aria-labelledby="tab-chains">
            {/* W4 Task 6 (хвіст капстоуна №2): вхід у вікно станка, що НЕ залежить від
                картки на полотні — інакше станок без правил (і проєкт без правил узагалі)
                недосяжний, а саме там і створюється перше правило. */}
            <StationOpenBar project={project} index={classIdx} openStation={openStation} onOpenStation={setOpenStation} />
            {/* Каркас §5 DESIGN.md: полотно-мілиметрівка зліва (гнучке), бічна колонка
                справа. Обидва читають/пишуть ТОЙ САМИЙ project стан -- живий граф =
                просто нове посилання Project. W2.6 Task 3: клік по станку на полотні
                (onOpenStation) відкриває ВІКНО СТАНКА -- головну робочу поверхню адміна
                (рядки сировини, масове додавання, розгорнута форма правила, «Куди піде
                результат»). Колонка ширшає, коли вікно відкрите (chain-side-column-wide):
                вбудована форма правила потребує більше місця, ніж квик-редактор. */}
            <div className="chain-workspace">
              <ChainView
                project={project}
                index={classIdx}
                onSelectOutput={setSelectedDataItem}
                onOpenStation={setOpenStation}
              />
              {/* Бічна колонка: квик-редактор заготовки (T9) СТЕКом над вікном станка --
                  обидва можуть бути відкритими одночасно, кожен пише в ТОЙ САМИЙ project
                  через свої чисті мутатори (усі повертають ПОВНІСТЮ новий Project --
                  setProject напряму, без touch(), той самий контракт T6). */}
              <div className={`chain-side-column${openStation ? ' chain-side-column-wide' : ''}`}>
                {selectedDataItem && (
                  <DataItemQuickEdit
                    // key: W2-триаж, W2.5 Task 3 -- без нього перемикання data-face-тега
                    // на картці (новий selectedDataItem) лишало компонент ЗМОНТОВАНИМ,
                    // тож застарілий commitError (та internal editing/text-стан з інших
                    // полів, useState вище) переживав перехід на інший класнейм. key
                    // змушує React розмонтувати й змонтувати заново на кожній зміні
                    // classname -- увесь internal стан завжди починається з чистого листа.
                    key={selectedDataItem}
                    project={project}
                    index={classIdx}
                    classname={selectedDataItem}
                    onProjectChange={setProject}
                    onClose={() => setSelectedDataItem(null)}
                  />
                )}
                {openStation && (
                  <StationWindow
                    // key: той самий T9-урок, що в DataItemQuickEdit вище -- перемикання
                    // станка (перемикачем у шапці вікна чи кліком по іншому станку на
                    // полотні) перемонтовує вікно з чистим станом (розгорнутий рядок,
                    // чіпи масового додавання, взведене видалення).
                    key={openStation}
                    project={project}
                    index={classIdx}
                    stationClassname={openStation}
                    onProjectChange={setProject}
                    onSwitchStation={setOpenStation}
                    onClose={() => setOpenStation(null)}
                    pickedTargetFile={stationTargetFile}
                    onPickTargetFile={setStationTargetFile}
                    pickedLinkFile={stationLinkFile}
                    onPickLinkFile={setStationLinkFile}
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {project && tab === 'tree' && (
          <div role="tabpanel" id="tabpanel-tree" aria-labelledby="tab-tree">
            {/* W3 Task 2: полотно дерева технологій — Tier-колонки, драг вузла між
                колонками = правка Tier (мутатор applyNodeEdit пише в робочу копію файлу
                гілки -> setProject -> живий перерахунок). Панель вузла — T3 (контракт
                onSelectNode уже заведений усередині TreeCanvas). */}
            <TreeCanvas project={project} index={classIdx} onProjectChange={setProject} focus={treeFocus} />
          </div>
        )}

        {project && tab === 'points' && (
          <div role="tabpanel" id="tabpanel-points" aria-labelledby="tab-points">
            {/* W4 Task 2: матриця типів балів Категорія×Вид×Тір + редактор осей + деталь-
                панель. ClassIndex не потрібен: жодне поле типу балів не посилається на
                класнейми — лише на осі того самого файлу. */}
            <PointTypesView project={project} onProjectChange={setProject} focus={pointTypeFocus} />
          </div>
        )}

        {project && tab === 'samples' && (
          <div role="tabpanel" id="tabpanel-samples" aria-labelledby="tab-samples">
            <SampleTypesView project={project} index={classIdx} onProjectChange={setProject} />
          </div>
        )}

        {project && tab === 'factions' && (
          <div role="tabpanel" id="tabpanel-factions" aria-labelledby="tab-factions">
            {/* W4 Task 3: список фракцій + деталь-панель. ClassIndex — для ZpSelect-полів
                нашивок/терміналів/приладів і validateClassField-попереджень. */}
            <FactionsView project={project} index={classIdx} onProjectChange={setProject} />
          </div>
        )}

        {project && tab === 'modules' && (
          <div role="tabpanel" id="tabpanel-modules" aria-labelledby="tab-modules">
            {/* W4 Task 3: модулі чистоти (Modules.json) — список + деталь-панель. */}
            <ModulesView project={project} index={classIdx} onProjectChange={setProject} />
          </div>
        )}

        {project && tab === 'dataItems' && (
          <div role="tabpanel" id="tabpanel-dataitems" aria-labelledby="tab-dataitems">
            {/* W4 Task 4: повний список 90 класів родини ZP_Data_Base + сироти DataItems.json;
                деталь-панель — спільний DataItemEditForm (той самий, що квик-редактор полотна). */}
            <DataItemsView project={project} index={classIdx} onProjectChange={setProject} focus={dataItemFocus} />
          </div>
        )}

        {project && tab === 'settings' && (
          <div role="tabpanel" id="tabpanel-settings" aria-labelledby="tab-settings">
            {/* W4 Task 4: форма всіх полів ZP_SettingsConfig (Settings.json), warn-only. */}
            <SettingsView project={project} index={classIdx} onProjectChange={setProject} />
          </div>
        )}

        {project && tab === 'balance' && (
          <div role="tabpanel" id="tabpanel-balance" aria-labelledby="tab-balance">
            {/* W4 Task 5: READ-ONLY аналітика — «що скільки дає», чим виробляється і чи
                вистачає видобутку на вартість дерева. Мутаторів тут немає навмисно; числа
                правляться у своїх вкладках, куди ведуть колбеки нижче. */}
            <BalanceTab
              project={project}
              index={classIdx}
              onOpenDataItem={handleOpenDataItem}
              onOpenPointType={handleOpenPointType}
              onOpenTree={handleOpenTreeNode}
              onOpenStation={handleOpenStationFromBalance}
            />
          </div>
        )}
      </main>
    </>
  )
}

export default App
