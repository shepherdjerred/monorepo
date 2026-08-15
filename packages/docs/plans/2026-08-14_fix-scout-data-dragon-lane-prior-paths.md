---
id: plan-2026-08-14-fix-scout-data-dragon-lane-prior-paths
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Fix the Scout Data Dragon Temporal workflow

## Goal

Get `scout-data-dragon-version-check` and `scout-data-dragon-weekly-refresh` back to green,
and fix the misdirected lane-prior write those runs exposed.

## Context

`scout-data-dragon-version-check` failed every day from 2026-08-12, and
`scout-data-dragon-weekly-refresh` failed on 2026-08-08. Scout's Data Dragon assets sat at
**16.15.1** while Riot shipped **16.16.1**, and no update PR opened in between.

Both runs died at the same guard in `data-dragon.ts`:

```
Data Dragon update changed disallowed paths:
  bun.lock, packages/scout-for-lol/packages/backend/packages/
```

Two independent defects produced those two paths. The guard itself (added 2026-08-02 in
`a11391b06`) is correct — it is what finally surfaced a bug that had been silently
corrupting output for three months.

### Defect 1 — lane-prior artifacts written to the wrong directory

`data-dragon-lane-priors.ts` ran:

```
bun run --filter=./packages/backend generate-lane-priors -- \
  --output packages/scout-for-lol/packages/data/src/lane-priors/lane-priors.generated.json
```

`LANE_PRIOR_ARTIFACT_PATH` is repo-root-relative, but `bun run --filter` executes the script
with cwd set to the _filtered package_ — verified with a probe script: cwd is
`.../packages/scout-for-lol/packages/backend`. `generate-lane-priors.ts` writes with a plain
`Bun.write(config.output, …)`, which resolves against that cwd. So the artifact landed at
`…/backend/packages/scout-for-lol/packages/data/src/lane-priors/…`, and `git status
--porcelain` collapsed that untracked tree to `…/backend/packages/`.

`evaluate-lane-priors --artifact` read back the same wrong path, so the eval validated the
misplaced file and reported success. `lane-priors.generated.json` had exactly one commit in
its history (`f858db0a3`, 2026-05-17, its creation) — the automation never once updated it.

Before `a11391b06` this was silent: `git add -- <explicit paths>` never staged untracked
files, so the stray tree was simply ignored.

### Defect 2 — `bun install --force` rewrote `bun.lock`

`update-data-dragon.ts` ran a second root `bun install --force` inside `updateSnapshots()`.
Per `bun install --help`, `--force` means _"always request the latest versions from the
registry & reinstall all dependencies"_ — a dependency upgrade, which dirtied `bun.lock` once
a matching release landed between Aug 8 and Aug 12.

