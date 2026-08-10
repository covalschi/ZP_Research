// DataItemQuickEdit — floating-обгортка редактора однієї заготовки (ZP_Data_*) для полотна
// ланцюгів (W2 Task 9, з W2.6 Task 2 — ChainView.tsx/ItemCardNode, kind==='dataItem').
// З W4 Task 4 усе ТІЛО форми (створення запису, банер дубля, поля, Points) винесене в
// спільний DataItemEditForm.tsx — той самий компонент рендерить і деталь-панель вкладки
// «Заготовки» (DataItemsView.tsx). Тут лишилась лише рамка полотна: aside із заголовком
// «Швидка правка» і кнопкою закриття (у вкладці закриття немає — панель живе постійно).
//
// isReadOnly ре-експортується (він переїхав разом із формою): наявні споживачі
// (tests/dataItemQuickEdit.test.ts) імпортують його звідси — публічний API не змінився.

import type { Project } from '../io/project'
import type { ClassIndex } from '../model/classIndex'
import { DataItemEditForm } from './DataItemEditForm'

export { isReadOnly } from './DataItemEditForm'

export interface DataItemQuickEditProps {
  project: Project
  index: ClassIndex
  // Класнейм виходу, з якого відкрили редактор (data-face-теґ картки, ChainView.tsx) —
  // ЄДИНЕ джерело ідентичності: поточний стан щоразу перечитується з project через
  // resolveDataItemFace (усередині DataItemEditForm), тож редактор ніколи не розходиться
  // з тим, що бачить адмін на полотні.
  classname: string
  onProjectChange: (next: Project) => void
  onClose: () => void
}

export function DataItemQuickEdit({ project, index, classname, onProjectChange, onClose }: DataItemQuickEditProps) {
  return (
    <aside className="sheet data-item-quick-edit">
      <div className="sheet-title-row">
        <span className="sheet-title label">Швидка правка заготовки</span>
        <button type="button" className="quick-edit-close" onClick={onClose} aria-label="Закрити швидку правку">
          ×
        </button>
      </div>
      <DataItemEditForm project={project} index={index} classname={classname} onProjectChange={onProjectChange} />
    </aside>
  )
}
