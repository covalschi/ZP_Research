// Скріншот-харнес W4 Task 3 (вкладки «Фракції» і «Модулі») — той самий прийом headless
// Chrome + сирий CDP, що t4-2-shoot.mjs (жорсткі console-assert збережено).
// Сценарії брифа:
//   (а) РЕАЛЬНІ стендові Factions.json + Modules.json — обидві вкладки рендеряться:
//       7 фракцій (лічильники нашивок/терміналів/приладів, warn-лампи чотирьох фракцій
//       без власних терміналів/приладів — WarnShared*, ZP_FactionsConfig.c:137-141/164-168),
//       3 модулі (fround-канон бонуса: 0.20000000298023225 — РІВНО той рядок, що у файлі);
//   (в) правка бонуса модуля за межу [0..2] через FloatField -> alarm «сервер ВИКИНЕ цей
//       запис» біля поля, лампа рядка alarm, збереження НЕ блокується (у модулів немає
//       project-wide гейта — рішення T1);
//   (б) фікстура з конфліктом нашивки (Armband_White у ecolog І clearsky) -> повідомлення
//       біля поля у ОБОХ фракцій (per-record дзеркало ValidateFaction :194-203), лампи alarm;
//   (г) створення фракції (дефолти схеми, alarm «немає DisplayName» одразу видно) +
//       щасливе видалення другим натисканням + ГАРД використань: фракцію 'duty' тримає
//       правило guard_rule (RequiredFactions) -> відмова з переліком, запис лишається.
// Запуск: `node tests/tools/t4-3-shoot.mjs` (vite preview на :4173 має працювати).
import { zipSync } from 'fflate'
import { spawn } from 'child_process'
import { writeFileSync, readFileSync, mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = process.env.T4_3_SHOOT_OUT || 'E:/TMP/claude/E--dayzmod/ef2600b9-21a8-43d6-8043-cf5a4904c3ec/scratchpad'
const PORT = 9348
const URL = 'http://localhost:4173/'
const DIST = 'E:/dayzmod/webeditor/dist'
const STAND_FACTIONS = 'E:/dayzmod/testserver/profiles/ZP_Research/Factions.json'
const STAND_MODULES = 'E:/dayzmod/testserver/profiles/ZP_Research/Modules.json'

mkdirSync(OUT, { recursive: true })

// ---- Фікстури: А = живі стендові файли; Б = конфлікт нашивки; В = гард використань ------------
const factionsBytes = readFileSync(STAND_FACTIONS)
const modulesBytes = readFileSync(STAND_MODULES)
writeFileSync(
  join(DIST, 't4-3a.zip'),
  zipSync({ 'Factions.json': new Uint8Array(factionsBytes), 'Modules.json': new Uint8Array(modulesBytes) }),
)

const conflictDoc = JSON.parse(factionsBytes.toString('utf8'))
if (conflictDoc.Factions.length !== 7) throw new Error('стендова фікстура зсунулась: чекав 7 фракцій, є ' + conflictDoc.Factions.length)
if (conflictDoc.Factions[0].Id !== 'ecolog' || conflictDoc.Factions[1].Id !== 'clearsky') {
  throw new Error('стендова фікстура зсунулась: перші фракції не ecolog/clearsky')
}
if (!conflictDoc.Factions[0].Armbands.includes('Armband_White')) throw new Error('у ecolog немає Armband_White — фікстура конфлікту не зберігає сенсу')
conflictDoc.Factions[1].Armbands.push('Armband_White') // конфлікт: нашивка ecolog тепер і в clearsky
writeFileSync(join(DIST, 't4-3b.zip'), zipSync({ 'Factions.json': new TextEncoder().encode(JSON.stringify(conflictDoc, null, 4)) }))

const guardRules = {
  ConfigVersion: 1,
  Rules: [{ Id: 'guard_rule', Enabled: true, Device: 'ZP_ServerRack', Mode: 'background', RequiredFactions: ['duty'] }],
}
writeFileSync(
  join(DIST, 't4-3c.zip'),
  zipSync({
    'Factions.json': new Uint8Array(factionsBytes),
    'ProcessingRules/guard.json': new TextEncoder().encode(JSON.stringify(guardRules, null, 4)),
  }),
)
console.log('фікстури зібрано: A=стенд (7 фракцій, 3 модулі), B=конфлікт нашивки, C=гард правила')

// ---- headless Chrome + сирий CDP -------------------------------------------------------------
const profile = mkdtempSync(join(tmpdir(), 't43shoot-'))
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
// React onBlur — буферні поля (FloatField) комітять САМЕ на blur, тож подія диспатчиться явно.
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
async function clickByAria(label) {
  const found = await evalJs(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === ${JSON.stringify(label)})
    if (!btn) return false
    btn.click()
    return true
  })()`)
  if (!found) throw new Error('кнопки з aria-label не знайдено: ' + label)
}

// ---- (а) Стендові фракції: 7 рядків, лічильники, warn-лампи чотирьох без терміналів ----------
await importZip('t4-3a.zip')
await clickTab('Фракції')

const stateA = await evalJs(`(() => {
  const rows = [...document.querySelectorAll('table.entity-table tbody tr')]
  const byId = {}
  for (const r of rows) {
    const id = r.querySelector('.row-select code')?.textContent ?? ''
    const tds = [...r.querySelectorAll('td')]
    byId[id] = {
      name: tds[1]?.textContent ?? '',
      counts: [tds[2]?.textContent, tds[3]?.textContent, tds[4]?.textContent],
      lamp: tds[5]?.querySelector('.lamp')?.className ?? '',
    }
  }
  return { rowCount: rows.length, byId }
})()`)
console.log('фракції А:', JSON.stringify(stateA))
if (stateA.rowCount !== 7) throw new Error('чекав 7 фракцій, є ' + stateA.rowCount)
if (stateA.byId['ecolog'].counts.join(',') !== '6,1,3') throw new Error('лічильники ecolog не 6/1/3: ' + stateA.byId['ecolog'].counts)
if (stateA.byId['ecolog'].name !== 'Вчені') throw new Error('назва ecolog: ' + stateA.byId['ecolog'].name)
for (const poor of ['freedom', 'sop', 'bandit', 'loner']) {
  if (!stateA.byId[poor].lamp.includes('lamp-warn')) throw new Error(`лампа ${poor} мала бути warn (без власних терміналів/приладів): ` + stateA.byId[poor].lamp)
}

await clickRow('ecolog')
const panelA = await evalJs(`(() => {
  const detail = document.querySelector('.entity-detail')
  return {
    id: document.getElementById('fx-id')?.value ?? null,
    displayName: document.getElementById('fx-displayname')?.value ?? null,
    supertype: document.getElementById('fx-supertype')?.value ?? null,
    armbandInputs: detail ? detail.querySelectorAll('.rule-array')[0]?.querySelectorAll('.zp-select-input').length : null,
    usageNote: detail?.querySelector('.faction-usage')?.textContent ?? '',
  }
})()`)
console.log('панель ecolog:', JSON.stringify(panelA))
if (panelA.id !== 'ecolog') throw new Error('панель не на ecolog: ' + panelA.id)
if (panelA.displayName !== 'Вчені') throw new Error('DisplayName у панелі: ' + panelA.displayName)
if (panelA.supertype !== 'science') throw new Error('Supertype у панелі: ' + panelA.supertype)
if (panelA.armbandInputs !== 6) throw new Error('чекав 6 ZpSelect-рядків нашивок, є ' + panelA.armbandInputs)
await shot('t4-3-a-factions.png')

// ---- (а-2) Стендові модулі: 3 рядки, fround-канон бонуса, ігрові лиця ------------------------
await clickTab('Модулі')
const stateM = await evalJs(`(() => {
  const rows = [...document.querySelectorAll('table.entity-table tbody tr')]
  return rows.map((r) => {
    const tds = [...r.querySelectorAll('td')]
    return {
      cls: r.querySelector('.row-select code')?.textContent ?? '',
      bonus: tds[2]?.textContent ?? '',
      devices: tds[3]?.textContent ?? '',
      lamp: tds[4]?.querySelector('.lamp')?.className ?? '',
    }
  })
})()`)
console.log('модулі А:', JSON.stringify(stateM))
if (stateM.length !== 3) throw new Error('чекав 3 модулі, є ' + stateM.length)
if (stateM[0].cls !== 'ZP_Tool_Optics' || stateM[0].bonus !== '0.20000000298023225') throw new Error('перший модуль/бонус (fround-канон): ' + JSON.stringify(stateM[0]))
if (stateM[1].bonus !== '0.30000001192092898') throw new Error('бонус центрифуги (fround-канон): ' + stateM[1].bonus)
if (stateM[2].bonus !== '0.25') throw new Error('бонус реагентів: ' + stateM[2].bonus)
if (stateM[0].devices !== 'ZP_Microscope') throw new Error('прилади оптики: ' + stateM[0].devices)
for (const m of stateM) {
  if (!m.lamp.includes('lamp-ok')) throw new Error(`лампа модуля ${m.cls} мала бути ok: ` + m.lamp)
}

await clickRow('ZP_Tool_Optics')
const panelM = await evalJs(`(() => ({
  cls: document.getElementById('md-classname')?.value ?? null,
  bonus: document.getElementById('md-bonus')?.value ?? null,
  notes: document.getElementById('md-notes')?.value ?? null,
}))()`)
console.log('панель оптики:', JSON.stringify(panelM))
if (panelM.cls !== 'ZP_Tool_Optics') throw new Error('панель не на оптиці: ' + panelM.cls)
if (panelM.bonus !== '0.20000000298023225') throw new Error('поле бонуса не показує канон файлу: ' + panelM.bonus)
if (!panelM.notes || !panelM.notes.includes('оптика')) throw new Error('нотатки не підтягнулись: ' + panelM.notes)
await shot('t4-3-b-modules.png')

// ---- (в) Бонус за межу [0..2] -> alarm «ВИКИНЕ», лампа alarm, збереження НЕ блокується --------
await setInput('md-bonus', '2.5')
await blurField('md-bonus')
await sleep(300)
const stateBonus = await evalJs(`(() => {
  const detail = document.querySelector('.entity-detail')
  const row = [...document.querySelectorAll('table.entity-table tbody tr')].find((r) => r.querySelector('.row-select code')?.textContent === 'ZP_Tool_Optics')
  const save = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Зберегти зміни'))
  return {
    alarmMessages: detail ? [...detail.querySelectorAll('.field-message-alarm')].map((m) => m.textContent) : [],
    rowLamp: row?.querySelectorAll('td')[4]?.querySelector('.lamp')?.className ?? '',
    bonusField: document.getElementById('md-bonus')?.value ?? null,
    saveDisabled: save?.disabled ?? null,
  }
})()`)
console.log('після правки бонуса:', JSON.stringify(stateBonus))
if (!stateBonus.alarmMessages.some((m) => m.includes('ВИКИНЕ'))) throw new Error('немає alarm «сервер ВИКИНЕ запис» біля поля: ' + JSON.stringify(stateBonus.alarmMessages))
if (!stateBonus.rowLamp.includes('lamp-alarm')) throw new Error('лампа рядка не alarm: ' + stateBonus.rowLamp)
if (stateBonus.bonusField !== '2.5') throw new Error('поле бонуса після коміту: ' + stateBonus.bonusField)
if (stateBonus.saveDisabled !== false) throw new Error('збереження НЕ мало блокуватись (у модулів немає project-wide гейта — T1)')
await shot('t4-3-d-bonus-alarm.png')

// ---- (б) Конфлікт нашивки: повідомлення в ОБОХ фракцій ---------------------------------------
await importZip('t4-3b.zip')
await clickTab('Фракції')
const conflictRows = await evalJs(`(() => {
  const rows = [...document.querySelectorAll('table.entity-table tbody tr')]
  const lampOf = (id) => rows.find((r) => r.querySelector('.row-select code')?.textContent === id)?.querySelectorAll('td')[5]?.querySelector('.lamp')?.className ?? ''
  return { ecolog: lampOf('ecolog'), clearsky: lampOf('clearsky') }
})()`)
console.log('лампи конфлікту:', JSON.stringify(conflictRows))
if (!conflictRows.ecolog.includes('lamp-alarm')) throw new Error('лампа ecolog не alarm при конфлікті нашивки: ' + conflictRows.ecolog)
if (!conflictRows.clearsky.includes('lamp-alarm')) throw new Error('лампа clearsky не alarm при конфлікті нашивки: ' + conflictRows.clearsky)

await clickRow('ecolog')
const msgEcolog = await evalJs(`[...document.querySelectorAll('.entity-detail .field-message')].map((m) => m.textContent)`)
if (!msgEcolog.some((m) => m.includes('Armband_White') && m.includes("'clearsky'"))) {
  throw new Error('панель ecolog не показує конфлікт із clearsky: ' + JSON.stringify(msgEcolog))
}
await clickRow('clearsky')
const msgClearsky = await evalJs(`[...document.querySelectorAll('.entity-detail .field-message')].map((m) => m.textContent)`)
if (!msgClearsky.some((m) => m.includes('Armband_White') && m.includes("'ecolog'"))) {
  throw new Error('панель clearsky не показує конфлікт із ecolog: ' + JSON.stringify(msgClearsky))
}
await shot('t4-3-c-armband-conflict.png')

// ---- (г) Створення фракції + видалення (щасливе і з гардом використань) ----------------------
await importZip('t4-3c.zip')
await clickTab('Фракції')
await setInput('fx-new-id', 'varta')
await clickByAria('Створити фракцію')
await sleep(400)
const created = await evalJs(`(() => {
  const rows = [...document.querySelectorAll('table.entity-table tbody tr')]
  const detail = document.querySelector('.entity-detail')
  const save = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Зберегти зміни'))
  return {
    rowCount: rows.length,
    panelId: document.getElementById('fx-id')?.value ?? null,
    displayNameAlarm: detail ? [...detail.querySelectorAll('.field-message-alarm')].some((m) => m.textContent.includes('DisplayName')) : null,
    saveDisabled: save?.disabled ?? null,
  }
})()`)
console.log('після створення varta:', JSON.stringify(created))
if (created.rowCount !== 8) throw new Error('чекав 8 рядків після створення, є ' + created.rowCount)
if (created.panelId !== 'varta') throw new Error('панель не перейшла на нову фракцію: ' + created.panelId)
if (created.displayNameAlarm !== true) throw new Error('немає alarm «немає DisplayName» на свіжій фракції (дефолти схеми порожні)')
if (created.saveDisabled !== false) throw new Error('після створення (dirty) збереження мало бути доступним')
await shot('t4-3-e-created.png')

// Щасливе видалення: varta ніщо не використовує -> другим натисканням зникає
await evalJs(`document.querySelector('.entity-detail .fx-delete').click()`)
await sleep(150)
const armedText = await evalJs(`document.querySelector('.entity-detail .fx-delete')?.textContent ?? ''`)
if (!armedText.includes('ще раз')) throw new Error('перше натискання не взвело підтвердження: ' + armedText)
await evalJs(`document.querySelector('.entity-detail .fx-delete').click()`)
await sleep(300)
const afterDelete = await evalJs(`(() => ({
  rowCount: document.querySelectorAll('table.entity-table tbody tr').length,
  panelEmpty: document.querySelector('.entity-detail')?.textContent.includes('Виберіть фракцію') ?? null,
}))()`)
console.log('після видалення varta:', JSON.stringify(afterDelete))
if (afterDelete.rowCount !== 7) throw new Error('чекав 7 рядків після видалення, є ' + afterDelete.rowCount)
if (afterDelete.panelEmpty !== true) throw new Error('панель не очистилась після видалення')

// Гард: duty тримає правило guard_rule -> відмова з переліком, запис лишається
await clickRow('duty')
const usageDuty = await evalJs(`document.querySelector('.entity-detail .faction-usage')?.textContent ?? ''`)
if (!usageDuty.includes('guard_rule')) throw new Error('панель duty не показує живе використання guard_rule: ' + usageDuty)
await evalJs(`document.querySelector('.entity-detail .fx-delete').click()`)
await sleep(150)
await evalJs(`document.querySelector('.entity-detail .fx-delete').click()`)
await sleep(300)
const guardState = await evalJs(`(() => ({
  rowCount: document.querySelectorAll('table.entity-table tbody tr').length,
  error: document.querySelector('.entity-detail .indicator.alarm')?.textContent ?? '',
}))()`)
console.log('гард використань:', JSON.stringify(guardState))
if (guardState.rowCount !== 7) throw new Error('duty зник попри гард використань!')
if (!guardState.error.includes('guard_rule')) throw new Error('відмова без переліку використань: ' + guardState.error)
await shot('t4-3-f-delete-guard.png')

console.log('консольні помилки за сесію:', consoleErrors.length, consoleErrors)
if (consoleErrors.length > 0) throw new Error('консольні помилки в сесії: ' + consoleErrors.join(' | '))
ws.close()
chrome.kill()
// Фікстурні zip-и не лишаються в dist (конвенція T2: генеруються скриптом, не комітяться)
for (const f of ['t4-3a.zip', 't4-3b.zip', 't4-3c.zip']) rmSync(join(DIST, f), { force: true })
console.log('готово')
