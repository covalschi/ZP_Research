// Живе приймання W4 (Task 7): ZIP-цикл через РЕАЛЬНИЙ профіль стенду
// (testserver\profiles\ZP_Research) новими вкладками W4 — той самий прийом headless Chrome
// + сирий CDP, що t3-5-accept.mjs (W3) і t5-accept.mjs (W2.5). Жодної правки JSON руками:
// усі зміни робляться кліками/полями редактора.
//
// ФАЗА 1 (без аргументів) — приймальний цикл:
//   (0) імпорт ZIP з 11 реальних конфіг-файлів стенду (Steam64 адміна ЗАМІНЕНО
//       плейсхолдером ще при збиранні фікстури — прецедент витоку W1/t4-4: справжній Id не
//       сміє потрапити ні у фікстуру, ні в кадр; guard нижче звіряє весь DOM);
//   (1) «Бали»: правка Name і Color наявного типу bio_field_t1 (кадр «а»);
//   (2) «Фракції»: створення фракції-чернетки varta (path-safe Id, DisplayName, Supertype
//       зі спостережених, нашивка Armband_Pink — ВАНІЛЬНИЙ клас, вільний від інших
//       фракцій, тож сервер не додасть жодного нового попередження про відсутній клас)
//       (кадр «б»);
//   (3) «Модулі»: правка PurityBonus наявного модуля 0.25 -> 0.35 (fround-канон друку
//       перевіряється в БАЙТАХ експорту, а потім ще й проти того, що запише сам рушій)
//       (кадр «в»);
//   (4) «Налаштування»: TreeVisibilityDepth 2 -> 3 (кадр «г»);
//   (5) «Заготовки»: правка Name наявної заготовки ZP_Data_77 (кадр «д»);
//   (6) «Баланс»: кадр реального стану стенду, БЕЗ правок (read-only) (кадр «е»);
//   (7) Зберегти -> Завантажити ZIP -> звірка байтів: РІВНО 5 змінених файлів, решта 6 —
//       байт-у-байт; вміст змінених перевіряється структурно (JSON.parse), а не підрядками;
//   (8) змінені файли розпаковуються в EXPORT_DIR — запис на стенд робить ОКРЕМИЙ крок
//       (Bash), як у t3-5-accept.mjs/t5-accept.mjs.
//
// ФАЗА 2 (`--gate`) — перевірка гейта ДАНИХ (головна фіча W4/T1-T2): ZIP збирається з
// поточного стенду, у якому РУКОПИСНО зроблено дубль Id типу балів; редактор мусить
// заблокувати і збереження, і експорт, пояснити ризик і повести на вкладку «Бали», де
// ремонт робиться кнопкою близнюка (кадри «ж» і «з»).
//
// FactionData/PlayerData/ConfigBackup/StaticDevices* НІКОЛИ не потрапляють у ZIP.
//
// Запуск: `node tests/tools/t4-7-accept.mjs` (з webeditor/, vite preview вже на :4173).

