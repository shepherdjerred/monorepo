---
id: ci-junit-test-engine-reporting
type: todo
status: complete
board: false
origin: packages/docs/archive/superseded/2026-04-04_ci-reporting-artifacts.md
source_marker: false
---

# Publish CI test results to Buildkite Test Engine

The static Buildkite pipeline runs tests but does not upload normalized JUnit
results, so failures lack durable per-test history and flake visibility.

## Remaining

- [x] Inventory test runners and define one JUnit output convention that does not hide a failing test command.
- [x] Upload JUnit from each applicable static Buildkite step to Test Engine with package/step metadata.
- [x] Preserve test exit status when result upload fails or succeeds; reporting must never turn a red test green.
- [x] Add validation/tests for missing, malformed, empty, and multi-package result files.
- [x] Prove passing and failing fixtures through the reporting stack.

## Comment Log

- 2026-07-27 — Split from the obsolete Dagger reporting plan after the board
  audit verified current static CI still has no JUnit/Test Engine upload path.
  Kept separate from coverage and annotation work so it can ship independently.

## Session Log — 2026-08-02

### Done

- Confirmed the merged Buildkite reporting stack (#1782, #1786, and #1790) implements normalized JUnit, full-suite Test Engine upload, exit-status preservation, and malformed/missing report validation.
- Archived this duplicate implementation card; the parent reporting plan retains only scheduled-run acceptance.

### Remaining

- None.

### Caveats

- First scheduled-run verification remains on `packages/docs/plans/2026-07-28_buildkite-ci-reporting.md`.
