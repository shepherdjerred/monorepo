# PR #1230 — Greptile fixes (temporal agent observability)

## Status

Complete

## Context

BK build [4324](https://buildkite.com/sjerred/monorepo/builds/4324) on `feature/temporal-agent-obs` (PR #1230) failed with 3 unresolved Greptile review comments. Knip was also red but is `soft_failed: true` and not a build blocker.

## Greptile findings

1. **P1 — `outcome="failed"` never emitted** (`packages/temporal/src/activities/alert-remediation.ts:377`). `alertRemediationDecisionsTotal.inc()` only ran on the happy path; the schema explicitly excludes `failed` from `outcome`, so the counter could never tick that label.
2. **P1 — `AlertRemediationDecisionsAllFailing` permanently silent** (`packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/temporal.ts:300`). Consequence of #1: the rule's numerator was always 0.
3. **P2 — `agentSubprocessIdleSeconds` Gauge clobbered under concurrency** (`packages/temporal/src/observability/metrics.ts:214`). alert-remediation runs `concurrency=3` children; last writer wins, so 2 of every 3 observations were silently dropped.

## Fix

- `metrics.ts` — converted `agentSubprocessIdleSeconds` from `Gauge` → `Histogram` with buckets `[5, 15, 30, 60, 120, 300, 600, 1200, 1800]`. Histogram naturally accumulates across concurrent runs.
- `alert-remediation.ts` + `agent-task.ts` — switched the two call sites from `.set()` to `.observe()`.
- `alert-remediation.ts` — added `alertRemediationDecisionsTotal.inc({ decision: "failed", outcome: "failed", source: parsed.alert.source })` before throw in both error paths (non-zero exit code and parse failure), so the rule's numerator can actually rise during a regression.
- `temporal-dashboard.ts` — switched panel 302 from `max by (workflow_type) (agent_subprocess_idle_seconds)` to `histogram_quantile(0.95, sum by (workflow_type, le) (rate(agent_subprocess_idle_seconds_bucket[1h])))` and updated title/description to reflect p95 + concurrency reasoning.

## Verification

- `bun run typecheck` — pass (temporal + homelab)
- `bun test src/activities/alert-remediation` — 6 pass / 0 fail
- `bun run lint` — pass (temporal + homelab)

## Session Log — 2026-06-14

### Done

- Fixed all 3 Greptile review comments on PR #1230 (commits on `feature/temporal-agent-obs`).
- Verified typecheck, tests, lint locally in `packages/temporal` and `packages/homelab`.

### Remaining

- Push and let Greptile re-review. Knip remains red on the PR but is soft-failed (per `feedback_soft_failures_ci.md`).

### Caveats

- Switching the gauge → histogram changes the exported metric series shape (`_bucket`/`_sum`/`_count` instead of a single gauge). Only one consumer (Grafana panel 302) used the gauge; that consumer was updated. Prometheus storage will see a brand-new series — the old gauge name is reused, so the historical gauge samples remain queryable as a stale series until they age out of retention.
