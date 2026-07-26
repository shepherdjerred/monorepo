---
id: log-2026-07-25-homelab-recent-warnings-etcd-diagnosis
type: log
status: complete
board: false
---

# Homelab "Recent Warnings" — full diagnosis

Investigated the 10 warning-event reasons shown in the homelab dashboard
("Recent Warnings" panel) against the live `torvalds` single-node Talos cluster
(k8s v1.36.2, Talos v1.13.6).

## Root cause: etcd request timeouts

`kube-apiserver` (port 7445 KubePrism, 0 restarts / 3d21h) is up but its calls to
etcd (`127.0.0.1:2379`) time out constantly:

- `etcdserver: request timed out` — **198 occurrences in the last 2000 apiserver log lines**
- `rpc error: code = Unavailable / DeadlineExceeded` on `KV/Txn` and `KV/Range`
- etcd status: DB **512 MB allocated / 75 MB in use (14.6%)** → ~85% fragmentation;
  **RAFT TERM 158** (a single-node member should essentially never re-elect — high term = repeated stalls/restarts)
- Node is NOT resource-starved: CPU 15%, mem 70%, no MemoryPressure/DiskPressure.
  → points at **etcd disk fsync latency + write churn**, not CPU/RAM.

Contributing churn: 11,143 Event objects cluster-wide, heavy Buildkite Job/Pod
create+delete, argocd-image-updater rewriting ReplicaSets (observed stale-read
conflict), Kyverno policy reports.

## Cascade — how each warning maps to the root cause

| Reason                                                              | Count          | Cause                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **BackOff**                                                         | 992            | kube-scheduler (67 restarts) & kube-controller-manager (65 restarts) **lose leader-election leases** (`leases/...?timeout=5s: context deadline exceeded` → `Leaderelection lost` → exit 1). Operators (kyverno, cloudflare, intel-device-plugin, nfd) crashloop on the same apiserver flapping. |
| **Unhealthy**                                                       | 831            | Liveness/readiness probes time out because the apiserver they depend on is flapping. kube-state-metrics (11 restarts), kyverno admission+cleanup, cloudflare-operator, nfd.                                                                                                                     |
| **FailedApplyingConfig** / **FailedConfigure** / **FailedApplying** | 801 / 618 / 45 | **All** cloudflare-operator `homelab-tunnel` ClusterTunnel + TunnelBindings: "Failed to apply ConfigMap to Deployment" — apiserver writes time out.                                                                                                                                             |
| **Sync**                                                            | 8              | Zalando postgres-operator (`kind: postgresql`) "could not sync … could not patch annotations" + "failed calling webhook" — apiserver/webhook (kyverno) timeouts.                                                                                                                                |

## Independent / expected categories (NOT etcd)

| Reason                   | Count | Cause                                                                                                                                                                                                              |
| ------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **PolicyViolation**      | 2102  | Kyverno `enforce-container-resource-limits` in **Audit** mode (non-blocking). Buildkite CI pods/jobs don't set cpu/memory limits → one audit event per pod. Cosmetic, but the buildkite churn feeds the etcd load. |
| **Pending**              | 451   | Buildkite ephemeral CI job pods waiting to schedule — partly normal CI churn, aggravated by scheduler crashlooping.                                                                                                |
| **DeadlineExceeded**     | 102   | Buildkite Jobs exceeding activeDeadlineSeconds.                                                                                                                                                                    |
| **BackoffLimitExceeded** | 76    | Buildkite Jobs hitting backoffLimit and failing.                                                                                                                                                                   |

## Remediation (prioritized)

