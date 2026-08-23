// Скрипт живого приймання W3 Task 5: headless Chrome + сирий CDP (той самий прийом, що
// t5-accept.mjs / t3-3-shoot.mjs / t3-4-shoot.mjs), джерело -- РЕАЛЬНІ 12 конфіг-файлів
// стенду (testserver\profiles\ZP_Research). Уся нова гілка будується ВИКЛЮЧНО кліками
// через полотно й панель вузла -- жодної правки JSON руками. Сценарій:
//   (0) імпорт ZIP зі стенду -> вкладка «Дерево» -> гілка zone (реальне дерево стенду,
//       кадр «а» власнику; жорстка звірка: 12 карток, 15 ребер);
//   (1) «створити гілку»: файл w3_acceptance, Branch-мета формою (Id/Name/SortOrder +
//       фракція ecolog через ZpSelect);
//   (2) три вузли кнопкою «+» у РІЗНИХ Tier-колонках (Тір 1/2/3), кожен заповнюється
//       панеллю: Назва текстом, Cost.Type -- ZpSelect по РЕАЛЬНИХ типах балів стенду,
//       Amount -- IntField (blur-коміт; headless-квірк: el.blur() не дає focusout,
//       диспатчимо FocusEvent руками); третій вузол -- ще й ItemCost на реальному
//       класі Paper (кадр «г»: панель із заповненими полями);
//   (3) ланцюг зв'язків МИШЕЮ: драг хендл-джерело -> хендл-ціль справжніми подіями CDP
//       (вузол1 -> вузол2 -> вузол3);
//   (4) драг вузла 3 з колонки «Тір 3» у «Тір 4» = правка Tier (кадри «б» до/після);
//   (5) кадр «д»: полотно нової гілки з ланцюгом (вибір знято кліком по тлу);
//   (6) спроба ЦИКЛУ зворотним драгом (вузол3 -> вузол1): відмова з UA-причиною і шляхом
//       циклу, ребро НЕ з'являється (кадр «в»);
//   (7) жодного alarm у новій гілці, панель проблем каже «Проблем дерева немає»;
//   (8) Зберегти -> Завантажити ZIP -> звірка байтів: РІВНО ОДИН новий файл
//       TechTree/w3_acceptance.json, решта 12 -- байт-у-байт як були; вміст нового файлу
//       перевіряється СТРУКТУРНО (JSON.parse, не підрядки);
//   (9) новий файл розпаковується в EXPORT_DIR -- запис на стенд робить ОКРЕМИЙ крок
//       (Bash), як і в t5-accept.mjs/T8.
//
// FactionData/PlayerData/ConfigBackup/StaticDevices* НІКОЛИ не потрапляють у ZIP.
//
// Запуск: `node tests/tools/t3-5-accept.mjs` (з webeditor/, vite preview вже на :4173).

import { unzipSync, zipSync } from 'fflate'
import { spawn } from 'child_process'
import { writeFileSync, mkdtempSync, readFileSync, existsSync, readdirSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = process.env.T3_5_OUT || 'E:/TMP/claude/E--dayzmod/ef2600b9-21a8-43d6-8043-cf5a4904c3ec/scratchpad'
const DOWNLOAD_DIR = join(OUT, 't3-5-downloads')
const EXPORT_DIR = join(OUT, 't3-5-exported')
const PORT = 9351
const URL = 'http://localhost:4173/'
const DIST = 'E:/dayzmod/webeditor/dist'
const STAND = 'E:/dayzmod/testserver/profiles/ZP_Research'

mkdirSync(OUT, { recursive: true })
rmSync(DOWNLOAD_DIR, { recursive: true, force: true })
mkdirSync(DOWNLOAD_DIR, { recursive: true })
rmSync(EXPORT_DIR, { recursive: true, force: true })
mkdirSync(EXPORT_DIR, { recursive: true })

// ---- 1. Зібрати ZIP із РЕАЛЬНИХ 12 конфіг-файлів стенду (той самий перелік, що t5-accept) --

const STAND_FILES = [
  'Settings.json',
  'PointTypes.json',
  'Factions.json',
  'DataItems.json',
  'Modules.json',
  'SampleTypes.json',
  'ProcessingRules/chain.json',
  'ProcessingRules/demo.json',
  'ProcessingRules/test_micro.json',
  'TechTree/clearsky.json',
  'TechTree/combat.json',
  'TechTree/zone.json',
]

const NEW_FILE = 'TechTree/w3_acceptance.json'

const originalBytes = new Map()
const zipInput = {}
for (const rel of STAND_FILES) {
  const buf = readFileSync(join(STAND, ...rel.split('/')))
  originalBytes.set(rel, buf)
  zipInput[rel] = new Uint8Array(buf)
}
const standZip = zipSync(zipInput)
writeFileSync(join(DIST, 't3-5-stand.zip'), standZip)
console.log('фікстура зі стенду зібрана:', standZip.length, 'байт,', STAND_FILES.length, 'файлів')

// ---- 2. headless Chrome + сирий CDP --------------------------------------------------------

const profile = mkdtempSync(join(tmpdir(), 't35accept-'))
const chrome = spawn(
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

// Жорсткий console-assert (конвенція W3-смоуків): будь-яка console.error за сесію -- провал.
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
await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOAD_DIR })

