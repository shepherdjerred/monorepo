---
id: log-2026-07-27-repo-history-slim-core-rehearsal
type: log
status: complete
board: false
---

# Repository History Slim Core Rehearsal

Ran the git-filter-repo core procedure in fresh, push-disabled clones under `~/git` without changing GitHub or the
existing development clone.

## Results

| Policy                          | Fresh-clone pack |           Reduction | Exact release trees |
| ------------------------------- | ---------------: | ------------------: | ------------------: |
| Baseline                        |       658.09 MiB |                   - |                 314 |
| Preserve exact release trees    |       623.29 MiB |   34.80 MiB (5.29%) |                 314 |
| Filter historical release trees |       424.82 MiB | 233.27 MiB (35.45%) |                   3 |

The exact-tree policy needed 179 deduplicated envelope commits and retained 198.47 MiB relative to the relaxed
variant. Since retained open-PR heads were not yet added, 34.80 MiB is an upper bound for that policy.

## Evidence

- Frozen source: `~/git/monorepo-history-rewrite-source.git` at
  `058f4b44cbd6f046e054b1e232b3e270af5e6e0d`.
- Exact result: `~/git/monorepo-history-rewrite` and `~/git/monorepo-history-rewrite-result`.
- Relaxed result: `~/git/monorepo-history-rewrite-relaxed` and
  `~/git/monorepo-history-rewrite-relaxed-result`.
- Harness and JSON evidence: `~/git/monorepo-history-rewrite/.history-rewrite/`.
- Both variants preserved exact `main`, retained all 173 champion splash files, removed the approved historical paths,
  retired non-main controlled refs, pruned the original main commit, and passed `git fsck --full`.
- The exact result preserved every tag tree and produced identical normal/mirror clone pack sizes.

## Session Log - 2026-07-27

### Done

- Created the fresh mirror, working, result, and comparison clones under `~/git`.
- Implemented and executed the core no-push filter/restoration harness.
- Measured both release-tag policies against independent fresh clones.

### Remaining

- Choose between canceling the rewrite under exact-tree preservation or accepting changed historical release trees.
- Rehearse open-PR branch migration only if continuing.

### Caveats

- The full cutover was not rehearsed because the selected exact-tag policy failed the value gate first.
- No remote refs were pushed or changed.

## Session Log - 2026-07-27 (owner disposition)

### Done

- Recorded the owner's decision to cancel the rewrite rather than change historical release trees.
- Archived the completed runbook and its frozen path manifests.
- Left GitHub refs and existing development clones unchanged.

### Remaining

- None.

### Caveats

- The local rehearsal clones remain under `~/git` for evidence or manual cleanup.
