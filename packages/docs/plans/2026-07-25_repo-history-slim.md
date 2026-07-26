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
writer freeze, ref verification, filtered local-ref replacement, and obsolete-reflog expiration.

## Blast radius — worktrees stay intact; every local ref gets a filtered counterpart; every remote ref moves together

The rewrite runs in an **isolated throwaway clone** (`git clone` → `filter-repo` → force-push). `filter-repo` never
modifies your real `.git`, any worktree's files, or any uncommitted work — the 13 worktrees are physically untouched.
What moves is **every operator-controlled ref filter-repo rewrote** — this repo currently has **18 heads + 311 tags**
plus `refs/renovate/branches/renovate/pin-dependencies`, all rewritten in the same pass (see Phase 2) — not just
`origin/main`. Publishing only `main` and leaving the rest "as needed" is not safe: any un-force-pushed branch, tag,
or custom ref keeps the pre-rewrite blobs (including already-deleted content) reachable on GitHub, and a branch can
merge that old graph straight back into `main` later; see Phase 3 for the explicit controlled-ref publish step.
GitHub also advertises service-owned `refs/pull/*`; those cannot be force-pushed or deleted by an operator. Treat
their retained objects as permanent for this non-sensitive large-file cleanup; Phase 4 explains why Support removal
is not an expected outcome. After a correct publish, nothing _breaks_ immediately in the shared clone, but its local
branches and tags still point at the rejected graph and must not be pushed or pruned until Phase 3 replaces them from
the post-filter recovery bundle.

The recovery applies to **every retained local branch**, not only branches with open PRs. Do **not** restack the
original branches: replaying an old branch-only commit that touched a filtered path can reintroduce the purged blob as
an intermediate version even when its final tree and ancestry checks pass. Instead, Phase 1 bundles every local head,
Phase 2 filters those heads in the same pass as the remote refs, and Phase 3 replaces each clean local branch with its
exact post-filter counterpart before rebuilding git-spice metadata. A dormant local branch that has no filtered
counterpart remains blocked from pushes.

The rewrite also changes commit payloads and parent IDs, invalidating embedded commit signatures. The current review
found 606 signed commits descended from the first affected commit. Original signature verification and GitHub
Verified provenance cannot survive changed commit objects; signed tags can be recreated and re-signed, but signed
commits require an explicit owner-approved loss policy or a separately designed new-signature policy before cutover.

## Phase 1 — prerequisites (the rewrite is destructive; stage carefully)

- [x] **Merge PR #1640** (skins cleanup) so champion-loading's tip is just the 173 `*_0.jpg` — otherwise the collapse
      re-adds 104 MB instead of 9 MB. _(Merged 2026-07-25.)_
- [ ] **Pick a low-ref window** (see Blast radius): inventory every worktree plus local `refs/heads/*` and
      `refs/tags/*`; the fewer retained local refs, the fewer filtered recovery refs. Worktrees need not be deleted,
      but every retained branch in them must be clean and replaced before writers unfreeze.
- [ ] **Freeze every writer first**: stop pushes, merges, branch/tag publishers, Renovate, release automation, and
      agents that can create Git objects. Keep the freeze in place through backup, manifest capture, rewrite, atomic
      publish, local recovery, and final prune.
- [ ] **Capture and classify the frozen ref manifest** with `git ls-remote --refs origin`. `--refs` excludes `HEAD`
      and annotated tags' peeled `refs/tags/<name>^{}` pseudo-records, neither of which is a publishable ref. Partition
      the result into operator-controlled refs (`refs/heads/*`, `refs/tags/*`, and every discovered custom namespace)
      versus GitHub-owned refs (`refs/pull/*`). Decide explicitly whether each controlled ref is retained or retired;
      no writer may republish an old ref during the rewrite.
- [ ] **Back up and classify all local-only state outside `.git`**: record every local head/tag object ID, every
      worktree-to-branch mapping, and `git-spice log short --all --json`; copy the exact `refs/spice/data` ref; and
      create/verify a durable git bundle containing `--branches`, `--tags`, and `refs/spice/data`. Classify local tags
      as identical-to-remote, local-only, or same-name divergent, then explicitly retain or retire each one. The
      bundle is the rollback source for refs that never existed in the remote mirror.
