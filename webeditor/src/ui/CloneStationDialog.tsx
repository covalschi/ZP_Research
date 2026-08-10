// «Клонування з заміною» (W2.6 Task 5) — панель ВСЕРЕДИНІ вікна станка (не модальний
// діалог: проєктна конвенція, дивись коментар над .station-window у index.css і
// прецедент VPPDialogBox з CLAUDE.md, "SetSort(1024) глушив інтерфейс" — тут нема
// нічого схожого, панель просто рендериться в потоці, як .station-bulk нижче списку
// рядків). Уся логіка заміни — ОДИН чистий мутатор io/cloneStation.ts
// (cloneRulesWithSubstitution); панель лише збирає таблицю замін і виклик
// "APPLY = той самий виклик, що вже намалював живий прев'ю" -- РІВНО ОДИН виклик
// мутатора на рендер (useMemo), preview і apply НЕ два різні шляхи коду: поки адмін
// редагує таблицю/Id, панель просто НЕ передає результат у onProjectChange (мутатор
// чистий -- виклик без коміту нічого не змінює), клік «Застосувати» передає ГОТОВИЙ
// preview.project далі.

import { useMemo, useState } from 'react'
import type { Project } from '../io/project'
import { cloneRulesWithSubstitution } from '../io/cloneStation'
import type { Substitution, SubstitutionKind } from '../io/cloneStation'
import { createRulesFile } from '../io/stationEdit'
import type { ClassIndex } from '../model/classIndex'
import { searchClasses } from '../model/classIndex'
import type { StationViewResult } from '../model/stationView'
import { defaultTargetFileFor, collectRulesFileOptions } from './StationWindow'
import { collectFactionOptions } from './RulePanel'
import { ZpSelect } from './ZpSelect'
import type { ZpOption } from './ZpSelect'

interface SubRow {
  key: number
  kind: SubstitutionKind
  from: string
  to: string
}

// Та сама слов'янська плюралізація, що pluralizeRows (StationWindow.tsx)/pluralizeInputs
// (ChainView.tsx) — лише інше слово ("правило"), тому НЕ переекспортується звідти
// (StationWindow.pluralizeRows жорстко зашиває "рядок").
export function pluralizeClonedRules(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} правило`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} правила`
  return `${n} правил`
}

export interface CloneStationDialogProps {
  project: Project
  index: ClassIndex
  view: StationViewResult
  stationClassname: string
  stationDisplay: string
  onProjectChange: (next: Project) => void
  onClose: () => void
}

