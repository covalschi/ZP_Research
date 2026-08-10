// Схема-DSL: типи полів і конструктори-хелпери для декларативних описів семи конфігів
// (див. schema.ts). Порядок елементів у ObjectSchema.fields мусить збігатися з порядком
// оголошення в Enforce-класі — саме на ньому тримається байт-точна серіалізація (Task 4)
// і повідомлення терпимого парсера (Task 5).

export type FieldType =
  | { kind: 'int' }
  | { kind: 'float' }
  | { kind: 'bool' }
  | { kind: 'string' }
  | { kind: 'string[]' }
  | { kind: 'object'; schema: ObjectSchema }
  | { kind: 'object[]'; schema: ObjectSchema }

export interface FieldDef {
  name: string
  type: FieldType
  def: unknown
}

export interface ObjectSchema {
  name: string
  fields: FieldDef[]
}

// Вісім конфігів веб-редактора (sampleTypes додано W2.5 Task 3 — дзеркало dataItems,
// ZP_SampleTypesConfig.c). StaticDevices.json свідомо не входить — це файл спавнера
// статиків (окрема підсистема), а не один із восьми конфігів редактора.
export type ConfigKind =
  | 'settings'
  | 'pointTypes'
  | 'rules'
  | 'techTree'
  | 'factions'
  | 'dataItems'
  | 'modules'
  | 'sampleTypes'

// ---- Хелпери-конструктори -----------------------------------------------------------
// Дефолти тут — це дефолти ТИПУ ("немає ініціалізатора в .c" -> 0 / false / '' / []),
// а не дефолти конкретного поля: для полів з явним ініціалізатором (Enabled = true,
// Quantity = 1 і т.д.) виклик у schema.ts передає def другим аргументом.

export function i(name: string, def = 0): FieldDef {
  return { name, type: { kind: 'int' }, def }
}

export function f(name: string, def = 0): FieldDef {
  return { name, type: { kind: 'float' }, def }
}

export function b(name: string, def = false): FieldDef {
  return { name, type: { kind: 'bool' }, def }
}

export function s(name: string, def = ''): FieldDef {
  return { name, type: { kind: 'string' }, def }
}

export function sarr(name: string): FieldDef {
  return { name, type: { kind: 'string[]' }, def: [] as string[] }
}

// Дефолт вкладеного об'єкта складається з дефолтів ЙОГО ПОЛІВ — так само, як Enforce
// ініціалізує `ref X f = new X();`: кожне поле X отримує власний ініціалізатор класу X.
// Єдине джерело правди — самі поля X, дублювати дефолти окремо для кожного contain-поля
// не треба.
export function defaultsFor(schema: ObjectSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of schema.fields) {
    out[field.name] = field.def
  }
  return out
}

export function obj(name: string, schema: ObjectSchema): FieldDef {
  return { name, type: { kind: 'object', schema }, def: defaultsFor(schema) }
}

export function oarr(name: string, schema: ObjectSchema): FieldDef {
  return { name, type: { kind: 'object[]', schema }, def: [] as unknown[] }
}
