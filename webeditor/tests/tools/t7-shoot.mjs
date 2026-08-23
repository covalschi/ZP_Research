// Смоук-харнес T7 (вбудований імпортер класів): headless Chrome + сирий CDP — той самий
// прийом, що t5/t6/t9-shoot.mjs. Сценарій: відкрити секцію імпортера -> додати РЕАЛЬНІ
// теки (DayZ\ ваніль; steamapps\workshop\content\221100 — справжній Steam-вміст, бо
// крізь NTFS-junction'и !Workshop браузер не бачить, перевірено зондом; @ZP_Research;
// @ZP_Research_VPP) через webkitdirectory + DOM.setFileInputFiles -> ХОЛОДНИЙ імпорт
// (порожній IndexedDB свіжого профілю, воркер-пул) -> звіт -> ТЕПЛИЙ імпорт (той самий
// профіль, кеш повний) -> «Використати зараз». Скріншоти пишуться файлами (standing
// rule), числа холодного/теплого прогону друкуються в консоль для звіту.
// Запуск: `node tests/tools/t7-shoot.mjs` із webeditor/ (dist/ має бути зібраний).

import { spawn } from 'child_process'
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = process.env.T7_SHOOT_OUT || 'E:/TMP/claude/E--dayzmod/ef2600b9-21a8-43d6-8043-cf5a4904c3ec/scratchpad/t7-shots'
const PORT = 9339
const PREVIEW_PORT = 4173
const URL = `http://localhost:${PREVIEW_PORT}/`

const DIRS = [
  'E:\\Programs\\Steam\\steamapps\\common\\DayZ',
  'E:\\Programs\\Steam\\steamapps\\workshop\\content\\221100',
  'E:\\dayzmod\\@ZP_Research',
  'E:\\dayzmod\\@ZP_Research_VPP',
]

mkdirSync(OUT, { recursive: true })

// ---- vite preview (dist) -------------------------------------------------------------------
const preview = spawn('npx.cmd', ['vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort'], {
  cwd: 'E:/dayzmod/webeditor',
  stdio: 'ignore',
  shell: true,
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitPreview() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(URL)
      if (res.ok) return
    } catch {}
    await sleep(300)
  }
  throw new Error('vite preview не піднявся')
}

// ---- headless Chrome + CDP -----------------------------------------------------------------
const profile = mkdtempSync(join(tmpdir(), 't7shoot-'))
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1600,1200',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

async function getWsUrl() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`)
      const page = (await res.json()).find((t) => t.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch {}
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
  const path = join(OUT, name)
  writeFileSync(path, Buffer.from(r.data, 'base64'))
  console.log('знято', path)
}

async function clickById(id) {
  const ok = await evalJs(`(() => { const b = document.getElementById(${JSON.stringify(id)}); if (!b) return false; b.click(); return true })()`)
  if (!ok) throw new Error(`елемент #${id} не знайдено`)
  await sleep(150)
}

async function main() {
  await waitPreview()
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
    }
  }

  await send('Page.enable')
  await send('Runtime.enable')
  await send('DOM.enable')
  await send('Page.navigate', { url: URL })
  await sleep(1500)

  // 1) відкрити секцію імпортера
  await clickById('toggle-import-classes')
  await sleep(200)

  // 2) додати чотири реальні теки через webkitdirectory (диалогів немає — CDP)
  for (let i = 0; i < DIRS.length; i++) {
    const doc = await send('DOM.getDocument')
    const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#import-dir-input' })
    if (!node.nodeId) throw new Error('#import-dir-input не знайдено')
    await send('DOM.setFileInputFiles', { files: [DIRS[i]], nodeId: node.nodeId })
    // чекаємо, поки тека з'явиться у списку (енумерація великої теки може тривати)
    for (let t = 0; t < 100; t++) {
      const count = await evalJs(`document.querySelectorAll('.import-dirs li').length`)
      if (count === i + 1) break
      await sleep(200)
    }
  }
  const dirCount = await evalJs(`document.querySelectorAll('.import-dirs li').length`)
  console.log('додано тек:', dirCount)
  if (dirCount !== DIRS.length) throw new Error(`очікував ${DIRS.length} тек, у списку ${dirCount}`)
  await shot('t7-a0-dirs-added.png')

  // 3) ХОЛОДНИЙ імпорт (свіжий профіль -> порожній IndexedDB)
  async function runImport(tag) {
    const t0 = Date.now()
    await clickById('import-start')
    let midShotDone = false
    for (let t = 0; t < 1200; t++) {
      const state = await evalJs(`(() => {
        const report = document.getElementById('import-report')
        const prog = document.querySelector('.import-progress-text')
        const err = document.querySelector('.indicator.alarm')
        return { hasReport: !!report, progress: prog ? prog.textContent : null, error: err ? err.textContent : null }
      })()`)
      if (state.error) throw new Error('імпорт упав: ' + state.error)
      if (!midShotDone && state.progress && /\d+\/\d+/.test(state.progress)) {
        const [d, tot] = state.progress.match(/(\d+)\/(\d+)/).slice(1).map(Number)
        if (d > tot * 0.2) {
          await shot(`t7-${tag}-progress.png`)
          midShotDone = true
        }
      }
      if (state.hasReport) break
      await sleep(100)
    }
    const wall = Date.now() - t0
    const report = await evalJs(`document.querySelector('#import-report .indicator')?.textContent ?? null`)
    if (!report) throw new Error('звіт не з\'явився')
    console.log(`${tag}: wall=${wall}ms; звіт: ${report.trim()}`)
    await shot(`t7-${tag}-report.png`)
    return { wall, report }
  }

  const cold = await runImport('b-cold')

  // 4) ТЕПЛИЙ імпорт: та сама сторінка, той самий IndexedDB
  const warm = await runImport('c-warm')

  // 5) «Використати зараз»
  await clickById('import-use-now')
  await sleep(300)
  const applied = await evalJs(`[...document.querySelectorAll('.indicator')].map((n) => n.textContent).find((t) => t.includes('Активний індекс'))`)
  console.log('застосовано:', applied)
  if (!applied) throw new Error('статус «Активний індекс…» не з\'явився')
  await shot('t7-d-applied.png')

  // 6) числа для звіту
  const num = (s, re) => {
    const m = s.match(re)
    return m ? Number(m[1]) : null
  }
  // «кеш[ау]»: UI друкує «з кешу» (виправлений родовий відмінок), старіші збірки — «з
  // кеша»; матчимо обидва, щоб повторний смоук не занулив метрики мовчки
  const coldClasses = num(cold.report, /:\s*(\d+)\s+класів/)
  const warmCacheHits = num(warm.report, /з кеш[ау]:\s*(\d+)/)
  const warmTotal = num(warm.report, /з кеш[ау]:\s*\d+\s+із\s+(\d+)/)
  console.log(
    JSON.stringify({ coldWallMs: cold.wall, warmWallMs: warm.wall, coldClasses, warmCacheHits, warmTotal }, null, 1),
  )
  if (warm.wall > cold.wall / 2) {
    console.warn('УВАГА: теплий прогін не разюче швидший за холодний — кеш під питанням')
  }
  if (warmCacheHits !== warmTotal) {
    console.warn(`УВАГА: теплий прогін узяв з кеша ${warmCacheHits} із ${warmTotal} — не всі`)
  }
}

try {
  await main()
  console.log('t7-shoot: готово')
} finally {
  try { ws?.close() } catch {}
  chrome.kill()
  preview.kill()
  // npx.cmd через shell лишає дочірній процес — приб'ємо по порту нижче в обгортці, якщо треба
}
process.exit(0)
