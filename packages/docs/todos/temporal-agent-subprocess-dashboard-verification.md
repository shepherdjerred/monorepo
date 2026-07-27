---
id: temporal-agent-subprocess-dashboard-verification
type: todo
status: in-progress
board: true
verification: agent
disposition: active
origin: packages/docs/archive/superseded/agent-task-workflow-broken.md
---

# Verify Temporal agent-subprocess telemetry in Grafana

PR #1230 added subprocess metrics, alerts, and the Grafana row. This record owns
only proof that current homelab-audit executions populate those surfaces.

## Remaining

- [ ] Query the application Prometheus endpoint during one audit and verify
      duration, exit, heartbeat/idle, and soft-kill series have the expected
      workflow/activity labels.
- [ ] Confirm the Grafana agent-subprocess panels render those live series over
      the same run without empty or mismatched queries.
- [ ] Evaluate the associated PrometheusRules against the current metric names
      and record the rule state; fix any stale query before closing.

## Comment Log

### 2026-07-27 — split from workflow umbrella

- Separated deterministic observability proof from schedule correctness.
