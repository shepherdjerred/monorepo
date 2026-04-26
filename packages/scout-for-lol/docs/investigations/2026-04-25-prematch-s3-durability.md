# Prematch S3 Durability

## Summary

Scout was already saving successful prematch spectator payloads to SeaweedFS-backed S3, but only after loading-screen generation succeeded. That meant the raw `spectator-data.json` artifact was missing for exactly the failures we care about debugging: unsupported prematch shapes, loading-screen generation failures, and other early exits before the render completed.

This change makes prematch payload persistence best-effort and unconditional for every detected prematch game. The raw spectator JSON is now attempted before channel lookup and before loading-screen generation, with explicit metrics and dashboard coverage for save outcomes and latency.

## Findings

- SeaweedFS S3 storage is configured and working for Scout. Successful prematch payloads already existed under:
  - `prematch/YYYY/MM/DD/<gameId>/spectator-data.json`
- Existing code only called `savePrematchDataToS3(...)` from the successful loading-screen path in:
  - `packages/backend/src/league/tasks/prematch/prematch-notification.ts`
- Because of that ordering, Scout did not archive raw prematch payloads when:
  - there were no subscribed channels
  - loading-screen generation threw
  - any earlier prematch handling failed before the fire-and-forget save block ran

## Implemented Changes

- Moved the raw prematch payload save to the top of `sendPrematchNotification(...)`, before:
  - channel subscription lookup
  - the no-channel early return
  - loading-screen generation
- Changed `savePrematchDataToS3(...)` to return a structured outcome:
  - `saved`
  - `skipped_no_bucket`
  - `error`
- Kept the save best-effort:
  - S3 failures are logged and counted
  - notification delivery continues
- Preserved the existing prematch S3 key layout:
  - `prematch/YYYY/MM/DD/<gameId>/spectator-data.json`

## Observability

### Logs

- S3 helper logs still record upload attempts, object keys, sizes, successes, and failures.
- Prematch notification flow now adds callsite logs when:
  - payload persistence fails but notification delivery continues
  - S3 is disabled and the save is intentionally skipped

### Metrics

Added in `packages/backend/src/metrics/index.ts`:

- `prematch_spectator_payload_saves_total{status}`
  - statuses: `saved`, `skipped_no_bucket`, `error`
- `prematch_spectator_payload_save_duration_seconds`
  - histogram for attempted uploads

### Dashboard

Extended the existing Scout Grafana dashboard in:

- `packages/homelab/src/cdk8s/grafana/scout-dashboard.ts`

Added a `Pre-match` row with:

- `Prematch Active Games`
- `Prematch Detections`
- `Loading Screen Outcomes`
- `Spectator Payload Save Outcomes`
- `Spectator Payload Save p95`

## Acceptance Criteria

- Raw `spectator-data.json` is attempted for every prematch game Scout detects.
- Raw payload persistence happens even when no Discord channels are subscribed.
- Raw payload persistence happens before loading-screen generation.
- S3 upload failures do not block Discord notification delivery.
- Payload save outcomes and latency are visible in Prometheus and Grafana.

## Verification

Targeted backend tests cover:

- successful prematch payload upload
- skipped upload when no S3 bucket is configured
- failed upload without throwing
- payload save attempted before channel lookup and render
- payload save attempted even on no-channel and render-failure paths

No new alert rule was added in this pass. The goal here was durability plus baseline observability; alert thresholds should be set after production data establishes normal save/error rates.
