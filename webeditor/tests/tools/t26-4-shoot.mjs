// Скріншот-харнес W2.6 Task 4 (наскрізний ланцюг 3+ ланки) -- той самий прийом headless
// Chrome + сирий CDP, що t26-3-shoot.mjs, продовжений ще на ОДИН стик. Сценарій брифа:
// живцем через вікна станків побудувати пакувальник (сировина->зразок) -> аналізатор
// (зразок->ПРОМІЖНИЙ предмет) -> третій станок (проміжний предмет->заготовка ZP_Data_01),
// перевірити: "Вхід із потоку" (Task 4, п.2) вмикається АВТОМАТИЧНО на аналізаторному рядку
// (структурно, InputItem.Classname уже родини ZP_Sample_Base) і лишається вимкненим на
// звичайному рядку третього станка, override-чекбокс і там, і там можна перемкнути в БУДЬ-
// ЯКИЙ бік без глухого кута; повна доріжка видно на полотні зліва направо, linkOutputToStation
// будує ланку #2->#3 живцем (не лише в юніт-тесті stationEdit.test.ts).
// Запуск: `node tests/tools/t26-4-shoot.mjs` (vite preview на :4173 мусить обслуговувати
// СВІЖИЙ dist -- `npm run build` ПЕРЕД запуском, інакше сервер віддасть старий білд).
import { zipSync, unzipSync } from 'fflate'
import { spawn } from 'child_process'
import { writeFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = process.env.T26_4_SHOOT_OUT || 'E:/TMP/claude/E--dayzmod/ef2600b9-21a8-43d6-8043-cf5a4904c3ec/scratchpad/t26-4-shots'
const DOWNLOAD_DIR = join(OUT, 'downloads')
const EXPORT_DIR = join(OUT, 'exported')
const PORT = 9338
const URL = 'http://localhost:4173/'
const DIST = 'E:/dayzmod/webeditor/dist'

mkdirSync(OUT, { recursive: true })
rmSync(DOWNLOAD_DIR, { recursive: true, force: true })
mkdirSync(DOWNLOAD_DIR, { recursive: true })
rmSync(EXPORT_DIR, { recursive: true, force: true })
mkdirSync(EXPORT_DIR, { recursive: true })

// ---- Фікстура: РІВНО ОДНЕ готове правило-пакувальник (щоб на полотні була картка, по якій
// відкрити перше вікно станка -- масове додавання вже вичерпно перевірено в T3, тут не
// повторюється) + ZP_Microscope/ZP_ChemBench через DeviceClasses (обидва мусять бути
// ОБИРАНИМИ в пікері "Куди піде результат" ДО того, як у них з'явиться перше правило --
// та сама механіка станка-без-правил, що в T3).
const seedPack = {
  Id: 'seed_pack', Enabled: true, Device: 'ZP_SampleFridge', Mode: 'background',
  InputItem: { Classname: 'Apple', Quantity: 1, ConsumeInput: true, Content: '' },
  BasePurityMin: 0.5, BasePurityMax: 0.5, TimeSec: 10,
  Consumables: [],
  Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1, Content: 'ore' }],
  RequiredNode: '', RequiredFactions: [], RequiredWorn: [], RequiredTools: [], Notes: '',
}
const rulesJson = JSON.stringify({ ConfigVersion: 1, Rules: [seedPack] }, null, 4)
const sampleTypesJson = JSON.stringify({ ConfigVersion: 1, Items: [{ Id: 'ZP_Sample', Enabled: 1, Name: 'Біозразок', Description: '' }] }, null, 4)
const factionsJson = JSON.stringify(
  {
    ConfigVersion: 1,
    Factions: [{ Id: 'eco', DisplayName: 'Ecologists', Supertype: '', Armbands: [], TerminalClasses: [], DeviceClasses: ['ZP_Microscope', 'ZP_ChemBench'] }],
  },
  null,
  4,
)

const zip = zipSync({
  'ProcessingRules/chain3.json': new TextEncoder().encode(rulesJson),
  'SampleTypes.json': new TextEncoder().encode(sampleTypesJson),
  'Factions.json': new TextEncoder().encode(factionsJson),
})
writeFileSync(join(DIST, 't26-4.zip'), zip)
console.log('фікстуру зібрано:', zip.length, 'байт')

