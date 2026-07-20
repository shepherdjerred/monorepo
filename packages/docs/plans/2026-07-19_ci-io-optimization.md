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
inodes. The exact report interval and queries will be recorded below before the
candidate benchmark is accepted.

## Implementation

- [ ] Add stable step keys and propagate them to Buildkite pod metadata.
- [ ] Export only the Buildkite pod metadata needed for attribution.
- [ ] Add recording rules, controller scraping, non-paging alerts, and the
      Buildkite dashboard I/O panels.
- [ ] Add a typed Prometheus plus Buildkite I/O reporter with JSON and Markdown
      output, coverage accounting, and benchmark failure modes.
- [ ] Path-gate PR work before pods are scheduled and select main work before
      dependency installation.
- [ ] Keep the full root install only in `verify`; filter or remove every other
      install according to the command's real dependency closure.
- [ ] Remove unconditional image work and the hidden Caddy image build after
      target-selection and smoke fixtures prove equivalence.
- [ ] Keep scanners path-aware and baseline-aware while treating scanner/runtime
      errors as hard failures.
- [ ] Benchmark the Docker containerd image-store candidate and retain it only
      if every acceptance gate passes.

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

| Window                   | Commits/builds                  |       Pod-parent writes | Physical writes |         Coverage | Notes                  |
| ------------------------ | ------------------------------- | ----------------------: | --------------: | ---------------: | ---------------------- |
| Pre-change 24h           | Ending 2026-07-20T05:30:30.851Z |               7.584 TiB |      12.707 TiB | 1,363 pod series | Sum across every node  |
| Pre-change cohort        | Builds 5777-5876                | Pending reporter replay |             N/A |          Pending | Includes cancellations |
| Candidate corpus         | Pending                         |                 Pending | Diagnostic only |          Pending | Identical fixtures     |
| Post-merge 24h           | Pending merge                   |                 Pending | Diagnostic only |          Pending | Workload-normalized    |
| Post-merge 7d/100 builds | Pending merge                   |                 Pending | Diagnostic only |          Pending | Completion gate        |

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
  "prompt": "Find the merged CI I/O optimization PR and its merge time. If it is not merged, report pending and keep this schedule active. Once 24 hours have elapsed, use the repository's typed CI I/O reporter with read-only Prometheus and Buildkite access to compare the frozen pre-change cohort against a workload-normalized post-merge cohort by branch and stable step key, including canceled builds. Report pod-parent writes, coverage, duration, network diagnostics, lane presence, and acceptance-gate results; treat node physical writes and node placement as diagnostics only. Keep the schedule active after the 24-hour report. Once at least seven days have elapsed and at least 100 post-merge builds exist, deliver the final comparison, identify any regressions or missing telemetry, and set cancelCron=true only if the completion report is conclusive."
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
