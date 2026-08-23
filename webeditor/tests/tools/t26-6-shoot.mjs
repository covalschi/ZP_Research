// Скріншот-харнес W2.6 Task 6 («Приймання + докс — міні-репетиція капстоуна») -- той самий
// прийом headless Chrome + сирий CDP, що t26-3/4/5-shoot.mjs, АЛЕ на відміну від них ЦЕЙ
// скрипт зіпує НЕ синтетичну фікстуру, а РЕАЛЬНІ 12 файлів конфігів стенду
// (testserver\profiles\ZP_Research) -- FactionData/PlayerData/ConfigBackup/StaticDevices*
// НІКОЛИ не потрапляють у ZIP (ані на читання, ані на запис). Сценарій:
//   1) відкрити вікно станка ZP_SampleFridge (клік по картці на полотні);
//   2) створити НОВИЙ файл правил acceptance_w26.json, масово додати сировину "Pear";
//   3) розгорнути рядок, додати вихід ZP_Sample_05 (авто-Content), TimeSec, увімкнути;
//   4) «Куди піде результат» -> ZP_Microscope (створює вимкнену заготовку-аналізатор) --
//      ЗНІМОК "запланованого" розриву ДО налаштування аналізатора (рядок 5e брифа);
//   5) налаштувати аналізатор (вихід ZP_Data_07, порожній невживаний), увімкнути;
//   6) клонувати З ЗАМІНОЮ станок ZP_SampleFridge -> ZP_ChemBench (клони лишаються
//      вимкненими -- природний стан);
//   7) Зберегти -> Завантажити ZIP -> розпакувати -> сирі перевірки байтів.
// Запуск: `node tests/tools/t26-6-shoot.mjs` (vite preview на :4173 мусить обслуговувати
// СВІЖИЙ dist -- `npm run build` ПЕРЕД запуском).
import { zipSync, unzipSync } from 'fflate'
import { spawn } from 'child_process'
import { writeFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = process.env.T26_6_SHOOT_OUT || 'E:/TMP/claude/E--dayzmod/ef2600b9-21a8-43d6-8043-cf5a4904c3ec/scratchpad/t26-6-shots'
const DOWNLOAD_DIR = join(OUT, 'downloads')
const EXPORT_DIR = join(OUT, 'exported')
const PORT = 9341
const URL = 'http://localhost:4173/'
const DIST = 'E:/dayzmod/webeditor/dist'
const STAND = 'E:/dayzmod/testserver/profiles/ZP_Research'

mkdirSync(OUT, { recursive: true })
rmSync(DOWNLOAD_DIR, { recursive: true, force: true })
mkdirSync(DOWNLOAD_DIR, { recursive: true })
rmSync(EXPORT_DIR, { recursive: true, force: true })
mkdirSync(EXPORT_DIR, { recursive: true })

// ---- Зіп РЕАЛЬНИХ 12 файлів стенду (байт-в-байт, без FactionData/PlayerData/ConfigBackup/
// StaticDevices*) -- той самий перелік, що T8 (W2) і T5 (W2.5) уже перевіряли живцем. -------
const REAL_FILES = [
  'DataItems.json',
  'Factions.json',
  'Modules.json',
  'PointTypes.json',
  'SampleTypes.json',
  'Settings.json',
  'ProcessingRules/demo.json',
  'ProcessingRules/test_micro.json',
  'ProcessingRules/chain.json',
  'TechTree/clearsky.json',
  'TechTree/combat.json',
  'TechTree/zone.json',
]
const zipEntries = {}
for (const rel of REAL_FILES) {
  zipEntries[rel] = new Uint8Array(readFileSync(join(STAND, rel)))
}
const zip = zipSync(zipEntries)
writeFileSync(join(DIST, 't26-6.zip'), zip)
console.log('фікстуру (РЕАЛЬНІ файли стенду) зібрано:', zip.length, 'байт,', REAL_FILES.length, 'файлів')

// ---- headless Chrome + сирий CDP (той самий прийом t26-3/4/5-shoot.mjs) ---------------------
const profile = mkdtempSync(join(tmpdir(), 't266shoot-'))
const chrome = spawn(
  CHROME,
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1680,1050', '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank'],
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
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, name), Buffer.from(r.data, 'base64'))
  console.log('знято', join(OUT, name))
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
await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOAD_DIR.replaceAll('/', '\\') })

await send('Page.navigate', { url: URL })
await sleep(1200)

