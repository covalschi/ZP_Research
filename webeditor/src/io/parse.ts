// Терпимий парсер JSON-конфігів ZP_Research (Task 5). Ходить розібраний JSON.parse()-
// документ РЕКУРСИВНО ЗА СХЕМОЮ (не за формою вхідних даних): для кожного поля схеми —
// присутній ключ коерсується до типу поля, відсутній ключ добивається дефолтом схеми
// (deep-copy — types.ts попереджає, що field.def це СПІЛЬНИЙ літерал), а ключ, якого
// схема не знає, або відкидається як звичайний "невідомий" (нова людська помилка), або
// розпізнається як ЗАРЕЄСТРОВАНИЙ застарілий (schema.ts:STALE_KEYS — поле, яке колись
// існувало в Enforce-класі й було прибрано; старі файли на дисках адмінів досі можуть
// його містити). Парсер НІКОЛИ не кидає виняток — будь-яка неочікувана форма даних
// (null замість об'єкта, масив замість об'єкта, зовсім не JSON) веде до попередження і
// типового значення, а не до падіння. Мета: відкрити файл, можливо, старіший за поточну
// схему, і показати редактору, що саме в ньому не так.
//
// Композиція з Task 4 обов'язкова: encodeConfig(schema, parseConfig(schema, text).value)
// має бути побайтово ідентичний golden-фікстурам (tests/roundtrip.test.ts) — саме тому
// bool тут ЗАВЖДИ повертає справжній JS boolean (emitValue у jsonWriter.ts дивиться на
// істинність значення, а не на його JSON-форму), а float читається через Math.fround —
// той самий квант, який кладе в основу свого друку fmtFloat.

import type { ObjectSchema, FieldDef, FieldType, ConfigKind } from '../model/types'
import { SCHEMAS, isStaleKey } from '../model/schema'

// severity (W2.5 Task 3, рішення власника «поднимай тревожность») — ОПЦІОНАЛЬНЕ поле,
// відсутність == 'warn': жоден наявний виклик warnings.push({path, message}) (без
// severity) не ламається, розширення API не зворотньонесумісне. 'alarm' виставляється
// ТІЛЬКИ хибнотипізованим ПРИСУТНІМ скалярним значенням (coerceInt/coerceFloat/
// coerceBool/coerceString нижче, "третій випадок" — раніше "емпірично не перевірено",
// тепер підтверджено T8-зондом, див. wrongTypeNote нижче) — engine відхиляє ВЕСЬ файл на
// перезавантаженні, а не лише занулює це поле. Відсутній ключ (другий випадок вище) і всі
// інші попередження (невідомий/застарілий ключ, значення поза межами, дробове ціле,
// невідповідна форма масиву/об'єкта) лишаються 'warn' — жодне з них не спричиняє
// повне відхилення файлу за тим самим доказом.
export type WarningSeverity = 'warn' | 'alarm'

export interface Warning {
  path: string
  message: string
  severity?: WarningSeverity
}

export interface ParseResult {
  value: unknown
  warnings: Warning[]
}

const INT32_MIN = -2147483648
const INT32_MAX = 2147483647

// Префікс alarm-повідомлення «файл узагалі не розібрався як JSON» — ЄДИНЕ місце, з якого
// його читає і шаблон нижче, і предикат isUnparseableFile (ui/AlarmGatePanel.tsx): панель
// гейта мусить відрізняти цей випадок (parsed = дефолти схеми, «Полагодити» = перезапис
// ДЕФОЛТАМИ) від wrong-type (parsed живий, «Полагодити» лагодить лише типи) — дві копії
// рядка розійшлись би мовчки (та сама дисципліна, що MULTI_FILE_DIR_KIND у io/project.ts).
export const UNPARSEABLE_JSON_PREFIX = 'не вдалося розібрати JSON'

export function parseConfig(schema: ObjectSchema, jsonText: string): ParseResult {
  const warnings: Warning[] = []
  let raw: unknown
  try {
    raw = JSON.parse(jsonText)
  } catch (e) {
    // ALARM, не warn (ревью W4/T1, Important 1): нечитабельний JSON на сервері — це
    // LoadFile()==false, той САМИЙ клас наслідків, що й кривий тип значення (W2.7):
    // рестарт лишає реєстр порожнім (для rules — нуль правил з УСІХ файлів, зонд T8-W2),
    // живий !zp reload відмовляє атомарно. Гейт W2.7 (alarmFiles/canSave/canExport)
    // підхоплює цю позначку сам; «Полагодити» для такого файлу означає перезапис
    // ДЕФОЛТАМИ схеми (нічого з битого файлу прочитати не можна) — формулювання в UI
    // каже це чесно (панель гейта, isUnparseableFile — хвіст 3 ревʼю T1, закритий у T2).
    warnings.push({ path: '', severity: 'alarm', message: `${UNPARSEABLE_JSON_PREFIX} — сервер відкине ВЕСЬ файл (LoadFile()==false; рестарт лишить порожній реєстр, live-reload відмовить атомарно): ${(e as Error).message}` })
    return { value: defaultsDeep(schema), warnings }
  }
  const kind = resolveConfigKind(schema)
  const value = coerceObject(schema, raw, '', kind, warnings)
  return { value, warnings }
}

