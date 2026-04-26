# Scout Prematch S3 Follow-up — 2026-04-25

## Scope

This guide captures what to do after the prematch S3 durability change is deployed.

Relevant implementation docs:

- `packages/scout-for-lol/docs/investigations/2026-04-25-prematch-s3-durability.md`

## What Changed

Scout now attempts to persist raw prematch spectator payloads before:

- channel subscription lookup
- the no-channel early return
- loading-screen generation

The save is best-effort. Notification delivery continues even if the S3 write fails.

## Post-Deploy Checks

### 1. Verify payloads are being written

Confirm new prematch runs are producing:

- `prematch/YYYY/MM/DD/<gameId>/spectator-data.json`

Check both:

- a normal prematch that generates a loading screen
- a prematch path that exits early or falls back to text-only delivery

Success condition:

- raw spectator JSON exists for both paths

### 2. Verify metrics are present

Confirm Prometheus is scraping:

- `prematch_spectator_payload_saves_total{status}`
- `prematch_spectator_payload_save_duration_seconds`

Success condition:

- `saved` is increasing for real prematch traffic
- `error` is near zero or explainable
- `skipped_no_bucket` is zero in deployed environments with S3 enabled

### 3. Verify Grafana panels have data

Open the Scout dashboard and check the `Pre-match` row:

- `Prematch Active Games`
- `Prematch Detections`
- `Loading Screen Outcomes`
- `Spectator Payload Save Outcomes`
- `Spectator Payload Save p95`

Success condition:

- panels render without query errors
- payload save outcomes track real prematch activity
- p95 remains stable and low relative to expected S3 latency

### 4. Check logs for save failures

Look for:

- payload save failures that continued to notification delivery
- skipped saves due to missing bucket configuration

Success condition:

- no repeated `error` logs under normal operation
- no `skipped_no_bucket` logs in production-like environments

## Expected Follow-ups

### Near-term

- Use the newly preserved failure payloads to debug CHERRY and other unsupported prematch shapes.
- Decide whether the new error metric needs an alert once there is enough baseline data.
- Confirm the dashboard panels are useful enough to keep as-is; trim or expand them after a few days of production data.

### Optional cleanup

- Reduce noisy Prisma metric-init logs in isolated backend test runs.
- Add a storage query/helper for prematch artifacts if direct S3 path inspection becomes a recurring workflow.

## Not A Follow-up For This Change

These are separate tasks and should not block rollout of the durability change:

- adding new queue/map support
- changing CHERRY loading-screen rendering behavior
- changing spectator outage alerting policy
