// Скріншот-харнес W4 Task 6 (хвости капстоуна) — той самий прийом headless Chrome + сирий
// CDP, що t4-5-shoot.mjs/capstone-rebuild.mjs (жорсткі console-assert збережено).
// Сценарії брифа:
//   (а) видалення ФАЙЛУ правил: гард-перелік вмісту + підтвердження другим натисканням ->
//       файл зник із реєстру -> «Зберегти зміни» -> ЗАВАНТАЖЕНИЙ ZIP його не містить
//       (реальний експорт, не лише стан у памʼяті);
//   (б) спроба видалити одиночний конфіг (Settings.json) — кнопки НЕМАЄ, натомість
//       пояснення, чому сервер однаково створить файл заново;
//   (в) вікно станка для класу БЕЗ жодного правила (ZP_PetriDishKit — його немає ні в
//       правилах, ні в DeviceClasses фракцій, тобто картки на полотні не існує в принципі):
//       відкривається смугою «Відкрити станок», список рядків порожній, «+ Додати сировину»
//       створює перше правило;
//   (г) «Куди піде результат» із ЯВНИМ вибором цільового файлу: заготовка-аналізатор лягає
//       у ВИБРАНИЙ файл, а не у той, який обрала б автоматика;
//   (д) перемикання станка НЕ втрачає обидва вибори файлу (знахідка №4 капстоуна).
// Steam64 адміна ЗАМІНЕНО плейсхолдером ЩЕ ПРИ ЗБИРАННІ фікстури (прецедент витоку W1),
// guard нижче звіряє весь DOM.
// Запуск: `node tests/tools/t4-6-shoot.mjs` (vite preview на :4173 має обслуговувати
// АКТУАЛЬНИЙ dist).
import { zipSync, unzipSync } from 'fflate'
import { spawn } from 'child_process'
import { writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = process.env.T4_6_SHOOT_OUT || 'E:/TMP/claude/E--dayzmod/ef2600b9-21a8-43d6-8043-cf5a4904c3ec/scratchpad'
const DOWNLOAD_DIR = join(OUT, 't4-6-downloads')
const PORT = 9352
const URL = 'http://localhost:4173/'
const DIST = 'E:/dayzmod/webeditor/dist'
const STAND = 'E:/dayzmod/testserver/profiles/ZP_Research'
const PLACEHOLDER = '76561190000000000'
const FIXTURE = 't4-6-stand.zip'
const DOOMED = 'ProcessingRules/peresbir_mikroskop.json' // 3 правила — саме їх перелічує гард
const LINK_TARGET = 'ProcessingRules/peresbir_mikroskop.json' // явний вибір у сценарії (г)

mkdirSync(OUT, { recursive: true })
rmSync(DOWNLOAD_DIR, { recursive: true, force: true })
mkdirSync(DOWNLOAD_DIR, { recursive: true })

// ---- Фікстура: живі стендові файли; Steam64 у Settings.json -> плейсхолдер ------------------
const settingsDoc = JSON.parse(readFileSync(join(STAND, 'Settings.json'), 'utf8'))
if (!Array.isArray(settingsDoc.AdminIds) || settingsDoc.AdminIds.length !== 1) {
  throw new Error('стендовий Settings.json зсунувся: чекав рівно 1 AdminId, є ' + JSON.stringify(settingsDoc.AdminIds))
}
settingsDoc.AdminIds = [PLACEHOLDER]

const raw = (name) => new Uint8Array(readFileSync(join(STAND, name)))
const enc = (o) => new TextEncoder().encode(JSON.stringify(o, null, 4))

const standFiles = {
  'Settings.json': enc(settingsDoc),
  'Factions.json': raw('Factions.json'),
  'PointTypes.json': raw('PointTypes.json'),
  'DataItems.json': raw('DataItems.json'),
  'SampleTypes.json': raw('SampleTypes.json'),
  'Modules.json': raw('Modules.json'),
}
for (const f of readdirSync(join(STAND, 'ProcessingRules'))) standFiles[`ProcessingRules/${f}`] = raw(`ProcessingRules/${f}`)
for (const f of readdirSync(join(STAND, 'TechTree'))) standFiles[`TechTree/${f}`] = raw(`TechTree/${f}`)
const STAND_PATHS = Object.keys(standFiles)
if (!STAND_PATHS.includes(DOOMED)) throw new Error(`стенд зсунувся: файлу ${DOOMED} немає`)

// Фікстура не лишається в dist НІ ЗА ЯКОГО ВИХОДУ (конвенція t4-5: генерується скриптом,
// не комітиться) — прибиральник висить і на process.on('exit'), щоб падіння ассерта теж чистило.
function cleanupFixtures() {
  rmSync(join(DIST, FIXTURE), { force: true })
}
process.on('exit', cleanupFixtures)

writeFileSync(join(DIST, FIXTURE), zipSync(standFiles))
console.log('фікстуру зібрано:', STAND_PATHS.length, 'файлів стенду')

// ---- headless Chrome + сирий CDP -------------------------------------------------------------
const profile = mkdtempSync(join(tmpdir(), 't46shoot-'))
const chrome = spawn(
  CHROME,
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1680,1400', '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank'],
  { stdio: 'ignore' },
)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = JSON.stringify

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
for (let i = 0; i < 60; i++) {
  const ready = await evalJs(`!!document.getElementById('import-zip-input')`)
  if (ready) break
  await sleep(400)
  if (i === 59) throw new Error('сторінка не завантажилась: #import-zip-input так і не зʼявився')
}

// ---- Спільні хелпери (перенесені з capstone-rebuild.mjs) -------------------------------------
await evalJs(`window.__t = {
  setValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  },
}; true`)

async function importZip(name) {
  await evalJs(`(async () => {
    const res = await fetch(${J(URL + name)})
    const buf = await res.arrayBuffer()
    const dt = new DataTransfer()
    dt.items.add(new File([buf], ${J(name)}, { type: 'application/zip' }))
    const input = document.getElementById('import-zip-input')
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(1100)
}
async function clickTab(label) {
  await evalJs(`[...document.querySelectorAll('.tab-button')].find((b) => b.textContent.trim() === ${J(label)}).click()`)
  await sleep(600)
}
async function setVal(sel, value) {
  const ok = await evalJs(`(() => {
    const el = document.querySelector(${J(sel)})
    if (!el) return false
    window.__t.setValue(el, ${J(value)})
    return true
  })()`)
  if (!ok) throw new Error(`немає поля ${sel}`)
  await sleep(150)
}
async function fieldValue(sel) {
  return evalJs(`document.querySelector(${J(sel)})?.value ?? null`)
}
// ZpSelect: набрати запит і клікнути (mousedown) опцію, чий label АБО hint дорівнює want,
// або чий hint ПОЧИНАЄТЬСЯ з want (опції станків несуть hint "<клас> · <джерело>").
async function pick(sel, query, want) {
  await evalJs(`document.querySelector(${J(sel)}).focus()`)
  await setVal(sel, query)
  await sleep(450)
  const picked = await evalJs(`(() => {
    const opts = [...document.querySelectorAll('.zp-select-option')]
    const target = opts.find((o) => {
      const label = o.querySelector('.zp-select-option-label')?.textContent?.trim() ?? ''
      const hint = o.querySelector('.zp-select-option-hint')?.textContent?.trim() ?? ''
      return label === ${J(want)} || hint === ${J(want)} || hint.startsWith(${J(want)} + ' \\u00b7')
    })
    if (!target) return { ok: false, seen: opts.map((o) => o.textContent.trim()).slice(0, 8) }
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    return { ok: true }
  })()`)
  if (!picked.ok) throw new Error(`ZpSelect ${sel}: опції '${want}' немає за запитом '${query}'; бачив: ${J(picked.seen)}`)
  await sleep(500)
}
async function clickByText(scopeSel, text) {
  const found = await evalJs(`(() => {
    const scope = ${scopeSel === null ? 'document' : `document.querySelector(${J(scopeSel)})`}
    if (!scope) return false
    const btn = [...scope.querySelectorAll('button')].find((b) => b.textContent.includes(${J(text)}))
    if (!btn) return false
    btn.click()
    return true
  })()`)
  if (!found) throw new Error(`кнопка '${text}' у '${scopeSel ?? 'document'}' не знайдена`)
  await sleep(400)
}
async function selectFileRow(path) {
  const ok = await evalJs(`(() => {
    const btn = [...document.querySelectorAll('.file-list .row-select')].find((b) => b.textContent.trim() === ${J(path)})
    if (!btn) return false
    btn.click()
    return true
  })()`)
  if (!ok) throw new Error(`рядка '${path}' немає в реєстрі файлів`)
  await sleep(350)
}
async function fileRows() {
  return evalJs(`[...document.querySelectorAll('.file-list .row-select')].map((b) => b.textContent.trim())`)
}
async function statusText() {
  return evalJs(`[...document.querySelectorAll('.indicator')].map((p) => p.textContent.trim()).join(' | ')`)
}

await importZip(FIXTURE)
const leak = await evalJs(`document.body.innerHTML.includes('76561198')`)
if (leak) throw new Error('ВИТІК: у DOM знайдено справжній Steam64-префікс стенда!')

// ---- (б) Одиночний конфіг видалити НЕ можна ---------------------------------------------------
await clickTab('Файли')
await selectFileRow('Settings.json')
const singleGuard = await evalJs(`(() => ({
  button: !!document.getElementById('file-delete-button'),
  blocked: document.querySelector('.file-delete-blocked')?.textContent?.trim() ?? null,
}))()`)
console.log('(б) одиночний конфіг:', JSON.stringify(singleGuard))
if (singleGuard.button) throw new Error('у Settings.json не мусить бути кнопки видалення')
if (!singleGuard.blocked || !singleGuard.blocked.includes('сервер')) {
  throw new Error('пояснення, чому одиночний конфіг не видаляється, відсутнє: ' + singleGuard.blocked)
}
await shot('t4-6-b-single-config-blocked.png')

// ---- (а) Видалення файлу правил ---------------------------------------------------------------
await selectFileRow(DOOMED)
const guard = await evalJs(`(() => ({
  button: document.getElementById('file-delete-button')?.textContent?.trim() ?? null,
  guard: document.querySelector('.file-delete-guard')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
}))()`)
console.log('(а) гард:', JSON.stringify(guard))
if (guard.button !== '× Видалити файл') throw new Error('кнопка видалення не в спокійному стані: ' + guard.button)
if (!guard.guard || !guard.guard.includes('3 правила')) throw new Error('гард не перелічив вміст файлу: ' + guard.guard)
await shot('t4-6-a1-delete-guard.png')

// перше натискання ЛИШЕ взводить
await evalJs(`document.getElementById('file-delete-button').click()`)
await sleep(300)
const armed = await evalJs(`document.getElementById('file-delete-button')?.textContent?.trim() ?? null`)
console.log('(а) після першого натискання:', armed)
if (!armed || !armed.includes('Натисніть ще раз')) throw new Error('перше натискання мало лише взвести кнопку: ' + armed)
const stillThere = await fileRows()
if (!stillThere.includes(DOOMED)) throw new Error('файл зник ще до підтвердження!')
await shot('t4-6-a2-delete-armed.png')

// друге натискання видаляє
await evalJs(`document.getElementById('file-delete-button').click()`)
await sleep(400)
const afterDelete = await fileRows()
console.log('(а) реєстр після видалення:', afterDelete.length, 'файлів')
if (afterDelete.includes(DOOMED)) throw new Error('файл лишився в реєстрі після підтвердження')
if (afterDelete.length !== STAND_PATHS.length - 1) throw new Error(`очікував ${STAND_PATHS.length - 1} рядків, є ${afterDelete.length}`)
const saveEnabled = await evalJs(`![...document.querySelectorAll('button')].find((b) => b.textContent.includes('Зберегти зміни')).disabled`)
if (!saveEnabled) throw new Error('«Зберегти зміни» заблоковано — видалення не доїхало б до сховища')
await shot('t4-6-a3-deleted.png')

await clickByText(null, 'Зберегти зміни')
await sleep(500)
const saveStatus = await statusText()
console.log('(а) статус збереження:', saveStatus)
if (!saveStatus.includes('Видалено файлів: 1')) throw new Error('статус не повідомив про видалення: ' + saveStatus)

const before = new Set(existsSync(DOWNLOAD_DIR) ? readdirSync(DOWNLOAD_DIR) : [])
await clickByText(null, 'Завантажити ZIP')
let downloaded
for (let i = 0; i < 50; i++) {
  await sleep(200)
  const names = existsSync(DOWNLOAD_DIR) ? readdirSync(DOWNLOAD_DIR) : []
  const fresh = names.find((n) => !before.has(n) && n.endsWith('.zip'))
  if (fresh) {
    downloaded = fresh
    break
  }
}
if (!downloaded) throw new Error('ZIP не завантажився протягом очікування')
const exported = Object.keys(unzipSync(new Uint8Array(readFileSync(join(DOWNLOAD_DIR, downloaded))))).filter((p) => !p.endsWith('/'))
console.log('(а) в експорті:', exported.length, 'файлів')
if (exported.includes(DOOMED)) throw new Error('видалений файл усе одно потрапив в експорт!')
for (const p of STAND_PATHS) {
  if (p === DOOMED) continue
  if (!exported.includes(p)) throw new Error(`експорт втратив сторонній файл ${p}`)
}

// ---- (в) Вікно станка для класу БЕЗ правил ----------------------------------------------------
await importZip(FIXTURE) // свіжий стенд: далі працюємо з повним набором правил
await clickTab('Ланцюги')
const NEW_STATION = 'ZP_PetriDishKit'
const onCanvas = await evalJs(`[...document.querySelectorAll('.station-card-class')].map((c) => c.textContent)`)
console.log('(в) станки на полотні:', JSON.stringify(onCanvas))
if (onCanvas.some((t) => t.includes(NEW_STATION))) throw new Error(`${NEW_STATION} не мав би мати картки на полотні — сценарій втратив сенс`)
await pick('#station-open-picker', NEW_STATION, NEW_STATION)
const emptyWindow = await evalJs(`(() => ({
  open: !!document.querySelector('.station-window'),
  cls: document.querySelector('.station-window-class')?.textContent ?? null,
  rows: document.querySelectorAll('.station-window .station-rows > li').length,
  empty: document.querySelector('.station-window .intro')?.textContent ?? null,
  bulk: !!document.querySelector('.station-bulk'),
}))()`)
console.log('(в) порожнє вікно:', JSON.stringify(emptyWindow))
if (!emptyWindow.open || emptyWindow.cls !== NEW_STATION) throw new Error('вікно станка без правил не відкрилось: ' + JSON.stringify(emptyWindow))
if (emptyWindow.rows !== 0) throw new Error('у станка без правил не мусить бути жодного рядка')
if (!emptyWindow.empty || !emptyWindow.empty.includes('ще немає жодного правила')) throw new Error('порожній стан вікна не пояснений: ' + emptyWindow.empty)
if (!emptyWindow.bulk) throw new Error('блок «+ Додати сировину» недоступний')
await shot('t4-6-c1-empty-station.png')

await pick('#sw-raw-picker', 'Apple', 'Apple')
await evalJs(`(() => {
  const btn = document.querySelector('.station-bulk button.primary')
  if (!btn || btn.disabled) throw new Error('кнопка «створити N рядків» недоступна')
  btn.click()
})()`)
await sleep(700)
const afterStub = await evalJs(`(() => ({
  rows: [...document.querySelectorAll('.station-window .station-rows > li .station-row-class')].map((c) => c.textContent),
  message: document.querySelector('.station-window .indicator')?.textContent?.trim() ?? null,
}))()`)
console.log('(в) після масового додавання:', JSON.stringify(afterStub))
if (afterStub.rows.length !== 1 || afterStub.rows[0] !== 'Apple') throw new Error('перше правило станка не створилось: ' + JSON.stringify(afterStub))
await shot('t4-6-c2-first-rule.png')

// ---- (г) «Куди піде результат» із явним цільовим файлом ----------------------------------------
await pick('#sw-station-picker', 'ZP_SampleFridge', 'ZP_SampleFridge')
await evalJs(`(() => {
  const rows = [...document.querySelectorAll('.station-window .station-rows > li')]
  const row = rows.find((r) => r.textContent.includes('pb_pak_bio')) ?? rows[0]
  row.querySelector('.station-row-head').click()
})()`)
await sleep(700)
const expandedId = await fieldValue('#rp-id')
console.log('(г) розгорнуте правило:', expandedId)
if (!expandedId) throw new Error('форма правила не розгорнулась')
// Автоматика поклала б заготовку у файл рядка-джерела (у ZP_ChemBench правил немає) —
// явний вибір мусить перемогти.
await pick('.station-link-file .zp-select-input', 'peresbir_mikroskop', LINK_TARGET)
const pickedLink = await fieldValue('.station-link-file .zp-select-input')
if (pickedLink !== LINK_TARGET) throw new Error('цільовий файл заготовки не обрався: ' + pickedLink)
await shot('t4-6-d1-link-file-picked.png')

await pick('.station-link-row .zp-select-input', 'ZP_ChemBench', 'ZP_ChemBench')
const linkMsg = await evalJs(`document.querySelector('.station-window .indicator')?.textContent?.trim() ?? null`)
console.log('(г) повідомлення звʼязування:', linkMsg)
if (!linkMsg || !linkMsg.includes('Створено заготовку-аналізатор')) throw new Error('заготовка-аналізатор не створилась: ' + linkMsg)
if (!linkMsg.includes(LINK_TARGET)) throw new Error('заготовка лягла НЕ у вибраний файл: ' + linkMsg)
await shot('t4-6-d2-link-created.png')

// Файл, у який лягла заготовка, мусить бути позначений як змінений саме він.
await clickTab('Файли')
const dirtyFiles = await evalJs(`[...document.querySelectorAll('.file-list tbody tr')].filter((tr) => tr.querySelector('.dirty-badge')).map((tr) => tr.querySelector('.row-select').textContent.trim())`)
console.log('(г) змінені файли:', JSON.stringify(dirtyFiles))
if (!dirtyFiles.includes(LINK_TARGET)) throw new Error('обраний файл не позначений зміненим: ' + JSON.stringify(dirtyFiles))
await clickTab('Ланцюги')

// ---- (д) Перемикання станка не втрачає обидва вибори файлу -------------------------------------
await pick('#sw-target-file', 'peresbir_mikroskop', LINK_TARGET)
const beforeSwitch = await fieldValue('#sw-target-file')
if (beforeSwitch !== LINK_TARGET) throw new Error('цільовий файл нових правил не обрався: ' + beforeSwitch)
await pick('#sw-station-picker', 'ZP_Microscope', 'ZP_Microscope')
const afterSwitch = await evalJs(`(() => ({
  station: document.querySelector('.station-window-class')?.textContent ?? null,
  target: document.getElementById('sw-target-file')?.value ?? null,
}))()`)
console.log('(д) після перемикання станка:', JSON.stringify(afterSwitch))
if (afterSwitch.station !== 'ZP_Microscope') throw new Error('станок не перемкнувся: ' + afterSwitch.station)
if (afterSwitch.target !== LINK_TARGET) throw new Error('вибір файлу для нових правил втрачено при перемиканні: ' + afterSwitch.target)
// Другий вибір (файл заготовки-аналізатора) теж мусить пережити перемикання.
await evalJs(`(() => {
  const row = document.querySelector('.station-window .station-rows > li')
  row.querySelector('.station-row-head').click()
})()`)
await sleep(700)
const linkKept = await fieldValue('.station-link-file .zp-select-input')
console.log('(д) вибір файлу заготовки після перемикання:', linkKept)
if (linkKept !== LINK_TARGET) throw new Error('вибір файлу заготовки втрачено при перемиканні: ' + linkKept)
await shot('t4-6-e-picks-kept.png')

console.log('консольні помилки за сесію:', consoleErrors.length, consoleErrors)
if (consoleErrors.length > 0) throw new Error('консольні помилки в сесії: ' + consoleErrors.join(' | '))
ws.close()
chrome.kill()
cleanupFixtures()
console.log('готово')
