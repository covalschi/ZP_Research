// Підсумкові кадри стенду (задача «тестовий стенд», T4): полотно ланцюгів із новими
// станціями, вкладка «Заготовки» (три групи по 30) і «Баланс».
//
// Той самий сирий-CDP харнес, що t3-stand-balance-shot.mjs: headless Chrome, ZIP-фікстура
// з РЕАЛЬНИХ конфігів профілю, диск профілю НЕ чіпається, Steam64 адміна підмінено
// плейсхолдером.
//
// Запуск:
//   npm run build && npx vite preview --port 4173 &
//   node tests/tools/t4-stand-final-shot.mjs <тека-профілю>

import { zipSync } from 'fflate'
import { spawn } from 'child_process'
import { writeFileSync, readFileSync, mkdirSync, mkdtempSync, existsSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = process.env.T4_SHOOT_OUT || 'E:/TMP/claude/E--dayzmod/ef2600b9-21a8-43d6-8043-cf5a4904c3ec/scratchpad'
const PORT = 9364
const URL = 'http://localhost:4173/'
const DIST = 'E:/dayzmod/webeditor/dist'
const PLACEHOLDER = '76561190000000000'
const J = JSON.stringify

const DIR = process.argv[2]
if (!DIR) throw new Error('вкажіть теку профілю ZP_Research')
mkdirSync(OUT, { recursive: true })

const SINGLE = ['Factions.json', 'PointTypes.json', 'DataItems.json', 'SampleTypes.json', 'Modules.json']
const MULTI = ['ProcessingRules', 'TechTree']

function buildZip(dir, name) {
  const files = {}
  const settingsPath = join(dir, 'Settings.json')
  if (existsSync(settingsPath)) {
    const doc = JSON.parse(readFileSync(settingsPath, 'utf8'))
    doc.AdminIds = [PLACEHOLDER]
    files['Settings.json'] = new TextEncoder().encode(JSON.stringify(doc, null, 4))
  }
  for (const f of SINGLE) {
    const p = join(dir, f)
    if (existsSync(p)) files[f] = new Uint8Array(readFileSync(p))
  }
  for (const sub of MULTI) {
    const subdir = join(dir, sub)
    if (!existsSync(subdir)) continue
    for (const child of readdirSync(subdir).filter((n) => n.toLowerCase().endsWith('.json'))) {
      files[`${sub}/${child}`] = new Uint8Array(readFileSync(join(subdir, child)))
    }
  }
  writeFileSync(join(DIST, name), zipSync(files))
  return Object.keys(files).length
}

console.log(`ZIP стенду: ${buildZip(DIR, 't4-stand.zip')} файлів`)

const profile = mkdtempSync(join(tmpdir(), 't4shoot-'))
spawn(
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
async function shot(name, beyond = false) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: beyond })
  writeFileSync(join(OUT, name), Buffer.from(r.data, 'base64'))
  console.log('знято', join(OUT, name))
}

const consoleErrors = []
ws = new WebSocket(await getWsUrl())
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
for (let i = 0; i < 60; i++) {
  if (await evalJs(`!!document.getElementById('import-zip-input')`)) break
  await sleep(400)
  if (i === 59) throw new Error('сторінка не завантажилась')
}
await evalJs(`(async () => {
  const res = await fetch(${J(URL)} + 't4-stand.zip')
  const buf = await res.arrayBuffer()
  const dt = new DataTransfer()
  dt.items.add(new File([buf], 't4-stand.zip', { type: 'application/zip' }))
  const input = document.getElementById('import-zip-input')
  input.files = dt.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
})()`)
await sleep(2000)

async function switchTab(label) {
  await evalJs(`[...document.querySelectorAll('.tab-button')].find((b) => b.textContent.trim() === ${J(label)}).click()`)
  await sleep(1200)
}

// --- 1. Ланцюги -------------------------------------------------------------
await switchTab('Ланцюги')
await sleep(1500)
const stations = await evalJs(`(() => {
  const p = document.getElementById('tabpanel-chains')
  if (!p) return null
  const txt = p.textContent || ''
  const names = ['ZP_Eco_Pack_Bio','ZP_Eco_Proc_Bio','ZP_Eco_Pack_Anom','ZP_Eco_Proc_Anom',
    'ZP_Eco_Pack_Electro','ZP_Eco_Proc_Electro','ZP_Sky_Pack_Bio','ZP_Sky_Proc_Bio',
    'ZP_Sky_Pack_Anom','ZP_Sky_Proc_Anom','ZP_Sky_Pack_Electro','ZP_Sky_Proc_Electro']
  return { found: names.filter((n) => txt.includes(n)), missing: names.filter((n) => !txt.includes(n)) }
})()`)
console.log('станції на полотні:', J(stations))
if (stations.missing.length) throw new Error('на полотні бракує станцій: ' + stations.missing.join(', '))
await shot('t-stand-final-chains.png')

// --- 2. Заготовки -----------------------------------------------------------
await switchTab('Заготовки')
const groups = await evalJs(`(() => {
  const p = document.getElementById('tabpanel-dataitems')
  const txt = p ? p.textContent || '' : ''
  return {
    bio: (txt.match(/Біодані/g) || []).length,
    anom: (txt.match(/Аномальні дані/g) || []).length,
    tech: (txt.match(/Технічні дані/g) || []).length,
  }
})()`)
console.log('групи заготовок у переліку:', J(groups))
if (!groups.bio || !groups.anom || !groups.tech) throw new Error('у переліку заготовок видно не всі три групи')
await shot('t-stand-final-dataitems.png', true)

// --- 3. Баланс --------------------------------------------------------------
await switchTab('Баланс')
const balance = await evalJs(`(() => {
  const panel = document.getElementById('tabpanel-balance')
  if (!panel) return null
  return [...panel.querySelectorAll('.bal-faction')].map((r) => ({
    faction: r.getAttribute('data-faction'),
    missing: r.querySelectorAll('.bal-status-missing').length,
    gated: r.querySelectorAll('.bal-status-gated').length,
    ok: r.querySelectorAll('.bal-status-ok').length,
  }))
})()`)
console.log('баланс:', J(balance))
await shot('t-stand-final-balance.png', true)

if (consoleErrors.length) {
  console.log('ПОМИЛКИ КОНСОЛІ:', consoleErrors)
  process.exitCode = 1
} else {
  console.log('помилок консолі немає')
}
process.exit(process.exitCode ?? 0)
