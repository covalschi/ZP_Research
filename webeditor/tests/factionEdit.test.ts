// Тести мутатора фракцій Factions.json (W4 Task 1) — контракт dataItemEdit/sampleTypeEdit
// (deep-copy до коміту, dirty лише на factions-файлі, ідентичність інших файлів, явні
// відмови). Особливості фракцій:
//   - збіг Id — ТОЧНИЙ == (дзеркало ZP_FactionsConfig.Find :84-92 і OpUpsertFaction :861);
//   - створення: відмова на порожньому/небезпечному для імені файлу Id (дзеркало
//     ZP_Uid.IsPathSafe, ZP_Constants.c:109-112 — Id фракції стає ім'ям FactionData\<Id>.json)
//     і на дублі КЕЙС-ІНСЕНСИТИВНО (NTFS-імена файлів пулів регістронезалежні — кейс-близнюки
//     ділили б ОДИН файл пулу; та сама конвенція uniqueId, що nodeEdit W3);
//   - видалення: гард використань — RequiredFactions правил, Factions гілок дерева,
//     RequiredFactions вузлів, Settings.DefaultFaction; відмова з переліком. СВІДОМО
//     СУВОРІШЕ за серверний OpDeleteFaction (ZP_ConfigService.c:885-921 — той видаляє без
//     жодного гарду), прецедент deleteTreeNode (суворіше за OpDeleteNode).

import { describe, test, expect } from 'vitest'
import { parseConfig } from '../src/io/parse'
import { FACTIONS_SCHEMA, RULES_FILE_SCHEMA, TECH_TREE_SCHEMA, SETTINGS_SCHEMA } from '../src/model/schema'
import { serialize } from '../src/io/jsonWriter'
import type { StorageBackend } from '../src/io/backend'
import type { Project, ProjectFile } from '../src/io/project'
import { applyFactionEdit, createFaction, deleteFaction, renameFaction, factionUsageSummary } from '../src/io/factionEdit'

const dummyBackend: StorageBackend = {
  kind: 'zip',
  list: async () => [],
  read: async () => new Uint8Array(0),
  write: async () => {},
}

function faction(id: string, override: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Id: id,
    DisplayName: 'Фракція',
    Supertype: 'science',
    Armbands: ['armband_test'],
    TerminalClasses: [],
    DeviceClasses: [],
    ...override,
  }
}

