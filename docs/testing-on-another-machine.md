# Testing ZP_Research on another machine

From `git clone` to *a research point lands in a faction pool*, on a clean Windows box.

Every number and log line below was produced on a real boot, not written from memory.
Where something is a known trap, the symptom is described — most failures in DayZ modding
are **silent**, and knowing what silence means is most of the battle.

**Estimated time:** 40–60 minutes, most of it Steam downloads and the first world build.

---

## Stage 0 — what to install

| What | Where | Why |
|---|---|---|
| **DayZ** (Steam app 221100) | Steam Library | The game, and the folder where `DayZDiag_x64.exe` will appear |
| **DayZ Tools** | Steam Library → **Tools** filter → *DayZ Tools* | Provides `FileBank` (packs the PBO), `DSCreateKey` (signing) and `DayZDiag_x64.exe`. Launch it once so it registers its paths |
| **DayZ Server** (223350) | Steam Library → Tools, or SteamCMD `+login anonymous +app_update 223350` | Two things you cannot get elsewhere: the **stock `serverDZ.cfg`** and the **`mpmissions` folders**. The client install has no missions at all |
| **@CF** (Community Framework) | DayZ Launcher → Workshop, id **1559212036** | Hard dependency: the mod declares `JM_CF_Scripts` in `requiredAddons`. Without it the PBO does not load |
| *optional:* **@VPPAdminTools** | Workshop, id **1828439124** | Only if you want the admin permission gate and the in-game editor tab |
| **Node.js 18+** | nodejs.org | Only if you want to rebuild the web editor. A prebuilt `dist/index.html` is committed |

`@CF` must end up in `<DayZ>\!Workshop\@CF` — that is where the DayZ Launcher puts
subscribed mods, and where the scripts look.

> **PowerShell:** run everything from **pwsh 7** if you have it. On a fresh Windows the
> default policy may block scripts; then use
> `powershell -ExecutionPolicy Bypass -File .\build\build.ps1`.

---

## Stage 1 — clone and build

```powershell
git clone https://github.com/covalschi/ZP_Research.git
cd ZP_Research
.\build\build.ps1
```

**Checkpoint.** Two lines like:

```
OK: ...\@ZP_Research\addons\ZP_Research.pbo (1975973 bytes)
OK: ...\@ZP_Research_VPP\addons\ZP_Research_VPP.pbo (19689 bytes)
```

The two warnings about the missing private key are **expected and correct** — the author's
signing key is not in this repository. Your PBO is unsigned, which is why the test server
below runs with `verifySignatures = 0`. (To publish your own build, make your own key with
`DSCreateKey.exe` — see the README.)

`build.ps1` finds DayZ Tools by itself (parameter → `DAYZ_TOOLS` env var → Steam registry →
Steam library folders). If it can't, pass `-ToolsRoot "D:\...\DayZ Tools"`.

> **Do not load `@ZP_Research_VPP` without `@VPPAdminTools`.** A missing dependency in DayZ
> is a *blocking* dialog — "Addon 'X' requires addon 'Y'" — before the game even loads, not
> a silently skipped PBO. The scripts below leave it out unless you pass `-WithVpp`.

---

## Stage 2 — prepare the server environment

```powershell
.\testenv\prepare-testenv.ps1 -Example minimal
```