await send('Page.navigate', { url: URL })
// Сторінка -- один файл ~3.5 МБ: чекаємо ГОТОВНІСТЬ DOM, а не фіксовану паузу (прийом t3-4).
for (let i = 0; i < 60; i++) {
  const ready = await evalJs(`!!document.getElementById('import-zip-input')`)
  if (ready) break
  await sleep(400)
  if (i === 59) throw new Error('сторінка не завантажилась: #import-zip-input так і не з`явився')
}

// ---- Спільні дрібниці харнеса (прийоми t3-2/t3-3/t3-4) --------------------------------------

async function rectOf(sel) {
  return evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()`)
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

// React controlled input: нативний сеттер + input-подія (el.value без події React не бачить).
async function setInputValue(sel, value, proto = 'HTMLInputElement') {
  await evalJs(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)})
    const setter = Object.getOwnPropertyDescriptor(window.${proto}.prototype, 'value').set
    setter.call(el, ${JSON.stringify(value)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(120)
}

async function fieldValue(sel) {
  return evalJs(`document.querySelector(${JSON.stringify(sel)})?.value ?? null`)
}

// IntField комітить на blur; headless-квірк -- el.blur() НЕ породжує focusout (T8/T9),
// диспатчимо FocusEvent руками.
async function commitIntField(sel, value) {
  await evalJs(`document.querySelector(${JSON.stringify(sel)}).focus()`)
  await setInputValue(sel, String(value))
  await evalJs(`document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new FocusEvent('focusout', { bubbles: true }))`)
  await sleep(400)
}

// ZpSelect: набрати запит, клікнути (mousedown -- саме він комітить) опцію з точним
// label АБО hint == want. Повертає перелік побачених опцій при провалі -- для діагнозу.
async function pickZpOption(sel, query, want) {
  await evalJs(`document.querySelector(${JSON.stringify(sel)}).focus()`)
  await setInputValue(sel, query)
  await sleep(450)
  const picked = await evalJs(`(() => {
    const opts = [...document.querySelectorAll('.zp-select-option')]
    const target = opts.find((o) => {
      const label = o.querySelector('.zp-select-option-label')?.textContent?.trim() ?? ''
      const hint = o.querySelector('.zp-select-option-hint')?.textContent?.trim() ?? ''
      return label === ${JSON.stringify(want)} || hint === ${JSON.stringify(want)}
    })
    if (!target) return { ok: false, seen: opts.map((o) => o.textContent.trim()).slice(0, 8) }
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    return { ok: true }
  })()`)
  if (!picked.ok) throw new Error(`ZpSelect ${sel}: опції '${want}' немає за запитом '${query}'; бачив: ${JSON.stringify(picked.seen)}`)
  await sleep(400)
}

async function clickPanelButton(text) {
  const found = await evalJs(`(() => {
    const btn = [...document.querySelectorAll('.tree-node-panel button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)})
    if (!btn) return false
    btn.click()
    return true
  })()`)
  if (!found) throw new Error(`кнопка '${text}' у панелі вузла не знайдена`)
  await sleep(300)
}

// fitView кнопкою React Flow Controls -- щоб нові колонки/вузли завжди були в кадрі
// (fitView сам по собі не пере-запускається на появі вузлів).
async function fitView() {
  await evalJs(`document.querySelector('.react-flow__controls-fitview')?.click()`)
  await sleep(500)
}

async function edgeCount() {
  return evalJs(`document.querySelectorAll('.tree-edge-path').length`)
}

// ---- (0) Імпорт реального стенду + вкладка «Дерево» + кадр «а» (гілка zone) -----------------

await evalJs(`(async () => {
  const res = await fetch(${JSON.stringify(URL + 't3-5-stand.zip')})
  const buf = await res.arrayBuffer()
  const dt = new DataTransfer()
  dt.items.add(new File([buf], 't3-5-stand.zip', { type: 'application/zip' }))
  const input = document.getElementById('import-zip-input')
  input.files = dt.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
})()`)
await sleep(900)
await evalJs(`[...document.querySelectorAll('.tab-button')].find((b) => b.textContent.includes('Дерево')).click()`)
await sleep(1200)

const state0 = await evalJs(`(() => {
  const plate = document.querySelector('.tree-branch-plate')?.textContent ?? ''
  return { plate }
})()`)
console.log('0) стартова гілка:', JSON.stringify(state0))
if (!state0.plate.includes('TechTree/clearsky.json')) throw new Error('перша гілка не clearsky: ' + state0.plate)
if (!state0.plate.includes('гілка 1 з 3')) throw new Error('лічильник гілок не «1 з 3»: ' + state0.plate)

// zone -- третя за серверним сортуванням (clearsky < combat < zone, ASCII-lower).
await evalJs(`document.querySelector('button[aria-label="Наступна гілка"]').click()`)
await sleep(1000)
await evalJs(`document.querySelector('button[aria-label="Наступна гілка"]').click()`)
await sleep(1200)

const stateZone = await evalJs(`(() => {
  const plate = document.querySelector('.tree-branch-plate')?.textContent ?? ''
  const cards = document.querySelectorAll('.tree-node-card').length
  const alarms = document.querySelectorAll('.tree-node-card.tree-node-alarm').length
  const edges = document.querySelectorAll('.tree-edge-path').length
  const problems = document.querySelector('.tree-problems-panel')?.textContent ?? ''
  return { plate, cards, alarms, edges, problems }
})()`)
console.log('0) гілка zone:', JSON.stringify(stateZone))
if (!stateZone.plate.includes('TechTree/zone.json')) throw new Error('не перемкнулось на zone: ' + stateZone.plate)
// Дзеркальна звірка з реальним zone.json: 12 вузлів, 15 записів Parents = 15 ребер.
if (stateZone.cards !== 12) throw new Error('у zone очікував 12 карток, є ' + stateZone.cards)
if (stateZone.edges !== 15) throw new Error('у zone очікував 15 ребер (сума Parents), є ' + stateZone.edges)
if (stateZone.alarms !== 0) throw new Error('реальне дерево стенду має alarm-вузли: ' + stateZone.alarms)
if (!stateZone.problems.includes('Проблем дерева немає')) throw new Error('панель проблем не «Проблем дерева немає»: ' + stateZone.problems)
await shot('t3-5-a-stand-tree.png')
console.log('0) OK: реальне дерево стенду (zone) намальовано чисто, кадр «а» знято')

// ---- (1) «створити гілку»: w3_acceptance / w3accept / фракція ecolog ------------------------

await evalJs(`document.getElementById('tree-create-branch').click()`)
await sleep(500)
await setInputValue('#tbf-file', 'w3_acceptance')
await setInputValue('#tbf-id', 'w3accept')
await setInputValue('#tbf-name', 'Приймальна гілка W3')
await setInputValue('#tbf-sort', '4')
// Фракція гілки -- ZpSelect по РЕАЛЬНИХ фракціях стенду (label = DisplayName, hint = Id).
await pickZpOption('#tbf-faction-add', 'ecolog', 'ecolog')
const chip = await evalJs(`[...document.querySelectorAll('.tree-branch-form .station-chip code')].map((c) => c.textContent)`)
console.log('1) чіпи фракцій гілки:', JSON.stringify(chip))
if (!chip.includes('ecolog')) throw new Error('фракція ecolog не додалась чіпом: ' + JSON.stringify(chip))
await evalJs(`[...document.querySelectorAll('.tree-branch-form button')].find((b) => b.textContent.includes('Створити гілку')).click()`)
await sleep(1000)

const state1 = await evalJs(`(() => {
  const plate = document.querySelector('.tree-branch-plate')?.textContent ?? ''
  const empty = document.querySelector('.tree-empty-panel')?.textContent ?? ''
  const alert = document.querySelector('.tree-workspace [role="alert"]')
  // Ярлик тіру -- у <span> (textContent цілого заголовка містить і кнопку «+»).
  const headers = [...document.querySelectorAll('.tree-tier-header span')].map((h) => h.textContent)
  return { plate, empty, alert: alert ? alert.textContent : null, headers }
})()`)
console.log('1) після створення гілки:', JSON.stringify(state1))
if (state1.alert) throw new Error('створення гілки дало помилку: ' + state1.alert)
if (!state1.plate.includes('TechTree/w3_acceptance.json')) throw new Error('перемикач не на новій гілці: ' + state1.plate)
if (!state1.plate.includes('гілка 3 з 4')) throw new Error('нова гілка не третя з чотирьох (серверний сорт): ' + state1.plate)
if (!state1.empty.includes('немає вузлів')) throw new Error('нова гілка не порожня: ' + state1.empty)
if (state1.headers.length !== 1 || state1.headers[0] !== 'Тір 1') throw new Error('порожня гілка мусить мати одну колонку «Тір 1»: ' + JSON.stringify(state1.headers))

// ---- (2) Три вузли кнопкою «+» у колонках Тір 1/2/3, заповнення панеллю ---------------------

// Вузли створюються з auto-Id <Branch.Id>_vuzol(_N) -- io/nodeEdit.createTreeNode.
const NODES = [
  {
    tier: 1,
    key: 'tnode::TechTree/w3_acceptance.json::w3accept_vuzol',
    id: 'w3accept_vuzol',
    name: 'Польова розвідка Зони',
    costQuery: 'bio_field_t1',
    costName: 'Польове дослідження біології 1 тиру',
    amount: 6,
  },
  {
    tier: 2,
    key: 'tnode::TechTree/w3_acceptance.json::w3accept_vuzol_2',
    id: 'w3accept_vuzol_2',
    name: 'Аналітика зразків',
    costQuery: 'bio_lab_t1',
    costName: 'Лабораторне дослідження біології 1 тиру',
    amount: 10,
  },
  {
    tier: 3,
    key: 'tnode::TechTree/w3_acceptance.json::w3accept_vuzol_3',
    id: 'w3accept_vuzol_3',
    name: 'Протокол випробувань',
    costQuery: 'bio_lab_t2',
    costName: 'Лабораторне дослідження біології 2 тиру',
    amount: 4,
  },
]

for (const spec of NODES) {
  await fitView()
  const plusRect = await rectOf(`[data-id="tcol::${spec.tier}"] .tree-tier-header-add`)
  if (!plusRect) throw new Error(`кнопки «+» у заголовку колонки Тір ${spec.tier} немає`)
  await cdpClick(plusRect.x + plusRect.w / 2, plusRect.y + plusRect.h / 2)
  await sleep(900)

  const created = await evalJs(`(() => {
    const card = document.querySelector('[data-id=${JSON.stringify(spec.key)}]')
    const panel = document.querySelector('.tree-node-panel')
    const problems = panel ? [...panel.querySelectorAll('.tree-node-panel-problems li')].map((li) => li.textContent) : []
    return { cardExists: !!card, panelOpen: !!panel, problems }
  })()`)
  console.log(`2) після «+» у Тір ${spec.tier}:`, JSON.stringify(created))
  if (!created.cardExists) throw new Error(`картка ${spec.key} не з'явилась`)
  if (!created.panelOpen) throw new Error('панель вузла не відкрилась після створення')
  if (!created.problems.some((p) => p.includes('Name'))) throw new Error('свіжий вузол не горить «немає Name»: ' + JSON.stringify(created.problems))

  await setInputValue('#tnp-name', spec.name)
  await sleep(400)
  await clickPanelButton('+ Додати вартість')
  await pickZpOption('#tnp-cost-type-0', spec.costQuery, spec.costName)
  await commitIntField('#tnp-cost-amount-0', spec.amount)

  const filled = await evalJs(`(() => {
    const card = document.querySelector('[data-id=${JSON.stringify(spec.key)}]')
    const inner = card.querySelector('.tree-node-card')
    return {
      name: card.querySelector('.tree-node-name')?.textContent,
      alarm: inner.classList.contains('tree-node-alarm'),
      chips: [...card.querySelectorAll('.tree-cost-chip')].map((c) => c.textContent),
      costValue: document.querySelector('#tnp-cost-type-0')?.value ?? null,
    }
  })()`)
  console.log(`2) вузол ${spec.id} заповнено:`, JSON.stringify(filled))
  if (filled.name !== spec.name) throw new Error(`Назва не доїхала до картки: ${filled.name}`)
  if (filled.alarm !== false) throw new Error(`вузол ${spec.id} із Назвою все ще горить alarm`)
  if (filled.costValue !== spec.costName) throw new Error(`ZpSelect не показує обличчя типу балів: ${filled.costValue}`)
  if (!filled.chips.some((c) => c.includes(spec.costName) && c.includes('×' + spec.amount)))
    throw new Error(`чип вартості «${spec.costName} ×${spec.amount}» не з'явився: ` + JSON.stringify(filled.chips))
}

