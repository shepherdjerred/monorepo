---
id: setup-ts-refresh-phase-no-retry
status: active
origin: packages/docs/logs/2026-07-08_worktree-setup-scoped-installs.md
source_marker: false
---

# `refreshBuiltFileDependencies` (Phase 4) has no retry, unlike Phase 2

## What

While testing `--group=pokemon` (both with and without `--link`), the
`discord-plays-pokemon backend llm-models refresh` step in
`refreshBuiltFileDependencies()` (`scripts/setup.ts` Phase 4) failed
intermittently — non-deterministically, roughly half the time across ~6
attempts on the same clean `node_modules` state:

```
node-av: ⚠️  No prebuilt binary and no system FFmpeg found
error: install script from "node-av" exited with 1
```

Confirmed this is **not** caused by `--group`/`--link` scoping:

- The identical failure reproduced on a full, unscoped `bun run scripts/setup.ts` run
- `@seydx/node-av-darwin-arm64` (the optional prebuilt-binary package `node-av`'s
  own `check.js` looks for via `require.resolve`) **is** present in
  `node_modules/@seydx/` when this fails — so the failure is in that resolution
  path, not a missing dependency
- Running the exact same `bun install --force` manually, directly in
  `packages/discord-plays-pokemon/packages/backend`, from an interactive shell
  with `ffmpeg` on `PATH` (`/opt/homebrew/bin/ffmpeg`) succeeds every time —
  only invocations through `scripts/setup.ts`'s `exec()` helper (which runs via
  Bun's `$` shell) hit the failure

Working theory: some difference in how Bun's `$` shell spawns/inherits the
environment for this specific postinstall vs an interactive shell — not
confirmed further, out of scope for the `--group`/`--link` work that surfaced it.

## Why it matters

Phase 2's `installOne` already has retry-with-backoff (3 attempts) specifically
because "concurrent installs occasionally contend on the shared bun cache" (see
the comment there, added by the 2026-06-13 setup-ts-cost-profiling session).
Phase 4's `refreshBuiltFileDependencies` loop has no equivalent — a single
`exec()` call per dir, no retry. Given the same class of flakiness shows up
here too, a scoped or full `setup.ts` run can fail non-deterministically on a
package it has nothing to do with (this repro was on `discord-plays-pokemon`,
unrelated to whatever the actual worktree's task is).

## Proposed fix (not implemented — deferred)

Extract Phase 2's retry-with-backoff into a shared helper and use it for both
`installOne` (Phase 2) and the `refreshDirs` loop (Phase 4), rather than
duplicating the pattern. Before implementing, it'd be worth actually
root-causing the Bun-`$`-shell-vs-interactive-shell environment difference
(check `$BUN_ENV`/`PATH` inside a `Bun.$` subprocess vs the parent shell) since
a retry only papers over a possibly-deterministic-per-context bug — if it's
100% reproducible under `$` and 100% reliable interactively, more attempts
under `$` won't help and the real fix is aligning the environments.

## Pointers

- `scripts/setup.ts`: `installOne` (Phase 2, has retry) vs
  `refreshBuiltFileDependencies` (Phase 4, doesn't)
- `packages/discord-plays-pokemon/packages/backend/node_modules/node-av/install/check.js`
  — the `tryLoadPrebuilt()` / `useGlobalFFmpeg()` logic that's failing
- `packages/docs/logs/2026-06-13_setup-ts-cost-profiling.md` — where Phase 2's
  retry was added, for the pattern to reuse