// Хелпери сторінки -- pickOption/freeType/clickButton той самий прийом, що t26-3/4/5;
// setAndBlur -- НОВИЙ, T9-урок (CLAUDE.md): headless Chrome не породжує 'focusout' на
// el.blur(), а FloatField/IntField комітять саме на React onBlur (він слухає нативний
// 'focusout', бо 'blur' не спливає) -- явний dispatch FocusEvent('focusout') обов'язковий.
await evalJs(`window.__t = {
  setValue(el, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  },
  async pickOption(inputSel, query, optionMatch) {
    const input = document.querySelector(inputSel)
    if (!input) throw new Error('немає інпута ' + inputSel)
    input.focus()
    this.setValue(input, query)
    await new Promise((r) => setTimeout(r, 250))
    const opts = [...document.querySelectorAll('.zp-select-option')]
    const opt =
      opts.find((o) => o.querySelector('.zp-select-option-label')?.textContent === optionMatch) ??
      opts.find((o) => o.textContent.includes(optionMatch))
    if (!opt) throw new Error('опція не знайдена: ' + optionMatch + ' серед ' + opts.length + ' (' + opts.map((o) => o.textContent).join(' | ') + ')')
    opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    await new Promise((r) => setTimeout(r, 200))
  },
  async freeType(inputSel, text) {
    const input = document.querySelector(inputSel)
    if (!input) throw new Error('немає інпута ' + inputSel)
    input.focus()
    this.setValue(input, text)
    await new Promise((r) => setTimeout(r, 250))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await new Promise((r) => setTimeout(r, 200))
  },
  async setAndBlur(inputSel, text) {
    const input = document.querySelector(inputSel)
    if (!input) throw new Error('немає інпута ' + inputSel)
    input.focus()
    this.setValue(input, text)
    await new Promise((r) => setTimeout(r, 150))
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 200))
  },
  clickButton(scopeSel, text) {
    const scope = scopeSel ? document.querySelector(scopeSel) : document
    const btn = [...scope.querySelectorAll('button')].find((b) => b.textContent.includes(text))
    if (!btn) throw new Error('кнопка не знайдена: ' + text)
    btn.click()
  },
  counts() {
    return {
      stationCards: document.querySelectorAll('.station-card').length,
      edges: document.querySelectorAll('.react-flow__edge').length,
      breakEdges: document.querySelectorAll('.break-edge').length,
      rows: document.querySelectorAll('.station-row').length,
      redRows: document.querySelectorAll('.station-row-unconfigured').length,
    }
  },
  rowByClass(cls) {
    return [...document.querySelectorAll('.station-row')].find((r) => r.querySelector('.station-row-class')?.textContent === cls)
  },
  breaksPanelText() {
    const p = document.querySelector('.breaks-panel')
    return p ? p.textContent : null
  },
}; true`)

// ---- Імпорт РЕАЛЬНОЇ фікстури стенду + вкладка «Ланцюги» ------------------------------------
await evalJs(`(async () => {
  const res = await fetch('/t26-6.zip')
  const buf = await res.arrayBuffer()
  const dt = new DataTransfer()
  dt.items.add(new File([buf], 't26-6.zip', { type: 'application/zip' }))
  const input = document.getElementById('import-zip-input')
  input.files = dt.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
})()`)
await sleep(900)
await evalJs(`[...document.querySelectorAll('.tab-button')].find((b) => b.textContent.includes('Ланцюги')).click()`)
await sleep(1000)
const c0 = await evalJs(`window.__t.counts()`)
const breaks0 = await evalJs(`window.__t.breaksPanelText()`)
console.log('старт полотна (реальний стенд, 8 правил у 3 файлах):', JSON.stringify(c0), '| розриви на старті:', breaks0)
await shot('t26-6-00-canvas-baseline.png')

// ==== Крок 1: відкрити вікно ZP_SampleFridge (клік по картці) ================================
await evalJs(`(() => {
  const node = [...document.querySelectorAll('.station-card')].find((n) => n.querySelector('.station-card-class')?.textContent.includes('ZP_SampleFridge'))
  if (!node) throw new Error('картка ZP_SampleFridge не знайдена')
  node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
})()`)
await sleep(500)

