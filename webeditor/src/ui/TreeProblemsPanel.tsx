// Панель проблем дерева (W3 Task 4) — живе дзеркало валідації на полотні, за зразком
// панелі розривів ланцюгів (BreaksPanel, ChainView.tsx): React Flow <Panel> у правому
// верхньому куті полотна, рядки — плоскі кнопки на всю ширину, клік центрує полотно на
// вузлі (і вибирає його; кросгілковий рядок спершу перемикає гілку — TreeCanvas.
// handleCenterRow). Уся збірка даних — у чистому ui/treeProblems.ts (покрито юнітами);
// тут ЛИШЕ розмітка.
//
// Три поверхи (порядок — від найгіршого до довідкового):
//   1. Проєктний блок (hardErr): дубль Id вузла / бита або дубльована гілка — ОДНА така
//      відмова зриває завантаження ЦІЛОГО дерева (TREE_HARDERR_NOTE, цитати з
//      TryLoadTechTree). Некликабельний: це властивість проєкту, не картки.
//   2. Групи по гілках: рядок = вузол із причинами (лампа = найгірша severity причин
//      рядка; на полотні той самий вузол горить бінарним alarm — тут різниця warn/alarm
//      якраз важлива). Під рядком — перелік причин; warn «клас відсутній в індексі» несе
//      підказку другого порядку про нащадків (хвіст ревью T1).
//   3. Довідка-розрізнення «warn не дорівнює відмові сервера» (TREE_SERVER_GUARD_HINT,
//      бриф T4 п.2) — показується, лише коли є хоч одна проблема: коли пояснювати нічого,
//      панель згортається у спокійну плашку «ok» (та сама поведінка, що BreaksPanel).

import { Panel } from '@xyflow/react'
import type { TreeProblemsModel, TreeProblemRow } from './treeProblems'
import { TREE_HARDERR_NOTE, TREE_SERVER_GUARD_HINT } from './treeProblems'

export interface TreeProblemsPanelProps {
  model: TreeProblemsModel
  onCenter: (row: TreeProblemRow) => void
}

export function TreeProblemsPanel({ model, onCenter }: TreeProblemsPanelProps) {
  if (model.rowCount === 0 && model.project.length === 0) {
    return (
      <Panel position="top-right" className="chain-panel breaks-panel ok tree-problems-panel">
        <span className="lamp lamp-ok" aria-hidden="true" />
        <span className="breaks-panel-title label">Проблем дерева немає</span>
      </Panel>
    )
  }

  return (
    <Panel position="top-right" className="chain-panel breaks-panel tree-problems-panel">
      <span className="breaks-panel-title label">
        <span className={`lamp ${model.alarmCount > 0 ? 'lamp-alarm' : 'lamp-warn'}`} aria-hidden="true" />
        Проблеми дерева (аварій {model.alarmCount} · попереджень {model.warnCount})
      </span>

      {model.project.length > 0 && (
        <div className="tree-problems-project">
          <span className="label">Проблеми проєкту — зривають усе дерево</span>
          <ul>
            {model.project.map((p, i) => (
              <li key={i}>
                <span className="lamp lamp-alarm" aria-hidden="true" />
                {p.message}
              </li>
            ))}
          </ul>
          <p className="tree-problems-note">{TREE_HARDERR_NOTE}</p>
        </div>
      )}

      {model.groups.map((g) => (
        <div className="tree-problems-group" key={g.filePath}>
          <span className="tree-problems-branch label">
            Гілка «{g.label}» <code>{g.filePath}</code>
          </span>
          <ul className="breaks-list">
            {g.rows.map((row) => (
              <li key={row.key}>
                <button
                  type="button"
                  className="breaks-list-item tree-problems-row"
                  onClick={() => onCenter(row)}
                  title="Центрувати полотно на вузлі"
                >
                  <span className={`lamp lamp-${row.worst}`} aria-hidden="true" /> {row.label}{' '}
                  <code>{row.nodeId}</code>
                </button>
                <ul className="tree-problems-reasons">
                  {row.reasons.map((r, i) => (
                    <li key={i}>
                      <span className={`lamp lamp-${r.severity}`} aria-hidden="true" />
                      {r.message}
                      {r.hint && <p className="tree-problems-hint-inline">{r.hint}</p>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <p className="tree-problems-hint">{TREE_SERVER_GUARD_HINT}</p>
    </Panel>
  )
}
