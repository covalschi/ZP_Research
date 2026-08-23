// Скрипт живої приймалки W2.5 Task 5: headless Chrome + сирий CDP (той самий прийом,
// що t8/t45-shoot.mjs), джерело -- РЕАЛЬНІ 12 конфіг-файлів зі стенду (testserver\
// profiles\ZP_Research, тепер разом із SampleTypes.json -- T3 зауважив, що t8's
// STAND_FILES його не має, бо передував T2). Сценарій:
//   a) імпорт ZIP зі стенду;
//   b) вкладка «Зразки»: налаштувати ZP_Sample_01/ZP_Sample_03/ZP_Sample_17 (кнопка
//      "+ Створити запис" для не налаштованих рядків -> Назва+Опис);
//   c) вкладка «Ланцюги»: chain_pack_chimera.Outputs[0].Classname "ZP_Sample" ->
//      "ZP_Sample_03" через ZpSelect (rp-out-cls-0) -- перевірка, що поле "вміст
//      зразка" (rp-out-content-0, T1/T3 sibling-seam fix) НЕ зникло і зберегло
//      "chimera_claw", і що обличчя картки живцем показало нову назву типу;
//   d) Зберегти -> Завантажити ZIP -> звірка байтів (лише SampleTypes.json і
//      ProcessingRules/chain.json мають змінитись, решта 10 -- байт-у-байт як були);
//   e) розпакувати змінені файли в EXPORT_DIR -- запис на стенд робить ОКРЕМИЙ крок
//      (Bash), як і в T8.
//
// FactionData/PlayerData/ConfigBackup/StaticDevices* НІКОЛИ не потрапляють у ZIP.
//
// Запуск: `node tests/tools/t5-accept.mjs` (з webeditor/, vite preview вже працює на :4173).

