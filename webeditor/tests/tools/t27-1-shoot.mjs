// Скріншот-харнес W2.7 Task 1 («жорсткий гейт експорту при кривих типах») — той самий
// прийом headless Chrome + сирий CDP, що t9/t26-x-shoot.mjs. Фікстура — РУКОПИСНО збитий
// ProcessingRules/broken.json: рядок "Enabled": "так" замість bool (alarm) + відсутній ключ
// "Notes" (plain warn) в тій самій правилі, поруч — незайманий gold Settings.json.
// Сценарій:
//   1) імпорт ZIP -> вкладка «Файли»: рядок broken.json з ЧЕРВОНОЮ лампою (2 попередження,
//      1 alarm), панель гейта видима одразу під клавішами пульта;
//   2) клік по шляху в панелі гейта -> перемикає на «Файли» і вибирає файл (навігація);
//   3) Export заблоковано ВЖЕ ПРИ dirtyCount=0 (саме та небезпека, що описана в
//      обґрунтуванні: недирти-файл ішов би ОРИГІНАЛЬНИМИ битими байтами);
//   4) «Канонізувати файл» на Settings.json (unrelated, без alarm) -> dirtyCount=1, але
//      Save лишається заблокованим -- гейт незалежний від dirtyCount;
//   5) «Полагодити все» -> лампа рядка broken.json амбер (1 warn лишився, alarm пропав),
//      панель гейта зникає, Save/Export розблоковані;
//   6) Зберегти -> Завантажити ZIP -> розпакувати -> сирі перевірки: broken.json
//      "Enabled": 0 (не "так"!) канонічним форматом, Notes:"" присутній; Settings.json
//      байт-в-байт як gold (ідемпотентна канонізація файлу без реальних правок).
// Запуск: `node tests/tools/t27-1-shoot.mjs` (vite preview на :4173 мусить обслуговувати
// СВІЖИЙ dist -- `npm run build` ПЕРЕД запуском).

import { zipSync, unzipSync } from 'fflate'
import { spawn } from 'child_process'
import { writeFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = process.env.T27_1_SHOOT_OUT || 'E:/TMP/claude/E--dayzmod/ef2600b9-21a8-43d6-8043-cf5a4904c3ec/scratchpad/t27-shots'
const DOWNLOAD_DIR = join(OUT, 'downloads')
const EXPORT_DIR = join(OUT, 'exported')
const PORT = 9351
const URL = 'http://localhost:4173/'
const DIST = 'E:/dayzmod/webeditor/dist'
const FIXTURES = 'E:/dayzmod/webeditor/tests/fixtures'

mkdirSync(OUT, { recursive: true })
rmSync(DOWNLOAD_DIR, { recursive: true, force: true })
mkdirSync(DOWNLOAD_DIR, { recursive: true })
rmSync(EXPORT_DIR, { recursive: true, force: true })
mkdirSync(EXPORT_DIR, { recursive: true })

// ---- Фікстура: gold Settings.json (незайманий) + рукописно збитий broken.json ---------------
const settingsGold = readFileSync(join(FIXTURES, 'gold', 'Settings.json'))
const brokenRuleJson = JSON.stringify(
  {
    ConfigVersion: 1,
    Rules: [
      {
        Id: 'broken_rule',
        Enabled: 'так', // alarm: bool-поле, рядок замість 1/0/true/false
        Device: 'ZP_SampleFridge',
        Mode: 'background',
        InputItem: { Classname: 'Apple', Quantity: 1, ConsumeInput: 1, Content: '' },
        BasePurityMin: 0.5,
        BasePurityMax: 0.5,
        TimeSec: 10.0,
        Consumables: [],
        Outputs: [{ Classname: 'ZP_Sample', Quantity: 1, Chance: 1.0, Content: 'broken_apple' }],
        RequiredNode: '',
        RequiredFactions: [],
        RequiredWorn: [],
        RequiredTools: [],
        // "Notes" НАВМИСНО відсутній -- plain warn ("ключ відсутній"), поруч з alarm вище.
      },
    ],
  },
  null,
  4,
)
const zip = zipSync({
  'Settings.json': new Uint8Array(settingsGold),
  'ProcessingRules/broken.json': new TextEncoder().encode(brokenRuleJson),
})
writeFileSync(join(DIST, 't27-1.zip'), zip)
console.log('фікстуру зібрано:', zip.length, 'байт (Settings.json gold + ProcessingRules/broken.json збитий)')

// ---- headless Chrome + сирий CDP (той самий прийом t9/t26-x-shoot.mjs) ----------------------
const profile = mkdtempSync(join(tmpdir(), 't271shoot-'))
const chrome = spawn(
  CHROME,
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1400,1000', '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank'],
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
await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOAD_DIR.replaceAll('/', '\\') })

