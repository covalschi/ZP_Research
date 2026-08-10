#!/usr/bin/env python3
"""Regression tests for scripts/gen-classindex.py (fix-round 1).

No prior Python test harness existed for this script (verification was via --summary +
parity + spot-checks against the live-generated classindex.json, per the original task
brief). This file exists specifically to pin the two bugs found in code review so they
cannot silently regress:

  - CRITICAL 2: the brace parser dropping classes around orphan top-level preprocessor
    lines (#ifdef/#endif/#include/...) -- see test_critical2_preprocessor_directives_*.
  - The follow-up case-insensitive-merge fix in build_index/finalize (found while wiring
    up the TS-side byName round-trip test after the CRITICAL 1 case-insensitivity fix
    landed: two PBOs defining "Clothing"/"clothing" produced two rows instead of one,
    because the merge tables were keyed by the exact-case string) -- see
    test_case_insensitive_merge_dedupes_across_sources.

Uses only the standard library (unittest) -- no new dependency, matches the "no new
deps" constraint from the original task brief.

Usage:
    python scripts/test_gen_classindex.py
"""
from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location("gen_classindex", Path(__file__).resolve().parent / "gen-classindex.py")
assert _SPEC is not None and _SPEC.loader is not None
gci = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(gci)


class ParseChildrenTests(unittest.TestCase):
    def test_simple_class_with_base(self) -> None:
        text = "class A: Base {};"
        defs = list(gci.parse_children(text, 0, len(text)))
        self.assertEqual(len(defs), 1)
        name, base, body_start, body_end = defs[0]
        self.assertEqual((name, base), ("A", "Base"))
        self.assertIsNotNone(body_start)
        self.assertIsNotNone(body_end)
        self.assertEqual(text[body_start:body_end], "")  # empty body between { and }

    def test_forward_declaration_has_no_body(self) -> None:
        text = "class A;"
        defs = list(gci.parse_children(text, 0, len(text)))
        self.assertEqual([(n, b, bs is None) for n, b, bs, be in defs], [("A", None, True)])

    def test_nested_classes_not_yielded_as_direct_children(self) -> None:
        text = "class A: Base { class Inner {}; };"
        names = [d[0] for d in gci.parse_children(text, 0, len(text))]
        self.assertEqual(names, ["A"])  # Inner is nested, not a direct child of the span


class DisplayNameV2Tests(unittest.TestCase):
    """Index v2 (T7 Step 0): displayName= extraction from top-level class bodies +
    $STR_ resolution through stringtable.csv (original -> english -> raw literal)."""

    def test_extract_display_name_simple(self) -> None:
        body = ' scope=2; displayName="Apple"; descriptionShort="x"; '
        self.assertEqual(gci.extract_display_name(body, 0, len(body)), "Apple")

    def test_extract_display_name_str_key_kept_raw(self) -> None:
        body = ' displayName="$STR_cfg_apple"; '
        self.assertEqual(gci.extract_display_name(body, 0, len(body)), "$STR_cfg_apple")

    def test_extract_display_name_case_insensitive_property(self) -> None:
        body = ' displayname="Lower"; '
        self.assertEqual(gci.extract_display_name(body, 0, len(body)), "Lower")

    def test_extract_display_name_ignores_nested_class(self) -> None:
        # A nested subclass's displayName (e.g. a door/attachment/DamageSystem zone) must
        # NOT leak up as the display name of the outer item class.
        body = ' class Inner { displayName="WRONG"; }; scope=2; '
        self.assertIsNone(gci.extract_display_name(body, 0, len(body)))

    def test_extract_display_name_own_after_nested(self) -> None:
        body = ' class Inner { displayName="WRONG"; }; displayName="RIGHT"; '
        self.assertEqual(gci.extract_display_name(body, 0, len(body)), "RIGHT")

    def test_extract_display_name_first_occurrence_wins(self) -> None:
        # Engine semantics (T7 review, fix round 1, verified empirically): a duplicate
        # property within ONE body keeps the FIRST value -- CfgConvert warns 'Member
        # already defined' and the binarized roundtrip carries "First", not "Second".
        body = ' displayName="First"; displayName="Second"; '
        self.assertEqual(gci.extract_display_name(body, 0, len(body)), "First")

    def test_extract_display_name_doubled_quote_unescape(self) -> None:
        body = ' displayName="Say ""hi"" now"; '
        self.assertEqual(gci.extract_display_name(body, 0, len(body)), 'Say "hi" now')

    def test_extract_display_name_not_fooled_by_displaynames_array_or_prefix(self) -> None:
        body = ' displayNameShort="No"; displayName[]={"No"}; '
        self.assertIsNone(gci.extract_display_name(body, 0, len(body)))

    def test_parse_class_defs_yields_display_raw(self) -> None:
        text = 'class CfgVehicles { class Apple: Edible_Base { displayName="$STR_apple"; }; class Bare; };'
        defs = list(gci.parse_class_defs(text))
        self.assertIn(("CfgVehicles", "Apple", "Edible_Base", True, "$STR_apple"), defs)
        self.assertIn(("CfgVehicles", "Bare", None, False, None), defs)


