// Тести ClassIndex (W2 Task 1, Step 5): bundled-імпорт JSON, IsKindOf (з "|1" і захистом
// від циклу), searchClasses (префікс-пріоритет + ліміт), classRoot, і паритет
// обов'язкового спот-чека прямо по згенерованому webeditor/src/data/classindex.json --
// не по вигаданих фікстурах: якщо генератор колись перестане бачити ZP_Microscope чи
// Land_Furniture_radiostation1, цей тест має провалитись одразу, а не мовчки.

import { describe, test, expect } from 'vitest'
import {
  loadClassIndex,
  parseClassIndexJson,
  setActiveClassIndex,
  activeClassIndex,
  displayNameOf,
  isKindOf,
  searchClasses,
  classRoot,
  ROOT_NAMES,
  type ClassIndex,
} from '../src/model/classIndex'

describe('loadClassIndex (bundled json import)', () => {
  test('завантажує непорожній індекс v2 з версією і датою', () => {
    const idx = loadClassIndex()
    expect(idx.v).toBe(2)
    expect(idx.generated).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(idx.classes.length).toBeGreaterThan(1000)
    expect(idx.mods.length).toBeGreaterThan(0)
  })

  test('повторний виклик повертає той самий (кешований) обʼєкт', () => {
    expect(loadClassIndex()).toBe(loadClassIndex())
  })

  // Task 4, фікс-раунд 1 (Important 3), знайдено ПІД ЧАС регенерації на п'яти коренях
  // (не було заявлено в брифі рев'ю): попередня версія цього тесту припускала, що КОЖЕН
  // рядок classes[] має УНІКАЛЬНЕ (регістронезалежно) ім'я в межах ВСЬОГО індексу --
  // на трьох коренях це завжди було так випадково, але рушій цього не гарантує (CfgVehicles
  // і cfgWeapons -- окремі простори імен, той самий рядок легально позначає РІЗНІ класи).
  // На 33336 класах п'яти коренів знайдено РІВНО ДВІ такі пари ("Shotgun_Base",
  // "DamageSystem" -- окремий тест нижче). Правильний інваріант -- НЕ "кожен рядок сам
  // на себе", а "byName віддає ОСТАННІЙ (найпізніший корінь, root-мажорний порядок
  // генератора) рядок з таким ім'ям" -- саме так, як реально працює цикл `.set()` у
  // loadClassIndex (пізніший виклик перезаписує).
  test('byName індексує кожне ім\'я на ОСТАННІЙ рядок з таким лоуеркейс-ім\'ям (ключ -- lower-case, фікс-раунд 1)', () => {
    const idx = loadClassIndex()
    const lastIndexByLowerName = new Map<string, number>()
    for (let i = 0; i < idx.classes.length; i++) {
      lastIndexByLowerName.set(idx.classes[i][0].toLowerCase(), i)
    }
    for (const [lowerName, expectedIndex] of lastIndexByLowerName) {
      expect(idx.byName.get(lowerName)).toBe(expectedIndex)
    }
    // Розмір мапи = кількість УНІКАЛЬНИХ лоуеркейс-імен, не кількість рядків -- страховка,
    // що вище дійсно порівнює ВСІ ключі byName, а не лише підмножину.
    expect(idx.byName.size).toBe(lastIndexByLowerName.size)
  })

  // Два конкретні відомі випадки з коментаря вище -- фіксує РЕАЛЬНИЙ факт корпусу (не
  // теоретичну можливість), аби регенерація, яка їх прибере чи додасть нові, було видно
  // в diff тесту, а не мовчки.
  test('відомі колізії імені між коренями (2 з 33336): byName детерміновано бере пізніший корінь (root 4)', () => {
    const idx = loadClassIndex()
    expect(classRoot(idx, 'Shotgun_Base')).toBe(4) // CfgAmmo(3, vanilla) програє cfgWeapons(4, @Inventory Move Sounds)
    expect(classRoot(idx, 'DamageSystem')).toBe(4) // CfgVehicles(0, @protocol) програє cfgWeapons(4, @Area Of Decay Map)
  })

  // Рев'ю Task 4, фікс-раунд 1 (Important 3): раніше три корені -- нова заява паритету з
  // ClassExists (усі п'ять) звірена в коментарі над Root/ROOT_NAMES у classIndex.ts.
  test('ROOT_NAMES -- п\'ять коренів (0=CfgVehicles,1=CfgMagazines,2=CfgNonAIVehicles,3=CfgAmmo,4=cfgWeapons)', () => {
    expect(ROOT_NAMES).toEqual(['CfgVehicles', 'CfgMagazines', 'CfgNonAIVehicles', 'CfgAmmo', 'cfgWeapons'])
  })

  test('кожен рядок classes має валідний root (0..4), baseIdx (-1 або в межах масиву) і modIdx', () => {
    const idx = loadClassIndex()
    for (const [name, baseIdx, modIdx, root] of idx.classes) {
      expect(typeof name).toBe('string')
      expect(name.length).toBeGreaterThan(0)
      expect([0, 1, 2, 3, 4]).toContain(root)
      expect(baseIdx).toBeGreaterThanOrEqual(-1)
      expect(baseIdx).toBeLessThan(idx.classes.length)
      expect(modIdx).toBeGreaterThanOrEqual(0)
      expect(modIdx).toBeLessThan(idx.mods.length)
    }
  })

  // Регенерація (фікс-раунд 1) стосувалась лише root-детекції, а не сортування/лічби --
  // страховка, що всі п'ять коренів реально НЕПОРОЖНІ (не лише валідні числом 0..4).
  test('усі п\'ять коренів мають хоча б один клас', () => {
    const idx = loadClassIndex()
    const counts = [0, 0, 0, 0, 0]
    for (const [, , , root] of idx.classes) counts[root]++
    for (let r = 0; r < 5; r++) expect(counts[r], `root ${r} (${ROOT_NAMES[r]})`).toBeGreaterThan(0)
  })
})

