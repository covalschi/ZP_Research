// Капстоун «Великий перезбір» (у dev-нотатках CLAUDE.md — рос. «Великий пересбор»), Task 2: знос пресетів стенду і перестворення ВСЬОГО контенту
// РІВНО за маніфестом docs/superpowers/specs/2026-08-08-capstone-manifest.md -- ВИКЛЮЧНО
// кліками веб-редактора (headless Chrome + сирий CDP, той самий прийом, що t3-5-accept.mjs
// і t26-6-shoot.mjs). ЖОДНОЇ ручної правки JSON нового контенту.
//
// Фази:
//   A) імпорт ZIP зі СТАРОГО профілю стенду (діра §8.2 звіту T1: вікно станка досяжне
//      лише через картку на полотні -- старі правила мусять бути живі на вході) ->
//      створення всього маніфесту кліками -> збереження -> експорт ZIP -> структурна
//      звірка КОЖНОЇ сутності з маніфестом.
//      Порядок створення всередині фази: Зразки -> ДЕРЕВО -> правила. Дерево йде ДО
//      правил, бо RequiredNode правила pb_analiz_teh обирається ZpSelect по вузлах
//      НОВОГО дерева (діра §8.3: rename/delete вузла не перевіряє RequiredNode правил --
//      вузол мусить мати ФІНАЛЬНИЙ Id до того, як на нього пошлеться правило).
//      Старі правила видаляються поштучно deleteRule (рекомендований обхід §8.2 з
//      маніфесту) ПІСЛЯ налаштування нових пакувальників і ДО «куди піде результат»:
//      linkOutputToStation кладе заготовку-аналізатор у файл ПЕРШОГО рядка станка-
//      призначення -- зі старими правилами мікроскопа аналізатор ліг би у СТАРИЙ
//      chain.json замість peresbir_lanciuhy.json.
//   B) розкладка на стенд ПОЗА редактором (діра §8.1: видалення ФАЙЛУ в редакторі немає):
//      старі TechTree/*.json + ProcessingRules/*.json видаляються з диска, з експорту
//      лягають ЛИШЕ нові файли маніфесту + SampleTypes.json.
//   C) ідемпотентність: свіжий імпорт ZIP з УЖЕ перебудованого стенду -> експорт без
//      правок -> 0 змінених байтів (побайтове порівняння всіх 11 файлів).
//
// Жорсткі ассерти (провал будь-якого = провал прогону, exit 1):
//   - консоль браузера чиста (жодного console.error за ОБИДВІ фази);
//   - панель розривів ланцюгів «Розривів немає», 0 break-ребер, 7 карток станків;
//   - панель проблем дерева «Проблем дерева немає», 0 alarm-вузлів у кожній новій гілці;
//   - гейт W2.7 порожній: жодної alarm-gate-панелі, «Зберегти зміни»/«Завантажити ZIP»
//     не заблоковані;
//   - експортовані файли звірені СТРУКТУРНО (JSON.parse) з маніфестом поле-в-поле;
//   - незаймані файли (5 одиночних + 3 старі гілки) експортуються байт-у-байт.
//
// Запуск: node tests/tools/capstone-rebuild.mjs (з webeditor/, vite preview на :4173
// мусить обслуговувати актуальний dist).

