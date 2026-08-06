---
id: ci-failure-annotations
type: todo
status: complete
board: false
origin: packages/docs/archive/superseded/2026-04-04_ci-reporting-artifacts.md
source_marker: false
---

# Add concise Buildkite failure annotations

Static CI logs contain failure details, but common failures do not produce a
concise build-level summary linking directly to the failed step and artifact.

## Remaining

- [x] Define annotations for failed verification/test/build steps using native Buildkite metadata and links.
- [x] Ensure annotations summarize existing failures without parsing away or replacing the command's real exit code.
- [x] Deduplicate retries and parallel-step messages so one failure has one current annotation.
- [x] Add tests for success, command failure, upload failure, retry, and parallel failures.
- [x] Verify annotations through the reporting-stack fixture builds.

## Comment Log

- 2026-07-27 — Split from the obsolete combined reporting plan. The current
  pipeline has no general failure-annotation layer; this record deliberately
  excludes JUnit and coverage transport.
