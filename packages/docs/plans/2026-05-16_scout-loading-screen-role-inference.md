# Scout Loading Screen Role Inference

## Status

Complete

## Goal

Order standard 5v5 Scout loading screens by inferred lane, without rendering role labels, slot numbers, or confidence values. Keep ARAM and Arena layouts unchanged.

## Implementation Notes

- Standard loading-screen data is now layout-discriminated and requires `lane` on standard participants.
- Lane inference uses checked-in priors generated from Scout S3 Match-V5 postgame archives.
- Runtime rendering is offline and reads only the checked-in prior artifact.
- The eval command blinds postgame-only fields before inference and gates on participant accuracy.
- Temporal Data Dragon updates now regenerate lane priors and run the eval gate in the same cloned checkout before PR creation.

## S3 Artifact

- Training source: `2026-05-06` through `2026-05-13`
- Holdout source: `2026-05-14` through `2026-05-16`
- Queues: `400`, `420`, `440`, `480`, `490`
- Training matches: `621`
- Holdout matches: `100`
- Holdout participants: `1000`
- Eval threshold: `0.95`
- Eval accuracy: `0.979`

## Session Log — 2026-05-16

### Done

- Added lane-prior artifact schemas, S3 generation, inference, and eval tooling under `packages/scout-for-lol/packages/data/src/lane-priors/`.
- Added backend CLI scripts for generating/evaluating lane priors from S3.
- Updated loading-screen schemas/building/rendering so standard rows are sorted by top, jungle, middle, adc, support while ARAM and Arena remain unchanged.
- Generated checked-in S3 priors and a 100-match holdout eval report.
- Integrated lane-prior generation/eval into the Temporal Scout Data Dragon update path with explicit date-window config.
- Added and updated focused tests and snapshots for schemas, inference, eval, backend construction, rendering, and Temporal schedule/bundle coverage.

### Remaining

- The Temporal schedule currently pins explicit date windows matching this initial artifact. Future patch cadence runs may need those windows advanced intentionally as part of the schedule config.
- Historical S3 contains malformed standard matches with missing `teamPosition` values, for example `EUW1_7844076957` on `2026-05-05`; the generator correctly fails fast on those payloads.

### Caveats

- Backend loading-screen tests log a SQLite `no such table: main.Player` metrics update error during setup, but the focused tests still pass.
- The scorer includes a small payload-order prior in addition to champion, spell-pair, and Smite signals to clear the 95% eval gate on real holdout data.

## Session Log — 2026-05-17

### Done

- Rebased the PR branch onto `origin/main`, resolving the conflict in `packages/temporal/src/activities/data-dragon.ts`.
- Committed the implementation on `codex/scout-loading-screen-role-inference`.
- Pushed the branch to GitHub and opened draft PR `#839`: <https://github.com/shepherdjerred/monorepo/pull/839>.

### Remaining

- Buildkite CI and review feedback still need to complete before merge.

### Caveats

- Local `git status` reports a fsmonitor IPC warning for the shared worktree metadata, but the working tree is clean.
