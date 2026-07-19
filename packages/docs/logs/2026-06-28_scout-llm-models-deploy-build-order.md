---
id: log-2026-06-28-scout-llm-models-deploy-build-order
type: log
status: complete
board: false
---

# Scout deploy red — `@shepherdjerred/llm-models` build-order bug

## Symptom

After the SeaweedFS volume fix unblocked the static-site deploys (see
`2026-06-27_main-ci-red-seaweedfs-volume-exhaustion.md`), the two **scout-for-lol
frontend + app** deploys (prod + beta) still failed on build **4725** — but on a
**different** error, surfaced once the storage outage cleared:

```
@scout-for-lol/frontend build: [vite] ✗ Build failed
[commonjs--resolver] Failed to resolve entry for package "@shepherdjerred/llm-models".
The package may have incorrect main/module/exports specified in its package.json.
```

## Root cause

`@shepherdjerred/llm-models` is consumed by scout via `file:../llm-models` and declares
`main`/`exports` → `./dist/index.js`. Its `dist/` is produced by `bun run build` (it's in
`BUILD_TIME_DEPS`). The deploy helper built it in the **wrong order**:

`.dagger/src/release.ts` `deploySiteHelper` did:

1. `bun install` in the **site** (copies `file:` deps into `node_modules`)
2. build the buildDeps (`llm-models` etc.) into `/workspace/packages/<dep>/dist`
3. run the site build

For **symlinked** `file:` deps (e.g. sjer.red → astro-opengraph-images) step 2 is visible
through the symlink, so order didn't matter. But **scout-for-lol is a nested bun workspace
that COPIES its `file:` deps** at install time (step 1), so it captured a **dist-less**
`llm-models`; the later build never reached scout's `node_modules`, and vite couldn't
resolve the entry. This had been failing scout deploys since the llm-models package landed
(~build 4675), independent of SeaweedFS.

## Fix

Reorder `deploySiteHelper`: **build the buildDeps BEFORE the site's `bun install`**, so the
copy captures each dep's built `dist/`. Symlinked sites are unaffected by the order, so this
is safe for every site. Single-file change in `.dagger/src/release.ts`.

## Verification (local, high-fidelity)

Reproduced the exact CI flow in a worktree:

1. `bun run build` in `packages/llm-models` → `dist/index.js` present.
2. `bun install` in `packages/scout-for-lol` → its copied
   `node_modules/@shepherdjerred/llm-models/dist/index.js` **now exists** (was missing).
3. `bun run --filter='@scout-for-lol/frontend' build` (with placeholder
   `PUBLIC_PINTEREST_TAG_ID`/`PUBLIC_REDDIT_PIXEL_ID`) → **Exited with code 0**, 16 pages
   built, `dist/index.html` + `dist/app/index.html` emitted. The llm-models resolve error
   is gone.

`bun scripts/check-dagger-hygiene.ts` → "No violations found".

## Follow-up (optional hardening, not in this PR)

`llm-models` lacks a `files` field (its siblings webring / astro-opengraph-images declare
`files: ["dist","src",…]`). The reorder works because llm-models' `dist/` is **not**
gitignored, so the copy includes it. If `dist/` is ever gitignored, add an explicit
`files: ["dist","src","package.json"]` to keep the copy robust.

## Session Log — 2026-06-28

### Done

- Root-caused scout deploy failure to a `file:`-dep build-order bug in `deploySiteHelper`.
- Fixed by building buildDeps before the site install (`.dagger/src/release.ts`).
- Verified end-to-end locally (scout frontend builds clean once llm-models is built first).

### Remaining

- Merge the PR (branch `fix/scout-llm-models-build-order`) and confirm a green main build
  (scout prod + beta deploys pass).

### Caveats

- Verified locally, not via a full Dagger run (the engine call is heavy); the local repro is
  high-fidelity (same bun copy semantics + same frontend build). CI is the final check.
- Optional `files`-field hardening on llm-models deferred (see Follow-up).
