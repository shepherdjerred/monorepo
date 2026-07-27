---
id: repo-history-slim
type: plan
status: complete
board: false
---

# Slim the monorepo git history

## Safety Contract

This is a one-time destructive history rewrite. Preparation and rehearsal are non-destructive. The real atomic push
must not run until the owner gives a separate, explicit cutover confirmation after reviewing the frozen manifests and
rehearsal report.

The cutover must satisfy all of these invariants:

- The `main` tip tree is byte-identical before and after the rewrite.
- Every branch with an open pull request is cleanly restacked onto frozen `main` before capture, then keeps its exact
  frozen tip tree and equivalent reviewed branch patch on rewritten `main`.
- Every GitHub Release keeps its tag name and exact source tree.
- Every other local or remote branch is retired. The old clone remains an offline rollback artifact until acceptance.
- No repository writer or deployment-capable automation runs between manifest capture and accept-or-rollback.
- Every remote ref update or deletion is one atomic, lease-protected transaction.
- The rewritten repository is adopted through a fresh clone, not by repairing the large shared clone in place.

## Owner Decisions

Recorded 2026-07-27:

- Keep the aggressive, one-time cleanup model. Generated artifacts remain committed and may regrow afterward.
- Preserve all 314 lightweight release tags with exact tip trees. Historic source archives must remain tree-identical.
- Migrate `main` and branches with open PRs. Discard every other local and remote branch.
- Cancel the rewrite after rehearsal showed exact release-tree preservation saves at most 5.29%.
- Accept loss of existing commit signatures and GitHub Verified status for rewritten commits.
- Keep `sandbox/archive/*` and the live `champion-splash/` assets. Neither is a rewrite target.

## Reconciled Snapshot

This 2026-07-27 snapshot is evidence, not the cutover manifest. Recompute every value after writers freeze.

- Rehearsal source `main`: `058f4b44cbd6f046e054b1e232b3e270af5e6e0d`.
- PR #1642 was last synchronized at `265ab686a9f99ea7097b04c3d7847dc809b3e39f`; the branch was restacked through
  `8202ff6ae5c70d94e9c600216477bfe8519baf05`. The one later `main` commit was separately inspected, does not touch a
  rewrite target, and leaves the PR mergeable.
- Remote controlled refs: 13 heads, 314 tags, and one `refs/renovate/*` ref.
- GitHub-owned refs: 1,601 `refs/pull/*` refs.
- Open PRs: 11; none currently report a merge conflict.
- Every one of the 314 tags is lightweight and backs one of 314 GitHub Releases.
- Local state: 1,253 refs, including 666 local branches, 100 `refs/codex/*`, 148
  `refs/conductor-checkpoints/*`, 8 `refs/prfleet/*`, and `refs/spice/data`; 9 registered worktrees, one detached;
  no stash at observation time.
- Active GitHub push webhooks: Buildkite and `pr-bot.sjer.red`.
- Active `main` ruleset `11098884` blocks deletion and non-fast-forward pushes, requires linear history and the
  `ci/merge-conflict` plus `buildkite/monorepo/pr` statuses, and reports that the current administrator can bypass it.
- Tool versions: Git 2.54.0, git-filter-repo commit `a40bce548d2c`, git-spice 0.31.2, Bun 1.3.14, mise 2026.7.13.

`champion-splash/` was incorrectly classified as deleted in the original plan. It is live and consumed by Scout:

| Live generated target                       | Files |  Tip bytes | Rewrite policy                         |
| ------------------------------------------- | ----: | ---------: | -------------------------------------- |
| `data-dragon/assets/img/champion-splash/`   |   173 | 16,042,046 | retain unchanged; never filter         |
| `data-dragon/assets/img/champion-loading/`  |   173 |  8,077,752 | collapse history; restore current tree |
| `frontend/public/generated/scout-showcase/` |    22 | 51,589,019 | collapse history; restore current tree |
| report `**/__snapshots__/`                  |    35 | 51,227,003 | collapse history; restore current tree |

The old `~250 MB` reclaim estimate is invalid. In particular, report snapshots now contain about 51 MB at tip rather
than 5 MB, and exact release-tag restoration intentionally retains historical target versions. The rehearsal's fresh
clone and mirror-clone measurements are the only accepted savings estimate.

## Approved Filter Scope

The only approved inputs are:

- `packages/docs/archive/completed/2026-07-25_repo-history-slim-collapse-paths.txt`
- `packages/docs/archive/completed/2026-07-25_repo-history-slim-delete-paths.txt`