It was **vestigial**. Its commit (`399d3385f`, 2026-05-03) states it defeated a content-hashed
_copy_ at `node_modules/.bun/@scout-for-lol+data@…`. The isolated-linker migration
(`4f08817be`, 2026-07-15) replaced those copies with direct symlinks. Verified on the current
tree: `node_modules/.bun/` has zero scout entries, and `backend/node_modules/@scout-for-lol/data`
is a symlink to `../../../data`. Assets resolve via `new URL(relativePath, import.meta.url)`,
which follows the symlink into live source, so nothing needed reinstalling.
`packages/scout-for-lol/CLAUDE.md` already documents this ("no package-local reinstall is
needed").

### Failure timeline

| Date            | Result    | Cause                                              |
| --------------- | --------- | -------------------------------------------------- |
| Aug 1           | Completed | last run before the guard landed                   |
| Aug 2           | —         | guard introduced (`a11391b06`)                     |
| Aug 8 weekly    | Failed    | first run to execute the update path               |
| Aug 9–11 checks | Completed | version unchanged → early exit before the update   |
| Aug 12          | —         | Riot publishes 16.16.1                             |
| Aug 12–14       | Failed    | update path runs daily, trips the guard every time |

The other scout schedules were healthy: `scout-queue-windows` (Aug 11 one-off git failure),
`scout-season-refresh` (Jul 27, `claude -p` exit 1), and three Aug 3/Aug 5 `TimedOut` runs all
recovered on their own.

## What changed

| File                                                        | Change                                                                                                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `temporal/src/activities/data-dragon-lane-priors.ts`        | absolute `--output`/`--artifact` via new `lanePriorArtifactPath` / `lanePriorEvalReportPath`; post-generate existence assertion; owns the churn-revert helper |
| `temporal/src/activities/data-dragon.ts`                    | reverts `generatedAt`-only lane-prior churn before `changedFiles`; corrected the stale `BUN_INSTALL_CACHE_DIR` rationale                                      |
| `temporal/src/activities/scout-season-refresh-git.ts`       | new shared home for `isGeneratedAtOnlyDiff`, plus `revertGeneratedAtOnlyChanges`                                                                              |
| `temporal/src/activities/scout-showcase-refresh.ts`         | imports the helper from its new home                                                                                                                          |
| `scout-for-lol/packages/data/scripts/update-data-dragon.ts` | dropped `bun install --force`                                                                                                                                 |
| `temporal/scripts/rehearse-bot-clone.ts`                    | corrected canary #2's description and log strings                                                                                                             |
| `temporal/AGENTS.md`                                        | documented the `bun run --filter` cwd trap                                                                                                                    |

The two path constants deliberately stay repo-root-relative — they also feed `git add --` and
`dataDragonDisallowedChangePaths`, both of which compare against `git status --porcelain`
output. The absolute join happens only at the two `runCommand` sites.

### Timestamp churn

The lane-prior training window is pinned in `SCOUT_LANE_PRIOR_UPDATE_CONFIG`, so a corrected
run over unchanged S3 matches produces a diff of exactly two `generatedAt` stamps. Left alone
that would open a PR on every weekly refresh containing nothing else. `isGeneratedAtOnlyDiff`
already solved this for the marketing showcase, so it moved to the shared git module and the
Data Dragon activity now reverts stamp-only lane-prior changes before the allowlist, the PR
decision, or `git add` ever see them. Each path is diffed separately, so one file's real
change cannot mask another's pure churn.

## Verification

- `bunx turbo run typecheck lint test --filter=@shepherdjerred/temporal --filter=@scout-for-lol/data`
  — clean; 830 temporal tests pass.
- `bunx turbo run check:rehearsal --filter=@shepherdjerred/temporal` — canary #2 runs
  `update-data-dragon --snapshots-only` against a real repo copy, which is what proves the
  snapshot tests still pass with **no** install between the asset download and the tests
  reading them.
- Tests added: path flags are absolute and under `repoDir` (asserted as a property, not as a
  literal command array); the repo-relative constants never reach the CLI; the constants stay
  repo-relative; generation that writes nothing throws before the eval runs;
  `revertGeneratedAtOnlyChanges` driven through a real temp git repo.

The pre-existing `data-dragon-lane-priors.test.ts` assertions pinned the literal command array
_including_ the repo-root-relative `--output`, so they passed happily throughout. Rewriting
them was part of the fix.

**Not verified live:** the rehearsal deliberately excludes S3, so the lane-prior path fix rests
on the unit assertions plus the runtime existence check rather than an observed write. First
real proof is the next `scout-data-dragon-version-check` (13:00 UTC daily). If it is still red,
the failure now names the specific missing artifact rather than a collapsed directory.

## Remaining

- [ ] Merge the PR.
- [ ] Confirm the next `scout-data-dragon-version-check` (13:00 UTC daily) completes, opens a
      16.16.1 PR, and leaves no stray `packages/scout-for-lol/packages/backend/packages/` tree.
- [ ] Review that first PR's regenerated lane-prior artifacts rather than auto-merging them —
      it is their first genuine update since 2026-05-17.
- [ ] Once the run is green and the plan ships, set `status: complete` and move this file to
      `packages/docs/archive/completed/`.

## Follow-ups

- The lane-prior training window is hardcoded to `2026-05-06..2026-05-13`, so the priors are
  trained on three-month-old matches and will never refresh on their own. Tracked separately in
  `packages/docs/todos/scout-lane-prior-training-window.md`.
- The first corrected run regenerates both lane-prior artifacts for the first time since May.
  The window is pinned so the content should be near-identical, but that PR deserves a look
  rather than an unreviewed auto-merge.