class StringtableCsvTests(unittest.TestCase):
    CSV = (
        '"Language","original","english","czech",\r\n'
        '"str_zp_petridishkit","Польовий набір","Field kit","CZ",\r\n'
        '"STR_only_english","","English only",\r\n'
        '"str_empty_both","","",\r\n'
        '"str_multiline","A, ""B""\r\nC","x",\r\n'
    )

    def test_parse_stringtable_rows(self) -> None:
        rows = gci.parse_stringtable_csv(self.CSV.encode("utf-8"))
        by_key = {k: (o, e) for k, o, e in rows}
        self.assertEqual(by_key["str_zp_petridishkit"], ("Польовий набір", "Field kit"))
        self.assertEqual(by_key["STR_only_english"], ("", "English only"))
        # csv module semantics: a quoted field may span lines and carry doubled quotes
        self.assertEqual(by_key["str_multiline"][0], 'A, "B"\r\nC')

    def test_parse_stringtable_utf8_bom_tolerated(self) -> None:
        rows = gci.parse_stringtable_csv(("﻿" + self.CSV).encode("utf-8"))
        self.assertTrue(any(k == "str_zp_petridishkit" for k, _o, _e in rows))

    def test_parse_stringtable_unrecognized_header_contributes_nothing(self) -> None:
        rows = gci.parse_stringtable_csv(b"garbage\x00binary\x01stuff")
        self.assertEqual(rows, [])

    def test_resolve_display_priority_original_english_raw(self) -> None:
        strings = {
            "str_a": ("Оригінал", "English A"),
            "str_b": ("", "English B"),
            "str_c": ("", ""),
        }
        self.assertEqual(gci.resolve_display("$STR_a", strings), "Оригінал")
        self.assertEqual(gci.resolve_display("$STR_b", strings), "English B")
        self.assertEqual(gci.resolve_display("$STR_c", strings), "$STR_c")  # both empty -> raw
        self.assertEqual(gci.resolve_display("$STR_missing", strings), "$STR_missing")
        self.assertEqual(gci.resolve_display("Plain name", strings), "Plain name")
        self.assertEqual(gci.resolve_display(None, strings), "")
        self.assertEqual(gci.resolve_display("", strings), "")

    def test_resolve_display_key_lookup_is_case_insensitive(self) -> None:
        # Real corpus: our own stringtable keys are lowercase "str_zp_*" while config.cpp
        # references "$STR_zp_*" -- resolution must not depend on case.
        strings = {"str_zp_x": ("Укр", "En")}
        self.assertEqual(gci.resolve_display("$str_ZP_X", strings), "Укр")


class DisplayMergeTests(unittest.TestCase):
    """Property-level merge for display across later-wins class redefinitions: the engine
    MERGES config properties, so a mod override body without displayName= keeps the
    earlier displayName in game -- the index must mirror that, or e.g. vanilla Apple
    (overridden by a sound mod) would lose its display name."""

    def _run(self, texts_by_pbo):
        sources = [gci.Source(m, Path(p)) for m, p in [("modA", "modA.pbo"), ("modB", "modB.pbo")]]

        def fake_payloads(pbo_path, cfgconvert, scratch):
            return texts_by_pbo.get(pbo_path.name, []), [], None

        original = gci.pbo_payloads
        gci.pbo_payloads = fake_payloads
        try:
            tables, strings, stats = gci.build_index(sources, gci.DEFAULT_CFGCONVERT, Path("."))
        finally:
            gci.pbo_payloads = original
        return gci.finalize(tables, strings)

    def test_override_without_displayname_keeps_earlier_display(self) -> None:
        mods, classes = self._run({
            "modA.pbo": ['class CfgVehicles { class Apple: Edible_Base { displayName="Яблуко"; }; };'],
            "modB.pbo": ['class CfgVehicles { class Apple: Edible_Base { attenuation="x"; }; };'],
        })
        row = next(r for r in classes if r[0] == "Apple")
        self.assertEqual(row[4], "Яблуко")
        self.assertEqual(mods[row[2]], "modB")  # winner mod is still the later body

    def test_override_with_displayname_wins(self) -> None:
        _mods, classes = self._run({
            "modA.pbo": ['class CfgVehicles { class Apple { displayName="Old"; }; };'],
            "modB.pbo": ['class CfgVehicles { class Apple { displayName="New"; }; };'],
        })
        row = next(r for r in classes if r[0] == "Apple")
        self.assertEqual(row[4], "New")

    def test_forward_declaration_never_clears_display(self) -> None:
        _mods, classes = self._run({
            "modA.pbo": ['class CfgVehicles { class Apple { displayName="Old"; }; };'],
            "modB.pbo": ["class CfgVehicles { class Apple; };"],
        })
        row = next(r for r in classes if r[0] == "Apple")
        self.assertEqual(row[4], "Old")

    def test_stringtable_later_source_wins_per_key(self) -> None:
        sources = [gci.Source(m, Path(p)) for m, p in [("modA", "modA.pbo"), ("modB", "modB.pbo")]]
        payloads = {
            "modA.pbo": ([], ['"Language","original","english",\r\n"str_x","A-orig","A-en",\r\n'.encode("utf-8")], None),
            "modB.pbo": ([
                'class CfgVehicles { class Thing { displayName="$STR_x"; }; };',
            ], ['"Language","original","english",\r\n"STR_X","B-orig","B-en",\r\n'.encode("utf-8")], None),
        }

        def fake_payloads(pbo_path, cfgconvert, scratch):
            return payloads[pbo_path.name]

        original = gci.pbo_payloads
        gci.pbo_payloads = fake_payloads
        try:
            tables, strings, stats = gci.build_index(sources, gci.DEFAULT_CFGCONVERT, Path("."))
        finally:
            gci.pbo_payloads = original
        _mods, classes = gci.finalize(tables, strings)
        row = next(r for r in classes if r[0] == "Thing")
        self.assertEqual(row[4], "B-orig")


