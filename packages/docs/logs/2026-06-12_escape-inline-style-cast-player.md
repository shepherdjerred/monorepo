---
id: log-2026-06-12-escape-inline-style-cast-player
type: log
status: complete
board: false
---

# fix(toolkit): escape \</style in inlined cast player CSS

## Background

PR #1133 (feature/pr-media-assets) had two unresolved Greptile P2 review threads on
`packages/toolkit/src/lib/s3/cast-player.ts` line ~39. Both flagged the same issue:
the inlined asciinema-player JS was protected by `escapeInlineScript` (which replaces
`</script` with `<\/script`), but the inlined CSS in the `<style>` block had no
equivalent guard. A literal `</style` (case-insensitive) in the CSS bundle would
prematurely close the `<style>` element, breaking the page.

## Fix

Added `escapeInlineStyle(css: string): string` to
`packages/toolkit/src/lib/s3/cast-player.ts`:

- Uses `css.replaceAll(/<\/style/gi, ...)` — case-insensitive regex to cover `</style`, `</STYLE`, `</Style`, etc.
- Applied to `playerCss` at interpolation point: `<style>${escapeInlineStyle(playerCss)}</style>`
- ESLint auto-fixed `css.replace(...)` → `css.replaceAll(...)` during pre-commit hook.

Added 4 new tests in `packages/toolkit/test/s3/cast-player.test.ts`:

1. Asserts no raw `</style` appears inside the first (player CSS) style block in the rendered HTML.
2. Asserts the real `playerCss` bundle does not currently contain `</style` (canary for future bundle upgrades).
3. Asserts exactly 2 `</style>` occurrences in the full rendered HTML (both intentional closers).
4. Asserts the inlined CSS block in the head contains no raw `</style` sequences (case-insensitive).

## Session Log — 2026-06-12

### Done

- `packages/toolkit/src/lib/s3/cast-player.ts`: added `escapeInlineStyle` helper and applied it to `playerCss` interpolation
- `packages/toolkit/test/s3/cast-player.test.ts`: added 4 new tests (8 total, all pass)
- All pre-commit hooks passed (ESLint, prettier, typecheck, quality-ratchet)
- Commit `0cddf04b5` pushed to `feature/pr-media-assets`
- Replied to both Greptile threads (databaseIds 3406983705, 3406994852) and resolved both (PRRT_kwDOHf4r4c6JSC7z, PRRT_kwDOHf4r4c6JSExg)

### Remaining

- Buildkite CI running against the push; no known blockers.

### Caveats

- The current `asciinema-player` CSS bundle does not contain `</style`, so the guard is a safety net for future bundle versions. The canary test will catch any regression.
