---
id: alert-dashboard-postgresql-retirement
type: todo
status: planned
board: true
verification: human
disposition: blocked
source_marker: false
---

# Decide the fate of the retired Alert Dashboard PostgreSQL

## What

`feat(alert-dashboard): replace PostgreSQL ledger with SQLite` (#2129, commit
`8bc894fad`) moved the ledger onto the `alert-dashboard/alert-dashboard-data`
PVC and removed PostgreSQL from the chart, but deliberately left the live
database running. From that commit's own body:

> Live PostgreSQL cleanup is intentionally not included because the cluster
> currently has a bound 16 GiB PVC; history export/import or discard must be
> decided before cutover.

That decision is still open, and the leftovers are real: the Zalando
`postgresql/alert-dashboard-postgresql` cluster, its `alert-dashboard-postgresql-0`
pod, the bound 16 GiB `pgdata-alert-dashboard-postgresql-0` PVC (backup
enabled), two `Certificate`s, two `Issuer`s, and
`NetworkPolicy/alert-dashboard-postgres-netpol`.

Because the chart no longer declares them, ArgoCD classified all six as
extraneous. `alert-dashboard` therefore reported `Sync=OutOfSync` forever,
and `argocd.ts release-health-wait` failed every main build with
`Release tree did not become ready: alert-dashboard: Sync=OutOfSync
Health=Healthy` (build 9347). The Application declares
`automated: { enabled: true }` with no `prune`, so CI could never clear them
either — and enabling prune would have destroyed the very history this decision
is about.

To unblock main on 2026-08-13 the six resources were annotated
`argocd.argoproj.io/compare-options: IgnoreExtraneous` directly in the cluster,
which excludes them from the app's sync comparison without deleting anything.
That is deliberately non-destructive and deliberately temporary: it is live
state with no representation in git, so it must not outlive the decision below.

## Remaining

- [ ] Decide whether the PostgreSQL alert history is exported into the SQLite ledger, archived elsewhere, or discarded.
- [ ] Execute that decision against the live database before removing anything.
- [ ] Delete the six retired resources and the `pgdata-alert-dashboard-postgresql-0` PVC, then drop its entry from `packages/homelab/src/cdk8s/src/backup-policy/pvc-backup-policy.json`.
- [ ] Remove the `IgnoreExtraneous` annotations so no untracked ArgoCD escape hatch is left behind, and confirm `alert-dashboard` still reports `Synced`.
- [ ] Confirm the retained alert history was handled as intended before the database was destroyed.

## Comment Log

### 2026-08-13 — filed while recovering main CI

The deferred cleanup became a hard CI blocker rather than a background item:
every main build failed in `release-health-wait` until the six resources were
excluded from the comparison. Pruning was rejected as the fix because #2129
explicitly reserved the export/discard call for a human.