import { unzipSync, zipSync } from 'fflate'
import { spawn } from 'child_process'
import { writeFileSync, mkdtempSync, readFileSync, existsSync, readdirSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = process.env.T5_SHOOT_OUT || 'E:/TMP/claude/E--dayzmod/ef2600b9-21a8-43d6-8043-cf5a4904c3ec/scratchpad/t5-acceptance-shots'
const DOWNLOAD_DIR = process.env.T5_DOWNLOAD_DIR || join(OUT, 'downloads')
const EXPORT_DIR = process.env.T5_EXPORT_DIR || join(OUT, 'exported')
const PORT = 9350
const URL = 'http://localhost:4173/'
const DIST = 'E:/dayzmod/webeditor/dist'
const STAND = 'E:/dayzmod/testserver/profiles/ZP_Research'

mkdirSync(OUT, { recursive: true })
rmSync(DOWNLOAD_DIR, { recursive: true, force: true })
mkdirSync(DOWNLOAD_DIR, { recursive: true })
rmSync(EXPORT_DIR, { recursive: true, force: true })
mkdirSync(EXPORT_DIR, { recursive: true })

// ---- 1. Зібрати ZIP із РЕАЛЬНИХ 12 конфіг-файлів стенду (11 з T8 + SampleTypes.json) ----

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

const originalBytes = new Map()
const zipInput = {}
for (const rel of STAND_FILES) {
  const buf = readFileSync(join(STAND, ...rel.split('/')))
  originalBytes.set(rel, buf)
  zipInput[rel] = new Uint8Array(buf)
}
const standZip = zipSync(zipInput)
writeFileSync(join(DIST, 't5-stand.zip'), standZip)
console.log('фікстура зі стенду зібрана:', standZip.length, 'байт,', STAND_FILES.length, 'файлів')

// ---- 2. headless Chrome + сирий CDP ------------------------------------------------------

const profile = mkdtempSync(join(tmpdir(), 't5accept-'))
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

async function fieldValue(elementId) {
  return evalJs(`document.getElementById('${elementId}')?.value ?? null`)
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

function textOfSampleFaceTags() {
  return evalJs(`[...document.querySelectorAll('.sample-face-tag')].map((el) => el.textContent.trim())`)
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

await injectZip('t5-stand.zip')
await shot('t5-a0-imported.png')

// ---- b) Вкладка «Зразки»: 3 налаштовані типи -----------------------------------------------

await clickTab('Зразки')
await shot('t5-b0-window-before.png')

const rowCountBefore = await evalJs(`document.querySelectorAll('.sample-types-list tbody tr').length`)
console.log('b) рядків у реєстрі типів зразків:', rowCountBefore)
if (rowCountBefore !== 31) throw new Error(`очікувалось 31 рядок, знайдено ${rowCountBefore}`)

const SAMPLE_TYPES = [
  { cls: 'ZP_Sample_01', name: 'Біозразок', desc: 'Свіжовідібраний біологічний матеріал невизначеного походження.' },
  { cls: 'ZP_Sample_03', name: 'Аномальний зразок', desc: 'Матеріал із виявленими аномальними властивостями, потребує аналізу.' },
  { cls: 'ZP_Sample_17', name: 'Технічний зразок', desc: 'Фрагмент техногенного походження, взятий для дослідження складу.' },
]

for (const t of SAMPLE_TYPES) {
  await selectSampleRow(t.cls)
  await clickButtonWithText('+ Створити запис')
  await setPlainFieldValue('st-name', t.name)
  await setPlainFieldValue('st-description', t.desc, 'HTMLTextAreaElement')
  await sleep(150)
  const nameNow = await fieldValue('st-name')
  const descNow = await fieldValue('st-description')
  console.log(`b) ${t.cls}: Назва="${nameNow}" Опис="${descNow}"`)
  if (nameNow !== t.name) throw new Error(`${t.cls}: Назва не закомітилась (маю "${nameNow}")`)
  if (descNow !== t.desc) throw new Error(`${t.cls}: Опис не закомітився (маю "${descNow}")`)
}
await shot('t5-b1-three-configured.png')

const configuredCount = await evalJs(`
  [...document.querySelectorAll('.sample-types-list tbody tr')].filter((r) => {
    const cells = r.querySelectorAll('td')
    const nameCell = cells[1]
    return nameCell && !nameCell.textContent.includes('не налаштовано') && !nameCell.textContent.includes('дубль')
  }).length
`)
console.log('b) налаштованих рядків у реєстрі:', configuredCount)
if (configuredCount !== 3) throw new Error(`очікувалось рівно 3 налаштовані рядки, знайдено ${configuredCount}`)
console.log('b) OK: ZP_Sample_01/03/17 налаштовані (Назва+Опис), реєстр показує рівно 3')

// ---- c) Ланцюги: chain_pack_chimera.Outputs[0].Classname -> ZP_Sample_03 -------------------

await clickTab('Ланцюги')
await shot('t5-c0-graph-before.png')
const facesBefore = await textOfSampleFaceTags()
console.log('c) обличчя зразків на полотні ДО ретаргету:', facesBefore)

await clickRuleCard('chain_pack_chimera')
await shot('t5-c1-panel-before.png')
const clsBefore = await fieldValue('rp-out-cls-0')
const contentBefore = await fieldValue('rp-out-content-0')
console.log('c) Outputs[0].Classname до =', clsBefore, '| Outputs[0].Content до =', contentBefore)
if (clsBefore !== 'ZP_Sample') throw new Error(`несподіваний початковий класнейм виходу: ${clsBefore}`)
if (contentBefore !== 'chimera_claw') throw new Error('несподіваний початковий Content виходу')

await setZpSelectValue('rp-out-cls-0', 'ZP_Sample_03')
await sleep(300)
const clsAfter = await fieldValue('rp-out-cls-0')
console.log('c) Outputs[0].Classname після ретаргету =', clsAfter)
if (clsAfter !== 'ZP_Sample_03') throw new Error(`ретаргет НЕ закомітився -- очікував ZP_Sample_03, маю ${clsAfter}`)

// T1/T3 sibling-seam fix, живцем: поле "вміст зразка" НЕ мало зникнути (isSampleClass
// має розпізнавати ZP_Sample_03 як члена родини ZP_Sample_Base, а не лише сумісний ZP_Sample).
const contentFieldExists = await evalJs(`!!document.getElementById('rp-out-content-0')`)
if (!contentFieldExists) throw new Error('поле "вміст зразка" ЗНИКЛО після ретаргету на ZP_Sample_03 -- шов-баг isSampleClass повернувся')
const contentAfter = await fieldValue('rp-out-content-0')
console.log('c) поле "вміст зразка" присутнє, Content =', contentAfter)
if (contentAfter !== 'chimera_claw') throw new Error(`Content виходу НЕ зберігся при ретаргеті -- маю "${contentAfter}"`)
await shot('t5-c2-panel-after-retarget.png')

const facesAfter = await textOfSampleFaceTags()
console.log('c) обличчя зразків на полотні ПІСЛЯ ретаргету:', facesAfter)
if (!facesAfter.some((t) => t.includes('Аномальний зразок'))) {
  throw new Error('картка НЕ показала нову назву типу ("Аномальний зразок") після ретаргету класнейму виходу')
}
await shot('t5-c3-graph-after-retarget.png')
console.log('c) OK: ретаргет виходу chain_pack_chimera на ZP_Sample_03 закомітився, поле вмісту вціліло, обличчя картки оновилось живцем')

// ---- d) Зберегти -> Завантажити ZIP ---------------------------------------------------------

await evalJs(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Зберегти зміни'))
  btn.click()
})()`)
await sleep(400)
await shot('t5-d0-before-download.png')

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
  const fresh = names.find((n) => !filesBefore.has(n) && n.endsWith('.zip'))
  if (fresh) {
    downloadedName = fresh
    break
  }
}
if (!downloadedName) throw new Error('ZIP не завантажився протягом очікування')
console.log('завантажено:', downloadedName)

// ---- e) Розпакувати, звірити байти, зберегти лише ЗМІНЕНІ файли для запису на стенд --------

const zipBytes = readFileSync(join(DOWNLOAD_DIR, downloadedName))
const unzipped = unzipSync(new Uint8Array(zipBytes))

let changedCount = 0
let unchangedCount = 0
const changedFiles = []
for (const rel of STAND_FILES) {
  const out = unzipped[rel]
  if (!out) throw new Error(`${rel} відсутній в експортованому ZIP`)
  const orig = originalBytes.get(rel)
  const same = Buffer.compare(Buffer.from(out), orig) === 0
  console.log(`  [${same ? 'без змін' : 'ЗМІНЕНО'}] ${rel} (${out.length} байт)`)
  if (same) {
    unchangedCount++
  } else {
    changedCount++
    changedFiles.push(rel)
    const outPath = join(EXPORT_DIR, ...rel.split('/'))
    mkdirSync(join(outPath, '..'), { recursive: true })
    writeFileSync(outPath, Buffer.from(out))
  }
}
console.log(`e) РАЗОМ: ${changedCount} змінено, ${unchangedCount} без змін (з ${STAND_FILES.length})`)
console.log('e) ЗМІНЕНІ файли:', changedFiles.join(', '))

const expectedChanged = new Set(['SampleTypes.json', 'ProcessingRules/chain.json'])
if (changedFiles.length !== expectedChanged.size || !changedFiles.every((f) => expectedChanged.has(f))) {
  throw new Error(`очікував рівно змінені {SampleTypes.json, ProcessingRules/chain.json}, маю {${changedFiles.join(', ')}}`)
}

const sampleTypesOut = new TextDecoder('utf-8').decode(unzipped['SampleTypes.json'])
console.log('e) SampleTypes.json (експорт):', sampleTypesOut)
if (!sampleTypesOut.includes('Біозразок') || !sampleTypesOut.includes('Аномальний зразок') || !sampleTypesOut.includes('Технічний зразок')) {
  throw new Error('експортований SampleTypes.json НЕ містить усіх трьох назв')
}
const chainOut = new TextDecoder('utf-8').decode(unzipped['ProcessingRules/chain.json'])
if (!chainOut.includes('"Classname": "ZP_Sample_03"')) throw new Error('експортований chain.json НЕ містить ретаргету на ZP_Sample_03')
if (!chainOut.includes('"Content": "chimera_claw"')) throw new Error('експортований chain.json втратив Content="chimera_claw"')
console.log('e) OK: вміст експортованих файлів підтверджений')

ws.close()
chrome.kill()
console.log(`готово. Змінені файли -> ${EXPORT_DIR} (записати на стенд ОКРЕМИМ кроком).`)
