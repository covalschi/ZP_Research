# ZP_Research — research tree framework for DayZ

A server-side framework that turns scavenged loot into **research points** and spends them
on a **faction technology tree**. Built for the STALKER-style RP server
*[UA] Stalker: Zone Protocol AI*, but the mod itself ships **no content** — every chain,
point type, faction and tree node is admin-defined JSON.

Ships with a **WYSIWYG web editor** for those configs: a single self-contained HTML file
that opens the server's config folder, draws the processing chains and the tech tree as
graphs, and mirrors the server's own validation so you see what the game will reject
*before* you restart it.

> **Українською:** фреймворк дерева досліджень для DayZ. Сировина → зразок → заготовка →
> бали в пул фракції → дослідження вузлів дерева. Мод не містить контенту — ланцюги, типи
> балів, фракції та вузли задає адміністратор у JSON. У комплекті — веб-редактор цих
> конфігів (один самодостатній HTML-файл).

---

## What it does

**Processing stations.** Static in-world devices with cargo. Put raw materials in, the
station runs a timed cycle in the background (survives server restarts — state is stored by
timestamp, not by a timer), and produces an intermediate **sample** or a finished **data
blank**.

**Two-entity chain.** A *sample* is one class with hidden fields (`Content`, `Purity`) —
read by machines, invisible to players. A *data blank* is an ordinary item class whose name
tells the player what it is. Machines read the hidden field; humans read the name.

**Purity.** Sample purity = base roll × input quality + module bonuses; a downstream
station multiplies its output chance by it. Purity modules are attachments in device slots.

**Points and the tree.** Blanks are deposited at a faction terminal for points. Points live
in a **faction pool** (the mod stores nothing about individual players). Tree nodes cost
points and optionally items; research can be instant or a timed project. Nodes gate
processing rules (`RequiredNode`), so the tree actually unlocks production.

**Faction isolation.** Factions are recognised by armband class. Terminals and devices
belong to factions: *no own terminals — no terminals at all*, so one faction cannot read
another's tree or use its stations.

**Admin surface.** All configuration is JSON under `$profile:ZP_Research\`, hot-reloadable
with `!zp reload`; every edit goes through one transactional server contract with backups.

## The web editor

Open `webeditor/dist/index.html` in a browser — no install, no server, no network.

- **Chains** — a canvas of *item → station → item*; station windows let you add raw
  materials in bulk, wire "where does the result go", and clone a station's whole setup onto
  another device with a substitution table.
- **Tree** — Tier columns, drag a node to change its tier, connect parents with the mouse;
  refuses edits that would strand nodes, exactly like the server's own guard.
- **Points** — the Category × Kind × Tier matrix, with the axes themselves editable.
- **Factions / Modules / Settings / Blanks / Samples** — full forms with live-search
  dropdowns over the real class list of your modpack.
- **Balance** — read-only "what gives how much": blanks × point types, who produces what,
  and tree cost against what each faction can actually mine.
- **Validation mirror** — the editor reproduces the server's own load-time checks (quoting
  the engine source line for each), and *blocks* saving/exporting a file the server would
  reject wholesale.

Files can be edited **directly in the profile folder** (File System Access API) or via
**ZIP import/export**. Output is byte-identical to what the engine itself writes.

## Repository layout

```
ZP_Research/        the mod: config.cpp, Enforce scripts, stringtable, types
ZP_Research_VPP/    optional add-on: admin permission via VPPAdminTools
webeditor/          the config editor (Vite + React + TS); dist/index.html is the build
build/              PBO build + signing, script compile check, class generators
scripts/            class-index generator (reads modpack PBOs)
keys/               public .bikey for signature verification
docs/               admin guide, test cheat-sheet, tech-tree design
```

## Building the mod

**Prerequisites:** Windows, and **DayZ Tools** installed from Steam (Library → Tools →
*DayZ Tools*). The scripts locate it automatically via the Steam registry entry and the
Steam library folders; override with `-ToolsRoot` or the `DAYZ_TOOLS` environment variable
if it lives somewhere unusual.

```powershell
git clone https://github.com/covalschi/ZP_Research.git
cd ZP_Research
.\build\build.ps1
```

This produces two mod folders next to the repo:

- `@ZP_Research` — the mod itself;
- `@ZP_Research_VPP` — the optional VPPAdminTools tab (load it **only** together with VPP;
  it hard-depends on VPP scripts and the game refuses to start without them).

### Signing

The build signs the PBOs **only if a private key is present** in `keys/`. That key is not
in this repository and never will be — it belongs to the original author. Without it the
build succeeds and simply prints a warning; unsigned PBOs are fine for a local test server.

To publish your own build, make your own key pair and put both files in `keys/`:

```powershell
& "$env:ProgramFiles(x86)\Steam\steamapps\common\DayZ Tools\Bin\DsUtils\DSCreateKey.exe" MyMod
```

Servers verifying signatures need the **public** `.bikey` in their `keys/` folder; the
`.biprivatekey` must stay on your machine only.

### Checking that scripts compile

DayZ compiles client-only code (menus, GUI) that a headless server never touches, so a
clean server boot does not prove the whole mod compiles. This runs the diagnostic
executable, waits, and greps the log:

```powershell
.\build\client-compile-check.ps1            # prints CLIENT_COMPILE_OK / _FAIL
```

It needs `@CF` and `@VPPAdminTools` present in the game's `!Workshop` folder, because the
editor tab compiles only when VPP is loaded.

## Building the editor

```bash
cd webeditor
npm install
npm test        # 1119 unit tests
npm run build   # produces the single-file dist/index.html
```

`dist/index.html` is committed, so you can also just open it without building anything.

### Class index

Live-search dropdowns are backed by `webeditor/src/data/classindex.json` — a snapshot of
every class in a modpack. The bundled one reflects the author's server. Regenerate it for
your own modpack either **in the browser** (the editor's "import classes" panel reads PBOs
locally, no install needed) or on the command line:

```bash
python scripts/gen-classindex.py --scratch /tmp/idx --out webeditor/src/data/classindex.json --summary
```

Pass `--dayz-root` / `--workshop-root` / `--own-mod` if your paths differ from the defaults.

## Requirements

- DayZ server 1.29+
- [Community Framework](https://github.com/Jacob-Mango/DayZ-CommunityFramework) (CF)
- optional: VPPAdminTools (for the permission gate)

## Language

The mod ships **Ukrainian + English** strings. The engine of DayZ 1.29 has no `ukrainian`
column in stringtables, so Ukrainian is placed in `original` (the fallback for every
locale) and English in `english`.

## Licence

MIT — see [LICENSE](LICENSE). Third-party notices: [NOTICE.md](NOTICE.md).