This copies your stock `serverDZ.cfg` and applies exactly three edits, makes sure the
mission exists, and seeds `testenv\profiles\ZP_Research\` with the `minimal` example
content (Stage 6 explains the packs).

> **The trap this exists to prevent.** A hand-written minimal `serverDZ.cfg` makes a 1.29
> server **hang forever** after the World module compiles: one CPU core pinned, mission
> never loads, and *not one line of error in the RPT*. It is indistinguishable from a slow
> first boot. The cure is to start from the stock file. Second half of the same trap: no
> `instanceId` line → the server **silently self-terminates**, again with no error.

The three edits, if you prefer to do it by hand:

```
verifySignatures = 0;      // your locally built PBO has no signature
BattlEye = 0;              // no BE on a local box
allowFilePatching = 1;     // DayZDiag clients use -filePatching
```

`instanceId`, `template` and the rest are already in the stock file — leave them alone.

---

## Stage 3 — first boot

```powershell
.\testenv\run-server.ps1
```

It waits for the mod's own proof-of-life line rather than sleeping a fixed time.

> **The first boot takes minutes** (the engine builds the world). Later boots reach mod init
> in about 15 seconds. A tester who kills a healthy-but-slow server here concludes "the mod
> is broken" — the script waits up to 6 minutes on purpose.

**Checkpoint** — with the `minimal` pack:

```
[ZP_Research] configs loaded: factions=3 pointTypes=18 rules=2 treeNodes=2 dataItems=1 modules=3 sampleTypes=1 adminIds=1 debug=on
[ZP_Research] M0 initialized, revision=1
```

zero `WARNING`, zero `ERROR`. With **no** example pack at all (`-Example none`) the mod
seeds its own defaults and prints instead:

```
[ZP_Research] configs loaded: factions=7 pointTypes=18 rules=1 treeNodes=0 dataItems=0 modules=3 sampleTypes=0 adminIds=1 debug=on
```

plus **one** long warning listing 29 armband classes that "don't exist in game" — see
Stage 5; that is normal on a vanilla+CF box and not a failure.

The log lives in `testenv\profiles\script_*.log`; the configs the mod just created are in
`testenv\profiles\ZP_Research\`. **That folder is what the web editor opens.**

Stop the server with `.\testenv\stop-server.ps1` (it kills only the process it started —
the same executable is also your game client).

---

## Stage 4 — become an admin

Almost every useful command is admin-gated, and a non-admin gets a polite refusal that
looks like a bug.

1. Connect once with the client (Stage 7), or just read any earlier `.RPT`.
2. Find your ID in `testenv\profiles\*.RPT`:
   `Player "Tester" (steamID=76561198…) is connected` — the 17-digit number.
   **Do not** copy the `id=` from the `.ADM` log; that is a BattlEye GUID, a different thing.
3. **Stop the server**, put that number into `testenv\profiles\ZP_Research\Settings.json`
   → `AdminIds`, replacing the placeholder, and start the server again.

> **The trap.** The default `AdminIds` entry `76561190000000000` is a *syntactically valid*
> Steam64 placeholder. The boot line proudly says `adminIds=1`, nothing warns, and every
> command answers "немає прав доступу". And `!zp reload` is itself admin-gated, so you
> cannot fix it from in-game — the server must be restarted.
>
> Note also that `!zp help` answers **everyone**. It working proves nothing about admin
> rights. Use `!zp reload` as the real test.

Editing `Settings.json` while the server is **stopped** is safe: the file is read at boot and
written back unchanged. Editing it while the server runs is not — a live admin operation
overwrites the file from memory.

---

## Stage 5 — give yourself a faction

Factions are recognised by the **armband** worn in the `Armband` slot. Nothing else.

> **The trap.** All 29 default armband classnames belong to the author's STALKER modpack.
> On a vanilla+CF box **none of them exist**, so no one can ever have a faction, and every
> device says "not yours". The boot warning lists them all.

Vanilla armbands that actually exist: `Armband_White`, `Armband_Blue`, `Armband_Red`,
`Armband_Green`, `Armband_Black`, `Armband_Yellow`. Both example packs already wire
`Armband_White` → ecolog, `Armband_Blue` → clearsky, `Armband_Red` → duty.

In game: `!zp spawn Armband_White`, wear it, then `!zp faction` — it must print `ecolog`.

> Wait a few seconds after connecting before judging. When a character loads, the armband is
> restored **already worn**, so the attach event that normally triggers faction detection may
> not fire; the mod re-syncs about 4 seconds after connect.

---

## Stage 6 — the content packs

The mod ships **no content** — chains, tree and point costs are all admin-authored JSON.
On a virgin profile it seeds only its own defaults: 18 point types, 7 factions, 3 purity
modules, and one demo rule (`Apple` → `ZP_Sample`) that stops *before* producing anything
you can deposit. So a virgin install cannot reach a research point. Two ready-made packs
close that:

| Pack | What it is | Boot line |
|---|---|---|
| **`examples/minimal`** | The shortest complete loop: 3 factions with vanilla armbands, one sample type, one blank worth 3 points, a 2-step chain, a 2-node tree | `factions=3 pointTypes=18 rules=2 treeNodes=2 dataItems=1 modules=3 sampleTypes=1` — **0 warnings** |
| **`examples/test-stand`** | The author's full test bed: 12 faction devices in a Chernarus lab, 43 rules / 18 chains, 3 tree branches, 22 blanks, 6 sample types | `factions=7 pointTypes=24 rules=43 treeNodes=16 dataItems=22 modules=3 sampleTypes=6` — **9 warnings**, all expected (see its README) |

Install one with `prepare-testenv.ps1 -Example <name>`, or copy its files into
`<profiles>\ZP_Research\` by hand and run `!zp reload`.

To author your own, open `webeditor/dist/index.html` in Chrome or Edge, press **"Відкрити
папку ZP_Research"** and pick `testenv\profiles\ZP_Research` — the folder that contains
`Settings.json`. Editing works straight from `file://`; no local web server is needed.
After saving, run `!zp reload` in game.

