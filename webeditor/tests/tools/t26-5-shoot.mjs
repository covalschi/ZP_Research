// Скріншот-харнес W2.6 Task 5 («Клонування з заміною») -- той самий прийом headless
// Chrome + сирий CDP, що t26-3/t26-4-shoot.mjs. Сценарій брифа: відкрити вікно станка
// ZP_SampleFridge -> «Скопіювати налаштування станка…» -> перший рядок таблиці (клас,
// пред-заповнений «ZP_SampleFridge -> …») довписати ціль ZP_ChemBench, додати рядок-
// фракцію ecolog->clearsky -> прев'ю показує НОВИЙ Id і зачеплені поля -> «Застосувати» ->
// перемкнути вікно на ZP_ChemBench -> клонований рядок там, ВИМКНЕНИЙ -> на полотні
// з'явилась друга інстанція станка -> Зберегти -> Завантажити ZIP -> розпакувати -> сирі
// перевірки байтів (Device/RequiredFactions/Enabled клону, оригінал незачеплений).
// Запуск: `node tests/tools/t26-5-shoot.mjs` (vite preview на :4173 мусить обслуговувати
// СВІЖИЙ dist -- `npm run build` ПЕРЕД запуском).
import { zipSync, unzipSync } from 'fflate'
import { spawn } from 'child_process'
import { writeFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = process.env.T26_5_SHOOT_OUT || 'E:/TMP/claude/E--dayzmod/ef2600b9-21a8-43d6-8043-cf5a4904c3ec/scratchpad/t26-5-shots'
const DOWNLOAD_DIR = join(OUT, 'downloads')
const EXPORT_DIR = join(OUT, 'exported')
const PORT = 9340
const URL = 'http://localhost:4173/'
const DIST = 'E:/dayzmod/webeditor/dist'

mkdirSync(OUT, { recursive: true })
rmSync(DOWNLOAD_DIR, { recursive: true, force: true })
mkdirSync(DOWNLOAD_DIR, { recursive: true })
rmSync(EXPORT_DIR, { recursive: true, force: true })
mkdirSync(EXPORT_DIR, { recursive: true })

// ---- Фікстура: РІВНО ОДНЕ правило-пакувальник на ZP_SampleFridge, дві фракції -----------------
const seedPack = {
  Id: 'fridge_apple', Enabled: true, Device: 'ZP_SampleFridge', Mode: 'background',
  InputItem: { Classname: 'Apple', Quantity: 1, ConsumeInput: true, Content: '' },
  BasePurityMin: 0.5, BasePurityMax: 0.5, TimeSec: 10,
  Consumables: [],
  Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'Apple' }],
  RequiredNode: '', RequiredFactions: ['ecolog'], RequiredWorn: [], RequiredTools: [], Notes: '',
}
const rulesJson = JSON.stringify({ ConfigVersion: 1, Rules: [seedPack] }, null, 4)
const sampleTypesJson = JSON.stringify({ ConfigVersion: 1, Items: [{ Id: 'ZP_Sample', Enabled: 1, Name: 'Біозразок', Description: '' }] }, null, 4)
const factionsJson = JSON.stringify(
  {
    ConfigVersion: 1,
    Factions: [
      { Id: 'ecolog', DisplayName: 'Ecologists', Supertype: '', Armbands: [], TerminalClasses: [], DeviceClasses: [] },
      { Id: 'clearsky', DisplayName: 'Clear Sky', Supertype: '', Armbands: [], TerminalClasses: [], DeviceClasses: [] },
    ],
  },
  null,
  4,
)

const zip = zipSync({
  'ProcessingRules/chain.json': new TextEncoder().encode(rulesJson),
  'SampleTypes.json': new TextEncoder().encode(sampleTypesJson),
  'Factions.json': new TextEncoder().encode(factionsJson),
})
writeFileSync(join(DIST, 't26-5.zip'), zip)
console.log('фікстуру зібрано:', zip.length, 'байт')

// ---- headless Chrome + сирий CDP (прийом t26-3/t26-4-shoot.mjs) -----------------------------
const profile = mkdtempSync(join(tmpdir(), 't265shoot-'))
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

