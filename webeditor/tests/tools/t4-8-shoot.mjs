// Смоук закривної хвилі W4 (Important 1 фінального ревʼю гілки): ХИБНЕ ЗЕЛЕНЕ, яке
// редактор створював ВЛАСНОЮ кнопкою «+ Додати». Прогін живим headless Chrome по сирому
// CDP — той самий харнес, що t4-4/t4-5/capstone-rebuild.
//
// Сценарій (на РЕАЛЬНИХ конфігах стенду, диск НЕ змінюється — усе через ZIP-фікстуру):
//   (а) станок ZP_SampleFridge, правило pb_pak_bio: рядок ЗЕЛЕНИЙ, повідомлень немає;
//   (б) один клік «+ Додати» під «Потрібні інструменти» -> alarm РІВНО на новому рядку
//       списку, лампа рядка станка гасне (правило перестає бути «налаштованим»);
//   (в) «Баланс»: те саме правило позначене мертвим із причиною (спільний гейт);
//   (г) кнопка «×» прибирає рядок -> усе повертається в зелене (ремонт у два кліки).
//
// Запуск: node tests/tools/t4-8-shoot.mjs   (потрібен `npm run build` і `npx vite preview`)

import { zipSync } from 'fflate'
import { spawn } from 'child_process'
import { writeFileSync, readFileSync, mkdirSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = process.env.T4_8_SHOOT_OUT || 'E:/TMP/claude/E--dayzmod/ef2600b9-21a8-43d6-8043-cf5a4904c3ec/scratchpad'
const PORT = 9352
const URL = 'http://localhost:4173/'
const DIST = 'E:/dayzmod/webeditor/dist'
const STAND = 'E:/dayzmod/testserver/profiles/ZP_Research'
const PLACEHOLDER = '76561190000000000'
const J = JSON.stringify

mkdirSync(OUT, { recursive: true })

// ---- Фікстура: живі стендові файли (Steam64 -> плейсхолдер, прецедент t4-4) -------------------
const settingsDoc = JSON.parse(readFileSync(join(STAND, 'Settings.json'), 'utf8'))
settingsDoc.AdminIds = [PLACEHOLDER]
const rd = (p) => new Uint8Array(readFileSync(join(STAND, p)))
writeFileSync(
  join(DIST, 't4-8.zip'),
  zipSync({
    'Settings.json': new TextEncoder().encode(JSON.stringify(settingsDoc, null, 4)),
    'Factions.json': rd('Factions.json'),
    'PointTypes.json': rd('PointTypes.json'),
    'DataItems.json': rd('DataItems.json'),
    'SampleTypes.json': rd('SampleTypes.json'),
    'Modules.json': rd('Modules.json'),
    'ProcessingRules/peresbir_lanciuhy.json': rd('ProcessingRules/peresbir_lanciuhy.json'),
    'ProcessingRules/peresbir_mikroskop.json': rd('ProcessingRules/peresbir_mikroskop.json'),
    'TechTree/peresbir_nauka.json': rd('TechTree/peresbir_nauka.json'),
    'TechTree/peresbir_nebo.json': rd('TechTree/peresbir_nebo.json'),
    'TechTree/peresbir_varta.json': rd('TechTree/peresbir_varta.json'),
  }),
)

const profile = mkdtempSync(join(tmpdir(), 't48shoot-'))
spawn(
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
  const r = await send('Page.captureScreenshot', { format: 'png' })
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
  const res = await fetch(${J(URL)} + 't4-8.zip')
  const buf = await res.arrayBuffer()
  const dt = new DataTransfer()
  dt.items.add(new File([buf], 't4-8.zip', { type: 'application/zip' }))
  const input = document.getElementById('import-zip-input')
  input.files = dt.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
})()`)
await sleep(1200)

async function switchTab(label) {
  await evalJs(`[...document.querySelectorAll('.tab-button')].find((b) => b.textContent.trim() === ${J(label)}).click()`)
  await sleep(600)
}

// ---- (0) знімок «Балансу» ДО правки: він же контрольна точка для (в) ------------------------
async function balanceText() {
  return evalJs(`document.getElementById('tabpanel-balance')?.textContent ?? ''`)
}
await switchTab('Баланс')
const balanceBefore = await balanceText()
if (balanceBefore.length < 1000) throw new Error('«Баланс» не наповнився: ' + balanceBefore.length)

// ---- (а) базовий стан: правило стенду ЗЕЛЕНЕ -------------------------------------------------
await switchTab('Ланцюги')
const opened = await evalJs(`(() => {
  const node = [...document.querySelectorAll('.station-card')].find((n) => n.querySelector('.station-card-class')?.textContent.includes('ZP_SampleFridge'))
  if (!node) return false
  node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  return true
})()`)
if (!opened) throw new Error('картка станка ZP_SampleFridge не знайдена')
await sleep(700)

// Рядок станка НЕ несе Id правила в заголовку (там сировина -> результат), тож
// ідентичність рядка беремо позиційно й ПІДТВЕРДЖУЄМО через #rp-id розгорнутої форми —
// той самий прийом, що expandRow у capstone-rebuild.mjs.
const ROW = 0 // pb_pak_bio (Apple -> Біозразок) у вікні ZP_SampleFridge
async function rowState() {
  return evalJs(`(() => {
    const row = document.querySelectorAll('.station-row')[${ROW}]
    if (!row) return null
    const head = row.querySelector('.station-row-head')
    return {
      lampOk: !!head.querySelector('.lamp-ok'),
      lampAlarm: !!head.querySelector('.lamp-alarm'),
      alarms: [...row.querySelectorAll('.field-message-alarm')].map((p) => p.textContent.trim()),
    }
  })()`)
}

// розгорнути рядок pb_pak_bio
await evalJs(`document.querySelectorAll('.station-row')[${ROW}].querySelector('.station-row-head').click()`)
await sleep(600)
const idNow = await evalJs(`document.querySelector('#rp-id')?.value ?? null`)
if (idNow !== 'pb_pak_bio') throw new Error('розгорнулось не те правило: ' + idNow)
const before = await rowState()
console.log('(а) до правки:', J(before))
if (before.alarms.length !== 0) throw new Error('стендове правило вже мало тривоги: ' + J(before.alarms))
if (!before.lampOk) throw new Error('стендове правило не було зеленим ще до правки')
await shot('t4-8-a-clean.png')

// ---- (б) один клік «+ Додати» під «Потрібні інструменти» --------------------------------------
const clicked = await evalJs(`(() => {
  const groups = [...document.querySelectorAll('.station-row-body .rule-field')]
  const g = groups.find((f) => f.querySelector('.field-label')?.textContent.includes('Потрібні інструменти'))
  if (!g) return false
  g.querySelector('.rule-array-add').click()
  return true
})()`)
if (!clicked) throw new Error('кнопки «+ Додати» під RequiredTools не знайдено')
await sleep(700)

const after = await evalJs(`(() => {
  const groups = [...document.querySelectorAll('.station-row-body .rule-field')]
  const g = groups.find((f) => f.querySelector('.field-label')?.textContent.includes('Потрібні інструменти'))
  const row = document.querySelectorAll('.station-row')[${ROW}]
  return {
    itemAlarms: g ? [...g.querySelectorAll('.field-message-alarm')].map((p) => p.textContent.trim()) : [],
    lampOk: !!row?.querySelector('.station-row-head .lamp-ok'),
  }
})()`)
console.log('(б) після «+ Додати»:', J(after))
if (after.itemAlarms.length !== 1) throw new Error('чекав РІВНО один alarm на новому рядку списку, є ' + J(after.itemAlarms))
if (!/порожній елемент/.test(after.itemAlarms[0])) throw new Error('текст alarm не той: ' + after.itemAlarms[0])
if (after.lampOk) throw new Error('лампа рядка станка лишилась зеленою — саме це й було хибне зелене')
await shot('t4-8-b-alarm.png')

// ---- (в) «Баланс»: спільний гейт побачив ту саму смерть правила ------------------------------
// pb_pak_bio — ПАКУВАЛЬНИК: він не виробляє заготовку напряму, тому в «Балансі» його смерть
// видно транзитивно (computeSupply) — рядок вартості bio_field_t1 перестає бути живим
// видобутком і стає «умовно: вхідний зразок не пакує жодне доступне фракції правило».
// Саме це й доводить, що гейт «Балансу» і лампа станка живляться ОДНИМ дзеркалом.
await switchTab('Баланс')
const balanceAfter = await balanceText()
const PHRASE = 'вхідний зразок не пакує жодне доступне фракції правило'
console.log('(в) Баланс: змінився =', balanceAfter !== balanceBefore, '| фраза до =', balanceBefore.includes(PHRASE), '| після =', balanceAfter.includes(PHRASE))
if (balanceAfter === balanceBefore) throw new Error('«Баланс» не помітив смерті правила — спільний гейт розійшовся з панеллю')
if (balanceBefore.includes(PHRASE)) throw new Error('контрольна фраза була в «Балансі» ще ДО правки — тест недискримінаційний')
if (!balanceAfter.includes(PHRASE)) throw new Error('«Баланс» не показав наслідок мертвого пакувальника')
await shot('t4-8-c-balance.png')

// ---- (г) ремонт: прибрати рядок «×» ----------------------------------------------------------
await switchTab('Ланцюги')
await sleep(500)
// Перемикання вкладок згортає вікно станка — відкриваємо й розгортаємо рядок наново
// (стан вікна не переживає розмонтування вкладки; для смоука це не дефект, а факт UI).
await evalJs(`(() => {
  if (document.querySelector('.station-window')) return true
  const node = [...document.querySelectorAll('.station-card')].find((n) => n.querySelector('.station-card-class')?.textContent.includes('ZP_SampleFridge'))
  node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  return true
})()`)
await sleep(700)
const expanded = await evalJs(`document.querySelector('#rp-id')?.value ?? null`)
if (expanded !== 'pb_pak_bio') {
  await evalJs(`document.querySelectorAll('.station-row')[${ROW}].querySelector('.station-row-head').click()`)
  await sleep(600)
}
await evalJs(`(() => {
  const groups = [...document.querySelectorAll('.station-row-body .rule-field')]
  const g = groups.find((f) => f.querySelector('.field-label')?.textContent.includes('Потрібні інструменти'))
  g.querySelector('.rule-array-remove').click()
})()`)
await sleep(700)
const repaired = await rowState()
console.log('(г) після ремонту:', J(repaired))
if (repaired.alarms.length !== 0) throw new Error('після прибирання рядка тривоги лишились: ' + J(repaired.alarms))
if (!repaired.lampOk) throw new Error('лампа не повернулась у зелене')
await shot('t4-8-d-repaired.png') // кадр знімаємо ДО перемикання вкладки, інакше він
// збігся б із кадром «Балансу» (в) — спіймано порівнянням md5 кадрів, урок ревʼю T5
await switchTab('Баланс')
const balanceRepaired = await balanceText()
if (balanceRepaired !== balanceBefore) throw new Error('«Баланс» не повернувся до вихідного стану після ремонту')

if (consoleErrors.length > 0) throw new Error('помилки в консолі: ' + J(consoleErrors))
console.log('СМОУК t4-8 ПРОЙДЕНО: хибне зелене більше не мовчить, ремонт у два кліки, консоль чиста')
process.exit(0)
