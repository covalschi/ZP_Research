// Скріншот-харнес T5 (фікс-раунд 1, Important 2): headless Chrome + сирий CDP через
// вбудований WebSocket Node 24 (той самий прийом, що вже використовувався в T3 —
// scratchpad/shoot.mjs). Це ТЕПЕР СТАНДАРТНИЙ ПРОЦЕС для смоуку веб-редактора: доказ
// живе PNG-файлом на диску (Page.captureScreenshot пише байти напряму), а не лише в
// транскрипті інструмента браузера, який ревʼювер не може відкрити. T6/T7: копіюйте
// секцію "headless Chrome + сирий CDP" нижче (spawn Chrome --headless=new --remote-
// debugging-port + WebSocket на /json → webSocketDebuggerUrl + Runtime.evaluate для
// кліків/інʼєкції ZIP + Page.captureScreenshot для збереження) і підставте свій
// сценарій замість фікстур/кліків нижче. Запуск: `node tests/tools/t5-shoot.mjs`
// (з webeditor/, vite preview має вже працювати на :4173).
//
// Приклад цієї сесії знімав три стани ChainView: нормальний граф, зламаний Content
// (крупний план підпис-елемента розриву), комбінований дублікат Id + власний розрив у
// КОЖНОГО близнюка (регресія Important 1 цього ж раунду).
import { zipSync } from 'fflate'
import { spawn } from 'child_process'
import { writeFileSync, mkdtempSync, copyFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
// OUT -- налаштовується через env (сесійний scratchpad-шлях змінюється разом з
// conversation id, тому хардкод тут ламав би переносимість для T6/T7 у НОВІЙ сесії):
// `T5_SHOOT_OUT=<шлях> node tests/tools/t5-shoot.mjs`. Дефолт -- шлях цієї сесії, як
// історичний приклад (у ньому й лежать реальні PNG цього фікс-раунду).
const OUT = process.env.T5_SHOOT_OUT || 'E:/TMP/claude/E--dayzmod/ef2600b9-21a8-43d6-8043-cf5a4904c3ec/scratchpad/t5-shots'
const PORT = 9334
const URL = 'http://localhost:4173/'
const DIST = 'E:/dayzmod/webeditor/dist'
const FIXTURES = 'E:/dayzmod/webeditor/tests/fixtures'

// ---- 1. Зібрати три ZIP-фікстури й покласти у dist/ (vite preview роздає його статично) ----

function rule(id, override = {}) {
  return {
    Id: id,
    Enabled: 1,
    Device: 'ZP_SampleFridge',
    Mode: 'background',
    InputItem: { Classname: 'Apple', Quantity: 1, ConsumeInput: 1, Content: '' },
    BasePurityMin: 0.5,
    BasePurityMax: 0.5,
    TimeSec: 10.0,
    Consumables: [],
    Outputs: [],
    RequiredNode: '',
    RequiredFactions: [],
    RequiredWorn: [],
    RequiredTools: [],
    Notes: '',
    ...override,
  }
}
function rulesJson(rules) {
  return JSON.stringify({ ConfigVersion: 1, Rules: rules }, null, 4)
}

const chainJson = readFileSync(join(FIXTURES, 'live', 'chain.json'), 'utf8')
const demoJson = readFileSync(join(FIXTURES, 'gold', 'ProcessingRules', 'demo.json'), 'utf8')

const fillerJson = rulesJson([
  rule('smoke_filler_isolated', { TimeSec: 12.0, Outputs: [{ Classname: 'ZP_Data_05', Quantity: 1, Chance: 1.0, Content: '' }] }),
  rule('smoke_filler_disabled', {
    Enabled: 0,
    TimeSec: 8.0,
    InputItem: { Classname: 'Rag', Quantity: 1, ConsumeInput: 1, Content: '' },
    Outputs: [{ Classname: 'ZP_Data_06', Quantity: 1, Chance: 1.0, Content: '' }],
  }),
])

const brokenExtraJson = rulesJson([
  rule('chain_analyze_chimera_broken', {
    Device: 'ZP_Microscope',
    TimeSec: 15.0,
    InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: 1, Content: 'chimera_claw_missing' },
    Outputs: [{ Classname: 'ZP_Data_02', Quantity: 1, Chance: 1.0, Content: '' }],
    Notes: "штучний розрив -- вимагає chimera_claw_missing, якого ніхто не виробляє (unfed-input)",
  }),
])

// Комбінований сценарій Important 1: два близнюки ОДНАКОВОГО Id 'dup_consumer' у
// РІЗНИХ файлах, КОЖЕН вимагає СВІЙ окремий, нікимне вироблюваний Content -- у
// кожного ВЛАСНИЙ unfed-input, а не один спільний розрив на двох.
const dupAJson = rulesJson([
  rule('dup_consumer', {
    Device: 'ZP_Microscope',
    InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: 1, Content: 'missing_a' },
    Notes: 'близнюк A -- власний unfed-input (missing_a)',
  }),
])
const dupBJson = rulesJson([
  rule('dup_consumer', {
    Device: 'ZP_Microscope',
    InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: 1, Content: 'missing_b' },
    Notes: 'близнюк B -- власний unfed-input (missing_b)',
  }),
])