The split encodes the different tip-state contracts. Every collapse target must exist at frozen `main`; every delete
target must be absent. `champion-splash/` is absent from both files by design.

At frozen-manifest capture:

1. Copy both committed files outside the shared and rewrite clones.
2. Record both SHA-256 values and the source commit in the maintenance manifest.
3. Evaluate every literal/glob against frozen `main`; require at least one match for each collapse entry and zero
   matches for each delete entry.
4. Pass both files unchanged to `git filter-repo --paths-from-file`.
5. Abort and restart review, backup, and rehearsal if any path is added or removed. There is no execution-time search
   for "other large files" and no scope expansion during cutover.

## Go/No-Go Gates

All boxes must be complete before the real push:

- [x] PR #1640 merged; champion-loading now contains only 173 base splash files.
- [x] Release-tag policy recorded: preserve all names and exact trees.
- [x] Branch policy recorded: keep only `main` plus branches with open PRs.
- [x] Signature policy recorded: accept loss of original commit verification.
- [ ] Merge this runbook PR so the approved path file is present on `main`.
- [ ] Pick a maintenance window and publish a notice to all clone users.
- [ ] Merge/close or cleanly restack every open PR onto `main`; freeze with zero conflicting or behind branches. Every
      retained PR must be same-repository and target `main` or another retained parent branch.
- [x] Complete the no-push core rehearsal for `main`, all release tags, filter paths, ref retirement, pruning, fsck, and
      clean clone measurements.
- [ ] Review the measured 5.29% maximum reduction under exact release-tree preservation and decide whether to cancel
      the rewrite or allow historical release source trees to change.
- [ ] If continuing, produce a full rehearsal from a new freeze after retained PR branches are cleanly restacked.
- [ ] Verify an off-host remote mirror, an off-host local-state mirror, exported GitHub metadata, and restoration tests.
- [ ] Confirm all worktrees are clean and all repository writers are paused.
- [ ] Receive a separate explicit owner instruction to execute the cutover.

## Phase 1: Freeze And Capture

### 1. Quiesce writers

Pause or disable every source that can change repository refs or react to the forced update:

- Disable the Buildkite and `pr-bot.sjer.red` GitHub push webhooks. Save their complete hook JSON first so `active`
  state can be restored exactly.
- Cancel or finish every Buildkite build and prevent manual or scheduled builds. A forced `main` update makes the
  prior-green SHA unavailable or non-ancestral; `.buildkite/scripts/ci-changed.sh` then deliberately runs every lane.
  Current main lanes can push images/packages/charts, deploy sites, apply Tofu, sync ArgoCD, cut releases, mint tags,
  and open version commit-back PRs. Do not let ordinary main CI observe the cutover push.
- Pause Renovate for the repository and verify no hosted run is active.
- Pause these Temporal schedules in the live Temporal UI and verify no workflow from them is running:
  `homelab-crd-imports-daily`, `dpp-pokeemerald-data-daily`, `scout-data-dragon-version-check`,
  `scout-data-dragon-weekly-refresh`, `readme-refresh-weekly`, `llm-catalog-refresh-weekly`,
  `scout-season-refresh-weekly`, and `scout-showcase-refresh-weekly`.
- Capture and disable every open PR's `autoMergeRequest` before manifest capture.
- Record the Temporal worker's desired replica count, scale the worker to zero, and wait for all running
  GitHub-mutating activities to stop. Explicitly inspect scheduled, signal-started, and event-started workflows,
  including `prBabysitWorkflow`; pausing only the eight schedules above does not stop durable in-flight executions.
- Record the Birmel deployment's desired replica count and scale it to zero. Its repository editor can create and push
  branches with user OAuth independently of the GitHub webhooks and Temporal schedules.
- Inventory installed GitHub Apps in the repository settings UI because the current API token cannot enumerate them.
  Confirm that every app capable of pushing refs is disabled, paused, or rendered unable to execute during the freeze.
- Stop local agents, IDE Git integrations, release jobs, and shell jobs that can commit, fetch-and-push, create tags,
  or open PRs.
- Keep the freeze in place through backup, rewrite, publish, fresh-clone adoption, validation, and accept-or-rollback.

Record a checklist owner and prior state for every disabled integration. A generic "automation paused" note is not
sufficient recovery evidence.

### 2. Capture remote and GitHub state

Store all artifacts outside the repository:

- `git ls-remote --refs origin`, captured twice after the freeze, with byte-identical output.
- Controlled-ref disposition:
  - Retain `main`.
  - Retain exactly the heads of PRs that are open at freeze time.
  - Retain all release tags with exact tree oracles.
  - Retire every other `refs/heads/*` and every controlled custom namespace, including `refs/renovate/*`.
- For each open PR: head repository, base/head names and OIDs, draft/review/auto-merge state, unresolved threads,
  checks, comments, reviews, and stable patch IDs for its branch-only commits and three-dot diff. Retain only
  same-repository PRs whose base is frozen `main` or another retained parent; close or retarget every unsupported PR.
- For each release: tag, target OID, release metadata, and asset metadata.
- Rulesets, repository hooks, repository settings, collaborators, and the authenticated push identity.
- The advertised `refs/pull/*` count. These GitHub-owned refs are evidence only and are never publication inputs.

### 3. Capture tree and signature oracles

Save outside the rewrite clone:

- `<ref> <ref^{tree}>` for `main`, every retained open-PR head, and all 314 release tags. Also record path modes and
  blob OIDs for every retained head so binary and mode changes cannot hide behind patch-ID equivalence.
- The complete content of every approved filter path at each distinct retained tree. Deduplicate identical trees, not
  refs. An absent path is a meaningful oracle.
- `git log --all --format='%H%x09%G?'` and the final count of signed commits. The owner has accepted that changed commit
  objects lose those signatures; preserve this inventory as provenance evidence.
- Parent/topology, branch-only commit, and patch-ID manifests for every retained open-PR head. Every retained branch
  must already be based directly or through its recorded stack on frozen `main`; a conflicting or behind branch is a
  no-go condition.

### 4. Back up remote and local state

- Create a frozen `git clone --mirror` of the remote on storage outside the repo and copy it off-host.
- Compare every controlled ref and OID with the frozen remote manifest.
- Anchor every detached worktree HEAD and stash under uniquely named backup refs in a local backup source. Then create
  a second mirror containing every local ref and anchor, including `refs/spice/data`, and copy it off-host.
- Save `git worktree list --porcelain`, `git-spice log short --all --json`, the exact `refs/spice/data` OID, dirty-state
  checks, and the local-ref manifest.
- Verify both mirrors with `git fsck --full`, record checksums, and restore each into a disposable clone.
- Do not migrate local-only branches. They are intentionally discarded after acceptance, but remain available only
  in the offline local-state backup during the rollback window.

## Phase 2: Rehearse The Rewrite

Run the complete procedure in disposable clones before scheduling cutover. Rehearsal must not push to GitHub.

### 1. Build one complete rewrite source

Clone the frozen remote into a fresh working clone. Fetch every controlled namespace from the frozen manifest into a
same-named local ref. Do not fetch `refs/pull/*`. Remove `origin` before filtering so git-filter-repo cannot normalize
or prune imported refs.

Import additional retained local state, if any, with `git fetch <bundle-or-mirror> <source>:<reserved-ref>`. Do not use
`git bundle unbundle` as if it installs renamed refs; it only verifies/imports objects and prints offered refs.

Pin and record the exact Git, git-filter-repo, git-spice, Bun, and mise versions. Verify both approved path-file hashes
and their collapse/delete preconditions, then run exactly one filter pass:

```bash
git filter-repo --force --invert-paths \
  --paths-from-file /absolute/path/to/frozen/repo-history-slim-collapse-paths.txt \
  --paths-from-file /absolute/path/to/frozen/repo-history-slim-delete-paths.txt
```

Do not pass `--partial` or `--refs`; every retained controlled ref must be filtered in the same pass.

### 2. Restore retained trees

- Fetch the frozen backup refs into a temporary, never-published namespace so their original tree objects are
  available. Use git-filter-repo's commit map to pair each original target with its filtered target.
- Create restored `main` with `git commit-tree <original-main-tree> -p <filtered-main>`, using the exact original full
  tree and message `chore(root): re-add current generated artifacts after history slim`. This guarantees tip-tree
  identity while retaining only one current copy of each collapse target.
- Re-parent every retained open-PR head onto restored `main`, or its restored open-PR parent if a stack exists at
  freeze time. Process parent-first. Rebase only already-filtered branch-only commits from this rewrite clone; never
  replay commits from the pre-rewrite graph. Restore any approved path whose reviewed branch patch intentionally
  changes it.
