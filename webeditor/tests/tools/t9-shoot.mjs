// Скріншот-харнес T9 (вітрина виходів + DataItemQuickEdit): headless Chrome + сирий CDP --
// той самий прийом, що t5-shoot.mjs/t6-shoot.mjs. Сценарій: картка показує ІГРОВЕ ім'я
// configured-виходу і "не налаштовано" для ненастроєного -> клік по configured відкриває
// квик-редактор, правка Name видна на картці ЖИВЦЕМ -> клік по "не налаштовано" ->
// "створити запис" -> додати нагороду через ZpSelect (пошук типу балів) -> Зберегти ->
// Завантажити ZIP -> DataItems.json з експорту байт-каноничний (parse -> serialize
// ідемпотентно) і містить обидві правки. Запуск: `node tests/tools/t9-shoot.mjs` (з
// webeditor/, vite preview має вже працювати на :4173).

import { unzipSync, zipSync } from 'fflate'
import { spawn } from 'child_process'
import { writeFileSync, mkdtempSync, readFileSync, existsSync, readdirSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = process.env.T9_SHOOT_OUT || 'E:/TMP/claude/E--dayzmod/ef2600b9-21a8-43d6-8043-cf5a4904c3ec/scratchpad/t9-shots'
const DOWNLOAD_DIR = process.env.T9_DOWNLOAD_DIR || join(OUT, 'downloads')
const PORT = 9336
const URL = 'http://localhost:4173/'
const DIST = 'E:/dayzmod/webeditor/dist'
const FIXTURES = 'E:/dayzmod/webeditor/tests/fixtures'

mkdirSync(OUT, { recursive: true })
mkdirSync(DOWNLOAD_DIR, { recursive: true })

// ---- 1. Фікстура: chain.json (4 правила, 2 виходи ZP_Data_01/ZP_Data_61) + DataItems.json
// (лише ZP_Data_01 налаштований -> ZP_Data_61 навмисно ВІДСУТНІЙ, тестує "не налаштовано")
// + PointTypes.json (реальні типи балів для (c) -- пошук ZpSelect має що показати) --------

const chainJson = readFileSync(join(FIXTURES, 'live', 'chain.json'), 'utf8')
const dataItemsJson = readFileSync(join(FIXTURES, 'live', 'DataItems.json'), 'utf8')
const pointTypesJson = readFileSync(join(FIXTURES, 'gold', 'PointTypes.json'), 'utf8')
const zipNormal = zipSync({
  'ProcessingRules/chain.json': new TextEncoder().encode(chainJson),
  'DataItems.json': new TextEncoder().encode(dataItemsJson),
  'PointTypes.json': new TextEncoder().encode(pointTypesJson),
})
writeFileSync(join(DIST, 't9-normal.zip'), zipNormal)
console.log('фікстура зібрана:', zipNormal.length, 'байт')

// Фікстура (e), рев'ю фікс-раунду 1: ТОЙ САМИЙ chain.json, але DataItems.json з ДВОМА
// записами ZP_Data_01 -- перевіряє живцем алармовий data-face-теґ і банер "лише для
// перегляду" квик-редактора (DataItems-duplicate.json).
const dataItemsDupJson = readFileSync(join(FIXTURES, 'live', 'DataItems-duplicate.json'), 'utf8')
const zipDup = zipSync({
  'ProcessingRules/chain.json': new TextEncoder().encode(chainJson),
  'DataItems.json': new TextEncoder().encode(dataItemsDupJson),
  'PointTypes.json': new TextEncoder().encode(pointTypesJson),
})
writeFileSync(join(DIST, 't9-dup.zip'), zipDup)
console.log('фікстура (дублікат) зібрана:', zipDup.length, 'байт')

// ---- 2. headless Chrome + сирий CDP ------------------------------------------------------

const profile = mkdtempSync(join(tmpdir(), 't9shoot-'))
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

function textOfDataFaceTags() {
  return evalJs(`[...document.querySelectorAll('.data-face-tag')].map((el) => el.textContent.trim())`)
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

// IntField (DataItemQuickEdit.tsx) комітить квантоване число на BLUR, не на кожен input --
// той самий буфер-патерн, що RulePanel.FloatField/IntField (T6): 'input' лише оновлює
// локальний текстовий буфер, onCommit спрацьовує в onBlur. Без явного відпускання фокусу
// значення ніколи не долетить до Project.
//
// НАХІДКА (T9): el.blur() у headless Chrome (--headless=new) НЕ породжує подію 'focusout',
// на якій тримається React onBlur, -- ІМОВІРНО тому, що headless-вікно не має справжнього
// OS-фокусу, і рушій вважає документ і так "розфокусованим". Підтверджено інструментальним
// зондом: той самий сценарій з el.blur() НІКОЛИ не викликав commit() (перевірено логом
// усередині DataItemQuickEdit.commit), а el.dispatchEvent(new FocusEvent('focusout',
// {bubbles:true})) -- викликав щоразу. t6-shoot.mjs цей шлях жодного разу не перевіряв
// (там комітяться лише ZpSelect і textarea, обидва без onBlur-буфера) -- тому пастка не
// була знайдена раніше.
async function blurField(elementId) {
  await evalJs(`document.getElementById('${elementId}')?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))`)
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

// Той самий прийом, що t6-shoot.mjs setZpSelectValue -- набирає текст у ZpSelect-поле
// (значення НЕ комітиться, поки не оберуть опцію зі списку чи не зроблять mousedown поза
// полем) і повертає видимі label'и опцій панелі -- саме те, що (c) вимагає перевірити
// ("ZpSelect type search visible").
async function typeIntoZpSelect(elementId, text) {
  const escaped = JSON.stringify(text)
  await evalJs(`(() => {
    const el = document.getElementById('${elementId}')
    el.focus()
    const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
    desc.set.call(el, ${escaped})
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(150)
}

async function zpSelectPanelOptions(elementId) {
  return evalJs(`(() => {
    const el = document.getElementById('${elementId}')
    const root = el.closest('.zp-select')
    const panel = root?.querySelector('.zp-select-panel')
    if (!panel) return null
    return [...panel.querySelectorAll('.zp-select-option-label')].map((n) => n.textContent.trim())
  })()`)
}

async function pickZpSelectFirstOption(elementId) {
  await evalJs(`(() => {
    const el = document.getElementById('${elementId}')
    const root = el.closest('.zp-select')
    const opt = root?.querySelector('.zp-select-option')
    if (!opt) throw new Error('жодної опції в панелі ZpSelect')
    opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  })()`)
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

// ---- a) Картка: ІГРОВЕ ім'я для налаштованого виходу, "не налаштовано" для іншого ----------

await injectZip('t9-normal.zip')
await clickChainsTab()
await shot('t9-a0-graph-loaded.png')

const tagTexts = await textOfDataFaceTags()
console.log('a) data-face-теґи на полотні:', tagTexts)
if (!tagTexts.some((t) => t.includes('Зразок хімерної тканини'))) {
  throw new Error('картка НЕ показала ігрове ім\'я налаштованої заготовки ZP_Data_01')
}
if (!tagTexts.some((t) => t.includes('ZP_Data_61') && t.includes('не налаштовано'))) {
  throw new Error('картка НЕ показала "не налаштовано" для ненастроєного виходу ZP_Data_61')
}
console.log('a) OK: обидва стани data-face видно на полотні')

// ---- b) Клік по configured-теґу -- квик-редактор відкритий і заповнений, правка Name --------

await clickDataFaceTag('Зразок хімерної тканини')
await shot('t9-b0-quickedit-opened.png')

const nameBefore = await fieldValue('di-name')
console.log('b) di-name у квик-редакторі =', nameBefore)
if (nameBefore !== 'Зразок хімерної тканини') throw new Error('квик-редактор не заповнився поточним Name')

const NEW_NAME = 'Зразок хімерної тканини (T9 SMOKE)'
await setPlainFieldValue('di-name', NEW_NAME)
await sleep(250)

const tagTextsAfterRename = await textOfDataFaceTags()
console.log('b) data-face-теґи після перейменування =', tagTextsAfterRename)
if (!tagTextsAfterRename.some((t) => t.includes(NEW_NAME))) {
  throw new Error('картка НЕ оновилась живцем після правки Name у квик-редакторі')
}
await shot('t9-b1-card-updated-live.png')
console.log('b) OK: правка Name з квик-редактора одразу видна на картці')

// ---- c) Клік по "не налаштовано" -- створити запис -- додати нагороду через ZpSelect -------

await clickDataFaceTag('не налаштовано')
await shot('t9-c0-unconfigured-quickedit.png')
await clickButtonWithText('+ Створити запис')
await sleep(200)
await shot('t9-c1-created-form.png')

await clickButtonWithText('+ Додати нагороду')
await sleep(150)
await typeIntoZpSelect('di-point-type-0', 'Аномал')
const panelOptions = await zpSelectPanelOptions('di-point-type-0')
console.log('c) опції панелі ZpSelect на "Аномал":', panelOptions)
if (!panelOptions || !panelOptions.some((o) => o.includes('аномалій') || o.includes('Аномал'))) {
  throw new Error('пошук ZpSelect по типах балів НЕ показав очікувану опцію')
}
await shot('t9-c2-zpselect-search-visible.png')
await pickZpSelectFirstOption('di-point-type-0')
const CHOSEN_AMOUNT = '17'
await setPlainFieldValue('di-point-amount-0', CHOSEN_AMOUNT)
await blurField('di-point-amount-0') // IntField комітить на blur -- без цього Amount лишився б 0
console.log('c) OK: нагороду додано, ZpSelect-пошук типу балів видно на скріншоті')

// ---- d) Зберегти -> Завантажити ZIP -> перевірка байт-канонічності в Node ------------------

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
const dataItemsOut = unzipped['DataItems.json']
if (!dataItemsOut) throw new Error('DataItems.json відсутній в експортованому ZIP')
const dataItemsOutText = new TextDecoder('utf-8').decode(dataItemsOut)

console.log('розмір експортованого DataItems.json:', dataItemsOutText.length, 'символів')

if (!dataItemsOutText.includes(NEW_NAME)) throw new Error('експортований файл НЕ містить правку Name (b)')
if (!dataItemsOutText.includes('"ZP_Data_61"')) throw new Error('експортований файл НЕ містить новостворений запис ZP_Data_61 (c)')
if (!dataItemsOutText.includes(`"Amount": ${CHOSEN_AMOUNT}`)) throw new Error('експортований файл НЕ містить Amount доданої нагороди (c)')
if (dataItemsOutText.endsWith('\n')) throw new Error('експортований файл має завершальний LF -- не канонічний формат')
if (dataItemsOutText.includes('\r')) throw new Error('експортований файл містить CR -- не канонічний формат (потрібен чистий LF)')

writeFileSync(join(OUT, 't9-exported-DataItems.json'), dataItemsOutText, 'utf8')
console.log('d) OK: save/export вміст правильний (Name-маркер і новий запис присутні, канонічні розділювачі рядків); файл збережено для перевірки idempotency окремим tsx-скриптом')

// ---- e) Дублікат Id -- алармовий data-face-теґ на картці + банер "лише для перегляду" -----
// у квик-редакторі (рев'ю фікс-раунду 1, Important 1). Нова фікстура заміняє проєкт
// (окремий import ZIP на тій самій сторінці -- App.tsx.openProject повністю підміняє
// project, той самий шлях, що звичайний повторний імпорт адміном).

await injectZip('t9-dup.zip')
await clickChainsTab()
await shot('t9-e0-graph-duplicate-loaded.png')

const tagTextsDup = await textOfDataFaceTags()
console.log('e) data-face-теґи з дублікатом:', tagTextsDup)
if (!tagTextsDup.some((t) => t.includes('ZP_Data_01') && t.includes('дубль Id'))) {
  throw new Error('картка НЕ показала алармовий маркер "дубль Id" для дубльованого ZP_Data_01')
}
// Честність: НЕ повинно показувати "останній" резолвлене ім'я як звичайний configured-стан
// (упевнений зелений вигляд) -- лише сирий класнейм + бейдж.
if (tagTextsDup.some((t) => t.includes('Останній запис') || t.includes('Перший запис'))) {
  throw new Error('картка показала резолвлене ім\'я дубльованого запису як надійне -- має показувати лише класнейм+бейдж')
}
console.log('e) OK: картка показує алармовий маркер дубля, не впевнене ім\'я')

await clickDataFaceTag('дубль Id')
await shot('t9-e1-quickedit-duplicate-banner.png')

const bannerVisible = await evalJs(`(() => {
  const p = [...document.querySelectorAll('.indicator.alarm')].find((el) => el.textContent.includes('Дублікат Id'))
  return !!p
})()`)
console.log('e) банер дублікату видно =', bannerVisible)
if (!bannerVisible) throw new Error('банер "Дублікат Id" НЕ показаний у квик-редакторі')

// НАХІДКА: `input.disabled` (JS IDL-властивість) відбиває ЛИШЕ атрибут disabled НА САМОМУ
// елементі -- НЕ обчислений стан "вимкнено через предка fieldset[disabled]" (спека HTML:
// .disabled -- проста reflection контент-атрибута, а не "чи справді керування недоступне").
// Побічно підтверджено зондом: `di-name.disabled === false`, доки `<fieldset disabled>`
// огортає його БЕЗ явного атрибута на самому input -- і водночас `di-name.matches(':disabled')
// === true` (реальний стан, яким керується браузерна взаємодія/CSS). Правильна перевірка
// "чи справді недоступне" -- .matches(':disabled'), не .disabled.
const fieldsetDisabled = await evalJs(`(() => {
  const nameInput = document.getElementById('di-name')
  return nameInput ? nameInput.matches(':disabled') : null
})()`)
console.log('e) di-name матчить :disabled =', fieldsetDisabled)
if (fieldsetDisabled !== true) throw new Error('поле di-name НЕ вимкнене при дублікаті Id -- форма мала бути лише для перегляду')

console.log('e) OK: банер + вимкнена форма при дублікаті Id -- дзеркало RulePanel.tsx')

ws.close()
chrome.kill()
console.log('готово, скріншотів: 9, DataItems.json з експортованого ZIP збережено окремо')
