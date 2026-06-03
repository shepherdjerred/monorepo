# PagerDuty Notifications Check

## Status

Partially Complete

## Snapshot

- Checked live PagerDuty incidents on 2026-05-23 at 14:11 PDT with `toolkit pd incidents --json --limit 100`.
- PagerDuty returned 18 open incidents.
- All 18 incidents were `triggered`, `high` urgency, assigned to Jerred Shepherd, and on the `Homelab` service.
- Freshest active cluster was Scout beta:
  - `#4898` scout-service-beta targets down.
  - `#4900`, `#4907`, `#4908`, and `#4913` all point at `scout-beta-scout-backend`, including `CreateContainerConfigError`.
  - `#4909` reports Scout Data Dragon Temporal updater failures with `lane-prior-generation-failed`.
- Other notable active noise:
  - Prometheus PVC pressure: `#4820` and `#4887`.
  - Velero backup/PVC duplicates: `#4901` through `#4905`.
  - Home Assistant alert template expansion failure: `#4911`.
  - Temporal Anthropic rate limit: `#4888`.
  - Vacuum/Roomba freshness alerts: `#4676` and `#4884`.
  - SSD write activity: `#4857`.

## Session Log - 2026-05-23

### Done

- Loaded the PagerDuty helper workflow.
- Queried live PagerDuty through `toolkit pd incidents --json --limit 100`.
- Summarized the current open incident count and dominant alert clusters.
- Remediated Scout beta pod startup:
  - Root cause was stale beta-only `ELEVENLABS_API_KEY` / `ELEVENLABS_VOICE_ID` env refs in the Homelab Scout chart; Scout backend no longer reads those variables.
  - Removed those env refs from `packages/homelab/src/cdk8s/src/resources/scout/index.ts`.
  - Patched the live `scout-beta-scout-for-lol-1p` Secret with inert values so the currently deployed pod could start before the chart release.
  - Verified `scout-beta-scout-backend-7ddf8d97df-n455g` is `1/1 Running` and `scout-service-beta` has endpoint `10.244.0.198:3000`.
- Reduced Prometheus PVC pressure:
  - Changed Prometheus `retentionSize` from `240GB` to `200GB` in `packages/homelab/src/cdk8s/src/resources/argo-applications/prometheus.ts`.
  - Kept the supported `velero.io/exclude-from-backup=true` label for the Prometheus PVC template.
  - Patched the live Prometheus CR retention size to `200GB`, labeled the live PVC, and verified the Prometheus StatefulSet rolled successfully.
- Remediated the Scout Data Dragon weekly refresh failure path:
  - Added `AWS_REGION` / `AWS_DEFAULT_REGION` to the Temporal worker chart in `packages/homelab/src/cdk8s/src/resources/temporal/worker.ts`.
  - Added a Scout lane-prior S3 region fallback in `packages/scout-for-lol/packages/backend/scripts/lane-prior-s3.ts` with tests.
  - Patched the live Temporal worker deployment with `AWS_REGION=us-east-1` and `AWS_DEFAULT_REGION=us-east-1`, then triggered `scout-data-dragon-weekly-refresh`.
  - The rerun passed the prior lane-prior S3 failure, created [PR #885](https://github.com/shepherdjerred/monorepo/pull/885), and auto-merge was enabled through the GitHub connector.
  - Terminated the retrying workflow after PR creation to avoid duplicate refresh PRs.
- Reduced Temporal PR-review Anthropic rate-limit pressure:
  - Added `readPositiveIntegerEnv` in `packages/temporal/src/shared/env.ts`.
  - Defaulted `PR_REVIEW_SPECIALIST_PASS_CONCURRENCY` to `1`.
  - Defaulted the PR-review worker's `maxConcurrentActivityTaskExecutions` to `1`.
  - Added Homelab env vars for both knobs so deployed PR-review specialist traffic is serialized unless intentionally raised.
- Verification run:
  - `packages/homelab/src/cdk8s`: `bun run typecheck`, `bun run build`, `bun run lint`.
  - `packages/scout-for-lol/packages/backend`: `bun test scripts/lane-prior-s3.test.ts`, `bun run typecheck`, `bunx eslint --no-ignore scripts/lane-prior-s3.ts scripts/lane-prior-s3.test.ts`.
  - `packages/temporal`: `bun run typecheck`, `bun run lint -- --no-cache`, `bun test src/shared/env.test.ts src/activities/pr-review/specialists.test.ts src/activities/data-dragon-lane-priors.test.ts`.

### Remaining

- Prometheus PVC usage is still firing at about 93.05% immediately after the retention reduction; TSDB retention/compaction has not yet brought disk usage below the 90% alert threshold.
- `ScoutDataDragonUpdateFailed` is still firing from the earlier `lane-prior-generation-failed` metric sample in the 24-hour alert window, but the live rerun got past that failure and opened PR #885.
- PR #885 is open with auto-merge enabled and Buildkite still pending on the main typecheck/test/lint jobs.
- The Velero large-PVC alerts are still firing, including the Prometheus PVC; the alert path still cannot reliably see PVC backup/exclude labels from kube-state-metrics.
- Unrelated open PagerDuty incidents remain for `runVacuumIfNotHome`, Home Assistant template expansion, Roomba freshness, SSD write activity, and non-Prometheus large PVCs.

### Caveats

- The live Scout beta Secret patch is a temporary bridge; the durable fix is the Homelab Scout chart change.
- The live Temporal worker `AWS_REGION` patch is also a bridge; the durable fix is the Homelab Temporal worker chart change plus the Scout S3 client fallback.
- The Data Dragon retry workflow was intentionally terminated after PR #885 existed and auto-merge was enabled, to avoid a second generated PR from activity retry.
- PagerDuty and Prometheus state are point-in-time snapshots from 2026-05-23; Alertmanager grouping and 24-hour PromQL windows can lag behind remediations.

## Summary

This session triaged the live PagerDuty alert set, applied temporary live mitigations where needed, and prepared durable Scout, Prometheus, and Temporal fixes in PR #886. Scout beta and the Data Dragon lane-prior path were recovered, while Prometheus PVC pressure and time-windowed alerts still need post-merge observation.
