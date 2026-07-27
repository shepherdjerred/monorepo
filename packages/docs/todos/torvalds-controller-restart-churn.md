---
id: torvalds-controller-restart-churn
type: todo
status: in-progress
board: true
verification: agent
disposition: active
origin: packages/docs/archive/completed/2026-07-18_ci-speed.md
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

**Second failure mode observed the same evening (23:xx): silently-lost job
creates pin max-in-flight.** k8s Job CREATEs issued during a webhook outage
are rejected by the API server, but the agent-stack controller logs "creating
job" and never retries — the Buildkite jobs stay `reserved` forever with no
k8s Job backing them. Build 5663's six deploy-lane jobs (created 20:22:43,
mid-outage) became phantom reservations that counted against
`max-in-flight: 10`, so the controller stopped fetching ANY new work for 3+
hours (PR builds' upload jobs never even got "fetching job info" log lines).
Recovery required cancelling the whole build to release the reservations.
Upstream issue to check/file: agent-stack-k8s should retry failed Job
creates or reconcile reserved-but-missing jobs.

Recurrence within the hour: build 5680's `verify` job create was silently
lost during kueue's 23:49 restart (9 of 10 sibling jobs materialized; no ERR
logged for the lost one) — build unrecoverable, canceled + rebuilt as 5683.
Detection recipe that works: for each BK job in a non-terminal state,
`kubectl get job buildkite-<uuid>` — any miss ≥3 min after "creating job"
is a phantom. Consider a small scheduled canary that alerts on this.

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

## Remaining

- [ ] Observe at least 48 hours of normal production and CI volume after the
      liskov cutover; record controller restart deltas and Grafana evidence for
      synchronized probe-failure waves on torvalds.
- [ ] If counts remain flat, close this card with the observation window and
      dashboard queries. If churn recurs, correlate the timestamps with disk
      latency, ZFS txg activity, apiserver latency, and node memory before
      selecting remediation.

## Comment Log

- 2026-07-25: Re-scoped by the liskov cutover + Kueue removal (see
  `plans/2026-07-25_kueue-removal-node-symmetry.md`). The root cause
  hypothesis (whole-box I/O stalls under CI write storms) is addressed by
  moving CI off torvalds entirely, and Kueue — one of the two webhook victims
  AND a phantom-reservation source (builds 5663/5680) — is removed outright.
  Dropped now-moot Kueue-specific work items (leader-election tuning for
  kueue, kueue CPU requests, `vjob.kb.io` blast radius). Kyverno's Fail-mode
  webhook was already descoped from CI namespaces (kyverno.ts exclusion
  list). This todo now tracks post-cutover verification that the churn is
  gone, not active remediation.
- 2026-07-27: Board audit retained this as an agent-owned production observation,
  not operator work. The code cutover is complete; only a bounded live evidence
  window can confirm that the original synchronized restart signature stopped.
- 2026-07-27 production query at `2026-07-27T19:45:40.770Z`: the correct
  node join showed approximately 75 container restarts over the preceding 48
  hours, so the close condition failed. The largest deltas were
  `kube-scheduler-torvalds` (27.05), `kube-controller-manager-torvalds`
  (24.04), the Intel device-plugin operator (5.00), the Cloudflare operator
  (5.00), and the OpenEBS local-PV provisioner (4.00). This is a recurrence of
  the control-plane-heavy signature after CI moved to liskov; correlate these
  timestamps with disk, ZFS, apiserver, and node-memory data before choosing a
  remediation.
