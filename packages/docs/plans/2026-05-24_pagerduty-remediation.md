# PagerDuty Remediation

## Status

Partially Complete

## Summary

- Prometheus PVC is high because local ZFS snapshots consume most of the remaining quota; the pool itself is not full and the PVC expansion is already reflected in Kubernetes and ZFS.
- `HomeAssistantEntitiesUnavailable` has a Prometheus template annotation bug caused by an escaped dot in an embedded PromQL regex.
- The Temporal AI-provider rate-limit signal cleared; the remaining Temporal page is Scout Data Dragon lane-prior generation failing because the S3 SDK has no region configured for the SeaweedFS endpoint.

## Implementation Plan

- Prometheus PVC:
  - Re-check the exact ZFS dataset and snapshot usage before deleting anything.
  - Add explicit desired-state Velero exclusion labels for the Prometheus PVC.
  - With operator approval, prune the old Prometheus ZFS snapshot that is consuming the bulk of the space.
  - Verify ZFS snapshot usage, PVC usage, Prometheus alerts, and PagerDuty state after cleanup.
- Home Assistant alert:
  - Change the ignored-domain regex from an escaped-dot form to `[.]` so the annotation query is valid inside Prometheus template strings.
  - Add a focused test that rejects the bad escaped-dot rendering and confirms the fixed rendering.
- Temporal Data Dragon:
  - Add optional `awsRegion` to the lane-prior update config.
  - Pass deterministic `AWS_REGION` and `AWS_DEFAULT_REGION` values to both lane-prior subprocesses.
  - Clear inherited `ENVIRONMENT` for the Scout subprocesses to match the existing Data Dragon updater boundary.
  - Keep the Temporal AI-provider alert path unchanged unless it reappears.

## Verification Plan

- Run focused Homelab tests for the Home Assistant rule rendering.
- Build or render Homelab manifests enough to verify generated YAML contains `velero.io/backup: disabled`, `[.].*`, and no bad `\\..*` annotation query.
- Run the focused Temporal lane-prior test file and Temporal typecheck.
- Use live read-only Grafana/Prometheus queries after code verification.
- Use live Kubernetes/ZFS checks before and after any approved snapshot cleanup.

## Session Log - 2026-05-24

### Done

- Updated `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/homeassistant.ts` to render the unavailable-entity ignored-domain regex with `[.]` instead of an escaped dot inside the Prometheus template query.
- Added `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/homeassistant.test.ts` to assert the rendered annotation contains `[.].*` and not the bad escaped-dot form.
- Updated `packages/homelab/src/cdk8s/src/resources/argo-applications/prometheus.ts` so the Prometheus PVC desired state includes both `velero.io/backup: disabled` and `velero.io/exclude-from-backup: "true"`.
- Updated `packages/temporal/src/activities/data-dragon-lane-priors.ts` to support optional `awsRegion`, derive a deterministic region fallback, pass `AWS_REGION` and `AWS_DEFAULT_REGION` to both lane-prior subprocesses, and clear inherited `ENVIRONMENT`.
- Expanded `packages/temporal/src/activities/data-dragon-lane-priors.test.ts` for region/env propagation and fallback order.
- Updated the Temporal lane-prior test setup to pass an explicit `awsRegion`, avoiding dependence on the test runner's ambient AWS region environment.
- Deleted the live Prometheus ZFS snapshot `zfspv-pool-nvme/pvc-08c23bab-9a81-4206-b98a-6eac907eacb3@monthly-backup-20260401050007` after approval.
- Verified ZFS `usedbysnapshots` dropped from `126040267264` to `47183690752`, and Prometheus PVC usage dropped from `93.38%` to `61.04%`.
- Verified the live `PVCStorageHigh` alert for the Prometheus PVC was no longer firing.

### Remaining

- Deploy or merge the repo changes through the normal ArgoCD/GitOps path; no direct Kubernetes manifest apply was performed.
- PagerDuty incident `Q3N6SLKHZ22Y69` was still `triggered` immediately after the alert cleared, so it may need Alertmanager/PagerDuty sync time or manual resolution.
- `TemporalAiProviderIssueActive` was pending again for `anthropic` `rate_limit` from `pr_review_specialist`; no provider errors increased over the last hour, so this looks like a sticky active gauge rather than a fresh firing alert.
- Data Dragon alerts still fire from the existing 24h failure window until a new successful run or alert window expiry.

### Caveats

- `mise` emitted sandbox-only tracked-config symlink warnings during verification, but the commands completed after trusting the repo configs.
- Dependency installs were needed in this fresh worktree before tests could run.
- The existing untracked `packages/docs/logs/2026-05-23_pagerduty-checkin.md` predates this implementation pass and was left untouched.

### Verification

- `bun test src/resources/monitoring/monitoring/rules/homeassistant.test.ts`
- `bun run typecheck` in `packages/homelab/src/cdk8s`
- `bun run build` in `packages/homelab/src/cdk8s`
- Generated manifest check for `velero.io/backup: disabled`, `[.].*`, and absence of the bad `\\..*` annotation query.
- `bun test src/activities/data-dragon-lane-priors.test.ts`
- `bun run typecheck` in `packages/temporal`
- Targeted `bunx eslint` on the changed Homelab and Temporal files.
