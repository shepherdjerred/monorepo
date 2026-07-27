---
id: homelab-audit-agent-task-production-verification
type: todo
status: in-progress
board: true
verification: agent
disposition: active
origin: packages/docs/archive/superseded/agent-task-workflow-broken.md
---

# Verify homelab-audit agent tasks in production

The historical timeout and JSON-schema invocation defects have code fixes. The
remaining question is whether the current `homelab-audit-daily` schedule runs
reliably on the deployed generic `agentTaskWorkflow` path.

## Remaining

- [ ] Confirm the deployed worker contains the inline-schema/structured-output
      fix and inspect the most recent seven `homelab-audit-daily` executions.
- [ ] If any current run failed, use its activity error, heartbeat, stderr, and
      trace to reproduce and fix that specific failure rather than carrying
      forward the June symptom.
- [ ] Record seven consecutive explicit terminal outcomes, including at least
      one successful report email, with no timeout or silent subprocess loss.

## Comment Log

### 2026-07-27 — split from workflow umbrella

- Created as the sole current production-health criterion for the scheduled
  audit workflow.
