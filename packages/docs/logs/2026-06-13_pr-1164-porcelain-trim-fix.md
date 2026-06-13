# PR #1164: Fix porcelain stdout trimming in readme-refresh

## Status

Complete

## Problem

Greptile P1 on PR #1164 (thread `PRRT_kwDOHf4r4c6JXD58`):

`runCommand` in `data-dragon-shell.ts` returns `stdout.trim()` by default. The
caller in `readme-refresh.ts` (line 88-90) used it without `{ trimStdout: false }`
to capture `git status --porcelain` output.

Porcelain v1 encodes the working-tree modification status in a leading space:
`" M README.md"` means "index unmodified, working tree modified". A whole-string
`.trim()` strips that leading space from the **first line only**, so
`parsePorcelainPaths`'s `slice(3)` would misalign on the first entry: the
path would start at index 2 instead of 3, giving `EADME.md` instead of
`README.md` and silently dropping / mangling the first changed file.

## Fix

Two files changed:

### `packages/temporal/src/activities/readme-refresh.ts`

- Added `trimStdout: false` to the `runCommand` call for `git status --porcelain`
- Updated the comment on `parsePorcelainPaths` to explain the whole-output `.trim()` hazard
- Exported `parsePorcelainPaths` so it can be unit-tested

### `packages/temporal/src/activities/readme-refresh.test.ts` (new)

- 5 tests covering `parsePorcelainPaths`:
  - Leading-space `" M"` code on both lines (the exact failure case)
  - Staged `"M "` code
  - Untracked `??` code
  - Mixed codes with leading-space first line
  - Empty / newline-only input

## Session Log — 2026-06-13

### Done

- Fixed `packages/temporal/src/activities/readme-refresh.ts`: `runCommand` call
  now passes `{ trimStdout: false }` for porcelain output; `parsePorcelainPaths`
  exported with updated comment
- Created `packages/temporal/src/activities/readme-refresh.test.ts` with 5 passing tests
- Typecheck: clean (`bun run --filter='./packages/temporal' typecheck`)
- ESLint: clean
- Prettier: fixed and verified
- All pre-commit hooks passed
- Pushed as commit `a1292b5dd` to `feature/temporal-readme-refresh`
- Resolved Greptile review thread `PRRT_kwDOHf4r4c6JXD58` (confirmed `isResolved: true`)

### Remaining

None.

### Caveats

- `data-dragon-shell.ts` already had the `trimStdout` option (`options.trimStdout === false ? stdout : stdout.trim()`); this fix just wires it correctly at the call site.
- The `parsePorcelainPaths` function itself was already correct (`slice(3)` without trimming individual lines); the bug was solely the whole-string trim before it was called.