const zipNormal = zipSync({
  'ProcessingRules/chain.json': new TextEncoder().encode(chainJson),
  'ProcessingRules/smoke_filler.json': new TextEncoder().encode(fillerJson),
})
const zipBroken = zipSync({
  'ProcessingRules/chain.json': new TextEncoder().encode(chainJson),
  'ProcessingRules/demo.json': new TextEncoder().encode(demoJson),
  'ProcessingRules/broken.json': new TextEncoder().encode(brokenExtraJson),
})
const zipDup = zipSync({
  'ProcessingRules/dup_a.json': new TextEncoder().encode(dupAJson),
  'ProcessingRules/dup_b.json': new TextEncoder().encode(dupBJson),
})

writeFileSync(join(DIST, 't5-normal.zip'), zipNormal)
writeFileSync(join(DIST, 't5-broken.zip'), zipBroken)
writeFileSync(join(DIST, 't5-dup.zip'), zipDup)
console.log('фікстури зібрано:', zipNormal.length, zipBroken.length, zipDup.length, 'байт')

// ---- 2. headless Chrome + сирий CDP ---------------------------------------------------------

const profile = mkdtempSync(join(tmpdir(), 't5shoot-'))
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1440,1000',
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

async function shot(name, clip) {
  const params = { format: 'png' }
  if (clip) params.clip = { ...clip, scale: 1 }
  const r = await send('Page.captureScreenshot', params)
  const path = join(OUT, name)
  writeFileSync(path, Buffer.from(r.data, 'base64'))
  console.log('знято', path)
}

async function injectZip(zipName) {
  await evalJs(`(async () => {
    const res = await fetch('/${zipName}')
    const buf = await res.arrayBuffer()
    const dt = new DataTransfer()
    dt.items.add(new File([buf], '${zipName}', { type: 'application/zip' }))
    const input = document.getElementById('import-zip-input')
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(700)
}

async function clickChainsTab() {
  await evalJs(`(() => {
    const btn = [...document.querySelectorAll('.tab-button')].find((b) => b.textContent.includes('Ланцюги'))
    btn.click()
  })()`)
  await sleep(900) // elk-розкладка асинхронна (Task 5 звіт: layoutFlowNodes -- Promise)
}

async function clickZoomIn(times) {
  for (let i = 0; i < times; i++) {
    await evalJs(`document.querySelector('.react-flow__controls-zoomin')?.click()`)
    await sleep(150)
  }
}

async function clickBreaksListItem(index) {
  await evalJs(`document.querySelectorAll('.breaks-list-item')[${index}]?.click()`)
  await sleep(600) // setCenter анімація 400ms + запас
}

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
  }
}

await send('Page.enable')
await send('Runtime.enable')
const consoleErrors = []
ws.addEventListener?.('message', () => {}) // no-op, залишено для симетрії з іншими слухачами
// Console API (Runtime.consoleAPICalled) -- перевірка "0 помилок консолі" для звіту.
const origSend = send
void origSend
await send('Log.enable')

await send('Page.navigate', { url: URL })
await sleep(1200)

// ---- a) НОРМАЛЬНИЙ ГРАФ (0 розривів) ---------------------------------------------------------
await injectZip('t5-normal.zip')
await clickChainsTab()
await shot('t5-a-normal-graph.png')

// ---- b) ЗЛАМАНИЙ Content -- крупний план підпис-елемента розриву ----------------------------
await send('Page.navigate', { url: URL })
await sleep(900)
await injectZip('t5-broken.zip')
await clickChainsTab()
await shot('t5-b1-broken-overview.png') // спершу огляд усього графа з панеллю розривів
await clickZoomIn(3)
await shot('t5-b2-broken-closeup.png') // потім крупний план (лампа/стаби/тики зблизька)

// ---- c) КОМБІНОВАНИЙ: дублікат Id + власний розрив у КОЖНОГО близнюка (Important 1) --------
await send('Page.navigate', { url: URL })
await sleep(900)
await injectZip('t5-dup.zip')
await clickChainsTab()
await shot('t5-c1-duplicate-overview.png') // обидві картки + плашка дублікату + 2 розриви
// Доказ фіксу: клік по РІЗНИХ записах панелі центрує на РІЗНИХ близнюках. centerOnCard
// викликає rf.setCenter(..., { zoom: 1, ... }) -- ЗУМ ПІСЛЯ КЛІКУ СКИДАЄТЬСЯ до 1
// незалежно від того, що було до кліку (сам setCenter це і встановлює), тож зумити
// треба ПІСЛЯ центрування, інакше "+"-клацання до кліку не дають жодної видимої
// різниці на такому маленькому (2-вузловому) графі -- обидві картки й так влазять у
// кадр за zoom=1. Зумимо після, аби в кадрі лишилась ЛИШЕ картка-ціль.
await clickBreaksListItem(0)
await clickZoomIn(5)
await shot('t5-c2-duplicate-center-first.png')
await clickBreaksListItem(1)
await clickZoomIn(5)
await shot('t5-c3-duplicate-center-second.png')

ws.close()
chrome.kill()
console.log('готово, скріншотів:', 6)
