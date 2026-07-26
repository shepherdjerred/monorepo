---
id: log-disruption-budgets-diagnosis-2026-07-25
type: log
status: complete
board: false
---

# Disruption Budgets Diagnosis

## Findings

- Aptakube's workload overview directly summarizes all 11 live PodDisruptionBudget condition reasons:
  - Seven ordinary budgets report `DisruptionAllowed=True`, reason `SufficientPods`.
  - Four Zalando Postgres operator budgets report `DisruptionAllowed=False`, reason `InsufficientPods`:
    - `bugsink/postgres-bugsink-postgresql-critical-op-pdb`
    - `plausible/postgres-plausible-postgresql-critical-op-pdb`
    - `prometheus/postgres-grafana-postgresql-critical-op-pdb`
    - `temporal/postgres-temporal-postgresql-critical-op-pdb`
- The four red budgets select `critical-operation=true`. No Postgres pod has that temporary label in steady state, so each budget has `expectedPods: 0`, `desiredHealthy: 0`, and `disruptionsAllowed: 0`. The reason label is cosmetic and does not mean four application pods are unhealthy.
- All four have continuously reported this same condition since June 13, confirming that the panel state is load-independent steady-state behavior.
- The deployed Zalando Postgres operator is pinned to `v1.15.1`, and its live
  `OperatorConfiguration` already sets `enable_pod_disruption_budget: false`.
  In that release, disabling PDBs sets `minAvailable: 0`; it does not suppress
  their creation.
- Zalando's `v1.15.1` implementation always generates the critical-operation
  PDB and reconciles it on every cluster sync. Editing or deleting one in
  Aptakube would therefore be reverted or recreated.
- No Aptakube setting was found for excluding particular PDBs from the workload
  overview. Aptakube has a dedicated PDB UI, so representing a zero-target,
  zero-required-health PDB as neutral instead of `InsufficientPods` is the
  smallest durable fix.
- Zalando issue
  [`#3020`](https://github.com/zalando/postgres-operator/issues/3020) tracks
  this exact idle critical-operation PDB noise. An abandoned on-demand PDB
  implementation in
  [`#3024`](https://github.com/zalando/postgres-operator/pull/3024) would also
  fix Aptakube by deleting the critical PDB whenever no critical operation is
  active.
- A newer proposed fix,
  [`#3141`](https://github.com/zalando/postgres-operator/pull/3141), changes
  the critical budget to `maxUnavailable`. That prevents the standard
  Prometheus alert, but it does not fix Aptakube's condition summary:
  Kubernetes assigns `InsufficientPods` whenever `disruptionsAllowed` is zero,
  including a zero-target PDB.
- All four Postgres pods were Running and Ready, but their operator CRs were `SyncFailed` after reconciliation calls hit the unavailable Kyverno admission webhook.
- A separate control-plane incident was active during the diagnosis:
  - The API server alternated between passing readiness and failing both `etcd` and `etcd-readiness`.
  - Kube controller manager, scheduler, and Kyverno controllers repeatedly lost leader-election leases and restarted.
  - At 12:15 PDT, `nvme0n1` writes peaked at 308.1 MiB/s with weighted I/O queue 3,568.
  - Buildkite container writes peaked at 312.3 MiB/s at 12:17 PDT, and 13 Buildkite pods were running at 12:20 PDT.
  - At the final snapshot, writes were 140.4 MiB/s, weighted I/O queue was 1,124, Buildkite writes were 81.0 MiB/s, and 11 Buildkite pods were running.
  - etcd logged a 13.38-second `fdatasync`, multi-second reads, failed leadership checks, and context deadlines. Prometheus had `KubeAPIErrorBudgetBurn` firing, with disk-I/O saturation alerts pending.

## Session Log — 2026-07-25

### Done

- Traced the Aptakube summary to the exact 11 live PodDisruptionBudgets and confirmed the four red conditions are operator-generated steady-state noise.
- Confirmed in follow-up that all four red conditions have remained unchanged since June 13, including during calm periods.
- Verified the four Postgres pods, PDB selectors and status fields, Postgres operator status and events, Kyverno admission availability, control-plane readiness, Talos and etcd health, Prometheus metrics, and active alerts.
- Correlated the simultaneous controller failures with Buildkite-driven `nvme0n1` I/O saturation.
- Verified against the pinned Zalando operator source that manual PDB edits or
  deletion will not persist, even though the operator's PDB configuration is
  already disabled.
- Found and evaluated the two upstream implementations proposed for this exact
  issue, distinguishing the Prometheus-only fix from the on-demand lifecycle
  change that would remove Aptakube's false red count.
- Kept all cluster and CI inspection read-only.

### Remaining

- Decide between reporting the misleading zero-target state to Aptakube or
  deploying a temporary custom Zalando operator image based on the on-demand
  PDB implementation from upstream pull request `#3024`.
- Containing the active I/O incident or changing the misleading dashboard requires explicit authorization because either action would mutate CI/runtime or infrastructure state.

### Caveats

- The PDB panel is not the cause of the incident; PodDisruptionBudgets only constrain voluntary evictions.
- A custom operator fork would remove the Aptakube noise but adds ongoing image
  and upgrade maintenance for a cosmetic issue.
- The currently open Zalando pull request `#3141` is not sufficient for this
  Aptakube screen even if it merges, because the Kubernetes condition remains
  `InsufficientPods` at zero allowed disruptions.
- The final snapshot still showed intermittent etcd readiness failure, ongoing controller restarts, one Kyverno controller not Ready, and four Postgres CRs at `SyncFailed`.
- The session log passes Markdown lint. The repository-wide docs invariant check is red on invalid IDs in three other untracked logs: `2026-07-22_ci-main-shelfbridge-private-image.md`, `2026-07-24_resume-review.md`, and `2026-07-25_ebook-bindery-first-boot-config.md`.