- [ ] **Create the full rollback backup after the freeze**: `git clone --mirror` the frozen remote to a safe location.
      Verify every operator-controlled ref and SHA in the manifest matches the mirror before proceeding; if any differ,
      discard/refresh the mirror while writers remain frozen.
- [ ] **Classify every affected head and tag**, including the bundled local heads/tags: test each peeled commit tree
      against **every** collapse and delete target. An affected ref must be retired or preserved exactly; default to
      retirement when it contains a delete target, because exact preservation keeps those blobs reachable. No
      affected retained ref may skip restoration.
- [ ] **Record tip-tree oracles outside the rewrite clone**: save `<ref> <ref^{tree}>` for `main`, every retained head,
      and every affected retained tag. A retained ref whose target paths differ from `main` needs its own saved
      target-path contents. Retire a stale head or tag that still contains content intentionally being purged, or
      preserve its exact tree and subtract the retained bytes from the reclaim estimate.
- [ ] **Inventory rewritten commit signatures**: save `git log --all --format='%H%x09%G?'` from the frozen graph and
      cross-reference signed commits with the filter-repo commit map during rehearsal. Record the final count and
      obtain explicit owner acceptance for losing original commit signatures/Verified provenance. If new signatures
      are required, stop and define a feasible signing policy before cutover.

## Phase 2 — the rewrite (`git-filter-repo`, installed)

Work in a fresh **working** clone of `main` (not the backup mirror — we need to re-add files). A plain `git clone`
fetches every branch and tag from `origin`, and `git filter-repo`'s default run (no `--partial`, no `--refs`) does its
own mirror-like fetch of those refs before filtering and remaps `refs/remotes/origin/*` to local `refs/heads/*`.
Generate explicit fetch refspecs for **every** operator-controlled custom namespace in the frozen manifest before
filtering; `refs/renovate/*` is only today's known example, not a complete hard-coded list. Do not fetch GitHub-owned
`refs/pull/*` into the rewrite set: operators cannot publish their rewritten values back. Do not pass
`--refs`/`--partial`, which would limit the rewrite to a subset and leave the rest holding the pre-rewrite blobs.
Before filtering, import the Phase-1 local-state bundle under reserved temporary head/tag prefixes that do not collide
with remote refs (for example, `refs/heads/__history_rewrite_local__/*` and
`refs/tags/__history_rewrite_local__/*`). Include those temporary refs in the same filter pass, but never include them
in the remote publication refspecs.

1. For **every affected retained head or tag**, including temporary local-recovery refs, copy aside every filtered
   target path present in its peeled commit—collapse and delete targets alike—keyed by ref. Deduplicate identical
   directory trees, but do not assume branch or tag tips carry the same version. Preserve annotated-tag metadata;
   signed tags must be explicitly re-signed or retired.
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
5. For every other affected retained head, restore **all** of that ref's saved filtered paths and commit the
   restoration on that head before publishing/exporting it. This includes delete targets retained by an important
   stale branch, not only generated collapse directories. Verify its resulting tree hash equals the external
   pre-filter `<ref^{tree}>` oracle. Retire obsolete heads instead of publishing a silently altered tip. This may
   retain one copy per distinct live branch-tip version; that is the cost of preserving retained refs, and the
   measured size delta must include it.
6. For every affected retained tag, create a tag-only restoration commit on its rewritten target, restore **all**
   saved filtered paths, then retarget/recreate the tag with its preserved metadata and verify the resulting tree hash
   against the external oracle. Explicitly re-sign signed tags. This applies to tags affected only by delete targets
   as well as collapse targets. Retire the tag instead if exact preservation is not worth its retained blobs; never
   silently publish an affected tag whose source archive or checkout lost content.
7. Export every filtered temporary local head/tag to a durable post-filter recovery bundle and manifest before
   deleting the reserved temporary refs. Record each original local ref name, its filtered object ID, tree oracle,
   and original git-spice parent from the Phase-1 topology manifest. This bundle—not replay of old commits—is the only
   source for Phase-3 local recovery.

## Phase 3 — publish + recover downstream

