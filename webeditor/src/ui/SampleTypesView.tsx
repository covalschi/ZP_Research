// SampleTypesView — вікно «Типи зразків» (W2.5 Task 4): редактор SampleTypes.json.
// Дзеркало DataItemQuickEdit.tsx (T9) ЗА ТИМ САМИМ КОНТРАКТОМ ("чиста мутація ->
// onProjectChange -> живий рендер"), АЛЕ повноцінне ВІКНО-СПИСОК, а не floating-редактор
// одного запису з картки: заготовки (DataItems.json) до цього таска не мали жодного
// "перегляньте всі" вікна взагалі -- список тут перший такий у редакторі. Причина: клас
// зразка ФІКСОВАНИЙ (рівно 31 -- ZP_Sample + ZP_Sample_01..30, listSampleFamilyClasses,
// model/sampleContent.ts), тож немає сенсу чекати, поки якийсь із них трапиться на
// картці ланцюга, щоб узагалі його побачити -- адмін повинен мати змогу назвати
// БУДЬ-ЯКИЙ із 31 навіть якщо жодне правило зараз його не використовує.
//
// Iron rule проєкту ("будь-яке поле-посилання на сутність -- ZpSelect із живим
// пошуком") тут НЕ застосовується до самого переліку класів: він не посилання на щось
// зовнішнє, а фіксований, вичерпний список -- ZpSelect (з пошуком по 33k класів індексу)
// був би категорійно неправильним інструментом для 31 наперед відомого рядка. Полів,
// що САМІ посилаються на щось (Points/тип балів -- як у DataItemQuickEdit), тут немає
// взагалі: ZP_SampleTypeDef не несе Points (спека §4a, зразок -- проміжна ланка, не
// здається напряму) -- тому жодного ZpSelect у цьому вікні не потрібно.

import { useMemo, useState } from 'react'
import type { Project } from '../io/project'
import type { ClassIndex } from '../model/classIndex'
import { listSampleFamilyClasses } from '../model/sampleContent'
import { resolveSampleTypeFace } from './ChainView'
import type { SampleTypeFace } from './ChainView'
import { applySampleTypeEdit, createSampleType, createSampleTypesFile } from '../io/sampleTypeEdit'

// isReadOnly -- РІВНО той предикат, яким форма нижче гейтує <fieldset disabled=...> --
// той самий прийом, що DataItemQuickEdit.isReadOnly (T9, рев'ю фікс-раунду 1, Important
// 1c): тест перевіряє САМЕ це булеве значення, а не лише SampleTypeFace.duplicate окремо
// від того, як його насправді споживає форма.
export function isReadOnly(face: SampleTypeFace): boolean {
  return face.duplicate
}

// TextField/CheckboxField -- НАМІРЕНО невеликий дублікат однойменних компонентів
// DataItemQuickEdit.tsx (не експортованих звідти): той самий компроміс, який T9 уже
// прийняв і задокументував там -- логіка тривіальна, дублювання дешевше за міжмодульну
// зв'язність двох незалежних форм-редакторів.
function TextField({ id, label, value, onCommit }: { id: string; label: string; value: string; onCommit: (v: string) => void }) {
  return (
    <div className="rule-field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input id={id} className="field-input" type="text" value={value} onChange={(e) => onCommit(e.target.value)} />
    </div>
  )
}

function CheckboxField({ id, label, checked, onCommit, title }: { id: string; label: string; checked: boolean; onCommit: (v: boolean) => void; title?: string }) {
  return (
    <label className="rule-checkbox" htmlFor={id} title={title}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onCommit(e.target.checked)} />
      {label}
    </label>
  )
}

interface SampleTypeEditPanelProps {
  project: Project
  index: ClassIndex
  classname: string
  onProjectChange: (next: Project) => void
}

