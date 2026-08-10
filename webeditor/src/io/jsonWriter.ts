// Канонічний серіалізатор конфігів ZP_Research: відтворює БАЙТИ, які пише JsonFileLoader
// самого рушія (DayZ 1.29). Еталон — tests/fixtures/gold/* (файли, написані рушієм при
// SetDefaults(), див. tests/fixtures/README.md). Формат, звірений із байтами:
//   - UTF-8 без BOM, розділювач рядків LF, БЕЗ завершального LF (останній байт '}');
//   - відступ 4 пробіли на рівень; порядок ключів = порядок оголошення полів у
//     Enforce-класі (його несе ObjectSchema); ВСІ поля схеми пишуться явно;
//   - bool -> 1/0; int -> як є; порожній масив -> інлайн []; непорожній -> елемент на рядок;
//   - кирилиця та інший не-ASCII текст — сирим UTF-8 (екранування JSON.stringify:
//     лише лапки, бекслеш і керівні символи);
//   - float — за алгоритмом принтера рушія, зламаним емпірично (Phase A), див. fmtFloat.
//
// ==== Алгоритм float-принтера рушія (Phase A: ЗЛАМАНО, доведено на фікстурах) ===========
// Рушій зберігає float32; при записі розширює його до double d (без втрат) і друкує
// НАЙКОРОТШЕ ДЕСЯТКОВЕ ОБРІЗАННЯ (truncation, ніколи не округлення вгору) ВЕРХНЬОЇ
// СЕРЕДИНИ інтервалу округлення double:
//     up = d + ulpAbove(d)/2,   lo = d - ulpBelow(d)/2
//     відповідь P = найкоротший десятковий префікс up (обрізаний, БЕЗ округлення
//     останньої цифри) такий, що P > lo;  ціле значення отримує суфікс ".0".
// Це класична схема Steele-White без гілки "round up": цифри генеруються з верхньої межі
// й ОБРІЗАЮТЬСЯ. Тому:
//   0.2f  -> 0.20000000298023225 (17 цифр; коректно округлений найкоротший був би ...224)
//   0.3f  -> 0.30000001192092898 (...896 у коректному округленні)
//   0.4f  -> 0.4000000059604645  (16 цифр — збігається з JS-найкоротшим випадково)
//   0.8f  -> 0.800000011920929   (15 цифр)
//   0.25/0.5 -> точні короткі; 1 -> 1.0; 10 -> 10.0
// Доказова база: всі 6 різних float-рядків gold/* відтворені точно; бонусом ті самі
// правила відтворюють і всі float-рядки live/chain.json (отже "17 цифр завжди" з
// fixtures/README.md — хибне узагальнення: довжина у принтера рушія змінна).
// P завжди лежить у (lo, up] -> парситься назад РІВНО в d -> раунд-тріп точний
// (властивість перевірена тестом на 50к випадкових float32).
// Уся арифметика тут точна (BigInt), жодного накопичення похибок.

import type { ObjectSchema, FieldType } from '../model/types'

