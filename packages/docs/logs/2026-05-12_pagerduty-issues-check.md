# PagerDuty Issues Check

## Status

Complete

## Summary

Checked open PagerDuty incidents via `toolkit pd incidents --json` and correlated the infrastructure-backed alerts with Kubernetes, ArgoCD, Prometheus/Grafana, Loki, and Home Assistant.

Findings and actions:

- Removed the stale `status.sjer.red` / `status-page` project instead of repairing it. Active references were removed from cdk8s charts, ArgoCD app wiring, static-site probe config, CI chart inventory, image versions, SeaweedFS bucket config, and the old `poc/status-page` code.
- `birmel` is actively broken. The deployed image entrypoint bypassed the package `start` script and ran `bunx prisma db push && bun run src/index.ts`, so `.prisma/client` was never generated before startup. The Dagger image entrypoint now runs `bunx --trust prisma generate` first.
- `trmnl-dashboard` is currently healthy in Kubernetes and ArgoCD. The open PagerDuty incidents are stale from a previous rollout state.
- `ReleasedPVsAccumulating` was an alert-rule bug. `count(kube_persistentvolume_status_phase{phase="Released"})` counted phase series, not released PVs. Kubernetes and `sum(...)` both showed 1 actually Released PV. The alert now uses `sum(...)`.
- `VeleroOrphanAuditNotRunning` was a false positive. The Temporal worker logs show successful daily audits, but the alert used `rate(...[36h]) > 0` against a low-frequency counter that can reset on worker rollouts. The alert now uses `absent_over_time(...)`.
- `SustainedDiskWriteActivity` appears to be rolling-window residue from CI/Buildkite/Dagger write bursts. Current 5m disk write rates were low, but 24h container metrics were dominated by the `buildkite` namespace.
- `HomeAssistantEntitiesUnavailable` is a real Home Assistant inventory/integration issue, not a Kubernetes issue. The unavailable count was around 59-60, driven by stale/offline cloud, mobile app, Sonoff, Sonos, feeder, Roomba/Litter-Robot, utility, and other integration entities.

## Session Log - 2026-05-12

### Done

- Loaded PagerDuty, Kubernetes, Grafana, Buildkite, Dagger, TypeScript, Terraform/Tofu, Talos, and homelab deployment guidance before investigating.
- Queried PagerDuty, Kubernetes, ArgoCD, Prometheus/Grafana, Loki, and Home Assistant to root-cause the open incidents.
- Removed stale `status.sjer.red` / `status-page` active deployment and project files:
  - `poc/status-page`
  - `packages/homelab/src/cdk8s/helm/status-page`
  - `packages/homelab/src/cdk8s/src/resources/status-page`
  - `packages/homelab/src/cdk8s/src/resources/argo-applications/status-page.ts`
  - `packages/homelab/src/cdk8s/src/cdk8s-charts/status-page.ts`
- Removed `status-page` references from:
  - `packages/homelab/src/cdk8s/src/resources/s3-static-sites/sites.ts`
  - `packages/homelab/src/cdk8s/src/setup-charts.ts`
  - `packages/homelab/src/cdk8s/src/cdk8s-charts/apps.ts`
  - `packages/homelab/src/cdk8s/src/versions.ts`
  - `packages/homelab/src/tofu/seaweedfs/buckets.tf`
  - `scripts/ci/src/catalog.ts`
- Updated homelab docs that listed `status-page` as an active release/deployment surface.
- Fixed `.dagger/src/image.ts` so Prisma-backed Bun service images generate Prisma Client before `prisma db push` and app startup.
- Fixed the `ReleasedPVsAccumulating` Prometheus rule to use `sum(kube_persistentvolume_status_phase{phase="Released"}) > 5`.
- Fixed the Velero orphan audit freshness rule to use `absent_over_time(velero_orphan_audit_runs_total{outcome="success"}[36h])`.
- Verified active-code searches no longer find `status.sjer.red`, `status-page`, `status-page-api`, or `static-site-status` under `packages/homelab`, `scripts`, or `poc`.
- Ran verification:
  - `bun run typecheck` in `packages/homelab/src/cdk8s`
  - `bun run test` in `packages/homelab/src/cdk8s`
  - `bun run typecheck` in `scripts/ci`
  - `bun test` in `scripts/ci`
  - `bun scripts/check-dagger-hygiene.ts`
  - `tofu -chdir=packages/homelab/src/tofu/seaweedfs fmt -check buckets.tf`
  - package-local cdk8s ESLint on the changed cdk8s files

### Remaining

- Deploy the Dagger image-entrypoint fix so `birmel` gets a newly built image, then bump/deploy the image version if the pipeline does not handle that automatically.
- Apply/sync the homelab changes so ArgoCD stops managing `status-page`, Prometheus stops probing `status.sjer.red`, and Tofu removes the `status-page` SeaweedFS bucket if desired.
- Resolve or acknowledge stale PagerDuty incidents after the alert state clears, especially the trmnl incidents and the removed `status.sjer.red` alert.
- Decide whether to tune the disk-write alert for CI-heavy workloads or leave it as a rolling 24h pressure signal.
- Clean up Home Assistant unavailable entities/integrations or narrow the alert to actionable entities.

### Caveats

- I did not apply infrastructure changes, sync ArgoCD, resolve PagerDuty incidents, or delete live S3 data.
- `tofu -chdir=packages/homelab/src/tofu/seaweedfs fmt -check` still reports unrelated formatting drift in `backend.tf`; the edited `buckets.tf` passes `fmt -check` directly.
- A root-level ESLint command is not available because there is no root flat ESLint config. `scripts/ci` was verified by typecheck and tests instead.
- Existing unrelated dirty files were left untouched, including `.dagger/src/constants.ts`, `packages/discord-plays-pokemon/compose.yml`, `packages/docs/index.md`, and other untracked docs files.