// ==== Крок 2: НОВИЙ файл правил acceptance_w26.json ===========================================
await evalJs(`window.__t.clickButton('.station-bulk', 'створити новий файл правил')`)
await sleep(300)
await evalJs(`window.__t.setValue(document.querySelector('input[aria-label="Імʼя нового файлу правил"]'), 'acceptance_w26')`)
await sleep(200)
await evalJs(`window.__t.clickButton('.station-bulk', 'Створити файл')`)
await sleep(400)
const fileCreated = await evalJs(`document.querySelector('#sw-target-file')?.value`)
console.log('цільовий файл після створення:', fileCreated)
if (fileCreated !== 'ProcessingRules/acceptance_w26.json') throw new Error('очікував ProcessingRules/acceptance_w26.json обраним, є ' + fileCreated)

// ==== Масове додавання сировини "Pear" (відсутня у чинних конфігах) ==========================
await evalJs(`window.__t.freeType('#sw-raw-picker', 'Pear')`)
await sleep(300)
// НЕ clickButton('.station-bulk', 'створити') -- колізія: "створити новий файл правил"
// (перемикач вище) ТЕЖ починається з "створити" lowercase і стоїть РАНІШЕ в DOM, .find()
// узяв би саме його. Пряме звернення до button.primary (унікальний клас) уникає колізії.
await evalJs(`(() => {
  const btn = document.querySelector('.station-bulk button.primary')
  if (!btn) throw new Error('кнопка "створити N рядків" не знайдена')
  if (btn.disabled) throw new Error('кнопка "створити N рядків" дизейблена -- чіп сировини не додався')
  btn.click()
})()`)
await sleep(500)
await shot('t26-6-01-stub-created.png')

// ==== Крок 3: розгорнути рядок Pear, налаштувати пакувальник ==================================
await evalJs(`(() => {
  const row = window.__t.rowByClass('Pear')
  if (!row) throw new Error('рядок Pear не знайдено')
  row.querySelector('.station-row-head').click()
})()`)
await sleep(400)
await evalJs(`window.__t.clickButton('.station-row-body', '+ Додати вихід')`)
await sleep(300)
await evalJs(`window.__t.freeType('#rp-out-cls-0', 'ZP_Sample_05')`)
await sleep(500)
const autoContent = await evalJs(`({ content: document.querySelector('#rp-out-content-0')?.value, badge: !!document.querySelector('.content-auto-badge') })`)
console.log('авто-Content виходу після ZP_Sample_05:', JSON.stringify(autoContent))
if (autoContent.content !== 'Pear') throw new Error('очікував авто-Content="Pear", є ' + autoContent.content)
if (!autoContent.badge) throw new Error('очікував бейдж "авто" на виході')

await evalJs(`window.__t.setAndBlur('#rp-time', '14')`)
await sleep(300)
const timeVal = await evalJs(`document.querySelector('#rp-time')?.value`)
console.log('TimeSec після setAndBlur:', timeVal)

await evalJs(`document.querySelector('#rp-enabled').click()`)
await sleep(700)
const packerRowState = await evalJs(`(() => {
  const row = window.__t.rowByClass('Pear')
  return { unconfigured: row.classList.contains('station-row-unconfigured'), flags: [...row.querySelectorAll('.station-row-flag')].map((f) => f.textContent) }
})()`)
console.log('стан рядка Pear після налаштування+ввімкнення:', JSON.stringify(packerRowState))
if (packerRowState.unconfigured) throw new Error('рядок Pear мав стати "налаштований" (зелений), лишився червоним')
if (packerRowState.flags.some((f) => f.includes('вимкнено'))) throw new Error('рядок Pear мав бути УВІМКНЕНИЙ')
await shot('t26-6-b-packer-configured-enabled.png') // (b) вікно станка з налаштованими зеленими рядками

// ==== Крок 4: «Куди піде результат» -> ZP_Microscope (заготовка-аналізатор, вимкнена) =========
await evalJs(`(async () => {
  const linkInput = document.querySelector('.station-link-row .zp-select-input')
  if (!linkInput) throw new Error('немає пікера «Куди піде результат» на рядку Pear')
  linkInput.focus()
  window.__t.setValue(linkInput, 'ZP_Microscope')
  await new Promise((r) => setTimeout(r, 250))
  const opt = [...document.querySelectorAll('.zp-select-option')].find((o) => o.textContent.includes('ZP_Microscope'))
  if (!opt) throw new Error('опція ZP_Microscope не знайдена')
  opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
})()`)
await sleep(800)
const linkMsg = await evalJs(`document.querySelector('.station-window .indicator')?.textContent`)
console.log('після «Куди піде результат»:', linkMsg)
if (!linkMsg || !linkMsg.includes('аналізатор')) throw new Error('очікував повідомлення про створення заготовки-аналізатора: ' + linkMsg)