import { unzipSync, zipSync } from 'fflate'
import { spawn } from 'child_process'
import { writeFileSync, mkdtempSync, readFileSync, existsSync, mkdirSync, rmSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = process.env.CAPSTONE_OUT || 'E:/TMP/claude/E--dayzmod/ef2600b9-21a8-43d6-8043-cf5a4904c3ec/scratchpad'
const DOWNLOAD_DIR = join(OUT, 'capstone-downloads')
const EXPORT_DIR = join(OUT, 'capstone-exported')
const PORT = 9361
const URL = 'http://localhost:4173/'
const DIST = 'E:/dayzmod/webeditor/dist'
const STAND = 'E:/dayzmod/testserver/profiles/ZP_Research'
const FIXTURE_A = 'capstone-stand.zip'
const FIXTURE_C = 'capstone-stand2.zip'

// ---- Перелік файлів СТАРОГО стенду (той самий, що t5/t8/t26-6/t3-5 -- FactionData/
// PlayerData/ConfigBackup/StaticDevices* у ZIP не потрапляють ніколи) ------------------------
const OLD_STAND_FILES = [
  'Settings.json',
  'PointTypes.json',
  'Factions.json',
  'DataItems.json',
  'Modules.json',
  'SampleTypes.json',
  'ProcessingRules/chain.json',
  'ProcessingRules/demo.json',
  'ProcessingRules/test_micro.json',
  'TechTree/clearsky.json',
  'TechTree/combat.json',
  'TechTree/zone.json',
]

// Файли, які фаза A НЕ сміє змінити ані байтом.
const UNTOUCHED_FILES = [
  'Settings.json',
  'PointTypes.json',
  'Factions.json',
  'DataItems.json',
  'Modules.json',
  'TechTree/clearsky.json',
  'TechTree/combat.json',
  'TechTree/zone.json',
]

// Старі файли, що зносяться з диска у фазі B (діра §8.1 -- лише на диску).
const DISK_DELETE = [
  'ProcessingRules/chain.json',
  'ProcessingRules/demo.json',
  'ProcessingRules/test_micro.json',
  'TechTree/clearsky.json',
  'TechTree/combat.json',
  'TechTree/zone.json',
]

// Нові файли маніфесту (+ наповнений SampleTypes.json), що лягають на стенд у фазі B.
const DISK_WRITE = [
  'SampleTypes.json',
  'ProcessingRules/peresbir_lanciuhy.json',
  'ProcessingRules/peresbir_mikroskop.json',
  'TechTree/peresbir_nauka.json',
  'TechTree/peresbir_nebo.json',
  'TechTree/peresbir_varta.json',
]

// Повний перелік конфігів ПЕРЕСОБРАНОГО стенду (фаза C, 11 файлів).
const NEW_STAND_FILES = [
  'Settings.json',
  'PointTypes.json',
  'Factions.json',
  'DataItems.json',
  'Modules.json',
  'SampleTypes.json',
  'ProcessingRules/peresbir_lanciuhy.json',
  'ProcessingRules/peresbir_mikroskop.json',
  'TechTree/peresbir_nauka.json',
  'TechTree/peresbir_nebo.json',
  'TechTree/peresbir_varta.json',
]

// ---- МАНІФЕСТ §4.3: типи зразків ------------------------------------------------------------
const SAMPLE_TYPES = [
  { cls: 'ZP_Sample_01', name: 'Біозразок', desc: 'Законсервована тканина мутанта, підготовлена до аналізу.' },
  { cls: 'ZP_Sample_03', name: 'Аномальний зразок', desc: 'Матеріал з осередку аномальної активності в захисному контейнері.' },
  { cls: 'ZP_Sample_17', name: 'Технічний зразок', desc: 'Носій із записом вимірів польової апаратури.' },
]

// ---- МАНІФЕСТ §4.2: три гілки дерева (порядок вузлів = порядок таблиць маніфесту;
// батьки завжди створені РАНІШЕ за нащадків, тож rename-до-підвішування безпечний) -----------
const BRANCHES = [
  {
    file: 'peresbir_nauka',
    path: 'TechTree/peresbir_nauka.json',
    id: 'pb_nauka',
    name: 'Наукова програма Зони',
    sort: 1,
    faction: 'ecolog',
    expectedEdges: 15,
    nodes: [
      { id: 'pb_osnovy', name: 'Польові основи', tier: 1, parents: [], cost: [['bio_field_t1', 5]], rt: 0, icon: 'set:dayz_gui image:gear', desc: 'Методики збору, маркування та зберігання зразків у полі. Корінь програми.' },
      { id: 'pb_bio_zbir', name: 'Відбір біозразків', tier: 2, parents: ['pb_osnovy'], cost: [['bio_field_t1', 8]], itemCost: [['Paper', 2]], rt: 0, icon: 'set:dayz_gui image:iconBacteria', desc: 'Правильний забір тканин мутантів без псування матеріалу.' },
      { id: 'pb_ano_detekt', name: 'Детекція аномалій', tier: 2, parents: ['pb_osnovy'], cost: [['anomaly_field_t1', 8]], rt: 0, icon: 'set:dayz_gui image:icon_refresh', desc: 'Калібрування детекторів під поля Зони.' },
      { id: 'pb_teh_elektro', name: 'Польова електроніка', tier: 2, parents: ['pb_osnovy'], cost: [['electronics_field_t1', 8]], rt: 0, icon: 'set:dayz_gui image:icon_hammer', desc: 'Ремонт і калібрування наукових приладів у польових умовах.' },
      { id: 'pb_bio_anatom', name: 'Анатомія мутантів', tier: 3, parents: ['pb_bio_zbir'], cost: [['bio_field_t2', 10], ['bio_lab_t1', 4]], rt: 60, icon: 'set:dayz_gui image:iconSkull', desc: 'Систематизація будови тканин. Глибша переробка органів.' },
      { id: 'pb_ano_artefakt', name: 'Природа артефактів', tier: 3, parents: ['pb_ano_detekt'], cost: [['anomaly_field_t2', 12], ['anomaly_lab_t1', 5]], rt: 45, icon: 'set:dayz_gui image:iconSkull', desc: 'Класифікація артефактів за типом породжуючої аномалії.' },
      { id: 'pb_teh_dani', name: 'Обробка даних', tier: 3, parents: ['pb_teh_elektro'], cost: [['electronics_lab_t1', 10]], rt: 60, icon: 'set:dayz_gui image:gear', desc: 'Серверне зберігання й аналіз накопичених вимірів.' },
      { id: 'pb_bio_mutagen', name: 'Мутагени', tier: 4, parents: ['pb_bio_anatom'], cost: [['bio_lab_t2', 15], ['bio_lab_t3', 2]], rt: 120, icon: 'set:dayz_gui image:iconPill', desc: 'Виділення активних сполук із тканин. Верхівка біологічного напрямку.' },
      { id: 'pb_ano_stabil', name: 'Стабілізація', tier: 4, parents: ['pb_ano_artefakt'], cost: [['anomaly_lab_t2', 14], ['anomaly_lab_t3', 2]], rt: 90, icon: 'set:dayz_gui image:iconPill', desc: 'Безпечне транспортування нестабільних артефактів.' },
      { id: 'pb_hrest_biolab', name: 'Біохімлабораторія', tier: 4, parents: ['pb_bio_anatom', 'pb_teh_dani'], cost: [['bio_lab_t2', 20], ['electronics_lab_t2', 6]], rt: 180, icon: 'set:dayz_gui image:iconBacteria', desc: 'Перехресний вузол: потрібні І анатомія, І обробка даних.' },
      { id: 'pb_hrest_skaner', name: 'Універсальний сканер', tier: 4, parents: ['pb_ano_artefakt', 'pb_teh_dani'], mode: 'any', cost: [['anomaly_lab_t2', 12], ['electronics_lab_t1', 8]], rt: 60, icon: 'set:dayz_gui image:icon_refresh', desc: 'Перехресний вузол з режимом ANY: досить будь-якого з двох напрямків.' },
      { id: 'pb_final_protokol', name: 'Протокол Зони', tier: 5, parents: ['pb_hrest_biolab', 'pb_hrest_skaner', 'pb_bio_mutagen'], cost: [['bio_lab_t3', 6], ['anomaly_lab_t3', 6], ['electronics_lab_t3', 6]], rt: 300, icon: 'set:dayz_gui image:iconSkull', desc: 'Фінальна мета фракційної програми досліджень.' },
    ],
  },
  {
    file: 'peresbir_nebo',
    path: 'TechTree/peresbir_nebo.json',
    id: 'pb_nebo',
    name: 'Метеорологія Чистого неба',
    sort: 2,
    faction: 'clearsky',
    expectedEdges: 1,
    nodes: [
      { id: 'pb_nebo_sposter', name: 'Метеоспостереження', tier: 1, parents: [], cost: [['bio_field_t1', 3]], rt: 0, icon: '', desc: 'Спостереження за фронтами викидів.' },
      { id: 'pb_nebo_ukryttia', name: 'Укриття від викиду', tier: 2, parents: ['pb_nebo_sposter'], cost: [['bio_field_t1', 5]], itemCost: [['Rag', 3]], rt: 0, icon: '', desc: 'Розрахунок стійкості укриттів.' },
    ],
  },
  {
    file: 'peresbir_varta',
    path: 'TechTree/peresbir_varta.json',
    id: 'pb_varta',
    name: 'Бойові розробки Долгу',
    sort: 3,
    faction: 'duty',
    expectedEdges: 1,
    nodes: [
      { id: 'pb_varta_osnovy', name: 'Основи спорядження', tier: 1, parents: [], cost: [['bio_field_t1', 3]], rt: 0, icon: '', desc: 'Догляд і підгонка спорядження.' },
      { id: 'pb_varta_bronia', name: 'Бронювання', tier: 2, parents: ['pb_varta_osnovy'], cost: [['bio_field_t1', 5]], rt: 0, icon: '', desc: 'Підсилення бронезахисту групи.' },
    ],
  },
]

// ---- МАНІФЕСТ §4.1: очікуваний СТРУКТУРНИЙ вміст файлів правил (для звірки експорту).
// Ключі -- у порядку RULE_SCHEMA (schema.ts): саме так пише канонічний серіалізатор,
// і JSON.parse збереже цей порядок, тож поглибока звірка через JSON.stringify чесна.
const FR = Math.fround
function mkRule(o) {
  return {
    Id: o.id,
    Enabled: 1,
    Device: o.device,
    Mode: 'background',
    InputItem: { Classname: o.input, Quantity: 1, ConsumeInput: 1, Content: o.inContent ?? '' },
    BasePurityMin: o.pmin ?? 0.5,
    BasePurityMax: o.pmax ?? 0.5,
    TimeSec: o.time,
    Consumables: o.cons ?? [],
    Outputs: o.outs,
    RequiredNode: o.node ?? '',
    RequiredFactions: o.rf ?? [],
    RequiredWorn: [],
    RequiredTools: o.rtools ?? [],
    Notes: '',
  }
}
const EXPECT_LANCIUHY = {
  ConfigVersion: 1,
  Rules: [
    mkRule({ id: 'pb_pak_bio', device: 'ZP_SampleFridge', input: 'Apple', pmin: FR(0.4), pmax: FR(0.8), time: 10, cons: [{ Classname: 'Rag', Quantity: 1, Content: '' }], outs: [{ Classname: 'ZP_Sample_01', Quantity: 1, Chance: 1, Content: 'Apple' }] }),
    mkRule({ id: 'pb_pak_teh', device: 'ZP_SampleFridge', input: 'Rag', time: 10, outs: [{ Classname: 'ZP_Sample_17', Quantity: 1, Chance: 1, Content: 'zapys_detektora' }] }),
    mkRule({ id: 'pb_analiz_bio', device: 'ZP_Microscope', input: 'ZP_Sample_01', inContent: 'Apple', time: 15, outs: [{ Classname: 'ZP_Data_01', Quantity: 1, Chance: 1, Content: '' }] }),
    mkRule({ id: 'pb_analiz_teh', device: 'ZP_Microscope', input: 'ZP_Sample_17', inContent: 'zapys_detektora', time: 15, outs: [{ Classname: 'ZP_Data_61', Quantity: 1, Chance: 1, Content: '' }], node: 'pb_osnovy' }),
  ],
}
const EXPECT_MIKROSKOP = {
  ConfigVersion: 1,
  Rules: [
    mkRule({ id: 'pb_mikro_varta', device: 'ZP_ServerRack', input: 'Rag', time: 30, outs: [{ Classname: 'Paper', Quantity: 1, Chance: 1, Content: '' }], rf: ['duty'] }),
    mkRule({ id: 'pb_mikro_deshevo', device: 'ZP_Microscope', input: 'Rag', time: 20, outs: [{ Classname: 'Paper', Quantity: 1, Chance: 1, Content: '' }], rf: ['ecolog', 'clearsky'] }),
    mkRule({ id: 'pb_mikro_tsinno', device: 'ZP_Microscope', input: 'Apple', time: 90, outs: [{ Classname: 'Paper', Quantity: 1, Chance: 1, Content: '' }], rf: ['ecolog', 'clearsky'], rtools: ['ZP_Tool_Optics'] }),
  ],
}
function expectedBranchDoc(b) {
  return {
    ConfigVersion: 1,
    Branch: { Id: b.id, Name: b.name, Icon: '', SortOrder: b.sort, Factions: [b.faction] },
    Nodes: b.nodes.map((n) => ({
      Id: n.id,
      Name: n.name,
      Description: n.desc,
      Icon: n.icon,
      Tier: n.tier,
      Parents: n.parents,
      ParentsMode: n.mode ?? 'all',
      Cost: n.cost.map(([t, a]) => ({ Type: t, Amount: a })),
      ItemCost: (n.itemCost ?? []).map(([c, q]) => ({ Classname: c, Quantity: q, Content: '' })),
      ResearchTimeSec: n.rt,
      RequiredFactions: [],
    })),
  }
}
const EXPECT_SAMPLETYPES = {
  ConfigVersion: 1,
  Items: SAMPLE_TYPES.map((s) => ({ Id: s.cls, Enabled: 1, Name: s.name, Description: s.desc })),
}

// ---- Підготовка тек / фікстури A ------------------------------------------------------------
mkdirSync(OUT, { recursive: true })
rmSync(DOWNLOAD_DIR, { recursive: true, force: true })
mkdirSync(DOWNLOAD_DIR, { recursive: true })
rmSync(EXPORT_DIR, { recursive: true, force: true })
mkdirSync(EXPORT_DIR, { recursive: true })

const originalBytes = new Map()
{
  const zipInput = {}
  for (const rel of OLD_STAND_FILES) {
    const buf = readFileSync(join(STAND, ...rel.split('/')))
    originalBytes.set(rel, buf)
    zipInput[rel] = new Uint8Array(buf)
  }
  writeFileSync(join(DIST, FIXTURE_A), zipSync(zipInput))
  console.log(`фікстура A (старий стенд): ${OLD_STAND_FILES.length} файлів`)
}

// ---- headless Chrome + сирий CDP ------------------------------------------------------------
const profile = mkdtempSync(join(tmpdir(), 'capstone-'))
const chrome = spawn(
  CHROME,
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1680,1050', '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank'],
  { stdio: 'ignore' },
)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = JSON.stringify

async function getWsUrl() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`)
      const tabs = await res.json()
      const page = tabs.find((t) => t.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch {
      /* браузер ще стартує */
    }
    await sleep(200)
  }
  throw new Error('CDP не піднявся')
}

let msgId = 0
const pending = new Map()
let ws
function send(method, params = {}) {
  const id = ++msgId
  return new Promise((resolve) => {
    pending.set(id, { resolve })
    ws.send(JSON.stringify({ id, method, params }))
  })
}
async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('JS: ' + JSON.stringify(r.exceptionDetails))
  return r.result?.value
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  const path = join(OUT, name)
  writeFileSync(path, Buffer.from(r.data, 'base64'))
  console.log('знято', path)
}

const consoleErrors = []
const wsUrl = await getWsUrl()
ws = new WebSocket(wsUrl)
await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = reject
})
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id).resolve(msg.result ?? msg)
    pending.delete(msg.id)
    return
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
    consoleErrors.push(msg.params.args?.map((a) => a.value ?? a.description).join(' '))
  }
}
await send('Page.enable')
await send('Runtime.enable')
await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOAD_DIR })

// ---- Спільні хелпери сторінки ---------------------------------------------------------------

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    const ready = await evalJs(`!!document.getElementById('import-zip-input')`)
    if (ready) return
    await sleep(400)
  }
  throw new Error('сторінка не завантажилась: #import-zip-input не з’явився')
}

// window.__t: setValue вміє і input, і textarea (нативний сеттер свого прототипу + подія
// input -- React controlled поля інакше не бачать зміни).
async function injectHelpers() {
  await evalJs(`window.__t = {
    setValue(el, value) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
      setter.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    },
  }; true`)
}

async function importZip(fixtureName) {
  await evalJs(`(async () => {
    const res = await fetch(${J(URL + fixtureName)})
    const buf = await res.arrayBuffer()
    const dt = new DataTransfer()
    dt.items.add(new File([buf], ${J(fixtureName)}, { type: 'application/zip' }))
    const input = document.getElementById('import-zip-input')
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(1100)
}

async function switchTab(text) {
  await evalJs(`[...document.querySelectorAll('.tab-button')].find((b) => b.textContent.includes(${J(text)})).click()`)
  await sleep(1000)
}

async function setVal(sel, value) {
  const ok = await evalJs(`(() => {
    const el = document.querySelector(${J(sel)})
    if (!el) return false
    window.__t.setValue(el, ${J(value)})
    return true
  })()`)
  if (!ok) throw new Error(`немає поля ${sel}`)
  await sleep(150)
}

// Коміт на blur (FloatField/IntField/IdField): headless-квірк -- el.blur() не породжує
// focusout, диспатчимо FocusEvent руками (Т9-урок, CLAUDE.md).
async function setBlur(sel, value) {
  await evalJs(`document.querySelector(${J(sel)}).focus()`)
  await setVal(sel, String(value))
  await evalJs(`document.querySelector(${J(sel)}).dispatchEvent(new FocusEvent('focusout', { bubbles: true }))`)
  await sleep(350)
}

async function fieldValue(sel) {
  return evalJs(`document.querySelector(${J(sel)})?.value ?? null`)
}

// ZpSelect: набрати запит, клікнути (mousedown) опцію з ТОЧНИМ label або hint == want.
async function pick(sel, query, want) {
  await evalJs(`document.querySelector(${J(sel)}).focus()`)
  await setVal(sel, query)
  await sleep(450)
  const picked = await evalJs(`(() => {
    const opts = [...document.querySelectorAll('.zp-select-option')]
    const target = opts.find((o) => {
      const label = o.querySelector('.zp-select-option-label')?.textContent?.trim() ?? ''
      const hint = o.querySelector('.zp-select-option-hint')?.textContent?.trim() ?? ''
      return label === ${J(want)} || hint === ${J(want)}
    })
    if (!target) return { ok: false, seen: opts.map((o) => o.textContent.trim()).slice(0, 8) }
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    return { ok: true }
  })()`)
  if (!picked.ok) throw new Error(`ZpSelect ${sel}: опції '${want}' немає за запитом '${query}'; бачив: ${J(picked.seen)}`)
  await sleep(400)
}

// ZpSelect із allowFree: вільний текст, якого немає серед опцій, комітиться Enter'ом.
async function free(sel, text) {
  await evalJs(`document.querySelector(${J(sel)}).focus()`)
  await setVal(sel, text)
  await sleep(350)
  await evalJs(`document.querySelector(${J(sel)}).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`)
  await sleep(350)
}

async function clickByText(scopeSel, text) {
  const found = await evalJs(`(() => {
    const scope = ${scopeSel === null ? 'document' : `document.querySelector(${J(scopeSel)})`}
    if (!scope) return false
    const btn = [...scope.querySelectorAll('button')].find((b) => b.textContent.includes(${J(text)}))
    if (!btn) return false
    btn.click()
    return true
  })()`)
  if (!found) throw new Error(`кнопка '${text}' у '${scopeSel ?? 'document'}' не знайдена`)
  await sleep(300)
}

async function clickSel(sel) {
  const found = await evalJs(`(() => {
    const el = document.querySelector(${J(sel)})
    if (!el) return false
    el.click()
    return true
  })()`)
  if (!found) throw new Error(`елемент '${sel}' не знайдено`)
  await sleep(300)
}

function expectEq(what, actual, want) {
  const a = JSON.stringify(actual)
  const w = JSON.stringify(want)
  if (a !== w) throw new Error(`${what}: очікував ${w}, маю ${a}`)
}

// Завантаження ZIP: App.tsx завжди віддає той самий filename ZP_Research.zip, і Chrome із
// setDownloadBehavior ПЕРЕЗАПИСУЄ наявний файл, а не додає суфікс «(1)» -- детекція «нове
// ім'я, якого не було» другий раз НЕ спрацьовує (перший прогін фази C впав саме на цьому).
// Тому: видалити цільовий файл ДО кліку і чекати його появи (без .crdownload-хвоста).
async function downloadZip(label) {
  const target = join(DOWNLOAD_DIR, 'ZP_Research.zip')
  rmSync(target, { force: true })
  await clickByText(null, 'Завантажити ZIP')
  for (let i = 0; i < 50; i++) {
    await sleep(250)
    if (existsSync(target) && !existsSync(target + '.crdownload')) {
      await sleep(300)
      console.log(`${label}) завантажено: ZP_Research.zip`)
      return unzipSync(new Uint8Array(readFileSync(target)))
    }
  }
  throw new Error(`ZIP фази ${label} не завантажився`)
}

// ============================ ФАЗА A ==========================================================

await send('Page.navigate', { url: URL })
await waitReady()
await injectHelpers()
await importZip(FIXTURE_A)
console.log('A0) імпортовано старий стенд (12 файлів)')

// ---- A1. ДЕРЕВО: три нові гілки (ДО правил -- §8.3) -----------------------------------------

await switchTab('Дерево')
const treeStart = await evalJs(`document.querySelector('.tree-branch-plate')?.textContent ?? ''`)
if (!treeStart.includes('гілка 1 з 3')) throw new Error('старт дерева не «гілка 1 з 3»: ' + treeStart)

for (const b of BRANCHES) {
  // «створити гілку»: форма Branch-мети
  await clickSel('#tree-create-branch')
  await sleep(300)
  await setVal('#tbf-file', b.file)
  await setVal('#tbf-id', b.id)
  await setVal('#tbf-name', b.name)
  await setVal('#tbf-sort', String(b.sort))
  await pick('#tbf-faction-add', b.faction, b.faction)
  const chips = await evalJs(`[...document.querySelectorAll('.tree-branch-form .station-chip code')].map((c) => c.textContent)`)
  if (!chips.includes(b.faction)) throw new Error(`фракція ${b.faction} не додалась чіпом: ` + J(chips))
  await clickByText('.tree-branch-form', 'Створити гілку')
  await sleep(900)
  const plate = await evalJs(`document.querySelector('.tree-branch-plate')?.textContent ?? ''`)
  if (!plate.includes(b.path)) throw new Error(`перемикач не на новій гілці ${b.path}: ` + plate)
  const alert0 = await evalJs(`document.querySelector('.tree-workspace [role="alert"]')?.textContent ?? null`)
  if (alert0) throw new Error('створення гілки дало помилку: ' + alert0)
  console.log(`A1) гілка ${b.id} створена (${b.path})`)

  for (const n of b.nodes) {
    // fitView, щоб колонки були в кадрі (клік робимо .click(), тож видимість не критична,
    // але скріншоти при падінні читабельніші)
    await evalJs(`document.querySelector('.react-flow__controls-fitview')?.click()`)
    await sleep(350)
    // «+» у заголовку своєї Tier-колонки
    await clickSel(`[data-id="tcol::${n.tier}"] .tree-tier-header-add`)
    await sleep(700)
    const autoKey = `tnode::${b.path}::${b.id}_vuzol`
    const created = await evalJs(`({
      card: !!document.querySelector('[data-id=' + ${J(J(autoKey))} + ']'),
      panel: !!document.querySelector('.tree-node-panel'),
    })`)
    if (!created.card || !created.panel) throw new Error(`вузол-заготовка ${autoKey} не створився або панель не відкрилась: ` + J(created))

    // Перейменування Id ПЕРШИМ (діра §8.3: далі на цей Id пошлються нащадки і правило)
    await setBlur('#tnp-id', n.id)
    const renamed = await evalJs(`({
      card: !!document.querySelector('[data-id=' + ${J(J(`tnode::${b.path}::${n.id}`))} + ']'),
      idField: document.querySelector('#tnp-id')?.value ?? null,
      err: document.querySelector('.tree-node-panel [role="alert"]')?.textContent ?? null,
    })`)
    if (renamed.err) throw new Error(`перейменування ${n.id} відхилено: ` + renamed.err)
    if (!renamed.card || renamed.idField !== n.id) throw new Error(`перейменування ${n.id} не відбулось: ` + J(renamed))

    await setVal('#tnp-name', n.name)
    await setVal('#tnp-description', n.desc)
    if (n.icon !== '') await setVal('#tnp-icon', n.icon)

    for (const p of n.parents) {
      await pick('#tnp-parent-add', p, p)
      const perr = await evalJs(`document.querySelector('.tree-node-panel [role="alert"]')?.textContent ?? null`)
      if (perr) throw new Error(`батько ${p} для ${n.id} відхилений: ` + perr)
    }
    if ((n.mode ?? 'all') === 'any') {
      await clickSel('#tnp-pm-any')
      const anyChecked = await evalJs(`document.querySelector('#tnp-pm-any')?.checked ?? false`)
      if (!anyChecked) throw new Error(`ParentsMode=any не встановився на ${n.id}`)
    }

    for (let i = 0; i < n.cost.length; i++) {
      await clickByText('.tree-node-panel', '+ Додати вартість')
      await pick(`#tnp-cost-type-${i}`, n.cost[i][0], n.cost[i][0])
      await setBlur(`#tnp-cost-amount-${i}`, n.cost[i][1])
    }
    const itemCost = n.itemCost ?? []
    for (let i = 0; i < itemCost.length; i++) {
      await clickByText('.tree-node-panel', '+ Додати предмет')
      await pick(`#tnp-ic-cls-${i}`, itemCost[i][0], itemCost[i][0])
      await setBlur(`#tnp-ic-qty-${i}`, itemCost[i][1])
    }
    if (n.rt > 0) await setBlur('#tnp-research-time', n.rt)

    const done = await evalJs(`(() => {
      const card = document.querySelector('[data-id=' + ${J(J(`tnode::${b.path}::${n.id}`))} + ']')
      const inner = card?.querySelector('.tree-node-card')
      const parents = [...document.querySelectorAll('.tree-node-panel [id^="tnp-parent-"]')].filter((el) => el.id !== 'tnp-parent-add').length
      return { alarm: inner ? inner.classList.contains('tree-node-alarm') : null, parents }
    })()`)
    if (done.alarm !== false) throw new Error(`вузол ${n.id} після заповнення все ще alarm (або зник): ` + J(done))
    if (done.parents !== n.parents.length) throw new Error(`вузол ${n.id}: батьків у панелі ${done.parents}, очікував ${n.parents.length}`)
    console.log(`A1) вузол ${n.id} (Тір ${n.tier}) готовий`)
  }

  // Зняти вибір, порахувати гілку цілком
  await clickSel('.tree-node-panel .quick-edit-close')
  await evalJs(`document.querySelector('.react-flow__controls-fitview')?.click()`)
  await sleep(600)
  const stats = await evalJs(`({
    cards: document.querySelectorAll('.tree-node-card').length,
    edges: document.querySelectorAll('.tree-edge-path').length,
    alarms: document.querySelectorAll('.tree-node-card.tree-node-alarm').length,
  })`)
  expectEq(`гілка ${b.id}: картки`, stats.cards, b.nodes.length)
  expectEq(`гілка ${b.id}: ребра`, stats.edges, b.expectedEdges)
  expectEq(`гілка ${b.id}: alarm`, stats.alarms, 0)
  console.log(`A1) гілка ${b.id} завершена: ${stats.cards} вузлів, ${stats.edges} ребер, 0 alarm`)
}

// ---- A2. ЗРАЗКИ: три типи вкладкою «Зразки» -------------------------------------------------

await switchTab('Зразки')
for (const s of SAMPLE_TYPES) {
  const selected = await evalJs(`(() => {
    const btn = [...document.querySelectorAll('.sample-types-table .row-select')].find((b) => b.querySelector('code')?.textContent === ${J(s.cls)})
    if (!btn) return false
    btn.click()
    return true
  })()`)
  if (!selected) throw new Error(`рядок ${s.cls} у реєстрі зразків не знайдено`)
  await sleep(400)
  await clickByText('.sample-type-detail', '+ Створити запис')
  await sleep(300)
  await setVal('#st-name', s.name)
  await setVal('#st-description', s.desc)
  await sleep(200)
  const rowState = await evalJs(`(() => {
    const row = [...document.querySelectorAll('.sample-types-table tbody tr')].find((tr) => tr.querySelector('code')?.textContent === ${J(s.cls)})
    return { name: row?.cells[1]?.textContent ?? null, lampOk: !!row?.querySelector('.lamp-ok') }
  })()`)
  if (rowState.name !== s.name || !rowState.lampOk) throw new Error(`тип зразка ${s.cls} не налаштувався: ` + J(rowState))
  console.log(`A2) тип зразка ${s.cls} = «${s.name}»`)
}
await shot('capstone-01-sampletypes.png')

// ---- A3. ЛАНЦЮГИ: два нові файли правил вікнами станків -------------------------------------

await switchTab('Ланцюги')
const chainsStart = await evalJs(`document.querySelectorAll('.station-card').length`)
expectEq('старт полотна: картки станків (8 старих правил)', chainsStart, 8)

// Вікно станка -- хелпери
async function openStationCard(cls) {
  const ok = await evalJs(`(() => {
    const node = [...document.querySelectorAll('.station-card')].find((n) => n.querySelector('.station-card-class')?.textContent.includes(${J(cls)}))
    if (!node) return false
    node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    return true
  })()`)
  if (!ok) throw new Error(`картка станка ${cls} не знайдена на полотні`)
  await sleep(600)
  const open = await evalJs(`!!document.querySelector('.station-window')`)
  if (!open) throw new Error(`вікно станка ${cls} не відкрилось`)
}

async function switchStation(cls) {
  await pick('#sw-station-picker', cls, cls)
  await sleep(700)
  const shown = await evalJs(`document.querySelector('.station-window-class')?.textContent ?? null`)
  if (shown !== cls) throw new Error(`перемикач станка: очікував ${cls}, вікно показує ${shown}`)
}

async function pickTargetFile(path) {
  await pick('#sw-target-file', path, path)
  const val = await fieldValue('#sw-target-file')
  if (val !== path) throw new Error(`цільовий файл не ${path}: ${val}`)
}

async function bulkAdd(classes) {
  for (const cls of classes) {
    await pick('#sw-raw-picker', cls, cls)
  }
  const chips = await evalJs(`[...document.querySelectorAll('.station-chips .station-chip code')].map((c) => c.textContent)`)
  expectEq('чіпи сировини', chips, classes)
  await evalJs(`(() => {
    const btn = document.querySelector('.station-bulk button.primary')
    if (!btn || btn.disabled) throw new Error('кнопка «створити N рядків» недоступна')
    btn.click()
  })()`)
  await sleep(600)
}

// Розгорнути рядок станка за (класнейм, ruleId): серед рядків з тим самим класом може бути
// кілька (старе правило + нова заготовка) -- перевіряємо #rp-id розгорнутої форми.
async function expandRow(cls, ruleId) {
  const already = await fieldValue('#rp-id')
  if (already === ruleId) return
  const idxs = await evalJs(`[...document.querySelectorAll('.station-row')].map((r, i) => ({ i, c: r.querySelector('.station-row-class')?.textContent ?? '' })).filter((x) => x.c === ${J(cls)}).map((x) => x.i)`)
  if (idxs.length === 0) throw new Error(`рядків з класом ${cls} у вікні немає`)
  for (const i of idxs) {
    await evalJs(`document.querySelectorAll('.station-row')[${i}].querySelector('.station-row-head').click()`)
    await sleep(450)
    const cur = await fieldValue('#rp-id')
    if (cur === ruleId) return
    await evalJs(`document.querySelectorAll('.station-row')[${i}].querySelector('.station-row-head').click()`)
    await sleep(250)
  }
  throw new Error(`рядок ${cls}/${ruleId} не знайдено серед ${idxs.length} рядків класу`)
}

// Перейменування правила: TextField #rp-id комітить на кожну подію input (один setValue =
// одна подія з повним значенням).
async function renameRule(newId) {
  await setVal('#rp-id', newId)
  await sleep(300)
  const val = await fieldValue('#rp-id')
  if (val !== newId) throw new Error(`перейменування правила не відбулось: ${val}`)
}

async function addOutput(i, cls) {
  await clickByText('.station-row-body', '+ Додати вихід')
  await pick(`#rp-out-cls-${i}`, cls, cls)
}

async function enableRule(cls, ruleId) {
  await clickSel('#rp-enabled')
  await sleep(500)
  const state = await evalJs(`(() => {
    const rows = [...document.querySelectorAll('.station-row')]
    const row = rows.find((r) => r.querySelector('.station-row-head')?.getAttribute('aria-expanded') === 'true')
    return {
      checked: document.querySelector('#rp-enabled')?.checked ?? null,
      unconfigured: row ? row.classList.contains('station-row-unconfigured') : null,
      flags: row ? [...row.querySelectorAll('.station-row-flag')].map((f) => f.textContent) : [],
    }
  })()`)
  if (state.checked !== true) throw new Error(`правило ${ruleId} не увімкнулось: ` + J(state))
  if (state.unconfigured !== false) throw new Error(`правило ${ruleId} після налаштування лишилось червоним: ` + J(state))
  if (state.flags.some((f) => f.includes('вимкнено'))) throw new Error(`правило ${ruleId} досі з прапором «вимкнено»`)
  console.log(`A3) правило ${ruleId} налаштоване й увімкнене`)
}

// Видалення правила другим натисканням (рекомендований обхід §8.2 -- це теж прожим
// інструмента deleteRule).
async function deleteRuleRow(cls, ruleId) {
  await expandRow(cls, ruleId)
  await clickSel('.station-row-body .station-row-delete')
  await sleep(250)
  await clickSel('.station-row-body .station-row-delete')
  await sleep(500)
  const msg = await evalJs(`document.querySelector('.station-window .indicator')?.textContent ?? ''`)
  if (!msg.includes('видалено')) throw new Error(`правило ${ruleId} не видалилось: ` + msg)
  console.log(`A3) старе правило ${ruleId} видалено редактором`)
}

async function rowsCount() {
  return evalJs(`document.querySelectorAll('.station-row').length`)
}

// Додати запис у StringListEditor-поле (RequiredFactions/RequiredTools) розгорнутого рядка.
async function addListEntry(fieldLabel, ariaBase, n, want) {
  const clicked = await evalJs(`(() => {
    const fields = [...document.querySelectorAll('.station-row-body .rule-field')]
    const field = fields.find((f) => f.querySelector(':scope > span.field-label')?.textContent === ${J(fieldLabel)})
    if (!field) return false
    field.querySelector('.rule-array-add').click()
    return true
  })()`)
  if (!clicked) throw new Error(`поле '${fieldLabel}' не знайдено`)
  await sleep(300)
  await pick(`input[aria-label="${ariaBase} ${n}"]`, want, want)
}

// --- A3.1: пакувальники у НОВОМУ файлі peresbir_lanciuhy.json --------------------------------
await openStationCard('ZP_SampleFridge')
await clickByText('.station-bulk', 'створити новий файл правил')
await setVal('input[aria-label="Імʼя нового файлу правил"]', 'peresbir_lanciuhy')
await clickByText('.station-bulk', 'Створити файл')
await sleep(400)
{
  const target = await fieldValue('#sw-target-file')
  expectEq('цільовий файл після створення', target, 'ProcessingRules/peresbir_lanciuhy.json')
}
await bulkAdd(['Apple', 'Rag'])
expectEq('рядки фрідж після масового додавання (2 старі + 2 нові)', await rowsCount(), 4)

// pb_pak_bio: Apple -> ZP_Sample_01 [авто-Content "Apple"], чистота 0.4-0.8, витрата Rag×1
await expandRow('Apple', 'zp_samplefridge_apple')
await renameRule('pb_pak_bio')
await setBlur('#rp-purity-min', '0.4')
await setBlur('#rp-purity-max', '0.8')
{
  const pmin = await fieldValue('#rp-purity-min')
  const pmax = await fieldValue('#rp-purity-max')
  if (!pmin.startsWith('0.4') || !pmax.startsWith('0.8')) throw new Error(`чистота не закомітилась: ${pmin}/${pmax}`)
}
await clickByText('.station-row-body', '+ Додати витратний')
await pick('#rp-cons-cls-0', 'Rag', 'Rag')
await addOutput(0, 'ZP_Sample_01')
{
  const auto = await evalJs(`({ content: document.querySelector('#rp-out-content-0')?.value ?? null, badge: !!document.querySelector('.content-auto-badge') })`)
  expectEq('авто-Content виходу pb_pak_bio', auto, { content: 'Apple', badge: true })
}
await enableRule('Apple', 'pb_pak_bio')

// pb_pak_teh: Rag -> ZP_Sample_17 [РУЧНА мітка "zapys_detektora"], чистота 0.5 фікс.
await expandRow('Rag', 'zp_samplefridge_rag')
await renameRule('pb_pak_teh')
await addOutput(0, 'ZP_Sample_17')
{
  const auto = await fieldValue('#rp-out-content-0')
  expectEq('авто-Content до ручної мітки', auto, 'Rag')
}
await free('#rp-out-content-0', 'zapys_detektora')
{
  const manual = await evalJs(`({ content: document.querySelector('#rp-out-content-0')?.value ?? null, badge: !!document.querySelector('.content-manual-badge') })`)
  expectEq('ручна мітка Content pb_pak_teh', manual, { content: 'zapys_detektora', badge: true })
}
await enableRule('Rag', 'pb_pak_teh')
await shot('capstone-02-station-fridge.png')

// --- A3.2: поштучний знос СТАРИХ правил (щоб «куди піде результат» лягло в НОВИЙ файл) -------
await deleteRuleRow('Apple', 'chain_pack_chimera')
await deleteRuleRow('Rag', 'chain_pack_bloodsucker')
expectEq('фрідж після зносу старих', await rowsCount(), 2)

await switchStation('ZP_Microscope')
expectEq('мікроскоп: старих правил', await rowsCount(), 5)
await deleteRuleRow('ZP_Sample', 'chain_analyze_chimera')
await deleteRuleRow('ZP_Sample', 'chain_analyze_bloodsucker')
await deleteRuleRow('Rag', 'test_micro_duty')
await deleteRuleRow('Rag', 'test_micro_cheap')
await deleteRuleRow('Apple', 'test_micro_rich')
expectEq('мікроскоп порожній', await rowsCount(), 0)

await switchStation('ZP_PetriDishKit')
await deleteRuleRow('Apple', 'demo_apple_analysis')

// --- A3.3: «куди піде результат» -> заготовки-аналізатори у peresbir_lanciuhy.json -----------
await switchStation('ZP_SampleFridge')
await expandRow('Apple', 'pb_pak_bio')
{
  const linked = await evalJs(`(() => {
    const input = document.querySelector('.station-row-body .station-link-row .zp-select-input')
    if (!input) return { ok: false }
    input.focus()
    window.__t.setValue(input, 'ZP_Microscope')
    return { ok: true }
  })()`)
  if (!linked.ok) throw new Error('пікер «Куди піде результат» на рядку pb_pak_bio не знайдено')
  await sleep(450)
  await evalJs(`(() => {
    const opt = [...document.querySelectorAll('.zp-select-option')].find((o) => o.querySelector('.zp-select-option-hint')?.textContent === 'ZP_Microscope')
    if (!opt) throw new Error('опція ZP_Microscope не знайдена')
    opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  })()`)
  await sleep(800)
  const msg = await evalJs(`document.querySelector('.station-window .indicator')?.textContent ?? ''`)
  if (!msg.includes('аналізатор') || !msg.includes('zp_microscope_apple') || !msg.includes('ProcessingRules/peresbir_lanciuhy.json'))
    throw new Error('заготовка-аналізатор 1 не створилась у новому файлі: ' + msg)
  console.log('A3) «куди піде результат» 1: ' + msg.trim())
}
await shot('capstone-03-link-result.png')

await expandRow('Rag', 'pb_pak_teh')
{
  await evalJs(`(() => {
    const input = document.querySelector('.station-row-body .station-link-row .zp-select-input')
    if (!input) throw new Error('пікер «Куди піде результат» на рядку pb_pak_teh не знайдено')
    input.focus()
    window.__t.setValue(input, 'ZP_Microscope')
  })()`)
  await sleep(450)
  await evalJs(`(() => {
    const opt = [...document.querySelectorAll('.zp-select-option')].find((o) => o.querySelector('.zp-select-option-hint')?.textContent === 'ZP_Microscope')
    if (!opt) throw new Error('опція ZP_Microscope не знайдена (лінк 2)')
    opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  })()`)
  await sleep(800)
  const msg = await evalJs(`document.querySelector('.station-window .indicator')?.textContent ?? ''`)
  if (!msg.includes('zp_microscope_zapys_detektora') || !msg.includes('ProcessingRules/peresbir_lanciuhy.json'))
    throw new Error('заготовка-аналізатор 2 не створилась у новому файлі: ' + msg)
  console.log('A3) «куди піде результат» 2: ' + msg.trim())
}

// --- A3.4: налаштування аналізаторів ---------------------------------------------------------
await switchStation('ZP_Microscope')
expectEq('мікроскоп: дві заготовки-аналізатори', await rowsCount(), 2)

await expandRow('ZP_Sample_01', 'zp_microscope_apple')
{
  const streamMode = await evalJs(`document.querySelector('#rp-input-stream-mode')?.checked ?? null`)
  if (streamMode !== true) throw new Error('«Вхід із потоку» не авто-увімкнений на аналізаторі 1')
}
await renameRule('pb_analiz_bio')
await setBlur('#rp-time', '15')
await addOutput(0, 'ZP_Data_01')
{
  const contentField = await evalJs(`document.querySelector('#rp-out-content-0') !== null`)
  expectEq('поле Content на виході-заготовці відсутнє (не зразок)', contentField, false)
}
await enableRule('ZP_Sample_01', 'pb_analiz_bio')

await expandRow('ZP_Sample_17', 'zp_microscope_zapys_detektora')
await renameRule('pb_analiz_teh')
await setBlur('#rp-time', '15')
await addOutput(0, 'ZP_Data_61')
// RequiredNode -- ZpSelect по вузлах НОВОГО дерева (єдине й обов'язкове RequiredNode-правило)
await pick('#rp-required-node', 'pb_osnovy', 'pb_osnovy')
{
  const nodeVal = await fieldValue('#rp-required-node')
  expectEq('RequiredNode показує обличчя вузла', nodeVal, 'Польові основи')
}
await evalJs(`document.querySelector('#rp-required-node').scrollIntoView({ block: 'center' })`)
await sleep(300)
await shot('capstone-04-requirednode.png')
await enableRule('ZP_Sample_17', 'pb_analiz_teh')

// --- A3.5: гейт-тестові правила у peresbir_mikroskop.json ------------------------------------
await clickByText('.station-bulk', 'створити новий файл правил')
await setVal('input[aria-label="Імʼя нового файлу правил"]', 'peresbir_mikroskop')
await clickByText('.station-bulk', 'Створити файл')
await sleep(400)
{
  const target = await fieldValue('#sw-target-file')
  expectEq('цільовий файл 2', target, 'ProcessingRules/peresbir_mikroskop.json')
}

// pb_mikro_varta -- на РІДНОМУ приладі duty (ZP_ServerRack; рішення §9.1 маніфесту)
await switchStation('ZP_ServerRack')
expectEq('серверна шафа порожня', await rowsCount(), 0)
await pickTargetFile('ProcessingRules/peresbir_mikroskop.json')
await bulkAdd(['Rag'])
await expandRow('Rag', 'zp_serverrack_rag')
await renameRule('pb_mikro_varta')
await setBlur('#rp-time', '30')
await addOutput(0, 'Paper')
await addListEntry('Потрібні фракції (RequiredFactions)', 'Потрібна фракція', 1, 'duty')
await enableRule('Rag', 'pb_mikro_varta')

// pb_mikro_deshevo + pb_mikro_tsinno -- ZP_Microscope
await switchStation('ZP_Microscope')
await pickTargetFile('ProcessingRules/peresbir_mikroskop.json')
await bulkAdd(['Rag', 'Apple'])
expectEq('мікроскоп: 2 аналізатори + 2 нові заготовки', await rowsCount(), 4)

await expandRow('Rag', 'zp_microscope_rag')
await renameRule('pb_mikro_deshevo')
await setBlur('#rp-time', '20')
await addOutput(0, 'Paper')
await addListEntry('Потрібні фракції (RequiredFactions)', 'Потрібна фракція', 1, 'ecolog')
await addListEntry('Потрібні фракції (RequiredFactions)', 'Потрібна фракція', 2, 'clearsky')
await enableRule('Rag', 'pb_mikro_deshevo')

await expandRow('Apple', 'zp_microscope_apple')
await renameRule('pb_mikro_tsinno')
await setBlur('#rp-time', '90')
await addOutput(0, 'Paper')
await addListEntry('Потрібні фракції (RequiredFactions)', 'Потрібна фракція', 1, 'ecolog')
await addListEntry('Потрібні фракції (RequiredFactions)', 'Потрібна фракція', 2, 'clearsky')
await addListEntry('Потрібні інструменти (RequiredTools)', 'Потрібний інструмент', 1, 'ZP_Tool_Optics')
await enableRule('Apple', 'pb_mikro_tsinno')
await shot('capstone-05-station-microscope.png')

// ---- A4. Фінальні ассерти чистоти + капстоун-кадри ------------------------------------------

// Полотно ланцюгів: 7 карток (7 правил), 0 розривів, «Розривів немає»
await clickByText('.station-window', '×')
await sleep(500)
await evalJs(`document.querySelector('.react-flow__controls-fitview')?.click()`)
await sleep(900)
{
  const canvas = await evalJs(`({
    cards: document.querySelectorAll('.station-card').length,
    breakEdges: document.querySelectorAll('.break-edge').length,
    breaksPanelOk: !!document.querySelector('.breaks-panel.ok'),
    breaksText: document.querySelector('.breaks-panel')?.textContent ?? '',
  })`)
  expectEq('фінальне полотно: картки станків', canvas.cards, 7)
  expectEq('фінальне полотно: break-ребра', canvas.breakEdges, 0)
  if (!canvas.breaksPanelOk || !canvas.breaksText.includes('Розривів немає'))
    throw new Error('панель розривів не «Розривів немає»: ' + canvas.breaksText)
}
await shot('capstone-06-chains-clean.png')
console.log('A4) полотно ланцюгів чисте: 7 станків, 0 розривів')

// Дерево: кадр кожної нової гілки + панель проблем
await switchTab('Дерево')
const shotByBranch = { peresbir_nauka: 'capstone-07-tree-pb-nauka.png', peresbir_nebo: 'capstone-08-tree-pb-nebo.png', peresbir_varta: 'capstone-09-tree-pb-varta.png' }
for (const b of BRANCHES) {
  for (let i = 0; i < 8; i++) {
    const plate = await evalJs(`document.querySelector('.tree-branch-plate')?.textContent ?? ''`)
    if (plate.includes(b.path)) break
    await clickSel('button[aria-label="Наступна гілка"]')
    await sleep(800)
    if (i === 7) throw new Error(`гілка ${b.path} не знайшлась перемикачем`)
  }
  await evalJs(`document.querySelector('.react-flow__controls-fitview')?.click()`)
  await sleep(600)
  const st = await evalJs(`({
    cards: document.querySelectorAll('.tree-node-card').length,
    alarms: document.querySelectorAll('.tree-node-card.tree-node-alarm').length,
    problems: document.querySelector('.tree-problems-panel')?.textContent ?? '',
  })`)
  expectEq(`фінал ${b.id}: вузли`, st.cards, b.nodes.length)
  expectEq(`фінал ${b.id}: alarm`, st.alarms, 0)
  if (!st.problems.includes('Проблем дерева немає')) throw new Error(`панель проблем дерева не порожня на ${b.id}: ` + st.problems)
  await shot(shotByBranch[b.file])
}
console.log('A4) усі три нові гілки чисті, «Проблем дерева немає»')

// Гейт W2.7: жодного alarm-файлу, «Зберегти зміни» доступна
{
  const gate = await evalJs(`({
    alarmPanel: !!document.querySelector('.alarm-gate-panel'),
    saveDisabled: [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Зберегти зміни'))?.disabled ?? null,
  })`)
  expectEq('гейт W2.7: alarm-панель відсутня', gate.alarmPanel, false)
  expectEq('гейт W2.7: «Зберегти зміни» доступна', gate.saveDisabled, false)
}

// ---- A5. Зберегти -> Завантажити ZIP -> структурна звірка з маніфестом ----------------------

await clickByText(null, 'Зберегти зміни')
await sleep(900)
{
  const status = await evalJs(`[...document.querySelectorAll('.indicator')].map((i) => i.textContent).join(' | ')`)
  if (!status.includes('Збережено файлів: 9')) throw new Error('очікував «Збережено файлів: 9» (3 старі спорожнілі + 2 нові правила + 3 гілки + SampleTypes): ' + status)
  console.log('A5) ' + status.trim())
}
{
  const gate = await evalJs(`({
    exportDisabled: [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Завантажити ZIP'))?.disabled ?? null,
    alarmPanel: !!document.querySelector('.alarm-gate-panel'),
  })`)
  expectEq('гейт W2.7 після збереження: експорт доступний', gate, { exportDisabled: false, alarmPanel: false })
}
await shot('capstone-10-gate-clean.png')

const exportedA = await downloadZip('A5')
const namesA = Object.keys(exportedA).filter((n) => !n.endsWith('/'))
expectEq('файлів в експорті A (12 вхідних + 5 нових)', namesA.length, 17)

// Незаймані -- байт-у-байт
for (const rel of UNTOUCHED_FILES) {
  const out = exportedA[rel]
  if (!out) throw new Error(`${rel} відсутній в експорті`)
  if (Buffer.compare(Buffer.from(out), originalBytes.get(rel)) !== 0) throw new Error(`${rel} мав лишитись байт-у-байт, а змінився`)
}
console.log('A5) 8 незайманих файлів (5 одиночних + 3 старі гілки) -- байт-у-байт')

// Старі файли правил -- спорожнілі (правила видалено поштучно deleteRule)
for (const rel of ['ProcessingRules/chain.json', 'ProcessingRules/demo.json', 'ProcessingRules/test_micro.json']) {
  const doc = JSON.parse(new TextDecoder('utf-8').decode(exportedA[rel]))
  expectEq(`${rel}: спорожнілий`, doc.Rules.length, 0)
}

// Нові файли -- СТРУКТУРНО поле-в-поле проти маніфесту
function verifyDoc(rel, expected) {
  const raw = exportedA[rel]
  if (!raw) throw new Error(`${rel} відсутній в експорті`)
  const doc = JSON.parse(new TextDecoder('utf-8').decode(raw))
  expectEq(rel, doc, expected)
  console.log(`A5) ${rel} звірено структурно з маніфестом`)
}
verifyDoc('ProcessingRules/peresbir_lanciuhy.json', EXPECT_LANCIUHY)
verifyDoc('ProcessingRules/peresbir_mikroskop.json', EXPECT_MIKROSKOP)
for (const b of BRANCHES) verifyDoc(b.path, expectedBranchDoc(b))
verifyDoc('SampleTypes.json', EXPECT_SAMPLETYPES)

// Розпакувати НОВІ файли в EXPORT_DIR (сирі байти редактора -- саме вони їдуть на стенд)
for (const rel of DISK_WRITE) {
  const full = join(EXPORT_DIR, ...rel.split('/'))
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, Buffer.from(exportedA[rel]))
}
console.log('A5) нові файли розпаковано в', EXPORT_DIR)

