---
id: plan-2026-07-19-ci-io-optimization
type: plan
status: in-progress
board: false
---

# CI I/O Reduction and Impact Measurement

## Goal

Ship one PR that reduces aggregate Buildkite pod-parent filesystem writes by at
least 50% without reducing validation coverage, serializing the heavy PR lanes,
or moving the same writes to another node or storage layer.

The investigation snapshot attributed 7.81 TiB of pod-parent writes to Buildkite
over 24 hours, compared with 12.26 TiB of node-level NVMe writes. Across builds
5777-5876, 410 full Bun installs materialized about 1.82 TiB and 105.2 million
inodes. The exact report interval and queries are recorded below.

## Implementation

- [x] Add stable step keys and propagate them to Buildkite pod metadata.
- [x] Export only the Buildkite pod metadata needed for attribution.
- [x] Add recording rules, controller scraping, non-paging alerts, and the
      Buildkite dashboard I/O panels.
- [x] Add a typed Prometheus plus Buildkite I/O reporter with JSON and Markdown
      output, coverage accounting, and benchmark failure modes.
- [x] Path-gate PR work before pods are scheduled and select main work before
      dependency installation.
- [x] Keep the full root install only in `verify`; filter or remove every other
      install according to the command's real dependency closure, and require
      `bun --no-install` on runtime commands so fresh pods cannot silently
      restore an implicit root install.
- [x] Remove unconditional image work and the hidden Caddy image build after
      target-selection and smoke fixtures prove equivalence.
- [x] Keep scanners path-aware and baseline-aware while treating scanner/runtime
      errors as hard failures.
- [x] Attempt the Docker containerd image-store benchmark and retain the
      candidate only if every acceptance gate passes. Both candidate attempts
      were inconclusive, so the candidate and benchmark-only plumbing were
      removed.

## Measurement Contract

- Primary metric: the maximum lifetime value of each unique Buildkite
  pod-parent `container_fs_writes_bytes_total` series, summed once across all
  nodes. Child-container counters are diagnostic and are never added to the
  parent.
- Attribution: pod job UUID plus stable step key, joined to the Buildkite API
  for build number, state, duration, and cancellation status.
- Coverage: jobs over 30 seconds require at least two samples. Shorter jobs with
  one sample are explicit lower bounds, never zeros.
- Node physical writes, write latency, and I/O pressure corroborate the result;
  they do not count toward the reduction because CI will move nodes separately.

## Acceptance Gates

- The fixed docs-only, sjer.red, Resume, LLM Docker E2E, image, and Tofu corpus
  writes at least 50% fewer pod-parent bytes.
- No expected validation lane is absent, and no optimized lane's p95 duration
  regresses by more than 10%.
- Filtered Bun installs allocate no more than 50% of a full root install and run
  the real consuming command successfully.
- The Docker candidate reduces every fixture by at least 20% and the geometric
  mean by at least 30%, with at most 10% wall-time/network regression and
  identical targets, image contents, digests, and smoke behavior.
- Missing samples, ambiguous joins, resets, schema/API failures, or mismatched
  workloads make a benchmark inconclusive rather than passing it.

## Baseline and Results

Frozen at `2026-07-20T05:30:30.851Z`:

```promql
sum(max_over_time(container_fs_writes_bytes_total{namespace="buildkite",container="",id=~"/kubepods.*pod[^/]+$"}[24h]))
```

The primary query returned `8339119546880` bytes (7.584 TiB) across 1,363
unique pod-parent series. The secondary node query returned 12.515 TiB on
`nvme0n1` and 0.192 TiB on `nvme1n1`; these device totals are diagnostic only.

