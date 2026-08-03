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

## Session Log — 2026-07-28

### Done

- Audited the current Buildkite artifact set, Turbo test graph, package runners,
  coverage scripts, Test Engine state, and OpenTofu pipeline resources.
- Approved the implementation decisions captured above.
- Opened draft PR #1782 with the 41-workspace test manifest, cached `test:ci`
  graph, normalized Bun/Vitest/Go/Playwright JUnit, partial Test Engine uploads,
  and artifact retention.
- Created the `monorepo-tests` Test Engine suite.
- Implemented the second stack layer with an uncached complete reporting graph,
  LCOV/Go coverage aggregation, script-coverage harvesting, a non-deploying
  `monorepo-test-reporting` pipeline, and an initially disabled daily schedule.
- Proved the complete local reporting graph: all 79 Turbo tasks passed, 50
  JUnit files were indexed, and all 41 tested workspaces emitted coverage.
- Opened draft PR #1786 for the coverage and scheduled-pipeline layer.
- Implemented the rollout layer with per-task JSON/Markdown artifacts,
  category/outcome/cache/duration summaries, stable Buildkite annotation
  context, and links to the job, Test Engine, JUnit, and coverage artifacts.
- Validated the live OpenTofu state diff: exactly the reporting pipeline and
  daily schedule are new; no existing resources change or delete.
- Passed the exhaustive repository verification graph: all 212 tasks succeeded.
- Opened draft PR #1790 for task summaries, OpenTofu resources, and rollout.
- Added the Test Engine upload token to the existing 1Password-backed Buildkite
  secret and confirmed the Kubernetes secret reconciled with the new key.
- Temporarily provisioned the `monorepo-test-reporting` pipeline and proved the
  exact stack head with Buildkite build #4: both jobs passed, and the complete
  reporting job finished in 2m18s.
- Confirmed build #4 retained 116 artifacts: normalized JUnit, raw LCOV and Go
  coverage, aggregate coverage JSON/Markdown, a report index, and task-summary
  JSON/Markdown.
- Confirmed Buildkite Test Engine accepted the exact-head full-suite upload.
- Configured the OpenTofu-managed schedule as enabled at
  `0 3 * * * America/Los_Angeles` after the manual proof succeeded.
- Addressed all current automated-review findings: selector-safe report
  collection, original test-exit preservation, CDK8s build ordering, shared
  runner cache inputs, retained TypeDoc validation, a non-escalating reporting
  container, uncached script-coverage artifacts, source-location coverage
  deduplication, and format-accurate coverage metrics.
- Re-proved the production-shaped reporting graph: 57/57 test-report tasks
  passed, script coverage ran uncached, all 41 workspaces produced complete
  coverage, and 13 reporting/coverage regression tests passed.
- Re-ran the exhaustive repository gate without cache after the review fixes:
  all 212 tasks passed in 5m23s.
- Addressed the final current-head review findings: an executed main Playwright
  lane now proves its JUnit file exists even though selector skips remain
  allowed; package-specific `test` environment/hash inputs are mirrored by
  `test:ci`; the manifest JSON Schema accepts and constrains its own `$schema`
  property; duplicate LCOV function names map to definitions by occurrence;
  and Bun's 90% statement coverage threshold remains enforced.
- Restacked the three-PR series onto `origin/main` at
  `b4dd81cc918e7cd613340632845bfe85a41a1519` and passed the exhaustive
  repository gate again: all 212 tasks succeeded in 2m32s.
- Tightened the manifest runner after the next current-head review: Zod now
  rejects unknown properties at every object boundary, and test defaults apply
  to both unset and empty environment variables.
- Changed total coverage aggregation to deduplicate raw source locations across
  workspace reports, made ordinary partial-summary mode explicit and safe with
  an empty raw-report directory, and ordered CDK8s `test:report` after its own
  synthesized build.
- Re-ran the exhaustive repository gate after those fixes with reporting hashes
  invalidated: all 212 tasks succeeded in 5m35s with only 5 cache hits.
