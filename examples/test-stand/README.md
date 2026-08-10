# `test-stand` — the author's full test bed

This is the content `docs/test-commands.md` and `docs/joint-test-plan.md` describe. It is a
**test** configuration, not a balanced game: the numbers exist to exercise every mechanic.

## What is in it

**Twelve faction devices**, named `ZP_<Eco|Sky>_<Pack|Proc>_<Bio|Anom|Electro>` — faction,
role, category. `Pack` = packer (raw material → sample, 6×4 cargo), `Proc` = analyser
(sample → data blank, 4×4). Only Вчені (`ecolog`) and Чисте небо (`clearsky`) have devices;
the naming is a content convention, not a check in code — the actual gate lives in
`Factions.json → DeviceClasses` and in the rules.

**Eighteen chains** (43 rules including the older capstone ones), all from vanilla raw
materials. The economy rule: **tier comes from the rarity of the raw material, not from
chain length**. Common material → `*_lab_t1`, mid → `t2`, rare → `t3`, with rarity taken
from `nominal` in the mission's `types.xml`. A blank is worth 3/2/1 points for t1/t2/t3 —
the rarer the input, the higher the tier and the fewer points per cycle.

**All devices are laboratory devices.** Field points (`*_field_*`) are by design awarded by
a *different* mod as quest rewards; they exist in the tree but nothing here produces them.
For testing, grant them: `!zp grantpool bio_field_t1 10` (goes to your own faction's pool).

**Each faction has its own sample classes** (`ZP_Sample_01/03/17` vs `ZP_Sample_11/21/26`),
so you can tell whose sample you are holding. Which tier it is stays hidden in the `Content`
tag (`<eco|sky>_<bio|anom|electro>_t<1..3>`) — only a device reads that.

**Fourteen static devices** at a lab on Chernarus: two rows six devices wide at
`x 13056…13076`, ecolog at `z 10238`, clearsky at `z 10244`, plus the two faction terminals
(`ZP_LabComputer` for ecolog, `ZP_ChemBench` for clearsky) a few metres east. **Chernarus
only** — the coordinates mean nothing on another map; delete `StaticDevices.json` and place
devices yourself with `!zp staticadd` instead.

Note `duty` owns `ZP_ServerRack` as its terminal but none is placed — add one if you want to
test a third faction.

## Verified boot, and the nine warnings

A server booted on a fresh profile with this pack printed:

```
[ZP_Research] configs loaded: factions=7 pointTypes=24 rules=43 treeNodes=16 dataItems=22 modules=3 sampleTypes=6 adminIds=1 debug=on
[ZP_Research] статики: записів 14, нових заспавнено 14
```

zero errors, and exactly **nine warnings, all expected**:

1. one long line listing armband classes that "don't exist in game" — the STALKER modpack
   armbands. Harmless: every faction also carries a vanilla armband that does exist
   (`Armband_White`/`Blue`/`Red`/…), which is what you wear on a vanilla+CF box;
2. four × "faction has no terminals of its own" and four × "no devices of its own" — for
   `freedom`, `sop`, `bandit`, `loner`, which are declared but not equipped here.

`rules=43` counts every rule that **loaded**, not every rule that can run: `Enabled` gates
matching at runtime, not loading.

## Known imperfections (deliberate)

- The tree was authored before the tier-from-rarity rule, so several nodes are priced in
  *field* points that no device produces. The editor's "Баланс" tab honestly shows this as
  an alarm. It is a test tree; the final balance will be different.
- `ZP_Data_31` is named "Бойові дані" but carries an anomaly-group model — leftover naming,
  no functional effect.