- Verify each retained head's branch-only patch IDs and reviewed three-dot diff. Any unexpected patch change or
  conflict is a failed rehearsal; also require its complete tip tree, path modes, and blob OIDs to equal the frozen
  oracle. Resolve any mismatch on the normal graph, refresh the freeze, and start over.
- For every release tag, create an exact-tree envelope with
  `git commit-tree <original-tag-tree> -p <post-filter-tag-ref-target>` and move the lightweight tag to that commit.
  Capture each tag's actual post-filter ref target before moving it and require that target to be a commit; a commit-map
  entry may be zero when filtering prunes an empty commit and is audit evidence only. Deduplicate
  identical `(filtered parent, original tree)` pairs so tags that shared a target still share one restoration commit.
  This intentionally retains each distinct release-tip tree without retaining its pre-rewrite ancestry. Verify all
  314 tag tree hashes. Do not convert lightweight tags into annotated tags.
- Delete every retired head/custom ref from the rewrite clone. Delete all temporary backup refs before measurement.
- Expire temporary-ref reflogs and garbage-collect before measuring so fetched pre-rewrite ancestry is no longer an
  accidental root. Save git-filter-repo's commit map and a rewritten-ref manifest.

All retained heads must be re-parented even when their own target paths were unchanged. Otherwise they remain based on
pre-restoration `main` and their PRs show the restored directories as additions. Exact head-tree identity is feasible
and required because every retained branch was restacked onto the same frozen `main` before oracle capture; any later
restack invalidates the manifests and restarts rehearsal.

### 3. Rehearsal acceptance tests

- `main`, every retained open-PR head, and all retained release-tag tree hashes equal their pre-filter oracles.
- All retained open-PR branch patches, path modes, and blob OIDs equal their pre-filter manifests.
- Every retired controlled ref is absent.
- The approved delete paths are absent from `main` and retained PR-head history. Exact release trees may intentionally
  contain them at release-tag tips.
- Collapse targets have only the approved restored versions on `main` and retained PR histories.
- Known first-affected pre-rewrite commit IDs fail `git cat-file -e` after temporary refs/reflogs are removed and GC
  runs in the rehearsal clone.
- `bun install --frozen-lockfile`, `bunx turbo run generate`, and `bun run verify` pass in the rewritten clone.
- A normal fresh clone and a mirror clone complete successfully. Record transferred pack bytes and `.git` size for
  pre/post comparison. Do not infer clone cost from `objectsize:disk` alone.
- Every release tag resolves to its expected tree and every saved release asset remains listed.
- Reconstruct git-spice metadata in a disposable clone by tracking retained branches parent-first. Verify existing PR
  associations can be rediscovered without changing any branch OID or pushing.
- Produce a signed-off rehearsal report containing all manifests, tool versions, timings, and measured savings.

## Phase 3: Cut Over

Repeat Phase 1 from a new freeze. The real manifest and backup must be current; rehearsal artifacts are not substitutes.

### 1. Guard the atomic publication

Create a separately named push remote because `origin` was deliberately removed before filtering:

```bash
git remote add publish git@github.com:shepherdjerred/monorepo.git
git remote set-url --push publish git@github.com:shepherdjerred/monorepo.git
```

Verify the `publish` fetch/push URLs and authenticated bypass identity. Immediately before both dry-run and real push:

1. Capture `git ls-remote --refs publish` again.
2. Require exact equality with the frozen remote manifest. Any new or changed ref aborts the cutover.
3. Reconfirm every integration remains disabled and no Buildkite/Temporal/Renovate job is active.
4. Verify the exact SSH or HTTPS push identity reports administrator bypass for ruleset `11098884`.
5. Run a full-history secret scan of the rewritten controlled refs so push protection cannot surprise the transaction.

Generate one refspec and one explicit lease per frozen controlled ref:

- Retained update: `<rewritten-ref>:<remote-ref>` plus `--force-with-lease=<remote-ref>:<frozen-oid>`.
- Retired deletion: `:<remote-ref>` plus `--force-with-lease=<remote-ref>:<frozen-oid>`.

Do not use blanket `--force`. Dry-run, recapture and compare the remote manifest once more, then run the identical
transaction without `--dry-run`:

```bash
git push --atomic --dry-run publish "${lease_args[@]}" "${publish_refspecs[@]}"
git push --atomic publish "${lease_args[@]}" "${publish_refspecs[@]}"
```

