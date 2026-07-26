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

## Phase 0 — free, no rewrite (optional, low risk)

An ordinary `git gc` in the main checkout can reclaim old unreachable objects on local disk without changing any SHA,
shrinking a fresh clone, or touching GitHub. Keep Git's default prune grace period while worktrees or agents may be
writing objects; **never run `git gc --prune=now` concurrently with repository writers**, because removing the grace
period can race a new loose object before its ref is installed. The immediate final prune belongs after the Phase-3
writer freeze, ref verification, restacks, and obsolete-reflog expiration.

## Blast radius (read before Phase 1) — worktrees are safe; open PRs restack; every ref must move together

The rewrite runs in an **isolated throwaway clone** (`git clone` → `filter-repo` → force-push). `filter-repo` never
modifies your real `.git`, any worktree's files, or any uncommitted work — the 13 worktrees are physically untouched.
What moves is **every operator-controlled ref filter-repo rewrote** — this repo currently has **18 heads + 311 tags**
plus `refs/renovate/branches/renovate/pin-dependencies`, all rewritten in the same pass (see Phase 2) — not just
`origin/main`. Publishing only `main` and leaving the rest "as needed" is not safe: any un-force-pushed branch, tag,
or custom ref keeps the pre-rewrite blobs (including already-deleted content) reachable on GitHub, and a branch can
merge that old graph straight back into `main` later; see Phase 3 for the explicit controlled-ref publish step.
GitHub also advertises service-owned `refs/pull/*`; those cannot be force-pushed or deleted by an operator and must be
listed separately for the GitHub Support cleanup in Phase 4. After a correct publish, nothing _breaks_ locally (the
old objects still exist in the shared `.git`, so every worktree keeps building), but every local feature branch is
now based on an old `main` that's been replaced.

The real cost is narrow: **each open PR eventually needs its stack restacked onto the new main + resubmitted
(CI re-runs)** — see Phase 3 for the exact sequence. This is **not** a `git-spice repo sync --restack` freebie: that
flag only rebases branches whose _parent branch_ was merged/deleted by that same sync, and does nothing when trunk
itself is force-updated to an unrelated history out from under branches based directly on it — it'll report nothing
to do and silently leave the stack on the old, bloated objects. No work is lost either way (the old commits stay
reachable locally until a `git gc`), but the mechanical step is a real per-stack `stack restack`, not a passive sync.
The bloat blobs are ancestors of _every_ current branch, so no partial rewrite can leave the open branches' base
untouched — **timing is the only way to make it zero-touch.** Trade: rewrite anytime → 13 routine restacks; or wait
for a low-PR window → nothing to rebase.

## Phase 1 — prerequisites (the rewrite is destructive; stage carefully)

- [x] **Merge PR #1640** (skins cleanup) so champion-loading's tip is just the 173 `*_0.jpg` — otherwise the collapse
      re-adds 104 MB instead of 9 MB. _(Merged 2026-07-25.)_
- [ ] **Pick a low-PR window** (see Blast radius): the fewer open PRs, the fewer restacks afterward. Worktrees need not
      be deleted — only their open PRs eventually restack onto the new main.
- [ ] **Freeze every writer first**: stop pushes, merges, branch/tag publishers, Renovate, release automation, and
      agents that can create Git objects. Keep the freeze in place through backup, manifest capture, rewrite, atomic
      publish, local recovery, and final prune.
- [ ] **Capture and classify the frozen ref manifest** with `git ls-remote origin`. Partition it into
      operator-controlled refs (`refs/heads/*`, `refs/tags/*`, and every discovered custom namespace) versus
      GitHub-owned refs (`refs/pull/*`). Decide explicitly whether each controlled ref is retained or retired; no
      writer may republish an old ref during the rewrite.
- [ ] **Create the full rollback backup after the freeze**: `git clone --mirror` the frozen remote to a safe location.
      Verify every operator-controlled ref and SHA in the manifest matches the mirror before proceeding; if any differ,
      discard/refresh the mirror while writers remain frozen.
- [ ] **Record tip-tree oracles outside the rewrite clone**: save `<ref> <ref^{tree}>` for `main`, every retained head,
      and every retained tag whose target contains a collapse directory. A retained ref whose target paths differ from
      `main` needs its own saved target-directory contents. Retire a stale head or tag that still contains content
      intentionally being purged, or preserve its exact tree and subtract the retained bytes from the reclaim estimate.

