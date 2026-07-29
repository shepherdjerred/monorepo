---
id: log-2026-07-28-ci-observability-recap
type: log
status: complete
board: false
---

# CI observability recap

## Questions

Determine whether CI observability was added recently, whether it works, and
whether the original CI I/O reduction plan met its acceptance goal.

## Session Log — 2026-07-28

### Done

- Inspected recent repository history and the current Buildkite, Prometheus, and
  Grafana wiring.
- Confirmed PR #1602 (`be3cef190`, merged 2026-07-21) added Buildkite CI I/O
  metrics, Prometheus rules, Grafana panels, stable pod attribution, and a
  fixed-corpus impact reporter.
- Confirmed PR #1686 (`071cb795e`, merged 2026-07-26) added buildkitd metrics,
  alerts, and a dashboard; restored liskov node-exporter and CI log collection;
  and exposed lane/image run-skip reasons through Buildkite annotations,
  metadata, and JSON artifacts.
- Confirmed the repository records successful post-merge live verification for
  liskov node-exporter and the affected DaemonSets.
- Reverified the live system on 2026-07-28:
  - buildkitd is Ready on liskov with zero container restarts; Prometheus reports
    `up=1`, 44 goroutines, 79.8% cache fill, and zero restarts in the last hour.
  - Both node-exporter targets report `up=1`, Prometheus has four active
    Buildkite container-write series, and no Buildkitd/NodeExporter/TargetDown
    alert is firing.
  - Grafana has provisioned `buildkitd-dashboard` with 10 panels, and its
    Prometheus datasource returns the live buildkitd target.
  - Loki received 79,006 Buildkite log lines in the preceding hour, including
    streams from liskov.
  - Buildkite #6744 contains the `images` and `build-summary` annotations, 19
    lane-decision metadata entries, and completed image-selection and push-outcome
    JSON artifacts.
  - `kubectl top node liskov` succeeds; promtail, Loki canary, and
    node-feature-discovery are each 2/2 ready with zero misscheduled pods.
- Audited the original CI I/O plan's fixed-corpus acceptance gate with two
  successful, workload-matched main builds: baseline #5809 and post-change
  candidate #6017.
  - The measured fixed-corpus writes fell 58.9%, and every fixed-corpus lane ran
    faster, so the available evidence points in the intended direction.
  - The reporter correctly returned `inconclusive`: baseline coverage was 8
    complete, 11 lower-bound, and 2 missing jobs; candidate coverage was 4
    complete and 17 lower-bound jobs. The recurring integrity failure was
    `missing-post-finish-parent-sample`.
  - A strict recording-rule run also remained incomplete: 4 complete, 15
    lower-bound, and 2 missing jobs.
- Inspected the recurring `ci-io-post-merge-impact` Temporal schedule. All eight
  daily attempts through July 28 failed before producing a report: seven on
  missing OpenAI API authentication and the latest on an invalid Codex output
  schema that omitted `followUp.provider` from `required`.

### Remaining

- [ ] Persist a terminal pod-parent write counter before Buildkite job pods
      disappear, or otherwise guarantee a final scrape, so completed jobs no
      longer end as lower bounds.
- [ ] Repair the recurring agent task's provider authentication and output
      schema, then rerun or backfill its failed reports.
- [ ] Rerun the workload-matched fixed corpus with complete telemetry and obtain
      a conclusive result from `--enforce-impact-gates`.
- [ ] Deliver the planned 24-hour and seven-day/100-build reports, then update
      and archive the completed plans if the acceptance gate passes.
- [ ] Add the omitted post-deploy dashboard screenshot to PR #1686 if preserving
      the plan's review-artifact requirement still matters.

### Caveats

- The observability is Prometheus/Grafana plus Buildkite-native annotations and
  artifacts, not end-to-end OpenTelemetry tracing of CI jobs.
- The observability overhaul's functional goal is met. The original I/O plan's
  formal goal is not yet met under its own contract: 58.9% is a promising
  lower-bound comparison, not an accepted result, because telemetry completeness
  is asymmetric and could overstate the reduction.
- Both source plans still have `status: in-progress`; the observability-overhaul
  checklist is functionally complete but its status and archive location are
  stale.
- The observability works, but current main CI is independently red: Buildkite
  #6751 failed in the sites lane because webring TypeDoc hit
  `state.md.linkify.pretest is not a function`. That application/dependency
  failure does not indicate telemetry loss.