// Третій вузол -- ще й ItemCost на РЕАЛЬНОМУ класі (Paper, той самий, що вже живе у
// zone.json/bio_sampling): «+ Додати предмет» -> ZpSelect класу -> кількість 2.
await clickPanelButton('+ Додати предмет')
await pickZpOption('#tnp-ic-cls-0', 'Paper', 'Paper')
await commitIntField('#tnp-ic-qty-0', 2)
const ic = await evalJs(`(() => {
  const card = document.querySelector('[data-id="tnode::TechTree/w3_acceptance.json::w3accept_vuzol_3"]')
  return {
    cls: document.querySelector('#tnp-ic-cls-0')?.value ?? null,
    qty: document.querySelector('#tnp-ic-qty-0')?.value ?? null,
    itemsBadge: card.querySelector('.tree-cost-items')?.textContent ?? null,
    alarm: card.querySelector('.tree-node-card').classList.contains('tree-node-alarm'),
  }
})()`)
console.log('2) ItemCost вузла 3:', JSON.stringify(ic))
if (ic.cls !== 'Paper') throw new Error('ItemCost.Classname не закомітився: ' + ic.cls)
if (ic.qty !== '2') throw new Error('ItemCost.Quantity не закомітився: ' + ic.qty)
if (!ic.itemsBadge || !ic.itemsBadge.includes('предмети: 1')) throw new Error('картка не показує бейдж предметів: ' + ic.itemsBadge)
if (ic.alarm !== false) throw new Error('вузол 3 горить alarm після ItemCost на реальному класі')
await fitView()
await shot('t3-5-d-node-panel.png')
console.log('2) OK: три вузли створені «+» у Тір 1/2/3 і заповнені панеллю, кадр «г» знято')

