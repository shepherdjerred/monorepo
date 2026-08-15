---
id: plan-2026-08-11-alertmanager-alert-remediation
type: plan
status: in-progress
board: false
---

# Alertmanager alert remediation

## Summary

Resolve the confirmed alert-pipeline defects, repair Home Assistant integrations
that failed to recover after the DNS outage, replace misleading monitoring
policies, and perform a guarded one-time cleanup of confirmed orphaned storage.

Implement this as one git-spice PR from current `main`. Deploy only through the
normal Buildkite and exact-revision ArgoCD release path. Live Prometheus,
Kubernetes, logs, and storage state are the rollout acceptance oracle.

## Alert delivery and reconciliation

- Correct the Alert Dashboard service identity in its availability rule and
  Grafana dashboard.
- Correct Alertmanager's Postal SMTP service address and test the rendered
  configuration.
- Accept an omitted `generatorURL` in Alertmanager snapshots, persist it as
  `null`, and retain the strict webhook contract.
- Keep `Watchdog` and `InfoInhibitor` as non-paging control signals, but replace
  the stock `InfoInhibitor` expression so pending info alerts do not activate
  inhibition before Alertmanager receives them.

## Temporal and Home Assistant

- Make Prometheus the sole producer of report-freshness alerts. Add an explicit
  receipt activation instant and a non-alerting `pending` state until a schedule
  has had a post-activation action plus its grace period.
- Require safe operation labels for redacted Scout git and GitHub commands.
- Patch the pinned Mysa integration to recover from an uninitialized session by
  reauthenticating once, without returning stale temperature data.
- Keep the full unavailable-entity inventory informational. Warn only on
  explicit Temporal automation dependencies and the existing dedicated
  Roborock signals.

## Monitoring and storage

- Scope Velero size metrics to PVCs labeled `velero.io/backup=enabled`.
- Replace stock cluster failover memory math with production-node request
  saturation monitoring plus the existing runtime-pressure signals.
- Exclude the CI-only node from generic SSD-write rules and retain the dedicated
  Buildkite write budget and NVMe health signals.
- Add a two-phase R2 orphan cleanup command whose apply step aborts unless a
  reviewed manifest still matches a freshly recomputed inventory.
- After merge, use the guarded command to delete confirmed orphan R2 prefixes,
  then delete only the six explicitly inventoried retired Jellyfin and Plane
  ZFSVolume/PV pairs after independent safety checks.
- Automatic backup pruning remains disabled.

## Verification and rollout

- Add focused Alert Dashboard, Temporal, Home Assistant patch, Prometheus rule,
  Helm rendering, and R2 cleanup safety tests.
- Run focused package typecheck, tests, and lint, followed by the staged-file
  pre-commit gate. Buildkite remains the exhaustive repository gate.
- After the exact-SHA main release, verify delivery and reconciliation health,
  single-source report alerts, Home Assistant integration recovery, corrected
  policy signals, zero confirmed R2 orphans, and absence of all six retired
  PV/ZFSVolume/dataset identities.

## Assumptions

- Home Assistant availability is split by actionability.
- Memory monitoring is topology-aware.
- Guarded full storage cleanup is authorized, but only after merged tooling and
  fresh target revalidation.
- The unrelated local Brim working-tree edit remains untouched and unstaged.
