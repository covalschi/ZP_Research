// Скріншот-харнес W4 Task 4 (вкладки «Налаштування» і «Заготовки») — той самий прийом
// headless Chrome + сирий CDP, що t4-3-shoot.mjs (жорсткі console-assert збережено).
// Сценарії брифа:
//   (а) живий стендовий Settings.json (Steam64 адміна ЗАМІНЕНО плейсхолдером
//       76561190000000000 ЩЕ ПРИ ЗБИРАННІ фікстури — прецедент витоку W1: справжній Id не
//       сміє потрапити ні у фікстуру, ні в скріншот; guard нижче звіряє весь DOM) — усі
//       сім полів форми показують реальні значення файлу;
//   (б) правка TreeVisibilityDepth IntField-ом за межу [0..10] -> warn-дзеркало біля поля
//       (Validate :59-60), збереження НЕ блокується (Settings warn-only);
//   (в) AdminIds: кривий рядок -> warn «не схоже на Steam64» біля рядка;
//   (г) вкладка «Заготовки»: 90 рядків родини ZP_Data_Base, фільтр-пошук, відкриття запису,
//       правка імені живо відбивається у списку; лампи налаштовано/вимкнено/не налаштовано.
// Запуск: `node tests/tools/t4-4-shoot.mjs` (vite preview на :4173 має працювати).
import { zipSync } from 'fflate'
import { spawn } from 'child_process'
import { writeFileSync, readFileSync, mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = process.env.T4_4_SHOOT_OUT || 'E:/TMP/claude/E--dayzmod/ef2600b9-21a8-43d6-8043-cf5a4904c3ec/scratchpad'
const PORT = 9349
const URL = 'http://localhost:4173/'
const DIST = 'E:/dayzmod/webeditor/dist'
const STAND = 'E:/dayzmod/testserver/profiles/ZP_Research'
const PLACEHOLDER = '76561190000000000'

mkdirSync(OUT, { recursive: true })

// ---- Фікстура: живі стендові файли; Steam64 у Settings.json -> плейсхолдер ---------------------
const settingsDoc = JSON.parse(readFileSync(join(STAND, 'Settings.json'), 'utf8'))
if (!Array.isArray(settingsDoc.AdminIds) || settingsDoc.AdminIds.length !== 1) {
  throw new Error('стендовий Settings.json зсунувся: чекав рівно 1 AdminId, є ' + JSON.stringify(settingsDoc.AdminIds))
}
if (settingsDoc.TreeVisibilityDepth !== 2 || settingsDoc.TreeTerminalClasses.join() !== 'ZP_LabComputer') {
  throw new Error('стендовий Settings.json зсунувся: depth/terminals не 2/ZP_LabComputer')
}
settingsDoc.AdminIds = [PLACEHOLDER] // справжній Steam64 НЕ протягується у фікстуру (прецедент W1)
const enc = (o) => new TextEncoder().encode(JSON.stringify(o, null, 4))
writeFileSync(
  join(DIST, 't4-4a.zip'),
  zipSync({
    'Settings.json': enc(settingsDoc),
    'Factions.json': new Uint8Array(readFileSync(join(STAND, 'Factions.json'))),
    'PointTypes.json': new Uint8Array(readFileSync(join(STAND, 'PointTypes.json'))),
    'DataItems.json': new Uint8Array(readFileSync(join(STAND, 'DataItems.json'))),
  }),
)
console.log('фікстуру зібрано: стендові Settings (Steam64 -> плейсхолдер) + Factions + PointTypes + DataItems')

// ---- headless Chrome + сирий CDP -------------------------------------------------------------
const profile = mkdtempSync(join(tmpdir(), 't44shoot-'))
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
for (let i = 0; i < 60; i++) {
  const ready = await evalJs(`!!document.getElementById('import-zip-input')`)
  if (ready) break
  await sleep(400)
  if (i === 59) throw new Error('сторінка не завантажилась: #import-zip-input так і не зʼявився')
}

// Спільні дрібниці харнеса ---------------------------------------------------------------------
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
  await sleep(800)
}
// React-контрольований input: нативний сеттер + подія input (прийом t26-4/t9)
async function setInput(elementId, value) {
  await evalJs(`(() => {
    const el = document.getElementById(${JSON.stringify(elementId)})
    if (!el) throw new Error('немає поля #' + ${JSON.stringify(elementId)})
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, ${JSON.stringify(value)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
}
// Квірк headless Chrome (урок T9/T8): el.blur() НЕ породжує focusout, на якому тримається
// React onBlur — буферні поля (IntField) комітять САМЕ на blur, тож подія диспатчиться явно.
async function blurField(elementId) {
  await evalJs(`(() => {
    const el = document.getElementById(${JSON.stringify(elementId)})
    if (!el) throw new Error('немає поля #' + ${JSON.stringify(elementId)})
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })()`)
}
async function clickTab(label) {
  await evalJs(`[...document.querySelectorAll('.tab-button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)}).click()`)
  await sleep(500)
}
async function clickRow(codeText) {
  const found = await evalJs(`(() => {
    const btn = [...document.querySelectorAll('table.entity-table .row-select')].find((b) => b.querySelector('code')?.textContent === ${JSON.stringify(codeText)})
    if (!btn) return false
    btn.click()
    return true
  })()`)
  if (!found) throw new Error('рядка з кодом не знайдено: ' + codeText)
  await sleep(300)
}

// ---- (а) Налаштування: усі поля з реальними значеннями стенда --------------------------------
await importZip('t4-4a.zip')
await clickTab('Налаштування')

const stateA = await evalJs(`(() => {
  const panel = document.getElementById('tabpanel-settings')
  const arrays = panel ? [...panel.querySelectorAll('.rule-array')] : []
  return {
    configVersion: panel?.querySelector('.field-readonly code')?.textContent ?? null,
    debug: document.getElementById('set-debug')?.checked ?? null,
    adminId0: document.getElementById('set-adminid-0')?.value ?? null,
    adminRows: arrays[0] ? arrays[0].querySelectorAll('input.field-input').length : null,
    defaultFaction: document.getElementById('set-defaultfaction')?.value ?? null,
    terminal0: arrays[1]?.querySelector('.zp-select-input')?.value ?? null,
    treedepth: document.getElementById('set-treedepth')?.value ?? null,
    treebg: document.getElementById('set-treebg')?.value ?? null,
    fieldMessages: panel ? panel.querySelectorAll('.field-message').length : null,
  }
})()`)
console.log('налаштування А:', JSON.stringify(stateA))
if (stateA.configVersion !== '1') throw new Error('ConfigVersion: ' + stateA.configVersion)
if (stateA.debug !== true) throw new Error('DebugMode мав бути увімкнений (стенд: 1): ' + stateA.debug)
if (stateA.adminId0 !== PLACEHOLDER) throw new Error('AdminIds[0] не плейсхолдер: ' + stateA.adminId0)
if (stateA.adminRows !== 1) throw new Error('чекав 1 рядок AdminIds, є ' + stateA.adminRows)
if (stateA.defaultFaction !== 'default') throw new Error('DefaultFaction: ' + stateA.defaultFaction)
if (stateA.terminal0 !== 'ZP_LabComputer') throw new Error('TreeTerminalClasses[0]: ' + stateA.terminal0)
if (stateA.treedepth !== '2') throw new Error('TreeVisibilityDepth: ' + stateA.treedepth)
if (stateA.treebg !== 'gui/textures/dlc_panel_livonia.edds') throw new Error('TreeBackgroundImage: ' + stateA.treebg)
if (stateA.fieldMessages !== 0) throw new Error('на чистому стендовому конфігу не мало бути повідомлень, є ' + stateA.fieldMessages)

// Guard витоку: справжнього Steam64 стенда немає НІДЕ в DOM (фікстура зібрана з плейсхолдером)
const leak = await evalJs(`document.body.innerHTML.includes('76561198')`)
if (leak) throw new Error('ВИТІК: у DOM знайдено справжній Steam64-префікс стенда!')
await shot('t4-4-a-settings.png')

// ---- (б) TreeVisibilityDepth = 15 -> warn-дзеркало [0..10], збереження НЕ блокується ----------
await setInput('set-treedepth', '15')
await blurField('set-treedepth')
await sleep(300)
const stateB = await evalJs(`(() => {
  const panel = document.getElementById('tabpanel-settings')
  const save = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Зберегти зміни'))
  return {
    value: document.getElementById('set-treedepth')?.value ?? null,
    warns: panel ? [...panel.querySelectorAll('.field-message-warn')].map((m) => m.textContent) : [],
    alarms: panel ? panel.querySelectorAll('.field-message-alarm').length : null,
    saveDisabled: save?.disabled ?? null,
  }
})()`)
console.log('після treedepth=15:', JSON.stringify(stateB))
if (stateB.value !== '15') throw new Error('поле depth після коміту: ' + stateB.value)
if (!stateB.warns.some((m) => m.includes('TreeVisibilityDepth') && m.includes('[0..10]'))) throw new Error('немає warn-дзеркала depth: ' + JSON.stringify(stateB.warns))
if (stateB.alarms !== 0) throw new Error('Settings warn-only, alarm бути не може: ' + stateB.alarms)
if (stateB.saveDisabled !== false) throw new Error('збереження НЕ мало блокуватись (Settings warn-only, файл dirty)')
await shot('t4-4-b-treedepth-warn.png')

// ---- (в) AdminIds: кривий рядок -> warn «не схоже на Steam64» --------------------------------
await setInput('set-adminid-0', '12345')
await sleep(300)
const stateC = await evalJs(`(() => {
  const panel = document.getElementById('tabpanel-settings')
  return {
    value: document.getElementById('set-adminid-0')?.value ?? null,
    warns: panel ? [...panel.querySelectorAll('.field-message-warn')].map((m) => m.textContent) : [],
  }
})()`)
console.log('після кривого AdminId:', JSON.stringify(stateC))
if (stateC.value !== '12345') throw new Error('поле AdminIds[0] після вводу: ' + stateC.value)
if (!stateC.warns.some((m) => m.includes('Steam64') && m.includes('12345'))) throw new Error('немає warn «не схоже на Steam64»: ' + JSON.stringify(stateC.warns))
await shot('t4-4-c-adminid-warn.png')

// ---- (г) Заготовки: 90 рядків, лампи, фільтр, правка імені живо -------------------------------
await clickTab('Заготовки')
const stateD = await evalJs(`(() => {
  const rows = [...document.querySelectorAll('table.entity-table tbody tr')]
  const cell = (cls) => {
    const r = rows.find((x) => x.querySelector('.row-select code')?.textContent === cls)
    if (!r) return null
    const tds = [...r.querySelectorAll('td')]
    return { name: tds[1]?.textContent ?? '', points: tds[2]?.textContent ?? '', lamp: tds[3]?.querySelector('.lamp')?.className ?? '' }
  }
  return { rowCount: rows.length, d01: cell('ZP_Data_01'), d02: cell('ZP_Data_02'), d77: cell('ZP_Data_77') }
})()`)
console.log('заготовки:', JSON.stringify(stateD))
if (stateD.rowCount !== 90) throw new Error('чекав 90 рядків родини ZP_Data_Base, є ' + stateD.rowCount)
if (stateD.d01.name !== 'Зразок тканини химери (перейменовано наживо)') throw new Error('назва ZP_Data_01: ' + stateD.d01.name)
if (stateD.d01.points !== 'bio_field_t1×5') throw new Error('бали ZP_Data_01: ' + stateD.d01.points)
if (!stateD.d01.lamp.includes('lamp-ok')) throw new Error('лампа ZP_Data_01 мала бути ok (налаштовано+увімкнено): ' + stateD.d01.lamp)
if (!stateD.d02.name.includes('не налаштовано')) throw new Error('ZP_Data_02 мав бути «не налаштовано»: ' + stateD.d02.name)
if (stateD.d02.lamp !== '') throw new Error('у неналаштованого рядка лампи немає: ' + stateD.d02.lamp)
if (!stateD.d77.lamp.includes('lamp-ok')) throw new Error('лампа ZP_Data_77: ' + stateD.d77.lamp)
await shot('t4-4-d-dataitems.png')

// Фільтр-пошук: за підрядком класнейму…
await setInput('di-filter', '_77')
await sleep(200)
const filt1 = await evalJs(`[...document.querySelectorAll('table.entity-table tbody tr .row-select code')].map((c) => c.textContent)`)
if (filt1.join() !== 'ZP_Data_77') throw new Error('фільтр _77 мав лишити рівно ZP_Data_77: ' + JSON.stringify(filt1))
// …і за підрядком налаштованої НАЗВИ (кейс-інсенситивно)
await setInput('di-filter', 'ХИМЕРИ')
await sleep(200)
const filt2 = await evalJs(`[...document.querySelectorAll('table.entity-table tbody tr .row-select code')].map((c) => c.textContent)`)
if (filt2.join() !== 'ZP_Data_01') throw new Error('фільтр ХИМЕРИ мав лишити рівно ZP_Data_01: ' + JSON.stringify(filt2))
await shot('t4-4-e-filter.png')
await setInput('di-filter', '')
await sleep(200)

// Відкриття запису + правка імені: живо відбивається у списку тим САМИМ project-станом
await clickRow('ZP_Data_01')
const panelD = await evalJs(`(() => ({
  name: document.getElementById('di-name')?.value ?? null,
  enabled: document.getElementById('di-enabled')?.checked ?? null,
  cls: document.querySelector('.entity-detail .field-readonly code')?.textContent ?? null,
}))()`)
console.log('панель ZP_Data_01:', JSON.stringify(panelD))
if (panelD.cls !== 'ZP_Data_01') throw new Error('панель не на ZP_Data_01: ' + panelD.cls)
if (panelD.name !== 'Зразок тканини химери (перейменовано наживо)') throw new Error('імʼя в панелі: ' + panelD.name)
if (panelD.enabled !== true) throw new Error('Enabled у панелі: ' + panelD.enabled)

await setInput('di-name', 'Хвости химери (W4)')
await sleep(300)
const liveName = await evalJs(`(() => {
  const r = [...document.querySelectorAll('table.entity-table tbody tr')].find((x) => x.querySelector('.row-select code')?.textContent === 'ZP_Data_01')
  return r?.querySelectorAll('td')[1]?.textContent ?? null
})()`)
if (liveName !== 'Хвости химери (W4)') throw new Error('правка імені не відбилась у списку живо: ' + liveName)

// Лампа «вимкнено»: клік по чекбоксу Enabled -> warn-лампа рядка
await evalJs(`document.getElementById('di-enabled').click()`)
await sleep(300)
const disabledLamp = await evalJs(`(() => {
  const r = [...document.querySelectorAll('table.entity-table tbody tr')].find((x) => x.querySelector('.row-select code')?.textContent === 'ZP_Data_01')
  return r?.querySelectorAll('td')[3]?.querySelector('.lamp')?.className ?? ''
})()`)
if (!disabledLamp.includes('lamp-warn')) throw new Error('лампа вимкненого запису мала бути warn: ' + disabledLamp)
await shot('t4-4-f-dataitem-edit.png')

console.log('консольні помилки за сесію:', consoleErrors.length, consoleErrors)
if (consoleErrors.length > 0) throw new Error('консольні помилки в сесії: ' + consoleErrors.join(' | '))
ws.close()
chrome.kill()
// Фікстурний zip не лишається в dist (конвенція T2: генерується скриптом, не комітиться)
rmSync(join(DIST, 't4-4a.zip'), { force: true })
console.log('готово')