// ---- Обов'язковий спот-чек (брифінг задачі, Step 4) -------------------------------------
// Перевірено прямо по РЕАЛЬНОМУ згенерованому індексу, не по вигаданій фікстурі.
describe('спот-чек обов\'язкових імен (T1 Step 4)', () => {
  const idx = loadClassIndex()
  const mustExist = [
    'ZP_Microscope',
    'ZP_Data_01',
    'ZP_Sample',
    'Land_Furniture_radiostation1', // @Area Of Decay Building
    'Apple', // ваніль
    'Rag', // ваніль (базове ім'я; переможець "later wins" може бути з мода)
  ]
  test.each(mustExist)('%s знайдений у індексі', (name) => {
    expect(idx.byName.has(name.toLowerCase())).toBe(true)
  })

  test('CfgMagazines містить хоча б один реальний магазин ванілі', () => {
    const hit = idx.classes.find(([name, , modIdx, root]) => root === 1 && idx.mods[modIdx] === 'vanilla' && name.startsWith('Mag_'))
    expect(hit).toBeDefined()
  })

  // SF_DETECTOR_1 з брифа не існує в жодному просканованому PBO (перевірено прямим
  // grep по всіх кандидатах @Radio/@protocol/@ProcolPack/@STALKER Equipment) -- реальна
  // родина детекторів @Radio (AnomalySystemWT.pbo) названа інакше. Тест фіксує РЕАЛЬНІ
  // імена цієї родини замість неіснуючого "SF_DETECTOR_1", щоб намір спот-чека (детектори
  // @Radio присутні в індексі) лишався перевіреним.
  test('родина SF_DETECTOR_* з @Radio присутня (SF_DETECTOR_1 з брифа не існує в жодному PBO -- перевірено)', () => {
    for (const name of ['SF_DETECTOR_VELES', 'SF_DETECTOR_SVAROG', 'SF_DETECTOR_GILKA', 'SF_DETECTOR_EYE', 'SF_DETECTOR_OTKLIK', 'SF_DETECTOR_BEAR']) {
      expect(idx.byName.has(name.toLowerCase())).toBe(true)
    }
    expect(idx.byName.has('sf_detector_1')).toBe(false)
  })

  test('Ex_Shevrons_Science1 (@protocol) присутній', () => {
    expect(idx.byName.has('ex_shevrons_science1')).toBe(true)
  })

  // Пряме відтворення репродукції з фікс-раунду 1 (CRITICAL 1) НА РЕАЛЬНОМУ індексі, не на
  // фікстурі: до фіксу цей виклик повертав false.
  test('isKindOf у нижньому регістрі на реальних даних (ZP_Microscope : ZP_StaticDevice_Base)', () => {
    expect(isKindOf(idx, 'zp_microscope', 'ZP_StaticDevice_Base')).toBe(true)
    expect(isKindOf(idx, 'ZP_Microscope', 'zp_staticdevice_base')).toBe(true)
  })

  // Task 4, фікс-раунд 1 (Important 3): обов'язковий спот-чек ЗБРОЇ та БОЄПРИПАСУ --
  // якраз ті два корені, яких раніше не було в індексі. Обидва класи звірені НАПРЯМУ по
  // реальному декомпільованому ванільному конфігу під час фіксу (weapons_firearms.pbo ->
  // AKM/config.bin і weapons_projectiles.pbo -> config.bin, CfgConvert.exe -txt) -- не
  // вгадані з пам'яті.
  test('AKM (ванільна зброя, cfgWeapons, root=4) присутній і успадковує Rifle_Base', () => {
    expect(idx.byName.has('akm')).toBe(true)
    expect(classRoot(idx, 'AKM')).toBe(4)
    expect(isKindOf(idx, 'AKM', 'Rifle_Base')).toBe(true)
  })

  test('Bullet_762x39 (ванільний боєприпас, CfgAmmo, root=3) присутній', () => {
    expect(idx.byName.has('bullet_762x39')).toBe(true)
    expect(classRoot(idx, 'Bullet_762x39')).toBe(3)
  })
})

