// Скріншот-харнес W3 Task 2 (полотно дерева) -- той самий прийом headless Chrome + сирий
// CDP, що t26-3-shoot.mjs і сусіди. Сценарій брифа: (а) фікстурні гілки рендеряться
// Tier-колонками (з примарою кросгілкового батька), (б) ДРАГ вузла в іншу колонку міняє
// Tier живцем (кадри до/після + перевірка, що картка переїхала в колонку-ціль і проєкт
// став dirty), (в) alarm-вузли рукописного циклу в фікстурі горять (лампа АВАРІЯ +
// лічильник причин). Драг -- СПРАВЖНІМИ мишачими подіями CDP Input.dispatchMouseEvent
// (не синтетичними MouseEvent зі сторінки: драг React Flow тримається на pointer-подіях
// вікна). Запуск: `node tests/tools/t3-2-shoot.mjs` (vite preview на :4173 має працювати).
import { zipSync } from 'fflate'
import { spawn } from 'child_process'
import { writeFileSync, mkdtempSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = process.env.T3_2_SHOOT_OUT || 'E:/TMP/claude/E--dayzmod/ef2600b9-21a8-43d6-8043-cf5a4904c3ec/scratchpad'
const PORT = 9341
const URL = 'http://localhost:4173/'
const DIST = 'E:/dayzmod/webeditor/dist'

mkdirSync(OUT, { recursive: true })

// ---- Фікстура: дві гілки + кросгілковий батько + рукописний цикл ---------------------------
// bio.json: здорова гілка з трьома тірами; bio_adv має ДВОХ батьків -- свого (bio_micro) і
// чужого (chem_root із chem.json) -> на полотні bio мусить стояти примара chem_root.
// chem.json: chem_root здоровий; cycle_a <-> cycle_b -- РУКОПИСНИЙ ЦИКЛ (недосяжні за
// фікспойнтом ValidateGraph) -> обидва горять alarm.
const pointTypesJson = JSON.stringify(
  {
    ConfigVersion: 1,
    PointTypes: [
      { Id: 'bio_t1', Name: 'Біоматеріали T1', Icon: '', Color: '#7CB342', SortOrder: 1, Category: '', Kind: '', Tier: 1 },
      { Id: 'chem_t1', Name: 'Хімія T1', Icon: '', Color: '#FF7043', SortOrder: 2, Category: '', Kind: '', Tier: 1 },
    ],
    Categories: [],
    Kinds: [],
  },
  null,
  4,
)

function node(id, name, tier, parents, cost) {
  return {
    Id: id,
    Name: name,
    Description: '',
    Icon: '',
    Tier: tier,
    Parents: parents,
    ParentsMode: 'all',
    Cost: cost,
    ItemCost: [],
    ResearchTimeSec: 0,
    RequiredFactions: [],
  }
}

const bioJson = JSON.stringify(
  {
    ConfigVersion: 1,
    Branch: { Id: 'bio', Name: 'Біологія', Icon: '', SortOrder: 1, Factions: [] },
    Nodes: [
      node('bio_root', 'Польова біологія', 1, [], [{ Type: 'bio_t1', Amount: 10 }]),
      node('bio_micro', 'Мікроскопія', 2, ['bio_root'], [{ Type: 'bio_t1', Amount: 20 }]),
      node('bio_adv', 'Аномальні тканини', 3, ['bio_micro', 'chem_root'], [{ Type: 'bio_t1', Amount: 40 }, { Type: 'chem_t1', Amount: 5 }]),
    ],
  },
  null,
  4,
)

const chemJson = JSON.stringify(
  {
    ConfigVersion: 1,
    Branch: { Id: 'chem', Name: 'Хімія', Icon: '', SortOrder: 2, Factions: [] },
    Nodes: [
      node('chem_root', 'Реактиви', 1, [], [{ Type: 'chem_t1', Amount: 10 }]),
      node('cycle_a', 'Каталіз', 2, ['cycle_b'], [{ Type: 'chem_t1', Amount: 15 }]),
      node('cycle_b', 'Синтез', 3, ['cycle_a'], [{ Type: 'chem_t1', Amount: 15 }]),
    ],
  },
  null,
  4,
)

const zip = zipSync({
  'PointTypes.json': new TextEncoder().encode(pointTypesJson),
  'TechTree/bio.json': new TextEncoder().encode(bioJson),
  'TechTree/chem.json': new TextEncoder().encode(chemJson),
})
writeFileSync(join(DIST, 't3-2.zip'), zip)
console.log('фікстуру зібрано:', zip.length, 'байт')

// ---- headless Chrome + сирий CDP -------------------------------------------------------------
const profile = mkdtempSync(join(tmpdir(), 't32shoot-'))
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
await sleep(1200)

// ---- Імпорт фікстури + вкладка «Дерево» ------------------------------------------------------
await evalJs(`(async () => {
  const res = await fetch('/t3-2.zip')
  const buf = await res.arrayBuffer()
  const dt = new DataTransfer()
  dt.items.add(new File([buf], 't3-2.zip', { type: 'application/zip' }))
  const input = document.getElementById('import-zip-input')
  input.files = dt.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
})()`)
await sleep(800)
await evalJs(`[...document.querySelectorAll('.tab-button')].find((b) => b.textContent.includes('Дерево')).click()`)
await sleep(1100)

// ---- (а) Гілка bio: Tier-колонки + примара кросгілкового батька -----------------------------
const stateA = await evalJs(`(() => {
  const headers = [...document.querySelectorAll('.tree-tier-header')].map((h) => h.textContent)
  const cards = [...document.querySelectorAll('.tree-node-card')].map((c) => c.querySelector('.tree-node-id')?.textContent)
  const ghosts = [...document.querySelectorAll('.tree-ghost-card')].map((g) => g.querySelector('.tree-ghost-id')?.textContent)
  const plate = document.querySelector('.tree-branch-plate')?.textContent
  return { headers, cards, ghosts, plate, edges: document.querySelectorAll('.tree-edge-path').length }
})()`)
console.log('гілка bio:', JSON.stringify(stateA))
if (stateA.cards.length !== 3) throw new Error('очікував 3 картки bio, є ' + stateA.cards.length)
if (!stateA.ghosts.includes('chem_root')) throw new Error('немає примари chem_root на полотні bio')
if (!stateA.headers.includes('Тір 1') || !stateA.headers.includes('Тір 4')) throw new Error('колонки Тір не ті: ' + stateA.headers)
await shot('t3-2-a-columns-ghost.png')

// ---- (б) Драг bio_micro: Тір 2 -> Тір 4 (порожня колонка-ціль) справжніми подіями CDP -------
const NODE_SEL = '[data-id="tnode::TechTree/bio.json::bio_micro"]'
async function rectOf(sel) {
  return evalJs(`(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()`)
}
const before = await rectOf(NODE_SEL)
const target = await evalJs(`(() => {
  const h = [...document.querySelectorAll('[data-id^="tcol::"]')].find((el) => el.querySelector('.tree-tier-header')?.textContent === 'Тір 4')
  const r = h.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y }
})()`)
const saveDisabledBefore = await evalJs(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Зберегти зміни')).disabled`)
console.log('до драгу: картка', JSON.stringify(before), '-> ціль колонка Тір 4', JSON.stringify(target), 'Зберегти disabled:', saveDisabledBefore)
await shot('t3-2-b1-before-drag.png')

const startX = before.x + before.w / 2
const startY = before.y + before.h / 2
const endX = target.x
const endY = startY + 40 // трохи вниз -- вертикаль однаково НЕ зберігається (порядок файлу)
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startX, y: startY, button: 'left', clickCount: 1 })
for (let i = 1; i <= 10; i++) {
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: startX + ((endX - startX) * i) / 10,
    y: startY + ((endY - startY) * i) / 10,
    button: 'left',
  })
  await sleep(30)
}
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: endX, y: endY, button: 'left', clickCount: 1 })
await sleep(1000)

