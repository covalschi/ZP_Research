# Command-line tools

Node scripts that operate on a real `ZP_Research` config folder. They are **not** part of
the unit test suite (`npm test`) — run them explicitly with `npx tsx`.

## `writeback.ts` — canonicalise configs in place

Parses every config in a profile folder and writes it back in the engine's exact byte
format (UTF-8 without BOM, LF, 4-space indent, no trailing newline, `1`/`0` for booleans,
all schema fields present in declaration order). Idempotent: running it twice changes
nothing.

```bash
npx tsx tests/tools/writeback.ts --dry  "D:\path\to\profile\ZP_Research"   # report only
npx tsx tests/tools/writeback.ts        "D:\path\to\profile\ZP_Research"   # write
```

Useful after hand-editing a config, or to check that a folder is already canonical
(`--dry` printing zero changes is a clean bill of health).

## `rule-audit.ts` — validate every processing rule

Loads a profile and runs each rule through the editor's mirror of the server's own
`ValidateRule`, printing per-rule verdicts and a total.

```bash
npx tsx tests/tools/rule-audit.ts "D:\path\to\profile\ZP_Research"
```

A rule reported as `alarm` is one the server will silently drop at load time — the station
will simply never start. `warn` marks something suspicious that the server still accepts.

## `nodeBackend.ts`

Shared helper: a `StorageBackend` implementation over the local filesystem, used by both
tools above. Not runnable on its own.