// ============================ ФАЗА B: розкладка на стенд =====================================
// Поза редактором (діра §8.1: видалення ФАЙЛУ в редакторі немає -- зафіксований дефект).

console.log('B) розкладка на стенд:')
for (const rel of DISK_DELETE) {
  const full = join(STAND, ...rel.split('/'))
  unlinkSync(full)
  console.log(`   ВИДАЛЕНО  ${rel}`)
}
for (const rel of DISK_WRITE) {
  const full = join(STAND, ...rel.split('/'))
  writeFileSync(full, Buffer.from(exportedA[rel]))
  console.log(`   ЗАПИСАНО  ${rel} (${exportedA[rel].length} байт)`)
}
console.log('   НЕ ТОРКАЛИСЬ: Settings/PointTypes/Factions/DataItems/Modules, StaticDevices*, FactionData/, PlayerData/, ConfigBackup/')

// ============================ ФАЗА C: ідемпотентність ========================================
// Свіжа сторінка -> імпорт ZIP з УЖЕ перебудованого стенду -> експорт БЕЗ правок ->
// 0 змінених байтів.

const standBytes = new Map()
{
  const zipInput = {}
  for (const rel of NEW_STAND_FILES) {
    const buf = readFileSync(join(STAND, ...rel.split('/')))
    standBytes.set(rel, buf)
    zipInput[rel] = new Uint8Array(buf)
  }
  writeFileSync(join(DIST, FIXTURE_C), zipSync(zipInput))
}

