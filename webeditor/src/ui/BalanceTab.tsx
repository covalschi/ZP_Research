// BalanceTab — вкладка «Баланс» (W4 Task 5): READ-ONLY аналітика економіки мода. Жодного
// мутатора: числа правляться у своїх панелях («Заготовки», «Бали», «Дерево», вікно станка),
// а дубль-редактор тут був би дрейфом двох копій (Self-review плану W4).
//
// Назва файлу — BalanceTab, а модель — balanceView.ts: пара balanceView.ts/BalanceView.tsx на
// Windows дала б TS1261 (кейс-інсенситивна колізія імен, та сама пастка, що вже змусила
// назвати модель полотна дерева treeLayout.ts).
//
// Уся логіка — в чистій ui/balanceView.ts (TDD); тут ЛИШЕ рендер і колбеки переходів на інші
// вкладки (прецедент onOpenPointTypes аварійної панелі, W4 Task 2).

import { useMemo } from 'react'
import type { Project } from '../io/project'
import type { ClassIndex } from '../model/classIndex'
import { buildBalanceView } from './balanceView'
import type { BalanceCostRow, BalanceFactionRow, BalanceYieldPath } from './balanceView'

export interface BalanceTabProps {
  project: Project
  index: ClassIndex
  // Перехід на вкладку «Заготовки» з відкритим записом
  onOpenDataItem: (classname: string) => void
  // Перехід на вкладку «Бали» з вибраним типом у матриці
  onOpenPointType: (id: string) => void
  // Перехід на вкладку «Дерево»: гілка (filePath) і, за наявності, центрування вузла
  onOpenTree: (filePath: string, nodeId: string) => void
  // Перехід на вкладку «Ланцюги» з відкритим вікном станка
  onOpenStation: (classname: string) => void
}

function ColorChip({ color }: { color: string }) {
  return <span className="pt-color-chip" style={color !== '' ? { background: color } : undefined} aria-hidden="true" />
}

function Lamp({ tone, title }: { tone: 'ok' | 'warn' | 'alarm'; title?: string }) {
  return <span className={`lamp lamp-${tone}`} aria-hidden="true" title={title} />
}

// Один шлях видобутку: заготовка ×N, правило на приладі. Гейти показані бейджами — саме вони
// перетворюють «ok» на «умовно» (RequiredNode / чужий пакувальник зразка).
function YieldPathLine({ path, onOpenDataItem, onOpenStation }: { path: BalanceYieldPath; onOpenDataItem: (c: string) => void; onOpenStation: (c: string) => void }) {
  return (
    <li className="bal-path">
      <button type="button" className="row-select bal-jump-item" onClick={() => onOpenDataItem(path.dataItem)} title={`Відкрити заготовку ${path.dataItem}`}>
        <code>{path.dataItem}</code>
      </button>
      <span className="bal-amount">×{path.amount}</span>
      <span className="bal-sep">·</span>
      <button type="button" className="row-select bal-jump-station" onClick={() => onOpenStation(path.device)} title={`Відкрити вікно станка ${path.device}`}>
        {path.deviceDisplay !== '' ? path.deviceDisplay : path.device}
      </button>
      <code className="bal-rule">{path.ruleId}</code>
      {path.requiredNode !== '' && <span className="bal-badge bal-badge-warn">потрібен вузол {path.requiredNode}</span>}
      {path.chainInput && !path.selfFed && <span className="bal-badge bal-badge-warn">зразок пакує чужий прилад</span>}
      {path.feedGates.length > 0 && (
        <span className="bal-badge bal-badge-warn" title="гейт приїхав по ланцюгу: сировину для цього правила пакує правило, яке саме під вузлом дерева">
          ланцюг чекає на {path.feedGates.join(', ')}
        </span>
      )}
    </li>
  )
}

