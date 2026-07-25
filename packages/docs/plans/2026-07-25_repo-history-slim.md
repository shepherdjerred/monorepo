---
id: repo-history-slim
type: plan
status: planned
board: true
verification: human
disposition: active
---

# Slim the monorepo git history — one-time aggressive rewrite

## Context

`.git` is **1.0 GB**; a fresh clone pays for **644 MB of reachable blobs**.
Analysis (2026-07-25, `git rev-list --all --objects` × `objectsize:disk`) split it:

- **Live tip snapshot** (current version of all 21,210 files): **428 MB** — the only part a checkout uses.
- **Superseded old versions** of files still at tip: **~92 MB** — dead weight, mostly bot-refresh churn.
- **Deleted-at-tip content** (paths gone from HEAD entirely): **124 MB** — dead history.
- Separate from the 644 MB: **~360 MB of _unreachable_ objects** bloat local `.git` (reclaimable by `git gc`, no rewrite).

~80% of history is binary media git can't delta-compress (PNG 237 / JPG 166 / MP4 83 / JPEG 23 / SVG 18 MB).

**Decisions (owner, 2026-07-25):**

- **Aggressive** rewrite scope: strip deleted-at-tip dead content **and** superseded versions of the churny
  generated dirs (champion-loading, scout-showcase, report snapshots). Keep the current version of each.
- **One-time cleanup only** — do NOT change the "commit generated artifacts" pattern. Those dirs will slowly
  regrow from the weekly bots; that is accepted. (A future plan can de-commit them if regrowth becomes a problem.)
- `sandbox/archive/*` is **retained** (live at tip, intentionally frozen) — not a target.

## Reclaim targets