class FiveConfigRootsTests(unittest.TestCase):
    """Task 4 fix-round-1 (Important 3): the mirror used to cover only three of the five
    config roots that the server's ZP_ProcessingRules.ClassExists (ZP_ProcessingConfig.c:
    175-188) checks -- CfgAmmo and cfgWeapons were entirely invisible, so weapon/ammo rule
    inputs (server-valid) showed up as false 'unknown class' breaks in the editor."""

    def test_all_five_roots_recognized(self) -> None:
        self.assertEqual(
            gci.ROOTS,
            ("CfgVehicles", "CfgMagazines", "CfgNonAIVehicles", "CfgAmmo", "cfgWeapons"),
        )
        self.assertEqual(gci.ROOT_INDEX["CfgAmmo"], 3)
        self.assertEqual(gci.ROOT_INDEX["cfgWeapons"], 4)

    def test_cfgammo_root_parsed_at_index_3(self) -> None:
        text = "class CfgAmmo { class Bullet_Base {}; class Bullet_762x39: Bullet_Base {}; };"
        defs = list(gci.parse_class_defs(text))
        self.assertIn(("CfgAmmo", "Bullet_762x39", "Bullet_Base", True, None), defs)

    def test_cfgweapons_root_parsed_at_index_4_lowercase_c_as_in_real_vanilla_configs(self) -> None:
        # Verified against a real decompiled vanilla config (weapons_firearms.pbo ->
        # AKM/config.bin via CfgConvert.exe -txt) during the fix -- Bohemia's own root here
        # genuinely IS "cfgWeapons", not a typo, and it matches the mod's ClassExists
        # literal exactly.
        text = "class cfgWeapons { class Rifle_Base {}; class AKM_Base: Rifle_Base {}; class AKM: AKM_Base {}; };"
        defs = list(gci.parse_class_defs(text))
        self.assertIn(("cfgWeapons", "AKM", "AKM_Base", True, None), defs)

    def test_root_name_matching_is_case_insensitive(self) -> None:
        # A third-party mod could plausibly spell it "CfgWeapons" (matching the other Cfg*
        # roots' convention) even though vanilla itself uses lowercase-c -- both must land
        # in the SAME canonical root, not split into two.
        text = "class CfgWeapons { class Foo {}; };"
        defs = list(gci.parse_class_defs(text))
        self.assertEqual([d[0] for d in defs], ["cfgWeapons"])  # canonical spelling, not the source's casing

    def test_cfgammo_and_cfgweapons_do_not_collide_with_original_three_roots(self) -> None:
        text = (
            "class CfgVehicles { class V {}; };"
            "class CfgMagazines { class M {}; };"
            "class CfgNonAIVehicles { class N {}; };"
            "class CfgAmmo { class Am {}; };"
            "class cfgWeapons { class W {}; };"
        )
        by_root: dict[str, set[str]] = {}
        for root_name, name, _base, _has_body, _display in gci.parse_class_defs(text):
            by_root.setdefault(root_name, set()).add(name)
        self.assertEqual(
            by_root,
            {
                "CfgVehicles": {"V"},
                "CfgMagazines": {"M"},
                "CfgNonAIVehicles": {"N"},
                "CfgAmmo": {"Am"},
                "cfgWeapons": {"W"},
            },
        )


