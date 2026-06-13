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

## Follow-up — Wire discord-stream-lifecycle as a Dagger workspace dep (2026-06-13)

After catalog validation passed, the per-package Dagger lint/typecheck/test jobs
failed with:

```
error: Could not find package.json for "file:../discord-stream-lifecycle" dependency "@shepherdjerred/discord-stream-lifecycle"
error: @shepherdjerred/discord-stream-lifecycle@file:../../../discord-stream-lifecycle failed to resolve
✘ withExec bun install --frozen-lockfile  ERROR
```

### Root cause

The per-package Dagger functions mount only `packages/<pkg>` plus its declared
`WORKSPACE_DEPS` dirs (see `.dagger/src/base.ts` — deps mount at
`/workspace/packages/<depName>`). `discord-stream-lifecycle` was in
`ALL_PACKAGES` but NOT in the `WORKSPACE_DEPS` graph
(`.dagger/src/deps.ts`), so the consumers' containers never had it mounted and
`bun install --frozen-lockfile` couldn't resolve the `file:` path.

`scripts/ci/src/steps/per-package.ts` imports `WORKSPACE_DEPS` from
`.dagger/src/deps.ts` and emits `--dep-names`/`--dep-dirs` from it, so the single
edit to `deps.ts` fixes both the Dagger module and the BK generator.

### Consumers wired (in `.dagger/src/deps.ts`)

| Consumer                   | How it imports DSL                                       |
| -------------------------- | -------------------------------------------------------- |
| `streambot`                | `file:../discord-stream-lifecycle`                       |
| `discord-plays-pokemon`    | nested backend: `file:../../../discord-stream-lifecycle` |
| `discord-plays-mario-kart` | nested backend: `file:../../../discord-stream-lifecycle` |

The nested backends mount via the _parent_ package's `WORKSPACE_DEPS` entry — the
dep mounts at `/workspace/packages/discord-stream-lifecycle`, which is exactly
what `file:../../../discord-stream-lifecycle` resolves to from
`/workspace/packages/<parent>/packages/backend`. Identical pattern to the
existing `discord-video-stream` wiring. Also added DSL's own entry
(`"discord-stream-lifecycle": ["eslint-config"]`) for its standalone steps.

### Lockfile

No lockfile change needed — the committed lockfiles already include the dep
(`packages/streambot/bun.lock`, `packages/discord-plays-pokemon/bun.lock`,
`packages/discord-plays-mario-kart/bun.lock`, and
`packages/discord-stream-lifecycle/bun.lock`). Verified with
`bun install --frozen-lockfile` in each consumer dir (exit 0, dep symlinked into
the nested backends' `node_modules`).

### Verification

- `bun install --frozen-lockfile` passes in `discord-stream-lifecycle`,
  `streambot`, `discord-plays-pokemon`, `discord-plays-mario-kart`.
- `cd scripts/ci && bun run src/main.ts` → "Catalog validated: 33 packages…"
  and the generated lint/typecheck/test commands for all three consumers now
  include `--dep-names discord-stream-lifecycle --dep-dirs …packages/discord-stream-lifecycle`.
- `cd scripts/ci && bun test` → 237 pass, 0 fail.
- Commit `407cff638` pushed to `feature/stream-lifecycle-xstate`.
