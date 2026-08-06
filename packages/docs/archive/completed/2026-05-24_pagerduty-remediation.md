---
id: reference-completed-2026-05-24-pagerduty-remediation
type: reference
status: complete
board: false
---

# PagerDuty Remediation

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

## Conclusion

The remediation reduced live Prometheus PVC usage by deleting the approved
`zfspv-pool-nvme/pvc-08c23bab-9a81-4206-b98a-6eac907eacb3@monthly-backup-20260401050007`
snapshot, added desired-state backup exclusions to prevent recurring snapshot
pressure, fixed the `HomeAssistantEntitiesUnavailable` annotation regex, and
made Data Dragon lane-prior subprocesses receive an explicit S3 region. The
code changes are pending normal PR merge and ArgoCD/GitOps deployment. After
merge, monitor Data Dragon lane-prior runs, confirm the `PVCStorageHigh` alert
stays clear, and resolve PagerDuty incident `Q3N6SLKHZ22Y69` manually if it
does not auto-resolve.
