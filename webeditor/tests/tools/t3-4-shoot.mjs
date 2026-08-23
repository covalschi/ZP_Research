// Скріншот-харнес W3 Task 4 (панель проблем дерева) -- той самий прийом headless Chrome +
// сирий CDP, що t3-3-shoot.mjs (жорсткі console-assert збережено). Сценарій брифа:
//   (а) фікстура з ЦИКЛОМ + битим батьком + дублем Id (+ ItemCost-сумнівом) -- панель
//       показує ВСІ поверхи: проєктний блок (дубль Id + пояснення hardErr), групи обох
//       гілок, підказку про нащадків біля ItemCost-warn, довідку warn-проти-операцій
//       з цитатами SaveBranch/ValidateGraph;
//   (б) клік по рядку СВОЄЇ гілки центрує полотно (viewport transform міняється) і
//       вибирає вузол (панель вузла відкривається);
//   (б2) клік по рядку ЧУЖОЇ гілки перемикає гілку, центрує і вибирає;
//   (в) полагодження через панель вузла (прибрати битого батька) -- рядок ЖИВЦЕМ зникає
//       з панелі проблем, лічильники перераховуються, вузол гасне.
// Запуск: `node tests/tools/t3-4-shoot.mjs` (vite preview на :4173 має працювати).
import { zipSync } from 'fflate'
import { spawn } from 'child_process'
import { writeFileSync, mkdtempSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = process.env.T3_4_SHOOT_OUT || 'E:/TMP/claude/E--dayzmod/ef2600b9-21a8-43d6-8043-cf5a4904c3ec/scratchpad'
const PORT = 9343
const URL = 'http://localhost:4173/'
const DIST = 'E:/dayzmod/webeditor/dist'

mkdirSync(OUT, { recursive: true })

// ---- Фікстура: bio (цикл + дубль Id + ItemCost-сумнів) і chem (битий батько) ---------------
const pointTypesJson = JSON.stringify(
  {
    ConfigVersion: 1,
    PointTypes: [{ Id: 'bio_t1', Name: 'Біо T1', Icon: '', Color: '#7CB342', SortOrder: 1, Category: '', Kind: '', Tier: 1 }],
    Categories: [],
    Kinds: [],
  },
  null,
  4,
)

function node(id, override = {}) {
  return {
    Id: id,
    Name: `Вузол ${id}`,
    Description: '',
    Icon: '',
    Tier: 1,
    Parents: [],
    ParentsMode: 'all',
    Cost: [],
    ItemCost: [],
    ResearchTimeSec: 0,
    RequiredFactions: [],
    ...override,
  }
}

const bioJson = JSON.stringify(
  {
    ConfigVersion: 1,
    Branch: { Id: 'bio', Name: 'Біологія', Icon: '', SortOrder: 1, Factions: [] },
    Nodes: [
      node('bio_root'),
      node('cyc_a', { Tier: 2, Parents: ['cyc_b'] }),
      node('cyc_b', { Tier: 2, Parents: ['cyc_a'] }),
      node('dup_node'),
      node('dup_node', { Tier: 2 }),
      node('ic_doubt', { ItemCost: [{ Classname: 'ZZZ_No_Such_Class', Quantity: 1, Content: '' }] }),
    ],
  },
  null,
  4,
)

const chemJson = JSON.stringify(
  {
    ConfigVersion: 1,
    Branch: { Id: 'chem', Name: 'Хімія', Icon: '', SortOrder: 2, Factions: [] },
    Nodes: [node('chem_root'), node('chem_orphan', { Tier: 2, Parents: ['no_such_node'] })],
  },
  null,
  4,
)

const zip = zipSync({
  'PointTypes.json': new TextEncoder().encode(pointTypesJson),
  'TechTree/bio.json': new TextEncoder().encode(bioJson),
  'TechTree/chem.json': new TextEncoder().encode(chemJson),
})
writeFileSync(join(DIST, 't3-4.zip'), zip)
console.log('фікстуру зібрано:', zip.length, 'байт')

// ---- headless Chrome + сирий CDP -------------------------------------------------------------
const profile = mkdtempSync(join(tmpdir(), 't34shoot-'))
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

await send('Page.navigate', { url: URL })
// Сторінка -- один файл на ~3.5 МБ: чекаємо не фіксовану паузу, а ГОТОВНІСТЬ DOM (інакше
// fetch відносного URL стартував би ще з about:blank і падав «Failed to fetch»).
for (let i = 0; i < 60; i++) {
  const ready = await evalJs(`!!document.getElementById('import-zip-input')`)
  if (ready) break
  await sleep(400)
  if (i === 59) throw new Error('сторінка не завантажилась: #import-zip-input так і не зʼявився')
}

// ---- Імпорт фікстури + вкладка «Дерево» ------------------------------------------------------
await evalJs(`(async () => {
  const res = await fetch(${JSON.stringify(URL + 't3-4.zip')})
  const buf = await res.arrayBuffer()
  const dt = new DataTransfer()
  dt.items.add(new File([buf], 't3-4.zip', { type: 'application/zip' }))
  const input = document.getElementById('import-zip-input')
  input.files = dt.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
})()`)
await sleep(800)
await evalJs(`[...document.querySelectorAll('.tab-button')].find((b) => b.textContent.includes('Дерево')).click()`)
await sleep(1100)

// Спільні дрібниці харнеса ---------------------------------------------------------------------
async function cdpClick(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}
// Рядок панелі проблем за текстом: прокрутити панель до нього (вона скролиться) і віддати
// екранний прямокутник для СПРАВЖНЬОГО кліку CDP.
async function problemRowRect(needle) {
  return evalJs(`(() => {
    const btn = [...document.querySelectorAll('.tree-problems-row')].find((b) => b.textContent.includes(${JSON.stringify(needle)}))
    if (!btn) return null
    btn.scrollIntoView({ block: 'center' })
    const r = btn.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })()`)
}
async function viewportTransform() {
  return evalJs(`document.querySelector('.react-flow__viewport')?.style.transform ?? null`)
}

// ---- (а) Панель показує всі поверхи ---------------------------------------------------------
const stateA = await evalJs(`(() => {
  const panel = document.querySelector('.tree-problems-panel')
  if (!panel) return null
  const project = panel.querySelector('.tree-problems-project')
  const groups = [...panel.querySelectorAll('.tree-problems-group')].map((g) => ({
    branch: g.querySelector('.tree-problems-branch').textContent,
    rows: [...g.querySelectorAll('.tree-problems-row')].map((b) => b.textContent.trim()),
  }))
  return {
    header: panel.querySelector('.breaks-panel-title').textContent,
    projectText: project ? project.textContent : null,
    groups,
    hintInline: panel.querySelector('.tree-problems-hint-inline')?.textContent ?? null,
    hintFooter: panel.querySelector('.tree-problems-hint')?.textContent ?? null,
  }
})()`)
console.log('панель:', JSON.stringify(stateA, null, 1))
if (!stateA) throw new Error('панелі проблем дерева немає у DOM')
if (!stateA.header.includes('аварій 3') || !stateA.header.includes('попереджень 7'))
  throw new Error('лічильники шапки не зійшлись (чекав аварій 3 · попереджень 7): ' + stateA.header)
if (!stateA.projectText || !stateA.projectText.includes("дубль Id вузла 'dup_node'"))
  throw new Error('проєктний блок не показує дубль Id: ' + stateA.projectText)
if (!stateA.projectText.includes('TryLoadTechTree') || !stateA.projectText.includes('ЖОДНОГО'))
  throw new Error('проєктний блок без пояснення hardErr «одна відмова = нуль вузлів»: ' + stateA.projectText)
if (stateA.groups.length !== 2) throw new Error('чекав 2 групи (Біологія + Хімія), є ' + stateA.groups.length)
if (!stateA.groups[0].branch.includes('Біологія') || !stateA.groups[0].branch.includes('TechTree/bio.json'))
  throw new Error('перша група не Біологія: ' + stateA.groups[0].branch)
if (stateA.groups[0].rows.length !== 5)
  throw new Error('у групі Біологія чекав 5 рядків (cyc_a, cyc_b, dup x2, ic_doubt): ' + JSON.stringify(stateA.groups[0].rows))
if (!stateA.groups[1].branch.includes('Хімія') || stateA.groups[1].rows.length !== 1 || !stateA.groups[1].rows[0].includes('chem_orphan'))
  throw new Error('друга група не Хімія/chem_orphan: ' + JSON.stringify(stateA.groups[1]))
if (!stateA.hintInline || !stateA.hintInline.includes('НАЩАДКИ'))
  throw new Error('немає підказки другого порядку про нащадків біля ItemCost-warn: ' + stateA.hintInline)
if (!stateA.hintFooter || !stateA.hintFooter.includes('ValidateGraph') || !stateA.hintFooter.includes('SaveBranch') || !stateA.hintFooter.includes('UPSERT_NODE'))
  throw new Error('довідка warn-проти-операцій неповна: ' + stateA.hintFooter)
await shot('t3-4-a-panel-groups.png')

// ---- (б) Клік по рядку СВОЄЇ гілки: центрує + вибирає ---------------------------------------
const tfBefore = await viewportTransform()
const rowCycA = await problemRowRect('cyc_a')
if (!rowCycA) throw new Error('рядок cyc_a не знайдений у панелі')
await cdpClick(rowCycA.x + rowCycA.w / 2, rowCycA.y + rowCycA.h / 2)
await sleep(900) // 80 мс пауза + 350 мс анімація setCenter + запас
const stateB = await evalJs(`(() => {
  const card = document.querySelector('[data-id="tnode::TechTree/bio.json::cyc_a"] .tree-node-card')
  const panel = document.querySelector('.tree-node-panel')
  return {
    transform: document.querySelector('.react-flow__viewport')?.style.transform ?? null,
    selected: card ? card.classList.contains('tree-node-selected') : null,
    nodePanelName: panel ? panel.querySelector('.tree-node-panel-name')?.textContent : null,
  }
})()`)
console.log('після кліку cyc_a:', JSON.stringify(stateB), 'transform до:', tfBefore)
if (stateB.selected !== true) throw new Error('вузол cyc_a не вибраний після кліку по рядку')
if (stateB.transform === tfBefore) throw new Error('viewport не зрушив -- центрування не відбулось')
if (stateB.nodePanelName !== 'Вузол cyc_a') throw new Error('панель вузла не відкрилась на cyc_a: ' + stateB.nodePanelName)
await shot('t3-4-b-centered.png')

// ---- (б2) Клік по рядку ЧУЖОЇ гілки: перемикає гілку + центрує + вибирає --------------------
const rowOrphan = await problemRowRect('chem_orphan')
if (!rowOrphan) throw new Error('рядок chem_orphan не знайдений у панелі')
await cdpClick(rowOrphan.x + rowOrphan.w / 2, rowOrphan.y + rowOrphan.h / 2)
await sleep(1500) // перемонтування React Flow (key=гілка) + onInit + setCenter
const stateB2 = await evalJs(`(() => {
  const plate = document.querySelector('.tree-branch-plate')?.textContent ?? ''
  const card = document.querySelector('[data-id="tnode::TechTree/chem.json::chem_orphan"] .tree-node-card')
  const wrap = document.querySelector('.tree-canvas-wrap')
  let visible = null
  if (card && wrap) {
    const c = card.getBoundingClientRect()
    const w = wrap.getBoundingClientRect()
    visible = c.right > w.left && c.left < w.right && c.bottom > w.top && c.top < w.bottom
  }
  const panel = document.querySelector('.tree-node-panel')
  return {
    plate,
    selected: card ? card.classList.contains('tree-node-selected') : null,
    visible,
    alarm: card ? card.classList.contains('tree-node-alarm') : null,
    nodePanelName: panel ? panel.querySelector('.tree-node-panel-name')?.textContent : null,
  }
})()`)
console.log('після кліку chem_orphan:', JSON.stringify(stateB2))
if (!stateB2.plate.includes('TechTree/chem.json')) throw new Error('гілка не перемкнулась на chem: ' + stateB2.plate)
if (stateB2.selected !== true) throw new Error('вузол chem_orphan не вибраний після кросгілкового кліку')
if (stateB2.visible !== true) throw new Error('картка chem_orphan поза видимою зоною полотна -- центрування не доїхало')
if (stateB2.alarm !== true) throw new Error('chem_orphan мав горіти alarm до полагодження')
if (stateB2.nodePanelName !== 'Вузол chem_orphan') throw new Error('панель вузла не відкрилась на chem_orphan: ' + stateB2.nodePanelName)
await shot('t3-4-c-crossbranch.png')

// ---- (в) Полагодження: прибрати битого батька -- рядок живцем зникає ------------------------
await evalJs(`(() => {
  const btn = [...document.querySelectorAll('.tree-node-panel button')].find((b) => b.getAttribute('aria-label') === 'Прибрати батька 1')
  if (!btn) throw new Error('кнопки «Прибрати батька 1» немає в панелі вузла')
  btn.click()
})()`)
await sleep(900)
const stateC = await evalJs(`(() => {
  const panel = document.querySelector('.tree-problems-panel')
  const card = document.querySelector('[data-id="tnode::TechTree/chem.json::chem_orphan"] .tree-node-card')
  const nodePanelProblems = document.querySelectorAll('.tree-node-panel-problems li').length
  return {
    header: panel?.querySelector('.breaks-panel-title')?.textContent ?? null,
    panelHasOrphan: panel ? panel.textContent.includes('chem_orphan') : null,
    groups: panel ? panel.querySelectorAll('.tree-problems-group').length : null,
    cardAlarm: card ? card.classList.contains('tree-node-alarm') : null,
    nodePanelProblems,
    saveDisabled: [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Зберегти зміни')).disabled,
  }
})()`)
console.log('після полагодження:', JSON.stringify(stateC))
if (stateC.panelHasOrphan !== false) throw new Error('рядок chem_orphan не зник із панелі проблем')
if (stateC.groups !== 1) throw new Error('чекав 1 групу після полагодження (лише Біологія), є ' + stateC.groups)
if (!stateC.header.includes('аварій 3') || !stateC.header.includes('попереджень 5'))
  throw new Error('лічильники не перерахувались (чекав аварій 3 · попереджень 5): ' + stateC.header)
if (stateC.cardAlarm !== false) throw new Error('картка chem_orphan досі горить alarm після полагодження')
if (stateC.nodePanelProblems !== 0) throw new Error('панель вузла досі показує причини: ' + stateC.nodePanelProblems)
if (stateC.saveDisabled !== false) throw new Error('після правки проєкт не dirty')
await shot('t3-4-d-fixed-row-gone.png')

console.log('консольні помилки за сесію:', consoleErrors.length, consoleErrors)
if (consoleErrors.length > 0) throw new Error('консольні помилки в сесії: ' + consoleErrors.join(' | '))
ws.close()
chrome.kill()
console.log('готово')
