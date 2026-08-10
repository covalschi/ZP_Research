// SettingsView — вкладка «Налаштування» (W4 Task 4): форма всіх полів ZP_SettingsConfig
// (Settings.json). Порядок полів у формі — ТОЧНО порядок SETTINGS_SCHEMA (schema.ts, він же
// порядок оголошення Enforce-класу): ConfigVersion, DebugMode, AdminIds, DefaultFaction,
// TreeTerminalClasses, TreeVisibilityDepth, TreeBackgroundImage.
//
// Ключові рішення:
//   - ВСІ поля — типізовані компоненти (мінор ревью T1: applySettingsEdit типи не захищає,
//     тож кривий тип не повинен мати шляху в updater): чекбокс -> boolean, IntField ->
//     number, текстові/списки -> string/string[]. Читання — readSettingsValues
//     (ui/settingsFields.ts, типізована половина тієї самої страховки);
//   - ConfigVersion показується, але НЕ редагується: це версія міграцій формату, а не
//     налаштування адміна — рукописна зміна зламала б майбутні міграції;
//   - DefaultFaction — ZpSelect по фракціях проєкту (collectFactionOptions, RulePanel) з
//     allowFree: 'default' — легальний віртуальний fallback, який НЕ мусить бути оголошений
//     у Factions.json;
//   - TreeTerminalClasses — StringListEditor поверх ZpSelect по індексу класів (залізне
//     правило) + itemErrors (порожній рядок — серверний warn :53-57, клас поза індексом —
//     додаток редактора, settingsProblems);
//   - AdminIds — НЕ ZpSelect свідомо: Steam64 не є посиланням на сутність проєкту чи
//     індексу (реєстру гравців у редактора немає) — прості моноширинні поля з warn-дзеркалом
//     «не схоже на Steam64» біля кожного рядка;
//   - warn-only: сервер НІКОЛИ не відхиляє Settings.json (Validate :63-67 завжди true) —
//     жодне попередження тут не блокує збереження;
//   - відсутній Settings.json — підказка без створення з нуля (прецедент PointTypesView;
//     сервер сам створює і перезаписує файл на КОЖНОМУ буті — load-then-save,
//     ZP_ConfigService.c:186-197).

import { useEffect, useMemo, useState } from 'react'
import type { Project } from '../io/project'
import type { ClassIndex } from '../model/classIndex'
import { searchClasses } from '../model/classIndex'
import { fieldErrors } from '../model/ruleValidation'
import { applySettingsEdit } from '../io/settingsEdit'
import type { SettingsFileDoc } from '../io/settingsEdit'
import { readSettingsValues, settingsProblems } from './settingsFields'
import { FieldMessages, IntField, CheckboxField, StringListEditor, collectFactionOptions } from './RulePanel'
import { ZpSelect } from './ZpSelect'
import type { ZpOption } from './ZpSelect'

// Список ПРОСТИХ текстових рядків (AdminIds). StringListEditor тут не годиться: він
// побудований поверх ZpSelect (живий пошук по джерелу опцій), а Steam64 не є посиланням на
// жодну сутність проєкту чи індексу — «живий пошук по нічому» був би карго-культом залізного
// правила, яке стосується САМЕ полів-посилань. Прості моноширинні інпути + пер-рядкові
// повідомлення дзеркала (той самий контракт itemErrors, що в StringListEditor).
function TextListEditor({
  idPrefix,
  items,
  onAdd,
  onRemove,
  onChangeItem,
  ariaLabel,
  itemErrors,
}: {
  idPrefix: string
  items: string[]
  onAdd: () => void
  onRemove: (i: number) => void
  onChangeItem: (i: number, value: string) => void
  ariaLabel: string
  itemErrors: (i: number) => ReturnType<typeof fieldErrors>
}) {
  return (
    <div className="rule-array">
      {items.map((v, i) => (
        <div className="rule-array-item" key={i}>
          <div className="rule-array-row">
            <input
              id={`${idPrefix}-${i}`}
              className="field-input field-input-mono"
              type="text"
              value={v}
              onChange={(e) => onChangeItem(i, e.target.value)}
              aria-label={`${ariaLabel} ${i + 1}`}
            />
            <button type="button" className="rule-array-remove" onClick={() => onRemove(i)} aria-label={`Прибрати ${ariaLabel} ${i + 1}`}>
              ×
            </button>
          </div>
          <FieldMessages errors={itemErrors(i)} />
        </div>
      ))}
      <button type="button" className="rule-array-add" onClick={onAdd}>
        + Додати
      </button>
    </div>
  )
}

