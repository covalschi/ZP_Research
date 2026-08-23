// Контент стенду T6: «тир від СИРОВИНИ» + різні класи зразків у двох фракцій.
//
// Той самий метод, що й T3 (звіт task-3-report.md §2): правки вносяться ВЛАСНИМИ
// мутаторами редактора з Node, а не руками по JSON і не CDP-кліками. Кожен виклик нижче —
// рівно та функція, яку смикає UI:
//
//   вікно станка -> «×» на рядку правила            -> deleteRule
//   вікно станка -> чипи сировини -> «створити N»   -> createStubRules
//   форма рядка правила                             -> applyRuleEdit
//   кнопка «Куди піде результат»                    -> linkOutputToStation
//   вкладка «Зразки» -> «+ Створити запис» / форма  -> createSampleType / applySampleTypeEdit
//   вкладка «Заготовки» -> «+ Створити запис» / форма -> createDataItem / applyDataItemEdit
//   «Зберегти зміни»                                -> alarmFiles + canSave + saveDirty
//
// Байт-каноничність виходить ПО ПОБУДОВІ (saveDirty -> encodeConfig), гейт W2.7
// (alarmFiles/canSave) стоїть ПЕРЕД записом: якби правка породила хибний тип, диск не
// змінився б узагалі.
//
// Запуск:  npx tsx tests/tools/t6-stand-content.ts <шлях-до-теки-профілю> [--dry]

import { loadProject, saveDirty, alarmFiles, canSave } from '../../src/io/project'
import type { Project } from '../../src/io/project'
import { loadClassIndex } from '../../src/model/classIndex'
import { createStubRules, deleteRule, linkOutputToStation } from '../../src/io/stationEdit'
import { applyRuleEdit } from '../../src/io/ruleEdit'
import { createDataItem, applyDataItemEdit } from '../../src/io/dataItemEdit'
import { createSampleType, applySampleTypeEdit } from '../../src/io/sampleTypeEdit'
import { NodeFsBackend } from './nodeBackend'

const RULES_FILE = 'ProcessingRules/stend_lanciuhy.json'

// ---- Зміст стенду -------------------------------------------------------------------------

interface RawDef {
  tier: 1 | 2 | 3
  cls: string
  ua: string // як звати сировину в описах і шпаргалці
  nominal: number // nominal з types.xml місії — доказ рідкості, а не «на око»
}

interface CatDef {
  key: 'bio' | 'anom' | 'electro'
  devToken: string // ZP_<Eco|Sky>_<Pack|Proc>_<devToken>
  idToken: string // stend_<eco|sky>_<pak|analiz>_<idToken>_tN
  pointCat: string // <pointCat>_lab_tN
  uaAdj: string // «Біодані» / «Аномальні дані» / «Технічні дані»
  raws: RawDef[]
}

const CATS: CatDef[] = [
  {
    key: 'bio',
    devToken: 'Bio',
    idToken: 'bio',
    pointCat: 'bio',
    uaAdj: 'Біодані',
    raws: [
      { tier: 1, cls: 'BandageDressing', ua: 'перевʼязка з біоматеріалом', nominal: 40 },
      { tier: 2, cls: 'TetracyclineAntibiotics', ua: 'тетрациклін', nominal: 20 },
      { tier: 3, cls: 'BloodTestKit', ua: 'набір аналізу крові', nominal: 10 },
    ],
  },
  {
    key: 'anom',
    devToken: 'Anom',
    idToken: 'anom',
    pointCat: 'anomaly',
    uaAdj: 'Аномальні дані',
    raws: [
      { tier: 1, cls: 'Chemlight_Green', ua: 'хімічне світло', nominal: 35 },
      { tier: 2, cls: 'LargeGasCanister', ua: 'великий газовий балон', nominal: 18 },
      { tier: 3, cls: 'NBCGlovesGray', ua: 'рукавиці захисного костюма', nominal: 2 },
    ],
  },
  {
    key: 'electro',
    devToken: 'Electro',
    idToken: 'elektro',
    pointCat: 'electronics',
    uaAdj: 'Технічні дані',
    raws: [
      { tier: 1, cls: 'Battery9V', ua: 'батарейка 9V', nominal: 100 },
      { tier: 2, cls: 'GPSReceiver', ua: 'GPS-приймач', nominal: 25 },
      { tier: 3, cls: 'NVGoggles', ua: 'прилад нічного бачення', nominal: 5 },
    ],
  },
]

