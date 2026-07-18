---
id: torvalds-controller-restart-churn
status: active
origin: packages/docs/plans/2026-07-18_ci-speed.md
---

# Control-plane-wide restart churn on torvalds under CI load (probe-stall waves); webhook outages have Fail blast radius

Observed 2026-07-18 while diagnosing the CI freeze (zombie dind pod): during a
CI load spike (node memory at 107% of allocatable, apiserver slow),
`kueue-controller-manager` lost its leader lease ("context deadline exceeded"
renewing against the apiserver → `leader election lost` → exit 1) and all four
kyverno controllers restarted in the same minute. Both were at **8-9 restarts
in 22h** — this is chronic, not a one-off.

Consequences beyond the fixed zombie-dind case: while their webhooks are down,
every Job create/update in covered namespaces is rejected
(`failurePolicy: Fail` on `vjob.kb.io` and `validate.kyverno.svc-fail`).
Anything that races a restart window fails or wedges.

**Wider evidence (same day, deeper look): the churn is control-plane-wide,
not kueue/kyverno-specific.** In the node's 23h uptime: kube-proxy 37
restarts, kube-controller-manager 15 (one restart observed live, 2 min into
the investigation), kube-scheduler 15, flannel 18, coredns 11, plus every
operator at 11-15. Failure signature is uniform: liveness probes fail with
`connection refused` — including kube-controller-manager's own
localhost:10257 — in synchronized waves during CI activity. No OOM events;
kube-apiserver itself has 0 restarts. Processes aren't being killed by
memory — they stop serving, then kubelet kills them.

**Leading hypothesis:** whole-box I/O stalls during CI's small-file write
storms — the documented ZFS txg-sync backpressure behavior (see the
Dagger-era notes: cold-cache `bun install` parks in uninterruptible D-state
during txg storms). During a stall, nothing can answer probes or renew
leases → mass restarts → webhook outage windows. Verify with: node_exporter
disk/txg metrics vs probe-failure timestamps in Grafana; whether etcd and
the controllers' filesystems sit on the affected pool; `ps` D-state samples
during a build. Note the restart waves are ~13-15 min apart — check what
runs on that period.

Work items:

1. Why does lease renewal time out? Check apiserver latency metrics during CI
   spikes (Grafana), etcd fsync latency, and whether kueue/kyverno CPU
   requests (kueue: 100m req / 1 CPU limit) get starved under node pressure —
   leader-election renewal is CPU+network bound.
2. Consider raising leader-election `leaseDuration`/`renewDeadline` for kueue
   and kyverno (helm values) so a slow apiserver window doesn't kill them.
3. Node memory overcommit: usage was 107% of allocatable. Audit top consumers
   and limits; sustained >100% makes every probe/lease flaky.
4. Evaluate webhook `failurePolicy`/scope: does kyverno need to validate
   `batch/v1 Job` updates in the buildkite namespace at all? Narrowing scope
   shrinks the Fail blast radius during restarts.
5. Priority/preemption: kueue + kyverno run at default priority; CI pods run
   `batch-low`. Verify system controllers preempt CI under pressure (they
   should never lose CPU to a docker build).