await send('Page.navigate', { url: URL })
await waitReady()
await injectHelpers()
await importZip(FIXTURE_C)
console.log('C) імпортовано перебудований стенд (11 файлів)')

{
  const state = await evalJs(`({
    alarmPanel: !!document.querySelector('.alarm-gate-panel'),
    saveDisabled: [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Зберегти зміни'))?.disabled ?? null,
    exportDisabled: [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Завантажити ZIP'))?.disabled ?? null,
  })`)
  // dirty=0 (нічого не правилось) -> «Зберегти» неактивна; alarm нема -> експорт доступний
  expectEq('C: гейти після імпорту', state, { alarmPanel: false, saveDisabled: true, exportDisabled: false })
}

await switchTab('Ланцюги')
{
  const canvas = await evalJs(`({
    cards: document.querySelectorAll('.station-card').length,
    breakEdges: document.querySelectorAll('.break-edge').length,
    breaksText: document.querySelector('.breaks-panel')?.textContent ?? '',
  })`)
  expectEq('C: картки станків', canvas.cards, 7)
  expectEq('C: break-ребра', canvas.breakEdges, 0)
  if (!canvas.breaksText.includes('Розривів немає')) throw new Error('C: панель розривів не чиста: ' + canvas.breaksText)
}
await switchTab('Дерево')
{
  const tree = await evalJs(`({
    plate: document.querySelector('.tree-branch-plate')?.textContent ?? '',
    problems: document.querySelector('.tree-problems-panel')?.textContent ?? '',
  })`)
  if (!tree.plate.includes('гілка 1 з 3')) throw new Error('C: не 3 гілки: ' + tree.plate)
  if (!tree.problems.includes('Проблем дерева немає')) throw new Error('C: проблеми дерева: ' + tree.problems)
}
await shot('capstone-11-idempotent.png')

const exportedC = await downloadZip('C')
const namesC = Object.keys(exportedC).filter((n) => !n.endsWith('/'))
expectEq('C: кількість файлів', namesC.length, NEW_STAND_FILES.length)
for (const rel of NEW_STAND_FILES) {
  const out = exportedC[rel]
  if (!out) throw new Error(`C: ${rel} відсутній в експорті`)
  if (Buffer.compare(Buffer.from(out), standBytes.get(rel)) !== 0) throw new Error(`C: ${rel} змінився -- ідемпотентність порушено`)
}
console.log(`C) ідемпотентність доведена: усі ${NEW_STAND_FILES.length} файлів байт-у-байт, зайвих немає`)

// ---- Фінал ----------------------------------------------------------------------------------
console.log('консольні помилки за обидві фази:', consoleErrors.length, consoleErrors)
if (consoleErrors.length > 0) throw new Error('консоль не чиста: ' + consoleErrors.join(' | '))

ws.close()
chrome.kill()
rmSync(join(DIST, FIXTURE_A), { force: true })
rmSync(join(DIST, FIXTURE_C), { force: true })
console.log('ГОТОВО: перезбір завершено, стенд несе НОВИЙ контент маніфесту (бут сервера -- T3).')