import { unzipSync, zipSync } from 'fflate'
import { spawn } from 'child_process'
import { writeFileSync, mkdtempSync, readFileSync, existsSync, readdirSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const GATE = process.argv.includes('--gate')

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = process.env.T4_7_OUT || 'E:/TMP/claude/E--dayzmod/ef2600b9-21a8-43d6-8043-cf5a4904c3ec/scratchpad'
const DOWNLOAD_DIR = join(OUT, 't4-7-downloads')
const EXPORT_DIR = join(OUT, 't4-7-exported')
const PORT = GATE ? 9353 : 9352
const URL = 'http://localhost:4173/'
const DIST = 'E:/dayzmod/webeditor/dist'
const STAND = 'E:/dayzmod/testserver/profiles/ZP_Research'
const PLACEHOLDER = '76561190000000000'
const ZIP_NAME = GATE ? 't4-7-gate.zip' : 't4-7-stand.zip'

mkdirSync(OUT, { recursive: true })
if (!GATE) {
  rmSync(DOWNLOAD_DIR, { recursive: true, force: true })
  mkdirSync(DOWNLOAD_DIR, { recursive: true })
  rmSync(EXPORT_DIR, { recursive: true, force: true })
  mkdirSync(EXPORT_DIR, { recursive: true })
}

// ---- 1. ZIP із РЕАЛЬНИХ конфіг-файлів стенду -------------------------------------------------

const STAND_FILES = [
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

// Файли, які цей цикл СВІДОМО змінює (решта мусить приїхати байт-у-байт).
const EXPECT_CHANGED = ['Settings.json', 'PointTypes.json', 'Factions.json', 'DataItems.json', 'Modules.json']

const originalBytes = new Map()
const zipInput = {}
for (const rel of STAND_FILES) {
  const buf = readFileSync(join(STAND, ...rel.split('/')))
  originalBytes.set(rel, buf)
  zipInput[rel] = new Uint8Array(buf)
}
// Steam64 адміна -> плейсхолдер (єдина підміна вхідних байтів; Settings.json цей цикл і так
// змінює, а справжній Id не сміє потрапити у кадр). Підміна робиться ТЕКСТОВО, щоб не
// перебудовувати канонічний друк файлу тут.
{
  const text = originalBytes.get('Settings.json').toString('utf8')
  const doc = JSON.parse(text)
  if (!Array.isArray(doc.AdminIds) || doc.AdminIds.length !== 1) {
    throw new Error('стендовий Settings.json зсунувся: чекав рівно 1 AdminId, є ' + JSON.stringify(doc.AdminIds))
  }
  const real = doc.AdminIds[0]
  const patched = text.split(real).join(PLACEHOLDER)
  // Фаза гейта запускається вже ПІСЛЯ приймального буту, коли на стенді лежить експорт
  // редактора з плейсхолдером — тоді підміняти нічого й не треба.
  if (patched === text && real !== PLACEHOLDER) throw new Error('підміна Steam64 не спрацювала')
  zipInput['Settings.json'] = new TextEncoder().encode(patched)
  originalBytes.set('Settings.json', Buffer.from(patched, 'utf8'))
}
const standZip = zipSync(zipInput)
writeFileSync(join(DIST, ZIP_NAME), standZip)
console.log(`фікстура зі стенду зібрана: ${standZip.length} байт, ${STAND_FILES.length} файлів (фаза ${GATE ? 'гейта' : 'приймання'})`)

// ---- 2. headless Chrome + сирий CDP ----------------------------------------------------------

const profile = mkdtempSync(join(tmpdir(), 't47accept-'))
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1680,1050',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('JS: ' + JSON.stringify(r.exceptionDetails))
  return r.result?.value
}

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  writeFileSync(join(OUT, name), Buffer.from(r.data, 'base64'))
  console.log('знято', join(OUT, name))
}