- [ ] Verify (see below) on the rewritten clone BEFORE pushing.
- [ ] `filter-repo` removes the `origin` remote as a safety net — re-add it
      (`git remote add origin git@github.com:shepherdjerred/monorepo.git`). Generate one refspec array from **every**
      operator-controlled ref in the frozen manifest: `<ref>:<ref>` for each retained rewritten ref and `:<ref>` for
      each retired ref. Dry-run the entire transaction:

      ```bash
      git push --atomic --force --dry-run origin "${publish_refspecs[@]}"
      ```

      The dry-run validates local refspec construction and that the remote advertises atomic-push support; it does
      **not** send updates and therefore does not exercise GitHub rulesets or pre-receive policy. Verify the owner's
      current ruleset-bypass permission independently, then run the same command without `--dry-run` as **one atomic
      transaction**. The real atomic push is the first definitive policy check; a rejection must leave every remote
      ref unchanged. Do not issue separate deletion pushes. An omitted controlled namespace keeps the old graph
      reachable, while a partial non-atomic update creates the mixed history this plan forbids.

- [ ] Verify the publish actually took before declaring the rewrite effective: compare the controlled namespaces from
      `git ls-remote --refs origin` against the rewritten clone and the Phase-1 retained/retired manifest, **and** use
      a fresh `git clone` into a new directory (no reused `.git`) to confirm both the smaller size and that retired
      paths are gone from `git log --all -- <path>`. Do not require GitHub-owned `refs/pull/*` to match the clone;
      record their count as permanently outside operator control for this non-sensitive cleanup.
- [ ] Before touching any shared-clone state, verify the durable Phase-1 local bundle, exact pre-cutover
      `refs/spice/data` object ID, worktree/topology manifests, and Phase-2 post-filter recovery bundle. Every retained
      local head/tag must have both a pre-cutover rollback object and a post-filter replacement object. Keep both
      bundles outside `.git`; importing the pre-cutover bundle before a rollback would keep the rejected graph
      reachable and defeat pruning.
- [ ] Recover local trunk only from a **clean, explicitly checked** main checkout:
      `test -z "$(git status --porcelain=v1 --untracked-files=all)"` must pass. Then force-synchronize rewritten and
      retired remote refs before resetting:

      ```bash
      git fetch --force --prune --prune-tags origin \
        '+refs/heads/*:refs/remotes/origin/*' \
        '+refs/tags/*:refs/tags/*'
      git reset --hard origin/main
      ```

      Generate equivalent forced fetch refspecs for every controlled custom namespace in the frozen manifest. Compare
      local `refs/tags/*` names and object IDs with the rewritten remote manifest; changed tags must be clobbered and
      retired remote tags absent before pruning. `--prune-tags` may also delete local-only tags, so recreate every
      retained local-only tag from its **filtered** recovery ref after the fetch and verify its object ID/tree against
      the post-filter manifest. Same-name divergent tags follow the explicit Phase-1 disposition; never silently
      overwrite one. Plain `git fetch origin` is insufficient because it does not replace force-moved local tags. If
      the main checkout is not clean, abort recovery and first commit/push the work through its owning branch; do not
      stash or reset it.

- [ ] Replace **every retained local branch** from the post-filter recovery bundle, including clean worktree branches
      with no PR. Fetch the bundle into a reserved recovery namespace, enter each owning worktree, recheck cleanliness,
      and reset its checked-out branch to the exact recorded filtered object ID. Verify every local branch object ID
      equals the post-filter manifest and its tree equals the pre-cutover oracle. Never restack/rebase/cherry-pick the
      original pre-rewrite branch: replay can resurrect filtered intermediate blobs while passing final-tree checks.
- [ ] Rebuild git-spice metadata **without rewriting commits**: after every local head is on its exact filtered object,
      run `git-spice repo init --reset --trunk main --remote origin`, then re-track each branch with its recorded
      parent using
      `git-spice branch track <branch> --base <parent>`. Verify `git-spice log long --all`, every branch diff, and the
      saved topology manifest. Existing remote PR branches were filtered in the same pass; submit only a filtered
      local branch that intentionally contains previously unpushed work, and verify the submitted SHA is exactly its
      post-filter recovery SHA. If topology cannot be reconstructed without mutating branch history, keep writers
      frozen and roll back.
- [ ] Rehearse the bundle import, per-worktree exact reset, local-tag reconstruction, and git-spice metadata rebuild in
      a disposable clone with a representative stack before touching the shared clone. Verify the entire branch
      object IDs—not just tip trees or ancestry—against the post-filter manifest. Remove reserved recovery refs after
      verification so no accidental publish namespace remains.
