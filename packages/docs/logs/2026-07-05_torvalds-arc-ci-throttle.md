# torvalds freeze mitigation — kubelet reservations, ARC cap, CI concurrency, temp-comment sweep

## Status

In Progress — changes made on branch `fix/torvalds-arc-ci-throttle`, not yet merged or applied to the node.

Follow-up to the facts-only investigation in
[`2026-07-05_torvalds-ci-freeze-investigation.md`](./2026-07-05_torvalds-ci-freeze-investigation.md).

## Root cause (found this session)

The node hard-freezes under CI build storms (kube-apiserver / apid / `talosctl processes`
all time out; recovered only by manual reboot). The load-bearing cause:

**The live node reserves almost no memory for the system.** A live
`talosctl get machineconfig` on 2026-07-05 showed the kubelet section as _only_
`extraArgs: {max-pods: "300"}`. The repo's `kubelet.yaml` reservations
(`system-reserved: memory=52Gi` plus eviction thresholds, added 2026-03-18, commit
`c649ada3d`) **never reached the node** — they were written as kubelet **flags**
(`extraArgs`) but are absent from the live config. Live kubelet therefore runs on defaults:
`systemReserved=512Mi`, `evictionHard.memory.available=100Mi`. Result: node `allocatable`
memory ≈ 124.8 GiB of 125.4 GiB capacity, so with `enforceNodeAllocatable=[pods]` the
`kubepods` cgroup is hard-capped at ~all of RAM. Uncapped CI pods + Dagger can consume
nearly all memory while the ZFS ARC (62.5 GiB, applied via sysfs and _live_) competes with
zero protection → reclaim thrash → freeze.

Contributing: `zfs_arc_max` (62.5 GiB) exceeded even the _intended_ 52Gi reservation, and
Buildkite `max-in-flight=24` allowed high peak concurrency.

## Changes (branch `fix/torvalds-arc-ci-throttle`)

| Change                                                                                                        | From                                                      | To                                                                                                            | File                                                         |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Kubelet reservations → `extraConfig`** (KubeletConfiguration, the form Talos actually merges) + right-sized | `extraArgs` flags, `system-reserved=52Gi` (never applied) | `extraConfig` `systemReserved: {cpu:4, memory:56Gi}`, `kubeReserved: {cpu:1, memory:2Gi}`, eviction hard/soft | `src/talos/patches/kubelet.yaml`                             |
| `zfs_arc_max`                                                                                                 | 62.5 GiB (`67108864000`)                                  | **48 GiB** (`51539607552`)                                                                                    | `src/talos/patches/zfs.yaml`, `src/talos/patches/image.yaml` |
| Buildkite `max-in-flight`                                                                                     | 24                                                        | **16**                                                                                                        | `src/cdk8s/src/resources/argo-applications/buildkite.ts`     |
| Stale thermal comments (13900K→14900K, 100 °C/95-140 W → stock 125/253 W, current peak ~82-84 °C post-AIO)    | —                                                         | —                                                                                                             | `src/cdk8s/src/resources/cpu-power-cap.ts`, `buildkite.ts`   |
| README zfs.yaml rationale                                                                                     | 62.5 GiB / hash-collision                                 | 48 GiB + freeze tradeoff                                                                                      | `src/talos/README.md`                                        |

### Memory budget (ARC 48 + system-reserved 56)

- system-reserved 56Gi = ARC (48) + host/kernel/kubelet/containerd/apid overhead (~8).
- Pod allocatable (kubepods cgroup cap) = 125.4 − 56 − 2 (kube) − 2 (evict-hard) = **65.4 GiB**.
- Worst case: pods 65.4 + ARC 48 + kube 2 = 115.4 GiB → **~10 GiB slack** + 2 GiB eviction buffer.
- vs. live today: pod allocatable ~124.8 GiB, zero ARC protection.

## Verification (worktree)

- Byte/budget arithmetic via Python. `bun run typecheck` (homelab) pass. `bunx eslint`
  (buildkite.ts, cpu-power-cap.ts) clean. `bun run build` (cdk8s) pass; synth shows
  `max-in-flight: 16`. `kubelet.yaml` parses as valid YAML with the expected extraConfig keys.
- `update-image-id.ts` — installer pin unchanged (ARC edit was sysfs value + comments only).

## Deploy path (three mechanisms — none is the same)

1. **Buildkite `max-in-flight` + cpu-power-cap/thermal comments** → ArgoCD/GitOps, auto-syncs
   after merge to `main` (comment-only changes are effectively no-op redeploys).
2. **Talos ARC patch** → manual, no reboot (sysfs override is runtime-writable):
   `talosctl -n torvalds patch machineconfig --patch @packages/homelab/src/talos/patches/zfs.yaml`
3. **Talos kubelet reservations** → manual:
   `talosctl -n torvalds patch machineconfig --patch @packages/homelab/src/talos/patches/kubelet.yaml`
   Applying KubeletConfiguration restarts kubelet (brief, no node reboot). Verify after:
   `kubectl get node torvalds -o jsonpath='{.status.allocatable.memory}'` should drop from
   ~130846352Ki to ~68–69 GiB, and
   `kubectl get --raw /api/v1/nodes/torvalds/proxy/configz` should show systemReserved 56Gi.

## Meta-problem: repo↔node config drift (recommend a follow-up)

Multiple Talos settings are in the repo but not live: kubelet reservations (4 months),
`zfs_arc_max` (repo now 48, live 62.5), Talos image (`v1.13.4` repo vs `v1.13.3` live), and a
live-only `zfs_arc_average_blocksize=4096` kernel param not in any repo patch. There is no
drift detector between `src/talos/patches/*` and the live machineconfig, so changes silently
fail to land. Worth a `todos/` item: a check (CI or scheduled) that diffs rendered patches
against `talosctl get machineconfig`, and/or a documented repeatable apply procedure.

## Tradeoffs to watch

- ARC 48 (down from 62.5) may reintroduce ZFS hash-collision PagerDuty alerts (why it was
  raised in the first place). Intentional: a freeze is worse than a recoverable alert. If they
  recur, raise `system-reserved` in lockstep with a higher `zfs_arc_max`, never let ARC exceed
  the reservation.
- Pod allocatable drops ~124.8 → ~65 GiB. That's the point (hard-cap pods so ARC+OS keep
  headroom). Real workload (Dagger ~14-16 GiB + 16 small CI steps) fits comfortably; a runaway
  build now OOM-kills one pod instead of freezing the node.

## Note on the investigation doc

`2026-07-05_torvalds-ci-freeze-investigation.md` §4 lists "kubelet system-reserved memory=52Gi"
as if applied — that value was read from the repo file, not the live node, and is **not in
effect**. Live is the 512Mi default. (Doc is untracked in the main checkout.)