await send('Page.navigate', { url: URL })
await sleep(1200)

await evalJs(`window.__t = {
  clickButton(scopeSel, text) {
    const scope = scopeSel ? document.querySelector(scopeSel) : document
    const btn = [...scope.querySelectorAll('button')].find((b) => b.textContent.includes(text))
    if (!btn) throw new Error('кнопка не знайдена: ' + text)
    if (btn.disabled) throw new Error('кнопка дизейблена: ' + text)
    btn.click()
  },
  buttonState(scopeSel, text) {
    const scope = scopeSel ? document.querySelector(scopeSel) : document
    const btn = [...scope.querySelectorAll('button')].find((b) => b.textContent.includes(text))
    return btn ? { found: true, disabled: btn.disabled, title: btn.title } : { found: false }
  },
  rowByPath(path) {
    return [...document.querySelectorAll('table.file-list tbody tr')].find((r) => r.querySelector('.row-select')?.textContent === path)
  },
  rowInfo(path) {
    const row = this.rowByPath(path)
    if (!row) return null
    return {
      warnCount: row.querySelector('.warn-count, .warn-zero')?.textContent,
      alarmLamp: !!row.querySelector('.warn-count.alarm'),
      dirty: !!row.querySelector('.dirty-badge'),
    }
  },
  alarmPanel() {
    const p = document.querySelector('.alarm-gate-panel')
    if (!p) return null
    return {
      title: p.querySelector('.alarm-gate-title')?.textContent,
      items: [...p.querySelectorAll('.alarm-gate-item code')].map((c) => c.textContent),
    }
  },
}; true`)

// ==== 1) Імпорт ZIP =============================================================================
await evalJs(`(async () => {
  const res = await fetch('/t27-1.zip')
  const buf = await res.arrayBuffer()
  const dt = new DataTransfer()
  dt.items.add(new File([buf], 't27-1.zip', { type: 'application/zip' }))
  const input = document.getElementById('import-zip-input')
  input.files = dt.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
})()`)
await sleep(900)

const panel0 = await evalJs(`window.__t.alarmPanel()`)
console.log('панель гейта одразу після імпорту:', JSON.stringify(panel0))
if (!panel0) throw new Error('очікував аварійну панель одразу після імпорту збитого ZIP')
if (!panel0.items.includes('ProcessingRules/broken.json')) throw new Error('панель мала перелічити ProcessingRules/broken.json: ' + JSON.stringify(panel0.items))
await shot('t27-1-00-panel-after-import.png')

// «Файли»: рядок broken.json — червона лампа, 2 попередження
await evalJs(`[...document.querySelectorAll('.tab-button')].find((b) => b.textContent.includes('Файли')).click()`)
await sleep(400)
await evalJs(`window.__t.rowByPath('ProcessingRules/broken.json').querySelector('.row-select').click()`)
await sleep(400)
const rowInfo0 = await evalJs(`window.__t.rowInfo('ProcessingRules/broken.json')`)
console.log('рядок broken.json одразу після імпорту:', JSON.stringify(rowInfo0))
if (!rowInfo0.alarmLamp) throw new Error('очікував червону (alarm) лампу на рядку broken.json')
if (rowInfo0.warnCount !== '2') throw new Error('очікував 2 попередження на broken.json, є ' + rowInfo0.warnCount)
await shot('t27-1-01-files-tab-alarm-row.png')

