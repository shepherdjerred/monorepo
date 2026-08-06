---
id: buildkite-ci-reporting
type: plan
status: in-progress
board: false
---

# Buildkite CI Reporting

## Goal

Add complete test and quality reporting without duplicating binaries already
stored in Turbo, BuildKit, registries, or deployment storage.

- Normal PR and main builds retain Turbo caching and upload reports for tests
  actually executed.
- A dedicated `monorepo-test-reporting` pipeline runs the complete uncached test
  suite daily at 03:00 America/Los_Angeles.
- One Buildkite Test Engine suite receives normalized JUnit from Bun, Vitest,
  Go, and Playwright.
- Buildkite artifacts retain raw JUnit, coverage, and task summaries.

## Implementation

### PR 1 — Test reporting foundation

- Add a language-neutral reporting inventory for every real and no-test
  workspace.
- Add cached `test:ci` package and Turbo tasks that emit workspace-namespaced,
  validated JUnit without caching the report files.
- Add Bun, Vitest, Go, and Playwright report adapters.
- Upload `.ci-reports/**/*` and use the official Test Collector with
  `missing-error: 0` for ordinary cacheable builds.
- Provision the `monorepo-tests` Test Engine suite and inject its upload-only
  token through the existing 1Password-backed `buildkite-ci-secrets` item.

### PR 2 — Coverage and complete scheduled runs

- Add uncached `test:report` tasks that reuse cached build and generation
  prerequisites.
- Retain raw LCOV and Go coverprofiles and emit validated JSON/Markdown coverage
  aggregates without adding a repository-wide threshold.
- Harvest the already-running script-coverage lane rather than adding another
  normal-build test pass.
- Add a separate non-deploying Buildkite pipeline and an initially-disabled
  OpenTofu-managed daily schedule.

### PR 3 — Failure annotations and rollout

- Extend the Turbo annotation path with stable, retry-safe task summaries and
  links to logs, Test Engine, JUnit, and coverage artifacts.
- Represent lint through authoritative Turbo task state and job-log diagnostics;
  do not rerun lint solely to manufacture SARIF.
- Prove the dedicated pipeline manually, enable the daily schedule, and retain a
  follow-up record until the first automatic run succeeds.

## Correctness Contracts

- An executed supported runner must emit non-empty, valid JUnit. Missing or
  malformed output fails an otherwise successful command.
- An original test or verification failure remains the returned exit code;
  reporting errors never mask it.
- Cache hits do not restore or upload stale reports.
- Ordinary Test Engine uploads are tagged partial; the dedicated daily run is
  tagged full.
- The reporting pipeline contains no release, publish, image-push, deploy, or
  commit-back command.
- Existing deployable artifacts remain unchanged; compiled binaries and cached
  build outputs are not blanket-uploaded to Buildkite.

## Verification

- Unit-test pass, failure, empty, malformed, collision, multi-workspace, and
  exit-code behavior for every report adapter.
- Test LCOV and Go aggregation, cache-hit omission, unsupported/no-test states,
  and dependency-blocked tasks.
- Extend static pipeline tests to enforce artifacts, plugins, credential
  injection, and the dedicated pipeline's non-deploying boundary.
- Run focused root-script, affected package, Go, Vitest, Playwright, OpenTofu,
  docs, and pipeline checks, followed by `bun run verify` because the
  verification system itself changes.
- Prove a regular cache miss and hit, an intentional failing-test fixture, a
  manual complete reporting build, and the first automatic scheduled build.