1. **Fix etcd disk latency** (#1). Verify what disk etcd's WAL is on; it needs a
   dedicated low-latency NVMe. `talosctl -n 100.102.88.88 etcd defrag` to reclaim
   the ~85% fragmentation. Check `talosctl dmesg`/disk metrics for fsync latency.
2. **Cut write churn**: set resource limits on Buildkite agent pods (also kills the
   2102 PolicyViolations) and cap job concurrency; lower apiserver `--event-ttl`
   (11k events); investigate argocd-image-updater ReplicaSet rewrite fight.
3. **Band-aid**: raise `--leader-elect-lease-duration`/`renew-deadline` for
   scheduler + controller-manager so a transient 5s etcd stall doesn't crashloop
   the control plane (treats symptom, not cause).

## argocd-image-updater — removed (orphaned, unused)

Confirmed unused: 0/67 Applications opted in (no annotations), 0 ImageUpdater CRs
("No ImageUpdater CRs to process"), no repo reference (removed from GitOps in
commit `1db6da590`, 2026-02-21), no Helm release secret — orphaned Helm install
(chart 1.0.4) left running 186d. Image bumps are done via Renovate. Its dead
controller was crashlooping on etcd lease timeouts and churning its own
ReplicaSet/lease in etcd.

**Deleted** (2026-07-25): deployment `argocd-image-updater-controller` (+RS/pod),
configmaps `argocd-image-updater-config` + `-ssh-config`, SA `argocd-image-updater`,
roles `argocd-image-updater` + `-leader-election-role`, both rolebindings,
clusterrole + clusterrolebinding `argocd-image-updater`. **Left:** CRD
`imageupdaters.argocd-image-updater.argoproj.io` (0 instances; delete denied by
permission prompt — harmless, can be removed later).

## SECOND MAJOR FINDING: kyverno admission webhook is a fail-closed cluster blocker

While deleting image-updater's Deployment, the delete was rejected by
`validate.kyverno.svc-fail` (`connection refused` to `kyverno-svc:9443`).

- `kyverno-admission-controller` has **250+ restarts**, exits **`Completed`/`exit=0`**
  (graceful) — it's **losing its leader-election lease to etcd timeouts** and
  controller-runtime shuts down cleanly. Same failure mode as scheduler/kcm.
- The webhook is **`failurePolicy: Fail`** and matches **CREATE/UPDATE/DELETE on
  pods, deployments, daemonsets, replicasets, statefulsets, cronjobs, jobs**,
  excluding only namespaces `kyverno, kube-system, buildkite, kueue-system`.
- ⇒ While kyverno is down (most of the time), **all Deployment/Pod/Job mutations
  in every other namespace are blocked cluster-wide.** This is a second, proximate
  cause of the cloudflare `FailedApplying*` events (tunnel Deployment applies
  rejected by the webhook), on top of the raw etcd write timeouts.
- Deletion only succeeded by retrying into one of kyverno's brief up-windows.

Implication: fixing etcd also fixes kyverno (lease stops dropping) → unblocks
Deployment mutations. Interim option: set that webhook to `failurePolicy: Ignore`
so a kyverno outage doesn't freeze cluster workload changes (trade-off: policy not
enforced during the gap).

## Session Log — 2026-07-25

### Done

- Aggregated all 10 warning reasons by count + involvedObject against live cluster.
- Traced BackOff/Unhealthy/FailedApplying\*/Sync to a single root cause: etcd request timeouts.
- Confirmed via apiserver logs (`etcdserver: request timed out` ×198/2000 lines), `talosctl etcd status` (RAFT term 158, 85% fragmentation), and leader-election-lost crash lines for scheduler + controller-manager.
- Classified PolicyViolation + Buildkite Pending/DeadlineExceeded/BackoffLimitExceeded as independent/expected.
- **Removed the orphaned argocd-image-updater** install (see section above) — all namespaced + cluster-scoped RBAC objects deleted; empty CRD left (delete denied).
- **Discovered kyverno fail-closed webhook is blocking Deployment/Pod/Job mutations cluster-wide** while kyverno crashloops on etcd (see section above).

### Remaining

- No etcd fix applied (read-only diagnosis). Remediation steps above are unactioned.
- etcd disk-latency verification requires `talosctl` disk/dmesg inspection not yet run.
- Leftover CRD `imageupdaters.argocd-image-updater.argoproj.io` (delete denied by permission prompt).
- Decide on kyverno webhook `failurePolicy: Ignore` as interim mitigation.

### Caveats

- Single-node cluster: control-plane crashloops have no HA fallback, so etcd stalls = brief full API unavailability windows.
- Kyverno resource policy is Audit for limits BUT the admission webhook itself is `failurePolicy: Fail` — so kyverno being _down_ blocks workload mutations even though the limits policy is only "audit".
- The etcd instability is the upstream cause of BOTH the control-plane crashloops AND the kyverno-webhook cluster block; treat etcd disk latency as the priority-1 fix.