// Буферизоване текстове поле «коміт на blur» — той самий НАВМИСНИЙ невеликий дублікат
// приватного BufferedTextField із FactionsView/PointTypesView (задокументований компроміс
// T9): шлях картинки правлять цілим рядком, покомітний ввід смикав би конфіг на кожен натиск.
function BufferedTextField({ id, label, value, onCommit, hint }: { id: string; label: string; value: string; onCommit: (v: string) => void; hint?: string }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(() => value)
  useEffect(() => {
    if (!editing) setText(value)
  }, [value, editing])
  return (
    <div className="rule-field">
      <label className="field-label" htmlFor={id} title={hint}>
        {label}
      </label>
      <input
        id={id}
        className="field-input field-input-mono"
        type="text"
        value={text}
        onFocus={() => setEditing(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setEditing(false)
          if (text !== value) onCommit(text)
        }}
      />
    </div>
  )
}

export interface SettingsViewProps {
  project: Project
  index: ClassIndex
  onProjectChange: (next: Project) => void
}

export function SettingsView({ project, index, onProjectChange }: SettingsViewProps) {
  const settingsFile = project.files.find((f) => f.kind === 'settings')
  const doc = settingsFile?.parsed
  const values = useMemo(() => readSettingsValues(doc), [doc])
  const problems = useMemo(() => settingsProblems(doc, index), [doc, index])
  const factionOptions = useMemo(() => collectFactionOptions(project), [project])
  // ОДНА стабільна функція на index для ZpSelect-полів класів (застереження брифа W2).
  const classOptionsSource = useMemo(
    () =>
      (query: string, limit: number): ZpOption[] =>
        searchClasses(index, query, limit).map((hit) => ({ id: hit.name, label: hit.name, hint: hit.mod })),
    [index],
  )
  const [commitError, setCommitError] = useState<string | null>(null)

  if (!settingsFile) {
    return (
      <p className="indicator" role="status">
        <span className="lamp lamp-warn" aria-hidden="true" />У проєкті немає Settings.json — відкрийте теку чи ZIP із ним. Сервер створює і перезаписує
        цей файл сам на кожному буті (load-then-save, ZP_ConfigService.c:186-197), редактор його
        з нуля не вигадує.
      </p>
    )
  }

  function commit(updater: (s: SettingsFileDoc) => void) {
    const result = applySettingsEdit(project, updater)
    if (result.ok) {
      setCommitError(null)
      onProjectChange(result.project)
    } else {
      setCommitError(result.error)
    }
  }

  const adminIdHandlers = {
    onAdd: () =>
      commit((s) => {
        ;(s.AdminIds as string[]).push('')
      }),
    onRemove: (i: number) =>
      commit((s) => {
        ;(s.AdminIds as string[]).splice(i, 1)
      }),
    onChangeItem: (i: number, v: string) =>
      commit((s) => {
        ;(s.AdminIds as string[])[i] = v
      }),
  }

  const terminalHandlers = {
    onAdd: () =>
      commit((s) => {
        ;(s.TreeTerminalClasses as string[]).push('')
      }),
    onRemove: (i: number) =>
      commit((s) => {
        ;(s.TreeTerminalClasses as string[]).splice(i, 1)
      }),
    onChangeItem: (i: number, v: string) =>
      commit((s) => {
        ;(s.TreeTerminalClasses as string[])[i] = v
      }),
  }

  return (
    <div className="entity-workspace">
      <section className="sheet entity-list settings-sheet">
        <span className="sheet-title label">Налаштування (Settings.json)</span>
        <p className="hint">
          Наживо сервер міняє лише три ключі: <code>!zp set debug|treedepth|treeterminal</code>{' '}
          (op SET_SETTING, OpSetSetting, ZP_ConfigService.c:750-832). Решта полів (AdminIds,
          DefaultFaction, TreeBackgroundImage) редагується тільки файлом: занесіть Settings.json
          у профіль сервера і виконайте <code>!zp reload</code> (перечитує всі вісім конфігів
          атомарно) або дочекайтесь рестарту. Сервер НІКОЛИ не відхиляє цей файл — усі
          зауваження нижче попереджувальні (Validate, ZP_SettingsConfig.c:42-68).
        </p>

        {commitError && (
          <p className="indicator alarm" role="alert">
            <span className="lamp lamp-alarm" aria-hidden="true" />
            {commitError}
          </p>
        )}

        <fieldset className="rule-form">
          <p className="field-readonly" title="Версія формату для міграцій — підіймає сам мод, не адмін">
            Версія конфігу (ConfigVersion): <code>{values.configVersion}</code>
          </p>

          <CheckboxField
            id="set-debug"
            label="Докладний лог (DebugMode)"
            checked={values.debugMode}
            onCommit={(v) => commit((s) => (s.DebugMode = v))}
            title="Рівень Dbg у server-лозі; наживо: !zp set debug on|off"
          />

          <div className="rule-field">
            <span className="field-label" title="Steam64 адмінів моду — резервний список поверх VPP-прав">
              Адміни (AdminIds)
            </span>
            <TextListEditor idPrefix="set-adminid" items={values.adminIds} {...adminIdHandlers} ariaLabel="Steam64 адміна" itemErrors={(i) => fieldErrors(problems, `AdminIds[${i}]`)} />
            <p className="hint">
              Steam64 адмінів — чутливі дані: <code>Settings.json</code> свідомо виключено з git
              цього репозиторію (.gitignore) і його НЕ можна класти в публічні архіви, фікстури
              чи скріншоти — для прикладів існує плейсхолдер <code>76561190000000000</code>.
            </p>
          </div>

          <div className="rule-field">
            <label className="field-label" htmlFor="set-defaultfaction" title="Фракція гравця без нашивки. 'default' — легальний віртуальний fallback, який не мусить бути оголошений у Factions.json">
              Фракція за замовчуванням (DefaultFaction)
            </label>
            <ZpSelect id="set-defaultfaction" value={values.defaultFaction} onChange={(v) => commit((s) => (s.DefaultFaction = v))} options={factionOptions} allowFree aria-label="Фракція за замовчуванням" />
            <FieldMessages errors={fieldErrors(problems, 'DefaultFaction')} />
          </div>

          <div className="rule-field">
            <span className="field-label" title="Спільні термінали дерева. Діють, ПОКИ жодна фракція не оголосила власних TerminalClasses (правило ізоляції: нема своїх — нема ніяких). Наживо: !zp set treeterminal <класи через кому>">
              Термінали дерева (TreeTerminalClasses)
            </span>
            <StringListEditor
              items={values.treeTerminalClasses}
              {...terminalHandlers}
              optionsSource={classOptionsSource}
              allowFree
              ariaLabel="Термінал дерева"
              itemErrors={(i) => fieldErrors(problems, `TreeTerminalClasses[${i}]`)}
            />
            <FieldMessages errors={fieldErrors(problems, 'TreeTerminalClasses')} />
          </div>

          <div>
            <IntField id="set-treedepth" label="Глибина видимості дерева (TreeVisibilityDepth)" value={values.treeVisibilityDepth} onCommit={(v) => commit((s) => (s.TreeVisibilityDepth = v))} />
            <p className="hint">
              Скільки ярусів попереду бачить гравець. Сервер очікує ціле [0..10] (Validate
              :59-60); наживо: <code>!zp set treedepth N</code>.
            </p>
            <FieldMessages errors={fieldErrors(problems, 'TreeVisibilityDepth')} />
          </div>

          <BufferedTextField
            id="set-treebg"
            label="Фонова картинка дерева (TreeBackgroundImage)"
            value={values.treeBackgroundImage}
            onCommit={(v) => commit((s) => (s.TreeBackgroundImage = v))}
            hint="Шлях до .edds відносно кореня даних гри (порожньо — без фону). Сервер шлях не перевіряє"
          />
        </fieldset>
      </section>
    </div>
  )
}