interface FacDef {
  id: string
  devToken: 'Eco' | 'Sky'
  idToken: 'eco' | 'sky'
  uaGen: string // «Вчених» / «Чистого неба» — родовий відмінок для назв
  uaNom: string // «Вчені» / «Чисте небо»
  samples: Record<'bio' | 'anom' | 'electro', string>
  data: Record<'bio' | 'anom' | 'electro', [string, string, string]> // t1, t2, t3
}

const FACS: FacDef[] = [
  {
    id: 'ecolog',
    devToken: 'Eco',
    idToken: 'eco',
    uaGen: 'Вчених',
    uaNom: 'Вчені',
    samples: { bio: 'ZP_Sample_01', anom: 'ZP_Sample_03', electro: 'ZP_Sample_17' },
    data: {
      bio: ['ZP_Data_02', 'ZP_Data_04', 'ZP_Data_05'],
      anom: ['ZP_Data_32', 'ZP_Data_34', 'ZP_Data_35'],
      electro: ['ZP_Data_62', 'ZP_Data_64', 'ZP_Data_65'],
    },
  },
  {
    id: 'clearsky',
    devToken: 'Sky',
    idToken: 'sky',
    uaGen: 'Чистого неба',
    uaNom: 'Чисте небо',
    samples: { bio: 'ZP_Sample_11', anom: 'ZP_Sample_21', electro: 'ZP_Sample_26' },
    data: {
      bio: ['ZP_Data_03', 'ZP_Data_06', 'ZP_Data_07'],
      anom: ['ZP_Data_33', 'ZP_Data_36', 'ZP_Data_37'],
      electro: ['ZP_Data_63', 'ZP_Data_66', 'ZP_Data_67'],
    },
  },
]

// Скільки балів дає заготовка свого тиру: чим рідкісніша сировина, тим вищий тир і тим
// МЕНШЕ балів за цикл (дерево бере верхні тири малими числами, нижні — великими).
const AMOUNT_BY_TIER: Record<1 | 2 | 3, number> = { 1: 3, 2: 2, 3: 1 }

const SAMPLE_UA: Record<'bio' | 'anom' | 'electro', string> = {
  bio: 'Біозразок',
  anom: 'Аномальний зразок',
  electro: 'Технічний зразок',
}

// Спадок капстоуна: заготовки, які виробляють ПРИЛАДИ, теж мусять давати лише лабораторні
// бали (директива власника «всі прилади лабораторні»). Обидві виробляються правилами
// peresbir_lanciuhy.json, тому їхній тип змінюється; кількість лишається як була.
const LEGACY_LAB: Array<{ id: string; type: string }> = [
  { id: 'ZP_Data_01', type: 'bio_lab_t1' },
  { id: 'ZP_Data_61', type: 'electronics_lab_t1' },
]

// ---- дрібні помічники ----------------------------------------------------------------------

function must<T extends { ok: boolean }>(res: T, what: string): T & { ok: true } {
  if (!res.ok) throw new Error(`${what}: ${(res as unknown as { error: string }).error}`)
  return res as T & { ok: true }
}

function contentLabel(fac: FacDef, cat: CatDef, tier: number): string {
  return `${fac.idToken}_${cat.key}_t${tier}`
}

function deviceOf(fac: FacDef, cat: CatDef, role: 'Pack' | 'Proc'): string {
  return `ZP_${fac.devToken}_${role}_${cat.devToken}`
}

// ---- головна дія -----------------------------------------------------------------------------

