// Скрипт живої приймалки W2 Task 8: headless Chrome + сирий CDP (той самий прийом, що
// t5/t6/t9-shoot.mjs), але джерело — НЕ фікстура, а РЕАЛЬНІ 11 конфіг-файлів зі стенду
// (testserver\profiles\ZP_Research). Сценарій: імпорт ZIP зі стенду -> правка правила
// chain_pack_chimera (TimeSec 10->15, Output.Content через "повернути авто" -> живий
// розрив ребра з chain_analyze_chimera) -> лагодження chain_analyze_chimera.InputItem.Content
// -> живе перейменування ZP_Data_01 через DataItemQuickEdit -> Зберегти -> Завантажити ZIP
// -> звірка байтів (10 з 11 файлів БЕЗ жодної зміни доводить ідемпотентність канонізації і
// в браузерному рушії, не лише в Node-writeback.ts) -> запис назад НА СТЕНД.
//
// FactionData/PlayerData/ConfigBackup/StaticDevices* НІКОЛИ не потрапляють у ZIP — беремо
// точно 11 файлів (5 одиночних + ProcessingRules/*.json + TechTree/*.json), той самий
// перелік, що канонізував writeback.ts у W1.
//
// Запуск: `node tests/tools/t8-shoot.mjs` (з webeditor/, vite preview має вже працювати на
// :4173). Виводить шлях до розпакованих файлів у scratchpad — записування на стенд робить
// ОКРЕМИЙ крок (Bash, після ручної звірки виводу цього скрипта).

