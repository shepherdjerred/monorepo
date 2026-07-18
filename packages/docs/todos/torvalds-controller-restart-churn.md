---
id: torvalds-controller-restart-churn
status: active
origin: packages/docs/plans/2026-07-18_ci-speed.md
---

# kueue + kyverno controllers restart 8-9×/day under load; webhook outages have Fail blast radius

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
