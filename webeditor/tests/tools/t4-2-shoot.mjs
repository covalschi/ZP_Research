// Скріншот-харнес W4 Task 2 (вкладка «Бали»: матриця типів балів) — той самий прийом
// headless Chrome + сирий CDP, що t3-4-shoot.mjs (жорсткі console-assert збережено).
// Сценарій брифа:
//   (а) РЕАЛЬНИЙ стендовий PointTypes.json (24 типи, 4×2×3) — матриця рендериться з
//       кольорами (чіп bio = #7CB342), без секції «поза матрицею»;
//   (б) нова категорія 'chem' через редактор осей -> порожній рядок -> «створити» в
//       клітинці (chem, field, т1) -> авто-Id 'chem_field_t1' + авто-Name/Category/Kind/Tier
//       у деталь-панелі, збереження стало доступним (dirty, аварій немає);
//   (в) фікстура з РУКОПИСНИМ дублем Id (близнюк bio_field_t1) -> app-панель гейта
//       (секція даних + кнопка «Перейти до вкладки „Бали"») і банер у вкладці, експорт
//       заблоковано; видалення близнюка кнопкою ПРЯМО В МАТРИЦІ -> гейт відкрився;
//       (бонус-ассерт: застарілий вибір з (б) після переімпорту гасне — guard
//       resolveMatrixSelection, а не показ чужого запису);
//   (г) правка імені й кольору через деталь-панель -> картка в матриці й чіп оновились живцем.
// Запуск: `node tests/tools/t4-2-shoot.mjs` (vite preview на :4173 має працювати).
import { zipSync } from 'fflate'
import { spawn } from 'child_process'
import { writeFileSync, readFileSync, mkdirSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = process.env.T4_2_SHOOT_OUT || 'E:/TMP/claude/E--dayzmod/ef2600b9-21a8-43d6-8043-cf5a4904c3ec/scratchpad'
const PORT = 9347
const URL = 'http://localhost:4173/'
const DIST = 'E:/dayzmod/webeditor/dist'
const STAND_POINTTYPES = 'E:/dayzmod/testserver/profiles/ZP_Research/PointTypes.json'

mkdirSync(OUT, { recursive: true })

// ---- Фікстури: А = живий стендовий файл; Б = він же + рукописний близнюк ---------------------
const standBytes = readFileSync(STAND_POINTTYPES)
writeFileSync(join(DIST, 't4-2a.zip'), zipSync({ 'PointTypes.json': new Uint8Array(standBytes) }))

const standDoc = JSON.parse(standBytes.toString('utf8'))
if (standDoc.PointTypes.length !== 24) throw new Error('стендова фікстура зсунулась: чекав 24 типи, є ' + standDoc.PointTypes.length)
standDoc.PointTypes.push({
  Id: 'bio_field_t1', // ТОЧНИЙ дубль (як його бачить сервер, Validate :306-308)
  Name: 'Рукописний близнюк',
  Icon: '',
  Color: '#7CB342',
  SortOrder: 99,
  Category: 'bio',
  Kind: 'field',
  Tier: 1,
})
writeFileSync(join(DIST, 't4-2b.zip'), zipSync({ 'PointTypes.json': new TextEncoder().encode(JSON.stringify(standDoc, null, 4)) }))
console.log('фікстури зібрано: A=24 типи, B=25 (з близнюком)')

// ---- headless Chrome + сирий CDP -------------------------------------------------------------
const profile = mkdtempSync(join(tmpdir(), 't42shoot-'))
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
async function clickByAria(label) {
  const found = await evalJs(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === ${JSON.stringify(label)})
    if (!btn) return false
    btn.click()
    return true
  })()`)
  if (!found) throw new Error('кнопки з aria-label не знайдено: ' + label)
}

// ---- (а) Стендова матриця 4×2×3 з кольорами --------------------------------------------------
await importZip('t4-2a.zip')
await evalJs(`[...document.querySelectorAll('.tab-button')].find((b) => b.textContent.includes('Бали')).click()`)
await sleep(600)

const stateA = await evalJs(`(() => {
  const rows = [...document.querySelectorAll('table.pt-matrix tbody tr')]
  const kinds = [...document.querySelectorAll('th.pt-kind-head')].map((t) => t.textContent.trim())
  const tierHeads = document.querySelectorAll('th.pt-tier-head').length
  const entries = document.querySelectorAll('table.pt-matrix .pt-entry-select').length
  const creates = document.querySelectorAll('table.pt-matrix .pt-entry-create').length
  const bioCell = document.querySelector('td.pt-cell[data-cat="bio"][data-kind="field"][data-tier="1"]')
  const chip = bioCell?.querySelector('.pt-entry-select .pt-color-chip')
  return {
    catIds: rows.map((r) => r.querySelector('.pt-cat-head code')?.textContent ?? ''),
    kinds,
    tierHeads,
    entries,
    creates,
    bioName: bioCell?.querySelector('.pt-entry-name')?.textContent ?? null,
    bioChip: chip ? getComputedStyle(chip).backgroundColor : null,
    outside: document.querySelectorAll('.pt-outside').length,
    banner: document.querySelectorAll('.pt-gate-banner').length,
  }
})()`)
console.log('матриця А:', JSON.stringify(stateA))
if (stateA.catIds.join(',') !== 'bio,anomaly,electronics,combat') throw new Error('рядки категорій не 4/не за SortOrder: ' + stateA.catIds)
if (stateA.kinds.length !== 2 || !stateA.kinds[0].includes('польові') || !stateA.kinds[1].includes('лабораторні'))
  throw new Error('групи видів не field/lab за SortOrder: ' + JSON.stringify(stateA.kinds))
if (stateA.tierHeads !== 6) throw new Error('чекав 6 колонок (2 види × 3 тіри), є ' + stateA.tierHeads)
if (stateA.entries !== 24) throw new Error('чекав 24 заповнені записи, є ' + stateA.entries)
if (stateA.creates !== 0) throw new Error('на повній матриці не мало б бути кнопок «створити», є ' + stateA.creates)
if (stateA.bioName !== 'Польове дослідження біології 1 тиру') throw new Error('імʼя в клітинці bio/field/1: ' + stateA.bioName)
if (stateA.bioChip !== 'rgb(124, 179, 66)') throw new Error('чіп кольору bio не #7CB342: ' + stateA.bioChip)
if (stateA.outside !== 0) throw new Error('секції «поза матрицею» на чистому стенді бути не мало')
if (stateA.banner !== 0) throw new Error('гейт-банер на чистому стенді бути не мав')
await shot('t4-2-a-matrix.png')

// ---- (б) Нова категорія + створення з порожньої клітинки -------------------------------------
await setInput('ax-Categories-add', 'chem')
await clickByAria('Додати вісь у Категорії')
await sleep(400)
const afterAxis = await evalJs(`(() => {
  const rows = [...document.querySelectorAll('table.pt-matrix tbody tr')]
  const chemRow = rows.find((r) => r.querySelector('.pt-cat-head code')?.textContent === 'chem')
  return { rowCount: rows.length, chemCreates: chemRow ? chemRow.querySelectorAll('.pt-entry-create').length : null }
})()`)
console.log('після додавання осі:', JSON.stringify(afterAxis))
if (afterAxis.rowCount !== 5) throw new Error('чекав 5 рядків після нової категорії, є ' + afterAxis.rowCount)
if (afterAxis.chemCreates !== 6) throw new Error('у рядку chem чекав 6 кнопок «створити», є ' + afterAxis.chemCreates)

await clickByAria('Створити тип: chem / field / тір 1')
await sleep(400)
const stateB = await evalJs(`(() => {
  const detail = document.querySelector('.pt-detail')
  const cell = document.querySelector('td.pt-cell[data-cat="chem"][data-kind="field"][data-tier="1"]')
  const save = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Зберегти зміни'))
  return {
    code: detail?.querySelector('.field-readonly code')?.textContent ?? null,
    name: document.getElementById('pt-name')?.value ?? null,
    tier: document.getElementById('pt-tier')?.value ?? null,
    category: document.getElementById('pt-category')?.value ?? null,
    kind: document.getElementById('pt-kind')?.value ?? null,
    entries: document.querySelectorAll('table.pt-matrix .pt-entry-select').length,
    cellSelected: cell ? cell.querySelectorAll('.pt-entry-select.selected').length : null,
    saveDisabled: save?.disabled ?? null,
  }
})()`)
console.log('після створення:', JSON.stringify(stateB))
if (stateB.code !== 'chem_field_t1') throw new Error('авто-Id не chem_field_t1: ' + stateB.code)
if (stateB.name !== 'chem — польові, тір 1') throw new Error('авто-Name (Name осі/фолбек сирого Id): ' + stateB.name)
if (stateB.tier !== '1') throw new Error('авто-Tier не 1: ' + stateB.tier)
if (stateB.category !== 'chem') throw new Error('ZpSelect категорії не показує chem: ' + stateB.category)
if (stateB.kind !== 'польові') throw new Error('ZpSelect виду не показує label «польові»: ' + stateB.kind)
if (stateB.entries !== 25) throw new Error('чекав 25 записів після створення, є ' + stateB.entries)
if (stateB.cellSelected !== 1) throw new Error('новий запис не вибраний у своїй клітинці')
if (stateB.saveDisabled !== false) throw new Error('після створення (dirty, аварій немає) збереження мало б бути доступним')
await shot('t4-2-b-created.png')

// ---- (в) Рукописний дубль Id: гейт + ремонт кнопкою близнюка ---------------------------------
await importZip('t4-2b.zip')
await sleep(400)
const stateC = await evalJs(`(() => {
  const dataSection = document.querySelector('.alarm-gate-data-section')
  const gotoBtn = dataSection ? [...dataSection.querySelectorAll('button')].find((b) => b.textContent.includes('Бали')) : null
  const banner = document.querySelector('.pt-gate-banner')
  const cell = document.querySelector('td.pt-cell[data-cat="bio"][data-kind="field"][data-tier="1"]')
  const save = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Зберегти зміни'))
  const exportBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Завантажити ZIP'))
  const detail = document.querySelector('.pt-detail')
  return {
    dataSectionText: dataSection ? dataSection.textContent : null,
    hasGotoButton: !!gotoBtn,
    bannerText: banner ? banner.textContent : null,
    dupEntries: cell ? cell.querySelectorAll('.pt-cell-entry-dup').length : null,
    dupDeleteButtons: cell ? cell.querySelectorAll('.pt-entry-delete').length : null,
    saveDisabled: save?.disabled ?? null,
    exportDisabled: exportBtn?.disabled ?? null,
    staleSelectionGone: detail ? detail.textContent.includes('Виберіть запис') : null,
  }
})()`)
console.log('дубль-фікстура:', JSON.stringify({ ...stateC, dataSectionText: (stateC.dataSectionText ?? '').slice(0, 80), bannerText: (stateC.bannerText ?? '').slice(0, 80) }))
if (!stateC.dataSectionText || !stateC.dataSectionText.includes('реєстр типів балів')) throw new Error('app-панель без секції даних-гейта')
if (!stateC.dataSectionText.includes("дублікат Id 'bio_field_t1'")) throw new Error('секція даних не називає дубль: ' + stateC.dataSectionText)
if (!stateC.hasGotoButton) throw new Error('немає кнопки «Перейти до вкладки „Бали"»')
if (!stateC.bannerText || !stateC.bannerText.includes('реєстр типів балів')) throw new Error('банер наверху вкладки відсутній')
if (stateC.dupEntries !== 2) throw new Error('чекав 2 позначені дубль-записи у клітинці, є ' + stateC.dupEntries)
if (stateC.dupDeleteButtons !== 2) throw new Error('чекав кнопку видалення на КОЖНОМУ близнюку, є ' + stateC.dupDeleteButtons)
if (stateC.saveDisabled !== true) throw new Error('збереження мало бути заблокованим (гейт даних)')
if (stateC.exportDisabled !== true) throw new Error('експорт ZIP мав бути заблокованим (гейт даних, dirty=0)')
if (stateC.staleSelectionGone !== true) throw new Error('застарілий вибір із (б) пережив переімпорт — guard resolveMatrixSelection не спрацював')
await shot('t4-2-c-dup-gate.png')

// Ремонт: видалити РУКОПИСНОГО близнюка (запис №25) кнопкою прямо в матриці
await clickByAria('Видалити запис №25')
await sleep(400)
const stateC2 = await evalJs(`(() => {
  const save = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Зберегти зміни'))
  const exportBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Завантажити ZIP'))
  return {
    banner: document.querySelectorAll('.pt-gate-banner').length,
    dataSection: document.querySelectorAll('.alarm-gate-data-section').length,
    dupEntries: document.querySelectorAll('.pt-cell-entry-dup').length,
    entries: document.querySelectorAll('table.pt-matrix .pt-entry-select').length,
    saveDisabled: save?.disabled ?? null,
    exportTitle: exportBtn?.getAttribute('title') ?? null,
  }
})()`)
console.log('після ремонту:', JSON.stringify(stateC2))
if (stateC2.banner !== 0) throw new Error('банер вкладки не згас після видалення близнюка')
if (stateC2.dataSection !== 0) throw new Error('app-панель даних-гейта не згасла')
if (stateC2.dupEntries !== 0) throw new Error('позначки дубля лишились')
if (stateC2.entries !== 24) throw new Error('чекав 24 записи після ремонту, є ' + stateC2.entries)
if (stateC2.saveDisabled !== false) throw new Error('гейт не відкрився: збереження досі заблоковане')
if (!stateC2.exportTitle || !stateC2.exportTitle.includes('Спершу збережіть')) throw new Error('експорт мав чекати збереження (dirty): ' + stateC2.exportTitle)
await shot('t4-2-d-repaired.png')

// ---- (г) Правка імені й кольору через деталь-панель ------------------------------------------
await evalJs(`(() => {
  const btn = [...document.querySelectorAll('table.pt-matrix .pt-entry-select')].find((b) => b.getAttribute('title') === 'bio_field_t1')
  if (!btn) throw new Error('запис bio_field_t1 не знайдений у матриці')
  btn.click()
})()`)
await sleep(300)
const beforeEdit = await evalJs(`document.getElementById('pt-name')?.value ?? null`)
if (beforeEdit !== 'Польове дослідження біології 1 тиру') throw new Error('панель відкрилась не на bio_field_t1: ' + beforeEdit)
await setInput('pt-name', 'Польова біологія — нове імʼя')
await setInput('pt-color', '#FF8800')
await sleep(300)
const stateD = await evalJs(`(() => {
  const cell = document.querySelector('td.pt-cell[data-cat="bio"][data-kind="field"][data-tier="1"]')
  const chip = cell?.querySelector('.pt-entry-select .pt-color-chip')
  const save = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Зберегти зміни'))
  return {
    cellName: cell?.querySelector('.pt-entry-name')?.textContent ?? null,
    cellChip: chip ? getComputedStyle(chip).backgroundColor : null,
    panelName: document.getElementById('pt-name')?.value ?? null,
    panelColor: document.getElementById('pt-color')?.value ?? null,
    saveDisabled: save?.disabled ?? null,
  }
})()`)
console.log('після правки:', JSON.stringify(stateD))
if (stateD.cellName !== 'Польова біологія — нове імʼя') throw new Error('імʼя в клітинці не оновилось живцем: ' + stateD.cellName)
if (stateD.cellChip !== 'rgb(255, 136, 0)') throw new Error('чіп у клітинці не перефарбувався: ' + stateD.cellChip)
if (stateD.panelName !== 'Польова біологія — нове імʼя') throw new Error('поле панелі втратило набране: ' + stateD.panelName)
if (stateD.panelColor !== '#FF8800') throw new Error('поле кольору втратило набране: ' + stateD.panelColor)
if (stateD.saveDisabled !== false) throw new Error('після правок збереження мало бути доступним')
await shot('t4-2-e-edited.png')

console.log('консольні помилки за сесію:', consoleErrors.length, consoleErrors)
if (consoleErrors.length > 0) throw new Error('консольні помилки в сесії: ' + consoleErrors.join(' | '))
ws.close()
chrome.kill()
console.log('готово')
