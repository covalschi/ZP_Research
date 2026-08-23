// Скріншот-харнес W2.6 Task 2 (двудольне полотно "предмет -> станок -> предмет") --
// той самий прийом headless Chrome + сирий CDP, що t5-shoot.mjs (W2 Task 5): PNG на
// диску -- доказ, який ревʼювер може відкрити, не лише транскрипт інструмента браузера.
// Запуск: `node tests/tools/t26-2-shoot.mjs` (з webeditor/, vite preview вже має
// працювати на :4173 -- у цій сесії піднятий через mcp Claude Browser preview_start).
import { zipSync } from 'fflate'
import { spawn } from 'child_process'
import { writeFileSync, mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = process.env.T26_2_SHOOT_OUT || 'E:/TMP/claude/E--dayzmod/ef2600b9-21a8-43d6-8043-cf5a4904c3ec/scratchpad/t26-2-shots'
const PORT = 9336
const URL = 'http://localhost:4173/'
const DIST = 'E:/dayzmod/webeditor/dist'
const FIXTURES = 'E:/dayzmod/webeditor/tests/fixtures'

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
const dataItemsJson = JSON.stringify(
  { ConfigVersion: 1, Items: [{ Id: 'ZP_Data_01', Enabled: true, Name: 'Дані польової біології', Description: '', Points: [{ Type: 'bio_lab_t1', Amount: 5 }] }] },
  null,
  4,
)
const sampleTypesJson = JSON.stringify({ ConfigVersion: 1, Items: [{ Id: 'ZP_Sample', Enabled: true, Name: 'Біозразок', Description: '' }] }, null, 4)

// ---- a) НОРМАЛЬНИЙ граф, з ігровими іменами (DataItems/SampleTypes заповнені) ---------------
const zipNormal = zipSync({
  'ProcessingRules/chain.json': new TextEncoder().encode(chainJson),
  'DataItems.json': new TextEncoder().encode(dataItemsJson),
  'SampleTypes.json': new TextEncoder().encode(sampleTypesJson),
})

// ---- b) РОЗРИВ: unfed-input (ghost-предмет на вході станка) --------------------------------
const brokenJson = rulesJson([
  rule('chain_analyze_missing', {
    Device: 'ZP_Microscope',
    TimeSec: 15.0,
    InputItem: { Classname: 'ZP_Sample', Quantity: 1, ConsumeInput: 1, Content: 'chimera_claw_missing' },
    Outputs: [{ Classname: 'ZP_Data_02', Quantity: 1, Chance: 1.0, Content: '' }],
    Notes: 'штучний розрив -- вимагає chimera_claw_missing, якого ніхто не виробляє (unfed-input)',
  }),
])
const zipBroken = zipSync({
  'ProcessingRules/chain.json': new TextEncoder().encode(chainJson),
  'ProcessingRules/broken.json': new TextEncoder().encode(brokenJson),
  'DataItems.json': new TextEncoder().encode(dataItemsJson),
  'SampleTypes.json': new TextEncoder().encode(sampleTypesJson),
})

writeFileSync(join(DIST, 't26-2-normal.zip'), zipNormal)
writeFileSync(join(DIST, 't26-2-broken.zip'), zipBroken)
console.log('фікстури зібрано:', zipNormal.length, zipBroken.length, 'байт')

// ---- headless Chrome + сирий CDP -------------------------------------------------------------

const profile = mkdtempSync(join(tmpdir(), 't262shoot-'))
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
  await sleep(900) // elk-розкладка асинхронна
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

await send('Page.navigate', { url: URL })
await sleep(1200)

// ---- a) НОРМАЛЬНИЙ граф -- ігрові імена станків/предметів ------------------------------------
await injectZip('t26-2-normal.zip')
await clickChainsTab()
await shot('t26-2-a-normal-graph.png')

const namesPresent = await evalJs(`(() => {
  const text = document.querySelector('.chain-canvas-wrap')?.innerText || ''
  return {
    hasFridge: text.includes('Холодильник зразків'),
    hasMicroscope: text.includes('Лабораторний мікроскоп'),
    hasBioSample: text.includes('Біозразок'),
    hasDataName: text.includes('Дані польової біології'),
    hasApple: text.includes('Apple'),
  }
})()`)
console.log('перевірка ігрових імен на полотні:', JSON.stringify(namesPresent))

// ---- b) РОЗРИВ unfed-input -- ghost-предмет + підпис-елемент на полотні ---------------------
await send('Page.navigate', { url: URL })
await sleep(900)
await injectZip('t26-2-broken.zip')
await clickChainsTab()
await shot('t26-2-b1-broken-overview.png')

const breakInfo = await evalJs(`(() => {
  const panel = document.querySelector('.breaks-panel')
  return {
    breaksPanelText: panel ? panel.innerText : null,
    ghostCount: document.querySelectorAll('.ghost-card').length,
    breakLabelCount: [...document.querySelectorAll('.break-edge-label')].length,
  }
})()`)
console.log('перевірка розриву:', JSON.stringify(breakInfo))

// Крупний план розриву -- зумимо на ghost-картку.
await evalJs(`document.querySelector('.breaks-list-item')?.click()`)
await sleep(600)
for (let i = 0; i < 3; i++) {
  await evalJs(`document.querySelector('.react-flow__controls-zoomin')?.click()`)
  await sleep(150)
}
await shot('t26-2-b2-broken-closeup.png')

// ---- c) Клік по станку -- onOpenStation (перевірка через індикаторний рядок App.tsx) --------
await send('Page.navigate', { url: URL })
await sleep(900)
await injectZip('t26-2-normal.zip')
await clickChainsTab()

const clickResult = await evalJs(`(async () => {
  const node = [...document.querySelectorAll('.station-card')].find((n) => n.textContent.includes('Холодильник'))
  if (!node) return { found: false }
  node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  await new Promise((r) => setTimeout(r, 300))
  const indicator = document.querySelector('.indicator')
  return { found: true, indicatorText: indicator ? indicator.textContent : null }
})()`)
console.log('клік по станку (onOpenStation):', JSON.stringify(clickResult))
await shot('t26-2-c-station-click.png')

console.log('консольні помилки за сесію:', consoleErrors.length, consoleErrors)

ws.close()
chrome.kill()
console.log('готово')
