// Панель вузла дерева технологій (W3 Task 3) — відкривається кліком по картці на полотні
// (ui/TreeCanvas.tsx тримає вибір і рендерить панель поруч із полотном). ВСІ поля
// ZP_TreeNode; машинерія полів — ТА САМА, що у формі правила (спільні експорти
// ui/RulePanel.tsx: TextField/IntField/FieldMessages/StringListEditor — жодної другої
// копії). ЗАЛІЗНЕ правило живого пошуку: кожне поле-посилання — ZpSelect:
//   Cost[].Type          — типи балів проєкту (collectPointTypeOptions, PointTypes.json);
//   ItemCost[].Classname — індекс класів (searchClasses) + лице предмета поруч;
//   ItemCost[].Content   — ТА САМА машинерія Content-опцій, що у правилах
//                          (collectContentOptions: вироблювані потоки першими);
//   RequiredFactions[]   — фракції проєкту (collectFactionOptions);
//   Parents[]            — вузли дерева (collectNodeOptions) — дублює мишу для точності.
//
// Правки: прості поля — applyNodeEdit; УСЕ, що впливає на зв'язність (Parents/ParentsMode/
// Id), — гвардовані мутатори io/nodeEdit.ts (дзеркало серверного OpUpsertNode: нові
// недосяжні вузли = відмова з UA-причиною; помилка показується індикатором, значення не
// пишеться). Числових float-полів у ZP_TreeNode НЕМАЄ (Tier/Amount/Quantity/
// ResearchTimeSec — усі int, schema.ts) — fround-канонізація не застосовна, цілі йдуть
// через IntField (буфер-коміт на blur, той самий патерн).
//
// Дубль Id вузла у файлі: рішення хвоста ревью T2 — мутатор ЛИШАЄ відмову за (file, Id)
// (адресацію порядковим входженням СВІДОМО не робимо), панель показує UA-підказку
// «спочатку приберіть дубль Id» і форму лише для перегляду — той самий патерн, що форма
// правила при дублі (RuleForm/duplicate): обидва близнюки й так горять alarm на полотні,
// а правка «першого-ліпшого» правила б не той вузол, який адмін бачив.

import { useEffect, useMemo, useState } from 'react'
import type { Project } from '../io/project'
import {
  applyNodeEdit,
  addNodeParent,
  removeNodeParent,
  replaceNodeParent,
  setNodeParentsMode,
  renameTreeNode,
  deleteTreeNode,
} from '../io/nodeEdit'
import type { ApplyNodeEditResult } from '../io/nodeEdit'
import type { ClassIndex } from '../model/classIndex'
import { searchClasses } from '../model/classIndex'
import type { TreeViewResult, TreeNodeView } from '../model/treeView'
import { fieldErrors } from '../model/ruleValidation'
import {
  FieldMessages,
  TextField,
  IntField,
  StringListEditor,
  collectContentOptions,
  collectNodeOptions,
  collectFactionOptions,
} from './RulePanel'
import { ZpSelect } from './ZpSelect'
import type { ZpOption } from './ZpSelect'
import { collectPointTypeOptions } from './optionCollectors'

// ---- Чисті хелпери (експортовані, tests/treeNodePanel.test.ts) -----------------------------

// collectPointTypeOptions переїхав у ui/optionCollectors.ts (W4 Task 1): тут була одна з
// ДВОХ копій (друга — DataItemQuickEdit.tsx, БЕЗ дедупу — дрейф, зафіксований планом W4);
// канонічною стала саме ця поведінка (дедуп «перший виграє», дзеркало
// ZP_PointTypesConfig.Find :317-325).

// Пошук вузла в Project за складеним ключем (file, Id) — дзеркало findRuleMatches
// (RulePanel.tsx). Порівняння регістрозалежне (FindNode, ZP_TechTree.c:69-77).
export function findNodeMatches(project: Project, filePath: string, nodeId: string): Record<string, unknown>[] {
  const file = project.files.find((f) => f.path === filePath)
  if (!file || file.kind !== 'techTree') return []
  const doc = file.parsed as { Nodes?: unknown[] } | undefined
  if (!doc || !Array.isArray(doc.Nodes)) return []
  return doc.Nodes.filter(
    (n): n is Record<string, unknown> => !!n && typeof n === 'object' && (n as Record<string, unknown>).Id === nodeId,
  )
}