export function fmtFloat(x: number): string {
  const q = Math.fround(x)
  if (!Number.isFinite(q)) throw new Error('float поза діапазоном float32: ' + x)
  if (q === 0) return '0.0' // і +0, і -0: знак нуля в конфігах сенсу не має
  const neg = q < 0
  const a = neg ? -q : q

  // Розкладання double a = M * 2^E (точне, через IEEE754-біти).
  const dv = new DataView(new ArrayBuffer(8))
  dv.setFloat64(0, a)
  const bits = dv.getBigUint64(0)
  const expBits = Number((bits >> 52n) & 0x7ffn)
  const mantBits = bits & 0xfffffffffffffn
  let M: bigint
  let E: number
  if (expBits === 0) {
    M = mantBits
    E = -1074
  } else {
    M = mantBits | (1n << 52n)
    E = expBits - 1075
  }

  // Межі інтервалу округлення у чвертях ulp: value = 4M * 2^(E-2).
  // На межі степеня двійки крок вниз удвічі менший за крок угору.
  const isPow2 = mantBits === 0n && expBits > 1
  const upN = M * 4n + 2n
  const loN = M * 4n - (isPow2 ? 1n : 2n)
  const S = E - 2

  // Точне десяткове подання: value = N * 2^S = (N * 5^f) / 10^f при S < 0 (f = -S),
  // або ціле N << S при S >= 0 (f = 0).
  let f: number
  let upD: bigint
  let loD: bigint
  if (S >= 0) {
    f = 0
    upD = upN << BigInt(S)
    loD = loN << BigInt(S)
  } else {
    f = -S
    const p5 = 5n ** BigInt(f)
    upD = upN * p5
    loD = loN * p5
  }

  // Найгрубіше обрізання: max t (відкинутих молодших десяткових цифр upD),
  // за якого обрізане P ще СТРОГО більше lo. t=0 підходить завжди (up > lo).
  const upStr = upD.toString()
  let keep = upD
  let t = upStr.length - 1
  for (; t >= 0; t--) {
    const pow = 10n ** BigInt(t)
    keep = upD / pow
    if (keep * pow > loD) break
  }

  // Рендер P = keep * 10^(t-f): або ціле з ".0", або з дробовою частиною f-t цифр.
  let out: string
  if (t >= f) {
    out = keep.toString() + '0'.repeat(t - f) + '.0'
  } else {
    const fracDigits = f - t
    let s = keep.toString()
    if (s.length <= fracDigits) s = '0'.repeat(fracDigits - s.length + 1) + s
    out = s.slice(0, s.length - fracDigits) + '.' + s.slice(s.length - fracDigits)
  }
  const text = (neg ? '-' : '') + out

  // Запобіжник від псування конфігів: результат зобов'язаний парситись назад у той самий
  // float32. За доведеним алгоритмом це неможливо порушити; якщо колись порушиться —
  // краще виняток, ніж мовчки зіпсований файл сервера.
  if (Math.fround(Number(text)) !== q) {
    throw new Error('fmtFloat: втрата значення при раунд-тріпі: ' + x + ' -> ' + text)
  }
  return text
}

// ==== Серіалізація за схемою ============================================================

const IND = '    ' // 4 пробіли — звірено з усіма gold-фікстурами

/** Текст файла БЕЗ завершального LF (останній байт — '}'), розділювачі LF. */
export function serialize(schema: ObjectSchema, value: unknown): string {
  return emitObject(schema, value as Record<string, unknown>, 0)
}

/** Байти файла: UTF-8 без BOM. */
export function encodeConfig(schema: ObjectSchema, value: unknown): Uint8Array {
  return new TextEncoder().encode(serialize(schema, value))
}

function emitObject(sc: ObjectSchema, v: Record<string, unknown> | null | undefined, d: number): string {
  const pad = IND.repeat(d + 1)
  const out: string[] = ['{']
  sc.fields.forEach((fd, i) => {
    // Відсутнє поле добивається дефолтом схеми — рушій пише ВСІ поля завжди.
    const val = v != null && fd.name in v ? v[fd.name] : fd.def
    out.push(
      pad + JSON.stringify(fd.name) + ': ' + emitValue(fd.type, val, d + 1) + (i === sc.fields.length - 1 ? '' : ','),
    )
  })
  out.push(IND.repeat(d) + '}')
  return out.join('\n')
}

function emitValue(t: FieldType, v: unknown, d: number): string {
  switch (t.kind) {
    case 'int': {
      const n = Math.trunc(Number(v ?? 0))
      if (!Number.isSafeInteger(n)) throw new Error('int поза безпечним діапазоном: ' + String(v))
      return String(n)
    }
    case 'float':
      return fmtFloat(Number(v ?? 0))
    case 'bool':
      // Рушій пише 1/0; на вході приймаємо і JS true/false, і 1/0 після JSON.parse.
      return v ? '1' : '0'
    case 'string':
      return JSON.stringify(v == null ? '' : String(v))
    case 'string[]':
      return emitArr((v ?? []) as unknown[], d, (x) => JSON.stringify(x == null ? '' : String(x)))
    case 'object':
      return emitObject(t.schema, v as Record<string, unknown> | null | undefined, d)
    case 'object[]':
      return emitArr((v ?? []) as unknown[], d, (x) =>
        emitObject(t.schema, x as Record<string, unknown> | null | undefined, d + 1),
      )
  }
}

function emitArr(items: unknown[], d: number, one: (x: unknown) => string): string {
  if (!items.length) return '[]' // порожній масив — інлайн, звірено з gold/DataItems.json
  const pad = IND.repeat(d + 1)
  return (
    '[\n' + items.map((x, i) => pad + one(x) + (i === items.length - 1 ? '' : ',')).join('\n') + '\n' + IND.repeat(d) + ']'
  )
}