| Window                   | Commits/builds                  |  Pod-parent writes | Physical writes | Coverage             | Notes                                                   |
| ------------------------ | ------------------------------- | -----------------: | --------------: | -------------------- | ------------------------------------------------------- |
| Pre-change 24h           | Ending 2026-07-20T05:30:30.851Z |          7.584 TiB |      12.707 TiB | 1,363 pod series     | Sum across every node                                   |
| Pre-change cohort        | Builds 5777-5876                | 4.210 TiB observed |             N/A | 677/728 jobs (93.0%) | 90 measured, 10 excluded; 334 complete, 343 lower-bound |
| Candidate corpus         | Pending                         |            Pending | Diagnostic only | Pending              | Representative post-merge builds required               |
| Post-merge 24h           | Pending merge                   |            Pending | Diagnostic only | Pending              | Workload-normalized                                     |
| Post-merge 7d/100 builds | Pending merge                   |            Pending | Diagnostic only | Pending              | Completion gate                                         |

The pre-change cohort metric window was
`2026-07-19T11:36:05.932Z`–`2026-07-20T03:12:23.994Z`. The reporter observed
4,629,005,031,424 bytes of writes, including 1,936,184,236,032 bytes
(1.761 TiB) measured as lower bounds. Canceled builds accounted for 1.265 TiB
and canceled jobs for 157.36 GiB. Network receive plus transmit was 497.04 GiB.
The 328 integrity findings were 324 missing post-finish parent samples and four
long jobs with insufficient samples; none were treated as zero.

### Runtime Install Footprints

| Closure                 |         Bytes | Entries | Full bytes | Full entries |
| ----------------------- | ------------: | ------: | ---------: | -----------: |
| Full root               | 3,753,123,840 | 261,770 |   100.000% |     100.000% |
| Root scripts production |    56,119,296 |   4,681 |     1.495% |       1.788% |
| sjer.red                |   724,738,048 |  68,265 |    19.310% |      26.078% |
| CDK8s development       |   471,887,872 |  33,973 |    12.573% |      12.978% |
| LLM observability       |   474,165,248 |  35,318 |    12.634% |      13.492% |
| Worst sites union       | 1,845,448,704 | 128,233 |    49.171% |      48.987% |
| NPM sequential union    |   462,278,656 |  46,257 |    12.317% |      17.671% |
| CDK8s production        |    56,119,296 |   4,677 |     1.495% |       1.787% |
| Cooklang                |   177,922,048 |  21,642 |     4.741% |       8.268% |

This table covers the filtered workspace installs used by runtime Buildkite
lanes. Every listed closure ran its real consuming command successfully. The
tightest 50% gate, the worst sites union, passed with 31,113,216 bytes and
2,652 entries of headroom. Dockerfile build-stage closures are measured
separately below and are not included in this claim.

### Dockerfile Install Footprints

The nine filtered Docker build-stage closures were measured from fresh,
dependency-free extractions of commit `7f342dbf379275f0a148cbf26733afaa70587ace`
with Bun 1.3.14. Percentages use the same 3,753,123,840-byte and 261,770-entry
full-root reference as the runtime table.

| Closure       | Filters                                               |         Bytes | Entries | Full bytes | Full entries |
| ------------- | ----------------------------------------------------- | ------------: | ------: | ---------: | -----------: |
| Birmel        | `@shepherdjerred/birmel`                              | 1,211,277,312 |  87,254 |    32.274% |      33.332% |
| Mario Kart    | `@discord-plays-mario-kart/*`                         | 1,005,006,848 |  72,289 |    26.778% |      27.615% |
| Pokemon       | `@discord-plays-pokemon/*`                            | 1,003,421,696 |  75,592 |    26.736% |      28.877% |
| Scout backend | `@scout-for-lol/backend`                              | 1,291,403,264 |  78,034 |    34.409% |      29.810% |
| Starlight     | `starlight-karma-bot`                                 |   288,886,784 |  35,050 |     7.697% |      13.390% |
| Streambot     | `@shepherdjerred/streambot`                           |   500,785,152 |  46,269 |    13.343% |      17.675% |
| TaskNotes     | `tasknotes-server`                                    |   221,073,408 |  28,731 |     5.890% |      10.976% |
| Temporal      | `@shepherdjerred/temporal`, `@shepherdjerred/toolkit` | 1,346,682,880 |  92,403 |    35.882% |      35.299% |
| TRMNL         | `@shepherdjerred/trmnl-dashboard`                     |   204,689,408 |  26,750 |     5.454% |      10.219% |