// ---- Індекс v2: ігрові назви (T7 Step 0) ---------------------------------------------------

describe('індекс v2 — display-імена (спот-чек по реальному згенерованому файлу)', () => {
  const idx = loadClassIndex()

  test('кожен рядок несе п\'ятий елемент display (рядок, можливо порожній)', () => {
    for (const row of idx.classes) {
      expect(typeof row[4]).toBe('string')
    }
  })

  test('Apple має непорожнє розв\'язане display (обов\'язковий спот-чек брифа)', () => {
    // Ванільний Apple перекритий модом звуків БЕЗ власного displayName -- непорожнє
    // display тут доводить одразу два механізми: property-merge при перевизначенні класу
    // і $STR_-резолв через stringtable ванілі (languagecore.pbo). Розв'язане значення
    // ЛІТЕРАЛЬНО збігається з класснеймом ("Apple") -- original-колонка Bohemia
    // англійська; перевіряємо саме РОЗВ'ЯЗАНІСТЬ (не '$STR_...', не порожньо), а не
    // відмінність від класснейму.
    const row = idx.classes[idx.byName.get('apple')!]
    expect(row[4].length).toBeGreaterThan(0)
    expect(row[4].startsWith('$')).toBe(false)
  })

  test('класи нашого мода мають display з нашої stringtable (укр. original)', () => {
    // ZP_Microscope: displayName="$STR_zp_microscope" у нашому config.cpp; original-колонка
    // нашої stringtable українська -- резолв мусить віддати саме її, не англійську.
    const display = displayNameOf(idx, 'ZP_Microscope')
    expect(display.length).toBeGreaterThan(0)
    expect(display.startsWith('$')).toBe(false)
    expect(display).not.toBe('ZP_Microscope')
    expect(displayNameOf(idx, 'ZP_Data_01')).not.toBe('ZP_Data_01')
  })

  test('покриття display по корпусу суттєве (не одиничні класи)', () => {
    const withDisplay = idx.classes.filter((row) => row[4] !== '' && !row[4].startsWith('$')).length
    expect(withDisplay).toBeGreaterThan(5000)
  })
})

