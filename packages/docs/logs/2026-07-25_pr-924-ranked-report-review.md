---
id: log-2026-07-25-pr-924-ranked-report-review
type: log
status: complete
board: false
---

# PR #924 ranked report review

## Goal

Run one current Codex review and fix cycle for PR #924 while preserving the
ranked-report design intent.

## Review result

`codex review --base origin/main` reported four P2 findings. The two fix cycles
resolved all four:

- The square design's final score bar is anchored to the bottom of the canvas.
- Both ranked designs balance 6–10 tracked players into groups of at most five.
- Data Dragon refreshes regenerate the ranked banner and square snapshots and
  rendered SVG assets.
- Backend startup validates champion splash art alongside portraits and loading
  art in both champion-name resolution passes.
- Ranked report labels convert Data Dragon asset keys to public champion names.
- `packages/scout-for-lol/CLAUDE.md` documents the ranked routing, canvas sizes,
  design override, and splash preload/refresh/validation workflow.
- Data Dragon champion-list parsing rejects nonnumeric, non-positive, and unsafe
  champion IDs before any image download can be skipped.
- Data Dragon snapshot refreshes throw when any enrolled report or backend suite
  exits nonzero, so ranked SVG/hash generation cannot silently remain stale.

The layout changes use Satori/Yoga-compatible flex containers. Boundary fixtures
for six and ten tracked players were rendered and visually inspected.

## Verification

- `git merge-tree --write-tree --quiet origin/main HEAD`
- `bun test --update-snapshots src/html/ranked-square/square.integration.test.ts`
  (6 passed)
- `bun test --update-snapshots src/html/ranked-banner/banner.integration.test.ts`
  (6 passed)
- `bunx turbo run typecheck lint test --filter=@scout-for-lol/report` (77
  passed)
- `bunx turbo run typecheck lint test --filter=@scout-for-lol/data` (469
  passed)
- `bunx turbo run typecheck lint test --filter=@scout-for-lol/backend` (1,138
  passed)
- Direct invocation of `validateChampionAssets()` (344 champion entries)
- Visual inspection of `MonkeyKing` fixtures rendering as public `Wukong`
  labels in both ranked designs

## Session Log — 2026-07-25

### Done

- Ran a current Codex review against `origin/main` for PR #924.
- Fixed the square report's bottom score-bar placement in
  `packages/scout-for-lol/packages/report/src/html/ranked-square/report.tsx`.
- Refreshed the four square SVG/hash snapshots and uploaded before/after PNG
  proof for PR #924.
- Added balanced 1–10 player layout coverage shared by the banner and square
  designs, with rendered six- and ten-player boundary fixtures.
- Added both ranked render suites to the Data Dragon snapshot refresh list.
- Added splash-art checks to backend startup validation and covered override
  names plus the missing-asset error path.
- Addressed the hosted Codex follow-up by rendering public champion names in all
  ranked text labels and documenting the ranked renderer integration points.
- Addressed the second hosted Codex follow-up by validating champion ID strings
  at the Data Dragon boundary and replacing both invalid-ID skips with errors.
- Added explicit snapshot subprocess failure propagation and tests covering the
  ranked-suite failure path.

### Remaining

- No implementation work remains from the local or hosted Codex findings.
- Buildkite and hosted Codex review will evaluate the pushed head asynchronously.

### Caveats

- `packages/scout-for-lol/packages/backend/src/testing/template.db` was already
  modified in the worktree and was intentionally left unstaged.
- The Greptile credit failure is not a code finding and was not treated as a
  blocker.