const after = await rectOf(NODE_SEL)
const afterState = await evalJs(`(() => {
  const h = [...document.querySelectorAll('[data-id^="tcol::"]')].find((el) => el.querySelector('.tree-tier-header')?.textContent === 'Тір 4')
  const hr = h.getBoundingClientRect()
  const save = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Зберегти зміни'))
  const headers = [...document.querySelectorAll('.tree-tier-header')].map((x) => x.textContent)
  return { headerX: hr.x, saveDisabled: save.disabled, headers }
})()`)
console.log('після драгу: картка', JSON.stringify(after), 'колонка Тір 4 x=', afterState.headerX, 'Зберегти disabled:', afterState.saveDisabled, 'колонки:', afterState.headers)
// Картка мусить стояти в колонці «Тір 4» (той самий x, до пікселя-двох через зум fitView).
if (Math.abs(after.x - afterState.headerX) > 3) throw new Error(`картка не в колонці-цілі: card.x=${after.x}, header.x=${afterState.headerX}`)
// Правка реальна: проєкт dirty -> «Зберегти зміни» ожила.
if (afterState.saveDisabled !== false) throw new Error('після драгу «Зберегти зміни» лишилась вимкненою -- Tier не записався')
// Живий перерахунок колонок: за maxTier=4 зʼявилась нова порожня колонка «Тір 5».
if (!afterState.headers.includes('Тір 5')) throw new Error('після драгу немає нової порожньої колонки Тір 5: ' + afterState.headers)
await shot('t3-2-b2-after-drag.png')

// ---- (в) Гілка chem: рукописний цикл горить --------------------------------------------------
await evalJs(`document.querySelector('button[aria-label="Наступна гілка"]').click()`)
await sleep(900)
const stateC = await evalJs(`(() => {
  const alarms = [...document.querySelectorAll('.tree-node-card.tree-node-alarm')].map((c) => ({
    id: c.querySelector('.tree-node-id')?.textContent,
    count: c.querySelector('.tree-node-alarm-count')?.textContent,
  }))
  const okCards = document.querySelectorAll('.tree-node-card:not(.tree-node-alarm)').length
  const plate = document.querySelector('.tree-branch-plate')?.textContent
  return { alarms, okCards, plate }
})()`)
console.log('гілка chem:', JSON.stringify(stateC))
if (stateC.alarms.length !== 2) throw new Error('очікував 2 alarm-вузли циклу, є ' + stateC.alarms.length)
if (!stateC.alarms.every((a) => a.count && a.count.includes('причин'))) throw new Error('alarm-вузли без лічильника причин')
await shot('t3-2-c-alarm-cycle.png')

console.log('консольні помилки за сесію:', consoleErrors.length, consoleErrors)
if (consoleErrors.length > 0) throw new Error('консольні помилки в сесії: ' + consoleErrors.join(' | '))
ws.close()
chrome.kill()
console.log('готово')