// Окремий підкомпонент (замонтовується з key={classname} у SampleTypesView нижче) --
// той самий T9-урок, застосований УПЕРЕД, а не після ревʼю: без key= перемикання
// вибраного класу в списку лишало б компонент змонтованим, і застарілий commitError
// (useState нижче) пережив би перехід на інший класнейм (T3 report, W2.5, п. "Step 4:
// key={selectedDataItem}" -- рівно той самий дефект, знайдений у DataItemQuickEdit).
function SampleTypeEditPanel({ project, index, classname, onProjectChange }: SampleTypeEditPanelProps) {
  const face = resolveSampleTypeFace(project, index, classname)
  const [commitError, setCommitError] = useState<string | null>(null)

  function commit(updater: (item: Record<string, unknown>) => void) {
    if (!face.entryId) return // не мало б статись: кнопки правки показуються лише коли face.configured
    const result = applySampleTypeEdit(project, face.entryId, updater)
    if (result.ok) {
      setCommitError(null)
      onProjectChange(result.project)
    } else {
      // Рев'ю-урок T9 (фікс-раунду 1, Important 1b), застосований УПЕРЕД: помилка
      // мутатора ПОКАЗУЄТЬСЯ, а не мовчки відкидається -- адмін бачить ЧОМУ поле
      // "не тримається" (файл зник з проєкту між рендерами, дубль Id перешкодив
      // точковій правці), а не лишається без жодного пояснення.
      setCommitError(result.error)
    }
  }

  function handleCreate() {
    const result = createSampleType(project, classname)
    if (result.ok) {
      setCommitError(null)
      onProjectChange(result.project)
    } else {
      setCommitError(result.error)
    }
  }

  return (
    <>
      <div className="sheet-title-row">
        <span className="sheet-title label">Тип зразка</span>
      </div>
      <p className="field-readonly">
        <code>{classname}</code>
      </p>

      {commitError && (
        <p className="indicator alarm" role="alert">
          <span className="lamp lamp-alarm" aria-hidden="true" />
          {commitError}
        </p>
      )}

      {!face.configured && (
        <>
          <p className="indicator" role="status">
            <span className="lamp lamp-warn" aria-hidden="true" />
            Цей тип не налаштований — у грі показується запасна назва зі stringtable («Зразок №NN (не налаштовано)»), бо ZP_SampleInfo.Lookup не знаходить запис.
          </p>
          <button type="button" onClick={handleCreate}>
            + Створити запис
          </button>
        </>
      )}

      {/* Той самий "дубль Id -- форма лише для перегляду" паттерн, що DataItemQuickEdit
          (T9, рев'ю фікс-раунду 1, Important 1b) -- дубль неможливий БЕЗ configured=true
          (findSampleTypeEntry знаходить запис лише якщо він є хоч один). */}
      {face.configured && face.duplicate && (
        <p className="indicator alarm" role="alert">
          <span className="lamp lamp-alarm" aria-hidden="true" />
          Дублікат Id «{classname}» у SampleTypes.json — рушій залишить ОСТАННІЙ запис;
          виправте вручну (форма нижче — лише для перегляду).
        </p>
      )}

      {face.configured && (
        <fieldset className="rule-form" disabled={isReadOnly(face)}>
          <TextField id="st-name" label="Назва" value={face.name} onCommit={(v) => commit((it) => (it.Name = v))} />
          <div className="rule-field">
            <label className="field-label" htmlFor="st-description">
              Опис
            </label>
            <textarea
              id="st-description"
              className="field-textarea"
              value={face.description}
              onChange={(e) => commit((it) => (it.Description = e.target.value))}
              rows={3}
            />
          </div>
          <CheckboxField
            id="st-enabled"
            label="Увімкнено"
            checked={face.enabled}
            onCommit={(v) => commit((it) => (it.Enabled = v))}
            title="Вимкнений тип виводиться в грі із запасною назвою зі stringtable («Зразок №NN (не налаштовано)») — сервер (ZP_SampleTypesConfig.Find) ігнорує вимкнені записи"
          />
        </fieldset>
      )}
    </>
  )
}

export interface SampleTypesViewProps {
  project: Project
  index: ClassIndex
  onProjectChange: (next: Project) => void
}

export function SampleTypesView({ project, index, onProjectChange }: SampleTypesViewProps) {
  const sampleTypesLoaded = project.files.some((f) => f.kind === 'sampleTypes')
  // Той самий useMemo-урок, що T9 застосував у DataItemQuickEdit (рев'ю фікс-раунду 1,
  // Important 2) -- без нього і перелік 31 класу, і резолв усіх 31 облич перераховувались
  // би на КОЖЕН рендер (кожне натискання клавіші в st-name/st-description), а не лише
  // коли реально змінився сам проєкт чи індекс класів.
  const classes = useMemo(() => listSampleFamilyClasses(index), [index])
  const faces = useMemo(() => classes.map((cls) => resolveSampleTypeFace(project, index, cls)), [classes, project, index])

  const [selected, setSelected] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)

  function handleCreateFile() {
    const result = createSampleTypesFile(project)
    if (result.ok) {
      setFileError(null)
      onProjectChange(result.project)
    } else {
      setFileError(result.error)
    }
  }

  return (
    <div className="sample-types-workspace">
      <section className="sheet sample-types-list">
        <span className="sheet-title label">Реєстр типів зразків</span>

        {!sampleTypesLoaded && (
          <>
            <p className="indicator" role="status">
              <span className="lamp lamp-warn" aria-hidden="true" />У проєкті немає SampleTypes.json — усі класи-зразки ({classes.length}){' '}
              показують у грі запасну назву зі stringtable («Зразок №NN (не налаштовано)»).
            </p>
            {fileError && (
              <p className="indicator alarm" role="alert">
                <span className="lamp lamp-alarm" aria-hidden="true" />
                {fileError}
              </p>
            )}
            <button type="button" onClick={handleCreateFile}>
              Створити SampleTypes.json
            </button>
          </>
        )}

        {sampleTypesLoaded && (
          <table className="file-list sample-types-table">
            <thead>
              <tr>
                <th>Клас</th>
                <th>Назва</th>
                <th>Стан</th>
              </tr>
            </thead>
            <tbody>
              {classes.map((cls, i) => {
                const face = faces[i]
                const isSelected = cls === selected
                return (
                  <tr key={cls} className={isSelected ? 'selected' : undefined}>
                    <td>
                      <button type="button" className="row-select" aria-current={isSelected ? 'true' : undefined} onClick={() => setSelected(cls)}>
                        <code>{cls}</code>
                      </button>
                    </td>
                    <td>
                      {face.duplicate ? (
                        <span className="warn-count alarm">
                          <span className="lamp lamp-alarm" aria-hidden="true" />
                          дубль Id
                        </span>
                      ) : face.configured ? (
                        face.name
                      ) : (
                        <span className="hint">не налаштовано</span>
                      )}
                    </td>
                    <td>
                      {face.configured && !face.duplicate && <span className={`lamp ${face.enabled ? 'lamp-ok' : 'lamp-warn'}`} aria-hidden="true" title={face.enabled ? 'увімкнено' : 'вимкнено'} />}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      {sampleTypesLoaded && (
        <aside className="sheet sample-type-detail">
          {selected ? (
            <SampleTypeEditPanel key={selected} project={project} index={index} classname={selected} onProjectChange={onProjectChange} />
          ) : (
            <p className="intro">Виберіть клас у переліку, щоб побачити чи змінити його ігрове ім&apos;я.</p>
          )}
        </aside>
      )}
    </div>
  )
}
