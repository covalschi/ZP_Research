// Панель гейта збереження/експорту при кривих типах (W2.7 Task 1, io/project.ts:
// alarmFiles). Рішення власника (CLAUDE.md, «РІШЕННЯ ВЛАСНИКА (2026-08-07, після приймання
// W2.6)», п.2): поки в проєкті лишається бодай ОДИН файл з alarm-попередженням, «Зберегти
// зміни» й «Завантажити ZIP» відмовляють ЦІЛКОМ — недоторканий (не-dirty) файл ZIP пакує
// ОРИГІНАЛЬНИМИ битими байтами (принцип W1), тож без гейту експорт міг би непомітно
// поширити зіпсований файл. Обґрунтування, T8-зонд (io/parse.ts:wrongTypeNote):
// ZP_ConfigService.c:383-393 — TryLoadX() на хибному типі присутнього скалярного значення
// повертає false, і рушій відхиляє ВЕСЬ файл (не лише поле) на найближчому перезавантаженні
// сервера. Панель завжди йде В ПАРІ з «Полагодити все» — адмін не застрягає (план W2.7).
//
// W4 Task 2 (хвости ревʼю T1):
//   1. ДРУГА секція — гейт ДАНИХ PointTypes (pointTypesGateAlarms, model/configValidation):
//      дубль Id / порожній Name / Tier поза межами теж блокують canSave/canExport (той
//      самий клас ризику: на рестарті реєстр типів балів лишиться ПОРОЖНІМ і кожен вузол
//      дерева з Cost буде відкинуто, а живий !zp reload відмовить ЦІЛКОМ для всіх восьми
//      конфігів). «Полагодити все» тут НЕ помічник (канонізація дубль не лагодить) — ремонт
//      живе у вкладці «Бали», кнопка веде туди (onOpenPointTypes).
//   2. Файли, які ВЗАГАЛІ не розібрались як JSON (isUnparseableFile нижче): для них
//      «Полагодити» означає перезапис ДЕФОЛТАМИ СХЕМИ — з битого файлу нічого прочитати не
//      можна (parse.ts повернув defaultsDeep). Панель каже це чесно окремим рядком і
//      бейджем на файлі (фікс-волна ab9e01e вимагала саме такого формулювання).
//
// Чиста презентаційна компонента (той самий принцип, що FileList.tsx): отримує вже
// відфільтровані списки і колбеки, жодної логіки repairFile/навігації тут немає.

import type { ProjectFile } from '../io/project'
import type { ProjectAlarm } from '../model/configValidation'
import { UNPARSEABLE_JSON_PREFIX } from '../io/parse'

interface AlarmGatePanelProps {
  files: ProjectFile[]
  // Гейт даних PointTypes (pointTypesGateAlarms) — порожній масив, коли даних-проблем немає
  dataAlarms: ProjectAlarm[]
  busy: boolean
  onSelectFile: (path: string) => void
  onRepairAll: () => void
  // Перехід на вкладку «Бали» — єдиний шлях ремонту даних-гейта
  onOpenPointTypes: () => void
}

function alarmCount(file: ProjectFile): number {
  return file.warnings.filter((w) => w.severity === 'alarm').length
}

// Файл, який parse.ts НЕ зміг розібрати як JSON узагалі: parsed = дефолти схеми, тож
// «Полагодити» для нього — перезапис дефолтами, а не ремонт значень. Предикат звіряється
// з ЄДИНИМ джерелом префікса (UNPARSEABLE_JSON_PREFIX, io/parse.ts) і вимагає саме
// severity 'alarm' (тест tests/alarmGatePanel.test.ts).
export function isUnparseableFile(file: Pick<ProjectFile, 'warnings'>): boolean {
  return file.warnings.some((w) => w.severity === 'alarm' && w.message.startsWith(UNPARSEABLE_JSON_PREFIX))
}