- Corrected cross-workspace total coverage so overlapping reports still
  deduplicate within a workspace while common relative paths such as
  `src/index.ts` remain distinct across packages; retained the explicit 90%
  line/function/statement thresholds and the CDK8s reporting build dependency.
- Passed 18 focused reporting regressions, the real script-coverage suite,
  root-script lint/typecheck, pipeline validation, and the exhaustive repository
  gate again: all 212 tasks succeeded in 2m35s.
- Completed the reporting inventory for all 54 root workspaces: 41 participate
  in the normalized reporting graph, 12 are explicitly testless, and `sjer.red`
  is explicitly assigned to the separate Playwright lanes. The report index now
  distinguishes reported, testless, and separately tested workspaces.
- Re-ran the exhaustive repository gate with every task invalidated by the
  manifest change: all 212 tasks succeeded in 5m13s with zero cache hits.
- Renamed the inventory's exclusion category to `testlessWorkspaces` so it
  cannot be confused with separately tested packages, and made each coverage
  command solely responsible for selecting its reporters while the shared
  config retains only the 90% line/function/statement thresholds. Focused
  manifest/index validation and the real 70-test script-coverage suite passed.
- Added the 23-test Scout desktop Rust suite to the normalized JUnit inventory
  and changed the report index to derive its reported-workspace list from the
  files that were actually emitted.
- Made JavaScript and TypeScript coverage include tracked executable source
  files that Bun or Vitest never loaded, while excluding tests, generated
  output, nested workspaces, and dependency code. The aggregate can no longer
  report 100% merely because untouched source files were absent from LCOV.
- Scheduled the report-only first-automatic-run verification for
  2026-08-04 04:00 America/Los_Angeles as Temporal workflow
  `agent-task-verify-first-automatic-buildkite-reporting-run-63042268c1cab320c4e1`.
- Passed 22 focused reporting regressions, the 23-test Rust suite with 23
  emitted JUnit cases, complete 41-workspace coverage aggregation, both
  Buildkite pipeline validators, root-script lint/typecheck, docs validation,
  and the exhaustive repository gate: all 213 tasks succeeded in 5m15s.
- Restacked the series onto `origin/main` at
  `b30cdb0f9b72e4ebd30391d90acca58a0fbbbce3`, preserving the newly merged
  content-aware CI-image promotion checks and homelab release tests alongside
  reporting.
- Addressed the current-head review findings by deleting stale JUnit before
  every test invocation, representing harness-level Cargo failures in JUnit,
  inventorying `.buildkite/scripts` under root-script coverage, and making the
  registered automatic-run follow-up explicit beside its unchecked task.
- Refreshed the Scout season catalog for Riot's July 29 Season 3 Act 1 start,
  regenerated the committed test-database template, and moved active-season
  integration fixtures to the current future-ending season after the prior
  season expired.
- Passed 24 focused reporting regressions, 16 season tests, 28 affected Scout
  integration tests, both pipeline validators, complete 41-workspace coverage
  aggregation, focused lint/typecheck, and the exhaustive repository gate on
  code head `d52352353cf87951ff9d2354e82ae8c55031a94c`: all 213 tasks succeeded in
  3m06s.
- Restored the newly merged `scripts/helm-release-core.test.ts` homelab release
  test to the reporting manifest and added a regression that prevents future
  release-test omissions.
- Corrected Bun LCOV aggregation to honor `LF`/`LH`, `FNF`/`FNH`, and
  `BRF`/`BRH` totals even when Bun omits individual `DA`, `FN`/`FNDA`, or
  `BRDA` records. Conflicting detailed and aggregate records now fail fast
  instead of silently overstating coverage.
- Passed all 27 focused reporting regressions, both Buildkite pipeline
  validators, complete 41-workspace coverage aggregation, and docs validation
  after those review fixes.
- Restacked the series onto `origin/main` at
  `ab6dac0e61a3abe4c507878da6e40ab60a7fbc02` and passed the exhaustive
  repository gate on the exact restacked code tree: all 213 tasks succeeded in
  5m08s.