Each closure passed the 50% byte and entry gates. A fresh unfiltered control
was 1.378% larger by bytes and 0.445% larger by entries than the frozen
reference; that small calibration difference does not change any outcome.
Actual Docker builds and smoke consumers remain Buildkite acceptance checks.

### Docker Driver Experiment

All three builds used commit
`a2c42b2caf942f9be15d921d4353096fc5b29960` and benchmark ID
`20260720-a2c42b2`.

| Build | Mode                        | Result                                                                               |
| ----: | --------------------------- | ------------------------------------------------------------------------------------ |
|  5950 | `docker-container` baseline | Passed: TaskNotes 60.573s, Temporal 190.855s, infra 195.375s                         |
|  5951 | containerd candidate        | Temporal failed while downloading GitHub CLI; the remaining fixtures were canceled   |
|  5952 | candidate retry             | Repeated the `curl (35)` plus gzip EOF failure; the remaining fixtures were canceled |

No candidate workload or comparison completed, so every Docker acceptance
gate remained unproven. The candidate was rejected and removed without making
a performance claim about containerd.

### Observability Cost Guard

The proposed second 10-second kube-state-metrics scrape was removed after a
cost audit. Its cluster-wide endpoint was approximately 3.2 MB and 20,179
samples per scrape. At 8,640 scrapes per day, it would parse approximately
25.79 GiB and 174,346,560 samples daily before relabeling. Only the Buildkite
controller PodMonitor was added; kube-state-metrics remains on its normal
cadence.

## Remaining

- [x] Run the full `bun run verify` gate after final cleanup.
- [x] Publish draft PR #1602.
- [ ] Drive PR #1602's Buildkite checks green.
- [ ] Capture post-deploy Grafana evidence for the new recording rules and
      panels.
- [ ] Run the representative fixed-corpus comparison and determine the 50%
      acceptance-gate result.
- [x] Schedule the recurring report-only post-merge impact task.
- [ ] Deliver the 24-hour and seven-day/100-build impact reports.

## Post-Merge Observation

Run the reporter at 24 hours and again after both seven days and 100 builds.
Compare the frozen pre-change cohort with the post-merge cohort by branch and
stable step key, include canceled builds, and require telemetry coverage before
accepting a reduction. Node placement and physical-device totals remain
diagnostic, so moving CI cannot improve the primary result.

The recurring report-only task below starts checking daily. It must keep the
schedule active after the 24-hour report, and self-cancel only after the
seven-day/100-build completion report is delivered.

<!-- temporal-agent-task
{
  "title": "Measure CI I/O optimization impact",
  "provider": "codex",
  "mode": "report-only",
  "cron": "0 9 * * *",
  "scheduleId": "ci-io-post-merge-impact",
  "allowSelfCancel": true,
  "agentTimeoutMinutes": 45,
  "maxTurns": 40,
  "repo": {
    "fullName": "shepherdjerred/monorepo",
    "ref": "main"
  },
  "source": {
    "docPath": "packages/docs/plans/2026-07-19_ci-io-optimization.md"
  },
  "prompt": "Find CI I/O optimization PR #1602 and its merge time. If it is not merged, report pending and keep this schedule active. Once 24 hours have elapsed, use the repository's typed CI I/O reporter with read-only Prometheus and Buildkite access to compare the frozen pre-change cohort against a workload-normalized post-merge cohort by branch and stable step key, including canceled builds. Report pod-parent writes, coverage, duration, network diagnostics, lane presence, and acceptance-gate results; treat node physical writes and node placement as diagnostics only. Keep the schedule active after the 24-hour report. Once at least seven days have elapsed and at least 100 post-merge builds exist, deliver the final comparison, identify any regressions or missing telemetry, and set cancelCron=true only if the completion report is conclusive."
}
-->

## Explicit Exclusions

