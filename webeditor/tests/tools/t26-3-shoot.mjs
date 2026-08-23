// Скріншот-харнес W2.6 Task 3 (вікно станка) -- той самий прийом headless Chrome + сирий
// CDP, що t26-2-shoot.mjs / t8-shoot.mjs. Сценарій брифа: відкрити вікно кліком по станку
// на полотні; масово додати 3 сировини -> 3 ЧЕРВОНІ рядки-заготовки; розгорнути один ->
// налаштувати вихід -> рядок зеленіє; увімкнути -> ДОРІЖКА на полотні з'являється живцем;
// «Куди піде результат» -> створено заготовку-аналізатор -> нова інстанція станка на
// полотні; Зберегти -> Завантажити ZIP -> розпакувати (байт-канонічність звіряє окремий
// tests/tools/t26-3-verify-canonical.ts). Запуск: `node tests/tools/t26-3-shoot.mjs`
// (vite preview на :4173 має працювати).
import { zipSync, unzipSync } from 'fflate'
import { spawn } from 'child_process'
import { writeFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = process.env.T26_3_SHOOT_OUT || 'E:/TMP/claude/E--dayzmod/ef2600b9-21a8-43d6-8043-cf5a4904c3ec/scratchpad/t26-3-shots'
const DOWNLOAD_DIR = join(OUT, 'downloads')
const EXPORT_DIR = join(OUT, 'exported')
const PORT = 9337
const URL = 'http://localhost:4173/'
const DIST = 'E:/dayzmod/webeditor/dist'
const FIXTURES = 'E:/dayzmod/webeditor/tests/fixtures'

mkdirSync(OUT, { recursive: true })
// Чиста тека завантажень: headless Chrome ПЕРЕЗАПИСУЄ файл з тим самим імʼям, і
// «новий файл» другого прогону ставав невидимим для перевірки beforeFiles.
rmSync(DOWNLOAD_DIR, { recursive: true, force: true })
mkdirSync(DOWNLOAD_DIR, { recursive: true })
rmSync(EXPORT_DIR, { recursive: true, force: true })
mkdirSync(EXPORT_DIR, { recursive: true })

// ---- Фікстура: живий ланцюг + імена + фракція з DeviceClasses-станком БЕЗ правил ------------
const chainJson = readFileSync(join(FIXTURES, 'live', 'chain.json'), 'utf8')
// Enabled: 1 (не true) -- рушій пише bool як 1/0; недирти файли експортуються байт-в-байт
// як увійшли, тож фікстури мусять бути канонічні самі, інакше verify-скрипт лаявся б на
// файли, яких редактор і не торкався.
const dataItemsJson = JSON.stringify(
  { ConfigVersion: 1, Items: [{ Id: 'ZP_Data_01', Enabled: 1, Name: 'Дані польової біології', Description: '', Points: [{ Type: 'bio_lab_t1', Amount: 5 }] }] },
  null,
  4,
)
const sampleTypesJson = JSON.stringify({ ConfigVersion: 1, Items: [{ Id: 'ZP_Sample', Enabled: 1, Name: 'Біозразок', Description: '' }] }, null, 4)
// ZP_ChemBench оголошений ЛИШЕ через DeviceClasses -- на полотні його немає (T2), але
// перемикач вікна станка ЗОБОВ'ЯЗАНИЙ його листити (диспатч T3).
const factionsJson = JSON.stringify(
  { ConfigVersion: 1, Factions: [{ Id: 'eco', DisplayName: 'Ecologists', Supertype: '', Armbands: [], TerminalClasses: [], DeviceClasses: ['ZP_ChemBench'] }] },
  null,
  4,
)

const zip = zipSync({
  'ProcessingRules/chain.json': new TextEncoder().encode(chainJson),
  'DataItems.json': new TextEncoder().encode(dataItemsJson),
  'SampleTypes.json': new TextEncoder().encode(sampleTypesJson),
  'Factions.json': new TextEncoder().encode(factionsJson),
})
writeFileSync(join(DIST, 't26-3.zip'), zip)
console.log('фікстуру зібрано:', zip.length, 'байт')

// ---- headless Chrome + сирий CDP -------------------------------------------------------------
const profile = mkdtempSync(join(tmpdir(), 't263shoot-'))
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

// Хелпери сторінки: нативний setter (React 19 читає input-подію), вибір опції ZpSelect.
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
    // Точний збіг label -- першим пріоритетом (includes ловив би ZP_Sample_Base на запит ZP_Sample).
    const opt =
      opts.find((o) => o.querySelector('.zp-select-option-label')?.textContent === optionMatch) ??
      opts.find((o) => o.textContent.includes(optionMatch))
    if (!opt) throw new Error('опція не знайдена: ' + optionMatch + ' серед ' + opts.length)
    opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
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
      rows: document.querySelectorAll('.station-row').length,
      redRows: document.querySelectorAll('.station-row-unconfigured').length,
    }
  },
}; true`)

// ---- Імпорт фікстури + вкладка «Ланцюги» -----------------------------------------------------
await evalJs(`(async () => {
  const res = await fetch('/t26-3.zip')
  const buf = await res.arrayBuffer()
  const dt = new DataTransfer()
  dt.items.add(new File([buf], 't26-3.zip', { type: 'application/zip' }))
  const input = document.getElementById('import-zip-input')
  input.files = dt.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
})()`)
await sleep(800)
await evalJs(`[...document.querySelectorAll('.tab-button')].find((b) => b.textContent.includes('Ланцюги')).click()`)
await sleep(1100)

const c0 = await evalJs(`window.__t.counts()`)
console.log('старт полотна:', JSON.stringify(c0))
await shot('t26-3-a-canvas.png')

// ---- b) Клік по станку -> вікно станка -------------------------------------------------------
await evalJs(`(() => {
  const node = [...document.querySelectorAll('.station-card')].find((n) => n.textContent.includes('Холодильник'))
  node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
})()`)
await sleep(500)
const windowInfo = await evalJs(`(() => {
  const w = document.querySelector('.station-window')
  return { open: !!w, name: w?.querySelector('.station-window-name')?.textContent, cls: w?.querySelector('.station-window-class')?.textContent, rows: window.__t.counts().rows }
})()`)
console.log('вікно станка:', JSON.stringify(windowInfo))
if (!windowInfo.open) throw new Error('вікно станка не відкрилось')

// Перемикач станків мусить листити і станок БЕЗ правил (ZP_ChemBench з DeviceClasses).
const pickerHasChemBench = await evalJs(`(async () => {
  const input = document.querySelector('#sw-station-picker')
  input.focus()
  // headless: сам focus() не завжди відкриває панель -- input-подія відкриває напевно
  // (onChange робить setOpen(true)); порожній запит = перші 50 опцій без фільтра.
  window.__t.setValue(input, '')
  await new Promise((r) => setTimeout(r, 250))
  const txt = [...document.querySelectorAll('.zp-select-option')].map((o) => o.textContent).join(' | ')
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  return { hasChemBench: txt.includes('ZP_ChemBench'), options: txt }
})()`)
console.log('станок без правил у перемикачі:', pickerHasChemBench)
await shot('t26-3-b-window-open.png')

// ---- c) Масове додавання 3 сировин -> 3 червоні рядки ---------------------------------------
for (const raw of ['Paper', 'Guts', 'Stone']) {
  await evalJs(`window.__t.pickOption('#sw-raw-picker', '${raw}', '${raw}')`)
}
const chipCount = await evalJs(`document.querySelectorAll('.station-chip').length`)
console.log('чіпів накопичено:', chipCount)
await evalJs(`window.__t.clickButton('.station-bulk', 'створити 3 рядки')`)
await sleep(1100)
const c1 = await evalJs(`window.__t.counts()`)
console.log('після масового додавання:', JSON.stringify(c1))
if (c1.redRows !== 3) throw new Error('очікував 3 червоні рядки, є ' + c1.redRows)
await shot('t26-3-c-three-red-stubs.png')

// ---- d) Розгорнути рядок Paper -> додати вихід ZP_Sample -> рядок зеленіє -------------------
await evalJs(`(() => {
  const row = [...document.querySelectorAll('.station-row')].find((r) => r.querySelector('.station-row-class')?.textContent === 'Paper')
  row.querySelector('.station-row-head').click()
})()`)
await sleep(400)
await evalJs(`window.__t.clickButton('.station-row-body', '+ Додати вихід')`)
await sleep(300)
await evalJs(`window.__t.pickOption('#rp-out-cls-0', 'ZP_Sample', 'ZP_Sample')`)
await sleep(700)
const rowState = await evalJs(`(() => {
  const row = [...document.querySelectorAll('.station-row')].find((r) => r.querySelector('.station-row-class')?.textContent === 'Paper')
  return {
    green: !!row.querySelector('.station-row-head .lamp-ok'),
    red: row.classList.contains('station-row-unconfigured'),
    autoContent: row.querySelector('#rp-out-content-0')?.value,
    summary: row.querySelector('.station-row-summary')?.textContent,
  }
})()`)
console.log('рядок після налаштування виходу:', JSON.stringify(rowState))
if (!rowState.green) throw new Error('рядок не позеленів після налаштування виходу')
await shot('t26-3-d-row-configured-green.png')

// ---- e) Увімкнути -> доріжка на полотні з'являється живцем ----------------------------------
const edgesBefore = (await evalJs(`window.__t.counts()`)).edges
await evalJs(`document.querySelector('#rp-enabled').click()`)
await sleep(1200)
const c2 = await evalJs(`window.__t.counts()`)
console.log('після ввімкнення: ребер було', edgesBefore, 'стало', c2.edges)
if (c2.edges <= edgesBefore) throw new Error('доріжка на полотні не з’явилась після ввімкнення')
await shot('t26-3-e-lane-appears.png')

// ---- f) «Куди піде результат» -> заготовка-аналізатор на Мікроскопі -------------------------
const stationsBefore = c2.stationCards
await evalJs(`(async () => {
  const linkInput = document.querySelector('.station-link-row .zp-select-input')
  if (!linkInput) throw new Error('немає пікера «Куди піде результат»')
  linkInput.focus()
  window.__t.setValue(linkInput, 'мікроскоп')
  await new Promise((r) => setTimeout(r, 250))
  const opt = [...document.querySelectorAll('.zp-select-option')].find((o) => o.textContent.includes('мікроскоп'))
  if (!opt) throw new Error('опція мікроскопа не знайдена')
  opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
})()`)
await sleep(1200)
const linkInfo = await evalJs(`(() => {
  const w = document.querySelector('.station-window')
  const ind = w.querySelector('.indicator')
  return { message: ind?.textContent, counts: window.__t.counts(), planned: [...w.querySelectorAll('.station-link-block .hint')].map((h) => h.textContent).join(' ') }
})()`)
console.log('після пов’язування:', JSON.stringify(linkInfo))
if (linkInfo.counts.stationCards <= stationsBefore) throw new Error('нова інстанція станка-призначення не з’явилась на полотні')
await shot('t26-3-f-linked-analyzer.png')

// ---- g) Зберегти -> Завантажити ZIP -> розпакувати ------------------------------------------
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

const chainOut = new TextDecoder().decode(files['ProcessingRules/chain.json'])
const checks = {
  stubEnabled0: (chainOut.match(/"Enabled": 0/g) || []).length,
  paperStub: chainOut.includes('zp_samplefridge_paper'),
  analyzer: chainOut.includes('zp_microscope_paper'),
  paperEnabled: /"Id": "zp_samplefridge_paper"[\s\S]{0,40}"Enabled": 1/.test(chainOut),
}
console.log('перевірки експорту:', JSON.stringify(checks))

console.log('консольні помилки за сесію:', consoleErrors.length, consoleErrors)
ws.close()
chrome.kill()
console.log('готово')