// ==== 2) Клік по шляху в панелі гейта -> перемикання на «Файли» + вибір файлу =================
await evalJs(`[...document.querySelectorAll('.tab-button')].find((b) => b.textContent.includes('Ланцюги')).click()`)
await sleep(400)
const tabBeforeClick = await evalJs(`document.querySelector('#tab-chains').getAttribute('aria-selected')`)
console.log('вкладка ПЕРЕД кліком по панелі:', tabBeforeClick)
await evalJs(`[...document.querySelectorAll('.alarm-gate-item')].find((b) => b.textContent.includes('broken.json')).click()`)
await sleep(400)
const navResult = await evalJs(`({
  filesTabSelected: document.querySelector('#tab-files').getAttribute('aria-selected'),
  detailPath: document.querySelector('.detail h2')?.textContent,
})`)
console.log('після кліку по панелі гейта (навігація):', JSON.stringify(navResult))
if (navResult.filesTabSelected !== 'true') throw new Error('клік по панелі мав перемкнути на вкладку «Файли»')
if (navResult.detailPath !== 'ProcessingRules/broken.json') throw new Error('клік по панелі мав вибрати broken.json, вибрано: ' + navResult.detailPath)

// ==== 3) Export заблоковано ВЖЕ при dirtyCount=0 (сама небезпека з обґрунтування) ==============
const zipBtn0 = await evalJs(`window.__t.buttonState(null, 'Завантажити ZIP')`)
console.log('стан «Завантажити ZIP» при dirtyCount=0, alarm=1:', JSON.stringify(zipBtn0))
if (!zipBtn0.found) throw new Error('кнопка «Завантажити ZIP» не знайдена')
if (!zipBtn0.disabled) throw new Error('«Завантажити ZIP» мала бути заблокована ще ДО будь-якої правки -- саме та небезпека, що недирти-файл пішов би оригінальними битими байтами')
const saveBtn0 = await evalJs(`window.__t.buttonState(null, 'Зберегти зміни')`)
console.log('стан «Зберегти зміни» при dirtyCount=0:', JSON.stringify(saveBtn0))

// ==== 4) «Канонізувати файл» на Settings.json (unrelated) -> dirty=1, Save лишається блокованим ==
await evalJs(`window.__t.rowByPath('Settings.json').querySelector('.row-select').click()`)
await sleep(300)
await evalJs(`window.__t.clickButton(null, 'Канонізувати файл')`)
await sleep(400)
const settingsRow = await evalJs(`window.__t.rowInfo('Settings.json')`)
console.log('Settings.json після «Канонізувати файл»:', JSON.stringify(settingsRow))
if (!settingsRow.dirty) throw new Error('Settings.json мав стати dirty після «Канонізувати файл»')
const saveBtn1 = await evalJs(`window.__t.buttonState(null, 'Зберегти зміни')`)
console.log('«Зберегти зміни» ПІСЛЯ dirty=1, alarm ще присутній:', JSON.stringify(saveBtn1))
if (!saveBtn1.disabled) throw new Error('«Зберегти зміни» мала лишитись заблокованою -- гейт незалежний від dirtyCount, поки є alarm-файл')
await shot('t27-1-02-save-blocked-despite-dirty.png')

// ==== 5) «Полагодити все» ========================================================================
await evalJs(`window.__t.clickButton('.alarm-gate-panel', 'Полагодити все')`)
await sleep(500)
const panelAfter = await evalJs(`window.__t.alarmPanel()`)
console.log('панель гейта після «Полагодити все»:', JSON.stringify(panelAfter))
if (panelAfter !== null) throw new Error('панель гейта мала зникнути після ремонту, лишилась: ' + JSON.stringify(panelAfter))

