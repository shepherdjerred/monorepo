---
id: seaweedfs-volume-size-proper-fix
type: plan
status: complete
board: false
---

# SeaweedFS volume-count exhaustion — proper fix (bigger volumes + alert)

## Context

Main CI has gone red **twice** on the same root cause: the SeaweedFS volume server
runs out of **volume slots** and returns HTTP 500 `No writable volumes` on every
`PutObject` that needs a fresh volume, failing the `deploy sites` step (the
`aws s3 sync` of static sites — most recently the new `wiki-sjer-red` bucket added
in PR #1784).

The real defect: `master.volumeSizeLimitMB` was unset, so it fell back to the
**helm chart default of 1000 MB (1 GiB)**. Every volume was capped at 1 GiB, so
88 GiB of real data was forced into **360 tiny volumes**, and the slot ceiling
(`maxVolumes: 360`) became effectively pinned to disk size. The prior "fix"
(PR #1344, `4c2c502ff`) just raised the count 297→360 and grew the PVC 256→384 GiB
— a band-aid that recurred five weeks later, exactly as its own follow-up note
predicted. The promised durable follow-up (scout image GC, `scout-image-gc-daily`,
PR #1376) already shipped but can't help: SeaweedFS vacuum compacts _within_ a
volume and never frees a volume _slot_.

Prior incident: `packages/docs/logs/2026-06-27_main-ci-red-seaweedfs-volume-exhaustion.md`.

## Root cause (verified live)

- `SeaweedFS_volumeServer_max_volumes = 360`, all 360 allocated, `Free = 0`.
- Largest volumes are exactly 1000–1002 MB → effective `volumeSizeLimitMB` = 1000.
- Disk is a non-issue: `/data` is 88 GiB / 384 GiB (**23% used**).
- `SeaweedFS_master_volume_creation_total{result="failure"} = 209` — the outage is
  recorded in a metric nothing alerted on (verified scraped: job `seaweedfs-master`,
  ns `seaweedfs`).
- `scout-prod` (130) + `scout-beta` (51) + scout-frontend\* (39) = 220 / 360 slots.

## The fix (shipped in this PR)

| #   | Change                                                                                                  | File                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | `master.volumeSizeLimitMB: 30_000` (30 GiB — upstream default)                                          | `resources/argo-applications/seaweedfs.ts`                                                      |
| 2   | `maxVolumes: 360 → 500` (immediate headroom)                                                            | same, `volume.dataDirs[0]`                                                                      |
| 3   | Rewrote the stale "1 Gi each / 256 Gi PVC" comment                                                      | same                                                                                            |
| 4   | New `PrometheusRule` (`SeaweedFSVolumeCreationFailing` warn/crit + `SeaweedFSVolumePVCStorageCritical`) | new `monitoring/monitoring/rules/seaweedfs.ts` + registered in `prometheus.ts` (ns `seaweedfs`) |

PVC stays **384 GiB** — untouched (disk usage is driven by bytes, not slot count).
30 GiB volumes → the same data needs a few dozen slots instead of 360; the ~360
pre-existing 1 GiB volumes stay allocated but become writable up to 30 GiB, so they
absorb new data instead of spawning fresh slots — the count stops climbing and
slowly consolidates. The alert closes the monitoring gap for the exact failure
mode (previously only the generic byte-level `PVCStorageHigh` existed).

Verified non-actions: no helm-types regen (`seaweedfs.ts` isn't a `helm-types`
generator input; both keys already typed), no PVC growth, no test changes, no
manual `kubectl` (ArgoCD `selfHeal` reverts).

## Rollout & immediate unblock

The main pipeline runs `deploy sites` **before** `argo sync + wait`, so merging
alone won't unblock the _same_ build — its `deploy sites` still hits the old
360 cap. Sequence:

1. Merge this PR to main.
2. Ensure the `seaweedfs` Argo app syncs (auto-sync + selfHeal, or
   `argocd app sync seaweedfs`). The `seaweedfs-volume` StatefulSet + `seaweedfs-master`
   pods roll to apply the new startup flags.
3. Verify `SeaweedFS_volumeServer_max_volumes = 500` and `Free > 0`, then **retry
   the `deploy sites` job** on the main build (`bk job retry`) → wiki bucket gets
   its volume, sync succeeds, main green.

## Verification

```bash
kubectl exec -n seaweedfs seaweedfs-volume-0 -- \
  sh -c "wget -qO- http://localhost:9327/metrics" | grep max_volumes   # → 500
kubectl exec -n seaweedfs seaweedfs-master-0 -- \
  sh -c "wget -qO- http://localhost:9333/dir/status" | grep -o '"Free":[0-9]*'  # → > 0
```

- Retry `deploy sites`; confirm wiki `_astro/*` PutObjects return 200 (no
  `No writable volumes` in `seaweedfs-s3` logs).
- After some deploys, confirm freshly-created volumes grow past 1 GiB (`/vol/status`).

## Related follow-ups (OUT OF SCOPE)

- Reclaim the existing 360 tiny volumes — optional operational vacuum; async, doesn't
  reliably free slots. Not needed given the headroom + size bump.
- `deploy sites` `retry: automatic` on agent-termination — separate CI-robustness gap
  (the earlier SIGTERM preemption, unrelated to SeaweedFS).
- `seaweedfs-lifecycle-provider-migration` todo already tracks the S3 lifecycle
  provider migration.

## Remaining

- [x] Land the doc-lint follow-up so a main build passes `verify` (PR #1866 merged
      the fix but its plan doc failed `verify` on markdownlint + frontmatter, so
      `argo sync` never ran and `maxVolumes: 500` was not applied).
- [x] Confirm the `seaweedfs` Argo app synced and `SeaweedFS_volumeServer_max_volumes = 500` / `Free > 0`.
- [x] Confirm a later main build deploys sites successfully without `No writable volumes` and returns main to green.
- [x] Mark this plan `status: complete` and move it to `archive/completed/`.

## Session Log — 2026-07-30

### Done

- Diagnosed main CI red: `deploy sites` failing on SeaweedFS 500 `No writable
volumes` (slot ceiling 360/360). Confirmed root cause = `volumeSizeLimitMB`
  defaulting to 1000 MB.
- `packages/homelab/src/cdk8s/src/resources/argo-applications/seaweedfs.ts`:
  added `master.volumeSizeLimitMB: 30_000`, bumped `maxVolumes` 360→500, rewrote
  the stale comment.
- New `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/seaweedfs.ts`
  (2 groups, 3 alerts) + registered in `prometheus.ts` (ns `seaweedfs`).
- Verified both alert metrics are scraped into Prometheus and correctly labeled.
- `bun run build` renders the changes; `typecheck`/`lint`/`test` green for
  `homelab`/`@homelab/cdk8s`.

### Caveats

- The fix does not reduce the existing 360 slots immediately; it stops growth and
  lets them consolidate over time. Immediate unblock comes from `maxVolumes: 500`.
- `deploy sites` still has no auto-retry on agent preemption (separate issue seen
  earlier this session — a SIGTERM'd deploy pod).

## Session Log — 2026-08-02

### Done

- Confirmed the documentation follow-up passed Buildkite main build #7353 and successor build #7357 also passed.
- Confirmed the `seaweedfs` Argo application is `Synced`/`Healthy`, `SeaweedFS_volumeServer_max_volumes` is `500`, and the master reports `133` free slots.
- Searched 72 hours of S3 logs and found no recurrence of `No writable volumes`; subsequent site deployment completed successfully.

### Remaining

- None.

### Caveats

- The 367 existing small volumes remain allocated, but the larger volume limit and 133 free slots remove the production blocker without destructive compaction.
