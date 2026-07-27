---
id: ci-junit-test-engine-reporting
type: todo
status: planned
board: true
verification: agent
disposition: active
origin: packages/docs/archive/superseded/2026-04-04_ci-reporting-artifacts.md
source_marker: false
---

# Publish CI test results to Buildkite Test Engine

The static Buildkite pipeline runs tests but does not upload normalized JUnit
results, so failures lack durable per-test history and flake visibility.

## Remaining

- [ ] Inventory test runners and define one JUnit output convention that does not hide a failing test command.
- [ ] Upload JUnit from each applicable static Buildkite step to Test Engine with package/step metadata.
- [ ] Preserve test exit status when result upload fails or succeeds; reporting must never turn a red test green.
- [ ] Add validation/tests for missing, malformed, empty, and multi-package result files.
- [ ] Prove a passing and failing fixture appear correctly in Buildkite Test Engine.

## Comment Log

- 2026-07-27 — Split from the obsolete Dagger reporting plan after the board
  audit verified current static CI still has no JUnit/Test Engine upload path.
  Kept separate from coverage and annotation work so it can ship independently.