// ---- ЗНІМОК (e), частина 1: рядок станка з підказкою "Заплановано" (аналізатор ще
// вимкнений/не налаштований -- dead-output розрив і досі структурно існує). -------------------
const plannedHint = await evalJs(`(() => {
  const row = window.__t.rowByClass('Pear')
  const hint = [...row.querySelectorAll('.hint')].map((h) => h.textContent)
  return hint
})()`)
console.log('підказка «заплановано» на рядку Pear:', JSON.stringify(plannedHint))
if (!plannedHint.some((h) => h.includes('Заплановано'))) throw new Error('очікував підказку "Заплановано" на рядку Pear (аналізатор ще вимкнений)')
await shot('t26-6-e1-planned-hint-in-window.png')

// ---- ЗНІМОК (e), частина 2: повне полотно з ghost-карткою "РОЗРИВ" -- закриваємо вікно -------
await evalJs(`window.__t.clickButton('.station-window', '×')`)
await sleep(500)
await evalJs(`document.querySelector('.react-flow__controls-fitview')?.click()`)
await sleep(900)
const breakState = await evalJs(`({ counts: window.__t.counts(), breaksPanel: window.__t.breaksPanelText() })`)
console.log('стан "запланованого" розриву на полотні (аналізатор вимкнений, але вже прив\'язаний):', JSON.stringify(breakState))
if (breakState.counts.breakEdges < 1) throw new Error('очікував хоча б 1 break-edge (dead-output ZP_Sample_05/Pear) — розрив мав ЛИШИТИСЬ, бо аналізатор ще вимкнений')
await shot('t26-6-e2-canvas-planned-break.png') // (e) МАТЕРІАЛ ДЛЯ ВЕРДИКТУ ВЛАСНИКА

// ==== Крок 5: налаштувати аналізатор на ZP_Microscope (вихід ZP_Data_07, порожній) ============
// Вікно Pear/SampleFridge вже ЗАКРИТЕ (крок e2 закрив його заради чистого знімку полотна) --
// `#sw-station-picker` існує лише ВСЕРЕДИНІ вже відкритого вікна станка, тож відкриваємо
// вікно ZP_Microscope тим самим кліком по картці, що й крок 1 (ФІКС: попередня версія
// намагалась перемкнути пікер у вікні, якого вже не було в DOM -- "немає інпута").
await evalJs(`(() => {
  const node = [...document.querySelectorAll('.station-card')].find((n) => n.querySelector('.station-card-class')?.textContent.includes('ZP_Microscope'))
  if (!node) throw new Error('картка ZP_Microscope не знайдена')
  node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
})()`)
await sleep(600)
await evalJs(`(() => {
  const row = window.__t.rowByClass('ZP_Sample_05')
  if (!row) throw new Error('аналізаторний рядок (InputItem=ZP_Sample_05) не знайдено на Мікроскопі')
  row.querySelector('.station-row-head').click()
})()`)
await sleep(400)
const analyzerModeState = await evalJs(`({ checked: document.querySelector('#rp-input-stream-mode')?.checked })`)
console.log('аналізаторний рядок -- "Вхід із потоку" (мало бути авто-увімкнено):', JSON.stringify(analyzerModeState))
if (!analyzerModeState.checked) throw new Error('«Вхід із потоку» мав бути УВІМКНЕНИЙ автоматично (ZP_Sample_05 -- родина ZP_Sample_Base)')

await evalJs(`window.__t.clickButton('.station-row-body', '+ Додати вихід')`)
await sleep(300)
await evalJs(`window.__t.freeType('#rp-out-cls-0', 'ZP_Data_07')`)
await sleep(500)
await evalJs(`document.querySelector('#rp-enabled').click()`)
await sleep(700)
const analyzerRowState = await evalJs(`(() => {
  const row = window.__t.rowByClass('ZP_Sample_05')
  return { unconfigured: row.classList.contains('station-row-unconfigured'), flags: [...row.querySelectorAll('.station-row-flag')].map((f) => f.textContent) }
})()`)
console.log('стан аналізаторного рядка після налаштування+ввімкнення:', JSON.stringify(analyzerRowState))
if (analyzerRowState.unconfigured) throw new Error('аналізаторний рядок мав стати "налаштований", лишився червоним')
if (analyzerRowState.flags.some((f) => f.includes('вимкнено'))) throw new Error('аналізаторний рядок мав бути УВІМКНЕНИЙ')