- [ ] After every controlled ref is verified on the rewritten graph and the rollback mirror is secured, expire only
      obsolete unreachable reflog entries with `git reflog expire --expire-unreachable=now --all`, verify writers are
      still frozen, then run `git gc --prune=now`. Without the reflog expiration, recent pre-rewrite commits remain
      roots and the immediate prune cannot reclaim them. Keep writers frozen through the fresh-clone checks, CI, and
      the explicit accept-or-rollback decision. Unfreeze only after every retained local branch and tag is on the new
      graph, final verification/prune passes, and the direct rollback window is closed.

## Phase 4 — GitHub server-side (set expectations)

GitHub does **not** GC on force-push, and its service-owned `refs/pull/*` continue to retain historical PR commits that
operators cannot rewrite or delete. GitHub's documented Support cleanup is for sensitive-data removal and excludes
non-sensitive large files, so assume Support will **not** delete these PR refs or force a server-side repack. A request
is best-effort only after advance Support confirmation and is not an acceptance criterion. GitHub's stored repository
size may remain ~1 GB indefinitely even though normal fresh clones no longer fetch the retired operator-controlled
graph. Local `.git` shrinks after our own `git gc --prune=now`.

## Reproducible history analysis

Run this exact procedure in the fresh working rewrite clone after every frozen operator-controlled ref is fetched,
first before filtering and again after restoration. Do not run it in the shared multi-worktree clone, whose local-only
refs change the measured reachability set. The procedure measures each reachable blob once by on-disk object size,
classifies the representative path reported by `rev-list --objects` against `HEAD`, and separately enumerates every
path ever changed but absent from `HEAD`:

```bash
set -euo pipefail
analysis_dir="$(mktemp -d)"
git rev-list --objects --all > "$analysis_dir/rev-list.txt"
cut -d ' ' -f1 "$analysis_dir/rev-list.txt" |
  sort -u |
  git cat-file --batch-check='%(objectname) %(objecttype) %(objectsize:disk)' \
    > "$analysis_dir/object-sizes.txt"
git ls-tree -r -z HEAD > "$analysis_dir/head-tree.z"
git log --all --format= --name-only --no-renames -z > "$analysis_dir/all-paths.z"

ANALYSIS_DIR="$analysis_dir" bun run - <<'BUN'
const analysisDir = process.env.ANALYSIS_DIR;
if (analysisDir === undefined) {
  throw new Error("ANALYSIS_DIR is required");
}

const revList = await Bun.file(`${analysisDir}/rev-list.txt`).text();
const sizeList = await Bun.file(`${analysisDir}/object-sizes.txt`).text();
const headTree = await Bun.file(`${analysisDir}/head-tree.z`).text();
const allPaths = await Bun.file(`${analysisDir}/all-paths.z`).text();

const historyPathByOid = new Map();
for (const line of revList.trimEnd().split("\n")) {
  const separator = line.indexOf(" ");
  if (separator !== -1) {
    historyPathByOid.set(line.slice(0, separator), line.slice(separator + 1));
  }
}

const currentByPath = new Map();
for (const entry of headTree.split("\0")) {
  if (entry.length === 0) {
    continue;
  }
  const tab = entry.indexOf("\t");
  if (tab === -1) {
    throw new Error(`Malformed ls-tree entry: ${entry}`);
  }
  const metadata = entry.slice(0, tab).split(" ");
  const oid = metadata[2];
  if (oid === undefined) {
    throw new Error(`Missing object ID: ${entry}`);
  }
  currentByPath.set(entry.slice(tab + 1), oid);
}

const totals = new Map([
  ["live-tip", 0],
  ["superseded-at-tip", 0],
  ["deleted-at-tip", 0],
]);
const deletedObjects = [];

for (const line of sizeList.trimEnd().split("\n")) {
  const [oid, type, diskSizeText] = line.split(" ");
  if (oid === undefined || type === undefined || diskSizeText === undefined) {
    throw new Error(`Malformed cat-file entry: ${line}`);
  }
  if (type !== "blob") {
    continue;
  }
  const path = historyPathByOid.get(oid);
  if (path === undefined) {
    throw new Error(`Reachable blob has no rev-list path: ${oid}`);
  }
  const diskSize = Number.parseInt(diskSizeText, 10);
  if (!Number.isSafeInteger(diskSize)) {
    throw new Error(`Invalid disk size for ${oid}: ${diskSizeText}`);
  }

  const category =
    currentByPath.get(path) === oid
      ? "live-tip"
      : currentByPath.has(path)
        ? "superseded-at-tip"
        : "deleted-at-tip";
  const priorTotal = totals.get(category);
  if (priorTotal === undefined) {
    throw new Error(`Unknown category: ${category}`);
  }
  totals.set(category, priorTotal + diskSize);
  if (category === "deleted-at-tip") {
    deletedObjects.push({ diskSize, oid, path });
  }
}

const historicalPaths = new Set(allPaths.split("\0").filter((path) => path.length > 0));
const deletedPaths = [...historicalPaths]
  .filter((path) => !currentByPath.has(path))
  .sort((left, right) => left.localeCompare(right));
deletedObjects.sort((left, right) => right.diskSize - left.diskSize);

const bytes = Object.fromEntries(totals);
const mebibytes = Object.fromEntries(
  [...totals].map(([category, size]) => [category, Number((size / 1024 / 1024).toFixed(2))]),
);
await Bun.write(`${analysisDir}/summary.json`, `${JSON.stringify({ bytes, mebibytes }, null, 2)}\n`);
await Bun.write(`${analysisDir}/deleted-at-tip-paths.txt`, `${deletedPaths.join("\n")}\n`);
await Bun.write(
  `${analysisDir}/deleted-at-tip-objects.tsv`,
  `${deletedObjects.map(({ diskSize, oid, path }) => `${diskSize}\t${oid}\t${path}`).join("\n")}\n`,
);
console.log(`Analysis written to ${analysisDir}`);
BUN

cat "$analysis_dir/summary.json"
```