- Diagnosed Buildkite builds #6944–#6946 failing before their authoritative
  checks could run: 16,505 abandoned Bun extraction directories occupied 27
  GiB of the 30 GiB shared cache claim. Removed only the disposable `.tmp`
  entries after all builds stopped, preserving the valid package cache and
  restoring 24 GiB of free capacity.
- Added an hourly, concurrency-forbidden Buildkite Bun-cache maintenance
  CronJob that reclaims only extraction directories older than six hours, with
  a synthesized-resource regression covering its immutable image, schedule,
  cache mount, and age boundary.
- Passed the owning CDK8s build, typecheck, lint, 268 tests, GPU synthesis,
  both Buildkite pipeline validators, and the exhaustive repository gate after
  the cache guard: all 213 tasks succeeded in 1m54s.
- Restacked the final series onto `origin/main` at
  `17e40f5f2fd3a76c4eecb22af791ef88096cf61d`, preserving its corrected
  Playwright amd64 Chromium inventory checks alongside the reporting changes.
- Passed the exhaustive repository gate on that final restack: all 213 tasks
  succeeded in 2m09s.
- Addressed the next current-head review findings: JUnit namespacing preserves
  numeric-looking and whitespace-sensitive diagnostic text, the complete
  reporting graph includes the 23-test Cargo workspace through `test:report`,
  and task summaries link to Buildkite's `#artifacts` tab.
- Passed 32 focused reporting/task-summary regressions, the actual 23-test
  Cargo reporting command, root-script lint/typecheck, and both Buildkite
  pipeline validators after those fixes.
- Re-ran the exhaustive repository gate with the reporting hashes invalidated:
  all 213 tasks succeeded in 5m18s with only 4 cache hits.
- Restacked onto `origin/main` at
  `7cbac533ab17c10696d094a9883042b626327821`, preserving the merged canonical
  League Classic season catalog and its refreshed Scout test fixtures.
- Made the desktop Rust report reproducible with a committed `Cargo.lock`,
  `cargo test --locked --all-features`, the complete Linux Tauri prerequisite
  set in `ci-base`, and a pipeline assertion for its non-empty JUnit artifact.
  The Cargo adapter now parses both output streams because Cargo emits its
  test-case diagnostics on stderr.
- Passed all 28 focused reporting regressions, both Buildkite pipeline
  validators, the 23-test locked Cargo run with 23 emitted JUnit cases, and the
  exhaustive repository gate on the final restacked tree: all 213 tasks
  succeeded uncached in 5m15s.
- Added a dedicated full Playwright reporting step, pinned both reporting jobs
  to immutable CI-image digests, and made source coverage inventory the 12
  testless workspaces plus separately tested `sjer.red` so untouched source is
  represented as zero coverage.
- Published and independently inspected the content-addressed `ci-base`
  candidate for source fingerprint
  `sha256:122587e90e07571bac6b5198ea7473780fa08d68eedcbf404d974896b83457ca`,
  pinned digest
  `sha256:1bc701937f86ebcf2d3f94b19bce18d89bf8b7c8956ac61dd9a6d56e0d5c7031`
  in PR #1782, and verified its GLib, WebKitGTK, AppIndicator, `wget`, and
  `file` prerequisites in a Linux amd64 container.
- Made Bun-compatible untouched-source totals explicit for both one-line and
  multiline functions, seeded reportless source into the function and branch
  denominators, and classified the new bootstrap scripts in the shell-to-Bun
  migration manifest. The real complete summary now counts 200 functions and
  274 branches for testless `@scout-for-lol/ui`, plus 13 functions and 16
  branches for separately tested `sjer.red`, all uncovered. All 30 focused
  reporting regressions and the 213-task exhaustive repository gate passed.
- Stopped treating Bun's aggregate-only LCOV function and branch totals as
  source identities when multiple reports overlap. Summary JSON v2 now
  propagates `unavailableMetrics`, Markdown labels those cells `Unavailable`
  with an explanation, and exact metrics continue aggregating normally. The
  31-test reporting regression suite and all 213 repository verification tasks
  passed after this correction.
