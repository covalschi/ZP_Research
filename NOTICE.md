# Third-party notices / Сторонні складові

`ZP_Research` is an add-on for **DayZ** by Bohemia Interactive. It ships **no**
third-party binary assets: every `model=` / texture path in `config.cpp` is a *reference*
to files that already exist in the player's own copy of the game or in mods they already
run. Nothing is repacked or redistributed.

`ZP_Research` — надбудова для **DayZ** (Bohemia Interactive). Мод **не містить** чужих
бінарних ассетів: усі шляхи `model=` / текстур у `config.cpp` — це *посилання* на файли,
які вже є у грі гравця. Нічого не перепаковано й не поширюється повторно.

---

## Runtime dependency / Залежність часу виконання

| Component | Licence | Use |
|---|---|---|
| [Community Framework (CF)](https://github.com/Jacob-Mango/DayZ-CommunityFramework) by Jacob Mango | LGPL-2.1 | RPC (`GetRPCManager`) and persistence (`CF_ModStorage`). CF is **not** bundled — the server owner installs it separately. |
| [VPPAdminTools](https://github.com/VanillaPlusPlus/VPP-Admin-Tools) | see upstream | optional: admin permission gate. The optional `ZP_Research_VPP` add-on is compiled only when VPP is present. |

## Engine / game

DayZ, its engine (Enfusion) and all vanilla assets are © Bohemia Interactive a.s.
Class names and model paths referenced in configs are used for interoperability only.

## Patterns and research / Патерни та дослідження

Public, openly licensed community projects were studied while designing this mod. No code
was copied verbatim from restrictively licensed sources; where a *pattern* is reused, the
origin is named in the comment next to it. Projects consulted include
DayZ-CommunityFramework (LGPL-2.1), DayZ official Samples (Bohemia), and community
documentation. Mods published under CC BY-NC-ND were used **only** as behavioural
reference (observing what the engine does) — never as a source of code or assets.

## Web editor dependencies / Залежності веб-редактора

The editor (`webeditor/`) is a Vite + React + TypeScript app; its runtime dependencies
(React, @xyflow/react, elkjs, fflate) carry their own permissive licences — see
`webeditor/package.json` and the lockfile. The published `webeditor/dist/index.html` is a
self-contained build of exactly that source.