// ---- (3) Ланцюг зв'язків МИШЕЮ: вузол1 -> вузол2 -> вузол3 ----------------------------------

async function connectByMouse(sourceKey, targetKey) {
  const src = await rectOf(`[data-id=${JSON.stringify(sourceKey)}] .react-flow__handle.source`)
  const dst = await rectOf(`[data-id=${JSON.stringify(targetKey)}] .react-flow__handle.target`)
  if (!src || !dst) throw new Error(`хендли connect не знайдені: ${sourceKey} -> ${targetKey}`)
  await cdpDrag(src.x + src.w / 2, src.y + src.h / 2, dst.x + dst.w / 2, dst.y + dst.h / 2)
  await sleep(900)
}

const edges0 = await edgeCount()
if (edges0 !== 0) throw new Error('у новій гілці вже є ребра: ' + edges0)
await connectByMouse(NODES[0].key, NODES[1].key)
const edges1 = await edgeCount()
if (edges1 !== 1) throw new Error('після connect 1->2 очікував 1 ребро, є ' + edges1)
await connectByMouse(NODES[1].key, NODES[2].key)
const state3 = await evalJs(`(() => {
  const alert = document.querySelector('.tree-workspace [role="alert"]')
  return { edges: document.querySelectorAll('.tree-edge-path').length, alert: alert ? alert.textContent : null }
})()`)
console.log('3) після двох connect:', JSON.stringify(state3))
if (state3.edges !== 2) throw new Error('після connect 2->3 очікував 2 ребра, є ' + state3.edges)
if (state3.alert) throw new Error('легальні connect дали помилку: ' + state3.alert)