// Кадр ОДНІЄЇ секції (прийом t4-5-shoot): кліп по прямокутнику елемента в сторінкових
// координатах — інакше три різні секції довгої вкладки дають три однакові файли.
async function shotOf(selector, name) {
  const box = await evalJs(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height }
  })()`)
  if (!box) throw new Error('немає елемента для кадру: ' + selector)
  const clip = { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height), scale: 1 }
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip })
  writeFileSync(join(OUT, name), Buffer.from(r.data, 'base64'))
  console.log('знято', join(OUT, name), `${clip.width}x${clip.height}`)
}

// Жорсткий console-assert (конвенція смоуків W3/W4): будь-яка console.error за сесію — провал.
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

await send('Page.navigate', { url: URL })
for (let i = 0; i < 60; i++) {
  const ready = await evalJs(`!!document.getElementById('import-zip-input')`)
  if (ready) break
  await sleep(400)
  if (i === 59) throw new Error('сторінка не завантажилась: #import-zip-input так і не зʼявився')
}

// ---- Спільні дрібниці харнеса ----------------------------------------------------------------

async function importZip(name) {
  await evalJs(`(async () => {
    const res = await fetch(${JSON.stringify(URL)} + ${JSON.stringify(name)})
    const buf = await res.arrayBuffer()
    const dt = new DataTransfer()
    dt.items.add(new File([buf], ${JSON.stringify(name)}, { type: 'application/zip' }))
    const input = document.getElementById('import-zip-input')
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(1000)
}

// React-контрольований input: нативний сеттер + подія input (el.value без події React не бачить).
async function setInput(elementId, value) {
  await evalJs(`(() => {
    const el = document.getElementById(${JSON.stringify(elementId)})
    if (!el) throw new Error('немає поля #' + ${JSON.stringify(elementId)})
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, ${JSON.stringify(value)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(150)
}

// Квірк headless Chrome (урок T8/T9): el.blur() НЕ породжує focusout, на якому тримається
// React onBlur — буферні поля (FloatField/IntField) комітять САМЕ на blur.
async function blurField(elementId) {
  await evalJs(`(() => {
    const el = document.getElementById(${JSON.stringify(elementId)})
    if (!el) throw new Error('немає поля #' + ${JSON.stringify(elementId)})
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })()`)
  await sleep(300)
}

async function clickTab(label) {
  await evalJs(`[...document.querySelectorAll('.tab-button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)}).click()`)
  await sleep(600)
}

async function clickRow(codeText) {
  const found = await evalJs(`(() => {
    const btn = [...document.querySelectorAll('table.entity-table .row-select')].find((b) => b.querySelector('code')?.textContent === ${JSON.stringify(codeText)})
    if (!btn) return false
    btn.click()
    return true
  })()`)
  if (!found) throw new Error('рядка з кодом не знайдено: ' + codeText)
  await sleep(400)
}

async function clickByAria(label) {
  const found = await evalJs(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === ${JSON.stringify(label)})
    if (!btn) return false
    btn.click()
    return true
  })()`)
  if (!found) throw new Error('кнопки з aria-label не знайдено: ' + label)
  await sleep(400)
}

// ZpSelect за aria-label поля: набрати запит, клікнути (mousedown — саме він комітить)
// опцію з точним label АБО hint == want.
async function pickZpByAria(ariaLabel, query, want) {
  const ok = await evalJs(`(() => {
    const el = [...document.querySelectorAll('input.zp-select-input')].find((i) => i.getAttribute('aria-label') === ${JSON.stringify(ariaLabel)})
    if (!el) return false
    el.focus()
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, ${JSON.stringify(query)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  if (!ok) throw new Error('ZpSelect з aria-label не знайдено: ' + ariaLabel)
  await sleep(500)
  const picked = await evalJs(`(() => {
    const opts = [...document.querySelectorAll('.zp-select-option')]
    const target = opts.find((o) => {
      const label = o.querySelector('.zp-select-option-label')?.textContent?.trim() ?? ''
      const hint = o.querySelector('.zp-select-option-hint')?.textContent?.trim() ?? ''
      return label === ${JSON.stringify(want)} || hint === ${JSON.stringify(want)}
    })
    if (!target) return { ok: false, seen: opts.map((o) => o.textContent.trim()).slice(0, 8) }
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    return { ok: true }
  })()`)
  if (!picked.ok) throw new Error(`ZpSelect '${ariaLabel}': опції '${want}' немає за запитом '${query}'; бачив: ${JSON.stringify(picked.seen)}`)
  await sleep(400)
}

async function saveDisabled() {
  return evalJs(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Зберегти зміни'))?.disabled ?? null`)
}

async function exportDisabled() {
  return evalJs(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Завантажити ZIP'))?.disabled ?? null`)
}

function expectEq(what, actual, want) {
  const a = JSON.stringify(actual)
  const w = JSON.stringify(want)
  if (a !== w) throw new Error(`${what}: очікував ${w}, маю ${a}`)
}

async function finish(message) {
  console.log('консольні помилки за сесію:', consoleErrors.length, consoleErrors)
  if (consoleErrors.length > 0) throw new Error('консольні помилки в сесії: ' + consoleErrors.join(' | '))
  ws.close()
  chrome.kill()
  rmSync(join(DIST, ZIP_NAME), { force: true })
  console.log(message)
}

// ---- ФАЗА 2: гейт даних (дубль Id типу балів у РУКОПИСНО зіпсованому стендовому файлі) --------

if (GATE) {
  await importZip(ZIP_NAME)

  const gateOn = await evalJs(`(() => {
    const dataSection = document.querySelector('.alarm-gate-data-section')
    const gotoBtn = dataSection ? [...dataSection.querySelectorAll('button')].find((b) => b.textContent.includes('Бали')) : null
    return {
      section: dataSection ? dataSection.textContent : null,
      hasGoto: !!gotoBtn,
    }
  })()`)
  const gateSave = await saveDisabled()
  const gateExport = await exportDisabled()
  console.log('гейт даних:', JSON.stringify({ section: (gateOn.section ?? '').slice(0, 140), hasGoto: gateOn.hasGoto, gateSave, gateExport }))
  if (!gateOn.section || !gateOn.section.includes('реєстр типів балів')) throw new Error('немає аварійної секції даних-гейта')
  if (!gateOn.section.includes("дублікат Id 'bio_field_t1'")) throw new Error('секція гейта не називає рукописний дубль: ' + gateOn.section)
  if (!gateOn.hasGoto) throw new Error('немає переходу на вкладку «Бали»')
  if (gateSave !== true) throw new Error('«Зберегти зміни» мало бути ЗАБЛОКОВАНЕ гейтом даних')
  if (gateExport !== true) throw new Error('«Завантажити ZIP» мало бути ЗАБЛОКОВАНЕ гейтом даних')
  await shot('t4-7-zh-gate-blocked.png')

  // Перехід кнопкою самої панелі — тим самим шляхом, яким піде адмін.
  await evalJs(`(() => {
    const dataSection = document.querySelector('.alarm-gate-data-section')
    const btn = [...dataSection.querySelectorAll('button')].find((b) => b.textContent.includes('Бали'))
    btn.click()
  })()`)
  await sleep(700)
  const onTab = await evalJs(`(() => {
    const cell = document.querySelector('td.pt-cell[data-cat="bio"][data-kind="field"][data-tier="1"]')
    return {
      active: [...document.querySelectorAll('.tab-button')].find((b) => b.getAttribute('aria-selected') === 'true')?.textContent.trim() ?? null,
      banner: document.querySelector('.pt-gate-banner')?.textContent ?? null,
      dupEntries: cell ? cell.querySelectorAll('.pt-cell-entry-dup').length : null,
      dupDelete: cell ? cell.querySelectorAll('.pt-entry-delete').length : null,
      entries: document.querySelectorAll('table.pt-matrix .pt-entry-select').length,
    }
  })()`)
  console.log('вкладка «Бали» з дублем:', JSON.stringify({ ...onTab, banner: (onTab.banner ?? '').slice(0, 120) }))
  if (onTab.active !== 'Бали') throw new Error('перехід не привів на вкладку «Бали»: ' + onTab.active)
  if (!onTab.banner || !onTab.banner.includes('реєстр типів балів')) throw new Error('банер вкладки відсутній')
  if (onTab.dupEntries !== 2) throw new Error('чекав 2 позначені близнюки в клітинці, є ' + onTab.dupEntries)
  if (onTab.dupDelete !== 2) throw new Error('кнопка видалення мусить бути на КОЖНОМУ близнюку, є ' + onTab.dupDelete)
  if (onTab.entries !== 25) throw new Error('чекав 25 записів (24 стендові + рукописний), є ' + onTab.entries)

  // Ремонт: прибрати РУКОПИСНОГО близнюка (він дописаний у кінець масиву -> запис №25).
  await clickByAria('Видалити запис №25')
  const repaired = await evalJs(`(() => ({
    banner: document.querySelectorAll('.pt-gate-banner').length,
    dataSection: document.querySelectorAll('.alarm-gate-data-section').length,
    dupEntries: document.querySelectorAll('.pt-cell-entry-dup').length,
    entries: document.querySelectorAll('table.pt-matrix .pt-entry-select').length,
  }))()`)
  const repairedSave = await saveDisabled()
  console.log('після ремонту:', JSON.stringify({ ...repaired, repairedSave }))
  if (repaired.banner !== 0) throw new Error('банер вкладки не згас після видалення близнюка')
  if (repaired.dataSection !== 0) throw new Error('аварійна панель гейта не згасла')
  if (repaired.dupEntries !== 0) throw new Error('позначки дубля лишились')
  if (repaired.entries !== 24) throw new Error('чекав 24 записи після ремонту, є ' + repaired.entries)
  if (repairedSave !== false) throw new Error('гейт не відкрився: збереження досі заблоковане')
  await shot('t4-7-z-gate-repaired.png')

  await finish('готово: гейт даних заблокував і відпустив (стендовий файл повертає ОКРЕМИЙ крок із бекапу)')
  process.exit(0)
}

// ---- ФАЗА 1, крок (0): імпорт реального стенду ------------------------------------------------

await importZip(ZIP_NAME)
const loaded = await evalJs(`(() => {
  const rows = [...document.querySelectorAll('table.file-list tbody tr')]
  const alarms = document.querySelectorAll('.alarm-gate-panel').length
  return { files: rows.length, alarms }
})()`)
console.log('0) проєкт зі стенду:', JSON.stringify(loaded))
if (loaded.files !== STAND_FILES.length) throw new Error(`чекав ${STAND_FILES.length} файлів у реєстрі, є ` + loaded.files)
if (loaded.alarms !== 0) throw new Error('на чистому стенді аварійної панелі бути не мало')

// ---- (1) «Бали»: правка Name і Color наявного типу --------------------------------------------

const PT_ID = 'bio_field_t1'
const PT_NAME = 'Польова біологія 1 тиру (приймання W4)'
const PT_COLOR = '#FF8800'

await clickTab('Бали')
await evalJs(`(() => {
  const btn = [...document.querySelectorAll('table.pt-matrix .pt-entry-select')].find((b) => b.getAttribute('title') === ${JSON.stringify(PT_ID)})
  if (!btn) throw new Error('запис ' + ${JSON.stringify(PT_ID)} + ' не знайдений у матриці')
  btn.click()
})()`)
await sleep(400)
const ptBefore = await evalJs(`document.getElementById('pt-name')?.value ?? null`)
if (ptBefore !== 'Польове дослідження біології 1 тиру') throw new Error('панель відкрилась не на ' + PT_ID + ': ' + ptBefore)
await setInput('pt-name', PT_NAME)
await setInput('pt-color', PT_COLOR)
const ptState = await evalJs(`(() => {
  const cell = document.querySelector('td.pt-cell[data-cat="bio"][data-kind="field"][data-tier="1"]')
  const chip = cell?.querySelector('.pt-entry-select .pt-color-chip')
  return {
    cellName: cell?.querySelector('.pt-entry-name')?.textContent ?? null,
    cellChip: chip ? getComputedStyle(chip).backgroundColor : null,
    panelName: document.getElementById('pt-name')?.value ?? null,
    panelColor: document.getElementById('pt-color')?.value ?? null,
    banner: document.querySelectorAll('.pt-gate-banner').length,
  }
})()`)
console.log('1) тип балів після правки:', JSON.stringify(ptState))
if (ptState.cellName !== PT_NAME) throw new Error('імʼя в клітинці не оновилось живцем: ' + ptState.cellName)
if (ptState.cellChip !== 'rgb(255, 136, 0)') throw new Error('чіп кольору не перефарбувався: ' + ptState.cellChip)
if (ptState.panelColor !== PT_COLOR) throw new Error('поле кольору втратило набране: ' + ptState.panelColor)
if (ptState.banner !== 0) throw new Error('правка імені/кольору не сміла запалити гейт-банер')
await shot('t4-7-a-points.png')

// ---- (2) «Фракції»: створення фракції-чернетки -------------------------------------------------

const FX_ID = 'varta'
const FX_NAME = 'Варта (чернетка приймання W4)'
const FX_SUPER = 'combat'
const FX_ARMBAND = 'Armband_Pink'

await clickTab('Фракції')
await setInput('fx-new-id', FX_ID)
await clickByAria('Створити фракцію')
const fxCreated = await evalJs(`(() => ({
  rows: document.querySelectorAll('table.entity-table tbody tr').length,
  panelId: document.getElementById('fx-id')?.value ?? null,
}))()`)
console.log('2) після створення фракції:', JSON.stringify(fxCreated))
if (fxCreated.rows !== 8) throw new Error('чекав 8 рядків після створення, є ' + fxCreated.rows)
if (fxCreated.panelId !== FX_ID) throw new Error('панель не перейшла на нову фракцію: ' + fxCreated.panelId)

await setInput('fx-displayname', FX_NAME)
await pickZpByAria('Супертип фракції', FX_SUPER, FX_SUPER)
// Нашивка: «+ Додати» у ПЕРШОМУ масиві панелі (Armbands), далі ZpSelect рядка 1.
await evalJs(`document.querySelectorAll('.entity-detail .rule-array')[0].querySelector('.rule-array-add').click()`)
await sleep(400)
await pickZpByAria('Нашивка 1', FX_ARMBAND, FX_ARMBAND)

const fxState = await evalJs(`(() => {
  const row = [...document.querySelectorAll('table.entity-table tbody tr')].find((r) => r.querySelector('.row-select code')?.textContent === ${JSON.stringify(FX_ID)})
  const tds = row ? [...row.querySelectorAll('td')] : []
  const detail = document.querySelector('.entity-detail')
  return {
    rowName: tds[1]?.textContent ?? null,
    counts: [tds[2]?.textContent, tds[3]?.textContent, tds[4]?.textContent],
    lamp: tds[5]?.querySelector('.lamp')?.className ?? '',
    alarms: detail ? [...detail.querySelectorAll('.field-message-alarm')].map((m) => m.textContent) : null,
    displayName: document.getElementById('fx-displayname')?.value ?? null,
    supertype: document.getElementById('fx-supertype')?.value ?? null,
  }
})()`)
console.log('2) фракція-чернетка:', JSON.stringify(fxState))
if (fxState.rowName !== FX_NAME) throw new Error('назва не доїхала до рядка: ' + fxState.rowName)
if (fxState.counts.join(',') !== '1,0,0') throw new Error('лічильники нашивок/терміналів/приладів не 1/0/0: ' + fxState.counts)
if (fxState.supertype !== FX_SUPER) throw new Error('супертип у панелі: ' + fxState.supertype)
if (fxState.alarms.length !== 0) throw new Error('на заповненій чернетці alarm-повідомлень бути не мало: ' + JSON.stringify(fxState.alarms))
await shot('t4-7-b-factions.png')

// ---- (3) «Модулі»: правка PurityBonus (fround-канон) ------------------------------------------

const MD_CLASS = 'ZP_Tool_Reagents'
const MD_BONUS_TEXT = '0.35'

await clickTab('Модулі')
await clickRow(MD_CLASS)
const mdBefore = await evalJs(`document.getElementById('md-bonus')?.value ?? null`)
if (mdBefore !== '0.25') throw new Error('панель відкрилась не на ' + MD_CLASS + ' (бонус ' + mdBefore + ')')
await setInput('md-bonus', MD_BONUS_TEXT)
await blurField('md-bonus')
const mdState = await evalJs(`(() => {
  const row = [...document.querySelectorAll('table.entity-table tbody tr')].find((r) => r.querySelector('.row-select code')?.textContent === ${JSON.stringify(MD_CLASS)})
  const detail = document.querySelector('.entity-detail')
  return {
    field: document.getElementById('md-bonus')?.value ?? null,
    rowBonus: row?.querySelectorAll('td')[2]?.textContent ?? null,
    lamp: row?.querySelectorAll('td')[4]?.querySelector('.lamp')?.className ?? '',
    alarms: detail ? detail.querySelectorAll('.field-message-alarm').length : null,
  }
})()`)
console.log('3) модуль після правки:', JSON.stringify(mdState))
// Друк — КАНОН РУШІЯ (io/jsonWriter.fmtFloat), а не JS-кратчайший запис: саме він поїде у файл.
if (mdState.field !== '0.3499999940395355') throw new Error('поле бонуса не показує fround-канон: ' + mdState.field)
if (mdState.rowBonus !== '0.3499999940395355') throw new Error('рядок списку не показує канон: ' + mdState.rowBonus)
if (!mdState.lamp.includes('lamp-ok')) throw new Error('лампа модуля мала лишитись ok (0.35 у межах [0..2]): ' + mdState.lamp)
if (mdState.alarms !== 0) throw new Error('alarm-повідомлень на валідному бонусі бути не мало')
await shot('t4-7-v-modules.png')

// ---- (4) «Налаштування»: TreeVisibilityDepth ---------------------------------------------------

await clickTab('Налаштування')
const setBefore = await evalJs(`(() => ({
  depth: document.getElementById('set-treedepth')?.value ?? null,
  adminId: document.getElementById('set-adminid-0')?.value ?? null,
}))()`)
if (setBefore.depth !== '2') throw new Error('стендова глибина дерева не 2: ' + setBefore.depth)
if (setBefore.adminId !== PLACEHOLDER) throw new Error('AdminIds[0] не плейсхолдер: ' + setBefore.adminId)
await setInput('set-treedepth', '3')
await blurField('set-treedepth')
const setState = await evalJs(`(() => {
  const panel = document.getElementById('tabpanel-settings')
  return {
    depth: document.getElementById('set-treedepth')?.value ?? null,
    warns: panel ? panel.querySelectorAll('.field-message-warn').length : null,
    alarms: panel ? panel.querySelectorAll('.field-message-alarm').length : null,
  }
})()`)
console.log('4) налаштування після правки:', JSON.stringify(setState))
if (setState.depth !== '3') throw new Error('глибина після коміту: ' + setState.depth)
if (setState.warns !== 0) throw new Error('3 у межах [0..10] — попереджень бути не мало: ' + setState.warns)
if (setState.alarms !== 0) throw new Error('Settings warn-only, alarm бути не може')
const leakSettings = await evalJs(`document.body.innerHTML.includes('76561198')`)
if (leakSettings) throw new Error('ВИТІК: у DOM знайдено справжній Steam64-префікс стенда!')
await shot('t4-7-g-settings.png')

// ---- (5) «Заготовки»: правка Name наявної заготовки -------------------------------------------

const DI_ID = 'ZP_Data_77'
const DI_NAME = 'Сталкерські дані: памʼять детектора (приймання W4)'

await clickTab('Заготовки')
await setInput('di-filter', '_77')
await clickRow(DI_ID)
const diBefore = await evalJs(`document.getElementById('di-name')?.value ?? null`)
if (diBefore !== "Сталкерські дані: пам'ять детектора") throw new Error('панель відкрилась не на ' + DI_ID + ': ' + diBefore)
await setInput('di-name', DI_NAME)
const diState = await evalJs(`(() => {
  const row = [...document.querySelectorAll('table.entity-table tbody tr')].find((r) => r.querySelector('.row-select code')?.textContent === ${JSON.stringify(DI_ID)})
  const tds = row ? [...row.querySelectorAll('td')] : []
  return { rowName: tds[1]?.textContent ?? null, points: tds[2]?.textContent ?? null, lamp: tds[3]?.querySelector('.lamp')?.className ?? '' }
})()`)
console.log('5) заготовка після правки:', JSON.stringify(diState))
if (diState.rowName !== DI_NAME) throw new Error('правка імені не відбилась у списку живо: ' + diState.rowName)
if (!diState.lamp.includes('lamp-ok')) throw new Error('лампа заготовки мала лишитись ok: ' + diState.lamp)
await shot('t4-7-d-dataitems.png')
await setInput('di-filter', '')

// ---- (6) «Баланс»: кадр реального стану (read-only) --------------------------------------------

await clickTab('Баланс')
await sleep(700)
const bal = await evalJs(`(() => {
  const t = document.getElementById('bal-matrix')
  if (!t) return null
  const rows = [...t.querySelectorAll('tbody tr')].map((tr) => tr.getAttribute('data-item'))
  const cols = [...t.querySelectorAll('thead th')].slice(1).map((th) => th.textContent.trim())
  return { rows, cols, sections: document.querySelectorAll('.balance-workspace section.sheet').length }
})()`)
console.log('6) баланс:', JSON.stringify(bal))
if (!bal) throw new Error('таблиці #bal-matrix немає')
if (bal.rows.length !== 4) throw new Error('чекав 4 рядки заготовок, є ' + bal.rows.length)
// Правка імені типу балів із кроку (1) мусить бути видна і тут — вкладки читають ОДИН project.
if (!bal.cols.some((c) => c.includes('приймання W4'))) throw new Error('колонка типу балів не показує нове імʼя: ' + JSON.stringify(bal.cols))
await shotOf('.balance-workspace section.sheet:nth-of-type(1)', 't4-7-e-balance.png')

// ---- (7) Зберегти -> Завантажити ZIP ------------------------------------------------------------

if ((await saveDisabled()) !== false) throw new Error('гейт заблокував збереження на валідних правках')
await evalJs(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Зберегти зміни')).click()`)
await sleep(900)
const saveStatus = await evalJs(`document.querySelector('.indicator')?.textContent ?? ''`)
console.log('7) статус збереження:', saveStatus)

const filesBefore = new Set(existsSync(DOWNLOAD_DIR) ? readdirSync(DOWNLOAD_DIR) : [])
if ((await exportDisabled()) !== false) throw new Error('експорт ZIP лишився заблокованим після збереження')
await evalJs(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Завантажити ZIP'))
  if (!btn) throw new Error('кнопка «Завантажити ZIP» не знайдена')
  btn.click()
})()`)

let downloadedName
for (let i = 0; i < 50; i++) {
  await sleep(200)
  const names = existsSync(DOWNLOAD_DIR) ? readdirSync(DOWNLOAD_DIR) : []
  const fresh = names.find((n) => !filesBefore.has(n) && n.endsWith('.zip'))
  if (fresh) {
    downloadedName = fresh
    break
  }
}
if (!downloadedName) throw new Error('ZIP не завантажився протягом очікування')
console.log('7) завантажено:', downloadedName)

// ---- (8) Звірка байтів + структурна перевірка змінених -----------------------------------------

const zipBytes = readFileSync(join(DOWNLOAD_DIR, downloadedName))
const unzipped = unzipSync(new Uint8Array(zipBytes))
const zipNames = Object.keys(unzipped).filter((n) => !n.endsWith('/'))
if (zipNames.length !== STAND_FILES.length) throw new Error(`чекав ${STAND_FILES.length} файлів в експорті, є ${zipNames.length}: ${zipNames.join(', ')}`)

const changed = []
for (const rel of STAND_FILES) {
  const out = unzipped[rel]
  if (!out) throw new Error(`${rel} відсутній в експортованому ZIP`)
  const same = Buffer.compare(Buffer.from(out), originalBytes.get(rel)) === 0
  console.log(`  [${same ? 'без змін' : 'ЗМІНЕНО'}] ${rel} (${out.length} байт)`)
  if (!same) changed.push(rel)
}
expectEq('перелік змінених файлів', changed.slice().sort(), EXPECT_CHANGED.slice().sort())

const dec = (rel) => new TextDecoder('utf-8').decode(unzipped[rel])
const ptDoc = JSON.parse(dec('PointTypes.json'))
const ptEntry = ptDoc.PointTypes.find((p) => p.Id === PT_ID)
expectEq('кількість типів балів', ptDoc.PointTypes.length, 24)
expectEq('PointTypes.Name', ptEntry.Name, PT_NAME)
expectEq('PointTypes.Color', ptEntry.Color, PT_COLOR)

const fxDoc = JSON.parse(dec('Factions.json'))
expectEq('кількість фракцій', fxDoc.Factions.length, 8)
const fxNew = fxDoc.Factions[fxDoc.Factions.length - 1]
expectEq('нова фракція Id', fxNew.Id, FX_ID)
expectEq('нова фракція DisplayName', fxNew.DisplayName, FX_NAME)
expectEq('нова фракція Supertype', fxNew.Supertype, FX_SUPER)
expectEq('нова фракція Armbands', fxNew.Armbands, [FX_ARMBAND])
expectEq('нова фракція TerminalClasses', fxNew.TerminalClasses, [])
expectEq('нова фракція DeviceClasses', fxNew.DeviceClasses, [])

const mdText = dec('Modules.json')
const mdDoc = JSON.parse(mdText)
const mdEntry = mdDoc.Modules.find((m) => m.Classname === MD_CLASS)
if (Math.fround(mdEntry.PurityBonus) !== Math.fround(0.35)) throw new Error('бонус після round-trip не дорівнює float32(0.35): ' + mdEntry.PurityBonus)
const mdLiteral = /"PurityBonus":\s*([0-9.eE+-]+)/g
const literals = [...mdText.matchAll(mdLiteral)].map((m) => m[1])
console.log('8) друковані літерали PurityBonus:', JSON.stringify(literals))
if (!literals.includes('0.3499999940395355')) throw new Error('у файлі немає канонічного літерала 0.3499999940395355: ' + JSON.stringify(literals))

const setDoc = JSON.parse(dec('Settings.json'))
expectEq('TreeVisibilityDepth', setDoc.TreeVisibilityDepth, 3)
expectEq('AdminIds (плейсхолдер)', setDoc.AdminIds, [PLACEHOLDER])

const diDoc = JSON.parse(dec('DataItems.json'))
expectEq('кількість заготовок', diDoc.Items.length, 4)
expectEq('DataItems.Name', diDoc.Items.find((i) => i.Id === DI_ID).Name, DI_NAME)

for (const rel of changed) {
  const outPath = join(EXPORT_DIR, ...rel.split('/'))
  mkdirSync(join(outPath, '..'), { recursive: true })
  writeFileSync(outPath, Buffer.from(unzipped[rel]))
}

await finish(`готово. Змінених файлів: ${changed.length} -> ${EXPORT_DIR} (запис на стенд ОКРЕМИМ кроком).`)