// Хелпери сторінки -- pickOption/clickButton/freeType той самий прийом, що t26-4-shoot.mjs.
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
  const res = await fetch('/t26-5.zip')
  const buf = await res.arrayBuffer()
  const dt = new DataTransfer()
  dt.items.add(new File([buf], 't26-5.zip', { type: 'application/zip' }))
  const input = document.getElementById('import-zip-input')
  input.files = dt.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
})()`)
await sleep(800)
await evalJs(`[...document.querySelectorAll('.tab-button')].find((b) => b.textContent.includes('Ланцюги')).click()`)
await sleep(900)
const c0 = await evalJs(`window.__t.counts()`)
console.log('старт полотна (1 сіяне правило):', JSON.stringify(c0))
if (c0.stationCards !== 1) throw new Error('очікував 1 картку станка на старті, є ' + c0.stationCards)
await shot('t26-5-a-canvas-seed.png')

// ==== Відкрити вікно ZP_SampleFridge -> «Скопіювати налаштування станка…» =====================
await evalJs(`(() => {
  const node = [...document.querySelectorAll('.station-card')].find((n) => n.querySelector('.station-card-class')?.textContent.includes('ZP_SampleFridge'))
  if (!node) throw new Error('картка ZP_SampleFridge не знайдена')
  node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
})()`)
await sleep(500)
await evalJs(`window.__t.clickButton('.station-window', 'Скопіювати налаштування станка')`)
await sleep(400)
const dialogOpen = await evalJs(`(() => {
  const rows = document.querySelectorAll('.clone-sub-row')
  const firstFromInput = rows[0]?.querySelectorAll('.zp-select-input')[0]
  return { rowCount: rows.length, firstFromValue: firstFromInput?.value, hasDialog: !!document.querySelector('.clone-dialog') }
})()`)
console.log('діалог відкрито, перший рядок пред-заповнений:', JSON.stringify(dialogOpen))
if (!dialogOpen.hasDialog) throw new Error('панель клонування не відкрилась')
if (dialogOpen.rowCount !== 1) throw new Error('очікував рівно 1 пред-заповнений рядок, є ' + dialogOpen.rowCount)
if (dialogOpen.firstFromValue !== 'ZP_SampleFridge') throw new Error('перший рядок мав бути пред-заповнений "ZP_SampleFridge", є ' + dialogOpen.firstFromValue)
await shot('t26-5-b-dialog-prefilled.png')

// ==== Рядок 0 (клас): "на що" -> ZP_ChemBench (allowFree -- цього класу немає в індексі) =======
// Рядок 1 (індексація aria-label, рев'ю фікс-раунду 1 MINOR 2).
await evalJs(`window.__t.freeType('input[aria-label="На який класнейм замінити (рядок 1)"]', 'ZP_ChemBench')`)
await sleep(300)

// ==== Додати рядок, перемкнути на "фракція", ecolog -> clearsky ===============================
await evalJs(`window.__t.clickButton('.clone-dialog', '+ Додати рядок')`)
await sleep(300)
await evalJs(`(() => {
  const row = document.querySelectorAll('.clone-sub-row')[1]
  if (!row) throw new Error('другий рядок не з\\'явився')
  const btn = [...row.querySelectorAll('button')].find((b) => b.textContent.includes('фракція'))
  if (!btn) throw new Error('перемикач "фракція" не знайдено')
  btn.click()
})()`)
await sleep(300)
// Рядок 2 (щойно доданий, другий у списку) -- та сама індексація.
await evalJs(`window.__t.pickOption('input[aria-label="Замінити фракцію (рядок 2)"]', 'Ecologists', 'Ecologists')`)
await sleep(300)
await evalJs(`window.__t.pickOption('input[aria-label="На яку фракцію замінити (рядок 2)"]', 'Clear Sky', 'Clear Sky')`)
await sleep(400)
await shot('t26-5-c-dialog-filled.png')

// ==== Прев'ю: новий Id + зачеплені поля ========================================================
const preview = await evalJs(`(() => {
  const rows = [...document.querySelectorAll('.clone-preview-row')]
  return rows.map((r) => ({
    old: r.querySelector('.clone-preview-old')?.textContent,
    newIdPlaceholder: r.querySelector('.clone-preview-id')?.getAttribute('placeholder'),
    touched: r.querySelector('.clone-preview-touched')?.textContent,
  }))
})()`)
console.log('прев\'ю клонування:', JSON.stringify(preview))
if (preview.length !== 1) throw new Error('очікував 1 рядок прев\'ю, є ' + preview.length)
if (preview[0].old !== 'fridge_apple') throw new Error('очікував джерело fridge_apple, є ' + preview[0].old)
if (preview[0].newIdPlaceholder !== 'fridge_apple_копія') throw new Error('очікував дефолтний Id fridge_apple_копія, є ' + preview[0].newIdPlaceholder)
if (!preview[0].touched.includes('Device')) throw new Error('очікував "Device" серед зачеплених полів: ' + preview[0].touched)
if (!preview[0].touched.includes('RequiredFactions[0]')) throw new Error('очікував "RequiredFactions[0]" серед зачеплених полів: ' + preview[0].touched)

// ==== Застосувати ==============================================================================
await evalJs(`window.__t.clickButton('.clone-preview', 'Застосувати')`)
await sleep(600)
const applied = await evalJs(`(() => {
  const ind = document.querySelector('.clone-dialog .indicator:not(.alarm)')
  return { text: ind?.textContent, stationCards: document.querySelectorAll('.station-card').length }
})()`)
console.log('після застосування:', JSON.stringify(applied))
if (!applied.text || !applied.text.includes('1')) throw new Error('очікував повідомлення про створення 1 правила: ' + applied.text)
await shot('t26-5-d-applied.png')

// ==== Закрити діалог, перемкнути вікно на ZP_ChemBench -> клонований рядок ВИМКНЕНИЙ ===========
await evalJs(`window.__t.clickButton('.clone-dialog', '×')`)
await sleep(300)
await evalJs(`window.__t.pickOption('#sw-station-picker', 'ZP_ChemBench', 'ZP_ChemBench')`)
await sleep(500)
const chembenchRows = await evalJs(`(() => {
  const rows = [...document.querySelectorAll('.station-row')]
  return rows.map((r) => ({
    cls: r.querySelector('.station-row-class')?.textContent,
    flags: [...r.querySelectorAll('.station-row-flag')].map((f) => f.textContent),
    unconfigured: r.classList.contains('station-row-unconfigured'),
  }))
})()`)
console.log('рядки вікна ZP_ChemBench:', JSON.stringify(chembenchRows))
if (chembenchRows.length !== 1) throw new Error('очікував рівно 1 рядок на ZP_ChemBench (клон), є ' + chembenchRows.length)
if (chembenchRows[0].cls !== 'Apple') throw new Error('клон мав зберегти InputItem.Classname=Apple (не в таблиці замін), є ' + chembenchRows[0].cls)
if (!chembenchRows[0].flags.some((f) => f.includes('вимкнено'))) throw new Error('клон мав бути позначений "вимкнено" (Enabled=false, Step 1-семантика)')
await shot('t26-5-e-chembench-window.png')

// ==== Полотно: друга інстанція станка з'явилась ================================================
await evalJs(`window.__t.clickButton('.station-window', '×')`)
await sleep(500)
await evalJs(`document.querySelector('.react-flow__controls-fitview')?.click()`)
await sleep(800)
const finalCanvas = await evalJs(`window.__t.counts()`)
console.log('фінальне полотно:', JSON.stringify(finalCanvas))
if (finalCanvas.stationCards !== 2) throw new Error('очікував 2 картки станка (fridge + chembench-клон), є ' + finalCanvas.stationCards)
await shot('t26-5-f-canvas-two-stations.png')

// ---- Зберегти -> Завантажити ZIP -> розпакувати -> сирі перевірки вмісту -------------------
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
  ruleCount: (chainOut.match(/"Id":/g) || []).length,
  hasOriginalEnabled1: chainOut.includes('"Id": "fridge_apple",') && /"Id": "fridge_apple",[\s\S]{0,40}"Enabled": 1/.test(chainOut),
  hasCloneEnabled0: /"Id": "fridge_apple_копія",[\s\S]{0,40}"Enabled": 0/.test(chainOut),
  hasChemBenchDevice: /"Id": "fridge_apple_копія",[\s\S]{0,80}"Device": "ZP_ChemBench"/.test(chainOut),
  hasClearsky: /"Id": "fridge_apple_копія",[\s\S]*?"RequiredFactions": \[\s*"clearsky"/.test(chainOut),
  originalDeviceUntouched: /"Id": "fridge_apple",[\s\S]{0,40}"Device": "ZP_SampleFridge"/.test(chainOut),
}
console.log('перевірки експорту:', JSON.stringify(checks))
if (checks.ruleCount !== 2) throw new Error('очікував 2 правила в експорті, є ' + checks.ruleCount)
for (const [k, v] of Object.entries(checks)) {
  if (k === 'ruleCount') continue
  if (!v) throw new Error('перевірка провалилась: ' + k)
}

console.log('консольні помилки за сесію:', consoleErrors.length, consoleErrors)
if (consoleErrors.length > 0) throw new Error('консоль не чиста: ' + consoleErrors.join(' | '))
ws.close()
chrome.kill()
console.log('готово — клонування з заміною живцем перевірено (станок, фракція, прев\'ю, Enabled=0, полотно, експорт)')
