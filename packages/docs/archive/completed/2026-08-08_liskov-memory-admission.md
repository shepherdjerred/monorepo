---
id: 2026-08-08-liskov-memory-admission
type: plan
status: complete
board: false
---

# liskov memory reservations and weighted CI admission

Liskov has approximately 128GiB of physical memory but only about 83GiB of
Kubernetes allocatable memory because kubelet reserves 32GiB for the system,
4GiB for the pod runtime, and 4GiB as the hard eviction floor. Prometheus soak
data shows that the CI-only node can safely return 8GiB to scheduling while
retaining the 16GiB ZFS ARC allowance and the existing eviction armor.

## Changes

- Reduce liskov `systemReserved.memory` from 32Gi to 24Gi.
- Restore Buildkite-only Kueue admission with a `ClusterQueue` of 24 CPU,
  80Gi memory, 20 pods, and 100Gi ephemeral storage. A later capacity audit
  raises only the count quota to 24.
- Keep Buildkite `max-in-flight=20` for this rollout; the later capacity audit
  raises it to 24 in lockstep with Kueue.
- Alert on liskov below 8Gi available memory for 1 minute, below 4Gi or
  Kubernetes `MemoryPressure` immediately, and a 30-minute Buildkite Kueue
  backlog. The warning window fires before kubelet's eviction grace period;
  the critical rule has no delay because the hard eviction threshold has no
  grace period.

## Rollout

Apply the complete worker Talos configuration with the existing cluster
secrets and `--mode=no-reboot`; do not apply a partial kubelet patch. Verify
the node remains Ready. The later live capacity baseline reports approximately
83.5Gi allocatable memory; that observed value supersedes this plan's earlier
91Gi projection. Deploy the Kueue controller and CRDs through ArgoCD, then
activate the Buildkite namespace queue configuration through ArgoCD.

Validate normal jobs are admitted, oversized concurrent requests are
suspended rather than rejected, and no admission or FailedCreate storm occurs.
Rollback by reapplying the previous complete Talos configuration with 32Gi,
or by removing Kueue namespace management and queues before reverting the
Kueue controller.