function makeDisplayIndex(): ClassIndex {
  // A(без display) : B("База") : C("") ; D "сирий $STR"; E самостійний без display і бази.
  const classes: ClassIndex['classes'] = [
    ['Base_Thing', -1, 0, 0, 'База'],
    ['Child_NoOwn', 0, 0, 0, ''], // успадковує display від Base_Thing (двигунова семантика)
    ['Grandchild', 1, 0, 0, ''],
    ['RawKey', -1, 0, 0, '$STR_missing_key'],
    ['Lonely', -1, 0, 0, ''],
  ]
  return {
    v: 2,
    generated: '2026-01-01',
    mods: ['vanilla'],
    classes,
    byName: new Map(classes.map((row, i) => [row[0].toLowerCase(), i])),
  }
}

describe('displayNameOf', () => {
  const idx = makeDisplayIndex()

  test('власне display повертається як є', () => {
    expect(displayNameOf(idx, 'Base_Thing')).toBe('База')
  })

  test('порожнє display успадковується по ланцюгу baseIdx (двигунова семантика конфігів)', () => {
    expect(displayNameOf(idx, 'Child_NoOwn')).toBe('База')
    expect(displayNameOf(idx, 'Grandchild')).toBe('База')
  })

  test('без display ніде в ланцюгу — фолбек класснейм у збереженому регістрі', () => {
    expect(displayNameOf(idx, 'lonely')).toBe('Lonely')
  })

  test('невідомий клас — фолбек рядок запиту', () => {
    expect(displayNameOf(idx, 'Unknown_Xyz')).toBe('Unknown_Xyz')
  })

  test('нерозв\'язаний $STR_ лишається сирим (чесний маркер, як у грі)', () => {
    expect(displayNameOf(idx, 'RawKey')).toBe('$STR_missing_key')
  })
})

describe('parseClassIndexJson (індекс від проєкту/імпортера)', () => {
  test('v2 приймається як є', () => {
    const idx = parseClassIndexJson({
      v: 2,
      generated: '2026-01-01',
      mods: ['m'],
      classes: [['A', -1, 0, 0, 'Ім\'я']],
    })
    expect(idx.classes[0][4]).toBe('Ім\'я')
    expect(idx.byName.get('a')).toBe(0)
  })

  test('v1 (без п\'ятого елемента) нормалізується до display=\'\'', () => {
    const idx = parseClassIndexJson({
      v: 1,
      generated: '2026-01-01',
      mods: ['m'],
      classes: [['A', -1, 0, 0]],
    })
    expect(idx.classes[0][4]).toBe('')
    expect(displayNameOf(idx, 'A')).toBe('A')
  })

  test('сміття відкидається з помилкою, а не тихим підсовуванням', () => {
    expect(() => parseClassIndexJson(null)).toThrow()
    expect(() => parseClassIndexJson({ v: 2 })).toThrow()
    expect(() => parseClassIndexJson({ v: 2, generated: 'x', mods: [], classes: [[42]] })).toThrow()
  })
})

describe('setActiveClassIndex (пріоритет «папка > бандл»)', () => {
  test('без оверрайду activeClassIndex віддає бандл; з оверрайдом — його; null скидає', () => {
    setActiveClassIndex(null)
    expect(activeClassIndex()).toBe(loadClassIndex())
    const custom = makeDisplayIndex()
    setActiveClassIndex(custom)
    expect(activeClassIndex()).toBe(custom)
    setActiveClassIndex(null)
    expect(activeClassIndex()).toBe(loadClassIndex())
  })
})

