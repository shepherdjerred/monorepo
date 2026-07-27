---
id: ci-coverage-reporting
type: todo
status: planned
board: true
verification: agent
disposition: active
origin: packages/docs/archive/superseded/2026-04-04_ci-reporting-artifacts.md
source_marker: false
---

# Publish actionable CI coverage reports

The static Buildkite pipeline does not currently collect or publish coverage.
This record covers reporting only, not a repository-wide coverage threshold.

## Remaining

- [ ] Inventory packages with meaningful coverage output and choose a language-neutral aggregate/report format.
- [ ] Produce coverage only from real test execution without running tests twice.
- [ ] Upload durable reports and expose package-level summaries from the relevant Buildkite steps.
- [ ] Define explicit behavior for unsupported packages and malformed/missing reports; do not silently report zero coverage.
- [ ] Add fixtures/tests and verify one representative TypeScript package report end to end.

## Comment Log

- 2026-07-27 — Split from the Dagger-era reporting plan. The board audit and
  2026-07-25 CI research confirm coverage is not uploaded today; this focused
  record avoids coupling it to JUnit or failure annotations.
