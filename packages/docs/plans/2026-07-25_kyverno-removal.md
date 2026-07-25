---
id: plan-2026-07-25-kyverno-removal
type: plan
status: in-progress
board: false
---

# Plan: Entirely remove Kyverno from the homelab cluster

## Context

Kyverno is a Kubernetes policy engine deployed on the single-node Talos cluster
(`torvalds`) via cdk8s + ArgoCD. Investigation (see
`packages/docs/logs/2026-07-25_homelab-recent-warnings-etcd-diagnosis.md`) found it
is doing almost nothing useful while actively worsening a cluster-wide incident:

- It enforces exactly **two** ClusterPolicies, **both non-blocking**:
  - `add-velero-backup-label` — mutates 6 PVCs in `prometheus`/`plausible`/`bugsink`
    to add `velero.io/backup: enabled` (the only load-bearing behavior).
  - `enforce-container-resource-limits` — **Audit-only** drift report for the
    `buildkite` namespace; nothing consumes it, Kueue is independent of it.
- Its admission webhooks are `failurePolicy: Fail`. On this shaky-etcd cluster the
  4 kyverno controllers lose their leader-election lease and crashloop (250–290
  restarts), so the fail-closed webhook **blocks Deployment/Pod/Job create/update/
  delete cluster-wide** whenever kyverno is down — a proximate cause of the
  cloudflare-tunnel `FailedApplying` events and a general operability hazard.

On a single-user, fully-GitOps cluster where every manifest comes from typed cdk8s
code, the guardrails kyverno exists to provide are better enforced at synth/lint
time. **Goal:** remove kyverno entirely, first relocating its one real job (Velero
backup labeling) into the charts/operator so no PVC silently drops out of backups.

**Decisions (confirmed with user):**

- **Single PR** — migrate labels + remove kyverno together. Existing PVCs keep the
  label kyverno already applied (mutation persists on the object), so there is no
  backup gap; verify post-merge with a manual Velero backup.
- **Drop** the `enforce-container-resource-limits` audit policy entirely (limits are
  already set statically; nothing depends on the report).

## Phase A — Relocate Velero backup labeling (DONE in this PR)

| PVC (namespace)                                                | New static source                                                                                   |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `alertmanager-*` (prometheus)                                  | `metadata.labels` on `alertmanager.alertmanagerSpec.storage.volumeClaimTemplate` in `prometheus.ts` |
| `storage-prometheus-grafana-*` (prometheus)                    | no change — `grafana-values.ts` already sets it                                                     |
| `pgdata-grafana-*` / `pgdata-plausible-*` / `pgdata-bugsink-*` | Zalando `inherited_labels`                                                                          |

Zalando postgres: added `labels: { "velero.io/backup": "enabled" }` to `metadata`
on the three `Postgresql` CRs (`postgres/bugsink-db.ts`, `plausible-db.ts`,
`grafana-db.ts`), plus `inherited_labels: ["velero.io/backup"]` on
`configKubernetes` in `argo-applications/postgres-operator.ts`. Because the
generated `postgres-operator` helm-values type omits `inherited_labels` (commented
out upstream), it is set on the ArgoCD Application's untyped `helm.valuesObject`
(spread merge, no type assertion). `cluster_labels` was deliberately **not** used —
it would also label `temporal-postgresql`, which is intentionally unbacked.

Render check confirmed: the 3 target CRs + alertmanager PVC carry the label,
`temporal-postgresql` does not, and the 4 Velero schedules still select on it.

## Phase B — Remove all Kyverno code (DONE in this PR)

- Deleted: `argo-applications/kyverno.ts`, `argo-applications/kyverno-policies.ts`,
  `resources/kyverno-policies.ts`, `resources/kyverno-policies.test.ts`,
  `cdk8s-charts/kyverno-policies.ts`, `helm/kyverno-policies/`,
  `generated/helm/kyverno.types.ts`.
- Edited: `cdk8s-charts/apps.ts`, `setup-charts.ts`, `misc/typed-helm-parameters.ts`,
  `versions.ts` (dropped the `kyverno` chart pin), `generated/helm/index.ts`, and the
  three stale minecraft velero comments.
- `bitnamilegacy/kubectl` pin in `versions.ts` was **kept** — it is used by Velero,
  not kyverno.
- Generated CRD imports (`*.kyverno.io.ts`, `wgpolicyk8s.io.ts`) are unused by `src/`
  and regenerate away on the next `update-imports` run.

## Phase C — Live-cluster cleanup (POST-MERGE, operator-run)

Removing kyverno from GitOps prunes its Deployment, but its self-managed
`Validating`/`MutatingWebhookConfiguration` objects are `failurePolicy: Fail` — if
they outlive the pods they block every matched write cluster-wide with no backend.
So, as an explicit operator step after the PR merges and Argo begins pruning:

1. Delete the webhook configs **first**:
   `kubectl delete validatingwebhookconfiguration,mutatingwebhookconfiguration -l webhook.kyverno.io/managed-by=kyverno`
   (verify names first).
2. Confirm the `kyverno` Application + namespace are pruned; delete orphans if not.
3. Delete leftover `PolicyReports`/`ClusterPolicyReports`, then the `*.kyverno.io`
   and `wgpolicyk8s.io` CRDs (no other consumer). `kubectl delete crd` is
   permission-prompted.

## Verification

**Static (done):** `bun run verify -- --affected` → 28 tasks, 0 failures
(typecheck, lint, test, knip, prettier, `check:talos`, `lint:helm`,
`check:1password`); `bun run build` render inspection confirmed the label migration.

**Live (post-merge, after Phase C):**

- `kubectl get pvc -A -l velero.io/backup=enabled` still lists all 6 target PVCs.
- Manual backup includes them: `velero backup create verify-kyverno-removal --wait`
  then `velero backup describe … --details`.
- Kyverno fully gone: no pods in `kyverno` ns, no `*.kyverno.io` CRDs, no kyverno
  webhook configs.
- A previously-blocked Deployment write succeeds immediately; cloudflare-operator
  `FailedApplying*` events stop.

## Rollback

Revert the PR — kyverno reinstalls via GitOps. Existing PVC labels persist on the
objects, so backups continue throughout. The upstream etcd instability is separate
and unaffected; this removal only takes kyverno off the critical path.

## Session Log — 2026-07-25

### Done

- Phase A + B implemented in worktree `feature/remove-kyverno`; `bun run verify -- --affected` green (28/28).
- Velero label migration render-verified; kyverno fully absent from `dist/`.

### Remaining

- Open draft PR; promote to ready after review.
- Phase C live-cluster cleanup (operator-run, post-merge) — webhook configs + CRDs.
- Update kyverno mentions in health-audit runbooks/guides; resolve
  `packages/docs/todos/torvalds-controller-restart-churn.md`.

### Caveats

- `inherited_labels` set via untyped `valuesObject` because the generated helm type
  omits it (commented-out upstream) — intentional, not a regen gap.
- The upstream etcd latency that caused kyverno's crashloops is a separate, unfixed
  issue tracked in the diagnosis log; this PR only removes kyverno as an amplifier.