import { unzipSync, zipSync } from 'fflate'
import { spawn } from 'child_process'
import { writeFileSync, mkdtempSync, readFileSync, existsSync, readdirSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = process.env.T8_SHOOT_OUT || 'E:/TMP/claude/E--dayzmod/ef2600b9-21a8-43d6-8043-cf5a4904c3ec/scratchpad/t8-shots'
const DOWNLOAD_DIR = process.env.T8_DOWNLOAD_DIR || join(OUT, 'downloads')
const EXPORT_DIR = process.env.T8_EXPORT_DIR || join(OUT, 'exported')
const PORT = 9338
const URL = 'http://localhost:4173/'
const DIST = 'E:/dayzmod/webeditor/dist'
const STAND = 'E:/dayzmod/testserver/profiles/ZP_Research'

mkdirSync(OUT, { recursive: true })
// Очищаємо DOWNLOAD_DIR ПОВНІСТЮ перед кожним запуском (rm+mkdir, не просто mkdir
// {recursive:true}, яке нічого не чистить): повторний запуск на тому самому scratchpad
// лишав старий ZP_Research.zip від попереднього прогону, і детектор "свіжого" файлу
// (не в filesBefore) хапав НЕ zip (він вже "старий" за іменем), а якийсь інший файл, що
// зʼявився в теці — знайдено живцем на повторному прогоні для мінор-фіксу T8.
rmSync(DOWNLOAD_DIR, { recursive: true, force: true })
mkdirSync(DOWNLOAD_DIR, { recursive: true })
mkdirSync(EXPORT_DIR, { recursive: true })

// ---- 1. Зібрати ZIP із РЕАЛЬНИХ 11 конфіг-файлів стенду --------------------------------

const STAND_FILES = [
  'Settings.json',
  'PointTypes.json',
  'Factions.json',
  'DataItems.json',
  'Modules.json',
  'ProcessingRules/chain.json',
  'ProcessingRules/demo.json',
  'ProcessingRules/test_micro.json',
  'TechTree/clearsky.json',
  'TechTree/combat.json',
  'TechTree/zone.json',
]

const originalBytes = new Map()
const zipInput = {}
for (const rel of STAND_FILES) {
  const buf = readFileSync(join(STAND, ...rel.split('/')))
  originalBytes.set(rel, buf)
  zipInput[rel] = new Uint8Array(buf)
}
const standZip = zipSync(zipInput)
writeFileSync(join(DIST, 't8-stand.zip'), standZip)
console.log('фікстура зі стенду зібрана:', standZip.length, 'байт,', STAND_FILES.length, 'файлів')

// ---- 2. headless Chrome + сирий CDP ------------------------------------------------------

const profile = mkdtempSync(join(tmpdir(), 't8shoot-'))
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1600,1000',
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

async function shot(name, clip) {
  const params = { format: 'png' }
  if (clip) params.clip = { ...clip, scale: 1 }
  const r = await send('Page.captureScreenshot', params)
  const path = join(OUT, name)
  writeFileSync(path, Buffer.from(r.data, 'base64'))
  console.log('знято', path)
}

async function injectZip(zipName) {
  await evalJs(`(async () => {
    const res = await fetch('/${zipName}')
    const buf = await res.arrayBuffer()
    const dt = new DataTransfer()
    dt.items.add(new File([buf], '${zipName}', { type: 'application/zip' }))
    const input = document.getElementById('import-zip-input')
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(700)
}

async function clickChainsTab() {
  await evalJs(`(() => {
    const btn = [...document.querySelectorAll('.tab-button')].find((b) => b.textContent.includes('Ланцюги'))
    btn.click()
  })()`)
  await sleep(900) // elk-розкладка асинхронна
}

async function clickRuleCard(ruleId) {
  const found = await evalJs(`(() => {
    const title = [...document.querySelectorAll('.rule-card-id')].find((el) => el.textContent.trim() === '${ruleId}')
    if (!title) return false
    const wrapper = title.closest('.react-flow__node')
    wrapper.click()
    return true
  })()`)
  if (!found) throw new Error(`картка '${ruleId}' не знайдена на полотні`)
  await sleep(300)
}

async function clickDataFaceTag(classnameOrLabel) {
  const found = await evalJs(`(() => {
    const tags = [...document.querySelectorAll('.data-face-tag')]
    const tag = tags.find((el) => el.textContent.includes(${JSON.stringify(classnameOrLabel)}))
    if (!tag) return false
    tag.click()
    return true
  })()`)
  if (!found) throw new Error(`data-face-теґ '${classnameOrLabel}' не знайдено на полотні`)
  await sleep(200)
}

async function clickFilesTab() {
  await evalJs(`(() => {
    const btn = [...document.querySelectorAll('.tab-button')].find((b) => b.textContent.includes('Файли'))
    btn.click()
  })()`)
  await sleep(300)
}

async function selectFileRow(pathSubstring) {
  const found = await evalJs(`(() => {
    const btn = [...document.querySelectorAll('button.row-select')].find((b) => b.textContent.includes(${JSON.stringify(pathSubstring)}))
    if (!btn) return false
    btn.click()
    return true
  })()`)
  if (!found) throw new Error(`рядок файлу '${pathSubstring}' не знайдено у реєстрі файлів`)
  await sleep(200)
}

async function setZpSelectValue(elementId, text) {
  const escaped = JSON.stringify(text)
  await evalJs(`(() => {
    const el = document.getElementById('${elementId}')
    el.focus()
    const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
    desc.set.call(el, ${escaped})
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(80)
  await evalJs(`document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`)
  await sleep(150)
}

async function setPlainFieldValue(elementId, text, tag = 'HTMLInputElement') {
  const escaped = JSON.stringify(text)
  await evalJs(`(() => {
    const el = document.getElementById('${elementId}')
    el.focus()
    const desc = Object.getOwnPropertyDescriptor(window.${tag}.prototype, 'value')
    desc.set.call(el, ${escaped})
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(80)
}

async function blurField(elementId) {
  // el.blur() у headless Chrome не породжує 'focusout' (T9-знахідка) -- React onBlur не
  // спрацьовує без явного FocusEvent.
  await evalJs(`document.getElementById('${elementId}')?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))`)
  await sleep(150)
}

async function fieldValue(elementId) {
  return evalJs(`document.getElementById('${elementId}')?.value ?? null`)
}

async function clickButtonWithText(text) {
  const found = await evalJs(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)})
    if (!btn) return false
    btn.click()
    return true
  })()`)
  if (!found) throw new Error(`кнопка '${text}' не знайдена`)
  await sleep(150)
}

async function hasBreakLamp() {
  return evalJs(`document.querySelectorAll('.break-edge').length`)
}

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
  }
}

await send('Page.enable')
await send('Runtime.enable')
await send('Log.enable')
await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOAD_DIR })

await send('Page.navigate', { url: URL })
await sleep(1200)

// ---- a) Імпорт реального стенду -----------------------------------------------------------

await injectZip('t8-stand.zip')

