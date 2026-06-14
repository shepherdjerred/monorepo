# better-skill-capped runtime parse failure — rune field coercion

## Status

Complete

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

`packages/better-skill-capped/src/parser/manifest.ts:49-51` — change each
`rune{1,2,3}: z.string()` to `z.union([z.string(), z.number()]).transform(String)`.
Same pattern already used for `k/d/a` (`z.coerce.number()`) when upstream data
is unreliable; numeric IDs normalize to their string form, existing empty-string
values still pass.

Added regression test in `manifest.test.ts` ("normalizes numeric rune field to
string") that mutates the fixture to set `rune3 = 3008` and asserts the parsed
result is `"3008"`.

## Verification

- Downloaded the live `/data/manifest.json` (~2 MB, 3141 commentaries) and
  parsed it with the updated schema: `PARSE OK`, commentary 3108 `rune3 =
"3008"`.
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
  (`fetcher-skill-capped` Temporal schedule). If upstream Skill Capped fixes
  the bad row, the schema fix is still correct — it just becomes a defence
  against future drift.