- No node placement, XFS/storage-class, pod limit, Kueue, or concurrency changes.
- No persistent DinD/BuildKit state or shared writable Bun package store.
- No direct registry push/pull workaround that merely relocates writes.
- Heavy PR lanes remain parallel.

## Session Log — 2026-07-19

### Done

- Approved the single-PR implementation and impact-measurement design.
- Created the isolated `feature/ci-io-reduction` worktree and this canonical plan.

### Remaining

- Implement, benchmark, verify, publish, and observe the changes described above.

### Caveats

- The CI node relocation is independent of this work and must not be counted as
  an optimization.

## Session Log — 2026-07-20

### Done

- Implemented stable Buildkite step attribution, bounded metadata export,
  Prometheus rules and alerts, dashboard panels, and the typed CI I/O reporter.
- Path-gated PR lanes, added dependency-free main selectors, reduced full-root
  installs to `verify`, filtered Docker build installs, and removed redundant
  image and Caddy work.
- Replayed builds 5777-5876 through the reporter and recorded coverage,
  lower-bound, cancellation, network, and integrity results above.
- Measured every filtered runtime-lane install closure and ran each real
  consumer; all listed runtime closures passed the footprint gate.
- Measured all nine filtered Docker build-stage install closures; every closure
  stayed below 50% of both the full-root byte and entry counts.
- Ran the controlled Docker baseline and two candidate attempts. The candidate
  remained inconclusive and was removed rather than promoted.
- Removed a proposed high-cost kube-state-metrics scrape after quantifying its
  daily parsing overhead.
- Preserved image validation while removing redundant work: `verify` now
  produces the Caddy fixture without pulling an image, and the selected infra
  image smoke test remains the parser-backed validation boundary.
- Covered root and Scout shared TypeScript configs, Caddy generation inputs,
  and the root-scripts manifest in both PR and main image-selection gates.
- Made fixed-corpus comparisons normalize legacy and current Buildkite step
  keys, require every representative logical lane, enforce p95 per lane, and
  reject windows that mix pipeline schemas.
- Rebased onto current `origin/main`, removed the obsolete hand-written
  monitoring CRD shim, and validated the observability rules against the full
  generated Prometheus types while retaining upstream scanner and codegen
  fixes.
- Moved Helm/PagerDuty render scratch data to OS temporary directories and made
  the TaskNotes watcher batching test deterministic, eliminating verification
  races without weakening production fallback behavior.
- Passed `bun run verify -- --affected` (67 of 67 tasks) and the full
  `bun run verify` gate (182 of 182 tasks).
- Published draft PR #1602 with the frozen baseline, experiment decision,
  verification evidence, exclusions, and pre-deploy Grafana screenshot.
- Scheduled and live-log-verified the report-only
  `ci-io-post-merge-impact` Temporal schedule.
- Added a pipeline-wide `bun --no-install` runtime invariant after PR review
  exposed that Bun's fresh-checkout auto-install could silently restore the
  root I/O cost; dependency installs and nested automation runtimes remain
  explicit and validator-enforced.
- Added Scout's Astro OpenGraph and LLM model dependencies to the deploy,
  promotion, reconciliation, and PR selectors, with behavioral fixtures wired
  into the root-scripts test gate.
- Made fixed-corpus comparisons retain every Buildkite job outcome and become
  inconclusive when a required validation job failed, was canceled, or never
  ran; canceled builds remain eligible when their mapped validation jobs
  passed.

### Remaining

- Drive PR #1602's Buildkite checks green.
- Collect the fixed-corpus, post-deploy dashboard, 24-hour, and
  seven-day/100-build evidence.

### Caveats

- The 50% aggregate-write goal is not yet proven; it requires representative
  post-merge workload measurements.
- Baseline telemetry contains explicit lower bounds and missing post-finish
  samples, not fabricated zeroes.
- The Docker result is inconclusive because the candidate workload never
  completed; it is not evidence that containerd performs worse.
- No node placement, filesystem, storage, Kueue, concurrency, or pod-limit
  changes were made.