// ---- Розпізнавання ConfigKind кореневої схеми --------------------------------------------
// STALE_KEYS у schema.ts прив'язаний до ConfigKind, а не до конкретної ObjectSchema (те
// саме ім'я поля може бути застарілим у корені або десь у вкладеній схемі того самого
// конфігу). parseConfig отримує лише ObjectSchema, тож ConfigKind визначається один раз
// на вхід у SCHEMAS за посиланням (усі top-level схеми — ті самі об'єкти, що й у SCHEMAS)
// і несеться крізь рекурсію без змін. Схема, якої немає в реєстрі (наприклад, тестова
// міні-схема), просто не бере участі в перевірці застарілих ключів — це не помилка.
function resolveConfigKind(schema: ObjectSchema): ConfigKind | undefined {
  for (const kind of Object.keys(SCHEMAS) as ConfigKind[]) {
    if (SCHEMAS[kind] === schema) return kind
  }
  return undefined
}

// Глибока копія довільного JSON-сумісного значення (всі def у схемі — числа/рядки/bool/
// масиви/плоскі об'єкти, без функцій і дат) — саме тому, що types.ts documents: field.def
// є СПІЛЬНИМ літералом на всі виклики parseConfig, і повертати його як є означало б, що
// мутація value одного розбору псує дефолт для всіх наступних.
function deepClone<T>(v: T): T {
  return structuredClone(v)
}

function defaultsDeep(schema: ObjectSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of schema.fields) out[field.name] = deepClone(field.def)
  return out
}

// ---- Політика відсутнього ключа (рев'ю W1, Important, рішення фінального рев'ю 2026-08-06) --
// ДВІ різні "типові значення", які треба не плутати:
//   - defaultsDeep/deepClone(field.def) вище — ІНІЦІАЛІЗАТОР Enforce-класу (Enabled=true,
//     Quantity=1, Chance=1.0...). Використовується ТІЛЬКИ коли вхідні дані зовсім не
//     годяться як об'єкт цієї схеми (не JSON, null/масив замість об'єкта) — тобто коли
//     немає жодного шматка документа, який рушій міг би розібрати як цей клас узагалі.
//   - zeroValue/zeroObject нижче — те, що РЕАЛЬНО кладе в поле сам рушій (JsonFileLoader),
//     коли об'єкт У ЦІЛОМУ розпізнаний, але КОНКРЕТНИЙ ключ у ньому відсутній: нуль свого
//     типу (0 / 0.0 / false / '' / порожній масив), а не ініціалізатор класу. Підтверджено
//     кодом мода (ZP_ProcessingConfig.c:222-236 і аналогічні місця JsonFileLoader<T>.LoadFile)
//     і задокументовано в CLAUDE.md ("відсутній ключ ≠ дефолт ініціалізатора"). До цього
//     фіксу парсер помилково використовував тут field.def — канонізація старого файлу з
//     відсутнім ключем МОГЛА Б МОВЧКИ ЗМІНИТИ ПОВЕДІНКУ (наприклад, вимкнене адміном правило
//     без ключа "Enabled" канонізувалося б у "Enabled": 1).
// field.def лишається джерелом істини лише для (а) створення НОВИХ сутностей у майбутньому
// UI (W2, types.ts.defaultsFor) і (б) емісійного фолбека serialize()/emitObject для вручну
// сконструйованих значень — сам парсер його для відсутніх ключів більше не читає.
//
// ТРЕТІЙ випадок (W2 Task 4, рев'ю фікс-раунд 1, Important; severity — W2.5 Task 3): ключ
// ПРИСУТНІЙ, але його JSON-значення НЕ ТОГО ТИПУ (рядок замість числа, bool замість
// float...) — coerceInt/coerceFloat/coerceBool/coerceString нижче теж падають на
// zeroValue цього поля, а НЕ на field.def. Причина та сама, що й для відсутнього ключа:
// field.def повернув би саме ту небезпеку, яку фінальний фікс W1 прибрав для відсутніх
// ключів ("Enabled": "так" канонізувалося б у "Enabled": 1 — мовчазне ввімкнення
// вимкненого адміном правила).
// [ПІДТВЕРДЖЕНО T8-зондом, W2.5 Task 3 — раніше тут стояло "емпірично не перевірено"]
// На відміну від відсутнього ключа (JsonFileLoader мовчки лишає нуль поля, файл
// вантажиться), хибний ТИП присутнього ключа рушій НЕ пробачає: ЗАВАНТАЖЕННЯ ЦЬОГО
// КОНФІГ-ФАЙЛУ ЦІЛКОМ ПРОВАЛюється (TryLoadX повертає false — приклад структури,
// спільної для всіх восьми конфігів, ZP_ConfigService.c:376-393 LoadSampleTypes/
// TryLoadSampleTypes/SaveSampleTypes). На боті (ServerLoad) кожен із восьми конфігів
// вантажиться НЕЗАЛЕЖНО (не атомарно між файлами — провал одного не чіпає інші), але
// ВСЕРЕДИНІ одного файлу відповідь все-або-нічого: жодного "занулити тільки це поле і
// вантажити решту" рушій не робить, лишається м'яко деградована/попередня конфігурація.
// Єдиний шлях, де провал одного з восьми конфігів НЕ застосовується частково, —
// адмінський `OpReloadAll`: він гейтить коміт УСІХ восьми одним `||`-ланцюгом
// (task-2-report.md, п.2) до того, як бодай один m_X = freshX/SaveX() виконається.
// Нуль свого типу тут лишається безпечним значенням ЛИШЕ для показу в редакторі й для
// повторного канонічного запису (canonicalize -> Зберегти перезаписує байти файлу з цим
// полем як 0/false/''/[] — байт-валідний файл, який рушій дійсно завантажить); сам факт,
// що НЕ канонізований файл на диску зараз ЦІЛКОМ провалить завантаження, підіймає це
// попередження до severity: 'alarm' (не просто warn) — власник прямо просив підняти
// тривожність кривих типів, wrongTypeNote() нижче несе точний текст пояснення.
function zeroValue(t: FieldType): unknown {
  switch (t.kind) {
    case 'int':
    case 'float':
      return 0
    case 'bool':
      return false
    case 'string':
      return ''
    case 'string[]':
    case 'object[]':
      return []
    case 'object':
      return zeroObject(t.schema)
  }
}