const rowInfo1 = await evalJs(`window.__t.rowInfo('ProcessingRules/broken.json')`)
console.log('рядок broken.json після ремонту:', JSON.stringify(rowInfo1))
if (rowInfo1.alarmLamp) throw new Error('лампа broken.json мала стати амбер (не alarm) після ремонту')
if (rowInfo1.warnCount !== '1') throw new Error('очікував 1 попередження (plain warn про Notes) на broken.json після ремонту, є ' + rowInfo1.warnCount)
if (!rowInfo1.dirty) throw new Error('broken.json мав стати dirty після ремонту')

const saveBtn2 = await evalJs(`window.__t.buttonState(null, 'Зберегти зміни')`)
console.log('«Зберегти зміни» після ремонту (мала розблокуватись):', JSON.stringify(saveBtn2))
if (saveBtn2.disabled) throw new Error('«Зберегти зміни» мала розблокуватись після ремонту')
await shot('t27-1-03-repaired-unblocked.png')

// ==== 6) Зберегти -> Завантажити ZIP -> розпакувати -> сирі перевірки байтів ===================
await evalJs(`window.__t.clickButton(null, 'Зберегти зміни')`)
await sleep(700)
const beforeFiles = new Set(readdirSync(DOWNLOAD_DIR))
await evalJs(`window.__t.clickButton(null, 'Завантажити ZIP')`)
let zipName
for (let i = 0; i < 40; i++) {
  await sleep(250)
  const fresh = readdirSync(DOWNLOAD_DIR).find((f) => !beforeFiles.has(f) && f.endsWith('.zip'))
  if (fresh) {
    zipName = fresh
    break
  }
}
if (!zipName) throw new Error('ZIP не завантажився')
console.log('завантажено:', zipName)
const zipBytes = readFileSync(join(DOWNLOAD_DIR, zipName))
const files = unzipSync(new Uint8Array(zipBytes))
for (const [name, bytes] of Object.entries(files)) {
  const full = join(EXPORT_DIR, name)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, bytes)
}
console.log('розпаковано файлів:', Object.keys(files).length, '->', EXPORT_DIR)
await shot('t27-1-04-final-files-tab.png')

// broken.json: канонічний, "Enabled": 0 (не "так"!), Notes присутній як ""
const brokenOut = new TextDecoder().decode(files['ProcessingRules/broken.json'])
console.log('--- ProcessingRules/broken.json (експорт) ---\n' + brokenOut)
if (!/"Enabled": 0/.test(brokenOut)) throw new Error('очікував "Enabled": 0 (канонічний false) в експортованому broken.json')
if (/"так"/.test(brokenOut)) throw new Error('рядок "так" не мав лишитись у експортованому файлі')
if (!/"Notes": ""/.test(brokenOut)) throw new Error('очікував "Notes": "" (нуль-семантика відсутнього ключа) в експортованому broken.json')
// без BOM, без завершального переводу рядка, 4-пробільний відступ -- ознаки канонічного формату (io/jsonWriter.ts)
if (files['ProcessingRules/broken.json'][0] === 0xef) throw new Error('BOM не мав бути присутнім')
if (brokenOut.endsWith('\n')) throw new Error('канонічний формат без завершального переводу рядка')
if (!brokenOut.includes('\n    "ConfigVersion"')) throw new Error('очікував 4-пробільний відступ (канонічний jsonWriter)')

// Settings.json: ремонт без реальних правок -> байт-в-байт як gold (ідемпотентна канонізація)
const settingsOut = files['Settings.json']
const settingsSame = settingsOut.length === settingsGold.length && Buffer.compare(Buffer.from(settingsOut), settingsGold) === 0
console.log('Settings.json експорт == gold байт-в-байт:', settingsSame)
if (!settingsSame) throw new Error('Settings.json після «Канонізувати файл» без реальних правок мав лишитись байт-в-байт як gold-фікстура')

console.log('консольні помилки за сесію:', consoleErrors.length, consoleErrors)
if (consoleErrors.length > 0) throw new Error('консоль не чиста: ' + consoleErrors.join(' | '))
ws.close()
chrome.kill()
console.log('готово — гейт при кривих типах і «Полагодити все» перевірені живцем, експорт байт-каноничний')
