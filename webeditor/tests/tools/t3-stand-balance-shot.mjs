// Кадри вкладки «Баланс» ДО і ПІСЛЯ наповнення стенда (задача «тестовий стенд», T3).
// Той самий сирий-CDP харнес, що t4-8-shoot.mjs / capstone-rebuild.mjs: headless Chrome,
// ZIP-фікстура з РЕАЛЬНИХ конфігів, диск профілю НЕ чіпається.
//
// «До» береться з бекапу профілю (тека, знята перед правками), «після» — з живого стенда.
// Steam64 адміна підмінюється плейсхолдером (прецедент t4-4/t4-8), щоб не потрапив у кадр.
//
// Запуск:
//   npm run build && npx vite preview --port 4173 &
//   node tests/tools/t3-stand-balance-shot.mjs <тека-ДО> <тека-ПІСЛЯ>

import { zipSync } from 'fflate'
import { spawn } from 'child_process'
import { writeFileSync, readFileSync, mkdirSync, mkdtempSync, existsSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = process.env.T3_SHOOT_OUT || 'E:/TMP/claude/E--dayzmod/ef2600b9-21a8-43d6-8043-cf5a4904c3ec/scratchpad'
// Префікс імен кадрів — щоб та сама пара «до/після» знімалась і для наступних задач стенду
// (T6 «тир від сировини») без копії цілого інструмента: SHOOT_PREFIX=t6-balance.
const PREFIX = process.env.SHOOT_PREFIX || 't-stand-balance'
const PORT = 9361
const URL = 'http://localhost:4173/'
const DIST = 'E:/dayzmod/webeditor/dist'
const PLACEHOLDER = '76561190000000000'
const J = JSON.stringify

const BEFORE_DIR = process.argv[2]
const AFTER_DIR = process.argv[3]
if (!BEFORE_DIR || !AFTER_DIR) throw new Error('вкажіть теку ДО і теку ПІСЛЯ')
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
    for (const child of readdirSyncSafe(subdir)) {
      files[`${sub}/${child}`] = new Uint8Array(readFileSync(join(subdir, child)))
    }
  }
  writeFileSync(join(DIST, name), zipSync(files))
  return Object.keys(files).length
}

function readdirSyncSafe(dir) {
  return readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.json'))
}

const nBefore = buildZip(BEFORE_DIR, 't3-before.zip')
const nAfter = buildZip(AFTER_DIR, 't3-after.zip')
console.log(`ZIP «до»: ${nBefore} файлів; ZIP «після»: ${nAfter} файлів`)

const profile = mkdtempSync(join(tmpdir(), 't3shoot-'))
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
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
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

async function loadZip(zipName) {
  await send('Page.navigate', { url: URL })
  for (let i = 0; i < 60; i++) {
    if (await evalJs(`!!document.getElementById('import-zip-input')`)) break
    await sleep(400)
    if (i === 59) throw new Error('сторінка не завантажилась')
  }
  await evalJs(`(async () => {
    const res = await fetch(${J(URL)} + ${J(zipName)})
    const buf = await res.arrayBuffer()
    const dt = new DataTransfer()
    dt.items.add(new File([buf], ${J(zipName)}, { type: 'application/zip' }))
    const input = document.getElementById('import-zip-input')
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(1500)
}

async function switchTab(label) {
  await evalJs(`[...document.querySelectorAll('.tab-button')].find((b) => b.textContent.trim() === ${J(label)}).click()`)
  await sleep(900)
}

// Підсумок по фракціях прямо з DOM — щоб кадр супроводжувався перевірюваним текстом.
async function factionSummary() {
  return evalJs(`(() => {
    const panel = document.getElementById('tabpanel-balance')
    if (!panel) return null
    const rows = [...panel.querySelectorAll('.bal-faction')]
    return rows.map((r) => ({
      faction: r.getAttribute('data-faction'),
      missing: r.querySelectorAll('.bal-status-missing').length,
      gated: r.querySelectorAll('.bal-status-gated').length,
      ok: r.querySelectorAll('.bal-status-ok').length,
    }))
  })()`)
}

for (const [zip, tag] of [
  ['t3-before.zip', 'do'],
  ['t3-after.zip', 'pislia'],
]) {
  await loadZip(zip)
  await switchTab('Баланс')
  const text = await evalJs(`document.getElementById('tabpanel-balance')?.textContent ?? ''`)
  if (text.length < 1000) throw new Error(`«Баланс» не наповнився (${tag}): ${text.length}`)
  console.log(`[${tag}] довжина тексту вкладки: ${text.length}`)
  console.log(`[${tag}] фракції:`, J(await factionSummary()))
  await shot(`${PREFIX}-${tag}.png`)
}

if (consoleErrors.length) {
  console.log('ПОМИЛКИ КОНСОЛІ:', consoleErrors)
  process.exitCode = 1
} else {
  console.log('помилок консолі немає')
}
process.exit(process.exitCode ?? 0)
