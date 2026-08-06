---
id: reference-completed-2026-05-10-bugsink-temporal-error-spike
type: reference
status: complete
board: false
---

# Bugsink/Temporal Error Spike Investigation

## Intent

Correlate the current Bugsink influx with Temporal and Kubernetes state after the Talos/Kubernetes API interruption.

## Scope

- Query current Bugsink unresolved/recent issues and identify which project is spiking.
- Check Temporal worker/server pod health, recent logs, and recent failed/timed-out workflow executions.
- Distinguish transient restart fallout from a persistent application bug or storage/queue backlog.

## Verification

- `toolkit bugsink ...`
- `kubectl` read-only checks in `bugsink` and `temporal`
- Temporal CLI read-only workflow/status queries through `kubectl exec`
