# Local test server

Scripts to run ZP_Research on your own machine. Full walkthrough:
[docs/testing-on-another-machine.md](../docs/testing-on-another-machine.md).

```powershell
.\testenv\prepare-testenv.ps1 -Example minimal   # config + mission + example content
.\build\build.ps1                                # pack the PBOs
.\testenv\run-server.ps1                         # start, wait for proof, print it
.\testenv\run-client.ps1 -Name Tester            # join it
.\testenv\stop-server.ps1
```

| Script | What it does |
|---|---|
| `prepare-testenv.ps1` | Copies your **stock** `serverDZ.cfg` and applies three edits, ensures `<DayZ>\mpmissions\<template>` exists, optionally seeds the profile from `examples\` |
| `run-server.ps1` | Launches the server and waits for the mod's `configs loaded` line instead of a fixed sleep. `-WithVpp`, `-Port`, `-Fresh` (wipe the mod's configs and recreate defaults) |
| `run-client.ps1` | Launches a client with the **same** `-mod` list. `-Name` matters: duplicate names make the server drop every chat command |
| `stop-server.ps1` | Stops only the process started from here — the same executable is also your game client |
| `find-dayz.ps1` | Shared lookup: parameter → `DAYZ_ROOT` → Steam registry → Steam libraries |

Everything this folder generates (`serverDZ.cfg`, `profiles\`, `clientprofile\`,
`server_pid.txt`) is gitignored. Nothing here touches the repository.

Two reasons these scripts exist rather than a paragraph of instructions: a hand-written
minimal `serverDZ.cfg` hangs a 1.29 server forever with no error at all, and the first boot
legitimately takes minutes — both look exactly like a broken mod.