// Панель мусить показати батька: клік по вузлу 3 -> #tnp-parent-0 = обличчя вузла 2.
const card3rect = await rectOf(`[data-id=${JSON.stringify(NODES[2].key)}] .tree-node-card`)
await cdpClick(card3rect.x + card3rect.w / 2, card3rect.y + card3rect.h / 2)
await sleep(600)
const parentFace = await fieldValue('#tnp-parent-0')
console.log('3) батько вузла 3 у панелі:', parentFace)
if (parentFace !== NODES[1].name) throw new Error(`панель вузла 3 не показує батька «${NODES[1].name}»: ${parentFace}`)
console.log('3) OK: ланцюг 1 -> 2 -> 3 зшитий мишею')

// ---- (4) Драг вузла 3: колонка «Тір 3» -> «Тір 4» = правка Tier (кадри «б») -----------------

await fitView()
await shot('t3-5-b1-drag-before.png')
const nodeRect = await rectOf(`[data-id=${JSON.stringify(NODES[2].key)}]`)
// Ярлик тіру -- у <span> всередині заголовка (textContent цілого заголовка містить і «+»).
const col4 = await evalJs(`(() => {
  const h = [...document.querySelectorAll('[data-id^="tcol::"]')].find((el) => el.querySelector('.tree-tier-header span')?.textContent === 'Тір 4')
  if (!h) return null
  const r = h.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y }
})()`)
if (!col4) throw new Error('порожньої колонки-цілі «Тір 4» немає')
await cdpDrag(nodeRect.x + nodeRect.w / 2, nodeRect.y + nodeRect.h / 2, col4.x, nodeRect.y + nodeRect.h / 2 + 30)
await sleep(1000)