// ---- Структурна форма ZP_TreeNode для панелі (усі поля TREE_NODE_SCHEMA) -------------------

interface TreeCostRecord {
  Type: string
  Amount: number
}

interface TreeItemCostRecord {
  Classname: string
  Quantity: number
  Content: string
}

interface TreeNodeRecord {
  Id: string
  Name: string
  Description: string
  Icon: string
  Tier: number
  Parents: string[]
  ParentsMode: string
  Cost: TreeCostRecord[]
  ItemCost: TreeItemCostRecord[]
  ResearchTimeSec: number
  RequiredFactions: string[]
}

// ---- Id-поле з буфером (blur-коміт) --------------------------------------------------------
// СВІДОМА відмінність від RuleForm (там Id комітиться на кожен натиск): перейменування
// вузла гвардоване (дубль Id + недосяжність нащадків, io/nodeEdit.renameTreeNode), і
// покомітний ввід застрягав би на першому ж проміжному стані, який гвард відхиляє.
// Буфер — той самий патерн editing/text, що FloatField/IntField.

function IdField({ id, value, onCommit }: { id: string; value: string; onCommit: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(value)
  useEffect(() => {
    if (!editing) setText(value)
  }, [value, editing])
  return (
    <div className="rule-field">
      <label className="field-label" htmlFor={id}>
        Код (Id)
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
          if (text.trim() !== value) onCommit(text)
        }}
      />
    </div>
  )
}

// ---- Пропси й головний компонент -----------------------------------------------------------

export interface TreeNodePanelProps {
  project: Project
  index: ClassIndex
  view: TreeViewResult
  filePath: string
  nodeId: string
  onProjectChange: (next: Project) => void
  // Перейменування Id: вибір на полотні мусить піти за новим ключем (той самий контракт,
  // що onRuleIdChange у RuleForm).
  onNodeIdChange: (newId: string) => void
  // Вузол видалено — викликач знімає вибір і закриває панель.
  onDeleted: () => void
  onClose: () => void
}