## Phase 2 — the rewrite (`git-filter-repo`, installed)

Work in a fresh **working** clone of `main` (not the backup mirror — we need to re-add files). A plain `git clone`
fetches every branch and tag from `origin`, and `git filter-repo`'s default run (no `--partial`, no `--refs`) does its
own mirror-like fetch of those refs before filtering and remaps `refs/remotes/origin/*` to local `refs/heads/*`.
Generate explicit fetch refspecs for **every** operator-controlled custom namespace in the frozen manifest before
filtering; `refs/renovate/*` is only today's known example, not a complete hard-coded list. Do not fetch GitHub-owned
`refs/pull/*` into the rewrite set: operators cannot publish their rewritten values back. Do not pass
`--refs`/`--partial`, which would limit the rewrite to a subset and leave the rest holding the pre-rewrite blobs.

1. Copy the collapse-target dirs aside for `main`, every retained head, and every retained tag whose target contains
   them, keyed by ref. Deduplicate identical directory trees, but do not assume branch or tag tips carry the same
   version. Preserve annotated-tag metadata; signed tags must be explicitly re-signed or retired.
2. Run one `git filter-repo --invert-paths` pass listing **all** targets — both the `delete` paths and the `collapse`
   dirs (this strips the collapse dirs from tip too; step 4 restores them):

   ```bash
   git filter-repo --invert-paths \
     --path 'discord/' \
     --path 'packages/scout-for-lol/packages/data/src/data-dragon/assets/img/champion-splash/' \
     --path 'packages/scout-for-lol/packages/data/src/data-dragon/assets/img/champion-loading/' \
     --path 'packages/scout-for-lol/packages/frontend/public/generated/scout-showcase/' \
     --path 'packages/scout-for-lol/packages/report/src/html/__snapshots__/' \
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
4. On `main`, copy its saved generated dirs back in, `git add <those paths>`, and commit:
   `chore(root): re-add current generated artifacts after history slim`.
5. For every other retained head, restore that head's saved generated dirs and commit the restoration on that head
   before publishing. Verify its resulting tree hash equals the external pre-filter `<ref^{tree}>` oracle. Retire
   obsolete heads instead of publishing a silently altered tip. This may retain one copy per distinct live branch-tip
   version; that is the cost of preserving retained refs, and the measured size delta must include it.
6. For every retained tag whose target had a collapse directory, restore that tag's saved tree on top of its rewritten
   target, then retarget/recreate the tag with its preserved metadata and verify the resulting tree hash against the
   external oracle. Explicitly re-sign signed tags. Retire the tag instead if exact preservation is not worth its
   retained blobs; never silently publish a tag whose source archive or checkout lost snapshot content.

## Phase 3 — publish + recover downstream

- [ ] Verify (see below) on the rewritten clone BEFORE pushing.
- [ ] `filter-repo` removes the `origin` remote as a safety net — re-add it
      (`git remote add origin git@github.com:shepherdjerred/monorepo.git`). Generate one refspec array from **every**
      operator-controlled ref in the frozen manifest: `<ref>:<ref>` for each retained rewritten ref and `:<ref>` for
      each retired ref. Dry-run the entire transaction:

      ```bash
      git push --atomic --force --dry-run origin "${publish_refspecs[@]}"
      ```

      Any unsupported atomic capability, ruleset rejection, missing rewritten ref, or manifest mismatch aborts before
      remote mutation. Then run the same command without `--dry-run` as **one atomic transaction**. Do not issue
      separate deletion pushes. The owner account must intentionally exercise its current ruleset bypass for the
      protected non-fast-forward `main` update. An omitted controlled namespace keeps the old graph reachable, while
      a partial non-atomic update creates the mixed history this plan forbids.

- [ ] Verify the publish actually took before declaring the rewrite effective: compare the controlled namespaces from
      `git ls-remote origin` against the rewritten clone and the Phase-1 retained/retired manifest, **and** use a fresh
      `git clone` into a new directory (no reused `.git`) to confirm both the smaller size and that retired paths are
      gone from `git log --all -- <path>`. Do not require GitHub-owned `refs/pull/*` to match the clone; record their
      count and hand them to GitHub Support in Phase 4 because operators cannot rewrite or delete them.
- [ ] Before touching any local state, back up `refs/spice/data`
      (`git for-each-ref refs/spice/data > /tmp/spice-data-backup.txt`, or copy `.git/refs/spice/`). A remote-side
      history rewrite does **not** invalidate
      this ref — it's purely local and someone else's force-push can't touch it — and it holds the old base commit
      git-spice needs, per tracked branch, to replay that branch's commits across the pre-/post-rewrite split (the
      old base commit stays reachable locally via the feature branch's own ancestry, so it survives even a later
      `git gc`). Do **not** run `git-spice repo init` to "reset" the store after the reset below — that was this
      plan's original (wrong) instinct, and it throws away exactly the base pointers the restack step depends on.
- [ ] Recover local trunk only from a **clean, explicitly checked** main checkout:
      `test -z "$(git status --porcelain=v1 --untracked-files=all)"` must pass before
      `git fetch origin && git reset --hard origin/main`. If it is not clean, abort the recovery and first
      commit/push the work through its owning branch; do not stash or reset it. A separate re-clone is safe for
      inspection, but it does not contain this clone's `refs/spice/data`, so use the clean original clone for the
      per-stack restacks. Other clean worktrees keep working as is and do not need recreating.
- [ ] Per open stack, restack for real: `git-spice stack restack` (or `git-spice upstack restack --branch <name>` to
      move one branch + its upstack), then `git-spice stack submit --update-only` to force-push the rebased branches
      to their existing PRs (CI re-runs). This is **not** `git-spice repo sync --restack`: that flag only rebases the
      upstacks of branches whose _parent branch_ was merged/deleted during that same sync — a merged-PR cleanup. When
      trunk itself is force-updated to an unrelated history out from under branches based directly on it, `repo sync`
      finds no merged branch to clean up, does nothing, and exits — leaving every open stack silently un-rebased on
      the old (bloated) objects with no error to notice.
- [ ] Rehearse the restack sequence above in a disposable clone (with a copy of `refs/spice/data` and one
      representative stack) before running it against real stacks. Resolve conflicts with `git-spice rebase continue`
      / `git-spice rebase abort` per the normal conflict flow. If automatic restacking cannot represent the old stack,
      abort and repair its tracked topology **through git-spice**: check out the bottom branch, use
      `git-spice upstack onto main` (or `git-spice branch onto <parent>` plus `git-spice stack edit`) to retarget the
      stack, then verify `git-spice log long` and each branch diff before `git-spice stack submit --update-only`.
      Never fall back to raw `git cherry-pick`, which leaves `refs/spice/data` with stale bases. If git-spice cannot
      reconstruct the intended topology, stop and roll back instead of publishing an unmanaged stack.
- [ ] After every controlled ref is verified on the rewritten graph and the rollback mirror is secured, expire only
      obsolete unreachable reflog entries with `git reflog expire --expire-unreachable=now --all`, verify writers are
      still frozen, then run `git gc --prune=now`. Without the reflog expiration, recent pre-rewrite commits remain
      roots and the immediate prune cannot reclaim them. Unfreeze writers only after this final verification/prune.

## Phase 4 — GitHub server-side (set expectations)

GitHub does **not** GC on force-push, and its service-owned `refs/pull/*` continue to retain historical PR commits that
operators cannot rewrite or delete. Open a GitHub Support request to remove/repack the obsolete PR refs and force
server-side `git gc`; until that completes, the remote repository may stay ~1 GB even though normal fresh clones no
longer fetch the retired operator-controlled graph. Local `.git` shrinks after our own `git gc --prune=now`.

## Verification

The rewrite must change **history weight only, never working-tree content**:

1. **Tip-tree identity (primary oracle):** before filtering, write the tree hashes for `main`, every retained head,
   and every retained tag whose target contains a collapse directory to an external manifest (outside the disposable
   clone). After all per-ref restorations, require `git rev-parse <ref>^{tree}` to equal the recorded hash for each
   retained ref. Comparing hashes remains executable after `filter-repo` expires reflogs and garbage-collects old
   objects; a `git diff <old-commit> <new-commit>` inside the rewritten clone does not. Any mismatch means a mistargeted
   path or missing per-ref restore; abort and fix.
2. **Build/verify green** on the rewritten clone: `bun install --frozen-lockfile && bunx turbo run generate && bun run verify`.
3. **Size delta measured:** rerun the analysis (`scratchpad/analyze-git.sh` pattern) → reachable should drop ~250 MB.
4. **Backup retained** until the rewritten remote is confirmed healthy for a few days.

## Rollback

The Phase-1 mirror backup is the anchor. Freeze every writer again before rollback and capture the current remote
manifest. From the mirror backup, generate one refspec array covering **every** operator-controlled namespace: the
backup's `<ref>:<ref>` updates plus `:<ref>` deletions for controlled refs that exist only in the rewritten remote.
Dry-run the rollback transaction:

```bash
git push --atomic --force --dry-run git@github.com:shepherdjerred/monorepo.git "${rollback_refspecs[@]}"
```

Then run the identical atomic transaction without `--dry-run`. Never put `<backup-path>` in the destination position
of `git push`: that would overwrite the rollback anchor rather than restore GitHub. Never omit a namespace, split
deletions into a second push, or do a `main`-only rollback; any of those creates the mixed state this plan forbids.
Keep writers frozen until remote refs and fresh clones match the backup, and retain the backup until CI + a couple of
fresh clones are confirmed good.

## Supersedes

Absorbs the archived `packages/docs/archive/completed/scout-champion-loading-history-rewrite.md` (skins-only rewrite)
— champion-loading is now one target within this aggressive pass. The superseded TODO is complete and no longer
appears as active work on the docs board.

## Remaining

- [ ] Phase 0: optionally run ordinary `git gc` with its default prune grace period.
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

## Session Log — 2026-07-25 (P1 review fixes)

### Done

- Fixed 2 P1 findings from a Codex substitute review (Greptile credit-paused): (1) Phase 3's publish step now
  force-pushes **every** rewritten ref (`refs/heads/*` + `refs/tags/*`, 18 heads + 311 tags), not just `main`, with
  explicit deletion of retired refs and a `git ls-remote` + fresh-clone verification step; the Rollback section
  mirrors the same all-refs push. (2) Phase 3's restack step no longer relies on `git-spice repo sync --restack`
  (confirmed via `git-spice-helper`'s command reference that it only rebases upstacks of merged/deleted branches,
  not branches based directly on a force-updated trunk) — replaced with backing up `refs/spice/data` (not
  `repo init`, which would destroy the base pointers needed to replay commits across the rewrite), then
  `git-spice stack restack` / `upstack restack --branch` per stack + `stack submit --update-only`, rehearsed in a
  disposable clone first. Also confirmed via `git-filter-repo --help` that its default (non-`--partial`) run already
  does a mirror-like fetch of all refs, so Phase 2's existing single-clone approach didn't need restructuring — only
  a clarifying note.

### Remaining

- Execute Phases 0–4 (unchanged from before this fix — still deferred; needs #1640 merged + quiescent worktrees).

### Caveats

- The `robot-face-greptile-review-gate` check will stay red on this PR regardless of these fixes — it's a billing
  gate (credits paused), not a content gate; see `reference_greptile_gate_merge_skip` in the reviewer's memory for
  the known Greptile-gate quirks.

## Session Log — 2026-07-25 (Codex replacement review)

### Done

- Addressed the replacement review's 4 P1 findings: retained heads now preserve their own generated-directory tip
  trees, local trunk recovery requires a clean checkout, rollback runs from the mirror backup toward GitHub, and
  pre-filter tree hashes are recorded externally for an executable post-filter identity check.
- Addressed its P2 finding by inventorying custom refs, explicitly rewriting the current `refs/renovate/*` namespace,
  and separating GitHub-owned `refs/pull/*` for Support-assisted cleanup.

### Remaining

- Execute Phases 0–4 in a coordinated low-PR window after all writers are frozen and every controlled ref is
  classified as retained or retired.

### Caveats

- The Buildkite aggregate remains hard-red solely because its Greptile gate timed out after 1,200 seconds with no
  Greptile check started; affected verification and every other substantive PR job passed.

## Session Log — 2026-07-25 (hosted Codex review)

### Done

- Addressed all 9 current-head hosted Codex findings: immediate pruning now requires quiesced writers; the top-level
  report snapshot directory is included; retained tag trees are classified, restored, and verified; the superseded
  skins-only TODO is complete and archived; all controlled namespaces come from the frozen manifest; recovery stays
  inside git-spice; the rollback mirror is taken only after writers freeze; publish and rollback are atomic
  all-ref transactions; and obsolete reflogs expire before the final immediate prune.

### Remaining

- Execute Phases 0–4 only in the coordinated freeze window described above.

### Caveats

- GitHub-owned `refs/pull/*` remain outside operator control and require the Phase-4 Support cleanup.