// ---- headless Chrome + сирий CDP (той самий прийом t26-3-shoot.mjs) -------------------------
const profile = mkdtempSync(join(tmpdir(), 't264shoot-'))
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

// Хелпери сторінки -- pickOption/clickButton/setValue той самий прийом, що t26-3-shoot.mjs;
// freeType -- НОВИЙ (для allowFree-полів, де опції в реальному ClassIndex немає, напр.
// вигаданий проміжний класнейм ZP_Interm_Ore -- той самий, що в юніт-тестах цього таска).
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
  rowByClass(cls) {
    return [...document.querySelectorAll('.station-row')].find((r) => r.querySelector('.station-row-class')?.textContent === cls)
  },
}; true`)

// ---- Імпорт фікстури + вкладка «Ланцюги» -----------------------------------------------------
await evalJs(`(async () => {
  const res = await fetch('/t26-4.zip')
  const buf = await res.arrayBuffer()
  const dt = new DataTransfer()
  dt.items.add(new File([buf], 't26-4.zip', { type: 'application/zip' }))
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
await shot('t26-4-a-canvas-seed.png')

// ==== ЛАНКА #1->#2: клік по картці -> вікно станка1 -> «Куди піде результат» -> Мікроскоп ====
await evalJs(`(() => {
  const node = [...document.querySelectorAll('.station-card')].find((n) => n.querySelector('.station-card-class')?.textContent.includes('ZP_SampleFridge'))
  if (!node) throw new Error('картка ZP_SampleFridge не знайдена')
  node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
})()`)
await sleep(500)
await evalJs(`(() => {
  const row = window.__t.rowByClass('Apple')
  if (!row) throw new Error('рядок Apple не знайдено у вікні станка1')
  row.querySelector('.station-row-head').click()
})()`)
await sleep(400)
await shot('t26-4-b-window-station1.png')

await evalJs(`(async () => {
  const linkInput = document.querySelector('.station-link-row .zp-select-input')
  if (!linkInput) throw new Error('немає пікера «Куди піде результат» на рядку станка1')
  linkInput.focus()
  window.__t.setValue(linkInput, 'ZP_Microscope')
  await new Promise((r) => setTimeout(r, 250))
  const opt = [...document.querySelectorAll('.zp-select-option')].find((o) => o.textContent.includes('ZP_Microscope'))
  if (!opt) throw new Error('опція ZP_Microscope не знайдена')
  opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
})()`)
await sleep(1000)
const link1 = await evalJs(`(() => {
  const ind = document.querySelector('.station-window .indicator')
  return { message: ind?.textContent, counts: window.__t.counts() }
})()`)
console.log('після ланки #1->#2:', JSON.stringify(link1))
if (link1.counts.stationCards < 2) throw new Error('нова інстанція станка (Мікроскоп) не з’явилась на полотні')
await shot('t26-4-c-linked-analyzer.png')

// ==== аналізаторний рядок Мікроскопа: перевірка "Вхід із потоку" (W2.6 Task 4, п.2) =========
await evalJs(`window.__t.pickOption('#sw-station-picker', 'ZP_Microscope', 'ZP_Microscope')`)
await sleep(500)
await evalJs(`(() => {
  const row = window.__t.rowByClass('ZP_Sample')
  if (!row) throw new Error('аналізаторний рядок (InputItem=ZP_Sample) не знайдено на Мікроскопі')
  row.querySelector('.station-row-head').click()
})()`)
await sleep(400)
const analyzerModeState = await evalJs(`(() => {
  const cb = document.querySelector('#rp-input-stream-mode')
  const streamField = document.querySelector('#rp-input-stream')
  const freeField = document.querySelector('#rp-input-classname')
  return { checked: cb?.checked, streamFieldVisible: !!streamField, streamValue: streamField?.value, freeFieldVisible: !!freeField }
})()`)
console.log('аналізаторний рядок -- стан "Вхід із потоку":', JSON.stringify(analyzerModeState))
if (!analyzerModeState.checked) throw new Error('«Вхід із потоку» мав бути УВІМКНЕНИЙ автоматично (InputItem.Classname=ZP_Sample -- родина ZP_Sample_Base)')
if (!analyzerModeState.streamFieldVisible || analyzerModeState.freeFieldVisible) throw new Error('очікував обмежений пікер потоку замість вільного поля класу')
await shot('t26-4-d-analyzer-stream-mode.png')

// Добудова аналізатора: вихід = проміжний предмет (НЕ зразок) -> ввімкнути.
await evalJs(`window.__t.clickButton('.station-row-body', '+ Додати вихід')`)
await sleep(300)
await evalJs(`window.__t.freeType('#rp-out-cls-0', 'ZP_Interm_Ore')`)
await sleep(500)
await evalJs(`document.querySelector('#rp-enabled').click()`)
await sleep(1000)
const afterAnalyzer = await evalJs(`window.__t.counts()`)
console.log('після налаштування+ввімкнення аналізатора:', JSON.stringify(afterAnalyzer))
await shot('t26-4-e-analyzer-configured.png')

// ==== ЛАНКА #2->#3: «Куди піде результат» з аналізаторного рядка -> ZP_ChemBench ============
await evalJs(`(async () => {
  const linkInput = document.querySelector('.station-link-row .zp-select-input')
  if (!linkInput) throw new Error('немає пікера «Куди піде результат» на аналізаторному рядку')
  linkInput.focus()
  window.__t.setValue(linkInput, 'ZP_ChemBench')
  await new Promise((r) => setTimeout(r, 250))
  const opt = [...document.querySelectorAll('.zp-select-option')].find((o) => o.textContent.includes('ZP_ChemBench'))
  if (!opt) throw new Error('опція ZP_ChemBench не знайдена')
  opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
})()`)
await sleep(1000)
const link2 = await evalJs(`(() => {
  const ind = document.querySelector('.station-window .indicator')
  return { message: ind?.textContent, counts: window.__t.counts() }
})()`)
console.log('після ланки #2->#3 (linkOutputToStation живцем будує ДРУГИЙ стик):', JSON.stringify(link2))
if (link2.counts.stationCards < 3) throw new Error('нова інстанція станка (ZP_ChemBench) не з’явилась на полотні')
await shot('t26-4-f-linked-third-station.png')

// ==== рядок ZP_ChemBench: контраст -- "Вхід із потоку" НЕ увімкнений структурно (не-зразок) ==
await evalJs(`window.__t.pickOption('#sw-station-picker', 'ZP_ChemBench', 'ZP_ChemBench')`)
await sleep(500)
await evalJs(`(() => {
  const row = window.__t.rowByClass('ZP_Interm_Ore')
  if (!row) throw new Error('рядок ZP_Interm_Ore не знайдено на ZP_ChemBench')
  row.querySelector('.station-row-head').click()
})()`)
await sleep(400)
const plainModeState = await evalJs(`(() => {
  const cb = document.querySelector('#rp-input-stream-mode')
  const streamField = document.querySelector('#rp-input-stream')
  const freeField = document.querySelector('#rp-input-classname')
  return { checked: cb?.checked, streamFieldVisible: !!streamField, freeFieldVisible: !!freeField }
})()`)
console.log('звичайний рядок (не-зразок) -- стан "Вхід із потоку":', JSON.stringify(plainModeState))
if (plainModeState.checked) throw new Error('«Вхід із потоку» НЕ мав бути увімкнений автоматично для не-зразкового входу')
if (plainModeState.streamFieldVisible || !plainModeState.freeFieldVisible) throw new Error('очікував ЗВИЧАЙНИЙ пікер класу, не обмежений потік')
await shot('t26-4-g-thirdstation-normal-picker.png')

// ---- Override-демо: адмін явно вмикає "Вхід із потоку" на НЕ-зразковому рядку -> обмежений
// пікер з'являється (override=true перемагає структуру); вимикає назад -> вільний пікер
// повертається (доводить: жодного глухого кута, round-trip в ОБИДВА боки).
await evalJs(`document.querySelector('#rp-input-stream-mode').click()`)
await sleep(300)
const overrideOn = await evalJs(`({ checked: document.querySelector('#rp-input-stream-mode')?.checked, streamFieldVisible: !!document.querySelector('#rp-input-stream') })`)
console.log('override увімкнено вручну:', JSON.stringify(overrideOn))
if (!overrideOn.checked || !overrideOn.streamFieldVisible) throw new Error('override=true мав показати обмежений пікер')
await shot('t26-4-h-thirdstation-override-demo.png')

await evalJs(`document.querySelector('#rp-input-stream-mode').click()`)
await sleep(300)
const overrideOff = await evalJs(`({ checked: document.querySelector('#rp-input-stream-mode')?.checked, freeFieldVisible: !!document.querySelector('#rp-input-classname') })`)
console.log('override вимкнено назад:', JSON.stringify(overrideOff))
if (overrideOff.checked || !overrideOff.freeFieldVisible) throw new Error('override=false мав повернути вільний пікер (жодного глухого кута)')

// Добудова третьої станції: вихід = заготовка ZP_Data_01 (реальний клас індексу) -> ввімкнути.
await evalJs(`window.__t.clickButton('.station-row-body', '+ Додати вихід')`)
await sleep(300)
await evalJs(`window.__t.pickOption('#rp-out-cls-0', 'ZP_Data_01', 'ZP_Data_01')`)
await sleep(500)
await evalJs(`document.querySelector('#rp-enabled').click()`)
await sleep(1000)
const afterThird = await evalJs(`window.__t.counts()`)
console.log('після налаштування+ввімкнення третьої станції:', JSON.stringify(afterThird))
if (afterThird.redRows !== 0) throw new Error('очікував 0 нескомплектованих рядків у ВІДКРИТОМУ вікні, є ' + afterThird.redRows)
await shot('t26-4-i-thirdstation-configured.png')

// ==== Повна доріжка на полотні: закрити вікно -> fitView -> скріншот усього ланцюга зліва направо ======
await evalJs(`window.__t.clickButton('.station-window', '×')`)
await sleep(600)
// Вікно займало праву колонку -- полотно вже мало fitView з МЕНШОЮ шириною; після закриття
// вікна колонка звільняється, але React Flow сам не перецентровує в'юпорт -- клікаємо
// штатну кнопку "fit view" контролів (react-flow__controls-fitview), інакше третя станція
// й заготовка лишаються за межею кадру скріншота.
await evalJs(`document.querySelector('.react-flow__controls-fitview')?.click()`)
await sleep(900)
const finalCanvas = await evalJs(`window.__t.counts()`)
console.log('фінальне полотно (уся доріжка):', JSON.stringify(finalCanvas))
if (finalCanvas.stationCards !== 3) throw new Error('очікував 3 картки станка на фінальному полотні, є ' + finalCanvas.stationCards)
if (finalCanvas.edges !== 6) throw new Error('очікував 6 ребер (сировина->1->зразок->2->проміжний->3->заготовка), є ' + finalCanvas.edges)
await shot('t26-4-j-full-lane.png')

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

const chainOut = new TextDecoder().decode(files['ProcessingRules/chain3.json'])
const checks = {
  ruleCount: (chainOut.match(/"Id":/g) || []).length,
  allEnabled: (chainOut.match(/"Enabled": 1/g) || []).length,
  hasInterm: chainOut.includes('ZP_Interm_Ore'),
  hasData01: chainOut.includes('ZP_Data_01'),
}
console.log('перевірки експорту:', JSON.stringify(checks))
if (checks.ruleCount !== 3) throw new Error('очікував 3 правила в експорті, є ' + checks.ruleCount)
if (checks.allEnabled !== 3) throw new Error('очікував усі 3 правила увімкненими, увімкнено ' + checks.allEnabled)

console.log('консольні помилки за сесію:', consoleErrors.length, consoleErrors)
if (consoleErrors.length > 0) throw new Error('консоль не чиста: ' + consoleErrors.join(' | '))
ws.close()
chrome.kill()
console.log('готово — наскрізний ланцюг 3 ланки живцем побудовано і перевірено')