async function main(): Promise<void> {
  const target = process.argv[2]
  const dry = process.argv.includes('--dry')
  if (!target) {
    console.error('Використання: npx tsx tests/tools/t6-stand-content.ts <тека-профілю> [--dry]')
    process.exitCode = 1
    return
  }

  let project: Project = await loadProject(new NodeFsBackend(target))
  const index = loadClassIndex()

  // 1) Знести 12 правил стенду попередньої схеми (по одному, як «×» у вікні станка).
  const rulesFile = project.files.find((f) => f.path === RULES_FILE)
  if (!rulesFile) throw new Error(`не знайдено ${RULES_FILE}`)
  const oldIds = (rulesFile.parsed as { Rules: Record<string, unknown>[] }).Rules.map((r) => String(r.Id))
  for (const id of oldIds) {
    project = must(deleteRule(project, RULES_FILE, id), `видалення правила ${id}`).project
  }
  console.log(`Видалено старих правил: ${oldIds.length}`)

  // 2) Вісімнадцять ланцюгів: сировина -> пакувальник -> зразок(мітка з тиром) -> аналізатор -> заготовка.
  let packCount = 0
  let procCount = 0
  for (const fac of FACS) {
    for (const cat of CATS) {
      const sampleCls = fac.samples[cat.key]
      for (const raw of cat.raws) {
        const packDev = deviceOf(fac, cat, 'Pack')
        const procDev = deviceOf(fac, cat, 'Proc')
        const label = contentLabel(fac, cat, raw.tier)
        const packId = `stend_${fac.idToken}_pak_${cat.idToken}_t${raw.tier}`
        const procId = `stend_${fac.idToken}_analiz_${cat.idToken}_t${raw.tier}`
        const dataCls = fac.data[cat.key][raw.tier - 1]

        // 2a) пакувальник
        const stub = must(createStubRules(project, packDev, [raw.cls], RULES_FILE), `заготовка ${packId}`)
        project = stub.project
        const stubId = stub.createdIds[0]
        project = must(
          applyRuleEdit(project, RULES_FILE, stubId, (r) => {
            r.Id = packId
            r.Enabled = true
            r.BasePurityMin = 0.8
            r.BasePurityMax = 1.0
            r.TimeSec = 20
            r.Outputs = [{ Classname: sampleCls, Quantity: 1, Chance: 1.0, Content: label }]
            r.RequiredFactions = [fac.id]
            r.Notes =
              `Стенд: пакувальник ${fac.uaGen}, тир ${raw.tier}. Сировина — ${raw.ua} (${raw.cls}, nominal ${raw.nominal} у types.xml): ` +
              'тир ланцюга задає саме рідкісність сировини, а не довжина ланцюга.'
          }),
          `правка ${packId}`,
        ).project
        packCount++

        // 2b) аналізатор — через «Куди піде результат»
        const link = must(
          linkOutputToStation(project, index, RULES_FILE, packId, 0, procDev, RULES_FILE),
          `звʼязок ${packId} -> ${procDev}`,
        )
        project = link.project
        if (!link.created) throw new Error(`аналізатор для ${label} уже існував — перевірте мітки`)
        project = must(
          applyRuleEdit(project, RULES_FILE, link.ruleId, (r) => {
            r.Id = procId
            r.Enabled = true
            r.BasePurityMin = 0.5
            r.BasePurityMax = 0.5
            r.TimeSec = 30
            r.Outputs = [{ Classname: dataCls, Quantity: 1, Chance: 1.0, Content: '' }]
            r.RequiredFactions = [fac.id]
            r.Notes =
              `Стенд: аналізатор ${fac.uaGen}, тир ${raw.tier}. Шанс виходу множиться на чистоту зразка, ` +
              `тому частина циклів законно порожня. Заготовка ${dataCls} дає лише ${cat.pointCat}_lab_t${raw.tier}.`
          }),
          `правка ${procId}`,
        ).project
        procCount++
      }
    }
  }
  console.log(`Створено правил: пакувальників ${packCount}, аналізаторів ${procCount}`)

  // 3) Типи зразків: шість записів (три категорії × дві фракції).
  for (const fac of FACS) {
    for (const cat of CATS) {
      const cls = fac.samples[cat.key]
      const known = (project.files.find((f) => f.kind === 'sampleTypes')?.parsed as { Items: Record<string, unknown>[] })
        .Items.some((it) => String(it.Id).toLowerCase() === cls.toLowerCase())
      if (!known) project = must(createSampleType(project, cls), `створення типу зразка ${cls}`).project
      project = must(
        applySampleTypeEdit(project, cls, (it) => {
          it.Enabled = true
          it.Name = `${SAMPLE_UA[cat.key]} ${fac.uaGen}`
          it.Description =
            `Проба, запакована лінією ${fac.uaGen}. Тир зразка задає сировина, з якої його спакували, ` +
            'і він схований у мітці: його читає прилад, а не людина.'
        }),
        `правка типу зразка ${cls}`,
      ).project
    }
  }
  console.log('Типів зразків описано: 6')

  // 4) Заготовки: вісімнадцять записів «категорія × тир × фракція», кожна дає РІВНО один
  //    лабораторний тип свого тиру. Полів *_field_* у приладних заготовок немає взагалі —
  //    польові бали приходять із-поза мода (нагорода іншого мода за квести).
  let created = 0
  let edited = 0
  for (const fac of FACS) {
    for (const cat of CATS) {
      for (const raw of cat.raws) {
        const cls = fac.data[cat.key][raw.tier - 1]
        const items = (project.files.find((f) => f.kind === 'dataItems')?.parsed as { Items: Record<string, unknown>[] }).Items
        const known = items.some((it) => String(it.Id).toLowerCase() === cls.toLowerCase())
        if (!known) {
          project = must(createDataItem(project, cls), `створення заготовки ${cls}`).project
          created++
        }
        project = must(
          applyDataItemEdit(project, cls, (it) => {
            it.Enabled = true
            it.Name = `${cat.uaAdj} ${raw.tier} тиру (${fac.uaNom})`
            it.Description =
              `Результат ланцюга ${fac.uaGen}: ${raw.ua} -> зразок -> аналіз. ` +
              `Здача на своєму терміналі дає ${AMOUNT_BY_TIER[raw.tier]} × «${cat.pointCat}_lab_t${raw.tier}». ` +
              'Польових балів приладні заготовки не дають узагалі.'
            it.Points = [{ Type: `${cat.pointCat}_lab_t${raw.tier}`, Amount: AMOUNT_BY_TIER[raw.tier] }]
          }),
          `правка заготовки ${cls}`,
        ).project
        edited++
      }
    }
  }
  console.log(`Заготовок: створено ${created}, описано ${edited}`)

  // 5) Спадок капстоуна: дві заготовки, які виробляють прилади, переводимо на лабораторні бали.
  for (const legacy of LEGACY_LAB) {
    project = must(
      applyDataItemEdit(project, legacy.id, (it) => {
        const pts = Array.isArray(it.Points) ? (it.Points as Record<string, unknown>[]) : []
        const amount = pts.length > 0 && typeof pts[0].Amount === 'number' ? (pts[0].Amount as number) : 1
        it.Points = [{ Type: legacy.type, Amount: amount }]
      }),
      `переведення ${legacy.id} на ${legacy.type}`,
    ).project
  }
  console.log(`Капстоунних заготовок переведено на лабораторні бали: ${LEGACY_LAB.length}`)

  // 6) Гейт W2.7 і запис.
  const alarms = alarmFiles(project)
  if (alarms.length > 0) {
    throw new Error(`гейт W2.7: файли з хибними типами — ${alarms.map((f) => f.path).join(', ')}`)
  }
  if (!canSave(project)) throw new Error('canSave=false — збереження заблоковано')
  const dirty = project.files.filter((f) => f.dirty).map((f) => f.path)
  console.log(`Файлів до запису: ${dirty.length} — ${dirty.join(', ')}`)
  if (dry) {
    console.log('--dry: диск не змінено')
    return
  }
  const res = await saveDirty(project)
  console.log(`Записано: ${res.written.join(', ')}`)
}

main().catch((e: unknown) => {
  console.error(e)
  process.exitCode = 1
})