function zeroObject(schema: ObjectSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of schema.fields) out[field.name] = zeroValue(field.type)
  return out
}

function describeZero(t: FieldType): string {
  switch (t.kind) {
    case 'int':
    case 'float':
      return '0'
    case 'bool':
      return 'false'
    case 'string':
      return "''"
    case 'string[]':
    case 'object[]':
      return '[]'
    case 'object':
      return "{} (кожне поле об'єкта — нуль свого типу)"
  }
}

function describeClassDefault(fd: FieldDef): string {
  try {
    return JSON.stringify(fd.def)
  } catch {
    return String(fd.def)
  }
}

function describeType(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'масив'
  return typeof v
}

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}.${name}` : name
}

// ---- Об'єкт (і сам корінь документа, і будь-яке вкладене object-поле) --------------------
function coerceObject(
  schema: ObjectSchema,
  raw: unknown,
  path: string,
  kind: ConfigKind | undefined,
  warnings: Warning[],
): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push({
      path: path || schema.name,
      message: `очікувався об'єкт (${schema.name}), отримано ${describeType(raw)} — використано типові значення`,
    })
    return defaultsDeep(schema)
  }

  const src = raw as Record<string, unknown>
  const out: Record<string, unknown> = {}

  for (const field of schema.fields) {
    const fieldPath = joinPath(path, field.name)
    if (Object.prototype.hasOwnProperty.call(src, field.name)) {
      out[field.name] = coerceValue(field, src[field.name], fieldPath, kind, warnings)
    } else {
      out[field.name] = zeroValue(field.type)
      warnings.push({
        path: fieldPath,
        message:
          `ключ відсутній: рушій читає його як ${describeZero(field.type)} — збереження ` +
          `зафіксує це явно; типове значення класу — ${describeClassDefault(field)}`,
      })
    }
  }

  for (const key of Object.keys(src)) {
    if (schema.fields.some((fd) => fd.name === key)) continue
    const keyPath = joinPath(path, key)
    if (kind !== undefined && isStaleKey(kind, key)) {
      warnings.push({
        path: keyPath,
        message: `застарілий ключ '${key}' скасовано — буде відкинуто при збереженні`,
      })
    } else {
      warnings.push({ path: keyPath, message: 'невідомий ключ, буде відкинуто при збереженні' })
    }
  }

  return out
}

function coerceObjectArray(
  schema: ObjectSchema,
  raw: unknown,
  path: string,
  kind: ConfigKind | undefined,
  warnings: Warning[],
): Record<string, unknown>[] {
  if (!Array.isArray(raw)) {
    warnings.push({
      path,
      message: `очікувався масив об'єктів, отримано ${describeType(raw)} — використано порожній масив`,
    })
    return []
  }
  return raw.map((item, idx) => coerceObject(schema, item, `${path}[${idx}]`, kind, warnings))
}

