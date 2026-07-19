---
id: log-2026-06-12-kueue-quota-bump
type: log
status: complete
board: false
---

# Kueue Buildkite Quota Bump — 5 CPU / 10Gi → 7.5 CPU / 16Gi

## Context

During a CI burst on 2026-06-12, the `buildkite` ClusterQueue had 15 workloads admitted with
9–10 suspended in queue. Checked whether raising the quota was safe before changing it:

- **Node (torvalds, 32c/128Gi):** CPU requests already at 92% allocated (29.6 cores) — the
  scheduler, not Kueue, is the next ceiling. Only ~2.5 cores of request headroom remain.
- **Actual utilization (24h peaks):** CPU 89%, memory 87%. Memory is the incompressible risk,
  partially softened by ZFS ARC (which doesn't count as available but evicts under pressure).
- **Thermals:** NVMe peaked ~57°C vs 85°C crit — non-issue.

Conclusion: a modest raise is safe; a large one would just convert Kueue-suspended jobs into
unschedulable Pending pods. User chose 7.5 CPU / 16Gi.

## Change

- `packages/homelab/src/cdk8s/src/resources/kueue-config.ts` — `nominalQuota` 5 → `7500m` CPU,
  `10Gi` → `16Gi` memory.
- Fixed the stale doc comment that claimed the quota was "50% of node resources (16 CPU / 64Gi)";
  it now states the real values and why raising further is counterproductive.

Deploys via ArgoCD on merge; no manual apply.

## Session Log — 2026-06-12

### Done

- Investigated CI load (Kueue admission, node requests, 24h utilization peaks, NVMe temps).
- Raised buildkite ClusterQueue nominal quota to 7.5 CPU / 16Gi in
  `packages/homelab/src/cdk8s/src/resources/kueue-config.ts`; corrected stale comment.
- Verified: homelab `bun run typecheck` clean, eslint clean on the changed file.

### Remaining

- Verify after merge that ArgoCD synced the ClusterQueue (`kubectl get clusterqueue buildkite -o yaml`)
  and that queue wait times drop during the next CI burst without memory pressure
  (watch `node_memory_MemAvailable_bytes` floor vs the previous 87% peak).

### Caveats

- Node CPU _requests_ sit at 92% — beyond ~7.5 CPU of quota, admitted pods would go Pending at
  the scheduler. Don't raise further without first reclaiming requests from other namespaces.
- Buildkite agent-stack concurrency also gates parallelism; if bursts still queue, check that
  side before touching Kueue again.

## Update — same day

The "reclaim requests from other namespaces" caveat was actioned in the same PR: a full
cluster right-sizing landed as the second commit. See
[2026-06-12_k8s-resource-rightsizing](../plans/2026-06-12_k8s-resource-rightsizing.md) —
node CPU requests drop from ~92% to ~60%, so the 7.5 CPU quota now has real headroom.
