# Example content packs

The mod ships **no content**: every chain, point type, faction and tree node is
admin-authored JSON. On a virgin profile it seeds only its own defaults — 18 point types,
7 factions, 3 purity modules and a single demo rule that stops at the sample stage — so a
fresh install cannot reach a research point. These packs close that gap.

Install one with:

```powershell
.\testenv\prepare-testenv.ps1 -Example minimal
```

or copy its files into `<profiles>\ZP_Research\` by hand and run `!zp reload` in game.
(`README.md` files in these folders are documentation, not config — don't copy them.)

| Pack | Use it when |
|---|---|
| [`minimal/`](minimal/) | You want the shortest complete loop, and a **zero-warning** boot to compare against |
| [`test-stand/`](test-stand/) | You want the author's full test bed — 12 devices, 18 chains, three tree branches — which is what `docs/test-commands.md` describes |

Both packs are written in the engine's exact byte format (UTF-8 without BOM, LF, 4-space
indent, no trailing newline, `1`/`0` for booleans, every schema field present). That is not
cosmetic: a missing key is read as zero, not as the field's default, and a *wrong-typed*
value makes the engine reject the whole file at the next restart.

Both were verified by booting a server against them: see each README for the exact line.

Neither pack contains `Settings.json` — it holds your own `AdminIds`, and the mod creates
it with defaults on first boot.