function CostRow({ row, reasons, onOpenPointType, onOpenTree, onOpenDataItem, onOpenStation }: {
  row: BalanceCostRow
  // Причини ПІСЛЯ дедупу в межах блоку фракції (див. FactionBlock): та сама фраза, повторена
  // дванадцять разів поспіль, перестає читатись і топить рідкісні НЕтипові причини.
  reasons: string[]
  onOpenPointType: (id: string) => void
  onOpenTree: (filePath: string, nodeId: string) => void
  onOpenDataItem: (c: string) => void
  onOpenStation: (c: string) => void
}) {
  const tone = row.status === 'ok' ? 'ok' : row.status === 'gated' ? 'warn' : 'alarm'
  return (
    <tr data-type={row.pointType} className={`bal-cost bal-status-${row.status}`}>
      <td>
        <button type="button" className="row-select bal-jump-type" onClick={() => onOpenPointType(row.pointType)} title={`Відкрити тип балів ${row.pointType}`}>
          <ColorChip color={row.color} />
          {row.typeName}
        </button>
        <div className="bal-subtle">
          <code>{row.pointType}</code>
          {!row.known && <span className="bal-badge bal-badge-alarm">немає в PointTypes.json</span>}
        </div>
      </td>
      <td className="entity-count">{row.total}</td>
      <td>
        <ul className="bal-node-list">
          {row.nodes.map((n, i) => (
            <li key={`${n.filePath}::${n.nodeId}::${i}`}>
              <button type="button" className="row-select bal-jump-node" onClick={() => onOpenTree(n.filePath, n.nodeId)} title={`Показати вузол ${n.nodeId} на полотні дерева`}>
                {n.label}
              </button>
              <span className="bal-amount">×{n.amount}</span>
            </li>
          ))}
        </ul>
      </td>
      <td>
        {row.paths.length === 0 ? (
          <span className="hint">—</span>
        ) : (
          <ul className="bal-path-list">
            {row.paths.map((p, i) => (
              <YieldPathLine key={`${p.ruleId}::${p.dataItem}::${i}`} path={p} onOpenDataItem={onOpenDataItem} onOpenStation={onOpenStation} />
            ))}
          </ul>
        )}
      </td>
      <td className="bal-status-cell" title={row.reasons.join(' ')}>
        <Lamp tone={tone} />
        <span className="bal-status-label">
          {row.status === 'ok' ? 'видобувається' : row.status === 'gated' ? 'умовно' : 'вимагається, але не видобувається'}
        </span>
        {reasons.map((r, i) => (
          <p key={i} className="bal-reason">
            {r}
          </p>
        ))}
      </td>
    </tr>
  )
}

