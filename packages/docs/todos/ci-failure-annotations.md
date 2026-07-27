---
id: ci-failure-annotations
type: todo
status: planned
board: true
verification: agent
disposition: active
origin: packages/docs/archive/superseded/2026-04-04_ci-reporting-artifacts.md
source_marker: false
---

# Add concise Buildkite failure annotations

Static CI logs contain failure details, but common failures do not produce a
concise build-level summary linking directly to the failed step and artifact.

## Remaining

- [ ] Define annotations for failed verification/test/build steps using native Buildkite metadata and links.
- [ ] Ensure annotations summarize existing failures without parsing away or replacing the command's real exit code.
- [ ] Deduplicate retries and parallel-step messages so one failure has one current annotation.
- [ ] Add tests for success, command failure, upload failure, retry, and parallel failures.
- [ ] Verify annotations on an intentionally failing fixture build.

## Comment Log

- 2026-07-27 — Split from the obsolete combined reporting plan. The current
  pipeline has no general failure-annotation layer; this record deliberately
  excludes JUnit and coverage transport.
