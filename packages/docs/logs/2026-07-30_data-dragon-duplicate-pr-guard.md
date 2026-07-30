---
id: log-data-dragon-duplicate-pr-guard-2026-07-30
type: log
status: complete
board: false
---

# Data Dragon Duplicate PR Guard

User reported getting two open PRs with the identical title
`chore: update Scout Data Dragon to 16.15.1` (#1827 opened 2026-07-29, #1856
opened 2026-07-30).

## Root cause

`runScoutDataDragonUpdate` (`packages/temporal/src/workflows/data-dragon.ts`)
only skips work when `mode === "version-check" && !state.updateRequired`. It
never checks whether a PR for the same target version is already open. Since
PR #1827 stayed unmerged (first a snapshot-staging bug, then the `liskov`
Buildkite worker outage blocking CI), the next day's
`scout-data-dragon-version-check` schedule saw the same
`16.14.1 -> 16.15.1` gap (main is still pinned at 16.14.1 until a bump PR
merges) and opened a second PR, #1856, with a fresh random-suffixed branch
(`branchName()` embeds a random id, so nothing about the branch name
collides).

## Fix

Add a pre-flight check in `updateDataDragon`
(`packages/temporal/src/activities/data-dragon.ts`): before cloning/building
anything, list open PRs via `gh pr list` and skip (recording
`reason: "pr-already-open"`) if one already matches. This also saves the
~minutes-long clone/build/test cycle when a duplicate would otherwise be
pointless work.

Matching is deliberately strict so the guard can't be poisoned or miss the
real PR (both raised in Codex review of #1857):

- **Provenance, not just title.** This is a public repo, so anyone can open a
  fork PR with the predictable title `chore: update Scout Data Dragon to
<version>` and wedge the schedule into `pr-already-open` forever, silently
  leaving Scout data stale. `findExistingDataDragonPrUrl` therefore requires the
  exact title **and** a same-repository head (`!isCrossRepository`) **and** a
  head branch on the automation's own `chore/scout-data-dragon-<version>-*`
  convention — a branch only a write-access actor (the app bot or a maintainer)
  can push.
- **No `--limit` blind spot.** `listOpenDataDragonPrs` narrows the `gh pr list`
  search server-side (`--search 'in:title "Scout Data Dragon"'`) so the fixed
  `--limit 100` can never truncate away the real match when the repo has many
  open PRs; exact-version + provenance matching runs on that small set.

## Session Log — 2026-07-30

### Done

- Diagnosed the duplicate: no dedup guard in the Temporal Data Dragon
  updater; confirmed via `gh pr view`/`gh pr checks` on #1827 and #1856.
- Diagnosed why #1827 never merged: CI-wide `bun install` failure
  (`Unexpected accessing temporary directory. Please set $BUN_TMPDIR or
$BUN_INSTALL`) reproducing on `main`'s own CI (build #7324), traced to jobs
  scheduled on the `liskov` Buildkite agent node — the same node that had a
  NodeShutdown outage on 2026-07-29
  ([liskov-torvalds-health-check](2026-07-29_liskov-torvalds-health-check.md)).
  Launched a background diagnostic agent on Liskov's current state; this is
  tracked separately from the PR-duplication bug.
- Implemented `findExistingDataDragonPrUrl` / `dataDragonPrTitle` /
  `dataDragonBranchPrefix` / `listOpenDataDragonPrs` in `data-dragon-util.ts`
  and wired the pre-flight check into `updateDataDragon`; added unit tests
  (incl. fork-spoof and off-convention-branch rejection); `typecheck`/`test`/
  `lint` all green for `@shepherdjerred/temporal`.
- Opened [#1857](https://github.com/shepherdjerred/monorepo/pull/1857) with
  the fix from worktree `.claude/worktrees/data-dragon-pr-dedupe` via
  git-spice.
- Closed #1856 as a duplicate (commented linking to #1827 and #1857), keeping
  #1827 (already has the ranked-snapshot repair applied) as the surviving
  bump PR.
- Background Liskov diagnostic returned: node is `Ready`, no disk/PVC/OOM
  issues, all Buildkite CI is hard-pinned to `liskov` (single-node queue, no
  fallback). The exact `bun install` "Unexpected accessing temporary
  directory" failure mechanism could not be pinned — the failed job pods
  were already garbage-collected by the time of the investigation. Not
  fixed in this session; needs a live repro (`kubectl exec` into a job pod
  during `bun install` to inspect `mount`/`env`) next time it recurs.

### Remaining

- [ ] Debug the Liskov CI `bun install` temp-directory failure live (needs a
      currently-failing job pod, not a post-mortem). This blocks #1827
      (and any other PR) from merging until resolved.
- [ ] Once CI is green, merge #1827 and delete its branch.

### Caveats

- This fix (#1857) does not address the CI outage blocking #1827 from
  merging — that is a separate root cause, tracked here as remaining work.