Measured now; re-measure at execution (numbers shift once PR #1640 merges).

| Target                                                                     | Method    | In history | Keep at tip |     Reclaim |
| -------------------------------------------------------------------------- | --------- | ---------: | ----------: | ----------: |
| `…/data-dragon/assets/img/champion-loading/` (incl. skins from #1640)      | collapse¹ |     108 MB |      ~9 MB² |      ~99 MB |
| `…/frontend/public/generated/scout-showcase/`                              | collapse¹ |     109 MB |       49 MB |      ~60 MB |
| `…/report/src/html/**/__snapshots__/`                                      | collapse¹ |      23 MB |       ~5 MB |      ~18 MB |
| `packages/discord-plays-pokemon/docs/**` (`demo.mp4` etc.)                 | delete³   |      32 MB |           0 |      ~32 MB |
| `…/data-dragon/assets/img/champion-splash/`                                | delete³   |      15 MB |           0 |      ~15 MB |
| `packages/scout-for-lol/assets/{banner,beta,scout}.jpeg` + old screenshots | delete³   |     ~21 MB |           0 |      ~21 MB |
| `…/discord-plays-pokemon/**/pokeemerald.wasm` (dead versions)              | delete³   |      ~9 MB |           0 |       ~9 MB |
| top-level `discord/` (scout's predecessor tree)                            | delete³   |      ~5 MB |           0 |       ~5 MB |
| **Total**                                                                  |           |            |             | **~250 MB** |

¹ **collapse** = strip the path from all history (incl. tip), then re-add its current contents as one fresh commit → history keeps a single copy, all superseded versions gone.
² post-#1640-merge champion-loading is only the 173 `*_0.jpg`.
³ **delete** = strip from all history; path is already gone at tip so the working tree is unaffected.

Expected result: **644 MB → ~390 MB reachable** (fresh clones ~40% smaller), plus the free ~360 MB local-`.git` gc.

## Phase 0 — free, no rewrite (do first, low risk)

`git gc --prune=now` in the main checkout reclaims the ~360 MB of unreachable objects on local disk. Does **not**
change any SHA, does **not** shrink clone size, does **not** touch GitHub — pure local maintenance. Safe to run
anytime; run it once the in-flight worktrees are idle (gc operates on the shared object store).

## Phase 1 — prerequisites (the rewrite is destructive; stage carefully)

- [ ] **Merge PR #1640 first** (skins cleanup) so champion-loading's tip is just the 173 `*_0.jpg` — otherwise the
      collapse re-adds 104 MB instead of 9 MB.
- [ ] **Quiesce every worktree + open PR.** A rewrite rewrites every SHA from the first targeted commit forward, so all
      13 active worktrees / open feature branches get stranded. Land or park them; note which must be re-created.
- [ ] **Full backup**: `git clone --mirror` the current remote to a safe location before any force-push (rollback anchor).

## Phase 2 — the rewrite (`git-filter-repo`, installed)

Work in a fresh **working** clone of `main` (not the mirror — we need to re-add files):

1. Copy the current collapse-target dirs aside (`champion-loading/`, `scout-showcase/`, the report `__snapshots__/`).
2. Run one `git filter-repo --invert-paths` pass listing **all** targets — both the `delete` paths and the `collapse`
   dirs (this strips the collapse dirs from tip too; step 4 restores them):

   ```bash
   git filter-repo --invert-paths \
     --path 'discord/' \
     --path 'packages/scout-for-lol/packages/data/src/data-dragon/assets/img/champion-splash/' \
     --path 'packages/scout-for-lol/packages/data/src/data-dragon/assets/img/champion-loading/' \
     --path 'packages/scout-for-lol/packages/frontend/public/generated/scout-showcase/' \
     --path-glob 'packages/scout-for-lol/packages/report/src/html/**/__snapshots__/*' \
     --path 'packages/discord-plays-pokemon/docs/' \
     --path-glob 'packages/discord-plays-pokemon/**/pokeemerald.wasm' \
     --path 'packages/scout-for-lol/assets/banner.jpeg' \
     --path 'packages/scout-for-lol/assets/beta.jpeg' \
     --path 'packages/scout-for-lol/assets/scout.jpeg'
   ```

   (Finalize the exact delete list by enumerating every deleted-at-tip path in the 124 MB set at execution;
   `--paths-from-file` keeps it maintainable. Keep `champion-loading/*_0.jpg` OUT of the delete set — they come back in step 4.)

3. Enumerate any other big deleted-at-tip blobs from the analysis and add them to the list.
4. Copy the saved current generated dirs back in, `git add <those paths>`, and commit:
   `chore(root): re-add current generated artifacts after history slim`.

## Phase 3 — publish + recover downstream

- [ ] Verify (see below) on the rewritten clone BEFORE pushing.
- [ ] Force-push the rewritten `main`; re-push/prune remote branches as needed.
- [ ] Everyone re-clones (or resets). Locally: fresh clone, `git-spice repo init` (rewrite invalidates the local
      `refs/spice/data` stack state), re-create any surviving stacks off the new `main`.
- [ ] `git worktree prune` / recreate worktrees against the new history.

## Phase 4 — GitHub server-side (set expectations)

GitHub does **not** GC on force-push — the remote repo stays ~1 GB until GitHub's own maintenance runs. Options:
open a GitHub Support request to force server-side `git gc` (fastest), or accept that only fresh clones shrink once
their GC eventually reclaims the unreachable blobs. Local `.git` shrinks after our own `git gc --prune=now`.

## Verification

The rewrite must change **history weight only, never working-tree content**:

1. **Tip-tree identity (primary oracle):** `git diff <old-main-HEAD-tree> <new-HEAD-tree>` must be **empty** — the
   re-added generated dirs are byte-identical and the deleted paths were already absent at tip. Any non-empty diff = a
   mistargeted path; abort and fix.
2. **Build/verify green** on the rewritten clone: `bun install --frozen-lockfile && bunx turbo run generate && bun run verify`.
3. **Size delta measured:** rerun the analysis (`scratchpad/analyze-git.sh` pattern) → reachable should drop ~250 MB.
4. **Backup retained** until the rewritten remote is confirmed healthy for a few days.

## Rollback

The Phase-1 mirror backup is the anchor: `git push --force` it back to restore the pre-rewrite history. Keep it until
CI + a couple of fresh clones are confirmed good.

## Supersedes

Absorbs `packages/docs/todos/scout-champion-loading-history-rewrite.md` (skins-only rewrite) — champion-loading is
now one target within this aggressive pass. That todo is updated to point here.

## Remaining

- [ ] Phase 0: run `git gc --prune=now` (free, immediate).
- [ ] Phase 1–4: execute the coordinated rewrite once PR #1640 is merged and worktrees are quiescent.

## Session Log — 2026-07-25

### Done

- Analyzed full git history (644 MB reachable / 1.0 GB `.git`); identified ~250 MB of reachable-but-dead + ~360 MB
  local unreachable. Captured decisions (aggressive scope, one-time only) and wrote this plan.

### Remaining

- Execute Phases 0–4 (deferred; needs #1640 merged + quiescent worktrees).

### Caveats

- Rewrite is destructive and coordination-heavy; do not run it opportunistically. The tip-tree-identity check is the
  guardrail that the working tree is unchanged.
- GitHub won't reclaim server-side space without its own GC / a support request.