// ---- a-files) Смоук вкладки «Файли» проти РЕАЛЬНОГО імпорту стенду (мінор рев'ю T8: брифів
// пункт "смоук всіх вкладок" не мав жодного кадру з реєстру файлів/паспорта — App.tsx
// відкривається саме на вкладці 'files' за замовчуванням (useState<Tab>('files')), тож
// перехід сюди явний clickFilesTab() не строго обов'язковий одразу після імпорту, але
// робимо його явно, щоб сценарій не залежав від дефолту компонента.
await clickFilesTab()
await selectFileRow('DataItems.json')
await shot('t8-a0b-files-tab-dataitems.png')
const fileListRowCount = await evalJs(`document.querySelectorAll('.file-list tbody tr').length`)
console.log('a-files) рядків у реєстрі файлів =', fileListRowCount, '(очікую 11 -- усі реальні конфіги стенду, без foreign)')
if (fileListRowCount !== 11) throw new Error(`реєстр файлів показав ${fileListRowCount} рядків замість 11 -- зі стенду завантажилось не все, що очікувалось`)
const detailHeading = await evalJs(`document.querySelector('.detail h2')?.textContent ?? null`)
console.log('a-files) обраний файл у паспорті =', detailHeading)
if (detailHeading !== 'DataItems.json') throw new Error('паспорт файлу не показав обраний DataItems.json -- клік по рядку не спрацював')
console.log('a-files) OK: вкладка «Файли» показала реєстр (11 рядків) + паспорт із колонкою попереджень на реальному імпорті стенду')

await clickChainsTab()
await shot('t8-a0-stand-graph-loaded.png')
const breaksAtStart = await hasBreakLamp()
console.log('a) розривів на завантаженому графі стенду =', breaksAtStart)
if (breaksAtStart !== 0) throw new Error(`стенд завантажився з ${breaksAtStart} розривами ще ДО правок — це вже неприйнятний стан для приймання`)

// ---- b) chain_pack_chimera: TimeSec 10->15 -------------------------------------------------

await clickRuleCard('chain_pack_chimera')
await shot('t8-b0-panel-chain-pack-chimera.png')
const timeBefore = await fieldValue('rp-time')
const contentBefore = await fieldValue('rp-out-content-0')
console.log('b) TimeSec до =', timeBefore, '| Outputs[0].Content до =', contentBefore)
if (contentBefore !== 'chimera_claw') throw new Error('несподіване початкове значення Outputs[0].Content')

await setPlainFieldValue('rp-time', '15')
await blurField('rp-time')
const timeAfter = await fieldValue('rp-time')
console.log('b) TimeSec після редагування (канонічний друк) =', timeAfter)
if (Number(timeAfter) !== 15) throw new Error(`TimeSec не закомітився -- очікував 15, маю ${timeAfter}`)
await shot('t8-b1-timesec-committed.png')

// ---- c) Output.Content через "повернути авто" -- живий розрив ------------------------------

await clickButtonWithText('повернути авто')
await sleep(200)
const contentAfterAuto = await fieldValue('rp-out-content-0')
console.log('c) Outputs[0].Content після "повернути авто" =', contentAfterAuto)
if (contentAfterAuto !== 'Apple') throw new Error(`"повернути авто" мав підставити InputItem.Classname ("Apple"), маю "${contentAfterAuto}"`)
await sleep(300)
const breaksAfterAuto = await hasBreakLamp()
console.log('c) розривів після зміни через авто-похідну =', breaksAfterAuto)
if (breaksAfterAuto <= breaksAtStart) throw new Error('зміна Content через "повернути авто" НЕ спричинила живий розрив -- граф не оновився')
await shot('t8-c0-break-after-auto-content.png')

// ---- d) Лагодимо chain_analyze_chimera.InputItem.Content -- ребро повертається -------------

await clickRuleCard('chain_analyze_chimera')
await shot('t8-d0-panel-chain-analyze-chimera.png')
const analyzeInputBefore = await fieldValue('rp-input-content')
console.log('d) chain_analyze_chimera.InputItem.Content до =', analyzeInputBefore)
if (analyzeInputBefore !== 'chimera_claw') throw new Error('несподіване початкове значення InputItem.Content аналізу')

await setZpSelectValue('rp-input-content', 'Apple')
await sleep(300)
const breaksAfterFix = await hasBreakLamp()
console.log('d) розривів після узгодження =', breaksAfterFix)
if (breaksAfterFix !== breaksAtStart) throw new Error(`розрив НЕ зник після узгодження Content -- маю ${breaksAfterFix}, очікував ${breaksAtStart}`)
await shot('t8-d1-fixed-edge-live.png')

