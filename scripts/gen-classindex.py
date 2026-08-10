#!/usr/bin/env python3
"""Generate webeditor/src/data/classindex.json by scanning DayZ PBOs for class names.

Walks every PBO in the vanilla install, the Steam Workshop client modpack, and our own
built mods, extracts each PBO's config.bin/config.cpp entry WITHOUT unpacking the whole
archive (the PBO file-name table is plaintext at the start of the file, so the target
entry's offset can be computed directly), converts binarized configs to text via
CfgConvert.exe, and walks a hand-written brace-aware parser over the text to collect the
direct (top-level) children of five config roots: CfgVehicles, CfgMagazines,
CfgNonAIVehicles, CfgAmmo, cfgWeapons.

These five roots -- and this exact order for the index -- mirror
ZP_ProcessingRules.ClassExists (ZP_ProcessingConfig.c:175-188 in the mod), the server-side
function that decides whether an admin-typed classname in a rule (Device/InputItem/
Consumables/Outputs/RequiredTools/RequiredWorn) is even a real engine class:
  CfgVehicles -> CfgAmmo -> CfgMagazines -> cfgWeapons -> CfgNonAIVehicles
(root indices 0/3/2/4/1 respectively; index numbering here keeps the original three roots
at 0/1/2 for backward compatibility with the already-shipped classindex.json consumers --
see ROOT_INDEX below -- so it does NOT match ClassExists' left-to-right order literally,
only its SET of roots). Task 4 fix-round-1 (Important 3) found the original three-root
scan invisible to weapon/ammo classes (e.g. vanilla 'AKM' under cfgWeapons, 'Bullet_762x39'
under CfgAmmo) even though the server accepts them as valid rule inputs -- the editor's
isKindOf/classRoot were reporting false "class not found" breaks for perfectly valid
in-game rules. `cfgWeapons` (lowercase 'c') is not a typo: verified directly against a real
decompiled vanilla config (weapons_firearms.pbo -> AKM/config.bin, CfgConvert.exe -txt)
during the fix -- Bohemia's own weapons config root is genuinely lowercase-c, matching the
mod's own ClassExists string literal exactly. Root-name matching in parse_class_defs below
is case-insensitive regardless (defensive: a third-party mod could still spell it
'CfgWeapons'), since the engine's own config-path lookup is case-insensitive everywhere
else in this codebase.

This mirrors what the in-game admin tool ZP_ClassIndex
(ZP_Research/scripts/5_Mission/ZP_Research/ZP_ClassIndex.c) sees via
GetGame().ConfigGetChildrenCount()/ConfigGetChildName(), EXCEPT this script does not
filter by `scope` (ZP_ClassIndex drops scope<1 / purely-abstract classes; see report for
why the two counts diverge).

Reuses the PBO header parser + LZSS decompressor from the dayz-modding skill's
extract_pbo.py (validated byte-identical against Bohemia's BankRev.exe) instead of
reimplementing them.

Usage:
    python scripts/gen-classindex.py --out webeditor/src/data/classindex.json --summary
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import struct
import subprocess
import sys
import time
from pathlib import Path
from typing import Iterable, Iterator

# ---------------------------------------------------------------------------------------
# Reuse the PBO header parser + LZSS decompressor instead of reimplementing them.
# NOTE: that helper belongs to the author's private tooling and is NOT part of this
# repository, so this script runs only in the development tree. Everyone else should use
# the editor's built-in importer, which does the same job in the browser.
# ---------------------------------------------------------------------------------------
_SKILL_SCRIPTS = Path(__file__).resolve().parent.parent / ".claude" / "skills" / "dayz-modding" / "scripts"
sys.path.insert(0, str(_SKILL_SCRIPTS))
try:
    import extract_pbo as ep  # noqa: E402  (read_asciiz, lzss_decompress)
except ModuleNotFoundError:  # pragma: no cover - environment guard
    sys.exit(
        "extract_pbo.py not found (looked in %s).\n"
        "It is part of the author's private tooling and is not shipped here.\n\n"
        "To rebuild the class index for your own modpack, use the editor instead:\n"
        "open webeditor/dist/index.html, press the class-import button and pick your\n"
        "!Workshop folder. It reads the PBOs in the browser - no Python, no game install -\n"
        "and produces the same index (parity covered by unit tests)." % _SKILL_SCRIPTS
    )

DEFAULT_DAYZ_ROOT = Path(r"E:\Programs\Steam\steamapps\common\DayZ")
DEFAULT_WORKSHOP_DIRNAME = "!Workshop"
DEFAULT_CFGCONVERT = Path(
    r"E:\Programs\Steam\steamapps\common\DayZ Tools\Bin\CfgConvert\CfgConvert.exe"
)
# Our own built mods: NOT under DayZ\!Workshop, but the live server loads them (see
# testserver\zp_run.ps1), and ZP_Microscope/ZP_Data_01/ZP_Sample -- mandatory spot-check
# names from the task brief -- are only ever defined here. Treated as extra sources.
DEFAULT_OWN_MODS = [
    Path(r"E:\dayzmod\@ZP_Research"),
    Path(r"E:\dayzmod\@ZP_Research_VPP"),
]

# Indices 0/1/2 are the original three roots (unchanged, backward-compatible with the
# already-shipped classindex.json / webeditor/src/model/classIndex.ts Root type). 3=CfgAmmo
# and 4=cfgWeapons were APPENDED (Task 4 fix-round-1, Important 3) rather than reordered to
# match ClassExists' own declaration order -- appending keeps the numbering of the first
# three roots stable across the regeneration instead of silently renumbering every existing
# row in the index.
ROOTS = ("CfgVehicles", "CfgMagazines", "CfgNonAIVehicles", "CfgAmmo", "cfgWeapons")
ROOT_INDEX = {name: i for i, name in enumerate(ROOTS)}
# Case-insensitive companion table: maps a root name AS IT MIGHT APPEAR IN REAL CONFIG TEXT
# (any casing) to the canonical spelling above, so parse_class_defs recognizes "CfgWeapons"
# just as readily as the verified real "cfgWeapons" -- config root identifiers are
# case-insensitive at the engine level (same premise as class-name matching everywhere else
# in this script/the TS classIndex.ts mirror).
_ROOT_CANONICAL_BY_LOWER = {name.lower(): name for name in ROOTS}
_BIN_SIGNATURE = b"\x00raP"


# =========================================================================================
# Section 1: locate + extract only the config.bin/config.cpp entry of a PBO (no full unpack)
# =========================================================================================


def find_pbo_payloads(pbo_path: Path) -> tuple[list[tuple[str, bytes]], list[bytes]]:
    """Parse a PBO's header (plaintext file-name table) and return the raw bytes of every
    entry whose basename is config.bin/config.cpp (normally exactly one; obfuscated packs
    occasionally carry decoy entries under the same name, hence a list of candidates) PLUS
    every stringtable.csv entry (index v2: $STR_ display-name resolution -- mods carry
    their stringtables at arbitrary internal paths, basename match only, in entry order).
    Decompresses 'Cprs' entries with the LZSS codec reused from extract_pbo.py.
    """
    buf = pbo_path.read_bytes()
    pos = 0
    entries: list[tuple[str, int, int, int]] = []
    while True:
        name, pos = ep.read_asciiz(buf, pos)
        packing, orig, _res, _ts, dsize = struct.unpack_from("<IIIII", buf, pos)
        pos += 20
        if packing == 0x56657273:  # 'Vers' -- key/value properties block, no data payload
            while True:
                k, pos = ep.read_asciiz(buf, pos)
                if not k:
                    break
                _v, pos = ep.read_asciiz(buf, pos)
            continue
        if name == "" and packing == 0 and dsize == 0:
            break  # header terminator
        entries.append((name, packing, orig, dsize))
    data_pos = pos
    offsets = []
    for _name, _packing, _orig, dsize in entries:
        offsets.append(data_pos)
        data_pos += dsize
    configs: list[tuple[str, bytes]] = []
    stringtables: list[bytes] = []
    for (name, packing, orig, dsize), off in zip(entries, offsets):
        base = name.replace("\\", "/").rsplit("/", 1)[-1].lower()
        if base not in ("config.bin", "config.cpp", "stringtable.csv"):
            continue
        raw = buf[off : off + dsize]
        if packing == 0x43707273:  # 'Cprs'
            raw = ep.lzss_decompress(raw, orig)
        if base == "stringtable.csv":
            stringtables.append(raw)
        else:
            configs.append((name, raw))
    return configs, stringtables


def looks_like_config_text(text: str) -> bool:
    """Cheap decoy filter (mirrors ScanPbo.ps1's printable-ratio heuristic): a genuine
    config always contains the literal word 'class' and is overwhelmingly printable ASCII/
    whitespace; a decoy or misdecoded blob usually fails one of the two."""
    if not text:
        return False
    sample = text[:65536]
    if "class" not in sample and "Cfg" not in sample:
        return False
    printable = sum(1 for c in sample if c.isprintable() or c in "\r\n\t")
    return printable / max(1, len(sample)) > 0.85


def to_text(raw: bytes, cfgconvert: Path, scratch: Path) -> str | None:
    """Binarized (\\0raP signature) -> shell out to CfgConvert.exe -> text. Otherwise the
    entry is already plaintext (config.cpp, or a mod that ships an unbinarized config.bin
    -- some obfuscated packs do this to confuse tools expecting the signature)."""
    if raw[:4] == _BIN_SIGNATURE:
        tmp_bin = scratch / "_convert.bin"
        tmp_cpp = scratch / "_convert.cpp"
        tmp_bin.write_bytes(raw)
        if tmp_cpp.exists():
            tmp_cpp.unlink()
        result = subprocess.run(
            [str(cfgconvert), "-txt", "-dst", str(tmp_cpp), str(tmp_bin)],
            capture_output=True,
            timeout=30,
        )
        if result.returncode != 0 or not tmp_cpp.exists():
            return None
        return tmp_cpp.read_bytes().decode("utf-8", errors="replace")
    return raw.decode("utf-8", errors="replace")


def pbo_payloads(
    pbo_path: Path, cfgconvert: Path, scratch: Path
) -> tuple[list[str], list[bytes], str | None]:
    """Returns (config_texts, stringtable_blobs, error). A single PBO can legitimately
    carry MANY config.bin/config.cpp entries at different internal paths -- not just one
    at the root: large structure/map packs commonly split CfgVehicles across one
    config.bin per subfolder (e.g. `structures_f\\config.bin`,
    `structures_agroprom\\config.bin`, ... alongside a root config.bin that carries only
    CfgPatches). ALL entries that pass the decoy filter are decoded and returned --
    picking only the first would silently drop classes that live in a differently-scoped
    nested config while the root looks superficially valid.

    config_texts is [] with error None when the PBO legitimately carries no config entry
    at all (e.g. an asset/texture-only sub-pbo, or the vanilla languagecore.pbo which
    exists in the source list purely for its stringtable) -- not a failure. config_texts
    is [] with a non-None error when candidate entries exist but every single one failed
    to decode/convert or looked like an obfuscation decoy. stringtable_blobs are returned
    REGARDLESS of config errors -- a mod whose config entries are all obfuscation decoys
    can still carry a perfectly ordinary stringtable.
    """
    try:
        candidates, stringtables = find_pbo_payloads(pbo_path)
    except Exception as exc:  # malformed/decoy header -- report, don't crash the run
        return [], [], f"header parse failed: {exc}"
    if not candidates:
        return [], stringtables, None
    texts: list[str] = []
    last_error = "no candidate produced config-like text"
    for name, raw in candidates:
        try:
            text = to_text(raw, cfgconvert, scratch)
        except Exception as exc:
            last_error = f"{name}: {exc}"
            continue
        if text is not None and looks_like_config_text(text):
            texts.append(text)
        elif text is not None:
            last_error = f"{name}: decoded but does not look like a config (decoy?)"
    if texts:
        return texts, stringtables, None
    return [], stringtables, last_error


# =========================================================================================
# Section 2: brace-aware class parser (NOT regex over the whole file -- nesting matters)
# =========================================================================================


def _skip_ws_comments(s: str, i: int, n: int) -> int:
    while i < n:
        c = s[i]
        if c in " \t\r\n":
            i += 1
        elif c == "/" and i + 1 < n and s[i + 1] == "/":
            j = s.find("\n", i)
            i = n if j < 0 else j + 1
        elif c == "/" and i + 1 < n and s[i + 1] == "*":
            j = s.find("*/", i + 2)
            i = n if j < 0 else j + 2
        else:
            break
    return i


def _read_ident(s: str, i: int, n: int) -> tuple[str, int]:
    start = i
    while i < n and (s[i].isalnum() or s[i] == "_"):
        i += 1
    return s[start:i], i


def _skip_string(s: str, i: int, n: int) -> int:
    # s[i] == '"'; BI config strings escape an embedded quote by doubling it ("").
    i += 1
    while i < n:
        if s[i] == '"':
            if i + 1 < n and s[i + 1] == '"':
                i += 2
                continue
            return i + 1
        i += 1
    return i


def _find_matching_brace(s: str, i: int, n: int) -> int:
    # s[i] == '{'; returns the index of the matching '}'.
    depth = 0
    while i < n:
        c = s[i]
        if c == '"':
            i = _skip_string(s, i, n)
            continue
        if c == "/" and i + 1 < n and s[i + 1] == "/":
            j = s.find("\n", i)
            i = n if j < 0 else j + 1
            continue
        if c == "/" and i + 1 < n and s[i + 1] == "*":
            j = s.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        if c == "{":
            depth += 1
            i += 1
            continue
        if c == "}":
            depth -= 1
            i += 1
            if depth == 0:
                return i - 1
            continue
        i += 1
    return n


def _skip_statement(s: str, i: int, n: int) -> int:
    # Skips a non-class statement (array/scalar assignment, `delete X;`, ...) up to and
    # including its terminating top-level ';' -- respects strings, comments, and any
    # nested {...} the statement's own value may contain (e.g. `foo[]={1,2,3};`).
    depth = 0
    while i < n:
        c = s[i]
        if c == '"':
            i = _skip_string(s, i, n)
            continue
        if c == "/" and i + 1 < n and s[i + 1] == "/":
            j = s.find("\n", i)
            i = n if j < 0 else j + 1
            continue
        if c == "/" and i + 1 < n and s[i + 1] == "*":
            j = s.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        if c == "{":
            depth += 1
            i += 1
            continue
        if c == "}":
            depth -= 1
            i += 1
            continue
        if c == ";" and depth == 0:
            return i + 1
        i += 1
    return n


def _skip_preprocessor_line(s: str, i: int, n: int) -> int:
    # A '#'-led top-level line (#ifdef/#ifndef/#else/#endif/#include/#define/...) is scoped
    # to the PHYSICAL LINE, not to the next ';' -- unlike every other top-level statement.
    # CRITICAL 2 (fix-round 1): dispatching an orphan directive line through
    # _skip_statement made its depth/';' scan run straight through the semicolon of the
    # NEXT class body (`{};` closes depth back to 0, and the very next top-level ';'
    # belongs to a class the directive has nothing to do with) and swallow that class
    # whole -- reproduced with `#ifdef X\nclass A{};\nclass B{};\n#endif\nclass C{};` losing
    # A and C (only B parsed, because it followed a line that started with 'class' and
    # never went through this path). Line continuation ('\' at end of line) is NOT handled
    # -- not observed anywhere in the scanned corpus, out of scope for this fix.
    j = s.find("\n", i)
    return n if j < 0 else j + 1


def _read_config_string(s: str, i: int, n: int) -> tuple[str, int]:
    """s[i] == '"'. Returns (value, index_after_closing_quote). BI config strings escape
    an embedded quote by DOUBLING it -- unescaped here (mirror of _skip_string, which
    only needs to find the end)."""
    i += 1
    parts: list[str] = []
    while i < n:
        if s[i] == '"':
            if i + 1 < n and s[i + 1] == '"':
                parts.append('"')
                i += 2
                continue
            return "".join(parts), i + 1
        parts.append(s[i])
        i += 1
    return "".join(parts), n


def extract_display_name(s: str, start: int, end: int) -> str | None:
    """Index v2: the raw displayName= value from the DIRECT statements of a class body
    span (nested subclasses are skipped whole -- a door's/zone's displayName must not
    leak up to the item class). A duplicate property within ONE body keeps the FIRST
    value -- verified empirically against the engine toolchain (T7 review, fix round 1):
    CfgConvert warns 'Member already defined' on the duplicate and the binarized
    roundtrip carries the FIRST value, so first-wins is the real engine semantics (the
    original 'later wins' claim here was wrong). Returns None when the body carries no
    displayName of its own. `displayNameShort`/`displayName[]` do not match -- the ident
    must be exactly `displayname` (case-insensitive, engine property lookup is
    case-insensitive) followed by '=' and a string literal."""
    i = start
    n = end
    while i < n:
        i = _skip_ws_comments(s, i, n)
        if i >= n:
            break
        if s[i : i + 5] == "class" and (i + 5 >= n or not (s[i + 5].isalnum() or s[i + 5] == "_")):
            # Skip the nested class declaration entirely (same walk as parse_children).
            i += 5
            i = _skip_ws_comments(s, i, n)
            _name, i = _read_ident(s, i, n)
            i = _skip_ws_comments(s, i, n)
            if i < n and s[i] == ":":
                i += 1
                i = _skip_ws_comments(s, i, n)
                _base, i = _read_ident(s, i, n)
                i = _skip_ws_comments(s, i, n)
            if i < n and s[i] == "{":
                close = _find_matching_brace(s, i, n)
                i = close + 1
                i = _skip_ws_comments(s, i, n)
                if i < n and s[i] == ";":
                    i += 1
            elif i < n and s[i] == ";":
                i += 1
            else:
                i = _skip_statement(s, i, n)
            continue
        if s[i] == "#":
            i = _skip_preprocessor_line(s, i, n)
            continue
        ident, j = _read_ident(s, i, n)
        if ident.lower() == "displayname":
            j = _skip_ws_comments(s, j, n)
            if j < n and s[j] == "=":
                j = _skip_ws_comments(s, j + 1, n)
                if j < n and s[j] == '"':
                    value, j = _read_config_string(s, j, n)
                    # First occurrence wins (CfgConvert evidence above) -- nothing later
                    # in the body can change the answer, so return immediately.
                    return value
        i = _skip_statement(s, i, n)
    return None


def parse_stringtable_csv(raw: bytes) -> list[tuple[str, str, str]]:
    """stringtable.csv -> [(key, original, english)] rows. Canonical DayZ format
    (verified against @Trader's reference table and our own): header row
    `"Language","original","english",...` with a TRAILING comma on every line (extra
    empty column -- harmless), CRLF, key in column 0. Column indices are located by
    case-insensitive header-cell name, so column order/extra languages don't matter.
    A blob whose header carries neither 'original' nor 'english' (obfuscation decoy,
    binary garbage, exotic format) contributes nothing rather than failing the PBO.
    Values may legitimately contain commas, doubled quotes and embedded newlines --
    csv.reader handles all three; a hand-rolled line splitter would not."""
    text = raw.decode("utf-8-sig", errors="replace")
    try:
        rows = list(csv.reader(io.StringIO(text)))
    except csv.Error:
        return []
    if not rows:
        return []
    header = [c.strip().lower() for c in rows[0]]
    orig_i = header.index("original") if "original" in header else -1
    eng_i = header.index("english") if "english" in header else -1
    if orig_i < 0 and eng_i < 0:
        return []
    out: list[tuple[str, str, str]] = []
    for row in rows[1:]:
        if not row:
            continue
        key = row[0].strip()
        if not key:
            continue
        original = row[orig_i].strip() if 0 <= orig_i < len(row) else ""
        english = row[eng_i].strip() if 0 <= eng_i < len(row) else ""
        out.append((key, original, english))
    return out


def resolve_display(display_raw: str | None, strings: dict[str, tuple[str, str]]) -> str:
    """Raw displayName value -> final display string for the index. `$`-prefixed values
    are stringtable references (engine convention `$STR_key` -> key `STR_key`); lookup is
    case-insensitive (real corpus: our own table keys are lowercase `str_zp_*` while the
    config references `$STR_zp_*`). Column priority per the owner's directive: original
    (the project's Ukrainian fallback column) -> english -> the raw literal kept as-is
    (including '$' -- an honest "unresolved" marker, exactly what the game shows for a
    missing key). Plain literals pass through unchanged; no displayName -> ''."""
    if not display_raw:
        return ""
    if display_raw.startswith("$"):
        hit = strings.get(display_raw[1:].lower())
        if hit:
            original, english = hit
            if original:
                return original
            if english:
                return english
        return display_raw
    return display_raw


def parse_children(s: str, start: int, end: int) -> Iterator[tuple[str, str | None, int | None, int | None]]:
    """Yields (name, base_or_None, body_start, body_end) for every direct-child `class`
    statement within s[start:end]. body_start/body_end are None for a bare forward
    declaration (`class X;` / `class X: Y;`, no braces)."""
    i = start
    n = end
    while i < n:
        i = _skip_ws_comments(s, i, n)
        if i >= n:
            break
        if s[i : i + 5] == "class" and (i + 5 >= n or not (s[i + 5].isalnum() or s[i + 5] == "_")):
            i += 5
            i = _skip_ws_comments(s, i, n)
            name, i = _read_ident(s, i, n)
            i = _skip_ws_comments(s, i, n)
            base: str | None = None
            if i < n and s[i] == ":":
                i += 1
                i = _skip_ws_comments(s, i, n)
                base, i = _read_ident(s, i, n)
                i = _skip_ws_comments(s, i, n)
            if i < n and s[i] == "{":
                close = _find_matching_brace(s, i, n)
                body_start, body_end = i + 1, close
                if name:
                    yield name, base, body_start, body_end
                i = close + 1
                i = _skip_ws_comments(s, i, n)
                if i < n and s[i] == ";":
                    i += 1
            elif i < n and s[i] == ";":
                if name:
                    yield name, base, None, None
                i += 1
            else:
                # Malformed statement (should not happen on real configs) -- bail safely.
                i = _skip_statement(s, i, n)
        elif s[i] == "#":
            i = _skip_preprocessor_line(s, i, n)  # CRITICAL 2 fix -- see function docstring
        else:
            i = _skip_statement(s, i, n)


def parse_class_defs(text: str) -> Iterator[tuple[str, str, str | None, bool, str | None]]:
    """Yields (root_name, class_name, base_or_None, has_body, display_raw_or_None) for
    direct children of the five config roots found at the top level of `text` (ROOTS
    above). Root-name matching is case-insensitive (Task 4 fix-round-1, Important 3): the
    yielded root_name is always the CANONICAL spelling from ROOTS, regardless of what
    case the source text used, so "class CfgWeapons" and the verified-real
    "class cfgWeapons" land in the SAME root instead of silently becoming two different
    (and one entirely unindexed) roots. display_raw (index v2) is the class's OWN
    displayName= literal, unresolved -- $STR_ references are resolved later in finalize,
    once the whole corpus's stringtables are merged."""
    roots: dict[str, tuple[int, int]] = {}
    for name, _base, body_start, body_end in parse_children(text, 0, len(text)):
        canonical = _ROOT_CANONICAL_BY_LOWER.get(name.lower())
        if canonical is not None and body_start is not None:
            roots[canonical] = (body_start, body_end)  # last CfgX block in the file wins
    for root_name, (start, end) in roots.items():
        for name, base, body_start, body_end in parse_children(text, start, end):
            display = extract_display_name(text, body_start, body_end) if body_start is not None else None
            yield root_name, name, base, body_start is not None, display


# =========================================================================================
# Section 3: source enumeration (vanilla + workshop modpack + our own built mods)
# =========================================================================================


class Source:
    __slots__ = ("mod_label", "pbo_path")

    def __init__(self, mod_label: str, pbo_path: Path):
        self.mod_label = mod_label
        self.pbo_path = pbo_path


def iter_sources(
    dayz_root: Path, workshop_root: Path, own_mods: list[Path]
) -> tuple[list[Source], list[str]]:
    """Deterministic order: vanilla Addons (+ dta/bin.pbo) first, then Workshop mods
    alphabetically, then our own mods -- pbo files within each source sorted by name.
    Order only needs to be DETERMINISTIC for the later-wins merge (brief: no need to
    imitate the real in-game mod load order).

    Returns (sources, skipped_mod_notes) -- the second list documents Workshop mod
    folders whose Steam junction target does not currently exist on disk (content not
    downloaded), so they are legitimately absent from the scan rather than silently
    dropped.
    """
    sources: list[Source] = []
    skipped: list[str] = []

    vanilla_dir = dayz_root / "Addons"
    for p in sorted(vanilla_dir.glob("*.pbo"), key=lambda p: p.name.lower()):
        sources.append(Source("vanilla", p))
    bin_pbo = dayz_root / "dta" / "bin.pbo"
    if bin_pbo.exists():
        sources.append(Source("vanilla", bin_pbo))
    # Index v2: the vanilla stringtable lives in its own dta/languagecore.pbo (4.7MB CSV,
    # no config entries at all) -- without it every vanilla $STR_ displayName would stay
    # an unresolved raw key. Placed BEFORE the workshop mods so a mod redefining a vanilla
    # key wins the later-wins stringtable merge, same rule as class bodies.
    lang_pbo = dayz_root / "dta" / "languagecore.pbo"
    if lang_pbo.exists():
        sources.append(Source("vanilla", lang_pbo))

    if workshop_root.is_dir():
        mod_dirs = sorted(
            (d for d in workshop_root.iterdir() if d.name.startswith("@")),
            key=lambda p: p.name.lower(),
        )
        for mod_dir in mod_dirs:
            if not mod_dir.is_dir():
                # Steam Workshop junction whose target isn't present on this machine right
                # now (content not downloaded / removed from cache) -- can't be recovered
                # by any local extraction trick; count + report, don't fail the run.
                skipped.append(f"{mod_dir.name}: workshop content not present on disk (broken junction)")
                continue
            addons_dir = mod_dir / "addons"
            if not addons_dir.is_dir():
                continue  # legitimate: some mods carry no client addons/ (server-only, docs-only, ...)
            pbos = sorted(addons_dir.glob("*.pbo"), key=lambda p: p.name.lower())
            for p in pbos:
                sources.append(Source(mod_dir.name, p))

    for mod_dir in own_mods:
        addons_dir = mod_dir / "addons"
        if not addons_dir.is_dir():
            skipped.append(f"{mod_dir.name}: not built (no addons/ directory) -- skipped")
            continue
        for p in sorted(addons_dir.glob("*.pbo"), key=lambda p: p.name.lower()):
            sources.append(Source(mod_dir.name, p))

    return sources, skipped


# =========================================================================================
# Section 4: merge (later wins by name; forward declarations never overwrite a real body)
# =========================================================================================


class ClassEntry:
    # display_name here is the CLASS NAME in its winning original casing (what gets
    # printed into classes[][0]); display_raw (index v2) is the unresolved displayName=
    # literal from config bodies -- unfortunate historical naming collision, kept to
    # avoid renaming churn across the existing merge code.
    __slots__ = ("display_name", "base", "has_body", "mod", "display_raw")

    def __init__(self, display_name: str, base: str | None, has_body: bool, mod: str,
                 display_raw: str | None = None):
        self.display_name = display_name
        self.base = base
        self.has_body = has_body
        self.mod = mod
        self.display_raw = display_raw


def build_index(sources: list[Source], cfgconvert: Path, scratch: Path, verbose: bool = False):
    # Tables are keyed by name.lower() -- NOT the original-case name (fix-round 1, follow-up
    # to CRITICAL 1): Arma/DayZ config identifiers are case-insensitive (same premise as the
    # TS isKindOf/classRoot fix), so "Clothing" and "clothing" from two different PBOs are
    # the SAME engine class, not two. Case-sensitive dict keys were producing real duplicate
    # rows for such pairs (12 groups / 24 rows observed in the corpus, e.g. root 0
    # "Clothing"/"clothing", "Man"/"man", "HandSaw"/"Handsaw") -- confirmed while wiring up
    # the byName round-trip test on the TS side after the case-insensitivity fix landed
    # there. ClassEntry.display_name keeps the ORIGINAL casing of whichever occurrence won
    # the merge (later-wins, same rule as everything else) for what actually gets printed
    # into classes[]; the dict key itself is only ever used for merge/lookup.
    tables: list[dict[str, ClassEntry]] = [dict() for _ in ROOTS]
    # Index v2: merged stringtable, key.lower() -> (original, english). Later source wins
    # per KEY (row-level, both columns together) -- mirrors the later-wins class merge;
    # within one PBO, entry order (multiple stringtable.csv at different internal paths
    # are legal, our own PBO carries two identical ones).
    strings: dict[str, tuple[str, str]] = {}
    stats = {
        "pbo_total": len(sources),
        "pbo_ok": 0,
        "pbo_no_config": 0,
        "pbo_failed": 0,
        "duplicate_conflicts": 0,
        "stringtable_files": 0,
        "failed_details": [],  # (mod, pbo, reason)
    }
    for src in sources:
        texts, stringtable_blobs, error = pbo_payloads(src.pbo_path, cfgconvert, scratch)
        for blob in stringtable_blobs:
            rows = parse_stringtable_csv(blob)
            if rows:
                stats["stringtable_files"] += 1
            for key, original, english in rows:
                strings[key.lower()] = (original, english)
        if not texts:
            if error is None:
                stats["pbo_no_config"] += 1
            else:
                stats["pbo_failed"] += 1
                stats["failed_details"].append((src.mod_label, src.pbo_path.name, error))
                if verbose:
                    print(f"  [SKIP] {src.mod_label}/{src.pbo_path.name}: {error}", file=sys.stderr)
            continue
        stats["pbo_ok"] += 1
        defs: Iterable[tuple[str, str, str | None, bool, str | None]] = (
            d for text in texts for d in parse_class_defs(text)
        )
        for root_name, name, base, has_body, display_raw in defs:
            table = tables[ROOT_INDEX[root_name]]
            key = name.lower()
            existing = table.get(key)
            if existing is None:
                table[key] = ClassEntry(name, base, has_body, src.mod_label, display_raw)
                continue
            if has_body:
                if existing.has_body:
                    stats["duplicate_conflicts"] += 1  # real override across sources
                # Index v2, display property-merge: the ENGINE merges config properties
                # across redefinitions of the same class, so a mod override body without
                # its own displayName= keeps the earlier one in game (e.g. vanilla Apple
                # overridden by a sound mod) -- an all-or-nothing later-wins here would
                # blank exactly those names. Only a non-empty incoming display replaces.
                merged_display = display_raw if display_raw else existing.display_raw
                table[key] = ClassEntry(name, base, has_body, src.mod_label, merged_display)  # later wins
            # else: bare forward declaration never overwrites an existing entry (whether
            # that entry has a body or is itself only a forward declaration -- first
            # forward-decl's base guess is as good as any other, and a body elsewhere in
            # the corpus is strictly more informative than either).
    return tables, strings, stats


def finalize(tables: list[dict[str, ClassEntry]], strings: dict[str, tuple[str, str]]):
    """Assign final indices (root-major, insertion order within root -- Python dicts
    preserve insertion order), resolve baseIdx within the SAME root (case-insensitive
    lookup -- a child may reference its base in different casing than the base's own
    winning definition), build the mods[] table (sorted for determinism, referenced by
    index for compactness), and (index v2) resolve each class's raw displayName through
    the merged stringtable into the fifth row element ('' when the class has none)."""
    mods_seen: set[str] = set()
    for table in tables:
        for entry in table.values():
            mods_seen.add(entry.mod)
    mods = sorted(mods_seen, key=str.lower)
    mod_index = {m: i for i, m in enumerate(mods)}

    name_to_index: list[dict[str, int]] = [dict() for _ in ROOTS]  # lower-case key
    classes: list[list] = []
    for root_i, table in enumerate(tables):
        for key, entry in table.items():
            name_to_index[root_i][key] = len(classes)
            # baseIdx/modIdx filled below
            classes.append([entry.display_name, None, None, root_i, resolve_display(entry.display_raw, strings)])

    idx = 0
    for root_i, table in enumerate(tables):
        for entry in table.values():
            base_idx = -1
            if entry.base:
                base_idx = name_to_index[root_i].get(entry.base.lower(), -1)
            classes[idx][1] = base_idx
            classes[idx][2] = mod_index[entry.mod]
            idx += 1

    return mods, classes


# =========================================================================================
# Section 5: CLI
# =========================================================================================


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dayz-root", type=Path, default=DEFAULT_DAYZ_ROOT)
    ap.add_argument("--workshop-root", type=Path, default=None, help="default: <dayz-root>/!Workshop")
    ap.add_argument(
        "--own-mod",
        action="append",
        dest="own_mods",
        default=None,
        help="additional built-mod folder (containing addons/*.pbo) to scan; repeatable. "
        "Default: E:\\dayzmod\\@ZP_Research and @ZP_Research_VPP.",
    )
    ap.add_argument("--cfgconvert", type=Path, default=DEFAULT_CFGCONVERT)
    ap.add_argument("--scratch", type=Path, required=True, help="scratch dir for CfgConvert temp files")
    ap.add_argument("--out", type=Path, required=True, help="output classindex.json path")
    ap.add_argument("--summary", action="store_true", help="print counts per root/mods/duplicates")
    ap.add_argument("--verbose", action="store_true", help="print each skipped/failed PBO as it happens")
    args = ap.parse_args()

    workshop_root = args.workshop_root or (args.dayz_root / DEFAULT_WORKSHOP_DIRNAME)
    own_mods = [Path(p) for p in args.own_mods] if args.own_mods else list(DEFAULT_OWN_MODS)
    args.scratch.mkdir(parents=True, exist_ok=True)

    t0 = time.time()
    sources, skipped_mods = iter_sources(args.dayz_root, workshop_root, own_mods)
    tables, strings, stats = build_index(sources, args.cfgconvert, args.scratch, verbose=args.verbose)
    mods, classes = finalize(tables, strings)
    elapsed = time.time() - t0

    out_obj = {
        "v": 2,  # v2: fifth row element = resolved in-game display name ('' when absent)
        "generated": time.strftime("%Y-%m-%d"),
        "mods": mods,
        "classes": classes,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(out_obj, f, ensure_ascii=False, separators=(",", ":"))

    if args.summary:
        per_root = [sum(1 for c in classes if c[3] == i) for i in range(len(ROOTS))]
        print(f"elapsed: {elapsed:.1f}s")
        print(f"pbo sources: total={stats['pbo_total']} ok={stats['pbo_ok']} "
              f"no_config={stats['pbo_no_config']} failed={stats['pbo_failed']}")
        print(f"classes total: {len(classes)}")
        for name, n in zip(ROOTS, per_root):
            print(f"  {name}: {n}")
        print(f"mods indexed: {len(mods)}")
        print(f"duplicate conflicts (body overwrote body): {stats['duplicate_conflicts']}")
        with_display = sum(1 for c in classes if c[4])
        unresolved = sum(1 for c in classes if c[4].startswith("$"))
        print(f"stringtable files parsed: {stats['stringtable_files']}; merged keys: {len(strings)}")
        print(f"classes with display name: {with_display} (unresolved $STR_ kept raw: {unresolved})")
        if skipped_mods:
            print(f"skipped workshop/own-mod sources ({len(skipped_mods)}):")
            for line in skipped_mods:
                print(f"  - {line}")
        if stats["failed_details"]:
            print(f"failed pbo extractions ({len(stats['failed_details'])}):")
            for mod, pbo, reason in stats["failed_details"]:
                print(f"  - {mod}/{pbo}: {reason}")
        out_size = args.out.stat().st_size
        print(f"output: {args.out} ({out_size} bytes)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