export function CloneStationDialog({ project, index, view, stationClassname, stationDisplay, onProjectChange, onClose }: CloneStationDialogProps) {
  // Перший рядок ЗАВЖДИ пред-заповнений «цей станок -> (порожньо)» (п.1 брифа) -- адмін
  // одразу бачить, ЩО саме замінює станок-ціль, лишається лише обрати «на що».
  const [rows, setRows] = useState<SubRow[]>(() => [{ key: 0, kind: 'class', from: stationClassname, to: '' }])
  const [nextKey, setNextKey] = useState(1)
  const [idOverrides, setIdOverrides] = useState<string[]>([])
  const [pickedTargetFile, setPickedTargetFile] = useState<string | null>(null)
  const [newFileMode, setNewFileMode] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const [createFileError, setCreateFileError] = useState<string | null>(null)

  const classOptionsSource = useMemo(
    () =>
      (query: string, limit: number): ZpOption[] =>
        searchClasses(index, query, limit).map((hit) => ({ id: hit.name, label: hit.name, hint: hit.mod })),
    [index],
  )
  const factionOptions = useMemo(() => collectFactionOptions(project), [project])
  const rulesFileOptions = useMemo(() => collectRulesFileOptions(project), [project])

  const defaultTarget = defaultTargetFileFor(view, project, stationClassname)
  const targetFile =
    pickedTargetFile && project.files.some((f) => f.path === pickedTargetFile && f.kind === 'rules') ? pickedTargetFile : defaultTarget

  const substitutions: Substitution[] = useMemo(
    () => rows.filter((r) => r.from.trim() !== '' && r.to.trim() !== '').map((r) => ({ kind: r.kind, from: r.from, to: r.to })),
    [rows],
  )
  const overridesForCall = useMemo(() => idOverrides.map((v) => (v.trim() === '' ? undefined : v)), [idOverrides])

  // РІВНО ОДИН виклик мутатора живить і прев'ю, і (на кліку «Застосувати») сам запис --
  // ok:false тут не «помилка панелі», а звичайний проміжний стан (напр. цільовий файл ще
  // не обрано жодного разу в проєкті без жодного файла правил).
  const preview = useMemo(() => {
    if (!targetFile) return undefined
    return cloneRulesWithSubstitution(project, index, stationClassname, substitutions, targetFile, overridesForCall)
  }, [project, index, stationClassname, targetFile, substitutions, overridesForCall])

  function addRow() {
    setRows((prev) => [...prev, { key: nextKey, kind: 'class', from: '', to: '' }])
    setNextKey((k) => k + 1)
  }
  function removeRow(key: number) {
    setRows((prev) => prev.filter((r) => r.key !== key))
  }
  function setRowKind(key: number, kind: SubstitutionKind) {
    // Зміна типу рядка знецінює попередній вибір -- класнейм і Id фракції живуть у РІЗНИХ
    // просторах (тест cloneStation.test.ts "різні простори замін" закріплює це і на
    // мутаторі), лишати старий текст під новим типом означало б показувати адміну заміну,
    // яка насправді нічого не зробить.
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, kind, from: '', to: '' } : r)))
  }
  function setRowFrom(key: number, v: string) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, from: v } : r)))
  }
  function setRowTo(key: number, v: string) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, to: v } : r)))
  }
  function setOverride(i: number, v: string) {
    setIdOverrides((prev) => {
      const next = [...prev]
      next[i] = v
      return next
    })
  }

  function doCreateFile() {
    const result = createRulesFile(project, newFileName)
    if (!result.ok) {
      setCreateFileError(result.error)
      return
    }
    setCreateFileError(null)
    onProjectChange(result.project)
    setPickedTargetFile(result.path)
    setNewFileMode(false)
    setNewFileName('')
  }

  // ВИПРАВЛЕНО (W2.6-фінал, фінальне whole-branch ревʼю, мінор d): раніше після успішного
  // застосування панель лишалась ВІДКРИТОЮ з рядками/таблицею замін у ТОМУ САМОМУ стані --
  // другий клік «Застосувати» без жодної зміни знову клонував ті самі вихідні правила
  // станка (stationClassname у пропах не міняється), плодячи ЩЕ один набір клонів кожним
  // зайвим кліком. Обрано найпростіший з двох варіантів (скидання таблиці замін VS
  // закриття панелі): onClose() одразу після onProjectChange -- StationWindow.tsx рендерить
  // CloneStationDialog умовно (`showClone && station && <CloneStationDialog .../>`), тож
  // закриття ПОВНІСТЮ розмонтовує панель разом з усім її станом (rows/idOverrides/preview)
  // -- повторне відкриття «Скопіювати налаштування станка…» стартує ЗАНОВО, з чистого
  // першого рядка «цей станок -> (порожньо)», так само, як перше відкриття.
  function doApply() {
    if (!preview || !preview.ok) return
    onProjectChange(preview.project)
    onClose()
  }

  return (
    <section className="sheet clone-dialog">
      <div className="sheet-title-row">
        <span className="sheet-title label">Скопіювати налаштування станка «{stationDisplay}»</span>
        <button type="button" className="quick-edit-close" onClick={onClose} aria-label="Закрити клонування">
          ×
        </button>
      </div>

      <p className="hint">
        Клонує УСІ правила станка «{stationDisplay}» ({view.byClassname.get(stationClassname.toLowerCase())?.inputRows.length ?? 0}) за
        таблицею замін нижче. Перший рядок уже задає «цей станок → …» — оберіть станок-ціль. Клони завжди створюються
        ВИМКНЕНИМИ (Enabled=0) — перевірте виходи й увімкніть після клонування, той самий принцип, що масове додавання сировини.
      </p>

      {/* ---- Файл-ціль ------------------------------------------------------------------ */}
      <div className="rule-field">
        <label className="field-label" htmlFor="cs-target-file">
          Файл для клонів
        </label>
        <ZpSelect
          id="cs-target-file"
          value={targetFile ?? ''}
          onChange={setPickedTargetFile}
          options={rulesFileOptions}
          placeholder="немає файлів правил — створіть новий"
          aria-label="Файл для клонів"
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
              placeholder="імʼя файлу, напр. chembench_chain"
              aria-label="Імʼя нового файлу правил"
            />
            <button type="button" onClick={doCreateFile} disabled={newFileName.trim() === ''}>
              Створити файл
            </button>
          </div>
        )}
        {createFileError && (
          <p className="indicator alarm" role="alert">
            <span className="lamp lamp-alarm" aria-hidden="true" />
            {createFileError}
          </p>
        )}
      </div>

      {/* ---- Таблиця замін --------------------------------------------------------------- */}
      <fieldset className="rule-group">
        <legend className="field-label">Таблиця замін — що → на що</legend>
        <div className="rule-array clone-sub-rows">
          {/* Рев'ю фікс-раунду 1, MINOR 2: aria-label кожного поля несе номер рядка (1-based,
              той самий патерн, що StringListEditor у ui/RulePanel.tsx: `${ariaLabel} ${i+1}`)
              -- раніше label повторювався ДОСЛІВНО на КОЖНОМУ рядку, і прямий
              document.querySelector('[aria-label="..."]') завжди знаходив би ПЕРШИЙ рядок
              незалежно від того, який мався на увазі. Індексація не змінює видиму розмітку
              (номер лише в атрибуті), тож не потребує окремого CSS. */}
          {rows.map((row, i) => (
            <div className="rule-row-card clone-sub-row" key={row.key}>
              <div className="clone-kind-toggle" role="group" aria-label={`Тип рядка заміни (рядок ${i + 1})`}>
                <button type="button" aria-pressed={row.kind === 'class'} onClick={() => setRowKind(row.key, 'class')}>
                  класнейм
                </button>
                <button type="button" aria-pressed={row.kind === 'faction'} onClick={() => setRowKind(row.key, 'faction')}>
                  фракція
                </button>
              </div>
              <div className="clone-sub-fields">
                {row.kind === 'class' ? (
                  <>
                    <ZpSelect
                      value={row.from}
                      onChange={(v) => setRowFrom(row.key, v)}
                      optionsSource={classOptionsSource}
                      allowFree
                      placeholder="що…"
                      aria-label={`Замінити класнейм (рядок ${i + 1})`}
                    />
                    <span className="clone-sub-arrow" aria-hidden="true">
                      →
                    </span>
                    <ZpSelect
                      value={row.to}
                      onChange={(v) => setRowTo(row.key, v)}
                      optionsSource={classOptionsSource}
                      allowFree
                      placeholder="на що…"
                      aria-label={`На який класнейм замінити (рядок ${i + 1})`}
                    />
                  </>
                ) : (
                  <>
                    <ZpSelect
                      value={row.from}
                      onChange={(v) => setRowFrom(row.key, v)}
                      options={factionOptions}
                      placeholder="яку фракцію…"
                      aria-label={`Замінити фракцію (рядок ${i + 1})`}
                    />
                    <span className="clone-sub-arrow" aria-hidden="true">
                      →
                    </span>
                    <ZpSelect
                      value={row.to}
                      onChange={(v) => setRowTo(row.key, v)}
                      options={factionOptions}
                      placeholder="на яку фракцію…"
                      aria-label={`На яку фракцію замінити (рядок ${i + 1})`}
                    />
                  </>
                )}
              </div>
              <button type="button" className="rule-array-remove" onClick={() => removeRow(row.key)} aria-label={`Прибрати рядок заміни (рядок ${i + 1})`}>
                × Прибрати
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="rule-array-add" onClick={addRow}>
          + Додати рядок
        </button>
      </fieldset>

      {/* ---- Прев'ю ------------------------------------------------------------------------ */}
      {!targetFile ? (
        <p className="hint">Спершу оберіть (чи створіть) файл для клонів — прев'ю з'явиться тут.</p>
      ) : !preview ? null : !preview.ok ? (
        <p className="indicator alarm" role="alert">
          <span className="lamp lamp-alarm" aria-hidden="true" />
          {preview.error}
        </p>
      ) : (
        <fieldset className="rule-group clone-preview">
          <legend className="field-label">Прев'ю — буде створено {pluralizeClonedRules(preview.created.length)}</legend>
          <ul className="clone-preview-list">
            {preview.created.map((c, i) => (
              <li className="clone-preview-row" key={`${c.sourceFilePath}::${c.sourceRuleId}#${i}`}>
                <code className="clone-preview-old">{c.sourceRuleId}</code>
                <span className="clone-sub-arrow" aria-hidden="true">
                  →
                </span>
                <input
                  className="field-input field-input-mono clone-preview-id"
                  value={idOverrides[i] ?? ''}
                  placeholder={c.newId}
                  onChange={(e) => setOverride(i, e.target.value)}
                  aria-label={`Новий Id для клону правила ${c.sourceRuleId}`}
                />
                <span className="clone-preview-touched">
                  {c.touchedFields.length > 0 ? c.touchedFields.join(', ') : 'без змін (таблиця не зачепила це правило)'}
                </span>
              </li>
            ))}
          </ul>
          <button type="button" className="primary" disabled={preview.created.length === 0} onClick={doApply}>
            Застосувати
          </button>
        </fieldset>
      )}
    </section>
  )
}