function FactionBlock({ row, onOpenPointType, onOpenTree, onOpenDataItem, onOpenStation }: {
  row: BalanceFactionRow
  onOpenPointType: (id: string) => void
  onOpenTree: (filePath: string, nodeId: string) => void
  onOpenDataItem: (c: string) => void
  onOpenStation: (c: string) => void
}) {
  const deviceText =
    row.deviceMode === 'own'
      ? row.devices.join(', ')
      : row.deviceMode === 'all'
        ? 'поділу немає — доступні всі'
        : 'жодного (поділ уже почався)'
  const terminalText =
    row.depositMode === 'own' ? row.terminals.join(', ') : row.depositMode === 'shared' ? `спільні з Settings: ${row.terminals.join(', ')}` : 'жодного — здавати нема куди'

  // Дедуп причин У МЕЖАХ блоку: перша поява фрази лишається, повтори гаснуть (повний текст
  // завжди в title комірки). Без цього дванадцять однакових «жодне доступне фракції правило
  // не виробляє…» перетворювали таблицю на шпалери й ховали рідкісні НЕтипові причини.
  const shownReasons = new Set<string>()
  const dedupedReasons = row.costs.map((c) =>
    c.reasons.filter((r) => {
      if (shownReasons.has(r)) return false
      shownReasons.add(r)
      return true
    }),
  )

  // Фракція без дерева й без видобутку — один рядок замість блоку з таблицею-заглушкою:
  // на стенді таких чотири, і повний блок на кожну топив би змістовні фракції.
  const empty = row.costs.length === 0 && row.branches.length === 0 && row.surplus.length === 0 && row.itemCosts.length === 0
  if (empty) {
    return (
      <p className="bal-faction bal-faction-empty" data-faction={row.id}>
        <Lamp tone={row.tone} />
        <span className="bal-faction-name">{row.displayName}</span>
        <code className="bal-faction-id">{row.id}</code>
        <span className="bal-subtle">гілок дерева немає; прилади: {deviceText}; термінали: {terminalText}</span>
      </p>
    )
  }

  return (
    <section className="bal-faction" data-faction={row.id}>
      <h3 className="bal-faction-title">
        <Lamp tone={row.tone} />
        {row.displayName}
        <code className="bal-faction-id">{row.id}</code>
      </h3>

      <p className="bal-meta">
        <span>
          Прилади: <span className="bal-meta-value">{deviceText}</span>
        </span>
        <span>
          Термінали: <span className="bal-meta-value">{terminalText}</span>
        </span>
        <span>
          Вузлів дерева: <span className="bal-meta-value">{row.nodeCount}</span>
          {row.skippedNodes > 0 && <span className="bal-badge bal-badge-alarm">не завантажиться: {row.skippedNodes}</span>}
        </span>
      </p>

      {row.branches.length > 0 && (
        <p className="bal-meta">
          <span>Гілки:</span>
          {row.branches.map((b) => (
            <button key={b.filePath} type="button" className="row-select bal-jump-branch" onClick={() => onOpenTree(b.filePath, '')} title={`Відкрити гілку ${b.branchId} на полотні дерева`}>
              {b.label}
            </button>
          ))}
        </p>
      )}

      {row.notes.map((n, i) => (
        <p key={i} className="indicator" role="status">
          <Lamp tone="warn" />
          {n}
        </p>
      ))}

      {row.costs.length > 0 ? (
        <div className="bal-table-scroll">
          <table className="file-list bal-cost-table">
            <thead>
              <tr>
                <th>Тип балів</th>
                <th>Треба всього</th>
                <th>Вузли</th>
                <th>Чим видобувається</th>
                <th>Стан</th>
              </tr>
            </thead>
            <tbody>
              {row.costs.map((c, i) => (
                <CostRow key={c.pointType} row={c} reasons={dedupedReasons[i]} onOpenPointType={onOpenPointType} onOpenTree={onOpenTree} onOpenDataItem={onOpenDataItem} onOpenStation={onOpenStation} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="hint">Дерево цієї фракції нічого не коштує — вузлів із вартістю немає.</p>
      )}

      {row.surplus.length > 0 && (
        <div className="bal-surplus">
          <span className="label">Видобувається, але дерево не вимагає</span>
          <ul className="bal-path-list">
            {row.surplus.map((s, i) => (
              <li key={`${s.pointType}::${i}`} className="bal-surplus-row">
                <button type="button" className="row-select bal-jump-type" onClick={() => onOpenPointType(s.pointType)}>
                  <ColorChip color={s.color} />
                  {s.typeName}
                </button>
                <span className="bal-subtle">{s.paths.map((p) => p.dataItem).join(', ')}</span>
                {/* Фікс-раунд ревʼю (Important 3): без терміналу «надлишок» до пулу не дійде —
                    рядки вартості вище кажуть рівно це, тож бейдж прибирає суперечність
                    двох половин одного блоку. */}
                {!s.canDeposit && <span className="bal-badge bal-badge-alarm">здати нема куди — у пул не потрапить</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {row.itemCosts.length > 0 && (
        <p className="bal-meta">
          <span>Предмети для досліджень:</span>
          {row.itemCosts.map((ic) => (
            <span key={ic.classname} className="bal-meta-value">
              <code>{ic.display !== '' ? ic.display : ic.classname}</code> ×{ic.quantity} ({ic.nodeCount} вуз.)
            </span>
          ))}
        </p>
      )}
    </section>
  )
}

export function BalanceTab({ project, index, onOpenDataItem, onOpenPointType, onOpenTree, onOpenStation }: BalanceTabProps) {
  // useMemo — той самий урок T9/DataItemsView: без нього скан індексу, резолв лиць і повний
  // обхід дерева перераховувались би на кожен рендер оболонки.
  const view = useMemo(() => buildBalanceView(project, index), [project, index])
  const { matrix } = view

  return (
    <div className="balance-workspace">
      {view.notes.map((n, i) => (
        <p key={i} className="indicator" role="status">
          <Lamp tone="warn" />
          {n}
        </p>
      ))}

      {/* ---- (а) Що скільки дає ---------------------------------------------------------- */}
      <section className="sheet">
        <span className="sheet-title label">Що скільки дає</span>
        <p className="hint">
          Скільки балів фракція отримає за ОДНУ здачу заготовки на своєму терміналі. Колонки —
          лише ті типи, які хтось справді дає. Вимкнений запис сервер не бачить узагалі (Find
          пропускає !Enabled), тому в підсумок він не входить; «0» і невідомий тип балів сервер
          пропускає при нарахуванні (CountGrantable, ZP_DataItemsConfig.c:144-153).
        </p>

        {matrix.rows.length === 0 ? (
          <p className="intro">Жодної описаної заготовки — видобутку балів у грі немає.</p>
        ) : (
          <div className="bal-table-scroll">
            <table className="file-list bal-matrix" id="bal-matrix">
              <thead>
                <tr>
                  <th>Заготовка</th>
                  {matrix.columns.map((c) => (
                    <th key={c.id} className="bal-type-col">
                      <button type="button" className="row-select bal-jump-type" onClick={() => onOpenPointType(c.id)} title={c.id}>
                        <ColorChip color={c.color} />
                        {c.name}
                      </button>
                    </th>
                  ))}
                  {matrix.hasUnknown && <th className="bal-type-col bal-unknown-col">невідомі типи</th>}
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((r) => (
                  <tr key={r.classname} data-item={r.classname} className={r.enabled ? undefined : 'bal-row-off'}>
                    <td>
                      <button type="button" className="row-select bal-jump-item" onClick={() => onOpenDataItem(r.classname)} title={`Відкрити заготовку ${r.classname}`}>
                        <code>{r.classname}</code>
                      </button>
                      <div className="bal-subtle">
                        {r.name}
                        {!r.enabled && <span className="bal-badge bal-badge-warn">вимкнено</span>}
                        {r.duplicate && <span className="bal-badge bal-badge-alarm">дубль Id</span>}
                      </div>
                      {r.notes.map((n, i) => (
                        <p key={i} className="bal-reason">
                          {n}
                        </p>
                      ))}
                    </td>
                    {matrix.columns.map((c) => {
                      const cell = r.cells.get(c.id)
                      return (
                        <td key={c.id} data-type={c.id} className={`entity-count${cell && !cell.grantable ? ' bal-cell-dead' : ''}`}>
                          {cell ? cell.amount : ''}
                        </td>
                      )
                    })}
                    {matrix.hasUnknown && (
                      <td className="bal-unknown-cell">
                        {/* ключ із індексом: та сама невідома мітка типу може стояти в Points
                            двічі (сервер нарахував би обидва записи), і React не має права
                            падати на дублі — його console.error валить смоук. */}
                        {r.unknown.map((u, ui) => (
                          <span key={`${u.type}::${ui}`} className="bal-badge bal-badge-alarm" title="типу немає в PointTypes.json (порівняння ТОЧНЕ) — бали не нарахуються">
                            <code>{u.type}</code> ×{u.amount}
                          </span>
                        ))}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="label">Разом за здачу (увімкнені)</td>
                  {matrix.columns.map((c) => (
                    <td key={c.id} data-total={c.id} className="entity-count">
                      {matrix.totals.get(c.id) ?? 0}
                    </td>
                  ))}
                  {matrix.hasUnknown && <td />}
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {matrix.idle.length > 0 && (
          <p className="bal-idle">
            {/* Фікс-раунд ревʼю (minor 6): перелік і колонки НЕ перетинаються — тут лише типи,
                яких не згадує жодна заготовка. Тип, що згадується, але не нараховується
                (вимкнений запис, нуль, зріз сервера), уже видно колонкою з мертвою клітинкою. */}
            <span className="label" title="жодна заготовка не згадує ці типи — колонки для них у таблиці немає">
              Не згадує жодна заготовка ({matrix.idle.length}):
            </span>
            {matrix.idle.map((c) => (
              <button key={c.id} type="button" className="row-select bal-jump-type bal-idle-chip" onClick={() => onOpenPointType(c.id)} title={c.name}>
                <ColorChip color={c.color} />
                <code>{c.id}</code>
              </button>
            ))}
          </p>
        )}
      </section>

      {/* ---- (б) Ланцюги до заготовок ---------------------------------------------------- */}
      <section className="sheet">
        <span className="sheet-title label">Ланцюги до заготовок</span>
        <p className="hint">
          Чим саме виробляється кожна заготовка. «Ніхто не виробляє» — це не розрив ланцюга
          (розриви живуть на вкладці «Ланцюги»), а факт економіки: бали за таку заготовку в
          конфігу описані, але взяти її гравцеві нізвідки.
        </p>
        {view.chains.length === 0 ? (
          <p className="intro">Ані описаних, ані вироблюваних заготовок у проєкті немає.</p>
        ) : (
          <ul className="bal-chain-list">
            {view.chains.map((c) => (
              <li key={c.classname} data-item={c.classname} className="bal-chain-row">
                <div className="bal-chain-head">
                  <Lamp tone={c.tone} />
                  <button type="button" className="row-select bal-jump-item" onClick={() => onOpenDataItem(c.classname)}>
                    <code>{c.classname}</code>
                  </button>
                  <span className="bal-subtle">{c.name}</span>
                </div>
                {c.producers.length === 0 ? (
                  <p className="bal-reason">ніхто не виробляє</p>
                ) : (
                  <ul className="bal-path-list">
                    {c.producers.map((p, i) => (
                      <li key={`${p.filePath}::${p.ruleId}::${i}`} className="bal-path">
                        <button type="button" className="row-select bal-jump-station" onClick={() => onOpenStation(p.device)} title={`Відкрити вікно станка ${p.device}`}>
                          {p.deviceDisplay !== '' ? p.deviceDisplay : p.device}
                        </button>
                        <code className="bal-rule">{p.ruleId}</code>
                        <span className="bal-sep">←</span>
                        <code>{p.inputDisplay !== '' ? p.inputDisplay : p.inputClassname}</code>
                        {p.inputContent !== '' && <span className="bal-subtle">вміст «{p.inputContent}»</span>}
                        {p.disabled && <span className="bal-badge bal-badge-warn">вимкнено</span>}
                        {/* Мертве правило НЕ ховається (вимога ревʼю фікс-раунду): адмін мусить
                            бачити, ЧОМУ виходу немає, а не порожній перелік виробників. */}
                        {p.dead && <span className="bal-badge bal-badge-alarm">сервер не запустить</span>}
                        {p.requiredNode !== '' && <span className="bal-badge bal-badge-warn">потрібен вузол {p.requiredNode}</span>}
                        {p.requiredFactions.length > 0 && <span className="bal-badge">лише: {p.requiredFactions.join(', ')}</span>}
                        {p.deadReasons.map((r, k) => (
                          <p key={k} className="bal-reason">
                            {r}
                          </p>
                        ))}
                      </li>
                    ))}
                  </ul>
                )}
                {c.notes.map((n, i) => (
                  <p key={i} className="bal-reason">
                    {n}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- (в) Вартість дерева проти видобутку ------------------------------------------ */}
      <section className="sheet">
        <span className="sheet-title label">Вартість дерева проти видобутку</span>
        <p className="hint">
          По кожній фракції: скільки балів вимагає ЇЇ дерево (сума Cost завантажуваних вузлів)
          проти того, що вона здатна видобути своїми приладами. Червоний рядок «вимагається, але
          не видобувається» — дірка балансу: вузол у грі не купить ніхто. «Умовно» — видобуток
          існує, але за гейтом (потрібне дослідження або зразок пакує чужий прилад).
        </p>
        {view.factions.length === 0 ? (
          <p className="intro">Немає Factions.json — порівнювати нема з чим.</p>
        ) : (
          // ключ із індексом: дубль Factions[].Id — цілком можливий стан файлу, а голий f.id
          // дав би React-помилку в консолі (і завалив би жорсткий console-assert смоуку).
          view.factions.map((f, i) => (
            <FactionBlock key={`${f.id}::${i}`} row={f} onOpenPointType={onOpenPointType} onOpenTree={onOpenTree} onOpenDataItem={onOpenDataItem} onOpenStation={onOpenStation} />
          ))
        )}
      </section>
    </div>
  )
}
