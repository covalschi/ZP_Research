# Fixtures: reference bytes from the game engine's own JsonFileLoader

Captured 2026-08-06. Purpose: byte-exact comparison targets for the canonical serializer
(Tasks 4-5) and an empirical answer to "how does the engine print floats" (0.2 / 0.3 / 0.25).

## How `gold/` was captured

1. Read `testserver\zp_run.ps1` for the working server command line (executable, `-config`,
   `-mod` list, port).
2. Ran the **same** server invocation with only two changes: a brand-new empty
   `-profiles` directory (no pre-existing `ZP_Research\` config folder) and `-port=2402`
   (to avoid colliding with the live stand on 2302, which was not running at the time).
   Binary: `E:\Programs\Steam\steamapps\common\DayZ\DayZDiag_x64.exe`. Mods:
   `@CF;@VPPAdminTools;@ZP_Research;@ZP_Research_VPP`. Config:
   `E:\dayzmod\testserver\serverDZ_full.cfg`.
3. On boot, `ZP_ConfigService` found no `ZP_Research\` folder under the fresh profile and
   ran `SetDefaults()` + `Save()` for every config root, writing brand-new files straight
   from the engine's `JsonFileLoader` writer — nobody had ever hand-edited these bytes.
   Script log confirms: `[ZP_Research] configs loaded: factions=7 pointTypes=18 rules=1
   treeNodes=0 dataItems=0 modules=3 adminIds=1 debug=on`.
4. No compile errors in the RPT (`Bad type` / `Can't compile` — zero matches). Server was
   then stopped (matched by the PID this session started; nothing else was touched).
5. `TechTree\` came up empty (0 files) — expected, the mod ships no built-in tree by design.
   `FactionData\`, `PlayerData\`, `ConfigBackup\` also came up empty (lazily created only
   on actual gameplay/admin actions).

Boot-to-files time: well under the 8-minute budget — the poll loop found the files on its
very first check window.

## Where each fixture came from

| File | Source | Why |
|---|---|---|
| `gold/Settings.json` | fresh `SetDefaults()`, engine-written | pristine engine output |
| `gold/PointTypes.json` | fresh `SetDefaults()`, engine-written | pristine engine output |
| `gold/Factions.json` | fresh `SetDefaults()`, engine-written | pristine engine output |
| `gold/DataItems.json` | fresh `SetDefaults()`, engine-written | pristine engine output, empty array case |
| `gold/Modules.json` | fresh `SetDefaults()`, engine-written | **the float-printing evidence** (see below) |
| `gold/StaticDevices.json` | fresh `SetDefaults()`, engine-written | bonus: another empty-array case, not one of the 8 web-editor configs but still real engine output, kept for extra byte-format evidence |
| `gold/ProcessingRules/demo.json` | fresh `SetDefaults()`, engine-written | nested objects/arrays, mixed float values (some exact, some not) |
| `gold/SampleTypes.json` | fresh `SetDefaults()`, engine-written — captured **2026-08-07** (W2.5 Task 2), NOT part of the 2026-08-06 session above | eighth config (`ZP_SampleTypesConfig`, added Task 2), empty-array case. Captured on `testserver\profiles\ZP_Research\SampleTypes.json` after a clean-profile boot with no pre-existing `SampleTypes.json` (`LoadSampleTypes` → `SetDefaults()` empty → `SaveSampleTypes()`), confirmed byte-identical (43 bytes) before and after two further probe boots that hand-wrote and then restored the file (task-2-report.md) — same "chesno porozhno" convention as `DataItems.json`/`Modules.json` |
| `live/chain.json` | `testserver\profiles\ZP_Research\ProcessingRules\chain.json`, copied as-is | provenance unproven either way — format-compatible with the engine (LF, 4-space indent, key shapes match), but NOT proven engine output. The earlier "ймовірно рукописні" verdict rested on a float-string argument that was **retracted 2026-08-06** (see "Float printer algorithm CRACKED" below) |
| `live/Settings.json` | `testserver\profiles\ZP_Research\Settings.json`, copied then **redacted** (see Privacy below) | same caveat as `chain.json` — format-compatible, provenance uncertain; non-default values (`TreeVisibilityDepth: 2`, `TreeBackgroundImage` set) |
| `stale/zone.json` | `testserver\profiles\ZP_Research\TechTree\zone.json`, copied as-is | **hand-written**, outdated format fixture (CRLF, cancelled `ResearchDevice` key, `Icon` last) — kept specifically so the tolerant parser (Task 5) has a real "wrong format" sample to warn on, not a byte target to reproduce |

`testserver\profiles\` (the live stand) was not modified in any way — everything under it
was only read/copied from.

### Provenance correction [PARTIALLY RETRACTED 2026-08-06] (original title: "`live/*` is NOT engine-evidence")

> **[PARTIALLY RETRACTED 2026-08-06 — see "Float printer algorithm CRACKED" below.]**
> The "different printer / demonstrably not engine output" argument in this section is
> void: the cracked engine algorithm reproduces `live/chain.json`'s float strings too.
> What still stands: provenance of `live/*` is unproven either way, and `gold/*` remains
> the only binding float-printer evidence. Falsified sentences below are struck through
> and kept for history.

The first pass of this README called `live/chain.json` and `live/Settings.json`
"engine-written," reasoning from LF-only line endings. That reasoning doesn't hold — a text
editor or a hand-written tooling script can write LF just as easily as the engine can; LF
alone proves nothing about who wrote the bytes.

~~Direct evidence it's actually **not** engine output:~~ `live/chain.json` contains
`"BasePurityMin": 0.4000000059604645` and `"BasePurityMax": 0.800000011920929` — 16 and 15
significant digits respectively. Compare that to `gold/Modules.json`'s
`0.20000000298023225` and `0.30000001192092898` — both 17 significant digits.
~~The `live/chain.json` numbers are exactly the *shortest round-trip* decimal form a
JS-style float32 printer (e.g. `Math.fround(0.4).toString()`) would produce, which is a
variable-length, shorter representation — a different algorithm than the engine's fixed
~17-digit expansion seen consistently across every `gold/*` sample.~~ **[RETRACTED
2026-08-06: the engine's output length is variable, "fixed ~17-digit expansion" was an
over-generalization; and for `0.4f`/`0.8f` the engine's truncated-upper-midpoint form
coincides with the JS-shortest form.]** ~~**The engine printer
demonstrably does not produce `live/chain.json`'s float strings.**~~ **[RETRACTED
2026-08-06: it demonstrably DOES — the algorithm cracked from `gold/*` alone reproduces
them exactly; see "Float printer algorithm CRACKED" below.]**

Conclusion ~~: `live/chain.json` (and, by the same reasoning, `live/Settings.json`) were most
likely produced by an earlier tooling/authoring session — **ймовірно рукописні (авторський
інструментарій), формат сумісний із рушійним, але НЕ еталон принтера float** — not captured
from a running engine instance~~ **[RETRACTED 2026-08-06: with the float argument void,
there is no evidence for "most likely hand-written" — provenance is simply unproven either
way]**. They remain useful as *format-compatible* samples (real
Ukrainian `Notes` text, LF endings, plausible key shapes, a second `Settings.json` with
non-default values) but **must not be cited as float-printer evidence anywhere in this
project.** The only binding byte-reference for the float printer is `gold/*` — every
float-printing claim in this document is (and must stay) sourced from `gold/Modules.json`
and `gold/ProcessingRules/demo.json` alone.

## Byte-format facts (measured directly, not assumed)

Swept every fixture byte-by-byte (`od -tx1`, not a text/hex-string search — Cyrillic UTF-8
bytes like `0xD0`/`0xD1` create false substring hits in naive hex-grep, so raw byte-value
counts were used instead).

| File | BOM | CR (0x0D) count | LF (0x0A) count | Last byte | Indent |
|---|---|---|---|---|---|
| gold/Settings.json | none | 0 | 12 | `}` (0x7D), no trailing newline | 4 spaces/level |
| gold/PointTypes.json | none | 0 | 213 | `}`, no trailing newline | 4 spaces/level |
| gold/Factions.json | none | 0 | 96 | `}`, no trailing newline | 4 spaces/level |
| gold/DataItems.json | none | 0 | 3 | `}`, no trailing newline | 4 spaces/level |
| gold/Modules.json | none | 0 | 28 | `}`, no trailing newline | 4 spaces/level |
| gold/StaticDevices.json | none | 0 | 3 | `}`, no trailing newline | 4 spaces/level |
| gold/ProcessingRules/demo.json | none | 0 | 33 | `}`, no trailing newline | 4 spaces/level |
| live/chain.json | none | 0 | 120 | `}`, no trailing newline | 4 spaces/level |
| live/Settings.json | none | 0 | 12 | `}`, no trailing newline | 4 spaces/level |
| stale/zone.json | none | 304 | 304 (paired, i.e. CRLF throughout) | `}`, no trailing newline | 4 spaces/level |

Conclusions:
- **Every `gold/*` file (confirmed engine-written) is UTF-8, no BOM, pure LF, no trailing
  newline after the final `}`.** This holds for all 7 samples from the single fresh-default
  boot — consistent behavior across every config root in one boot, though (per the
  provenance correction above) it is only one boot's worth of direct evidence.
- `live/chain.json` and `live/Settings.json` are *also* LF-only, no-BOM, no-trailing-newline
  — but per the provenance correction above, this is now treated as merely
  **format-compatible**, not independent proof of engine authorship (LF is cheap to produce
  by hand or by tooling). Kept in the table for completeness, not as corroborating evidence.
- `stale/zone.json` is CRLF throughout (304 CR paired 1:1 with 304 LF) and is the **only**
  fixture that isn't LF-only — confirms it was hand-written/hand-edited outside the engine
  (a text editor on Windows defaulting to CRLF), consistent with it also carrying the
  cancelled `ResearchDevice` key and `Icon` field out of the current struct's declared order.
- **Indentation is a flat 4 spaces per nesting level** in every file, including the stale
  one (4, 8, 12... spaces for object → array → array-item → field nesting). No tabs.
- **Key order follows the C++/Enforce struct's field declaration order, not alphabetical**
  (e.g. `Settings.json`: `ConfigVersion, DebugMode, AdminIds, DefaultFaction,
  TreeTerminalClasses, TreeVisibilityDepth, TreeBackgroundImage` — matches
  `ZP_SettingsConfig`'s field order, not A-Z).
- **Empty arrays print inline on one line**: `"Items": []`, `"Entries": []` — not
  multi-line with the brackets on separate lines.

## Float printing verdict (the headline finding)

From `gold/Modules.json`, `Modules.json → PurityBonus` was configured in source
(`ZP_ModulesConfig.SetDefaults`) as the literal float values `0.2`, `0.3`, `0.25`. The
engine wrote them as:

```
"PurityBonus": 0.20000000298023225,   // configured as 0.2
"PurityBonus": 0.30000001192092898,   // configured as 0.3
"PurityBonus": 0.25,                  // configured as 0.25
```

And from `gold/ProcessingRules/demo.json` (same config load, different fields):

```
"BasePurityMin": 0.5,     // configured as 0.5
"BasePurityMax": 0.5,
"TimeSec": 10.0,          // configured as 10 (int-looking, still printed with .0)
"Chance": 1.0,             // configured as 1
```

**Verdict** **[SUPERSEDED 2026-08-06 — the exact algorithm is now known, see "Float
printer algorithm CRACKED" below; this paragraph's "full round-trip decimal expansion"
reading was an over-generalization]**: Enforce Script's `float` is 32-bit. The JSON writer
evidently widens it to a
64-bit double and ~~prints the double's *full round-trip decimal expansion*, not a
short/rounded form~~ **[RETRACTED 2026-08-06: it prints the shortest decimal *truncation*
of the upper rounding-interval midpoint — variable length, not a full/fixed expansion]**.
For values that are **exactly representable in binary floating point**
(0.5, 0.25, 1.0, 10.0 — all sums of powers of two) the float32→double widening is lossless,
so the printed string is short and clean. For values that are **not exactly representable**
in float32 (0.2, 0.3 — repeating binary fractions) the widening exposes the float32
rounding error as ~17 significant decimal digits (`0.20000000298023225`,
`0.30000001192092898`).

**Implication for the canonical serializer (Task 4)**: it cannot just call
`Number.prototype.toString()` on a JS double and expect a byte match — ~~it must reproduce
this "round-trip through 32-bit float, then print full double precision" behavior~~
**[SUPERSEDED 2026-08-06: the correct rule is the truncated-upper-midpoint algorithm in
"Float printer algorithm CRACKED" below, which Task 4 implemented; "print full double
precision" would produce wrong bytes for e.g. `0.4f`/`0.8f`]** for any
field the schema marks as the engine's `float` type, or the serializer will diverge from
the engine on almost every non-power-of-two config value (which is most of them — purity
bonuses, chances, time durations are rarely round numbers).

~~Not yet observed empirically: a value whose float32 widening produces a *shorter* string
than 17 digits but still differs from the literal typed value (e.g. something like `0.1`).
Task 4/5 should treat "print the double representation of the float32 value" as the rule,
not "print however many digits `0.2`/`0.3` happened to need" — the three captured samples
are consistent with that rule but a fourth boot with more varied literals (0.1, 0.7, 0.15,
etc.) would strengthen it further if time allows.~~ **[SUPERSEDED 2026-08-06: the gap is
closed by the cracked algorithm — shorter-than-17-digit inexact values are expected and
explained (e.g. `0.4f` → 16 digits, `0.8f` → 15), no extra boot needed.]**

**Do not use `live/chain.json` to fill this gap.** It does contain shorter-than-17-digit
float strings (`0.4000000059604645`, `0.800000011920929`), ~~but per the "Provenance
correction" section above, those are the signature of a *different* (shortest-round-trip)
float printer, not the engine's — using them here would contaminate the verdict with
non-engine evidence~~ **[RETRACTED 2026-08-06: those strings match the engine's cracked
algorithm exactly; the do-not-cite rule survives only because `live/*` provenance is
unproven, not because the strings look non-engine]**. `gold/*` (single boot, 7 files) is
the only source this verdict may
draw on.

## Float printer algorithm CRACKED (Task 4, 2026-08-06)

The verdict above ("full round-trip decimal expansion", implying a fixed ~17 significant
digits) turned out to be an over-generalization from three samples. The actual algorithm,
derived from and verified against **every** float string in `gold/*` with exact BigInt
arithmetic (`webeditor/src/io/jsonWriter.ts`, `fmtFloat`):

> Widen the stored float32 losslessly to double `d`. Print the **shortest decimal
> truncation** `P` of the upper rounding-interval midpoint `up = d + ulpAbove(d)/2`
> such that `P >` the lower midpoint `lo = d − ulpBelow(d)/2` (half-ulp gap below is
> halved again at power-of-two boundaries). Digits are generated from the *upper*
> boundary and **truncated — never rounded up**. Integer-valued results get `.0`.

This is a Steele-White-style free-format printer with the round-up branch missing. It
explains every observation at once:

- `0.2f → 0.20000000298023225` — 17 digits, one final-digit unit *above* the correctly
  rounded shortest form (`…224`, which is what JS `String(Math.fround(0.2))` prints),
  because the digits come from the upper midpoint, truncated;
- `0.3f → 0.30000001192092898` (correctly rounded would be `…896`);
- `0.25 → 0.25`, `0.5 → 0.5` — exact binary fractions stop early;
- `10 → 10.0`, `1 → 1.0` — integer values, `.0` appended;
- **output length is variable**, not "always 17 digits".

Any `P` in `(lo, up]` parses back to exactly `d`, so the printed string always
round-trips into the same float32 (property-tested on 50 000 random float32 bit
patterns in `webeditor/tests/jsonWriter.test.ts`).

**Consequence for the Provenance-correction section above**: its *argument* is now void —
the same cracked algorithm also reproduces `live/chain.json`'s
`0.4000000059604645` / `0.800000011920929` / `15.0` exactly (for `0.4f`/`0.8f` the
truncated-upper-midpoint form happens to coincide with the JS shortest form; that
coincidence is what misled the earlier analysis). So `chain.json`'s floats are fully
consistent with the engine printer after all, and `live/chain.json` +
`live/Settings.json` both survive **byte-identical** round-trip through the Task 4
serializer (`webeditor/tests/roundtrip.test.ts`). Their provenance remains unproven
either way — the binding byte-reference for every printer claim is still `gold/*` only —
but the "demonstrably not engine output" conclusion is withdrawn.

## Bool printing

Observed: `DebugMode: true` → `"DebugMode": 1`; `Enabled: true` (rule default) →
`"Enabled": 1`; `ConsumeInput: true` (rule default) → `"ConsumeInput": 1`. Bools print as
bare JSON integers `0`/`1`, not `true`/`false` — matches the earlier confirmed finding from
the in-game editor work (`"export bool→1/0 as JsonFileLoader"`, `CLAUDE.md`).

**Gap**: none of the captured fixtures contain a bool field whose *default* is `false`, so
the `0` side of this convention is not directly observed in these bytes (only inferred from
`JsonFileLoader`'s known int-cast behavior, already relied on elsewhere in the project).
If Task 4/5 needs a directly-observed `false` example, boot again after flipping one bool
default, or check a live file where an admin has since disabled something
(`Enabled: false` is reachable via the in-game editor's rule toggle).

## Hex-string / stringtable-key trap (already known, reconfirmed here)

`gold/PointTypes.json` writes `"Color": "#7CB342"` literally, leading `#` included. This is
the same value shape that, if ever piped through `Widget.TranslateString` on the client
(e.g. via `NameOverride`), the engine misreads as a stringtable-key lookup (2026-08-05
finding, already in `CLAUDE.md`). Not directly relevant to the serializer's byte format, but
worth remembering when the web editor renders/edits this field.

## Note: `gold/Factions.json` contains a non-Ukrainian proper noun («Долг»)

`gold/Factions.json` has `"DisplayName": "Долг"` for the `duty` faction — inherited
verbatim from `ZP_FactionsConfig.c`'s `SetDefaults()`. This is a faction proper noun (an
in-universe STALKER name), not stray Russian prose; the fixture is a byte-exact engine
capture and must not be "fixed" or translated — doing so would make it stop matching what
the engine actually writes.

## AdminIds default is NOT empty (corrects an earlier assumption)

The task brief assumed "fresh defaults have empty AdminIds." That's wrong — `SetDefaults()`
(`ZP_SettingsConfig.c`) inserts one sample entry:

```
AdminIds.Insert("76561190000000000");  // зразок формату (невалідний steam64 — замінити)
```

`76561190000000000` is 17 digits and starts with the real Steam64 prefix `7656119...`, so
it superficially matches "looks like a real Steam64 ID." It is not one: real individual
SteamID64s start at `76561197960265728` (Universe=1, Type=Individual, Instance=1) and count
up from there; `76561190000000000` is numerically *below* that minimum, so it can never be
a real account ID. The source comment confirms it's an intentionally invalid placeholder
sample. `gold/Settings.json` was committed as captured, containing this placeholder.

## Privacy: one real Steam64 was found and redacted

`testserver\profiles\ZP_Research\Settings.json` (the live stand, still running admin
sessions from the joint-test work) contains a **real-looking** admin Steam64
(`AdminIds: ["76561198XXXXXXXXX"]` — 17 digits, above the valid minimum, i.e. a plausible
real account; digits stand-in'd here deliberately, the actual value never appears in this
document). Before committing, this value was replaced in the **fixture copy only**
(`live/Settings.json`) with the same invalid placeholder used in `gold/Settings.json`
(`76561190000000000`), via an in-place raw-byte ASCII substring replace — both strings are
17 ASCII digits, so the file's byte length (289 bytes), encoding, and every other byte
(BOM/EOL/indent/last-byte) are unaffected by the substitution; only the digits themselves
changed. `testserver\profiles\...\Settings.json` itself was **not modified** — only the
copy under `webeditor/tests/fixtures/live/` was edited after the byte-exact `Copy-Item`.

A full sweep of every file under `webeditor/tests/fixtures/` for any `7656`-prefixed
17-digit number, and separately for any 15+ digit number of any shape, turned up nothing
else: only the two (now-identical) invalid placeholders in `gold/Settings.json` and
`live/Settings.json`, plus float-printing artifacts in `gold/Modules.json` and
`live/chain.json` (16-17 digit decimal expansions that don't start with `7656` and aren't
Steam64-shaped).

## Files

```
webeditor/tests/fixtures/
  gold/
    Settings.json
    PointTypes.json
    Factions.json
    DataItems.json
    Modules.json           <- float-printing evidence
    StaticDevices.json     <- bonus, not one of the 8 web-editor configs
    SampleTypes.json        <- eighth config, captured 2026-08-07 (W2.5 Task 2)
    ProcessingRules/
      demo.json
  live/
    chain.json              (LF, format-compatible; provenance unproven either way —
                              not citable as binding printer evidence, but its float
                              strings ARE reproduced by the cracked engine printer and
                              byte-round-trip through the Task 4 serializer is verified;
                              see "Float printer algorithm CRACKED" above)
    Settings.json            (LF, format-compatible; provenance uncertain; AdminIds
                              redacted, see Privacy above)
  stale/
    zone.json               (hand-written, CRLF, outdated format — negative fixture)
  README.md                 (this file)
```
