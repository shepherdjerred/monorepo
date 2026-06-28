# Main CI red — SeaweedFS volume-count exhaustion

## Status

In Progress (fix authored — PR open; operator must apply the PVC expansion)

## Question

"Why is CI on main failing?"

## Answer (root cause)

The latest main build (**#4716**, commit `17ba76e8`) is **failed**. The only _hard_
failures are the static-site **Deploy** steps:

- Deploy sjer.red, cooklang-rich-preview, stocks-sjer-red, better-skill-capped
- Deploy scout-for-lol frontend + app (prod) and (beta)

(`Knip` and `Trivy Scan` also show red but are `soft_fail: true` — expected, not the cause.)

All six deploys fail the same way: `aws s3 sync … --endpoint-url https://seaweedfs.sjer.red`
returns **HTTP 500 `InternalError`** on `PutObject`, with glacial throughput (~1.4 KiB/s),
and the Dagger `withExec` errors out after ~10 min.

### The failure chain (evidence)

1. AWS CLI → SeaweedFS S3 gateway `PutObject` → 500 `InternalError`.
2. S3 gateway log (`seaweedfs-s3-…`):
   `putToFiler: chunked upload failed: assign volume: all filers failed, last error: … rpc error: code = DeadlineExceeded`.
3. Master log (`seaweedfs-master-0`) — the smoking gun:

   ```
   failed to find writable volumes for collection:sjer-red … error: No writable volumes and no free volumes left
   starting automatic volume grow
   topo failed to pick 1 from 0 node candidates
   volume_growth.go: create 7 volume, created 0: Not enough data nodes found!
   automatic volume grow failed: Not enough data nodes found!
   volume grow request … failed: only 0 volumes left, not enough for 2
   ```

4. Topology: **`volume:297/297  free:0`**, `Max volume count: 297`, single data node
   `seaweedfs-volume-0` at `Volumes=297 Max=297 Free=0`.

So: the single volume server hit its **max volume-count cap (297/297, 0 free)**.
When a deploy needs a _new_ volume for its collection, the master can't grow one → "No
writable volumes" → 500. Disk is **not** the limiter (164.5G/256G used, **91.5G free**,
`DiskPressure: False`). The binding constraint is the volume **count**, not bytes.
That's also why small deploys (resume, webring, glitter) passed — their collection still
had a non-full writable volume — while sites needing a fresh volume failed.

Red continuously since build **4675** (~06-27 21:09 PT); 4673 and earlier were green.

### Where the volumes went (volume.list by collection)

| collection            | vols | full(1GB) | usedGB | garbageMB |
| --------------------- | ---: | --------: | -----: | --------: |
| scout-prod            |  120 |       120 |  126.1 |    4278.4 |
| scout-beta            |   47 |        44 |   48.8 |    2326.6 |
| (default)             |    7 |         0 |    0.7 |       0.0 |
| sjer-red              |   11 |         0 |    0.3 |      60.5 |
| scout-frontend(+beta) |   25 |         0 |    0.5 |      48.0 |
| everything else       |  ~87 |         0 |   ~0.1 |      ~1.8 |
| **TOTAL**             |  297 |       164 |   ~177 |    6715.3 |

**`scout-prod` (120 vols) + `scout-beta` (47 vols) = 167 of 297 volumes (56%)** — old
League match data/images that accumulate indefinitely. They are why the slot cap was hit.

## Fix (this PR)

`packages/homelab/src/cdk8s/src/resources/argo-applications/seaweedfs.ts` — volume `dataDirs[0]`:

- `maxVolumes: 0` (auto-detect → 297) → **`maxVolumes: 360`** (63 slots of headroom)
- `size: 256Gi` → **`384Gi`** (volumes cap at 1Gi each → 360 worst-case < 384Gi, with buffer)

ZFS pool `zfspv-pool-nvme` has **2.09 TB free**, and `zfs-ssd` has
`allowVolumeExpansion: true`, so the bigger PVC is safe.

