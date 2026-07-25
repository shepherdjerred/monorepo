---
id: plan-2026-07-12-setup-build-discord-stream-lifecycle
type: reference
status: complete
board: true
verification: agent
disposition: active
---

# PR: Build `discord-stream-lifecycle` in `setup.ts` + delete the dead Bazel vite-env fallback

## Context

`discord-plays-pokemon`, `discord-plays-mario-kart`, and `streambot` backends import
`@shepherdjerred/discord-stream-lifecycle/...` (e.g. `.../debug/transition-logger`). In a
**fresh worktree**, those packages fail `typecheck` with `TS2307: Cannot find module` —
which also blocks the last stale-Bazel cleanup (the `vite-env.d.ts` fallback in the two
frontends), because the `discord-plays-*-typecheck` pre-commit hook typechecks the whole
package (backend included) and can't go green.

**Root cause:** commit `2fb549df4` (2026-07-11) changed `discord-stream-lifecycle` to export
**both types and runtime from `./dist/*`** (`"./*": { "types": "./dist/*.d.ts", "default":
"./dist/*.js" }`) with a real build (`tsc -p tsconfig.build.json`). But `scripts/setup.ts`
still lists it as **SOURCE-ONLY** (comment line 94: `exports → ./src/*.ts, no build`), so setup
never builds its `dist/` and never force-refreshes consumers. Bun _copies_ `file:` deps into
each consumer's `.bun/` cache, so even a manual `bun run build` in the package doesn't reach
consumers — exactly the case `BUILT_PRODUCERS` + the Phase-4 refresh already handle for
`llm-models`/`webring`/`astro-opengraph-images`. It works in CI/prod (Dagger builds it), so this
is a local-dev/worktree-only bug.

**Outcome:** `discord-stream-lifecycle` builds during `setup.ts` (full and `--group=pokemon`/`mk64`)
and its `dist/` is force-copied into consumers, so dpp/mk64/streambot typecheck in a fresh worktree
— then delete the now-verifiably-dead Bazel `vite-env.d.ts` fallback.

## Scope: one PR, off current `origin/main`