`origin` must not be assumed to exist anywhere in the final guard or publication. A policy rejection must leave all
refs unchanged. Never split deletions or namespaces into later pushes.

### 2. Verify GitHub before touching the old clone

- Compare every controlled remote ref and OID against the accepted rewritten manifest.
- Confirm retired heads/custom refs are absent and every retained release tag resolves to its exact tree.
- Fresh-clone into a new directory and repeat the rehearsal acceptance tests.
- Confirm all retained PRs still show the saved diff, comments, reviews, and base/head names. Force-updated heads must
  receive fresh checks and provider reviews; old clean-review reactions are not accepted for the new head timestamp.
- Keep ordinary Buildkite main CI disabled. Run the full local verification surface in the fresh clone instead.

### 3. Adopt a fresh local clone

Do not reset or prune the old shared clone in place.

1. Ensure every worktree in the old clone is clean.
2. Disable its push URL and rename the entire clone as a read-only rollback artifact.
3. Create a fresh clone at the normal workspace path from rewritten GitHub.
4. Check out only `main` and retained open-PR branches.
5. Initialize git-spice and track retained branches parent-first using the frozen topology manifest.
6. Verify each local branch against the post-rewrite manifest, every PR association, and `git-spice log long --all`.
7. Keep the old clone and both off-host mirrors until final acceptance. Do not copy discarded local-only branches or
   custom checkpoint refs into the fresh clone.

### 4. Accept and unfreeze

- Purge and reseed Buildkite's persistent Git mirrors while Buildkite remains disabled; verify checkouts resolve the
  rewritten OIDs.
- Restore Birmel and Temporal worker replica counts, then re-enable integrations from the saved inventory in a
  controlled order: PR bot, Temporal schedules, Renovate, then Buildkite. Confirm each prior active state exactly.
- Explicitly trigger a fresh provider review and verify-only Buildkite PR run for every retained rewritten head;
  disabled webhooks do not replay missed synchronize events. Verify each result is attached to the rewritten OID. Do
  not use an ordinary `main` push as the first CI test because main includes deployment and publication lanes.
- Restore each saved PR auto-merge request only after that rewritten head's required checks and fresh review pass.
- Observe one normal post-cutover PR and one later normal main build before closing maintenance.
- Retain the remote and local backups for the agreed evidence window. Delete the old clone only after that window and
  after the explicit accept decision.

## Rollback

Rollback is allowed directly only while writers remain frozen and the remote still equals the accepted cutover
manifest.

1. Compare the live remote manifest with the accepted rewritten manifest. Any later change aborts direct rollback.
2. From the frozen remote mirror, generate updates/deletions for every controlled namespace and explicit leases against
   the rewritten OIDs.
3. Dry-run and then execute one atomic lease-protected transaction. Never force only `main`.
4. Verify the restored remote manifest, ruleset behavior, release tags, and fresh clone.
5. Purge and reseed every Buildkite persistent Git mirror from the restored remote; verify pre-cutover OIDs before
   allowing any checkout.
6. Restore the old clone path and its exact saved push configuration only after remote verification.
7. Restore hooks, Birmel/Temporal worker replicas, Temporal schedules, PR auto-merge state, Renovate, and Buildkite
   from the saved pre-cutover state.

After any writer is unfrozen, the original mirror cannot be pushed directly. A later rollback is a new migration that
must preserve every post-cutover commit/ref first.

## GitHub Storage Expectations

GitHub-owned `refs/pull/*` cannot be rewritten by the operator. Open PR head refs normally move with their source
branches, while closed and historical PR refs can retain the rejected graph. GitHub Support cleanup is intended for
sensitive-data removal, not this non-sensitive size optimization. Server-reported repository size may therefore stay
large even when normal clones improve. Acceptance is based on fresh-clone transfer/size and retained-ref correctness,
not GitHub's storage meter.

## Core Rehearsal - 2026-07-27

The no-push rehearsal used the push-disabled clone `~/git/monorepo-history-rewrite` and frozen source mirror
`~/git/monorepo-history-rewrite-source.git` at `058f4b44cbd6f046e054b1e232b3e270af5e6e0d`. The source mirror contained
13 controlled heads, 314 lightweight release tags, one Renovate ref, and 1,601 excluded GitHub pull refs.

The local harness imported only controlled refs, ran the two approved filter files, restored exact `main` with
`git commit-tree`, and tested both tag policies. It never had a working push remote.