> Point the picker at the folder **containing** `Settings.json`, not its parent. One level
> too high and every tab is empty with no error at all.
>
> Edit with the server **stopped**, or reload immediately: a live admin operation writes the
> mod's in-memory state over your file.

---

## Stage 7 — connect and run the loop

```powershell
.\testenv\run-client.ps1 -Name Tester
```

The client must load the **same** `-mod` list as the server; the script does that for you.

> **The trap.** Chat commands are keyed by player name. Two clients with the same name — the
> DayZ default is `Survivor` — and the server drops *every* command from both, with no reply
> in game whatsoever.

Now, in this order. Each step is cheap and proves one subsystem, so a failure tells you
*where* it failed:

| # | Do | Proof it worked |
|---|---|---|
| 1 | `!zp grantpool bio_lab_t1 5` then `!zp pool` | Pool shows 5. This proves the points subsystem with **no** armband, device or rule involved |
| 2 | `!zp spawn Armband_White`, wear it, `!zp faction` | Prints `ecolog` |
| 3 | `!zp staticadd ZP_SampleFridge` and `!zp staticadd ZP_LabComputer` | `!zp statics` lists both; you can see them |
| 4 | `!zp fillstation Apple 1 ZP_SampleFridge`, aim at it, hold **F** | After ~10 s a sample is **in the device's cargo** |
| 5 | Move the sample into the analyser's cargo, start it again | A data blank appears in cargo |
| 6 | Blank in hands, aim at `ZP_LabComputer`, hold **F** | Chat: `здано …: bio_lab_t1 +3 у пул ecolog` |
| 7 | Empty hands, aim at `ZP_LabComputer`, press **F** | The tech tree window opens; "Дослідити" spends the pool and unlocks the node |

If a prompt does not appear, `!zp probe` runs the server-side checks for the nearest device
and prints, per rule, either "ready" or exactly what is blocking (wrong faction, tree gate,
missing tool, not enough input). Use it before assuming anything is broken.

> **Two honest quirks.** A device placed with `!zp staticadd` takes its height from your
> feet, and models whose origin sits in their centre end up half-buried — that is placement,
> not a broken model. And an analyser legitimately produces nothing on some cycles: the
> output chance is multiplied by the sample's purity.

---

## When something is silently wrong

| Symptom | Most likely cause |
|---|---|
| Server never prints `configs loaded`, no error anywhere | Hand-written `serverDZ.cfg` → rerun `prepare-testenv.ps1 -Force`. Or it is simply the first boot: wait |
| Server exits a few seconds after start, RPT says nothing | No `instanceId` in `serverDZ.cfg` |
| Every command answers "немає прав доступу" | `AdminIds` still holds the placeholder (Stage 4) |
| Commands produce **no reply at all** | Two players share a name |
| `!zp faction` says `default` | Armband class not listed in `Factions.json`, or you waited less than ~4 s after connecting |
| No **F** prompt on a device | Nothing spawned yet; or your faction doesn't own it; or a rule gate is unmet — run `!zp probe` |
| **F** opens the tree instead of depositing | You are holding nothing depositable — the tree and the deposit share the key |
| `rules=0` after a restart, though it worked yesterday | One wrong *type* in a rules file (`"Enabled": "yes"`). The engine rejects the whole file and, at boot, that zeroes **all** rules. A live `!zp reload` is atomic and refuses instead, so the damage only appears at the next restart |
| `pointTypes=0` **and** `treeNodes=0` | A duplicate or empty `Id` in `PointTypes.json`. The registry is dropped whole, and every tree node whose cost references a type then fails too. The web editor blocks saving this |
| Client kicked on connect | Server has `verifySignatures = 2` but your PBO is unsigned → set it to 0, or sign with your own key |

---

## What this guide does not cover

- **`docs/test-commands.md`** describes the `examples/test-stand` pack specifically —
  its 12 devices, 18 chains and coordinates only exist after you install that pack.
- **`docs/admin-guide.md`** is written for a live RP server, not a local test box.
- Publishing to the Steam Workshop is done by hand with the DayZ Publisher.
