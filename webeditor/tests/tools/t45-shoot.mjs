// Скріншот-харнес W2.5 Task 4 (вікно «Типовий зразок» + обличчя зразків у картках
// ланцюгів): headless Chrome + сирий CDP -- той самий прийом, що t9-shoot.mjs/
// t8-shoot.mjs. Фікстури будуються ІНЛАЙН (zipSync над JS-об'єктами, не комітяться в
// tests/fixtures/) -- той самий прийом, що T3 (W2.5) використав для сценарію "alarm
// кривого типу" (hand-crafted ZIP через input.files+change-event), обраний тут для
// ВСІХ сценаріїв, щоб не роздувати fixtures/README.md (жорстко задокументований
// provenance-реєстр) заради одноразових смоук-фікстур.
//
// Сценарії (Task 4 Step 3 брифа + прохання оркестратора про "створити SampleTypes.json"):
//   a) Вікно «Зразки»: список УСІХ 31 класів, "не налаштовано" для більшості.
//   b) Правка Name у вікні -> картка в «Ланцюги» (обличчя зразка на вході/виході) оновилась ЖИВЦЕМ.
//   c) Дубль-сценарій: алармовий рядок у вікні + read-only форма + алармовий теґ на картці.
//   d) alarm кривого типу (Enabled: "yes") на вкладці «Файли».
//   e) «Створити SampleTypes.json»: проєкт БЕЗ файлу -> кнопка -> файл зʼявляється -> Зберегти -> ZIP.
//
// Запуск: `node tests/tools/t45-shoot.mjs` (з webeditor/, vite preview має вже працювати на :4173).

