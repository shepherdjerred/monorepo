---
id: streambot-pod-lifecycle-events
type: todo
status: planned
board: true
verification: agent
disposition: active
origin: packages/docs/archive/superseded/streambot-stutter-observability-followup.md
---

# Retain Streambot pod lifecycle events in Loki

The Kubernetes event exporter drops all Normal events, including Pod
Killing/Scheduled/Started events needed to explain Streambot pod churn.

## Remaining

- [ ] Restructure event-exporter routes so Normal events remain dropped by
      default while lifecycle events for Pod objects are retained without
      relying on unsupported RE2 negation.
- [ ] Add render/config tests for one retained Pod lifecycle event and one
      unrelated dropped Normal event.
- [ ] Deploy and restart Streambot once through GitOps, then record the expected
      lifecycle sequence in Loki.

## Comment Log

### 2026-07-27 — split from stutter follow-up

- Created as the independently deployable pod-forensics outcome.
