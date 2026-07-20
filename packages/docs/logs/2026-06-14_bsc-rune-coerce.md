---
id: log-2026-06-14-bsc-rune-coerce
type: log
status: complete
board: false
---

# better-skill-capped runtime parse failure — rune field coercion

## Symptom

User reported `better-skill-capped.com` was broken in the browser. The static
site (HTML/JS) and `/data/manifest.json` both returned 200, but the SPA failed
to render because the strict Zod schema in `src/parser/manifest.ts` rejected
the live manifest at parse time.

## Root cause

`commentaries[3108].rune3` in the 2026-06-14 manifest was the number `3008`
(a champion item/rune ID) while the schema declared `rune1/2/3` as
`z.string()` under `.strict()`. Single bad row → entire `ManifestSchema.parse`
throws → `ManifestLoader.load()` rejects → app crashes before rendering. Only
one row in 3141 commentaries had this shape, so the bug was latent until that
data hit prod.

## Fix

Upstream Skill Capped is the source of truth — we're at their mercy for what
shape data arrives in and can't expect them to fix a bad row. So the schema
has to accept what they send, and we normalize on our side so consumers see a
single type.

`packages/better-skill-capped/src/parser/manifest.ts:49-51` — change each
`rune{1,2,3}: z.string()` to
`z.union([z.string(), z.number()]).transform(String)`. Numeric rune IDs are
coerced to their string form; existing empty strings still pass through.
Mirrors the `k/d/a` coercion already in the schema for the same reason.

Regression test in `manifest.test.ts` ("normalizes numeric rune field to
string") mutates a fixture commentary's `rune3` to the number `3008` and
asserts the parsed value is `"3008"`.

## Verification

- Downloaded the live `/data/manifest.json` (~2 MB, 3141 commentaries) and
  parsed it with the updated schema: `PARSE OK`, commentary 3108
  `rune3 = "3008"` (normalized to string).
- `bun test src/parser/manifest.test.ts` → 17 pass / 0 fail.
- `bun run typecheck` clean.
- `bunx eslint src/parser/manifest.ts` clean.
- `bun run build` → site bundles successfully.

## Session Log — 2026-06-14

### Done

- `packages/better-skill-capped/src/parser/manifest.ts` — accept numeric
  rune values, normalize to string.
- `packages/better-skill-capped/src/parser/manifest.test.ts` — regression
  test for numeric rune.

### Remaining

- Open PR + merge so the next CI build of `better-skill-capped` deploys the
  fix to S3.

### Caveats

- The Firestore→S3 manifest refresh runs daily at 05:00 PT
  (`fetcher-skill-capped` Temporal schedule). We're at upstream Skill
  Capped's mercy for the manifest shape — they may or may not ever fix the
  bad row, so the defensive schema stays regardless.