class Critical2PreprocessorTests(unittest.TestCase):
    """CRITICAL 2 (fix-round 1 review): orphan top-level '#'-led lines used to be
    dispatched through _skip_statement, which scans to the next depth-0 ';' -- an
    #ifdef/#include line has none of its own, so the scan ran straight through the
    semicolon of the FOLLOWING class body and swallowed it whole."""

    REPRO = """#ifdef SOMETHING
class A: Base {};
class B: Base {};
#endif
class C: Base {};
#include "weapon_variant.hpp"
class D: Base {};
class E: Base {};
"""

    def test_reproduction_verbatim_all_five_classes_found(self) -> None:
        # Verbatim reproduction from the code review report -- wrapped in a CfgVehicles
        # root so parse_class_defs (the actual per-PBO entry point) sees it, not just the
        # lower-level parse_children.
        text = "class CfgVehicles {\n" + self.REPRO + "};"
        found = {name for _root, name, _base, _has_body, _display in gci.parse_class_defs(text)}
        self.assertEqual(found, {"A", "B", "C", "D", "E"})

    def test_all_five_have_correct_base_and_body(self) -> None:
        text = "class CfgVehicles {\n" + self.REPRO + "};"
        by_name = {name: (base, has_body) for _root, name, base, has_body, _display in gci.parse_class_defs(text)}
        for name in "ABCDE":
            self.assertEqual(by_name[name], ("Base", True), f"class {name}")

    def test_orphan_ifdef_alone_does_not_break_subsequent_siblings(self) -> None:
        # Minimal isolation of the bug without #endif/#include noise.
        text = "class CfgVehicles { #ifdef X\nclass A: Base {}; class B: Base {}; };"
        found = {name for _root, name, _base, _has_body, _display in gci.parse_class_defs(text)}
        self.assertEqual(found, {"A", "B"})

    def test_define_line_does_not_swallow_next_class(self) -> None:
        text = 'class CfgVehicles { #define FOO 1\nclass A: Base {}; };'
        found = {name for _root, name, _base, _has_body, _display in gci.parse_class_defs(text)}
        self.assertEqual(found, {"A"})


class CaseInsensitiveMergeTests(unittest.TestCase):
    """Follow-up to CRITICAL 1: Arma/DayZ config identifiers are case-insensitive (same
    premise as the TS isKindOf fix), so two sources defining "Clothing" and "clothing"
    are the SAME engine class and must merge into ONE row, not two."""

    def test_case_variants_of_same_name_merge_into_one_row(self) -> None:
        sources = [
            gci.Source("modA", Path("modA.pbo")),
            gci.Source("modB", Path("modB.pbo")),
        ]
        texts_by_pbo = {
            "modA.pbo": ["class CfgVehicles { class Clothing: Man {}; };"],
            "modB.pbo": ["class CfgVehicles { class clothing: Man {}; };"],
        }

        def fake_pbo_payloads(pbo_path, cfgconvert, scratch):
            return texts_by_pbo[pbo_path.name], [], None

        original = gci.pbo_payloads
        gci.pbo_payloads = fake_pbo_payloads
        try:
            tables, strings, stats = gci.build_index(sources, gci.DEFAULT_CFGCONVERT, Path("."))
        finally:
            gci.pbo_payloads = original

        mods, classes = gci.finalize(tables, strings)
        names_lower = [row[0].lower() for row in classes if row[0].lower() == "clothing"]
        self.assertEqual(len(names_lower), 1, f"expected exactly one merged row, got: {classes}")
        # later-wins: modB processed after modA -> display casing is modB's "clothing"
        winner = next(row for row in classes if row[0].lower() == "clothing")
        self.assertEqual(winner[0], "clothing")
        self.assertEqual(mods[winner[2]], "modB")

    def test_base_reference_resolves_case_insensitively(self) -> None:
        sources = [gci.Source("modA", Path("modA.pbo"))]
        texts = ["class CfgVehicles { class Man {}; class Coat: MAN {}; };"]

        def fake_pbo_payloads(pbo_path, cfgconvert, scratch):
            return texts, [], None

        original = gci.pbo_payloads
        gci.pbo_payloads = fake_pbo_payloads
        try:
            tables, strings, stats = gci.build_index(sources, gci.DEFAULT_CFGCONVERT, Path("."))
        finally:
            gci.pbo_payloads = original

        mods, classes = gci.finalize(tables, strings)
        by_name = {row[0]: row for row in classes}
        coat_base_idx = by_name["Coat"][1]
        self.assertGreaterEqual(coat_base_idx, 0, "Coat's base 'MAN' should resolve to 'Man' despite case mismatch")
        self.assertEqual(classes[coat_base_idx][0], "Man")


if __name__ == "__main__":
    unittest.main()