`deleted-at-tip-paths.txt` is the canonical input inventory for the Phase-2 delete review;
`deleted-at-tip-objects.tsv` ranks representative deleted paths by reachable disk cost. Review both, select the
intended targets into an external `--paths-from-file` input, and retain the pre/post `summary.json` files with the
maintenance evidence. Do not rely on an uncommitted `scratchpad` script.

## Verification

The rewrite must change **history weight only, never working-tree content**:

1. **Tip-tree identity (primary oracle):** before filtering, write the tree hashes for `main`, every retained head,
   and every affected retained tag to an external manifest (outside the disposable clone). After all per-ref
   restorations, require `git rev-parse <ref>^{tree}` to equal the recorded hash for each retained ref. Comparing
   hashes remains executable after `filter-repo` expires reflogs and garbage-collects old objects; a
   `git diff <old-commit> <new-commit>` inside the rewritten clone does not. Any mismatch means a mistargeted path or
   missing per-ref restore; abort and fix.
2. **Complete-history identity:** every recovered local head/tag object ID must equal its post-filter recovery
   manifest entry. This guards against a replay that restores a correct tip tree while reintroducing filtered
   intermediate blobs.
3. **Signature disposition recorded:** cross-reference the pre-filter signature inventory with filter-repo's
   commit-map, record the number of rewritten signed commits, and attach the owner's explicit loss acceptance or the
   approved new-signature policy. Verify every retained signed tag was re-signed.
4. **Build/verify green** on the rewritten clone: `bun install --frozen-lockfile && bunx turbo run generate && bun run verify`.
5. **Size delta measured:** rerun the committed procedure above; compare its pre/post `summary.json` and target
   inventories. Reachable size should drop ~250 MB, adjusted for every retained affected head or tag.
6. **Backup retained** after cutover as disaster evidence. Direct mirror rollback is allowed only while writers remain
   frozen; after unfreeze, the preservation workflow below is mandatory.

## Rollback

The Phase-1 mirror backup is the anchor for rollback **during the still-frozen cutover window**. Capture the current
remote manifest with `git ls-remote --refs` and verify it matches the accepted post-publish cutover manifest with no
later writer changes. From the mirror backup, generate one refspec array covering **every** operator-controlled
namespace: the backup's `<ref>:<ref>` updates plus `:<ref>` deletions for controlled refs that exist only in the
rewritten remote. Dry-run the rollback transaction:

```bash
git push --atomic --force --dry-run git@github.com:shepherdjerred/monorepo.git "${rollback_refspecs[@]}"
```

