# torvalds freeze mitigation — kubelet reservations, ARC cap, CI concurrency, temp-comment sweep

## Status

Applied live to `torvalds` 2026-07-05 (PR #1414 open for the durable repo record; not yet merged).

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

## Applied live 2026-07-05 (no reboot)

Both patches applied with `talosctl patch machineconfig` — talosctl reported "Applied
configuration without a reboot" for each; node stayed up (age 411d, never rebooted), only
kubelet restarted (~1s service restart).

- **Kubelet** (`@src/talos/patches/kubelet.yaml`): `configz` now shows
  `systemReserved={cpu:4, memory:56Gi}`, `kubeReserved={cpu:1, memory:2Gi}`,
  `evictionHard={memory.available:2Gi, nodefs.available:10%}`. Node `allocatable` memory
  dropped 130846352Ki → **68558480Ki (65.4 GiB)**, cpu 31950m → **27**. kubelet/apid/etcd
  Running/OK. No pods evicted or OOM-killed (node was calm: MemFree 13 GB, 1 CI pod).
- **ARC** (minimal `machine.sysfs` patch — runtime-writable, avoids applying image.yaml's
  install block): live `/sys/module/zfs/parameters/zfs_arc_max` and arcstats `c_max` both
  now **51539607552 (48 GiB)**. No reboot: ZFS accepted the tunable at runtime. Current ARC
  size ~12.7 GiB (already below the cap, so nothing to evict — the cap just bounds future
  growth). The kernel-module `parameters` form in zfs.yaml is boot-time only and was NOT
  applied live by design; the sysfs path handles runtime.

Both changes are persisted in the live machineconfig, so they survive a reboot. PR #1414
remains the durable repo record; merge it so repo == node.

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

## Session Log — 2026-07-05

### Done

- Checked PR #1414 health from `toolkit pr health`, GitHub status APIs, `gh pr checks`, and Buildkite build 5095.
- Verified the PR head `bc64530b54d7c09d33c1b4754badb65268780995` merges cleanly into fetched `origin/main` with `git merge-tree --write-tree`.
- Addressed Greptile's P2 stale reservation comment by changing `52Gi` ARC ceiling references to the actual `systemReserved.memory: 56Gi` in `packages/homelab/src/talos/README.md`, `packages/homelab/src/talos/patches/image.yaml`, and `packages/homelab/src/talos/patches/zfs.yaml`.
- Added the kubelet reservation and eviction settings to the Talos README's `kubelet.yaml` current settings list.
- Verified with `bun run --filter='./packages/homelab' typecheck`, `bunx markdownlint-cli2 packages/homelab/src/talos/README.md`, and `bunx prettier --check packages/homelab/src/talos/README.md packages/homelab/src/talos/patches/image.yaml packages/homelab/src/talos/patches/zfs.yaml`.

### Remaining

- Push the review-fix commit and wait for Buildkite to rerun on the new PR head.
- Recheck unresolved review threads and required CI after the new head status lands.

### Caveats

- Buildkite build 5095 was canceled by Jerred Shepherd before any job-level failure; the branch still needs a fresh required Buildkite result.
