// Скріншот-харнес T6 (RulePanel): headless Chrome + сирий CDP — той самий прийом, що
// t5-shoot.mjs (T5). Сценарій: вибір картки → панель відкрита й заповнена → зламати
// Content виходу → ребро/лампа розриву LIVE → полагодити назад → CfgMagazines у вході →
// інлайн-помилка на полі → відкат → правка Notes → Зберегти → Завантажити ZIP → перевірка
// байт-канонічності експортованого файлу в Node (fflate). Запуск: `node
// tests/tools/t6-shoot.mjs` (з webeditor/, vite preview має вже працювати на :4173).

import { unzipSync, zipSync } from 'fflate'
import { spawn } from 'child_process'
import { writeFileSync, mkdtempSync, readFileSync, existsSync, readdirSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = process.env.T6_SHOOT_OUT || 'E:/TMP/claude/E--dayzmod/ef2600b9-21a8-43d6-8043-cf5a4904c3ec/scratchpad/t6-shots'
const DOWNLOAD_DIR = process.env.T6_DOWNLOAD_DIR || join(OUT, 'downloads')
const PORT = 9335
const URL = 'http://localhost:4173/'
const DIST = 'E:/dayzmod/webeditor/dist'
const FIXTURES = 'E:/dayzmod/webeditor/tests/fixtures'

mkdirSync(OUT, { recursive: true })
mkdirSync(DOWNLOAD_DIR, { recursive: true })

// ---- 1. Фікстура: chain.json (той самий "живий" пакувальник->аналіз ланцюг, що T5) ----

const chainJson = readFileSync(join(FIXTURES, 'live', 'chain.json'), 'utf8')
const zipNormal = zipSync({ 'ProcessingRules/chain.json': new TextEncoder().encode(chainJson) })
writeFileSync(join(DIST, 't6-normal.zip'), zipNormal)
console.log('фікстура зібрана:', zipNormal.length, 'байт')

// ---- 2. headless Chrome + сирий CDP ------------------------------------------------------

const profile = mkdtempSync(join(tmpdir(), 't6shoot-'))
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

// Комітить довільний текст у ZpSelect-поле (allowFree): нативний value-сеттер (обхід
// React tracked-value) + подія 'input' (React onChange), потім mousedown ПОЗА полем --
// той самий шлях commitOrRevert(), яким сама панель комітить вільний текст.
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

// Textarea/plain <input type=text> контрольовані НАПРЯМУ через onChange (без blur-комиту) --
// та сама нативна-value-сеттер+input-подія техніка, без наступного mousedown.
async function setPlainFieldValue(elementId, text, tag = 'HTMLTextAreaElement') {
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

async function hasBreakLamp() {
  return evalJs(`document.querySelectorAll('.break-edge').length`)
}

async function alarmMessagesFor(inputId) {
  return evalJs(`(() => {
    const el = document.getElementById('${inputId}')
    if (!el) return null
    const field = el.closest('.rule-field')
    if (!field) return []
    return [...field.querySelectorAll('.field-message-alarm')].map((n) => n.textContent)
  })()`)
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
// Дозволити завантаження файлів у DOWNLOAD_DIR -- headless Chrome без цього тихо
// ігнорує клік по <a download>, і файл ніколи не з'являється на диску.
await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOAD_DIR })

await send('Page.navigate', { url: URL })
await sleep(1200)

// ---- a) Вибір картки -- панель відкрита й заповнена ----------------------------------------

await injectZip('t6-normal.zip')
await clickChainsTab()
await shot('t6-a0-graph-before-select.png')

await clickRuleCard('chain_pack_chimera')
await shot('t6-a1-panel-filled.png')

const idValue = await fieldValue('rp-id')
const deviceValue = await fieldValue('rp-device')
const outputContentValue = await fieldValue('rp-out-content-0')
const inputClassnameBefore = await fieldValue('rp-input-classname')
console.log('a) Id =', idValue, '| Device =', deviceValue, '| Outputs[0].Content =', outputContentValue, '| InputItem.Classname =', inputClassnameBefore)
if (idValue !== 'chain_pack_chimera') throw new Error('панель не заповнилась Id вибраного правила')
if (outputContentValue !== 'chimera_claw') throw new Error('панель не показала поточний Content виходу')

// ---- b) Зламати Content виходу -- ребро зникає, лампа розриву з'являється LIVE -------------

const breaksBefore = await hasBreakLamp()
await setZpSelectValue('rp-out-content-0', 'chimera_claw_BROKEN_BY_T6_SMOKE')
await sleep(400)
const breaksAfterBreak = await hasBreakLamp()
console.log('b) розривів на полотні: до =', breaksBefore, ', після зламу =', breaksAfterBreak)
if (!(breaksAfterBreak > breaksBefore)) throw new Error('зламаний Content НЕ породив розрив на графі -- живий граф не оновився')
await shot('t6-b-broken-edge-live.png')

// ---- c) Полагодити назад -- ребро повертається ----------------------------------------------

await setZpSelectValue('rp-out-content-0', 'chimera_claw')
await sleep(400)
const breaksAfterFix = await hasBreakLamp()
console.log('c) розривів після полагодження =', breaksAfterFix)
if (breaksAfterFix !== breaksBefore) throw new Error('полагоджений Content НЕ прибрав розрив -- живий граф не оновився назад')
await shot('t6-c-fixed-edge-live.png')

// ---- d) CfgMagazines у вході -- інлайн-помилка на полі --------------------------------------

await setZpSelectValue('rp-input-classname', 'DefaultMagazine')
await sleep(200)
const magazineErrors = await alarmMessagesFor('rp-input-classname')
console.log('d) помилки на InputItem.Classname (CfgMagazines) =', magazineErrors)
if (!magazineErrors || !magazineErrors.some((m) => /CfgMagazines/.test(m))) {
  throw new Error('очікувана inline-помилка CfgMagazines НЕ показана на полі InputItem.Classname')
}
await shot('t6-d-cfgmagazines-error.png')

// Відкат -- повертаємо валідний вхід перед збереженням.
await setZpSelectValue('rp-input-classname', 'Apple')
await sleep(200)
const inputClassnameAfterRevert = await fieldValue('rp-input-classname')
console.log('d) InputItem.Classname після відкату =', inputClassnameAfterRevert)
if (inputClassnameAfterRevert !== 'Apple') throw new Error('відкат InputItem.Classname не спрацював')
const magazineErrorsAfterRevert = await alarmMessagesFor('rp-input-classname')
if (magazineErrorsAfterRevert && magazineErrorsAfterRevert.length > 0) throw new Error('помилка CfgMagazines лишилась після відкату')

// ---- Реальна правка, що МАЄ дожити до експорту: Notes ---------------------------------------

const NOTES_MARKER = 'T6 smoke: Notes edited via panel'
await setPlainFieldValue('rp-notes', NOTES_MARKER, 'HTMLTextAreaElement')
await sleep(200)
const notesValue = await fieldValue('rp-notes')
console.log('Notes після правки =', notesValue)
if (notesValue !== NOTES_MARKER) throw new Error('правка Notes не закомітилась')
await shot('t6-e0-before-save.png')

// ---- e) Зберегти -> Завантажити ZIP -> перевірка байт-канонічності в Node -------------------

await evalJs(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Зберегти зміни'))
  btn.click()
})()`)
await sleep(400)

const filesBefore = new Set(existsSync(DOWNLOAD_DIR) ? readdirSync(DOWNLOAD_DIR) : [])
await evalJs(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Завантажити ZIP'))
  if (!btn) throw new Error('кнопка "Завантажити ZIP" не знайдена (backend не zip?)')
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
console.log('завантажено:', downloadedName)

const zipBytes = readFileSync(join(DOWNLOAD_DIR, downloadedName))
const unzipped = unzipSync(new Uint8Array(zipBytes))
const chainOut = unzipped['ProcessingRules/chain.json']
if (!chainOut) throw new Error('ProcessingRules/chain.json відсутній в експортованому ZIP')
const chainOutText = new TextDecoder('utf-8').decode(chainOut)

console.log('розмір експортованого chain.json:', chainOutText.length, 'символів')

if (!chainOutText.includes(NOTES_MARKER)) throw new Error('експортований файл НЕ містить правку Notes')
if (!chainOutText.includes('chimera_claw')) throw new Error('експортований файл НЕ містить полагоджений Content')
if (chainOutText.includes('chimera_claw_BROKEN_BY_T6_SMOKE')) throw new Error('експортований файл усе ще містить зламаний тестовий Content -- відкат не доїхав до збереження')
if (chainOutText.includes('DefaultMagazine')) throw new Error('експортований файл усе ще містить CfgMagazines тестовий клас -- відкат не доїхав до збереження')
if (chainOutText.endsWith('\n')) throw new Error('експортований файл має завершальний LF -- не канонічний формат')

console.log('save/export вміст: OK (Notes-маркер присутній, зламаний тест відкочено, CfgMagazines тест відкочено, без завершального LF)')

writeFileSync(join(OUT, 't6-exported-chain.json'), chainOutText, 'utf8')

ws.close()
chrome.kill()
console.log('готово, скріншотів: 6, chain.json з експортованого ZIP збережено окремо для перевірки idempotency у vitest')