Branch off **`origin/main`** (currently `b4d127632` — NOT the stale `rm-cache-buckets`/#1501 base).
Files touched are disjoint from #1501, so no dependency between the two PRs.

```
git worktree add .claude/worktrees/fix-dsl-build -b feature/setup-build-discord-stream-lifecycle origin/main
cd .claude/worktrees/fix-dsl-build
bun run scripts/setup.ts            # baseline: reproduces the failure first
```

## Changes

### 1. `scripts/setup.ts` — treat `discord-stream-lifecycle` as a BUILT shared producer

Mirror `llm-models` (BUILT_PRODUCER + refresh) and `discord-video-stream` (DAG build task). All
line numbers are on current `origin/main`.

| #   | Edit                                                                                                                                                 | Location                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| a   | Move `@shepherdjerred/discord-stream-lifecycle` out of the SOURCE-ONLY comment list into the BUILT list; fix its description to `exports → ./dist/*` | comment block ~L84–100 (bullet at **L94**) |
| b   | Add `"@shepherdjerred/discord-stream-lifecycle"` to `BUILT_PRODUCERS`                                                                                | **L102–106**                               |
| c   | Add `"packages/discord-stream-lifecycle"` to `SHARED_PRODUCER_DIRS` (always install its own deps so `tsc` build works under any `--group`)           | **L51–58**                                 |
| d   | Add `"discord-stream-lifecycle"` to `SHARED_PRODUCER_DAG_IDS`                                                                                        | **L61–68**                                 |
| e   | Add a `DAG_TASKS` entry (template = `discord-video-stream` at **L654–662**)                                                                          | after the `discord-video-stream` entry     |

DAG entry (deps `[]` — verified: `discord-stream-lifecycle/src` has **no** cross-package
`@shepherdjerred/*` imports, so its `tsc` build needs no other producer):

```ts
{
  id: "discord-stream-lifecycle",
  label: "discord-stream-lifecycle build",
  cmd: ["bun", "run", "build"],
  cwd: "packages/discord-stream-lifecycle",
  deps: [],
  warnOnly: false,
},
```

- `BUILT_PRODUCERS` (b) is the load-bearing change: `deriveRefreshPlan` (~L497/L543) scans workspace
  `package.json`s for `file:` deps on a `BUILT_PRODUCERS` member and force-refreshes those consumers
  (`bun install --force`), copying the freshly-built `dist/` into their `.bun/` cache. `--group`
  scoping is applied automatically (dpp under `pokemon`, mk64 under `mk64`, streambot in full runs).
- (Optional) add a `verifySetup()` check for `packages/discord-stream-lifecycle/dist/index.js`.

### 2. Delete the dead Bazel vite-env fallback (the payoff — verified safe by exploration)

Reduce **each** of these to a single line — `/// <reference types="vite/client" />` — deleting the
`// Fallback declarations … (e.g. Bazel sandbox …)` comment and the `type ImportMetaEnv`/`type
ImportMeta` block:

- `packages/discord-plays-pokemon/packages/frontend/types/vite-env.d.ts`
- `packages/discord-plays-mario-kart/packages/frontend/types/vite-env.d.ts`

Safe because: both frontends have `vite` as a direct devDep (`^8.0.11`), `moduleResolution:
bundler`, `include: ["src","types"]`; `vite/client`'s `ImportMetaEnv` already declares
`MODE/DEV/PROD/SSR/BASE_URL` + a `[key: string]: any` index signature — covering the only keys used
(`import.meta.env.MODE`, `import.meta.env.VITE_SENTRY_RELEASE`, both in each `src/main.tsx`). No
other file declares `ImportMetaEnv`/`ImportMeta`. The local block only added a _stricter_ index type,
so removing it loosens nothing that code relies on.

## Verification (end-to-end, in the fresh worktree)

1. **Reproduce first** (before edits): `cd packages/discord-plays-pokemon && bun run typecheck` →
   fails with `TS2307 … discord-stream-lifecycle/debug/transition-logger`.
2. Apply change (1), then re-run `bun run scripts/setup.ts`; confirm the log shows
   `[DAG] discord-stream-lifecycle build …` and a `[Deps] … refresh` for the dpp/mk64/streambot
   backends.
3. `bun run typecheck` in each of `packages/discord-plays-pokemon`,
   `packages/discord-plays-mario-kart`, `packages/streambot` → all pass.
4. Re-verify scoped installs don't regress: in a clean worktree,
   `bun run scripts/setup.ts --group=pokemon` then dpp typecheck; likewise `--group=mk64` + mk64.
5. Apply change (2); `cd packages/discord-plays-*/packages/frontend && bun run typecheck` (`tsc
--noEmit`) → passes with the fallback removed.
6. Commit (conventional scope required, e.g. `chore(root):`/`fix(root):`) — the
   `discord-plays-*-typecheck` pre-commit hooks now go green, proving the fix end-to-end. Do **not**
   `--no-verify`.
7. Push; open PR. CI (Dagger already builds `discord-stream-lifecycle`) re-validates.

## Notes / caveats

- Existing checkouts (incl. the main checkout) hold a **stale `0.0.1` `.bun` cache** of
  `discord-stream-lifecycle` (old `exports → ./src/*`, `build: "true"`). A single `bun run
scripts/setup.ts` after this lands force-refreshes it away. Worth a one-line PR-description note.
- This is a local-dev/worktree fix; CI and prod images already build the package, so no CI behavior
  change is expected beyond the (dead-code) vite-env deletion, which CI's frontend typecheck covers.
- `#1501` (Bazel removal) is now behind `origin/main`; unrelated to this PR but may need a rebase
  before merge — handle separately.

## Session Log — 2026-07-12

### Done

- **Reproduced** the gap in a fresh worktree off `origin/main`: after full `setup.ts`, dpp/mk64
  backends fail `typecheck` with `TS2307` on every `@shepherdjerred/discord-stream-lifecycle/*`
  subpath (whole `dist/` missing from consumers, not just `debug/transition-logger`).
- **Fixed `scripts/setup.ts`** (6 edits): added `discord-stream-lifecycle` to `SHARED_PRODUCER_DIRS`,
  `SHARED_PRODUCER_DAG_IDS`, a `DAG_TASKS` build entry (`bun run build`, `deps: []`), and
  `BUILT_PRODUCERS`; moved its comment bullet from SOURCE-ONLY to BUILT.
- **Verified end-to-end**: re-run `setup.ts` logs `[DAG] discord-stream-lifecycle build … done` and
  Phase-4 `refresh (@shepherdjerred/discord-stream-lifecycle)` for the dpp backend, mk64 backend, and
  streambot; all three then `typecheck` PASS.
- **Deleted the dead Bazel vite-env fallback** in both `discord-plays-*` frontends' `vite-env.d.ts`
  (reduced to `/// <reference types="vite/client" />`); full dpp + mk64 package typechecks PASS with
  it removed — proving the setup fix unblocks the last stale-Bazel cleanup.

### Remaining

- Push + open PR; let CI (Dagger) re-validate.

### Caveats

- Local-dev/worktree fix only; CI/prod already build the package, so no CI behavior change beyond the
  dead-code vite-env deletion. Existing checkouts clear their stale `0.0.1` `.bun` cache on the next
  `setup.ts` run.