| Rehearsal result                      | Fresh-clone pack |           Reduction | Release tag trees    |
| ------------------------------------- | ---------------: | ------------------: | -------------------- |
| Baseline                              |       658.09 MiB |                   - | 314 exact            |
| Preserve exact release trees          |       623.29 MiB |   34.80 MiB (5.29%) | 314 exact            |
| Keep tags but filter historical trees |       424.82 MiB | 233.27 MiB (35.45%) | 3 exact, 311 changed |

Exact release preservation required 179 deduplicated tree-envelope commits and retained 198.47 MiB that the relaxed
variant removed. Reintroducing the 11 open-PR heads can only reduce the exact-policy savings further, so 34.80 MiB is
an upper bound for the selected policy, not the final expected gain.

Both variants passed the applicable core assertions:

- `main` tree identity was exact; all 173 live `champion-splash` files remained.
- Collapse targets had one restored version in `main` history; delete targets were absent from `main`.
- All 314 tag names remained lightweight commit refs. The exact-policy variant matched every original tag tree.
- Non-main heads and the Renovate ref were retired in the disposable result.
- Temporary original refs/reflogs were removed, the original `main` commit was pruned, and `git fsck --full` passed.
- Normal and mirror clones of the exact-policy result both measured 623.29 MiB.

The open-PR reparenting phase was deliberately not run. The exact-tag result fails the plan's value gate before that
coordination cost is justified.

## Disposition

On 2026-07-27, the owner canceled the rewrite while retaining the exact-release-tree requirement. The measured 5.29%
maximum reduction does not justify the destructive migration. The relaxed 35.45% variant was rejected because it
would change 311 historical release source trees.

## Remaining

- None. The rewrite is canceled and no cutover authorization was issued.

## Prior Work

The 2026-07-25 plan established the aggressive rewrite, all-ref publication, exact tree oracles, local recovery,
signature inventory, and atomic rollback requirements through multiple hosted reviews. The 2026-07-27 reconciliation
supersedes its stale counts and recovery strategy after `main` added 33 commits and the shared clone grew beyond 1,200
refs. It also corrects the live `champion-splash/` deletion bug and the deployment-capable CI freeze gap.

## Session Log - 2026-07-27

### Done

- Restacked PR #1642 onto `main` at `8202ff6ae5c70d94e9c600216477bfe8519baf05`.
- Re-audited remote refs, release tags, open PRs, local reachability roots, rulesets, webhooks, scheduled writers, tool
  versions, and target tip trees.
- Recorded owner policy for release tags, branch retention, and signature loss.
- Replaced the stale runbook with the freeze/rehearsal/cutover procedure above and added the immutable approved path
  files `packages/docs/archive/completed/2026-07-25_repo-history-slim-collapse-paths.txt` and
  `packages/docs/archive/completed/2026-07-25_repo-history-slim-delete-paths.txt`.

### Remaining

- Run and review the complete no-push rehearsal before scheduling cutover.
- Merge PR #1642, choose a maintenance window, and explicitly authorize the destructive atomic push.

### Caveats

- Exact preservation of all 314 release-tag trees produced only a 34.80 MiB (5.29%) core reduction.
- GitHub-owned PR refs may retain old objects indefinitely.
- The actual history rewrite and force-push have not been run.

## Session Log - 2026-07-27 (core rehearsal)

### Done

- Created a frozen mirror plus push-disabled working clone under `~/git`.
- Implemented and ran the no-push core harness for exact and relaxed release-tag policies.
- Verified exact `main`/release trees, filter scope, ref retirement, old-ancestry pruning, fsck, and clean clones.
- Measured 658.09 MiB baseline, 623.29 MiB exact-tag result, and 424.82 MiB relaxed-tag result.

### Remaining

- Decide whether a maximum 5.29% reduction warrants the rewrite or whether historical release trees may change.
- Run PR-head migration rehearsal only if the policy/value decision allows cutover work to continue.

### Caveats

- Open PR heads were excluded from the core result; retaining them can only reduce the measured exact-policy savings.
- No GitHub refs, integrations, or existing development clones were modified.

## Session Log - 2026-07-27 (owner disposition)

### Done

- Recorded the owner's decision to cancel the history rewrite under the exact-release-tree policy.
- Closed and archived the runbook plus its frozen collapse/delete path manifests.
- Confirmed no destructive push, remote ref change, or development-clone rewrite occurred.

### Remaining

- None.

### Caveats

- The local push-disabled rehearsal clones and frozen source mirror remain under `~/git` for evidence or manual cleanup.