- Separated measured partial summaries from full-corpus scheduled summaries:
  partial mode now skips workspaces with no raw report, while complete mode
  inventories the full configured source corpus. Source metrics omitted by a
  producer are marked unavailable per source rather than inferred from an
  unrelated reported metric. Real partial and complete runs proved 41 and 54
  workspace rows respectively; 32 focused regressions and all 213 repository
  verification tasks passed.
- Encoded coverage-producer capabilities end to end: LCOV marks statements
  unavailable, Go marks lines/functions/branches unavailable, and filtering
  preserves that metadata. Mixed-language repository totals therefore no
  longer masquerade as full-repository percentages; workspace rows retain
  their supported metrics, while the Total row clearly reports unavailable.
  The 32 focused regressions and all 213 repository verification tasks passed.
- Extended complete-mode source inventory beyond JavaScript and TypeScript.
  Workspaces containing uncovered Rust, Astro, Python, Swift, shell, native,
  shader, JVM, Fish, or Lua production source now explicitly mark every
  affected coverage metric unavailable instead of disappearing from the
  denominator. Complete mode lists all 54 declared workspaces; partial mode
  remains limited to the 41 report producers. The new 33-test reporting suite
  passed with 221 assertions, real partial/complete summaries matched those
  inventories, and the exhaustive repository gate passed all 213 tasks in
  2m02s.

### Remaining

- [ ] Complete review and merge PRs #1782, #1786, and #1790.
- [ ] Let the first post-merge OpenTofu apply create the reporting pipeline and
      enabled schedule from configuration now present on `main`.
- [ ] Verify the first automatic scheduled build after the stack reaches
      `main`; the report-only `temporal-agent-task` below is registered as
      workflow
      `agent-task-verify-first-automatic-buildkite-reporting-run-63042268c1cab320c4e1`
      for 2026-08-04 04:00 America/Los_Angeles.

<!-- temporal-agent-task
{
  "title": "Verify first automatic Buildkite reporting run",
  "provider": "codex",
  "mode": "report-only",
  "runAt": "2026-08-04T04:00:00-07:00",
  "repo": { "fullName": "shepherdjerred/monorepo", "ref": "main" },
  "source": {
    "docPath": "packages/docs/plans/2026-07-28_buildkite-ci-reporting.md"
  },
  "prompt": "Inspect the Buildkite monorepo-test-reporting pipeline and its OpenTofu-managed 03:00 America/Los_Angeles schedule. Report whether the three-PR reporting stack merged, whether the first automatic scheduled build ran from main, and whether that build passed with normalized JUnit, raw and aggregate coverage artifacts, task summaries, and a successful full-suite Test Engine upload. Include the build URL and exact commit when available. If it has not run, report the exact blocker and next check. Do not edit files, open PRs or issues, trigger builds, apply OpenTofu, or mutate any live system."
}
-->

- [ ] Archive this plan after the merged schedule has produced that automatic
      build successfully.

### Caveats

- The first automatic scheduled run is remote evidence and cannot be claimed
  complete from configuration or a manual build alone.
- Manual builds #2 and #3 exposed and verified fixes for owned-build
  dependencies, Bun-compatible Vitest coverage, and Scout's root test boundary;
  build #4 is the authoritative successful proof.
- A later `main` OpenTofu reconciliation removed the temporarily provisioned
  branch-only pipeline and schedule because their configuration had not merged.
  They are intentionally not live again before merge; recreating the enabled
  `main` schedule early would run code that does not yet contain the reporting
  pipeline.
- The Tauri prerequisite additions are already available through the immutable
  candidate digest pinned in PR #1782. The stack does not depend on a mutable
  image tag or a later post-merge promotion before its reporting jobs can run.
- Submitted builds #6944–#6946 are not code-quality evidence: the full
  Buildkite Bun cache prevented installs from completing before the relevant
  checks. Their exact heads must be rebuilt after the targeted cache recovery.
- The first exhaustive run after the final restack found a missing
  `ffmpeg-static` lifecycle artifact in the long-lived worktree. A forced
  frozen reinstall produced the trusted binary; the owned native integration
  lane and the subsequent full 212-task verification both passed.