const state4 = await evalJs(`(() => {
  const card = document.querySelector('[data-id=${JSON.stringify(NODES[2].key)}]')
  const r = card.getBoundingClientRect()
  const h = [...document.querySelectorAll('[data-id^="tcol::"]')].find((el) => el.querySelector('.tree-tier-header span')?.textContent === 'Тір 4')
  const hr = h.getBoundingClientRect()
  const headers = [...document.querySelectorAll('.tree-tier-header span')].map((x) => x.textContent)
  return {
    cardX: r.x,
    headerX: hr.x,
    tierField: document.querySelector('#tnp-tier')?.value ?? null,
    headers,
    edges: document.querySelectorAll('.tree-edge-path').length,
  }
})()`)
console.log('4) після драгу:', JSON.stringify(state4))
if (Math.abs(state4.cardX - state4.headerX) > 3) throw new Error(`картка не в колонці «Тір 4»: card.x=${state4.cardX}, header.x=${state4.headerX}`)
if (state4.tierField !== '4') throw new Error('панель не показує Tier=4 після драгу: ' + state4.tierField)
if (!state4.headers.includes('Тір 5')) throw new Error('після драгу не з`явилась порожня колонка «Тір 5»: ' + JSON.stringify(state4.headers))
if (state4.edges !== 2) throw new Error('драг загубив ребра ланцюга: ' + state4.edges)
await shot('t3-5-b2-drag-after.png')
console.log('4) OK: драг перевів вузол 3 у Тір 4, ланцюг цілий, кадри «б» зняті')

