// Скріншот-харнес W4 Task 5 (вкладка «Баланс») — той самий прийом headless Chrome + сирий
// CDP, що t4-4-shoot.mjs (жорсткі console-assert збережено).
// Сценарії брифа:
//   (а) усі три секції на ЖИВОМУ стенді (контент, перестворений капстоуном: 4 описані
//       заготовки, ланцюги peresbir_*, 3 гілки дерева) — матриця «що скільки дає»;
//   (б) «Ланцюги до заготовок»: у ZP_Data_01 є виробник, у ZP_Data_77 — «ніхто не виробляє»;
//   (в) «Вартість дерева проти видобутку»: осмислені суми по фракціях + ТРИ стани в одному
//       кадрі (видобувається / умовно за гейтом вузла / вимагається, але не видобувається);
//   (г) кліки-переходи: заготовка -> вкладка «Заготовки» з відкритим записом; тип балів ->
//       «Бали»; вузол -> «Дерево»;
//   (д) фікстура з НОВОЮ діркою балансу (прибрано єдину заготовку, що давала bio_field_t1):
//       рядок, який щойно був зеленим, стає аварійним;
//   (е) фікс-раунд ревʼю (Critical 1): те саме правило з Mode="action" — сервер таке правило
//       ВІДКИДАЄ при завантаженні, тож рядок мусить стати аварійним із названою причиною, а
//       виробник — лишитись видимим із бейджем «сервер не запустить» (не зникнути).
// Кадри секцій знімаються КЛІПОМ по самій секції (ревʼю фікс-раунду, minor 9): три знімки
// однієї прокручуваної вкладки через captureBeyondViewport давали три БАЙТ-ІДЕНТИЧНІ файли.
// Steam64 адміна ЗАМІНЕНО плейсхолдером ЩЕ ПРИ ЗБИРАННІ фікстури (прецедент витоку W1),
// guard нижче звіряє весь DOM.
// Запуск: `node tests/tools/t4-5-shoot.mjs` (vite preview на :4173 має працювати).
import { zipSync } from 'fflate'
import { spawn } from 'child_process'
import { writeFileSync, readFileSync, readdirSync, mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = process.env.T4_5_SHOOT_OUT || 'E:/TMP/claude/E--dayzmod/ef2600b9-21a8-43d6-8043-cf5a4904c3ec/scratchpad'
const PORT = 9351
const URL = 'http://localhost:4173/'
const DIST = 'E:/dayzmod/webeditor/dist'
const STAND = 'E:/dayzmod/testserver/profiles/ZP_Research'
const PLACEHOLDER = '76561190000000000'

mkdirSync(OUT, { recursive: true })

// ---- Фікстури: живі стендові файли; Steam64 у Settings.json -> плейсхолдер ---------------------
const settingsDoc = JSON.parse(readFileSync(join(STAND, 'Settings.json'), 'utf8'))
if (!Array.isArray(settingsDoc.AdminIds) || settingsDoc.AdminIds.length !== 1) {
  throw new Error('стендовий Settings.json зсунувся: чекав рівно 1 AdminId, є ' + JSON.stringify(settingsDoc.AdminIds))
}
settingsDoc.AdminIds = [PLACEHOLDER]

const dataItemsDoc = JSON.parse(readFileSync(join(STAND, 'DataItems.json'), 'utf8'))
if (dataItemsDoc.Items.length !== 4) throw new Error('стендовий DataItems.json зсунувся: чекав 4 записи, є ' + dataItemsDoc.Items.length)

const raw = (name) => new Uint8Array(readFileSync(join(STAND, name)))
const enc = (o) => new TextEncoder().encode(JSON.stringify(o, null, 4))

function standFiles(overrides = {}) {
  const files = {
    'Settings.json': enc(settingsDoc),
    'Factions.json': raw('Factions.json'),
    'PointTypes.json': raw('PointTypes.json'),
    'DataItems.json': raw('DataItems.json'),
    'SampleTypes.json': raw('SampleTypes.json'),
    'Modules.json': raw('Modules.json'),
  }
  for (const f of readdirSync(join(STAND, 'ProcessingRules'))) files[`ProcessingRules/${f}`] = raw(`ProcessingRules/${f}`)
  for (const f of readdirSync(join(STAND, 'TechTree'))) files[`TechTree/${f}`] = raw(`TechTree/${f}`)
  return { ...files, ...overrides }
}

// Фікстури не лишаються в dist НІ ЗА ЯКОГО ВИХОДУ (ревʼю фікс-раунду, minor 10): падіння
// ассерта раніше лишало два zip у зібраному каталозі назавжди.
const FIXTURES = ['t4-5a.zip', 't4-5b.zip', 't4-5c.zip']
function cleanupFixtures() {
  for (const f of FIXTURES) rmSync(join(DIST, f), { force: true })
}
process.on('exit', cleanupFixtures)

writeFileSync(join(DIST, 't4-5a.zip'), zipSync(standFiles()))
// Фікстура (д): прибираємо ЄДИНУ заготовку, що дає bio_field_t1 — зелений рядок ecolog має
// стати аварійним, решта картини незмінна.
const holed = { ...dataItemsDoc, Items: dataItemsDoc.Items.filter((i) => i.Id !== 'ZP_Data_01') }
writeFileSync(join(DIST, 't4-5b.zip'), zipSync(standFiles({ 'DataItems.json': enc(holed) })))

// Фікстура (е): те саме правило-виробник, але з Mode="action" — режим прибрано директивою
// власника 2026-08-03, і ValidateRule (:267-270) відкидає таке правило ще при завантаженні.
const DEAD_RULE = 'pb_analiz_bio'
let deadRuleFile = null
for (const f of readdirSync(join(STAND, 'ProcessingRules'))) {
  const doc = JSON.parse(readFileSync(join(STAND, 'ProcessingRules', f), 'utf8'))
  const hit = (doc.Rules ?? []).find((r) => r.Id === DEAD_RULE)
  if (!hit) continue
  hit.Mode = 'action'
  deadRuleFile = { name: `ProcessingRules/${f}`, doc }
}
if (!deadRuleFile) throw new Error(`стенд зсунувся: правила '${DEAD_RULE}' немає в ProcessingRules/`)
writeFileSync(join(DIST, 't4-5c.zip'), zipSync(standFiles({ [deadRuleFile.name]: enc(deadRuleFile.doc) })))
console.log('фікстури зібрано: стенд як є + стенд без ZP_Data_01 + стенд із мертвим правилом', deadRuleFile.name)

// ---- headless Chrome + сирий CDP -------------------------------------------------------------
const profile = mkdtempSync(join(tmpdir(), 't45shoot-'))
const chrome = spawn(
  CHROME,
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1680,1400', '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank'],
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
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  writeFileSync(join(OUT, name), Buffer.from(r.data, 'base64'))
  console.log('знято', join(OUT, name))
}
// Кадр ОДНІЄЇ секції (ревʼю фікс-раунду, minor 9): повний знімок прокручуваної вкладки давав
// на трьох секціях три однакові файли — кліп по прямокутнику самої секції робить кожен кадр
// тим, що обіцяє його імʼя. Координати — сторінкові (getBoundingClientRect + скрол), саме їх
// чекає Page.captureScreenshot.clip разом із captureBeyondViewport.
async function shotOf(selector, name) {
  const box = await evalJs(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height }
  })()`)
  if (!box) throw new Error('немає елемента для кадру: ' + selector)
  const clip = { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height), scale: 1 }
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip })
  writeFileSync(join(OUT, name), Buffer.from(r.data, 'base64'))
  console.log('знято', join(OUT, name), `${clip.width}x${clip.height}`)
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
for (let i = 0; i < 60; i++) {
  const ready = await evalJs(`!!document.getElementById('import-zip-input')`)
  if (ready) break
  await sleep(400)
  if (i === 59) throw new Error('сторінка не завантажилась: #import-zip-input так і не зʼявився')
}

async function importZip(name) {
  await evalJs(`(async () => {
    const res = await fetch(${JSON.stringify(URL)} + ${JSON.stringify(name)})
    const buf = await res.arrayBuffer()
    const dt = new DataTransfer()
    dt.items.add(new File([buf], ${JSON.stringify(name)}, { type: 'application/zip' }))
    const input = document.getElementById('import-zip-input')
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(900)
}
async function clickTab(label) {
  await evalJs(`[...document.querySelectorAll('.tab-button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)}).click()`)
  await sleep(500)
}
async function activeTab() {
  return evalJs(`[...document.querySelectorAll('.tab-button')].find((b) => b.getAttribute('aria-selected') === 'true')?.textContent.trim() ?? null`)
}

// ---- (а) Матриця «що скільки дає» на живому стенді -------------------------------------------
await importZip('t4-5a.zip')
await clickTab('Баланс')

const matrix = await evalJs(`(() => {
  const t = document.getElementById('bal-matrix')
  if (!t) return null
  const cols = [...t.querySelectorAll('thead th')].slice(1).map((th) => th.textContent.trim())
  const rows = [...t.querySelectorAll('tbody tr')].map((tr) => ({
    item: tr.getAttribute('data-item'),
    cells: Object.fromEntries([...tr.querySelectorAll('td[data-type]')].map((td) => [td.getAttribute('data-type'), td.textContent.trim()])),
  }))
  const totals = Object.fromEntries([...t.querySelectorAll('tfoot td[data-total]')].map((td) => [td.getAttribute('data-total'), td.textContent.trim()]))
  const idle = document.querySelectorAll('.bal-idle .bal-idle-chip').length
  return { cols, rows, totals, idle }
})()`)
console.log('матриця:', JSON.stringify(matrix))
if (!matrix) throw new Error('таблиці #bal-matrix немає')
if (matrix.rows.length !== 4) throw new Error('чекав 4 рядки заготовок, є ' + matrix.rows.length)
if (matrix.cols.length !== 4) throw new Error('чекав 4 колонки типів (лише ті, що хтось дає), є ' + JSON.stringify(matrix.cols))
const d01 = matrix.rows.find((r) => r.item === 'ZP_Data_01')
if (!d01 || d01.cells.bio_field_t1 !== '5') throw new Error('ZP_Data_01 мав давати bio_field_t1=5: ' + JSON.stringify(d01))
if (matrix.totals.bio_field_t1 !== '5' || matrix.totals.combat_field_t1 !== '5' || matrix.totals.electronics_field_t1 !== '3' || matrix.totals.electronics_field_t2 !== '4') {
  throw new Error('підсумки колонок не збіглися: ' + JSON.stringify(matrix.totals))
}
if (matrix.idle !== 20) throw new Error('чекав 20 типів, яких не дає ніхто (24 у стенді, 4 задіяні), є ' + matrix.idle)

const leak = await evalJs(`document.body.innerHTML.includes('76561198')`)
if (leak) throw new Error('ВИТІК: у DOM знайдено справжній Steam64-префікс стенда!')
await shotOf('.balance-workspace section.sheet:nth-of-type(1)', 't4-5-a-matrix.png')

// ---- (б) Ланцюги до заготовок ------------------------------------------------------------------
const chains = await evalJs(`(() => [...document.querySelectorAll('.bal-chain-row')].map((li) => ({
  item: li.getAttribute('data-item'),
  lamp: li.querySelector('.bal-chain-head .lamp')?.className ?? '',
  producers: [...li.querySelectorAll('.bal-path .bal-rule')].map((c) => c.textContent),
  reason: li.querySelector('.bal-reason')?.textContent ?? '',
})))()`)
console.log('ланцюги:', JSON.stringify(chains))
const ch01 = chains.find((c) => c.item === 'ZP_Data_01')
const ch77 = chains.find((c) => c.item === 'ZP_Data_77')
if (!ch01 || ch01.producers.join() !== 'pb_analiz_bio') throw new Error('виробник ZP_Data_01: ' + JSON.stringify(ch01))
if (!ch01.lamp.includes('lamp-ok')) throw new Error('лампа ZP_Data_01 мала бути ok: ' + ch01.lamp)
if (!ch77 || ch77.producers.length !== 0 || !ch77.reason.includes('ніхто не виробляє')) throw new Error('ZP_Data_77 мав бути «ніхто не виробляє»: ' + JSON.stringify(ch77))
if (!ch77.lamp.includes('lamp-warn')) throw new Error('лампа ZP_Data_77 мала бути warn: ' + ch77.lamp)
await shotOf('.balance-workspace section.sheet:nth-of-type(2)', 't4-5-b-chains.png')

// ---- (в) Вартість дерева проти видобутку -------------------------------------------------------
async function readFaction(id) {
  return evalJs(`(() => {
    const sec = document.querySelector('.bal-faction[data-faction=' + ${JSON.stringify(JSON.stringify(id))} + ']')
    if (!sec) return null
    return {
      lamp: sec.querySelector('.bal-faction-title .lamp')?.className ?? '',
      rows: [...sec.querySelectorAll('tr.bal-cost')].map((tr) => ({
        type: tr.getAttribute('data-type'),
        total: tr.querySelectorAll('td')[1]?.textContent.trim(),
        status: [...tr.classList].find((c) => c.startsWith('bal-status-')),
        label: tr.querySelector('.bal-status-label')?.textContent ?? '',
      })),
      notes: [...sec.querySelectorAll(':scope > .indicator')].map((p) => p.textContent),
      compact: sec.classList.contains('bal-faction-empty'),
      text: sec.textContent,
    }
  })()`)
}
const eco = await readFaction('ecolog')
console.log('ecolog:', JSON.stringify(eco))
if (!eco) throw new Error('блоку фракції ecolog немає')
if (eco.rows.length !== 14) throw new Error('чекав 14 рядків вартості в ecolog, є ' + eco.rows.length)
const ecoBio = eco.rows.find((r) => r.type === 'bio_field_t1')
if (ecoBio.total !== '13' || ecoBio.status !== 'bal-status-ok') throw new Error('bio_field_t1 у ecolog: ' + JSON.stringify(ecoBio))
const ecoEl = eco.rows.find((r) => r.type === 'electronics_field_t1')
if (ecoEl.total !== '8' || ecoEl.status !== 'bal-status-gated') throw new Error('electronics_field_t1 мав бути «умовно» (гейт вузла pb_osnovy): ' + JSON.stringify(ecoEl))
const ecoLab = eco.rows.find((r) => r.type === 'bio_lab_t2')
if (ecoLab.total !== '35' || ecoLab.status !== 'bal-status-missing') throw new Error('bio_lab_t2 мав бути діркою балансу: ' + JSON.stringify(ecoLab))
if (!ecoLab.label.includes('не видобувається')) throw new Error('підпис дірки: ' + ecoLab.label)
if (!eco.lamp.includes('lamp-alarm')) throw new Error('лампа ecolog мала горіти alarm: ' + eco.lamp)

const sky = await readFaction('clearsky')
if (sky.rows.length !== 1 || sky.rows[0].status !== 'bal-status-missing' || sky.rows[0].total !== '8') {
  throw new Error('clearsky: дерево вимагає 8 bio_field_t1, а видобутку немає — ' + JSON.stringify(sky.rows))
}
// Фракція без дерева й без видобутку — компактний однорядковий вигляд (на стенді таких 4)
const free = await readFaction('freedom')
if (free.rows.length !== 0) throw new Error('freedom не має гілок — рядків вартості бути не може: ' + JSON.stringify(free.rows))
if (!free.compact) throw new Error('freedom мав згорнутись у компактний рядок')
if (!free.text.includes('гілок дерева немає') || !free.text.includes('здавати нема куди')) {
  throw new Error('компактний рядок freedom мав сказати про відсутність гілок і терміналу: ' + free.text)
}
await shotOf('.balance-workspace section.sheet:nth-of-type(3)', 't4-5-c-tree-vs-yield.png')

// ---- (г) Кліки-переходи -----------------------------------------------------------------------
// заготовка -> «Заготовки» з відкритим записом
await evalJs(`document.querySelector('#bal-matrix tbody tr[data-item="ZP_Data_77"] .bal-jump-item').click()`)
await sleep(500)
const afterItem = { tab: await activeTab(), name: await evalJs(`document.getElementById('di-name')?.value ?? null`), cls: await evalJs(`document.querySelector('.entity-detail .field-readonly code')?.textContent ?? null`) }
console.log('після кліку по заготовці:', JSON.stringify(afterItem))
if (afterItem.tab !== 'Заготовки') throw new Error('клік по заготовці мав відкрити вкладку «Заготовки», відкрито: ' + afterItem.tab)
if (afterItem.cls !== 'ZP_Data_77') throw new Error('панель відкрилась не на ZP_Data_77: ' + afterItem.cls)
if (!afterItem.name.includes('пам')) throw new Error('імʼя в панелі: ' + afterItem.name)
await shot('t4-5-d-jump-dataitem.png')

// тип балів -> «Бали» з вибраним записом
await clickTab('Баланс')
await evalJs(`document.querySelector('#bal-matrix thead .bal-jump-type').click()`)
await sleep(500)
const afterType = { tab: await activeTab(), id: await evalJs(`document.getElementById('pt-id')?.value ?? document.querySelector('.pt-detail code')?.textContent ?? null`) }
console.log('після кліку по типу балів:', JSON.stringify(afterType))
if (afterType.tab !== 'Бали') throw new Error('клік по типу балів мав відкрити вкладку «Бали», відкрито: ' + afterType.tab)
const typeSelected = await evalJs(`document.body.innerText.includes('bio_field_t1')`)
if (!typeSelected) throw new Error('на вкладці «Бали» не видно bio_field_t1')
await shot('t4-5-e-jump-pointtype.png')

// вузол -> «Дерево»
await clickTab('Баланс')
await evalJs(`document.querySelector('.bal-faction[data-faction="ecolog"] tr.bal-cost .bal-jump-node').click()`)
await sleep(900)
const afterNode = { tab: await activeTab(), selected: await evalJs(`document.querySelectorAll('.tree-node-selected').length`) }
console.log('після кліку по вузлу:', JSON.stringify(afterNode))
if (afterNode.tab !== 'Дерево') throw new Error('клік по вузлу мав відкрити вкладку «Дерево», відкрито: ' + afterNode.tab)
if (afterNode.selected !== 1) throw new Error('на полотні мала бути рівно одна вибрана картка, є ' + afterNode.selected)
await shot('t4-5-f-jump-treenode.png')

// правило/прилад -> вікно станка на вкладці «Ланцюги» (ревʼю фікс-раунду, minor 4: колбек
// onOpenStation був підключений, але жодного разу не пройдений смоуком)
await clickTab('Баланс')
const stationTarget = await evalJs(`document.querySelector('.bal-chain-row .bal-jump-station')?.textContent?.trim() ?? null`)
await evalJs(`document.querySelector('.bal-chain-row .bal-jump-station').click()`)
await sleep(700)
const afterStation = {
  tab: await activeTab(),
  open: await evalJs(`!!document.querySelector('.station-window')`),
  cls: await evalJs(`document.querySelector('.station-window-class')?.textContent ?? null`),
  rows: await evalJs(`document.querySelectorAll('.station-window .station-rows > li').length`),
}
console.log('після кліку по приладу:', stationTarget, JSON.stringify(afterStation))
if (afterStation.tab !== 'Ланцюги') throw new Error('клік по приладу мав відкрити вкладку «Ланцюги», відкрито: ' + afterStation.tab)
if (!afterStation.open) throw new Error('вікно станка не відкрилось')
if (afterStation.cls !== 'ZP_Microscope') throw new Error('вікно відкрилось не на приладі правила: ' + afterStation.cls)
if (afterStation.rows < 1) throw new Error('у вікні станка немає жодного рядка правила')
await shot('t4-5-h-jump-station.png')

// Ручне перемикання вкладок ГАСИТЬ невиконаний запит фокуса (ревʼю фікс-раунду, minor 7).
// Механіка, яку перевіряємо: вкладки монтуються/розмонтовуються разом із перемиканням, тож
// повернення на «Заготовки» ЗАВЖДИ віддає панель у стан «нічого не вибрано» (стан вибору —
// локальний useState приймача). До фіксу поверх цього ще й ВДРУГЕ спрацьовував ефект фокуса
// з тим самим nonce і переграв останній клік із «Балансу» — адмін, який щойно сам вибрав
// інший запис, бачив натомість ZP_Data_77. Тепер запит одноразовий: панель порожня, вкладка
// знову повний господар свого вибору.
await clickTab('Заготовки')
await evalJs(`[...document.querySelectorAll('.entity-table .row-select')].find((b) => b.textContent.trim() === 'ZP_Data_31').click()`)
await sleep(300)
const manualChoice = await evalJs(`document.querySelector('.entity-detail .field-readonly code')?.textContent ?? null`)
if (manualChoice !== 'ZP_Data_31') throw new Error('ручний вибір у списку не спрацював: ' + manualChoice)
await clickTab('Ланцюги')
await clickTab('Заготовки')
await sleep(300)
const keptChoice = await evalJs(`document.querySelector('.entity-detail .field-readonly code')?.textContent ?? null`)
console.log('вибір після повернення на «Заготовки»:', keptChoice)
if (keptChoice !== null) throw new Error('застарілий запит фокуса переграв себе при перемонтуванні вкладки: ' + keptChoice)

// ---- (д) Нова дірка балансу: прибрано єдину заготовку з bio_field_t1 ---------------------------
await importZip('t4-5b.zip')
await clickTab('Баланс')
const holedEco = await readFaction('ecolog')
const holedBio = holedEco.rows.find((r) => r.type === 'bio_field_t1')
console.log('після зняття ZP_Data_01:', JSON.stringify(holedBio))
if (holedBio.status !== 'bal-status-missing') throw new Error('bio_field_t1 мав стати діркою: ' + JSON.stringify(holedBio))
const holedMatrix = await evalJs(`document.querySelectorAll('#bal-matrix tbody tr').length`)
if (holedMatrix !== 3) throw new Error('у фікстурі без ZP_Data_01 мало лишитись 3 заготовки, є ' + holedMatrix)
const orphanChain = await evalJs(`(() => {
  const li = document.querySelector('.bal-chain-row[data-item="ZP_Data_01"]')
  return li ? { lamp: li.querySelector('.lamp')?.className ?? '', text: li.textContent } : null
})()`)
if (!orphanChain || !orphanChain.lamp.includes('lamp-alarm')) throw new Error('ZP_Data_01 мав лишитись у ланцюгах як «виробляється, але не описана»: ' + JSON.stringify(orphanChain))
await shot('t4-5-g-new-hole.png')

// ---- (е) Мертве правило: сервер відкине його при завантаженні ----------------------------------
// ГОЛОВНИЙ доказ фікс-раунду на ЖИВОМУ конфігу: до фіксу цей самий рядок лишався зеленим
// «видобувається», хоча в грі правила не існує (AddFileRules :249-254 — Warn+continue).
await importZip('t4-5c.zip')
await clickTab('Баланс')
const deadEco = await readFaction('ecolog')
const deadBio = deadEco.rows.find((r) => r.type === 'bio_field_t1')
console.log('після Mode=action у', DEAD_RULE + ':', JSON.stringify(deadBio))
if (deadBio.status !== 'bal-status-missing') throw new Error('рядок мав стати аварійним: ' + JSON.stringify(deadBio))
if (!deadEco.text.includes('Mode')) throw new Error('причина відмови (Mode) мусить бути видима в блоці фракції')
const deadChain = await evalJs(`(() => {
  const li = document.querySelector('.bal-chain-row[data-item="ZP_Data_01"]')
  if (!li) return null
  return {
    lamp: li.querySelector('.lamp')?.className ?? '',
    producers: [...li.querySelectorAll('.bal-path .bal-rule')].map((c) => c.textContent),
    badges: [...li.querySelectorAll('.bal-badge')].map((b) => b.textContent.trim()),
    text: li.textContent,
  }
})()`)
console.log('ланцюг ZP_Data_01 із мертвим правилом:', JSON.stringify(deadChain))
if (!deadChain || deadChain.producers.join() !== DEAD_RULE) throw new Error('виробника СХОВАНО — ревʼю вимагало показати його з причиною: ' + JSON.stringify(deadChain))
if (!deadChain.badges.some((b) => b.includes('сервер не запустить'))) throw new Error('немає бейджа мертвого правила: ' + JSON.stringify(deadChain.badges))
if (!deadChain.text.includes('Mode')) throw new Error('причина на самому правилі не показана: ' + deadChain.text)
if (!deadChain.lamp.includes('lamp-alarm')) throw new Error('лампа рядка мала стати аварійною: ' + deadChain.lamp)
await shotOf('.balance-workspace section.sheet:nth-of-type(2)', 't4-5-i-dead-rule.png')

console.log('консольні помилки за сесію:', consoleErrors.length, consoleErrors)
if (consoleErrors.length > 0) throw new Error('консольні помилки в сесії: ' + consoleErrors.join(' | '))
ws.close()
chrome.kill()
// Фікстурні zip не лишаються в dist (конвенція T2: генеруються скриптом, не комітяться).
// Той самий прибиральник висить і на process.on('exit') — щоб падіння ассерта теж чистило.
cleanupFixtures()
console.log('готово')