### ⚠️ Operator steps required — ArgoCD cannot do the PVC expansion alone

The volume server is a **StatefulSet**, and `volumeClaimTemplates[].spec.resources.requests.storage`
is **immutable** in Kubernetes. ArgoCD's sync of the larger template is rejected, which also
blocks the bundled `maxVolumes` pod-template change. Apply via orphan-recreate:

```bash
# 1) Expand the live PVC in place (zfs-ssd allows online expansion)
kubectl patch pvc data-seaweedfs-volume-0 -n seaweedfs --type merge \
  -p '{"spec":{"resources":{"requests":{"storage":"384Gi"}}}}'
kubectl get pvc data-seaweedfs-volume-0 -n seaweedfs   # confirm 384Gi / FileSystemResizeSuccessful

# 2) Drop the StatefulSet but KEEP pods+PVCs, so the new template (maxVolumes + 384Gi) can apply
kubectl delete statefulset seaweedfs-volume -n seaweedfs --cascade=orphan

# 3) Let ArgoCD re-sync (selfHeal on) — it recreates the STS, adopting the existing pod & PVC.
#    The volume server restarts once with -max=360. Brief (~seconds) volume-server downtime;
#    static-site reads via caddy-s3proxy may 5xx during the restart.

# 4) Verify
kubectl exec -n seaweedfs seaweedfs-master-0 -- sh -c 'echo "volume.list" | weed shell' | head -3
#   expect: volume:297/360  free:63   (Max now 360)

# 5) Retry the failed main build
bk build rebuild 4716 --branch main      # or `bk job retry` the 6 Deploy jobs
```

## Remediation options considered

- **A. Vacuum** — ~6.7 GB garbage, but vacuum compacts _within_ volumes; won't free whole
  volume _slots_. Doesn't unblock CI on its own.
- **B. Raise cap + expand PVC** ← chosen. Immediate unblock; band-aid since scout keeps growing.
- **C. Trim scout retention** — scout-prod (126 GB) is the elephant; frees many slots at once.
  Durable; needs a retention decision. **Recommended follow-up.**
- **D. `aws s3 sync --delete`** on static-site deploys so old hashed assets are pruned instead
  of accumulating; reconsider the `ttl:3M` write that forces a fresh TTL-tagged volume.

## Post-deploy verification

After the operator steps land, confirm a clean main build (all 6 Deploy steps green) and that
`volume.list` shows headroom (`free > 0`). Track durable cleanup (C/D) as a follow-up.

## Session Log — 2026-06-27

### Done

- Diagnosed main CI red → SeaweedFS volume-count exhaustion (297/297, 0 free; disk fine).
  Full evidence chain above (s3 gateway + master logs, topology, per-collection volume table).
- Authored fix in `seaweedfs.ts`: `maxVolumes 0 → 360`, data PVC `256Gi → 384Gi`.
  Typecheck green; synth confirms `maxVolumes: 360` / `size: 384Gi` in `dist/apps.k8s.yaml`.
- Memory note: `reference_seaweedfs_volume_count_exhaustion`.

### Remaining

- Open + merge the PR (branch `fix/seaweedfs-volume-cap`).
- **Operator must run the orphan-recreate sequence** (PVC patch + STS orphan-delete) — ArgoCD
  can't expand a StatefulSet PVC on its own. Then retry build 4716.
- Durable follow-up: trim scout-prod/beta retention (C) and/or add `--delete` to deploys (D).

### Caveats

- Brief volume-server downtime during the STS orphan-recreate; static-site reads may 5xx for
  a few seconds.
- `maxVolumes: 360` is disk-backed by the 384Gi PVC; do NOT raise it far beyond the PVC GiB
  count or a full dataset (100%) becomes possible. scout growth will re-approach the cap —
  this is a runway extension, not a permanent fix.
- The two earlier builds that failed a Tofu-apply step (4706/4714) are unrelated; that step
  passed in 4716 and is not the current blocker.