// ---- (5) Кадр «д»: полотно нової гілки з ланцюгом (вибір знято кліком по тлу) ---------------

const wrap = await rectOf('.tree-canvas-wrap')
await cdpClick(wrap.x + wrap.w - 40, wrap.y + wrap.h - 40)
await sleep(500)
await fitView()
const state5 = await evalJs(`(() => {
  return {
    panelOpen: !!document.querySelector('.tree-node-panel'),
    problems: document.querySelector('.tree-problems-panel')?.textContent ?? '',
    alarms: document.querySelectorAll('.tree-node-card.tree-node-alarm').length,
    saveDisabled: [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Зберегти зміни')).disabled,
  }
})()`)
console.log('5) фінальний стан гілки:', JSON.stringify(state5))
if (state5.panelOpen) throw new Error('клік по тлу не зняв вибір вузла')
if (state5.alarms !== 0) throw new Error('у новій гілці лишились alarm-вузли: ' + state5.alarms)
if (!state5.problems.includes('Проблем дерева немає')) throw new Error('панель проблем не порожня: ' + state5.problems)
if (state5.saveDisabled !== false) throw new Error('проєкт не dirty -- правки не записались')
await shot('t3-5-e-new-branch-chain.png')
console.log('5) OK: нова гілка з ланцюгом без жодного alarm, кадр «д» знято')

// ---- (6) Спроба циклу зворотним драгом: вузол3 -> вузол1 = відмова з UA-причиною ------------

await connectByMouse(NODES[2].key, NODES[0].key)
const state6 = await evalJs(`(() => {
  const alert = document.querySelector('.tree-workspace [role="alert"]')
  return { edges: document.querySelectorAll('.tree-edge-path').length, alert: alert ? alert.textContent : null }
})()`)
console.log('6) після спроби циклу:', JSON.stringify(state6))
if (state6.edges !== 2) throw new Error('кількість ребер змінилась -- цикл не мав записатись: ' + state6.edges)
if (!state6.alert) throw new Error('немає індикатора відмови циклу')
if (!state6.alert.includes('недосяжн')) throw new Error('відмова без причини недосяжності: ' + state6.alert)
if (!state6.alert.includes('цикл') || !state6.alert.includes('->')) throw new Error('відмова без шляху циклу: ' + state6.alert)
await shot('t3-5-c-cycle-rejected.png')
console.log('6) OK: цикл відхилено з UA-причиною і шляхом, кадр «в» знято')

// ---- (7) Зберегти -> Завантажити ZIP --------------------------------------------------------