export function TreeNodePanel({ project, index, view, filePath, nodeId, onProjectChange, onNodeIdChange, onDeleted, onClose }: TreeNodePanelProps) {
  const [error, setError] = useState<string | null>(null)
  const [armedDelete, setArmedDelete] = useState(false)
  // Лічильник-ключ ZpSelect «додати батька»: після успішного додавання селект
  // перемонтовується з чистим полем (той самий прийом, що chipsEpoch у StationWindow).
  const [parentEpoch, setParentEpoch] = useState(0)

  // Взведене видалення саморозряджається (4 с) — паттерн проєкту (StationWindow/вкладка VPP).
  useEffect(() => {
    if (!armedDelete) return
    const t = setTimeout(() => setArmedDelete(false), 4000)
    return () => clearTimeout(t)
  }, [armedDelete])

  const classOptionsSource = useMemo(
    () =>
      (query: string, limit: number): ZpOption[] =>
        searchClasses(index, query, limit).map((hit) => ({ id: hit.name, label: hit.name, hint: hit.mod })),
    [index],
  )
  const pointTypeOptions = useMemo(() => collectPointTypeOptions(project), [project])
  const contentOptions = useMemo(() => collectContentOptions(project, index), [project, index])
  const factionOptions = useMemo(() => collectFactionOptions(project), [project])
  // Опції батьків: усі вузли проєкту (кросгілкові батьки легальні) МІНУС сам вузол —
  // мутатор однаково відмовив би самопосиланню, але порожня опція чесніша за помилку.
  // БЕЗ allowFree: батько-«ще не існує» завжди відхиляється гвардом недосяжності
  // (неіснуючий батько = недосяжний нащадок), тож вільний ввід тут — гарантована помилка.
  const parentOptions = useMemo(() => collectNodeOptions(project).filter((o) => o.id !== nodeId), [project, nodeId])

  const matches = findNodeMatches(project, filePath, nodeId)
  const viewNode: TreeNodeView | undefined = view.nodes.find((n) => n.filePath === filePath && n.id === nodeId)

  if (matches.length === 0) {
    return (
      <aside className="sheet tree-node-panel">
        <div className="sheet-title-row">
          <span className="sheet-title label">Вузол дерева</span>
          <button type="button" className="quick-edit-close" onClick={onClose} aria-label="Закрити панель вузла">
            ×
          </button>
        </div>
        <p className="indicator" role="status">
          <span className="lamp lamp-warn" aria-hidden="true" />
          Вузол «{nodeId}» не знайдено у {filePath} — можливо, видалено.
        </p>
      </aside>
    )
  }

  const duplicate = matches.length > 1
  const node = matches[0] as unknown as TreeNodeRecord
  const problems = !duplicate && viewNode ? viewNode.problems : []

  function commit(updater: (n: Record<string, unknown>) => void) {
    const result = applyNodeEdit(project, filePath, nodeId, updater)
    applyResult(result)
  }

  function applyResult(result: ApplyNodeEditResult) {
    if (result.ok) {
      setError(null)
      onProjectChange(result.project)
    } else {
      setError(result.error)
    }
  }

  function commitId(newId: string) {
    const result = renameTreeNode(project, index, filePath, nodeId, newId)
    if (result.ok) {
      setError(null)
      onProjectChange(result.project)
      onNodeIdChange(newId.trim())
    } else {
      setError(result.error)
    }
  }

  function doDelete() {
    if (!armedDelete) {
      setArmedDelete(true)
      return
    }
    setArmedDelete(false)
    const result = deleteTreeNode(project, filePath, nodeId)
    if (result.ok) {
      setError(null)
      onProjectChange(result.project)
      onDeleted()
    } else {
      setError(result.error)
    }
  }

  const pm = node.ParentsMode.toLowerCase() === 'any' ? 'any' : 'all'

  return (
    <aside className="sheet tree-node-panel">
      <div className="sheet-title-row">
        <span className="sheet-title label">Вузол дерева</span>
        <button type="button" className="quick-edit-close" onClick={onClose} aria-label="Закрити панель вузла">
          ×
        </button>
      </div>

      <div className="tree-node-panel-head">
        <span className={`lamp lamp-${viewNode && viewNode.status === 'alarm' ? 'alarm' : 'ok'}`} aria-hidden="true" />
        <h2 className="tree-node-panel-name">{node.Name !== '' ? node.Name : node.Id}</h2>
        <code className="tree-node-panel-file">{filePath}</code>
      </div>

      {duplicate && (
        <p className="indicator alarm" role="alert">
          <span className="lamp lamp-alarm" aria-hidden="true" />
          Дубль Id «{nodeId}» у файлі {filePath} — спочатку приберіть дубль Id (форма нижче лише для перегляду; обидва
          близнюки горять на полотні, а перезавантаження дерева на сервері відхиляється цілком).
        </p>
      )}

      {error && (
        <p className="indicator alarm" role="alert">
          <span className="lamp lamp-alarm" aria-hidden="true" />
          {error}
        </p>
      )}

      {problems.length > 0 && (
        <ul className="tree-node-panel-problems">
          {problems.map((p, i) => (
            <li key={i}>
              <span className={`lamp lamp-${p.severity}`} aria-hidden="true" />
              {p.message}
            </li>
          ))}
        </ul>
      )}

      <fieldset className="rule-form" disabled={duplicate}>
        <IdField id="tnp-id" value={node.Id} onCommit={commitId} />
        <TextField id="tnp-name" label="Назва (Name)" value={node.Name} onCommit={(v) => commit((n) => (n.Name = v))} />
        <FieldMessages errors={fieldErrors(problems, 'Name')} />

        <div className="rule-field">
          <label className="field-label" htmlFor="tnp-description">
            Опис (Description)
          </label>
          <textarea
            id="tnp-description"
            className="field-textarea"
            value={node.Description}
            onChange={(e) => commit((n) => (n.Description = e.target.value))}
            rows={3}
          />
        </div>

        <TextField id="tnp-icon" label="Іконка (Icon)" value={node.Icon} onCommit={(v) => commit((n) => (n.Icon = v))} mono />

        <IntField id="tnp-tier" label="Тір (Tier)" value={node.Tier} onCommit={(v) => commit((n) => (n.Tier = v))} />

        <fieldset className="rule-group">
          <legend className="field-label">Батьки (Parents)</legend>
          {node.Parents.map((p, i) => (
            <div className="rule-array-row" key={`${i}-${p}`}>
              <ZpSelect
                id={`tnp-parent-${i}`}
                value={p}
                onChange={(v) => applyResult(replaceNodeParent(project, index, filePath, nodeId, i, v))}
                options={parentOptions}
                aria-label={`Батько ${i + 1}`}
              />
              <button
                type="button"
                className="rule-array-remove"
                onClick={() => applyResult(removeNodeParent(project, index, filePath, nodeId, p))}
                aria-label={`Прибрати батька ${i + 1}`}
              >
                ×
              </button>
            </div>
          ))}
          <div className="rule-field">
            <label className="field-label" htmlFor="tnp-parent-add">
              Додати батька (дублює з'єднання мишею)
            </label>
            <ZpSelect
              id="tnp-parent-add"
              key={`parent-add-${parentEpoch}`}
              value=""
              onChange={(v) => {
                const result = addNodeParent(project, index, filePath, nodeId, v)
                applyResult(result)
                if (result.ok) setParentEpoch((e) => e + 1)
              }}
              options={parentOptions}
              placeholder={parentOptions.length === 0 ? 'інших вузлів ще немає' : 'оберіть вузол…'}
              aria-label="Додати батька"
            />
          </div>

          {/* ParentsMode — enum із двох значень, НЕ посилання на сутність (залізне правило
              живого пошуку тут не застосовне): пара радіо, з поясненням семантики гейта. */}
          <div className="rule-field">
            <span className="field-label">Режим батьків (ParentsMode)</span>
            <div className="tree-parents-mode" role="radiogroup" aria-label="Режим батьків">
              <label className="rule-checkbox" htmlFor="tnp-pm-all">
                <input
                  id="tnp-pm-all"
                  type="radio"
                  name="tnp-parents-mode"
                  checked={pm === 'all'}
                  onChange={() => applyResult(setNodeParentsMode(project, index, filePath, nodeId, 'all'))}
                />
                all — потрібні ВСІ батьки
              </label>
              <label className="rule-checkbox" htmlFor="tnp-pm-any">
                <input
                  id="tnp-pm-any"
                  type="radio"
                  name="tnp-parents-mode"
                  checked={pm === 'any'}
                  onChange={() => applyResult(setNodeParentsMode(project, index, filePath, nodeId, 'any'))}
                />
                any — досить БУДЬ-ЯКОГО
              </label>
            </div>
            <FieldMessages errors={fieldErrors(problems, 'ParentsMode')} />
          </div>
        </fieldset>

        <fieldset className="rule-group">
          <legend className="field-label">Вартість у балах (Cost)</legend>
          {node.Cost.map((c, i) => (
            <div className="rule-row-card" key={i}>
              <div className="rule-field">
                <label className="field-label" htmlFor={`tnp-cost-type-${i}`}>
                  Тип балів
                </label>
                <ZpSelect
                  id={`tnp-cost-type-${i}`}
                  value={c.Type}
                  onChange={(v) => commit((n) => ((n.Cost as Record<string, unknown>[])[i].Type = v))}
                  options={pointTypeOptions}
                  aria-label={`Вартість ${i + 1}: тип балів`}
                />
                <FieldMessages errors={fieldErrors(problems, `Cost[${i}].Type`)} />
              </div>
              <IntField
                id={`tnp-cost-amount-${i}`}
                label="Кількість балів"
                value={c.Amount}
                min={0}
                onCommit={(v) => commit((n) => ((n.Cost as Record<string, unknown>[])[i].Amount = v))}
              />
              <FieldMessages errors={fieldErrors(problems, `Cost[${i}].Amount`)} />
              <button
                type="button"
                className="rule-array-remove"
                onClick={() => commit((n) => (n.Cost as unknown[]).splice(i, 1))}
                aria-label={`Прибрати вартість ${i + 1}`}
              >
                × Прибрати
              </button>
            </div>
          ))}
          <button type="button" className="rule-array-add" onClick={() => commit((n) => (n.Cost as unknown[]).push({ Type: '', Amount: 0 }))}>
            + Додати вартість
          </button>
        </fieldset>

        <fieldset className="rule-group">
          <legend className="field-label">Вартість предметами (ItemCost)</legend>
          {node.ItemCost.map((ic, i) => {
            const face = viewNode?.itemCost[i]
            return (
              <div className="rule-row-card" key={i}>
                <div className="rule-field">
                  <label className="field-label" htmlFor={`tnp-ic-cls-${i}`}>
                    Класнейм
                  </label>
                  <ZpSelect
                    id={`tnp-ic-cls-${i}`}
                    value={ic.Classname}
                    onChange={(v) => commit((n) => ((n.ItemCost as Record<string, unknown>[])[i].Classname = v))}
                    optionsSource={classOptionsSource}
                    allowFree
                    aria-label={`Предмет ${i + 1}: класнейм`}
                  />
                  {face && face.display !== ic.Classname && <p className="hint">{face.display}</p>}
                  <FieldMessages errors={fieldErrors(problems, `ItemCost[${i}].Classname`)} />
                </div>
                <IntField
                  id={`tnp-ic-qty-${i}`}
                  label="Кількість"
                  value={ic.Quantity}
                  min={1}
                  onCommit={(v) => commit((n) => ((n.ItemCost as Record<string, unknown>[])[i].Quantity = v))}
                />
                <FieldMessages errors={fieldErrors(problems, `ItemCost[${i}].Quantity`)} />
                <div className="rule-field">
                  <label className="field-label" htmlFor={`tnp-ic-content-${i}`} title="Має сенс лише коли класнейм — зразок родини ZP_Sample_Base">
                    Вміст зразка (Content)
                  </label>
                  <ZpSelect
                    id={`tnp-ic-content-${i}`}
                    value={ic.Content}
                    onChange={(v) => commit((n) => ((n.ItemCost as Record<string, unknown>[])[i].Content = v))}
                    options={contentOptions}
                    allowFree
                    aria-label={`Предмет ${i + 1}: вміст зразка`}
                  />
                  <FieldMessages errors={fieldErrors(problems, `ItemCost[${i}].Content`)} />
                </div>
                <button
                  type="button"
                  className="rule-array-remove"
                  onClick={() => commit((n) => (n.ItemCost as unknown[]).splice(i, 1))}
                  aria-label={`Прибрати предмет ${i + 1}`}
                >
                  × Прибрати
                </button>
              </div>
            )
          })}
          <button
            type="button"
            className="rule-array-add"
            onClick={() => commit((n) => (n.ItemCost as unknown[]).push({ Classname: '', Quantity: 1, Content: '' }))}
          >
            + Додати предмет
          </button>
        </fieldset>

        <IntField
          id="tnp-research-time"
          label="Тривалість дослідження, с (ResearchTimeSec)"
          value={node.ResearchTimeSec}
          min={0}
          onCommit={(v) => commit((n) => (n.ResearchTimeSec = v))}
        />
        <FieldMessages errors={fieldErrors(problems, 'ResearchTimeSec')} />

        <div className="rule-field">
          <span className="field-label">Потрібні фракції (RequiredFactions)</span>
          <StringListEditor
            items={node.RequiredFactions}
            onAdd={() => commit((n) => (n.RequiredFactions as string[]).push(''))}
            onRemove={(i) => commit((n) => (n.RequiredFactions as string[]).splice(i, 1))}
            onChangeItem={(i, v) => commit((n) => ((n.RequiredFactions as string[])[i] = v))}
            options={factionOptions}
            ariaLabel="Потрібна фракція"
          />
        </div>

        <button type="button" className={`rule-array-remove tree-node-delete${armedDelete ? ' armed' : ''}`} onClick={doDelete}>
          {armedDelete ? 'Точно видалити вузол? (натисніть ще раз)' : '× Видалити вузол'}
        </button>
      </fieldset>
    </aside>
  )
}