// ---- Скалярні та масивні типи -------------------------------------------------------------

// Спільний хвіст попередження для хибнотипізованого ПРИСУТНЬОГО скалярного значення —
// див. коментар над zeroValue вище (третій випадок). Один рядок на чотири coerceXxx, аби
// формулювання (і посилання на T8-зонд) не розійшлися. Текст і severity: 'alarm' на
// виклику — власник прямо просив підняти тривожність цього конкретного випадку (єдиного
// з попереджень парсера, де підтверджено повне відхилення файлу рушієм).
function wrongTypeNote(): string {
  return (
    ' — рушій відхилить УВЕСЬ файл при рестарті — збережіть через редактор, щоб полагодити ' +
    '(T8-зонд: завантаження на боті по конфігах незалежне, але ВСЕРЕДИНІ одного файлу — ' +
    'все-або-нічого, ZP_ConfigService.c:383-393; атомарний лише адмінський OpReloadAll)'
  )
}

function coerceInt(raw: unknown, path: string, warnings: Warning[]): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    warnings.push({
      path,
      message: `очікувалось ціле число, отримано ${describeType(raw)}${wrongTypeNote()}`,
      severity: 'alarm',
    })
    return 0
  }
  let n = raw
  if (!Number.isInteger(n)) {
    warnings.push({ path, message: 'дробове значення у цілочисельному полі — обрізано до цілого' })
    n = Math.trunc(n)
  }
  if (n < INT32_MIN || n > INT32_MAX) {
    warnings.push({ path, message: 'значення поза межами int32' })
  }
  return n
}

// Квантування до float32 — очікувана семантика читання (рушій сам зберігає лише float32),
// НЕ помилка: 0.4 з файлу і 0.4000000059604645 (той самий float32, друкований fmtFloat)
// мають дати одне й те саме число, без жодного попередження.
function coerceFloat(raw: unknown, path: string, warnings: Warning[]): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    warnings.push({
      path,
      message: `очікувалось число, отримано ${describeType(raw)}${wrongTypeNote()}`,
      severity: 'alarm',
    })
    return 0
  }
  return Math.fround(raw)
}

// Рушій пише bool як 1/0 (emitValue у jsonWriter.ts), тож 0/1 приймаються нарівні з
// true/false. Результат — ЗАВЖДИ справжній JS boolean: emitValue дивиться лише на
// істинність значення (v ? '1' : '0'), тож будь-що інше (наприклад, рядок "0") дало б
// хибне "1" при повторному записі. Тому тут немає гілки "інше число -> !!raw" — тільки
// точно 1/0/true/false, все решта вважається помилкою формату з нульовим значенням
// (false — навмисно НЕ дефолт поля, дивись wrongTypeNote/коментар над zeroValue).
function coerceBool(raw: unknown, path: string, warnings: Warning[]): boolean {
  if (raw === true || raw === false) return raw
  if (raw === 1 || raw === 0) return raw === 1
  warnings.push({
    path,
    message: `очікувалось bool (true/false або 1/0), отримано ${describeType(raw)}${wrongTypeNote()}`,
    severity: 'alarm',
  })
  return false
}

function coerceString(raw: unknown, path: string, warnings: Warning[]): string {
  if (typeof raw === 'string') return raw
  warnings.push({
    path,
    message: `очікувався рядок, отримано ${describeType(raw)}${wrongTypeNote()}`,
    severity: 'alarm',
  })
  return ''
}

function coerceStringArray(raw: unknown, path: string, warnings: Warning[]): string[] {
  if (!Array.isArray(raw)) {
    warnings.push({
      path,
      message: `очікувався масив рядків, отримано ${describeType(raw)} — використано порожній масив`,
    })
    return []
  }
  return raw.map((item, idx) => coerceString(item, `${path}[${idx}]`, warnings))
}

function coerceValue(
  fd: FieldDef,
  raw: unknown,
  path: string,
  kind: ConfigKind | undefined,
  warnings: Warning[],
): unknown {
  const t = fd.type
  switch (t.kind) {
    case 'int':
      return coerceInt(raw, path, warnings)
    case 'float':
      return coerceFloat(raw, path, warnings)
    case 'bool':
      return coerceBool(raw, path, warnings)
    case 'string':
      return coerceString(raw, path, warnings)
    case 'string[]':
      return coerceStringArray(raw, path, warnings)
    case 'object':
      return coerceObject(t.schema, raw, path, kind, warnings)
    case 'object[]':
      return coerceObjectArray(t.schema, raw, path, kind, warnings)
  }
}
