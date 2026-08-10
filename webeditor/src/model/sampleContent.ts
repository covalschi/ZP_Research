// Авто-визначення Content для виходів-зразків (W2 Task 6). Директива власника, що
// надійшла ПІД ЧАС виконання цього таска (2026-08-06/07): Content зразка — це НЕ мітка,
// яку вигадує адмін, а буквально НАЗВА СИРОВИНИ (InputItem.Classname ТОГО САМОГО правила).
// Жодних змін формату файлу — Content лишається звичайним рядком (RULE_OUTPUT_SCHEMA,
// schema.ts) — редактор лише підказує/автозаповнює його значення для рядків Outputs[],
// чий Classname є ZP_Sample (чи його підкласом).
//
// "Авто" визначається СТРУКТУРНО — без окремого прапорця в JSON і без окремого
// React-стану на кожен рядок: значення вважається авто, поки воно ПОРОЖНЄ АБО дорівнює
// вже відомому авто-значенню (isAutoContent). Ручна правка, що дала ІНШИЙ непорожній
// рядок, перестає бути авто — і каскад зміни InputItem.Classname (deriveOutputContent)
// більше НЕ чіпає цей рядок. Кнопка "повернути авто" (RulePanel.tsx) просто присвоює
// поточне авто-значення напряму — після цього рядок знову задовольняє isAutoContent і
// знову підхоплює НАСТУПНІ зміни InputItem.Classname.
//
// Тому цілий "стейт-машин" з брифа директиви — це ДВІ чисті функції без прихованого
// стану: isAutoContent (класифікація "чи це досі авто?") і deriveOutputContent (каскад
// одного редагування InputItem.Classname). Жодного Set/Map з індексами рядків тримати
// не треба — react-стан ПОВНІСТЮ похідний від самого документа Project у кожен момент.

import type { ClassIndex } from './classIndex'
import { isKindOf, stripExact } from './classIndex'

// Дзеркало ZP_ProcessingConfig.c:352-363 IsSampleClass (`GetGame().IsKindOf(StripExact(...),
// "ZP_Sample_Base")`) — визначає, чи Content цього конкретного Outputs[]-рядка взагалі має
// сенс. РОДИНА, А НЕ ОДИН КЛАС (W2.5 Task 1/3, той самий шов, що й на сервері): база —
// 'ZP_Sample_Base', НЕ 'ZP_Sample' — сумісний клас ZP_Sample і всі тридцять донорів моделі
// ZP_Sample_01..30 успадковують саме від ZP_Sample_Base (config.cpp), тож перевірка на
// голий 'ZP_Sample' відхиляла б Content для будь-якого з тридцяти нових класів (той самий
// дефект, заради якого T1 грепом шукав кожне місце «лише ZP_Sample» у моді — тут його
// дзеркало у веб-редакторі).
export function isSampleClass(index: ClassIndex, classname: string): boolean {
  return isKindOf(index, stripExact(classname), 'ZP_Sample_Base')
}

// listSampleFamilyClasses (W2.5 Task 4, вікно «Типовий зразок») — перелік КОНКРЕТНИХ
// класів родини ZP_Sample_Base у поточному ClassIndex: рівно ті класи, які ValidateItem
// (ZP_SampleTypesConfig.c:65, `IsKindOf(d.Id, "ZP_Sample_Base")`) прийняв би як Id типу
// зразка -- сумісний ZP_Sample + тридцять донорів ZP_Sample_01..30 (config.cpp,
// gen-sample-classes.ps1, W2.5 Task 1). Перевірено вживу генератором індексу: рівно 31
// збіг у бандлі classindex.json.
//
// Абстрактний корінь ZP_Sample_Base САМ виключений явно: isKindOf(cls, base) повертає
// true й для cls===base (клас "є видом самого себе"), а ValidateItem технічно пропустив
// би запис із Id="ZP_Sample_Base" -- але це scope=0 носій спільного коду/сторажу
// (ZP_Sample.c), не реальний предмет гравця, і в config.cpp жоден рецепт/генератор ніколи
// не породжує сутність саме цього класу. Вікно НЕ показує його як окремий рядок.
//
// Сканує ВЕСЬ ClassIndex через isSampleClass (isKindOf) замість жорсткого масиву назв
// 'ZP_Sample_01'..'ZP_Sample_30' -- єдине джерело істини лишається сам ClassIndex
// (build\gen-classindex.py), а не другий список, синхронізований вручну з
// gen-sample-classes.ps1: якщо майбутня сесія додасть 31-го донора, вікно підхопить
// його без правки цього файлу. Результат сортується звичайним `.sort()` (UTF-16
// кодове порівняння, без локалі) -- для ASCII-імен з нуль-доповненням ("_01".."_30")
// це водночас і алфавітний, і числовий порядок; короткий "ZP_Sample" (сумісний клас)
// лексикографічно менший за будь-який "ZP_Sample_NN" (власний префікс -> коротший
// рядок іде першим), тож сумісний клас природно опиняється на початку списку.
export function listSampleFamilyClasses(index: ClassIndex): string[] {
  const out: string[] = []
  for (const row of index.classes) {
    const name = row[0]
    if (name.toLowerCase() === 'zp_sample_base') continue
    if (isSampleClass(index, name)) out.push(name)
  }
  return out.sort()
}

// content — поточне значення поля Outputs[i].Content; referenceAutoValue — авто-значення,
// з яким порівнюємо. Два різні виклики:
//   - для ВІДОБРАЖЕННЯ бейджа авто/ручне (RulePanel) — referenceAutoValue = ПОТОЧНИЙ
//     rule.InputItem.Classname;
//   - усередині deriveOutputContent нижче — referenceAutoValue = СТАРИЙ (до цієї
//     конкретної правки) rule.InputItem.Classname.
// Порожній рядок — ЗАВЖДИ авто (новододаний рядок, ще нічого не введено).
export function isAutoContent(content: string, referenceAutoValue: string): boolean {
  return content === '' || content === referenceAutoValue
}

// Каскад ОДНІЄЇ правки InputItem.Classname: якщо content і досі "авто" відносно
// СТАРОГО значення — підхоплює НОВЕ; інакше (ручне значення, адмін уже перевизначив)
// лишається без змін. prevInputClassname/nextInputClassname беруться з ОДНОГО й того
// самого редагування (RulePanel.tsx commitInputClassname читає rule.InputItem.Classname
// ДО мутації як prev, записаний нею ж рядок — як next) — не зі збереженого React-стану,
// тож ланцюжок із кількох послідовних змін InputItem.Classname коректно накопичує
// "авто/ручне" без жодної додаткової пам'яті між викликами.
export function deriveOutputContent(content: string, prevInputClassname: string, nextInputClassname: string): string {
  return isAutoContent(content, prevInputClassname) ? nextInputClassname : content
}
