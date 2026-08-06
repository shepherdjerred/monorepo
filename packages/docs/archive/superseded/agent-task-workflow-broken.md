---
id: agent-task-workflow-broken
type: todo
status: complete
board: false
source_marker: false
---

# Historical agentTaskWorkflow failure umbrella

This record combined an invocation defect, deployment/live-run verification,
Grafana population, and unrelated legacy PR-review workflow activity.

## Supersession Evidence

- PR #1230 shipped subprocess heartbeats, bounded soft-kill behavior, metrics,
  alerts, and dashboard panels.
- PR #1264 fixed the known `claude -p --json-schema` hang by passing the schema
  inline and parsing `structured_output`; the package runbook records this as
  the root cause of the historical agent-task hangs.
- Legacy `prReview` and `prSummary` workflows were retired; their zero counts
  are not an `agentTaskWorkflow` health criterion.

## Split Records

- `packages/docs/todos/homelab-audit-agent-task-production-verification.md`
  owns current schedule health and any current invocation failure.
- `packages/docs/todos/temporal-agent-subprocess-dashboard-verification.md`
  owns live metric/dashboard population.

## Comment Log

### 2026-07-27 — in-progress board audit

- Archived the stale mixed umbrella after separating current production proof
  from observability proof and dropping the retired PR workflow criterion.
