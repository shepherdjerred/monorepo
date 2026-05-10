# PR Review Bot — Phase 8: Measurement

## Status

In Progress

## Context

Phase 8 of the SOTA PR review bot per
`packages/docs/plans/2026-05-10_sota-pr-review-bot.md` (Task #8 in the team
task tracker). The goal: wire the bot's observability end-to-end so the
team can tune precision/recall, cost, and latency from data rather than
intuition. Without metrics, Phases 9–12 fly blind.

Foundation team has already shipped Phase 1 (`#728`, on main) with the
activity graph, OTel `withSpan` infrastructure, and seed metrics. Phase 2
(`#738`, in flight) ports the existing prompt to a direct SDK call and
finalises the `pr_review_*` namespace per team-lead Path A: the Phase 2
posted-comment counter becomes `pr_review_posted_total`, leaving
`pr_review_count_total` free for the workflow-lifecycle counter this PR
adds.

## Scope — what this PR ships

### Metric definitions

A new file `packages/temporal/src/observability/pr-review-metrics.ts`
defines the Phase 8 Prometheus series on the shared `register` singleton
exported from `observability/metrics.ts`. Splitting them into a sibling
file (rather than editing `metrics.ts` directly) avoids merge conflicts
with the in-flight Phase 2 rename.

| Series                             | Type      | Labels                                   | Purpose                                                 |
| ---------------------------------- | --------- | ---------------------------------------- | ------------------------------------------------------- |
| `pr_review_count_total`            | Counter   | `repo`, `status=posted\|skipped\|failed` | Workflow lifecycle counter                              |
| `pr_review_latency_seconds`        | Histogram | —                                        | End-to-end webhook → post latency                       |
| `pr_review_cost_usd`               | Histogram | `model`                                  | Per-model USD cost per PR                               |
| `pr_review_fpr_estimated`          | Gauge     | —                                        | Rolling 24h FPR; populated by Phase 9 reaction listener |
| `pr_review_consensus_drop_rate`    | Gauge     | —                                        | Specialist → consensus drop fraction (per run)          |
| `pr_review_verification_drop_rate` | Gauge     | —                                        | Consensus → verification drop fraction (per run)        |
| `pr_review_dedupe_drop_rate`       | Gauge     | —                                        | Verification → dedupe drop fraction (per run)           |

`pr_review_count_total` is semantically distinct from Phase 2's
`pr_review_posted_total{owner, repo, outcome=created|updated}`: the
former counts every workflow run (posted, skipped, or failed); the
latter only fires when a comment is actually posted.

### Alert rules

`packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/pr-review-bot.ts`
defines five rules across two groups:

| Alert                              | Threshold                  | Severity | Routing          |
| ---------------------------------- | -------------------------- | -------- | ---------------- |
| `PrReviewBotHighFalsePositiveRate` | FPR > 15% for 1h           | critical | PagerDuty page   |
| `PrReviewBotCostBudgetExceeded`    | p50 cost/PR > $5 for 24h   | warning  | PagerDuty ticket |
| `PrReviewBotHighLatency`           | p95 latency > 480s for 15m | critical | PagerDuty page   |
| `PrReviewBotNoActivity`            | zero runs in 6h            | info     | Dashboard only   |
| `PrReviewBotHighFailureRate`       | failure rate > 25% for 30m | warning  | PagerDuty ticket |

Registered via `prometheus.ts` in namespace `temporal` (alongside the
existing `prometheus-temporal-rules`).

### Grafana dashboard

`packages/homelab/src/cdk8s/grafana/pr-review-bot-dashboard.ts` builds
the dashboard via the Grafana Foundation SDK pattern used by every other
dashboard in this repo. Registered via `resources/grafana/index.ts` as
`PR_REVIEW_BOT_DASHBOARD`. Seven rows:

1. **Overview** — Runs (24h) / Posted (24h) / FPR / p95 latency
2. **Throughput** — Runs by status (timeseries)
3. **Latency** — p50/p95/p99
4. **Cost** — Per-model breakdown + total p50/p95 with $5 threshold
5. **Quality** — FPR trend (7d) + failure rate (1h)
6. **Drop rates** — Consensus / verification / dedupe per-run gauges
7. **Comments per PR** — p50/p95 over 6h

Uses Helm template escaping via `exportDashboardWithHelmEscaping`.

### Tests

`packages/temporal/src/observability/pr-review-metrics.test.ts` (4 tests)
verifies that every Phase 8 series is registered on the shared registry,
that the latency histogram contains the 480s SLO boundary bucket, and
that the cost histogram is labeled by model.

## Scope — explicitly NOT in this PR

- **Emit-site wiring.** `pr_review_count_total`,
  `pr_review_latency_seconds`, `pr_review_cost_usd`, and the drop-rate
  gauges are defined here but not yet instrumented at their call sites.
  Wiring depends on Phase 2 (#738) landing first so we can extend
  `EmitMetricsInput` and the workflow without merge conflicts. Will land
  in a follow-up small PR once #738 merges. The metrics are inert until
  then — defining them early lets dashboards + alerts ship in their final
  shape.
- **FPR computation.** `pr_review_fpr_estimated` is populated by the
  Phase 9 reaction-listener workflow, not Phase 8. Defaults to 0 until
  Phase 9 lands.
- **Synthetic load test.** Task 8 verification calls for synthetic load
  via `replay-pr-review.ts` — that script lands in #738. Deferred to the
  same follow-up PR as emit-site wiring.

## Verification

- `cd packages/homelab && bun run typecheck` → clean.
- `cd packages/homelab && bun run test` → 247 pass, 0 fail.
- `cd packages/temporal && bun run typecheck` → clean.
- `cd packages/temporal && bun test src/observability/pr-review-metrics.test.ts` → 4 pass.
- Dashboard JSON renders (`createPrReviewBotDashboard()` → 19 panels including 7 row separators).

## Session Log — 2026-05-10

### Done

- `packages/temporal/src/observability/pr-review-metrics.ts` — 7 new metric definitions
- `packages/temporal/src/observability/pr-review-metrics.test.ts` — 4 tests, all pass
- `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/pr-review-bot.ts` — 5 alert rules in 2 groups
- `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/prometheus.ts` — register new PrometheusRule
- `packages/homelab/src/cdk8s/grafana/pr-review-bot-dashboard.ts` — 12-panel Grafana dashboard across 7 rows
- `packages/homelab/src/cdk8s/src/resources/grafana/index.ts` — register new ConfigMap
- Sibling repo `shepherdjerred/monorepo-pr-review-fixtures` bootstrapped (Task 10 prep, pushed earlier)

### Remaining

- Open PR, get team-lead review, address feedback.
- Follow-up PR (post-#738 merge): wire `pr_review_count_total` increments, latency observation, cost recording into the workflow + `emitMetrics` activity. Add synthetic-load run via `replay-pr-review.ts`.
- Task 10 + 11 still gated behind Task 8 PR landing on main.

### Caveats

- Phase 2 (#738) hasn't merged yet. This PR uses the final Path-A
  namespace (`pr_review_count_total` for the lifecycle counter and
  `pr_review_posted_total` for the posted-comment counter). If Phase 8
  lands before #738, the alerts/dashboard reference series that don't
  exist yet — they'd be inert until #738 merges and Phase 2's emitMetrics
  starts populating `pr_review_posted_total`. Strong recommendation:
  merge order is #738 → Phase 8.
- ESLint local-run requires `jiti` to be visible to the globally-installed
  ESLint; a workaround symlink was made in this session but is not
  committed.