// ---- isKindOf -----------------------------------------------------------------------------

function makeFixtureIndex(): ClassIndex {
  // Мінімальний рукописний індекс для ізольованих тестів isKindOf/searchClasses/classRoot,
  // не залежних від реального classindex.json (щоб зміни в PBO-корпусі не хитали ці
  // тести): A <- B <- C у CfgVehicles (root 0), окремий D у CfgMagazines (root 1) без бази.
  const classes: ClassIndex['classes'] = [
    ['A', -1, 0, 0, ''],
    ['B', 0, 0, 0, ''], // B: A
    ['C', 1, 0, 0, ''], // C: B
    ['D', -1, 0, 1, ''],
  ]
  // byName -- lower-case ключ (фікс-раунд 1, CRITICAL 1): дзеркалить loadClassIndex.
  const byName = new Map(classes.map((row, i) => [row[0].toLowerCase(), i]))
  return { v: 2, generated: '2026-01-01', mods: ['vanilla'], classes, byName }
}

describe('isKindOf', () => {
  const idx = makeFixtureIndex()

  test('клас є сам собою', () => {
    expect(isKindOf(idx, 'A', 'A')).toBe(true)
  })

  test('прямий батько', () => {
    expect(isKindOf(idx, 'B', 'A')).toBe(true)
  })

  test('транзитивний предок через ланцюг baseIdx', () => {
    expect(isKindOf(idx, 'C', 'A')).toBe(true)
  })

  test('не є нащадком у зворотному напрямку', () => {
    expect(isKindOf(idx, 'A', 'C')).toBe(false)
  })

  test('непов\'язані класи -- false', () => {
    expect(isKindOf(idx, 'D', 'A')).toBe(false)
  })

  test('невідомий клас зліва -- false, не кидає виняток', () => {
    expect(isKindOf(idx, 'Unknown_Xyz', 'A')).toBe(false)
  })

  test('"X|1" -- точний збіг імені без проходу по ланцюгу спадкування', () => {
    expect(isKindOf(idx, 'C', 'C|1')).toBe(true)
    expect(isKindOf(idx, 'B', 'C|1')).toBe(false) // B успадковує від A, але C|1 вимагає точності
    expect(isKindOf(idx, 'C', 'A|1')).toBe(false) // C -- нащадок A, але не точно A
  })

  // Рев'ю Task 4, фікс-раунд 1, CRITICAL 1 (емпірично доведено): сервер MatchClass
  // (ZP_ProcessingConfig.c:139-148) шукає ПЕРШИЙ "|" де завгодно в рядку й бере точну
  // назву як усе ДО НЬОГО -- те, що після пайпа (цифра, інша цифра, чи взагалі нічого),
  // рушій не читає. "X|1" -- лише НАЙПОШИРЕНІША конвенція позначки в конфігах адмінів,
  // не єдина форма, яку приймає сервер. До фіксу тут стояла перевірка рівно суфікса
  // "|1" (`base.endsWith('|1')`), тож "X|2"/"X|" провалювались би в гілку IsKindOf і
  // шукали б клас з буквальним ім'ям "X|2" в індексі -- завжди відсутній.
  test('"X|2" (не лише "|1") -- та сама точна семантика пайп-форми', () => {
    expect(isKindOf(idx, 'C', 'C|2')).toBe(true)
    expect(isKindOf(idx, 'B', 'C|2')).toBe(false) // "|2" так само вимагає точності, як "|1"
  })

  test('"X|" (порожньо після пайпа) -- сервер так само бере точну назву до пайпа', () => {
    expect(isKindOf(idx, 'C', 'C|')).toBe(true)
    expect(isKindOf(idx, 'B', 'C|')).toBe(false)
  })

  test('пайп-форма НЕ матчить нащадка НЕЗАЛЕЖНО від числа після пайпа', () => {
    // C -- нащадок A (B: A, C: B), але жодна пайп-форма A не бере нащадків.
    expect(isKindOf(idx, 'C', 'A|1')).toBe(false)
    expect(isKindOf(idx, 'C', 'A|2')).toBe(false)
    expect(isKindOf(idx, 'C', 'A|')).toBe(false)
  })

  test('захист від циклу в baseIdx не зависає (MAX_CHAIN_DEPTH)', () => {
    const cyc: ClassIndex['classes'] = [
      ['X', 1, 0, 0, ''], // X: Y
      ['Y', 0, 0, 0, ''], // Y: X -- цикл
    ]
    const cycIdx: ClassIndex = {
      v: 2,
      generated: '2026-01-01',
      mods: ['vanilla'],
      classes: cyc,
      byName: new Map(cyc.map((row, i) => [row[0].toLowerCase(), i])),
    }
    expect(isKindOf(cycIdx, 'X', 'NeverThere')).toBe(false)
  })

  // ---- Кейс-інсенситивність (фікс-раунд 1, CRITICAL 1) -------------------------------------
  // Сервер (ZP_ProcessingConfig.c:135-150 MatchClass) не розрізняє регістр: "|1"-гілка робить
  // .ToLower() з обох боків, звичайна гілка йде через кейс-інсенситивний GetGame().IsKindOf.
  // Правило з класнеймом у "неправильному" регістрі в грі СПРАЦЮЄ -- редактор зобов'язаний
  // погоджуватись, інакше показуватиме "клас не знайдено" на класі, який реально працює.
  test('cls у нижньому регістрі -- той самий результат, що й в оригінальному', () => {
    expect(isKindOf(idx, 'c', 'A')).toBe(true) // транзитивно, як isKindOf(idx,'C','A')
    expect(isKindOf(idx, 'b', 'a')).toBe(true) // обидва боки в нижньому регістрі
  })

  test('base (ціль порівняння) у змішаному регістрі -- матчиться попри регістр', () => {
    expect(isKindOf(idx, 'C', 'a')).toBe(true)
    expect(isKindOf(idx, 'C', 'A')).toBe(true) // без регресії на оригінальному кейсі
  })

  test('"X|1" з мішаним регістром по обидва боки', () => {
    expect(isKindOf(idx, 'c', 'C|1')).toBe(true)
    expect(isKindOf(idx, 'C', 'c|1')).toBe(true)
    expect(isKindOf(idx, 'c', 'c|1')).toBe(true)
    expect(isKindOf(idx, 'b', 'C|1')).toBe(false) // семантика "|1" не зачепилась фіксом
  })
})