export function AlarmGatePanel({ files, dataAlarms, busy, onSelectFile, onRepairAll, onOpenPointTypes }: AlarmGatePanelProps) {
  const anyUnparseable = files.some((f) => isUnparseableFile(f))
  return (
    <section className="sheet alarm-gate-panel" role="alert">
      {files.length > 0 && (
        <>
          <div className="alarm-gate-title">
            <span className="lamp lamp-alarm" aria-hidden="true" />
            Збереження й експорт заблоковано: {files.length} {files.length === 1 ? 'файл' : 'файли'} з хибними типами
            значень
          </div>
          <p className="hint">
            Рушій відхиляє ЦІЛИЙ файл при перезавантаженні, якщо хоч одне ПРИСУТНЄ значення не
            того типу (наприклад, рядок замість bool чи числа) — не лише саме зіпсоване поле.
            Після найближчого рестарту сервера станції з таким файлом лишаться зовсім без його
            правил/вузлів/записів (ZP_ConfigService.c:383-393). «Полагодити все» перезапише кожен
            файл нижче правильними типами (нуль свого типу замість хибного значення) — після
            цього «Зберегти зміни» й «Завантажити ZIP» знову стануть доступними.
          </p>
          {anyUnparseable && (
            <p className="hint alarm-gate-unparseable-note">
              Увага: файли з позначкою «битий JSON» не розібрались УЗАГАЛІ — з них нічого
              прочитати не можна, і «Полагодити» перезапише такий файл ДЕФОЛТАМИ СХЕМИ
              (усі колишні записи буде втрачено). Якщо у файлі був цінний вміст — спершу
              поправте його синтаксис зовнішнім редактором і перевідкрийте проєкт.
            </p>
          )}
          <ul className="alarm-gate-list">
            {files.map((f) => (
              <li key={f.path}>
                <button type="button" className="alarm-gate-item" onClick={() => onSelectFile(f.path)}>
                  <code>{f.path}</code>
                  {isUnparseableFile(f) && <span className="alarm-gate-unparseable-badge">битий JSON → дефолти схеми</span>}
                  <span className="alarm-gate-count">{alarmCount(f)} alarm</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="primary" onClick={onRepairAll} disabled={busy}>
            Полагодити все
          </button>
        </>
      )}

      {dataAlarms.length > 0 && (
        <div className="alarm-gate-data-section">
          <PointTypesGateBody alarms={dataAlarms} />
          <button type="button" className="primary" onClick={onOpenPointTypes}>
            Перейти до вкладки «Бали»
          </button>
        </div>
      )}
    </section>
  )
}

// Тіло даних-гейта PointTypes — СПІЛЬНЕ для app-панелі вище і банера наверху вкладки «Бали»
// (PointTypesView): бриф Task 2 вимагає «ті самі рядки» в обох місцях — одна компонента
// замість двох копій формулювання ризику (та сама дисципліна проти дрейфу, що
// UNPARSEABLE_JSON_PREFIX).
export function PointTypesGateBody({ alarms }: { alarms: ProjectAlarm[] }) {
  return (
    <>
      <div className="alarm-gate-title">
        <span className="lamp lamp-alarm" aria-hidden="true" />
        Збереження й експорт заблоковано: реєстр типів балів має аварійні записи ({alarms.length})
      </div>
      <p className="hint">
        Дубль Id, порожня назва або Tier поза [0..10] валять завантаження ЦІЛОГО
        PointTypes.json: на рестарті сервера реєстр типів балів лишиться ПОРОЖНІМ, і кожен
        вузол дерева з непорожнім Cost буде відкинуто («невідомий тип балів»), а живий
        <code> !zp reload</code> відмовить ЦІЛКОМ для всіх конфігів (TryLoadPointTypes,
        ZP_ConfigService.c:177-182; OpReloadAll :1489-1506). «Полагодити все» тут не
        допоможе — ремонт (видалення близнюка, назва, Tier) живе у вкладці «Бали».
      </p>
      <ul className="alarm-gate-list">
        {alarms.map((a, i) => (
          <li key={i}>
            <span className="alarm-gate-data-item">
              <code>
                {a.file}: {a.problem.path}
              </code>{' '}
              {a.problem.message}
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}
