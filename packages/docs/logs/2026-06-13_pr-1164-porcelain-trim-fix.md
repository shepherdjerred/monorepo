---
id: log-2026-06-13-pr-1164-porcelain-trim-fix
type: log
status: complete
board: false
---

# PR #1164: Fix porcelain stdout trimming in readme-refresh

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

## Follow-up — 2026-06-13: temporal-worker image cog version check

The `docker-build-temporal-worker` job then failed (exit 2) on
`withExec cog --version` → `option --version not recognized`. cogapp's `cog`
CLI has no `--version` flag.

### Done

- Fixed `.dagger/src/image.ts` (`withCogapp`): replaced `cog --version` with
  `cog -v`, the canonical cogapp version flag (`cog -h` lists
  `-v  Print the version of cog and exit.`).
- Verified against a real cogapp 3.6.0 install (the pinned `COGAPP_VERSION`):
  `cog -v` prints `Cog version 3.6.0` and exits 0; `cog --version`,
  `python -m cogapp --version`, and `python -c "import cogapp; cogapp.__version__"`
  all fail (exit 2/2/1 respectively), so `-v` is the only correct check.
- `bun scripts/check-dagger-hygiene.ts` → "No violations found".

### Caveats

- Could not run a full `tsc --noEmit` on `.dagger/`: its tsconfig maps
  `@dagger.io/dagger` to a generated `./sdk/index.ts` that only exists after the
  Dagger engine runs codegen (absent in a plain checkout), so all 16
  `.dagger/src/*.ts` files report `TS2307`. The change is a literal string swap
  inside an existing `withExec(string[])` call (type-identical to the line it
  replaced), so it introduces no new type surface.
- `bun install` inside `.dagger/` regenerates a `bun.lock` (migrated from
  `package-lock.json`) and `node_modules`; both were removed so only
  `.dagger/src/image.ts` is staged.