// ---- Перевірка: розрив мав ЗНИКНУТИ (аналізатор тепер увімкнений і споживає потік) -----------
await evalJs(`window.__t.clickButton('.station-window', '×')`)
await sleep(500)
await evalJs(`document.querySelector('.react-flow__controls-fitview')?.click()`)
await sleep(900)
const breakGone = await evalJs(`window.__t.counts()`)
console.log('стан розриву після налаштування аналізатора (мав зникнути для ЦЬОГО потоку):', JSON.stringify(breakGone))

// ==== Крок 6: клонування з заміною -- ZP_SampleFridge -> ZP_ChemBench, клони вимкнені =========
await evalJs(`(() => {
  const node = [...document.querySelectorAll('.station-card')].find((n) => n.querySelector('.station-card-class')?.textContent.includes('ZP_SampleFridge'))
  if (!node) throw new Error('картка ZP_SampleFridge не знайдена (для клонування)')
  node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
})()`)
await sleep(500)
await evalJs(`window.__t.clickButton('.station-window', 'Скопіювати налаштування станка')`)
await sleep(400)
const cloneOpen = await evalJs(`(() => {
  const rows = document.querySelectorAll('.clone-sub-row')
  const firstFromInput = rows[0]?.querySelectorAll('.zp-select-input')[0]
  const targetFile = document.querySelector('#cs-target-file')?.value
  return { rowCount: rows.length, firstFromValue: firstFromInput?.value, targetFile }
})()`)
console.log('діалог клонування відкрито:', JSON.stringify(cloneOpen))
if (cloneOpen.firstFromValue !== 'ZP_SampleFridge') throw new Error('перший рядок мав бути "ZP_SampleFridge", є ' + cloneOpen.firstFromValue)

await evalJs(`window.__t.freeType('input[aria-label="На який класнейм замінити (рядок 1)"]', 'ZP_ChemBench')`)
await sleep(400)
const clonePreview = await evalJs(`(() => {
  const rows = [...document.querySelectorAll('.clone-preview-row')]
  return rows.map((r) => r.querySelector('.clone-preview-old')?.textContent)
})()`)
console.log('прев\'ю клонування -- джерела:', JSON.stringify(clonePreview))
await shot('t26-6-c-clone-dialog-preview.png') // (c) прев'ю клонування

await evalJs(`window.__t.clickButton('.clone-preview', 'Застосувати')`)
await sleep(700)
const cloneApplied = await evalJs(`document.querySelector('.clone-dialog .indicator')?.textContent`)
console.log('після застосування клонування:', cloneApplied)
if (!cloneApplied || !cloneApplied.includes(String(clonePreview.length))) throw new Error('очікував повідомлення про створення ' + clonePreview.length + ' правил: ' + cloneApplied)

await evalJs(`window.__t.clickButton('.clone-dialog', '×')`)
await sleep(300)
await evalJs(`window.__t.pickOption('#sw-station-picker', 'ZP_ChemBench', 'ZP_ChemBench')`)
await sleep(600)
const chembenchRows = await evalJs(`(() => {
  const rows = [...document.querySelectorAll('.station-row')]
  return rows.map((r) => ({
    cls: r.querySelector('.station-row-class')?.textContent,
    flags: [...r.querySelectorAll('.station-row-flag')].map((f) => f.textContent),
  }))
})()`)
console.log('рядки вікна ZP_ChemBench (клони):', JSON.stringify(chembenchRows))
if (chembenchRows.length !== clonePreview.length) throw new Error('очікував ' + clonePreview.length + ' клонованих рядків на ZP_ChemBench, є ' + chembenchRows.length)
if (!chembenchRows.every((r) => r.flags.some((f) => f.includes('вимкнено')))) throw new Error('усі клони мали бути "вимкнено"')
await shot('t26-6-d-chembench-cloned-disabled.png') // (d) вікно ChemBench з клонованими вимкненими рядками

// ==== Фінал: повне полотно (усі ланки) =========================================================
await evalJs(`window.__t.clickButton('.station-window', '×')`)
await sleep(500)
await evalJs(`document.querySelector('.react-flow__controls-fitview')?.click()`)
await sleep(1000)
const finalCanvas = await evalJs(`({ counts: window.__t.counts(), breaksPanel: window.__t.breaksPanelText() })`)
console.log('фінальне полотно:', JSON.stringify(finalCanvas))
await shot('t26-6-a-final-canvas-full-chain.png') // (a) повний новий ланцюг лініями на полотні

