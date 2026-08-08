---
id: plan-2026-08-07-glitter-corpus-startup-metric-retry
type: plan
status: in-progress
board: false
---

# Self-healing Glitter startup metric restoration

## Summary

Add an indefinite, exponential-backoff retry supervisor for Glitter's startup
snapshot-metric restoration. This prevents transient SeaweedFS startup races
from producing a false stale alert while preserving the existing alert for
genuinely missing, invalid, or inaccessible snapshots.

## Implementation

- Add an injectable startup retry helper with equal-jitter exponential backoff:
  10-second initial ceiling, doubling per attempt, capped at five minutes.
- Retry only transient SeaweedFS connection and 408/429/5xx failures. Classify
  from the structured `code` and `$metadata` as well as the rendered name and
  message, walking the `.cause` chain — Bun's AWS SDK reports a mid-request
  socket close as `TimeoutError` with ECONNRESET only on `code`, and a wrapping
  handler can bury both a level down. Do not retry missing pointers,
  authorization failures, malformed data, checksum failures, or schema
  violations.
- Stop retrying when worker shutdown begins, log every retry, and emit one
  Sentry warning after ten consecutive transient failures.
- Keep the existing Prometheus alert expression, schedule timing, and
  PagerDuty routing unchanged.

## Verification

- Cover retry success, jitter bounds, cap, shutdown cancellation, persistent
  transient failures, and storage-error classification with `bun:test`.
- Run the Temporal package tests, typecheck, and lint.
- After deployment, verify startup restoration, the snapshot timestamp metric,
  alert resolution, and natural PagerDuty resolution.
