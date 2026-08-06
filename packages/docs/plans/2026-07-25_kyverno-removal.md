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
the original investigation) found it
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

**GitOps does NOT auto-remove kyverno after merge.** The `apps` Application and
both kyverno child Applications use `syncPolicy.automated: {}` — auto-sync with
**prune disabled** (see `packages/docs/todos/argocd-apps-prune-policy.md`), and the
CI sync (`packages/homelab/scripts/argocd.ts sync`) POSTs no `prune` flag. So when
this PR removes the kyverno manifests, Argo does **not** delete anything: the
`kyverno` and `kyverno-policies` child Applications linger as `requiresPruning`,
keep reconciling kyverno from their own Helm sources (`ServerSideApply`), and the
admission controller keeps its `failurePolicy: Fail` webhooks alive — the
cluster-wide write blocker persists indefinitely. (Flipping global prune on `apps`
is out of scope here — that TODO shows it would also delete the whole Dagger stack
in one shot; this teardown is fully explicit instead.)

Teardown is therefore a **deterministic, unconditional operator sequence** run
after merge. Order matters: it must (a) stop reconciliation so nothing revives
kyverno, (b) remove the fail-closed webhooks **without** ever leaving one pointing
at a dead backend, (c) cascade-delete the namespaced **and** cluster-scoped
resources, and (d) verify cluster-scoped cleanup. `automated:` here has
`selfHeal` off, so Argo will not re-create resources you delete by hand once its
Applications are gone — only kyverno's own admission controller re-creates
webhooks, which step 3 stops.

1. **Stop GitOps management** — delete the two orphaned child Applications
   **non-cascade** so Argo stops re-syncing kyverno from its Helm source (these
   Applications carry no `resources-finalizer.argocd.argoproj.io`, so this leaves
   the live resources in place for the controlled teardown below; it also clears
   the `requiresPruning` orphans):

   ```
   kubectl -n argocd delete application kyverno kyverno-policies --cascade=orphan
   ```

2. **Remove the webhooks while the backend is still alive** (no dead-backend
   window — the pods are Running, so deleting the webhooks simply unblocks writes;
   kyverno just stops intercepting). Verify names/labels first (kyverno labels its
   configs `webhook.kyverno.io/managed-by=kyverno`; also catch any by `kyverno-`
   name prefix):

   ```
   kubectl delete validatingwebhookconfiguration,mutatingwebhookconfiguration \
     -l webhook.kyverno.io/managed-by=kyverno
   ```

3. **Immediately scale all kyverno controllers to 0** so the admission controller
   cannot re-create the webhooks it manages:

   ```
   kubectl -n kyverno scale deploy --all --replicas=0
   ```

4. **Re-check and re-delete** any webhook the controller may have re-created in the
   gap between steps 2 and 3, then confirm zero remain (controllers are now at 0,
   so none come back):

   ```
   kubectl get validatingwebhookconfiguration,mutatingwebhookconfiguration | grep -i kyverno   # expect none
   ```

5. **Cascade-delete the rest — namespaced and cluster-scoped.** Deleting the
   namespace only removes namespaced objects; kyverno's cluster-scoped RBAC (~16
   ClusterRoles + ~7 ClusterRoleBindings) and any `ClusterPolicy` objects must be
   deleted explicitly (verify the selector; fall back to the `kyverno` name prefix):

   ```
   kubectl delete namespace kyverno
   kubectl delete clusterrole,clusterrolebinding -l app.kubernetes.io/part-of=kyverno
   kubectl delete clusterpolicy --all
   ```

6. **Delete reports, then CRDs** — leftover `PolicyReports`/`ClusterPolicyReports`,
   then the `*.kyverno.io` and `wgpolicyk8s.io` CRDs (no other consumer; deleting
   the CRDs garbage-collects any remaining CRs). `kubectl delete crd` is
   permission-prompted:

   ```
   kubectl delete policyreports,clusterpolicyreports --all -A
   kubectl delete crd -l app.kubernetes.io/part-of=kyverno   # *.kyverno.io + wgpolicyk8s.io; verify list first
   ```

## Verification

**Static (done):** `bun run verify -- --affected` → 28 tasks, 0 failures
(typecheck, lint, test, knip, prettier, `check:talos`, `lint:helm`,
`check:1password`); `bun run build` render inspection confirmed the label migration.

**Live (post-merge, after Phase C):**

- `kubectl get pvc -A -l velero.io/backup=enabled` still lists all 6 target PVCs.
- Manual backup includes them: `velero backup create verify-kyverno-removal --wait`
  then `velero backup describe … --details`.
- Kyverno fully gone — check **cluster-scoped**, not just the namespace:
  - `kubectl get ns kyverno` → `NotFound`; no kyverno pods anywhere.
  - `kubectl -n argocd get application kyverno kyverno-policies` → both `NotFound`
    (the `requiresPruning` orphans are cleared).
  - `kubectl get validatingwebhookconfiguration,mutatingwebhookconfiguration | grep -i kyverno` → empty.
  - `kubectl get clusterrole,clusterrolebinding | grep -i kyverno` → empty.
  - `kubectl get crd | grep -E 'kyverno\.io|wgpolicyk8s\.io'` → empty.
- A previously-blocked Deployment write succeeds immediately; cloudflare-operator
  `FailedApplying*` events stop.

## Rollback

Revert the PR — kyverno reinstalls via GitOps. Existing PVC labels persist on the
objects, so backups continue throughout. The upstream etcd instability is separate
and unaffected; this removal only takes kyverno off the critical path.