function factionsFile(factions: Record<string, unknown>[]): ProjectFile {
  const { value, warnings } = parseConfig(FACTIONS_SCHEMA, JSON.stringify({ ConfigVersion: 1, Factions: factions }))
  return { path: 'Factions.json', kind: 'factions', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function rulesFileWith(path: string, rules: Record<string, unknown>[]): ProjectFile {
  const { value, warnings } = parseConfig(RULES_FILE_SCHEMA, JSON.stringify({ ConfigVersion: 1, Rules: rules }))
  return { path, kind: 'rules', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function treeFileWith(path: string, branch: Record<string, unknown>, nodes: Record<string, unknown>[]): ProjectFile {
  const { value, warnings } = parseConfig(TECH_TREE_SCHEMA, JSON.stringify({ ConfigVersion: 1, Branch: branch, Nodes: nodes }))
  return { path, kind: 'techTree', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function settingsFileWith(override: Record<string, unknown> = {}): ProjectFile {
  const doc = {
    ConfigVersion: 1,
    DebugMode: true,
    AdminIds: [],
    DefaultFaction: 'default',
    TreeTerminalClasses: ['ZP_LabComputer'],
    TreeVisibilityDepth: 1,
    TreeBackgroundImage: '',
    ...override,
  }
  const { value, warnings } = parseConfig(SETTINGS_SCHEMA, JSON.stringify(doc))
  return { path: 'Settings.json', kind: 'settings', originalBytes: new Uint8Array(0), parsed: value, warnings, dirty: false }
}

function project(...files: ProjectFile[]): Project {
  return { files, backend: dummyBackend }
}

function docOf(p: Project): { Factions: Record<string, unknown>[] } {
  return p.files.find((x) => x.kind === 'factions')!.parsed as { Factions: Record<string, unknown>[] }
}

// ---- applyFactionEdit -----------------------------------------------------------------------

describe('applyFactionEdit', () => {
  test('оновлює поле фракції, dirty=true, оригінал не мутовано', () => {
    const p = project(factionsFile([faction('ecolog', { DisplayName: 'стара' })]))
    const result = applyFactionEdit(p, 'ecolog', (f) => {
      f.DisplayName = 'Вчені'
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(docOf(result.project).Factions[0].DisplayName).toBe('Вчені')
    expect(result.project.files[0].dirty).toBe(true)
    expect(docOf(p).Factions[0].DisplayName).toBe('стара')
    expect(p.files[0].dirty).toBe(false)
  })

  test('ІНШІ файли зберігають ідентичність', () => {
    const rulesF = rulesFileWith('ProcessingRules/a.json', [])
    const p = project(rulesF, factionsFile([faction('ecolog')]))
    const result = applyFactionEdit(p, 'ecolog', (f) => {
      f.Supertype = 'combat'
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.files[0]).toBe(rulesF)
  })

  test('відмови: файл не завантажено / Id не знайдено / інший регістр / дубль', () => {
    expect(applyFactionEdit(project(rulesFileWith('ProcessingRules/a.json', [])), 'ecolog', () => {}).ok).toBe(false)
    const p = project(factionsFile([faction('ecolog')]))
    expect(applyFactionEdit(p, 'no_such', () => {}).ok).toBe(false)
    expect(applyFactionEdit(p, 'ECOLOG', () => {}).ok).toBe(false)
    const dup = project(factionsFile([faction('dup'), faction('dup')]))
    const r = applyFactionEdit(dup, 'dup', () => {})
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/дубль/i)
  })
})

// ---- createFaction --------------------------------------------------------------------------

describe('createFaction', () => {
  test('додає фракцію з дефолтами Enforce-класу ZP_FactionDef', () => {
    const p = project(factionsFile([]))
    const result = createFaction(p, 'varta')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const doc = docOf(result.project)
    expect(doc.Factions).toHaveLength(1)
    expect(doc.Factions[0]).toEqual({
      Id: 'varta',
      DisplayName: '',
      Supertype: '',
      Armbands: [],
      TerminalClasses: [],
      DeviceClasses: [],
    })
    expect(result.project.files[0].dirty).toBe(true)
  })

  test('порожній Id — відмова', () => {
    const p = project(factionsFile([]))
    expect(createFaction(p, '  ').ok).toBe(false)
  })

  test('небезпечний для імені файлу Id — відмова (дзеркало ZP_Uid.IsPathSafe, ZP_Constants.c:109-112)', () => {
    const p = project(factionsFile([]))
    expect(createFaction(p, 'a/b').ok).toBe(false)
    expect(createFaction(p, 'a\\b').ok).toBe(false)
    expect(createFaction(p, 'a:b').ok).toBe(false)
    expect(createFaction(p, 'a..b').ok).toBe(false)
  })

  test('дубль Id — відмова, у т.ч. іншим регістром (FactionData\\<Id>.json на NTFS регістронезалежний)', () => {
    const p = project(factionsFile([faction('ecolog')]))
    expect(createFaction(p, 'ecolog').ok).toBe(false)
    expect(createFaction(p, 'Ecolog').ok).toBe(false)
  })
})

// ---- deleteFaction --------------------------------------------------------------------------

describe('deleteFaction: щасливий шлях', () => {
  test('видаляє фракцію, яку ніщо не використовує', () => {
    const p = project(factionsFile([faction('ecolog'), faction('varta')]))
    const result = deleteFaction(p, 'varta')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const doc = docOf(result.project)
    expect(doc.Factions).toHaveLength(1)
    expect(doc.Factions[0].Id).toBe('ecolog')
  })

  test('Id не знайдено / дубль — відмова', () => {
    const p = project(factionsFile([faction('ecolog')]))
    expect(deleteFaction(p, 'zzz').ok).toBe(false)
    const dup = project(factionsFile([faction('dup'), faction('dup')]))
    expect(deleteFaction(dup, 'dup').ok).toBe(false)
  })
})

describe('deleteFaction: гард використань (суворіше за серверний OpDeleteFaction — свідомо)', () => {
  test('фракція в RequiredFactions правила — відмова з Id правила', () => {
    const p = project(
      factionsFile([faction('ecolog')]),
      rulesFileWith('ProcessingRules/a.json', [{ Id: 'r1', RequiredFactions: ['ecolog'] }]),
    )
    const result = deleteFaction(p, 'ecolog')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('r1')
  })

  test('фракція у Factions гілки дерева — відмова з посиланням на гілку', () => {
    const p = project(
      factionsFile([faction('ecolog')]),
      treeFileWith('TechTree/bio.json', { Id: 'bio', Name: '', Icon: '', SortOrder: 0, Factions: ['ecolog'] }, []),
    )
    const result = deleteFaction(p, 'ecolog')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('bio')
  })

  test('фракція в RequiredFactions вузла — відмова з Id вузла', () => {
    const p = project(
      factionsFile([faction('ecolog')]),
      treeFileWith('TechTree/bio.json', { Id: 'bio', Name: '', Icon: '', SortOrder: 0, Factions: [] }, [
        { Id: 'n1', RequiredFactions: ['ecolog'] },
      ]),
    )
    const result = deleteFaction(p, 'ecolog')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('n1')
  })

  test('фракція в Settings.DefaultFaction — відмова', () => {
    const p = project(factionsFile([faction('ecolog')]), settingsFileWith({ DefaultFaction: 'ecolog' }))
    const result = deleteFaction(p, 'ecolog')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/DefaultFaction/i)
  })

  test('порівняння використань КЕЙС-ІНСЕНСИТИВНЕ (прецедент cloneStation: faction-заміни)', () => {
    const p = project(
      factionsFile([faction('ecolog')]),
      rulesFileWith('ProcessingRules/a.json', [{ Id: 'r1', RequiredFactions: ['Ecolog'] }]),
    )
    expect(deleteFaction(p, 'ecolog').ok).toBe(false)
  })

  test('використання в кількох місцях — перелік згрупований', () => {
    const p = project(
      factionsFile([faction('ecolog')]),
      rulesFileWith('ProcessingRules/a.json', [{ Id: 'r1', RequiredFactions: ['ecolog'] }, { Id: 'r2', RequiredFactions: ['ecolog'] }]),
      treeFileWith('TechTree/bio.json', { Id: 'bio', Name: '', Icon: '', SortOrder: 0, Factions: ['ecolog'] }, [
        { Id: 'n1', RequiredFactions: ['ecolog'] },
      ]),
    )
    const result = deleteFaction(p, 'ecolog')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('r1')
    expect(result.error).toContain('r2')
    expect(result.error).toContain('bio')
    expect(result.error).toContain('n1')
  })
})

// ---- renameFaction --------------------------------------------------------------------------

describe('renameFaction (W4 Task 3): прецедент renamePointType + IsPathSafe', () => {
  test('перейменовує Id, dirty=true, оригінал не мутовано', () => {
    const p = project(factionsFile([faction('varta')]))
    const result = renameFaction(p, 'varta', 'warta')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(docOf(result.project).Factions[0].Id).toBe('warta')
    expect(result.project.files[0].dirty).toBe(true)
    expect(docOf(p).Factions[0].Id).toBe('varta')
  })

  test('порожній / небезпечний для імені файлу новий Id — відмова (FactionData\\<Id>.json)', () => {
    const p = project(factionsFile([faction('varta')]))
    expect(renameFaction(p, 'varta', '  ').ok).toBe(false)
    expect(renameFaction(p, 'varta', 'a/b').ok).toBe(false)
    expect(renameFaction(p, 'varta', 'a\\b').ok).toBe(false)
    expect(renameFaction(p, 'varta', 'a:b').ok).toBe(false)
    expect(renameFaction(p, 'varta', 'a..b').ok).toBe(false)
  })

  test('той самий Id — no-op (ok, той самий project)', () => {
    const p = project(factionsFile([faction('varta')]))
    const result = renameFaction(p, 'varta', 'varta')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project).toBe(p)
  })

  test('дубль із ЧУЖИМ Id — відмова, у т.ч. іншим регістром (NTFS-файл пулу)', () => {
    const p = project(factionsFile([faction('varta'), faction('ecolog')]))
    expect(renameFaction(p, 'varta', 'ecolog').ok).toBe(false)
    expect(renameFaction(p, 'varta', 'Ecolog').ok).toBe(false)
  })

  test('зміна лише регістру ВЛАСНОГО Id — легальна', () => {
    const p = project(factionsFile([faction('varta')]))
    const result = renameFaction(p, 'varta', 'Varta')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(docOf(result.project).Factions[0].Id).toBe('Varta')
  })

  test('кейс-only при рукописному кейс-варіанті-близнюку — відмова (не карбувати точний дубль)', () => {
    const p = project(factionsFile([faction('varta'), faction('Varta')]))
    expect(renameFaction(p, 'varta', 'Varta').ok).toBe(false)
  })

  test('старий Id не знайдено / дубль старого — відмова', () => {
    const p = project(factionsFile([faction('varta')]))
    expect(renameFaction(p, 'zzz', 'yyy').ok).toBe(false)
    const dup = project(factionsFile([faction('dup'), faction('dup')]))
    expect(renameFaction(dup, 'dup', 'other').ok).toBe(false)
  })
})

// ---- factionUsageSummary --------------------------------------------------------------------

describe('factionUsageSummary (W4 Task 3): живий перелік використань для панелі', () => {
  test('невикористана фракція — порожній рядок', () => {
    const p = project(factionsFile([faction('varta')]))
    expect(factionUsageSummary(p, 'varta')).toBe('')
  })

  test('перелік згрупований: правила, гілки, вузли, DefaultFaction (кейс-інсенситивно)', () => {
    const p = project(
      factionsFile([faction('ecolog')]),
      rulesFileWith('ProcessingRules/a.json', [{ Id: 'r1', RequiredFactions: ['Ecolog'] }]),
      treeFileWith('TechTree/bio.json', { Id: 'bio', Name: '', Icon: '', SortOrder: 0, Factions: ['ecolog'] }, [
        { Id: 'n1', RequiredFactions: ['ecolog'] },
      ]),
      settingsFileWith({ DefaultFaction: 'ECOLOG' }),
    )
    const summary = factionUsageSummary(p, 'ecolog')
    expect(summary).toContain('r1')
    expect(summary).toContain('bio')
    expect(summary).toContain('n1')
    expect(summary).toMatch(/DefaultFaction/)
  })
})

// ---- байт-стабільність ----------------------------------------------------------------------

describe('factionEdit: байт-стабільність повторної канонізації', () => {
  test('serialize -> parse -> serialize ідентичний після createFaction + applyFactionEdit', () => {
    const p = project(factionsFile([faction('ecolog')]))
    const r1 = createFaction(p, 'varta')
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    const r2 = applyFactionEdit(r1.project, 'varta', (f) => {
      f.DisplayName = 'Варта з "лапками"'
      ;(f.Armbands as string[]).push('armband_varta')
    })
    expect(r2.ok).toBe(true)
    if (!r2.ok) return

    const doc = r2.project.files[0].parsed
    const firstPass = serialize(FACTIONS_SCHEMA, doc)
    const reparsed = parseConfig(FACTIONS_SCHEMA, firstPass)
    expect(reparsed.warnings).toEqual([])
    const secondPass = serialize(FACTIONS_SCHEMA, reparsed.value)
    expect(secondPass).toBe(firstPass)
  })
})