import { unzipSync, zipSync } from 'fflate'
import { spawn } from 'child_process'
import { writeFileSync, mkdtempSync, readFileSync, existsSync, readdirSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = process.env.T45_SHOOT_OUT || 'E:/TMP/claude/E--dayzmod/ef2600b9-21a8-43d6-8043-cf5a4904c3ec/scratchpad/t45-shots'
const DOWNLOAD_DIR = process.env.T45_DOWNLOAD_DIR || join(OUT, 'downloads')
const PORT = 9345
const URL = 'http://localhost:4173/'
const DIST = 'E:/dayzmod/webeditor/dist'
const FIXTURES = 'E:/dayzmod/webeditor/tests/fixtures'

mkdirSync(OUT, { recursive: true })
mkdirSync(DOWNLOAD_DIR, { recursive: true })

// ---- 1. Фікстури (інлайн, не комітяться) --------------------------------------------------

const chainJson = readFileSync(join(FIXTURES, 'live', 'chain.json'), 'utf8')
const enc = (s) => new TextEncoder().encode(s)

// (a)/(b): нормальна SampleTypes.json -- ZP_Sample налаштований (той самий клас, що виходить
// із chain_pack_chimera і входить у chain_analyze_chimera у chain.json), решта 30 -- ні.
const sampleTypesNormal = JSON.stringify({
  ConfigVersion: 1,
  Items: [{ Id: 'ZP_Sample', Enabled: true, Name: 'Тканинний зразок', Description: 'Свіжовідібраний біологічний зразок' }],
})
const zipNormal = zipSync({
  'ProcessingRules/chain.json': enc(chainJson),
  'SampleTypes.json': enc(sampleTypesNormal),
})
writeFileSync(join(DIST, 't45-normal.zip'), zipNormal)
console.log('фікстура (нормальна) зібрана:', zipNormal.length, 'байт')

// (c): дубль Id -- два записи 'ZP_Sample' з різними Name, last-wins.
const sampleTypesDup = JSON.stringify({
  ConfigVersion: 1,
  Items: [
    { Id: 'ZP_Sample', Enabled: true, Name: 'Перший запис (буде видалений)', Description: '' },
    { Id: 'ZP_Sample', Enabled: true, Name: 'Останній запис (виживе)', Description: '' },
  ],
})
const zipDup = zipSync({
  'ProcessingRules/chain.json': enc(chainJson),
  'SampleTypes.json': enc(sampleTypesDup),
})
writeFileSync(join(DIST, 't45-dup.zip'), zipDup)
console.log('фікстура (дублікат) зібрана:', zipDup.length, 'байт')

// (d): хибнотипізоване поле Enabled -- рядок замість bool -> alarm severity (W2.5 Task 3).
const sampleTypesWrongType = JSON.stringify({
  ConfigVersion: 1,
  Items: [{ Id: 'ZP_Sample_02', Enabled: 'yes', Name: 'Зразок', Description: '' }],
})
const zipWrongType = zipSync({ 'SampleTypes.json': enc(sampleTypesWrongType) })
writeFileSync(join(DIST, 't45-wrongtype.zip'), zipWrongType)
console.log('фікстура (кривий тип) зібрана:', zipWrongType.length, 'байт')

// (e): проєкт БЕЗ SampleTypes.json ВЗАГАЛІ -- лише chain.json.
const zipNoFile = zipSync({ 'ProcessingRules/chain.json': enc(chainJson) })
writeFileSync(join(DIST, 't45-nofile.zip'), zipNoFile)
console.log('фікстура (без файлу) зібрана:', zipNoFile.length, 'байт')

// ---- 2. headless Chrome + сирий CDP ---------------------------------------------------------

const profile = mkdtempSync(join(tmpdir(), 't45shoot-'))
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

async function clickTab(label) {
  const found = await evalJs(`(() => {
    const btn = [...document.querySelectorAll('.tab-button')].find((b) => b.textContent.includes(${JSON.stringify(label)}))
    if (!btn) return false
    btn.click()
    return true
  })()`)
  if (!found) throw new Error(`вкладка '${label}' не знайдена`)
  await sleep(900) // elk-розкладка (Ланцюги) асинхронна; запас однаковий для всіх вкладок
}

function textOfSampleFaceTags() {
  return evalJs(`[...document.querySelectorAll('.sample-face-tag')].map((el) => el.textContent.trim())`)
}

async function selectSampleRow(classname) {
  const found = await evalJs(`(() => {
    const btn = [...document.querySelectorAll('.sample-types-list .row-select')].find((b) => b.textContent.trim() === ${JSON.stringify(classname)})
    if (!btn) return false
    btn.click()
    return true
  })()`)
  if (!found) throw new Error(`рядок '${classname}' не знайдено в реєстрі типів зразків`)
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

async function textOfWarnings() {
  return evalJs(`[...document.querySelectorAll('ul.warnings li')].map((el) => ({ text: el.textContent.trim(), alarm: el.className.includes('alarm') }))`)
}

async function clickFileRow(pathIncludes) {
  const found = await evalJs(`(() => {
    const btn = [...document.querySelectorAll('table.file-list .row-select')].find((b) => b.textContent.includes(${JSON.stringify(pathIncludes)}))
    if (!btn) return false
    btn.click()
    return true
  })()`)
  if (!found) throw new Error(`рядок файлу '${pathIncludes}' не знайдено на вкладці Файли`)
  await sleep(150)
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

// ---- a) Вікно «Зразки»: усі 31 класи, "не налаштовано" для більшості --------------------

await injectZip('t45-normal.zip')
await clickTab('Зразки')
await shot('t45-a0-window-list.png')

const rowCount = await evalJs(`document.querySelectorAll('.sample-types-list tbody tr').length`)
console.log('a) рядків у реєстрі типів зразків:', rowCount)
if (rowCount !== 31) throw new Error(`очікувалось 31 рядок (ZP_Sample + ZP_Sample_01..30), знайдено ${rowCount}`)

const unconfiguredCount = await evalJs(`[...document.querySelectorAll('.sample-types-list tbody tr td .hint')].filter((el) => el.textContent.includes('не налаштовано')).length`)
console.log('a) "не налаштовано" рядків:', unconfiguredCount)
if (unconfiguredCount !== 30) throw new Error(`очікувалось 30 ненастроєних рядків (усе, крім ZP_Sample), знайдено ${unconfiguredCount}`)

await selectSampleRow('ZP_Sample_01')
await shot('t45-a1-unconfigured-detail.png')
const unconfiguredIndicator = await evalJs(`(() => {
  const p = [...document.querySelectorAll('.sample-type-detail .indicator')].find((el) => el.textContent.includes('не налаштований'))
  return !!p
})()`)
if (!unconfiguredIndicator) throw new Error('деталь-панель НЕ показала "не налаштований" для ZP_Sample_01')
console.log('a) OK: 31 рядок, 30 ненастроєних, деталь-панель чесно показує стан')

// ---- b) Правка Name у вікні -> обличчя зразка на картці «Ланцюги» оновилось живцем --------

await clickTab('Ланцюги')
await shot('t45-b0-graph-before-rename.png')
const facesBefore = await textOfSampleFaceTags()
console.log('b) обличчя зразків на полотні ДО правки:', facesBefore)
if (!facesBefore.some((t) => t.includes('Тканинний зразок'))) {
  throw new Error('картка НЕ показала ігрове ім\'я налаштованого зразка ZP_Sample (ДО правки)')
}

await clickTab('Зразки')
await selectSampleRow('ZP_Sample')
const nameBefore = await evalJs(`document.getElementById('st-name')?.value ?? null`)
console.log('b) st-name у формі =', nameBefore)
if (nameBefore !== 'Тканинний зразок') throw new Error('форма не заповнилась поточним Name')

const NEW_NAME = 'Тканинний зразок (T45 SMOKE)'
await setPlainFieldValue('st-name', NEW_NAME)
await shot('t45-b1-name-edited.png')

await clickTab('Ланцюги')
await shot('t45-b2-graph-after-rename.png')
const facesAfter = await textOfSampleFaceTags()
console.log('b) обличчя зразків на полотні ПІСЛЯ правки:', facesAfter)
if (!facesAfter.some((t) => t.includes(NEW_NAME))) {
  throw new Error('картка НЕ оновилась живцем після правки Name у вікні «Зразки»')
}
// Обличчя мало з'явитися і на ВХОДІ (chain_analyze_chimera), і на ВИХОДІ (chain_pack_chimera)
// -- рівно дві картки читають той самий клас 'ZP_Sample'.
const matchCount = facesAfter.filter((t) => t.includes(NEW_NAME)).length
console.log('b) карток з новим ім\'ям:', matchCount)
if (matchCount < 2) throw new Error('очікувалось оновлення і на вході, і на виході (мінімум 2 теґи), знайдено ' + matchCount)
console.log('b) OK: правка Name з вікна «Зразки» одразу видна на ОБОХ позиціях картки (вхід і вихід)')

// ---- c) Дубль-сценарій: алармовий рядок у вікні + read-only форма + алармовий теґ на картці --

await injectZip('t45-dup.zip')
await clickTab('Зразки')
await shot('t45-c0-window-duplicate.png')

const dupRowText = await evalJs(`(() => {
  const rows = [...document.querySelectorAll('.sample-types-list tbody tr')]
  const row = rows.find((r) => r.textContent.includes('ZP_Sample') && r.textContent.includes('дубль Id') && !r.textContent.includes('ZP_Sample_'))
  return row ? row.textContent.trim() : null
})()`)
console.log('c) рядок ZP_Sample у реєстрі:', dupRowText)
if (!dupRowText || !dupRowText.includes('дубль Id')) throw new Error('реєстр НЕ показав "дубль Id" для ZP_Sample')

await selectSampleRow('ZP_Sample')
await shot('t45-c1-detail-duplicate-banner.png')
const dupBannerVisible = await evalJs(`(() => {
  const p = [...document.querySelectorAll('.indicator.alarm')].find((el) => el.textContent.includes('Дублікат Id'))
  return !!p
})()`)
if (!dupBannerVisible) throw new Error('банер "Дублікат Id" НЕ показаний у деталь-панелі')
const nameFieldDisabled = await evalJs(`(() => {
  const el = document.getElementById('st-name')
  return el ? el.matches(':disabled') : null
})()`)
console.log('c) st-name матчить :disabled =', nameFieldDisabled)
if (nameFieldDisabled !== true) throw new Error('форма НЕ вимкнена при дублікаті Id -- має бути лише для перегляду')

await clickTab('Ланцюги')
await shot('t45-c2-graph-duplicate-badge.png')
const facesDup = await textOfSampleFaceTags()
console.log('c) обличчя зразків на полотні (дублікат):', facesDup)
if (!facesDup.some((t) => t.includes('ZP_Sample') && t.includes('дубль Id'))) {
  throw new Error('картка НЕ показала алармовий маркер "дубль Id" для ZP_Sample на вході/виході')
}
console.log('c) OK: реєстр + деталь-панель + картка узгоджено показують дублікат')

// ---- d) alarm кривого типу (Enabled: "yes") на вкладці «Файли» ---------------------------

await injectZip('t45-wrongtype.zip')
await clickTab('Файли')
await shot('t45-d0-files-tab.png')

await clickFileRow('SampleTypes.json')
await shot('t45-d1-file-detail-alarm.png')
const warnings = await textOfWarnings()
console.log('d) попередження файлу SampleTypes.json:', warnings)
const alarmWarning = warnings.find((w) => w.alarm && w.text.includes('Enabled'))
if (!alarmWarning) throw new Error('попередження про хибний тип Enabled НЕ позначене alarm (severity)')
console.log('d) OK: alarm-рівень для хибнотипізованого Enabled видно на вкладці «Файли»')

// ---- e) «Створити SampleTypes.json»: проєкт БЕЗ файлу -> кнопка -> файл зʼявляється -------

await injectZip('t45-nofile.zip')
await clickTab('Зразки')
await shot('t45-e0-window-no-file.png')

const hasCreateButton = await evalJs(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Створити SampleTypes.json')`)
if (!hasCreateButton) throw new Error('кнопка "Створити SampleTypes.json" відсутня для проєкту без цього файлу')
const tableExistsBefore = await evalJs(`!!document.querySelector('.sample-types-list table')`)
if (tableExistsBefore) throw new Error('таблиця реєстру НЕ мала б рендеритись, поки SampleTypes.json відсутній у проєкті')

await clickButtonWithText('Створити SampleTypes.json')
await shot('t45-e1-window-file-created.png')
const rowCountAfterCreate = await evalJs(`document.querySelectorAll('.sample-types-list tbody tr').length`)
console.log('e) рядків одразу після створення файлу:', rowCountAfterCreate)
if (rowCountAfterCreate !== 31) throw new Error(`очікувалось 31 рядок одразу після створення файлу, знайдено ${rowCountAfterCreate}`)

// Зберегти -> Завантажити ZIP -> перевірити канонічний вміст щойно створеного файлу.
await evalJs(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Зберегти зміни'))
  btn.click()
})()`)
await sleep(400)

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
  const fresh = names.find((n) => !filesBefore.has(n) && !n.endsWith('.crdownload'))
  if (fresh) {
    downloadedName = fresh
    break
  }
}
if (!downloadedName) throw new Error('ZIP не завантажився в ' + DOWNLOAD_DIR + ' протягом очікування')
console.log('e) завантажено:', downloadedName)

const zipBytes = readFileSync(join(DOWNLOAD_DIR, downloadedName))
const unzipped = unzipSync(new Uint8Array(zipBytes))
const sampleTypesOut = unzipped['SampleTypes.json']
if (!sampleTypesOut) throw new Error('SampleTypes.json відсутній в експортованому ZIP')
const sampleTypesOutText = new TextDecoder('utf-8').decode(sampleTypesOut)
console.log('e) експортований SampleTypes.json:', JSON.stringify(sampleTypesOutText))

const CANONICAL_EMPTY = '{\n    "ConfigVersion": 1,\n    "Items": []\n}'
if (sampleTypesOutText !== CANONICAL_EMPTY) {
  throw new Error('експортований SampleTypes.json НЕ канонічний порожній документ: ' + sampleTypesOutText)
}
console.log('e) OK: щойно створений SampleTypes.json зберігся й експортувався канонічними байтами')

ws.close()
chrome.kill()
console.log('готово, скріншотів: 12')
