# PR Review Bot — Phase 8 Emit-Site Wiring (Follow-up)

## Status

In Progress

## Context

Phase 8 (#741) defined the Prometheus series, Grafana dashboard, and
PagerDuty alerts for the SOTA pr-review bot. This follow-up wires the
emit-site so the metrics actually fire from the workflow + activity path.

Without this PR the dashboard panels stay empty, no matter how much
traffic the bot sees — the metric definitions are inert until the
workflow calls into them.

## Scope

### Workflow changes (`packages/temporal/src/workflows/pr-review/index.ts`)

- Capture `startedAtMs` from `workflowInfo().startTime` once at workflow
  entry. Deterministic, persisted in Temporal history.
- Wrap the activity-orchestration body in `try/catch`. On success, call
  `prReviewEmitMetrics` with the full Phase 8 input (status, stage drops,
  costs). On failure, best-effort call `prReviewEmitFailureMetrics` and
  re-throw the original error.
- Pass per-stage finding counts (rawFindings → consensus → verify →
  dedupe → posted) through to the metrics activity for drop-rate
  computation.

### Activity changes (`packages/temporal/src/activities/pr-review/metrics.ts`)

- `EmitMetricsInput` gains `status` ("posted" | "skipped" — defaults to
  "posted"), `startedAtMs`, `costs[]`, and `stageDrops`.
- New `prReviewEmitFailureMetrics` activity: `EmitFailureMetricsInput`
  with `startedAtMs` + `reason`. Fires `pr_review_count_total{status=failed}`
  and observes `pr_review_latency_seconds`.
- Drop-rate computation clamped to `[0, 1]` so pathological inputs
  (negative, NaN, or > 1) emit a sane gauge value rather than blowing
  up the dashboard.
- Phase 1/2 metrics (`pr_review_posted_total`, `pr_review_findings_per_pr`)
  continue to fire unchanged.

### What this PR does NOT change

- **Specialist activity return type** (`runSpecialistsImpl` still returns
  `Finding[]` rather than `{findings, costs}`). The `costs` array passed
  to the metrics activity is empty `[]` for now. The `pr_review_cost_usd`
  histogram simply has no samples until specialists' Phase 3 PR surfaces
  per-call cost-by-model.

  Rationale: changing the specialists return type now would conflict
  with the in-flight Phase 3 work. Phase 3 can extend the metrics-input
  population to plumb costs through. Until then the cost histogram is
  graceful-empty, not stale.

- **Webhook ingress** is unchanged.

## Tests

- `packages/temporal/src/activities/pr-review/metrics.test.ts` — 4 tests
  covering happy path, status=skipped, status=failed, and drop-rate
  clamping. Asserts on the exported Prometheus exposition.

## Verification

- `bun run typecheck` — clean in `packages/temporal`.
- `bun run test` in `packages/temporal` — 141 pass, 0 fail.
- Pre-commit hooks (gitleaks, env-var-names, lint, prettier,
  markdownlint, quality-ratchet) — clean.

## Session Log — 2026-05-10

### Done

- `packages/temporal/src/activities/pr-review/metrics.ts` — extended
  `EmitMetricsInput`, added `prReviewEmitFailureMetrics`, wired Phase 8
  metric emission.
- `packages/temporal/src/activities/pr-review/metrics.test.ts` — 4 new
  tests.
- `packages/temporal/src/workflows/pr-review/index.ts` — try/catch +
  startedAtMs + stage-drop tracking + status routing.
- This plan doc, indexed.

### Remaining

- Open PR, get CI green, auto-merge fires.
- Specialists' Phase 3 PR will plumb `costs[]` from the
  `runSpecialistsImpl` return into the metrics-input. No work here.

### Caveats

- `pr_review_cost_usd` histogram has no samples until specialists' Phase 3
  surfaces cost-by-model. Dashboard panels referencing that series will
  read as empty for a while. This is preferable to emitting a fake
  placeholder value.
