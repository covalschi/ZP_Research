# `minimal` — the shortest complete loop

Five files. Raw material → sample → data blank → deposit → faction pool → research a node.

| File | What it adds |
|---|---|
| `Factions.json` | Three factions with **vanilla** armbands: `Armband_White` → ecolog, `Armband_Blue` → clearsky, `Armband_Red` → duty. No one owns terminals or devices, so on this pack every device works for everyone — the simplest possible start |
| `SampleTypes.json` | `ZP_Sample_01` gets a readable name ("Зразок біоматеріалу") |
| `DataItems.json` | `ZP_Data_01` is worth **3 × `bio_lab_t1`** when deposited |
| `ProcessingRules/demo.json` | Two rules: `Apple` → `ZP_Sample_01` (content tag `apple`) on `ZP_SampleFridge`, then `ZP_Sample_01` → `ZP_Data_01` on `ZP_Microscope`. 10 s each |
| `TechTree/example.json` | Branch "Приклад": node `ex_basics` costs 3 points, `ex_advanced` costs 6 and needs the first (60 s project) |

It deliberately replaces the seeded `demo.json` rather than adding a second rules file: two
rules matching the same device and input would compete, and the winner is decided by
filename order — a confusing first experience.

Point types (`PointTypes.json`), purity modules (`Modules.json`) and `Settings.json` are not
included: the mod creates them with defaults, and `bio_lab_t1` is one of those defaults.

`StaticDevices.json` is not included either — there are no devices in the world until you
place them, which is map-independent:

```
!zp staticadd ZP_SampleFridge
!zp staticadd ZP_Microscope
!zp staticadd ZP_LabComputer
```

## Verified boot

A server booted on a fresh profile with this pack printed exactly:

```
[ZP_Research] configs loaded: factions=3 pointTypes=18 rules=2 treeNodes=2 dataItems=1 modules=3 sampleTypes=1 adminIds=1 debug=on
```

with **zero warnings and zero errors**. If your boot differs, the difference is yours.