// ---- Зберегти -> Завантажити ZIP -> розпакувати -> сирі перевірки вмісту ---------------------
await evalJs(`window.__t.clickButton(null, 'Зберегти зміни')`)
await sleep(900)
const beforeFiles = new Set(readdirSync(DOWNLOAD_DIR))
await evalJs(`window.__t.clickButton(null, 'Завантажити ZIP')`)
let zipName
for (let i = 0; i < 40; i++) {
  await sleep(250)
  const fresh = readdirSync(DOWNLOAD_DIR).find((f) => !beforeFiles.has(f) && f.endsWith('.zip'))
  if (fresh) {
    zipName = fresh
    break
  }
}
if (!zipName) throw new Error('ZIP не завантажився')
console.log('завантажено:', zipName)
const zipBytes = readFileSync(join(DOWNLOAD_DIR, zipName))
const files = unzipSync(new Uint8Array(zipBytes))
for (const [name, bytes] of Object.entries(files)) {
  const full = join(EXPORT_DIR, name)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, bytes)
}
console.log('розпаковано файлів:', Object.keys(files).length, '->', EXPORT_DIR)

// Байтова діагностика: які з 12 вхідних файлів реально змінились (сирий порівняльний прохід,
// той самий метод, що T5/T8) + перелік НОВИХ файлів понад вхідні 12.
const changed = []
const unchanged = []
for (const rel of REAL_FILES) {
  const before = readFileSync(join(STAND, rel))
  const after = files[rel]
  if (!after) {
    changed.push(rel + ' (ВІДСУТНІЙ у експорті!)')
    continue
  }
  const same = before.length === after.length && Buffer.compare(before, Buffer.from(after)) === 0
  ;(same ? unchanged : changed).push(rel)
}
const extraFiles = Object.keys(files).filter((f) => !REAL_FILES.includes(f))
console.log('ЗМІНЕНІ файли:', JSON.stringify(changed))
console.log('НЕЗМІНЕНІ файли:', JSON.stringify(unchanged))
console.log('НОВІ файли понад вхідні 12:', JSON.stringify(extraFiles))

const chainOut = new TextDecoder().decode(files['ProcessingRules/chain.json'])
const chainChecks = {
  ruleCount: (chainOut.match(/"Id":/g) || []).length,
  hasNewAnalyzer: chainOut.includes('ZP_Sample_05') && chainOut.includes('ZP_Data_07'),
}
console.log('перевірки chain.json:', JSON.stringify(chainChecks))
if (chainChecks.ruleCount !== 5) throw new Error('очікував 5 правил у chain.json (4 базові + 1 новий аналізатор), є ' + chainChecks.ruleCount)
if (!chainChecks.hasNewAnalyzer) throw new Error('новий аналізатор ZP_Sample_05->ZP_Data_07 не знайдено в chain.json')

const newFileRel = extraFiles.find((f) => f.includes('acceptance_w26'))
if (!newFileRel) throw new Error('новий файл acceptance_w26.json не знайдено в експорті')
const newFileOut = new TextDecoder().decode(files[newFileRel])
const newFileChecks = {
  ruleCount: (newFileOut.match(/"Id":/g) || []).length,
  hasPearEnabled: /"InputItem": \{\s*"Classname": "Pear"[\s\S]{0,200}"Enabled": 1/.test(newFileOut) || (newFileOut.includes('"Classname": "Pear"') && newFileOut.includes('"Enabled": 1')),
  chembenchClones: (newFileOut.match(/"Device": "ZP_ChemBench"/g) || []).length,
  allClonesDisabled: !/"Device": "ZP_ChemBench"[\s\S]{0,400}?"Enabled": 1/.test(newFileOut),
}
console.log('перевірки', newFileRel, ':', JSON.stringify(newFileChecks))

console.log('консольні помилки за сесію:', consoleErrors.length, consoleErrors)
if (consoleErrors.length > 0) throw new Error('консоль не чиста: ' + consoleErrors.join(' | '))
ws.close()
chrome.kill()
console.log('готово — ланцюг з нуля через вікна станків побудовано і перевірено на РЕАЛЬНИХ файлах стенду')
