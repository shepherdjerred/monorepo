# Fix: Register discord-stream-lifecycle in CI Catalog

## Status

Complete

## Context

PR #1146 (`feature/stream-lifecycle-xstate`) adds a new shared TS library package
`packages/discord-stream-lifecycle/` but the Buildkite `pipeline-generate-pipeline`
step was failing with:

```
Catalog validation failed: - packages/discord-stream-lifecycle/ exists but is not in ALL_PACKAGES. Add it to catalog.ts.
```

The `validateCatalog()` function in `scripts/ci/src/lib/validate-catalog.ts` uses
`git ls-files -- packages` to enumerate tracked packages and cross-checks each
against `ALL_PACKAGES` in `scripts/ci/src/catalog.ts`.

## What Was Found

A previous session had added `"discord-stream-lifecycle"` to `ALL_PACKAGES` in the
working tree but never committed the change. The committed HEAD on the branch was
still missing the entry.

## Fix

Staged and committed the one-line change in `scripts/ci/src/catalog.ts`:

```ts
// packages/discord-stream-lifecycle is a shared TS library (xstate-based),
// no Docker image, no static site, tests via `bun test test/`.
"discord-stream-lifecycle",
```

Entry placed in alphabetical order between `discord-plays-mario-kart` and
`discord-video-stream`. No image targets, no site targets, no SKIP_PACKAGES
entry — standard per-package lint/typecheck/test steps will be generated for it.

## Session Log — 2026-06-13

### Done

- Investigated worktree at `/Users/jerred/git/monorepo/.claude/worktrees/pr-1146`
- Confirmed `discord-stream-lifecycle` was present in working tree but not committed
- Ran `bun run src/main.ts` in `scripts/ci/` — catalog validation passes: "Catalog validated: 33 packages, 9 with images, 7 with sites"
- Committed: `fix(root): register discord-stream-lifecycle in CI catalog` — SHA `2bbae5b5f`
- Pushed to `feature/stream-lifecycle-xstate` — accepted, no conflicts

### Remaining

- None

### Caveats

- `bunx tsc --noEmit` in `scripts/ci/` fails with `TS2688: Cannot find type definition file for 'bun'` — pre-existing issue in main (deps not installed locally in that dir), unrelated to this PR