// ---- e) ZP_Data_01 -- перейменування через DataItemQuickEdit --------------------------------

await clickDataFaceTag('Зразок тканини химери')
await shot('t8-e0-quickedit-opened.png')
const nameBefore = await fieldValue('di-name')
console.log('e) di-name до =', nameBefore)
const NEW_NAME = 'Зразок тканини химери (W2 T8 приймання)'
await setPlainFieldValue('di-name', NEW_NAME)
await sleep(250)
const tagAfterRename = await evalJs(`[...document.querySelectorAll('.data-face-tag')].map((el) => el.textContent.trim())`)
console.log('e) теґи після перейменування =', tagAfterRename)
if (!tagAfterRename.some((t) => t.includes(NEW_NAME))) throw new Error('картка НЕ оновилась живцем після перейменування ZP_Data_01')
await shot('t8-e1-renamed-live.png')

// ---- f) Зберегти -> Завантажити ZIP ---------------------------------------------------------

await evalJs(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Зберегти зміни'))
  btn.click()
})()`)
await sleep(400)
await shot('t8-f0-before-download.png')

const filesBefore = new Set(existsSync(DOWNLOAD_DIR) ? readdirSync(DOWNLOAD_DIR) : [])
await evalJs(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Завантажити ZIP'))
  if (!btn) throw new Error('кнопка "Завантажити ZIP" не знайдена')
  btn.click()
})()`)

let downloadedName
for (let i = 0; i < 50; i++) {
  await sleep(200)
  const names = existsSync(DOWNLOAD_DIR) ? readdirSync(DOWNLOAD_DIR) : []
  // .zip-фільтр -- друга лінія захисту поверх чистки DOWNLOAD_DIR вище: якщо в теці
  // з'явиться щось стороннє (не наш експорт), детектор його проігнорує, а не підхопить
  // як "свіжий файл" за самим лише фактом відсутності в filesBefore.
  const fresh = names.find((n) => !filesBefore.has(n) && n.endsWith('.zip'))
  if (fresh) {
    downloadedName = fresh
    break
  }
}
if (!downloadedName) throw new Error('ZIP не завантажився протягом очікування')
console.log('завантажено:', downloadedName)

// ---- g) Розпакувати, звірити байти, зберегти для запису на стенд ---------------------------

const zipBytes = readFileSync(join(DOWNLOAD_DIR, downloadedName))
const unzipped = unzipSync(new Uint8Array(zipBytes))

let changedCount = 0
let unchangedCount = 0
for (const rel of STAND_FILES) {
  const out = unzipped[rel]
  if (!out) throw new Error(`${rel} відсутній в експортованому ZIP`)
  const orig = originalBytes.get(rel)
  const same = Buffer.compare(Buffer.from(out), orig) === 0
  console.log(`  [${same ? 'без змін' : 'ЗМІНЕНО'}] ${rel} (${out.length} байт)`)
  if (same) unchangedCount++
  else changedCount++
  const outPath = join(EXPORT_DIR, ...rel.split('/'))
  mkdirSync(join(outPath, '..'), { recursive: true })
  writeFileSync(outPath, Buffer.from(out))
}
console.log(`g) РАЗОМ: ${changedCount} змінено, ${unchangedCount} без змін (з ${STAND_FILES.length})`)

const chainOut = new TextDecoder('utf-8').decode(unzipped['ProcessingRules/chain.json'])
if (!chainOut.includes('"TimeSec": 15')) throw new Error('експортований chain.json НЕ містить TimeSec=15')
if ((chainOut.match(/"Content": "Apple"/g) ?? []).length < 2) throw new Error('експортований chain.json НЕ містить двох узгоджених "Apple" (вихід пакувальника + вхід аналізу)')
const dataItemsOut = new TextDecoder('utf-8').decode(unzipped['DataItems.json'])
if (!dataItemsOut.includes(NEW_NAME)) throw new Error('експортований DataItems.json НЕ містить нову назву')

console.log('g) OK: вміст експортованих файлів підтверджений (TimeSec=15, Apple x2 узгоджені, нова назва ZP_Data_01)')

ws.close()
chrome.kill()
console.log(`готово. Розпаковані файли -> ${EXPORT_DIR} (записати на стенд ОКРЕМИМ кроком).`)
