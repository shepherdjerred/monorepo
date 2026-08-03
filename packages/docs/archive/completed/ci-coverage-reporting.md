---
id: ci-coverage-reporting
type: todo
status: complete
board: false
origin: packages/docs/archive/superseded/2026-04-04_ci-reporting-artifacts.md
source_marker: false
---

# Publish actionable CI coverage reports

The static Buildkite pipeline does not currently collect or publish coverage.
This record covers reporting only, not a repository-wide coverage threshold.

## Remaining

- [x] Inventory packages with meaningful coverage output and choose a language-neutral aggregate/report format.
- [x] Produce coverage only from real test execution without running tests twice.
- [x] Upload durable reports and expose package-level summaries from the relevant Buildkite steps.
- [x] Define explicit behavior for unsupported packages and malformed/missing reports; do not silently report zero coverage.
- [x] Add fixtures/tests and verify representative package reports end to end.

## Comment Log

- 2026-07-27 — Split from the Dagger-era reporting plan. The board audit and
  2026-07-25 CI research confirm coverage is not uploaded today; this focused
  record avoids coupling it to JUnit or failure annotations.

## Session Log — 2026-08-02

### Done

- Confirmed the merged Buildkite reporting stack (#1782, #1786, and #1790) implements validated aggregate coverage, raw artifacts, unsupported-runner behavior, and regression coverage.
- Archived this duplicate implementation card; the parent reporting plan retains only scheduled-run acceptance.

### Remaining

- None.

### Caveats

- First scheduled-run verification remains on `packages/docs/plans/2026-07-28_buildkite-ci-reporting.md`.