await evalJs(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Зберегти зміни')).click()`)
await sleep(500)

const filesBefore = new Set(existsSync(DOWNLOAD_DIR) ? readdirSync(DOWNLOAD_DIR) : [])
await evalJs(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Завантажити ZIP'))
  if (!btn) throw new Error('кнопка «Завантажити ZIP» не знайдена')
  btn.click()
})()`)

let downloadedName
for (let i = 0; i < 50; i++) {
  await sleep(200)
  const names = existsSync(DOWNLOAD_DIR) ? readdirSync(DOWNLOAD_DIR) : []
  const fresh = names.find((n) => !filesBefore.has(n) && n.endsWith('.zip'))
  if (fresh) {
    downloadedName = fresh
    break
  }
}
if (!downloadedName) throw new Error('ZIP не завантажився протягом очікування')
console.log('7) завантажено:', downloadedName)

// ---- (8) Звірка байтів: РІВНО один новий файл, решта 12 байт-у-байт -------------------------

const zipBytes = readFileSync(join(DOWNLOAD_DIR, downloadedName))
const unzipped = unzipSync(new Uint8Array(zipBytes))
const zipNames = Object.keys(unzipped).filter((n) => !n.endsWith('/'))
console.log('8) файлів в експорті:', zipNames.length)
if (zipNames.length !== STAND_FILES.length + 1)
  throw new Error(`очікував ${STAND_FILES.length + 1} файлів (12 старих + 1 нова гілка), є ${zipNames.length}: ${zipNames.join(', ')}`)

const changed = []
for (const rel of STAND_FILES) {
  const out = unzipped[rel]
  if (!out) throw new Error(`${rel} відсутній в експортованому ZIP`)
  const same = Buffer.compare(Buffer.from(out), originalBytes.get(rel)) === 0
  console.log(`  [${same ? 'без змін' : 'ЗМІНЕНО'}] ${rel} (${out.length} байт)`)
  if (!same) changed.push(rel)
}
if (changed.length !== 0) throw new Error('старі файли мусили лишитись байт-у-байт, змінені: ' + changed.join(', '))
if (!unzipped[NEW_FILE]) throw new Error(`нового файлу ${NEW_FILE} немає в експорті`)

// Вміст нової гілки -- структурно (JSON.parse), не підрядками.
const branchDoc = JSON.parse(new TextDecoder('utf-8').decode(unzipped[NEW_FILE]))
function expectEq(what, actual, want) {
  const a = JSON.stringify(actual)
  const w = JSON.stringify(want)
  if (a !== w) throw new Error(`${what}: очікував ${w}, маю ${a}`)
}
expectEq('ConfigVersion', branchDoc.ConfigVersion, 1)
expectEq('Branch.Id', branchDoc.Branch.Id, 'w3accept')
expectEq('Branch.Name', branchDoc.Branch.Name, 'Приймальна гілка W3')
expectEq('Branch.SortOrder', branchDoc.Branch.SortOrder, 4)
expectEq('Branch.Factions', branchDoc.Branch.Factions, ['ecolog'])
expectEq('кількість вузлів', branchDoc.Nodes.length, 3)
const [n1, n2, n3] = branchDoc.Nodes
expectEq('n1.Id', n1.Id, 'w3accept_vuzol')
expectEq('n1.Name', n1.Name, 'Польова розвідка Зони')
expectEq('n1.Tier', n1.Tier, 1)
expectEq('n1.Parents', n1.Parents, [])
expectEq('n1.Cost', n1.Cost, [{ Type: 'bio_field_t1', Amount: 6 }])
expectEq('n2.Id', n2.Id, 'w3accept_vuzol_2')
expectEq('n2.Name', n2.Name, 'Аналітика зразків')
expectEq('n2.Tier', n2.Tier, 2)
expectEq('n2.Parents', n2.Parents, ['w3accept_vuzol'])
expectEq('n2.Cost', n2.Cost, [{ Type: 'bio_lab_t1', Amount: 10 }])
expectEq('n3.Id', n3.Id, 'w3accept_vuzol_3')
expectEq('n3.Name', n3.Name, 'Протокол випробувань')
expectEq('n3.Tier', n3.Tier, 4) // після драгу «Тір 3 -> Тір 4»
expectEq('n3.Parents', n3.Parents, ['w3accept_vuzol_2'])
expectEq('n3.Cost', n3.Cost, [{ Type: 'bio_lab_t2', Amount: 4 }])
expectEq('n3.ItemCost', n3.ItemCost, [{ Classname: 'Paper', Quantity: 2, Content: '' }])
for (const n of branchDoc.Nodes) {
  expectEq(`${n.Id}.ParentsMode`, n.ParentsMode, 'all')
  expectEq(`${n.Id}.RequiredFactions`, n.RequiredFactions, [])
}
console.log('8) OK: вміст нової гілки звірено структурно')

const outPath = join(EXPORT_DIR, ...NEW_FILE.split('/'))
mkdirSync(join(outPath, '..'), { recursive: true })
writeFileSync(outPath, Buffer.from(unzipped[NEW_FILE]))

console.log('консольні помилки за сесію:', consoleErrors.length, consoleErrors)
if (consoleErrors.length > 0) throw new Error('консольні помилки в сесії: ' + consoleErrors.join(' | '))
ws.close()
chrome.kill()
console.log(`готово. Нова гілка -> ${outPath} (запис на стенд ОКРЕМИМ кроком).`)