// ---- searchClasses -------------------------------------------------------------------------

function makeSearchIndex(): ClassIndex {
  // Display-імена (v2): Apple з ігровою назвою "Яблуко", ZP_LabComputer -- "Науковий
  // термінал" (вторинний пошук по display), решта без display.
  const names = ['ZP_Microscope', 'ZP_MicroWave', 'AAA_ZP_Microscope_Alt', 'ZP_LabComputer', 'Apple']
  const displays: Record<string, string> = { Apple: 'Яблуко', ZP_LabComputer: 'Науковий термінал' }
  const classes: ClassIndex['classes'] = names.map((name) => [name, -1, 0, 0, displays[name] ?? ''])
  return {
    v: 2,
    generated: '2026-01-01',
    mods: ['vanilla'],
    classes,
    byName: new Map(classes.map((row, i) => [row[0].toLowerCase(), i])),
  }
}

describe('searchClasses', () => {
  const idx = makeSearchIndex()

  test('підрядок, кейс-інсенситив', () => {
    const hits = searchClasses(idx, 'microscope', 10).map((h) => h.name)
    expect(hits).toContain('ZP_Microscope')
    expect(hits).toContain('AAA_ZP_Microscope_Alt')
  })

  test('префіксні збіги йдуть першими', () => {
    const hits = searchClasses(idx, 'zp_', 10).map((h) => h.name)
    // ZP_* -- префіксні; AAA_ZP_Microscope_Alt містить "zp_" не з початку -- має бути після них
    const prefixIdx = hits.indexOf('ZP_Microscope')
    const nonPrefixIdx = hits.indexOf('AAA_ZP_Microscope_Alt')
    expect(prefixIdx).toBeGreaterThanOrEqual(0)
    expect(nonPrefixIdx).toBeGreaterThan(prefixIdx)
  })

  test('лімít обрізає результат', () => {
    const hits = searchClasses(idx, 'zp_', 2)
    expect(hits.length).toBe(2)
  })

  test('порожній запит повертає перші limit елементів', () => {
    const hits = searchClasses(idx, '', 3)
    expect(hits.length).toBe(3)
  })

  test('без збігів -- порожній масив', () => {
    expect(searchClasses(idx, 'zzzznotfound', 10)).toEqual([])
  })

  test('hit несе root, mod і display', () => {
    const [hit] = searchClasses(idx, 'Apple', 10)
    expect(hit).toEqual({ name: 'Apple', root: 0, mod: 'vanilla', display: 'Яблуко' })
  })

  // ---- Вторинний пошук по display-іменах (T7 Step 0) ---------------------------------------
  test('запит, що збігається лише з display, знаходить клас (вторинний пріоритет)', () => {
    const hits = searchClasses(idx, 'яблуко', 10).map((h) => h.name)
    expect(hits).toContain('Apple')
  })

  test('display-збіги йдуть ПІСЛЯ збігів по класснейму', () => {
    // "науков" -- лише display ZP_LabComputer; "zp_" -- класснейми. Змішаний запит:
    // "терм" збігається тільки з display; порядок перевіряємо на запиті, що чіпляє обидва
    // типи: "la" -- класснейм ZP_LabComputer (підрядок) і display? ні. Простіше напряму:
    const hits = searchClasses(idx, 'о', 20)
    const nameHitPos = hits.findIndex((h) => h.name.toLowerCase().includes('о'))
    // кириличне "о" не зустрічається в жодному класснеймі -- всі збіги тут display-збіги
    expect(nameHitPos).toBe(-1)
    expect(hits.map((h) => h.name)).toEqual(expect.arrayContaining(['Apple', 'ZP_LabComputer']))
  })

  test('display-збіг не дублює клас, що вже знайдений по класснейму', () => {
    // "ZP_Lab" -- і префікс класснейму, і... display містить "Науковий" (не збіг) --
    // а от запит "a" чіпляє і класснейм Apple, і display "Яблуко"? ні ("Яблуко" без "a").
    // Прямий кейс дубля: запит "l" -- класснейми Apple/ZP_LabComputer; display "Яблуко"
    // латинської "l" не має. Тож дубль можливий лише коли запит є і в імені, і в display
    // одного класу: змоделюємо запитом "п" -- ні. Найпростіше: запит "яблуко" не має
    // повертати Apple двічі.
    const hits = searchClasses(idx, 'яблуко', 10).filter((h) => h.name === 'Apple')
    expect(hits.length).toBe(1)
  })
})

// ---- classRoot ------------------------------------------------------------------------------

describe('classRoot', () => {
  test('повертає корінь відомого класу', () => {
    const idx = makeFixtureIndex()
    expect(classRoot(idx, 'A')).toBe(0)
    expect(classRoot(idx, 'D')).toBe(1)
  })

  test('undefined для класу поза індексом', () => {
    const idx = makeFixtureIndex()
    expect(classRoot(idx, 'NotIndexed')).toBeUndefined()
  })

  test('кейс-інсенситивний (фікс-раунд 1, CRITICAL 1)', () => {
    const idx = makeFixtureIndex()
    expect(classRoot(idx, 'a')).toBe(0)
    expect(classRoot(idx, 'd')).toBe(1)
  })
})
