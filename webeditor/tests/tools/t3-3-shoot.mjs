// Скріншот-харнес W3 Task 3 (connect + панель вузла + створення) -- той самий прийом
// headless Chrome + сирий CDP, що t3-2-shoot.mjs. Сценарій брифа:
//   (а) вузол З НУЛЯ мишею+панеллю: «+» у заголовку Tier-колонки (СПРАВЖНІЙ клік CDP --
//       перевіряє pointer-events кнопки під заглушеним заголовком) -> нова картка-заготовка
//       горить «немає Name» -> панель: Name текстом, Cost.Type через ZpSelect, Amount через
//       IntField (blur-коміт; headless-квірк: el.blur() не дає focusout -- диспатчимо руками);
//   (б) звʼязок мишею: драг хендл-джерело -> хендл-ціль справжніми подіями CDP, ребро
//       зʼявляється, Parents у панелі оновлюється;
//   (в) ЦИКЛ відхилено: зворотний драг (нащадок -> предок) дає індикатор із UA-причиною
//       і шляхом циклу, ребро НЕ зʼявляється;
//   (г) видалення ребра: перший клік взводить (індикатор), другий видаляє батька.
// Запуск: `node tests/tools/t3-3-shoot.mjs` (vite preview на :4173 має працювати).
import { zipSync } from 'fflate'
import { spawn } from 'child_process'
import { writeFileSync, mkdtempSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = process.env.T3_3_SHOOT_OUT || 'E:/TMP/claude/E--dayzmod/ef2600b9-21a8-43d6-8043-cf5a4904c3ec/scratchpad'
const PORT = 9342
const URL = 'http://localhost:4173/'
const DIST = 'E:/dayzmod/webeditor/dist'

mkdirSync(OUT, { recursive: true })

// ---- Фікстура: одна здорова гілка bio (root -> micro -> adv) --------------------------------
const pointTypesJson = JSON.stringify(
  {
    ConfigVersion: 1,
    PointTypes: [
      { Id: 'bio_t1', Name: 'Біо T1', Icon: '', Color: '#7CB342', SortOrder: 1, Category: '', Kind: '', Tier: 1 },
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
      node('bio_adv', 'Аномальні тканини', 3, ['bio_micro'], [{ Type: 'bio_t1', Amount: 40 }]),
    ],
  },
  null,
  4,
)

const zip = zipSync({
  'PointTypes.json': new TextEncoder().encode(pointTypesJson),
  'TechTree/bio.json': new TextEncoder().encode(bioJson),
})
writeFileSync(join(DIST, 't3-3.zip'), zip)
console.log('фікстуру зібрано:', zip.length, 'байт')

// ---- headless Chrome + сирий CDP -------------------------------------------------------------
const profile = mkdtempSync(join(tmpdir(), 't33shoot-'))
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
  const res = await fetch('/t3-3.zip')
  const buf = await res.arrayBuffer()
  const dt = new DataTransfer()
  dt.items.add(new File([buf], 't3-3.zip', { type: 'application/zip' }))
  const input = document.getElementById('import-zip-input')
  input.files = dt.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
})()`)
await sleep(800)
await evalJs(`[...document.querySelectorAll('.tab-button')].find((b) => b.textContent.includes('Дерево')).click()`)
await sleep(1100)

// Спільні дрібниці харнеса ---------------------------------------------------------------------
async function rectOf(sel) {
  return evalJs(`(() => { const el = document.querySelector('${sel}'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()`)
}
async function cdpClick(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}
async function cdpDrag(x1, y1, x2, y2) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', clickCount: 1 })
  for (let i = 1; i <= 12; i++) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: x1 + ((x2 - x1) * i) / 12,
      y: y1 + ((y2 - y1) * i) / 12,
      button: 'left',
    })
    await sleep(25)
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', clickCount: 1 })
}
// React controlled input: нативний сеттер + input-подія (звичайне el.value React не бачить).
async function setInputValue(sel, value) {
  await evalJs(`(() => {
    const el = document.querySelector('${sel}')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, ${JSON.stringify(value)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
}
async function edgeCount() {
  return evalJs(`document.querySelectorAll('.tree-edge-path').length`)
}

// ---- (а) Вузол з нуля: «+» у колонці «Тір 2» + панель ---------------------------------------
const NEW_NODE_SEL = '[data-id="tnode::TechTree/bio.json::bio_vuzol"]'
const plusRect = await rectOf('[data-id="tcol::2"] .tree-tier-header-add')
if (!plusRect) throw new Error('кнопки «+» у заголовку колонки Тір 2 немає')
await cdpClick(plusRect.x + plusRect.w / 2, plusRect.y + plusRect.h / 2)
await sleep(900)

const stateA1 = await evalJs(`(() => {
  const card = document.querySelector('${NEW_NODE_SEL}')
  const panel = document.querySelector('.tree-node-panel')
  const problems = panel ? [...panel.querySelectorAll('.tree-node-panel-problems li')].map((li) => li.textContent) : []
  const save = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Зберегти зміни'))
  return {
    cardExists: !!card,
    cardAlarm: card ? card.querySelector('.tree-node-card').classList.contains('tree-node-alarm') : null,
    panelOpen: !!panel,
    problems,
    saveDisabled: save.disabled,
  }
})()`)
console.log('після «+»:', JSON.stringify(stateA1))
if (!stateA1.cardExists) throw new Error('нова картка bio_vuzol не зʼявилась')
if (stateA1.cardAlarm !== true) throw new Error('свіжий вузол без Name мусить горіти alarm (чесна червона заготовка)')
if (!stateA1.panelOpen) throw new Error('панель вузла не відкрилась після створення')
if (!stateA1.problems.some((p) => p.includes('Name'))) throw new Error('панель не показує причину «немає Name»: ' + JSON.stringify(stateA1.problems))
if (stateA1.saveDisabled !== false) throw new Error('після створення вузла проєкт не dirty')

// Name через панель (TextField комітить на кожен ввід).
await setInputValue('#tnp-name', 'Аномальні дослідження')
await sleep(500)
// Cost.Type через ZpSelect: набрати запит, клікнути опцію (mousedown -- саме він комітить).
await evalJs(`[...document.querySelectorAll('.tree-node-panel button')].find((b) => b.textContent.includes('Додати вартість')).click()`)
await sleep(500)
await evalJs(`document.querySelector('#tnp-cost-type-0').focus()`)
await setInputValue('#tnp-cost-type-0', 'Біо')
await sleep(400)
await evalJs(`(() => {
  const opt = [...document.querySelectorAll('.zp-select-option')][0]
  if (!opt) throw new Error('опцій типу балів немає')
  opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
})()`)
await sleep(500)
// Amount через IntField: blur-коміт; headless-квірк -- el.blur() НЕ породжує focusout,
// диспатчимо FocusEvent руками (той самий прийом, що T8/T9).
await setInputValue('#tnp-cost-amount-0', '25')
await evalJs(`(() => {
  const el = document.querySelector('#tnp-cost-amount-0')
  el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
})()`)
await sleep(700)

const stateA2 = await evalJs(`(() => {
  const card = document.querySelector('${NEW_NODE_SEL}')
  const inner = card.querySelector('.tree-node-card')
  return {
    name: card.querySelector('.tree-node-name')?.textContent,
    alarm: inner.classList.contains('tree-node-alarm'),
    chips: [...card.querySelectorAll('.tree-cost-chip')].map((c) => c.textContent),
  }
})()`)
console.log('після панелі:', JSON.stringify(stateA2))
if (stateA2.name !== 'Аномальні дослідження') throw new Error('Name не доїхав до картки: ' + stateA2.name)
if (stateA2.alarm !== false) throw new Error('вузол із Name все ще горить alarm')
if (!stateA2.chips.some((c) => c.includes('Біо T1') && c.includes('25'))) throw new Error('чип вартості «Біо T1 ×25» не зʼявився: ' + JSON.stringify(stateA2.chips))
await shot('t3-3-a-node-created-panel.png')

// ---- (б) Звʼязок мишею: bio_root (джерело) -> bio_vuzol (ціль) ------------------------------
const edgesBefore = await edgeCount()
const srcHandle = await rectOf('[data-id="tnode::TechTree/bio.json::bio_root"] .react-flow__handle.source')
const dstHandle = await rectOf(`${NEW_NODE_SEL} .react-flow__handle.target`)
if (!srcHandle || !dstHandle) throw new Error('хендли connect не знайдені')
await cdpDrag(srcHandle.x + srcHandle.w / 2, srcHandle.y + srcHandle.h / 2, dstHandle.x + dstHandle.w / 2, dstHandle.y + dstHandle.h / 2)
await sleep(900)

const stateB = await evalJs(`(() => {
  const parentInput = document.querySelector('#tnp-parent-0')
  const alert = document.querySelector('.tree-workspace [role="alert"]')
  return {
    edges: document.querySelectorAll('.tree-edge-path').length,
    parentValue: parentInput ? parentInput.value : null,
    alert: alert ? alert.textContent : null,
  }
})()`)
console.log('після connect:', JSON.stringify(stateB), 'було ребер:', edgesBefore)
if (stateB.edges !== edgesBefore + 1) throw new Error(`ребро не зʼявилось: було ${edgesBefore}, стало ${stateB.edges}`)
if (stateB.parentValue !== 'Польова біологія') throw new Error('панель не показує нового батька bio_root: ' + stateB.parentValue)
if (stateB.alert) throw new Error('неочікувана помилка при легальному connect: ' + stateB.alert)
await shot('t3-3-b-connect.png')

// ---- (в) Цикл відхилено: зворотний драг bio_vuzol -> bio_root -------------------------------
const srcHandle2 = await rectOf(`${NEW_NODE_SEL} .react-flow__handle.source`)
const dstHandle2 = await rectOf('[data-id="tnode::TechTree/bio.json::bio_root"] .react-flow__handle.target')
await cdpDrag(srcHandle2.x + srcHandle2.w / 2, srcHandle2.y + srcHandle2.h / 2, dstHandle2.x + dstHandle2.w / 2, dstHandle2.y + dstHandle2.h / 2)
await sleep(900)

const stateC = await evalJs(`(() => {
  const alert = document.querySelector('.tree-workspace [role="alert"]')
  return { edges: document.querySelectorAll('.tree-edge-path').length, alert: alert ? alert.textContent : null }
})()`)
console.log('після спроби циклу:', JSON.stringify(stateC))
if (stateC.edges !== edgesBefore + 1) throw new Error('кількість ребер змінилась — цикл не мав записатись')
if (!stateC.alert) throw new Error('немає індикатора відмови циклу')
if (!stateC.alert.includes('недосяжн')) throw new Error('відмова без причини недосяжності: ' + stateC.alert)
if (!stateC.alert.includes('цикл') || !stateC.alert.includes('->')) throw new Error('відмова без шляху циклу: ' + stateC.alert)
await shot('t3-3-c-cycle-rejected.png')

// ---- (г) Видалення ребра: перший клік взводить, другий видаляє батька -----------------------
const EDGE_ID = 'tedge::tnode::TechTree/bio.json::bio_root=>tnode::TechTree/bio.json::bio_vuzol'
const edgeRect = await evalJs(`(() => {
  const g = document.querySelector('[data-id=${JSON.stringify(EDGE_ID)}]') || document.querySelector('[data-testid="rf__edge-' + ${JSON.stringify(EDGE_ID)} + '"]')
  if (!g) return null
  const hit = g.querySelector('.tree-edge-hit') || g
  const r = hit.getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width, h: r.height }
})()`)
if (!edgeRect) throw new Error('ребро root->vuzol не знайдене у DOM для кліку')
// Центр bbox ортогонального шляху лежить РІВНО на вертикальному сегменті (x = midX).
await cdpClick(edgeRect.x + edgeRect.w / 2, edgeRect.y + edgeRect.h / 2)
await sleep(500)
const armedState = await evalJs(`(() => {
  const status = [...document.querySelectorAll('.tree-workspace [role="status"]')].map((el) => el.textContent).join(' | ')
  return { status, armed: document.querySelectorAll('.tree-edge-armed').length }
})()`)
console.log('після першого кліку по ребру:', JSON.stringify(armedState))
if (armedState.armed !== 1) throw new Error('ребро не взвелось (немає .tree-edge-armed)')
if (!armedState.status.includes('ще раз')) throw new Error('немає підказки другого натискання: ' + armedState.status)
await shot('t3-3-d1-edge-armed.png')

await cdpClick(edgeRect.x + edgeRect.w / 2, edgeRect.y + edgeRect.h / 2)
await sleep(800)
const stateD = await evalJs(`(() => {
  const panel = document.querySelector('.tree-node-panel')
  return {
    edges: document.querySelectorAll('.tree-edge-path').length,
    parentRow: !!document.querySelector('#tnp-parent-0'),
  }
})()`)
console.log('після другого кліку по ребру:', JSON.stringify(stateD))
if (stateD.edges !== edgesBefore) throw new Error(`ребро не видалилось: очікував ${edgesBefore}, є ${stateD.edges}`)
if (stateD.parentRow) throw new Error('панель досі показує батька після видалення ребра')
await shot('t3-3-d2-edge-removed.png')

// ---- (д) Створення гілки-файлу: форма Branch-мети -> канонічний порожній файл ---------------
await evalJs(`document.getElementById('tree-create-branch').click()`)
await sleep(500)
await setInputValue('#tbf-file', 'chem_new')
await setInputValue('#tbf-id', 'chem')
await setInputValue('#tbf-name', 'Хімія (нова)')
await sleep(300)
await evalJs(`[...document.querySelectorAll('.tree-branch-form button')].find((b) => b.textContent.includes('Створити гілку')).click()`)
await sleep(900)
const stateE = await evalJs(`(() => {
  const plate = document.querySelector('.tree-branch-plate')?.textContent
  const empty = document.querySelector('.tree-empty-panel')?.textContent
  const alert = document.querySelector('.tree-workspace [role="alert"]')
  return { plate, empty, alert: alert ? alert.textContent : null }
})()`)
console.log('після створення гілки:', JSON.stringify(stateE))
if (stateE.alert) throw new Error('створення гілки дало помилку: ' + stateE.alert)
if (!stateE.plate || !stateE.plate.includes('TechTree/chem_new.json')) throw new Error('перемикач не перейшов на нову гілку: ' + stateE.plate)
if (!stateE.plate.includes('гілка 2 з 2')) throw new Error('лічильник гілок не 2 з 2: ' + stateE.plate)
if (!stateE.empty || !stateE.empty.includes('немає вузлів')) throw new Error('нова гілка не показує порожнє полотно: ' + stateE.empty)
await shot('t3-3-e-branch-created.png')

console.log('консольні помилки за сесію:', consoleErrors.length, consoleErrors)
if (consoleErrors.length > 0) throw new Error('консольні помилки в сесії: ' + consoleErrors.join(' | '))
ws.close()
chrome.kill()
console.log('готово')