Then run the identical atomic transaction without `--dry-run`. Never put `<backup-path>` in the destination position
of `git push`: that would overwrite the rollback anchor rather than restore GitHub. Never omit a namespace, split
deletions into a second push, or do a `main`-only rollback; any of those creates the mixed state this plan forbids.
After the remote transaction, force-fetch its restored heads/tags/custom refs, import the pre-cutover local bundle
under a reserved rollback namespace, and reset every clean worktree branch—including `main`—to its exact saved
pre-cutover object ID. Restore every retained local-only tag, then restore the exact saved `refs/spice/data` object
with `git update-ref`. Verify the local head/tag manifest, worktree mapping, `git-spice log long --all`, and every stack
base against restored `main`; remove the reserved rollback refs only after those checks pass. Keep writers frozen
until remote refs, local refs, git-spice state, CI, and fresh clones all match the pre-cutover backups.

After writers have been unfrozen, **never** force-push the Phase-1 mirror directly. A post-unfreeze rollback is a new
coordinated migration: freeze writers again; create and verify a second mirror of the current rewritten remote; diff
every controlled ref against the accepted cutover manifest; create a second durable bundle of current local
heads/tags and `refs/spice/data`; preserve every new remote or local commit, branch, and tag; and translate the
post-cutover changes onto the Phase-1 graph. Reconstruct feature stacks through git-spice, recreate tags with their
metadata/signatures, and verify every translated ref's tree oracle before building one atomic rollback refspec array.
If any post-cutover remote or local ref cannot be preserved exactly, abort rollback rather than discard new work.

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
- GitHub-owned pull-request refs may retain non-sensitive large files indefinitely; no Support cleanup is assumed.

## Session Log — 2026-07-25 (P1 review fixes)

### Done

- Fixed 2 P1 findings from a Codex substitute review (Greptile credit-paused): (1) Phase 3's publish step now
  force-pushes **every** rewritten ref (`refs/heads/*` + `refs/tags/*`, 18 heads + 311 tags), not just `main`, with
  explicit deletion of retired refs and a `git ls-remote` + fresh-clone verification step; the Rollback section
  mirrors the same all-refs push. (2) Phase 3 stopped relying on `git-spice repo sync --restack`, which cannot repair
  branches after an unrelated trunk rewrite. A later review also showed that replaying the original branch commits
  can resurrect filtered blobs; the current procedure therefore imports exact post-filter local refs and rebuilds
  git-spice metadata without restacking. Also confirmed via `git-filter-repo --help` that its default
  (non-`--partial`) run already does a mirror-like fetch of all refs, so Phase 2's existing single-clone approach
  didn't need restructuring—only a clarifying note.

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
  and separating GitHub-owned `refs/pull/*` as outside operator control.

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

- GitHub-owned `refs/pull/*` remain outside operator control; Phase 4 treats their cleanup as unavailable.

## Session Log — 2026-07-25 (hosted Codex follow-up review)

### Done

- Addressed all 9 current-head follow-up findings: every affected retained tag now has an exact preservation oracle;
  every retained local/worktree branch must receive its filtered counterpart before unfreeze; local tags are
  force-synchronized; peeled tag pseudo-records are excluded from the manifest; recovery remains inside git-spice;
  dry-run scope no longer claims to exercise rulesets; Support cleanup is treated as unavailable; the exact
  history-analysis procedure is inline and reproducible; and direct rollback cannot discard post-cutover work.

### Remaining

- Execute Phases 0–4 only in a coordinated maintenance window with writers frozen through the accept-or-rollback
  decision.

### Caveats

- GitHub-owned `refs/pull/*` may retain the non-sensitive large files indefinitely.
- After writers unfreeze, rollback requires preserving and translating all post-cutover refs; the Phase-1 mirror
  cannot be pushed directly.

## Session Log — 2026-07-25 (hosted Codex local-state review)

### Done

- Addressed all 6 current-head findings: local branches now come from the same filter pass instead of replaying old
  patches; affected retained heads preserve delete targets; local-only/divergent tags are inventoried and bundled
  before pruning; rollback restores every local ref and exact git-spice state; the predecessor plan points to this
  runbook; and rewritten commit signatures require an explicit owner-approved disposition.

### Remaining

- Execute Phases 0–4 only after the remote and local ref manifests, pre-cutover bundle, post-filter recovery bundle,
  signature disposition, and rollback rehearsal are complete.

### Caveats

- Original signed-commit verification cannot survive changed commit objects unless a separate new-signature policy is
  designed and approved.
- Never recover a local branch by restacking its pre-rewrite commits; only its exact post-filter counterpart is safe.
