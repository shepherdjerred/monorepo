# torvalds — Re-enable Real Kubelet Reserved-Resource Cgroup Enforcement

## Status

Complete

## Context

On 2026-07-10, `torvalds` (single-node homelab cluster) went fully down: kubelet
crash-looped on every boot after commit `0b7daea41f` added
`enforceNodeAllocatable: [pods, system-reserved, kube-reserved]` to
`packages/homelab/src/talos/patches/kubelet.yaml` without the kubelet-required
`systemReservedCgroup`/`kubeReservedCgroup` fields. Kubelet hard-fails config
validation (by design) when `enforceNodeAllocatable` includes `system-reserved`/
`kube-reserved` but the matching cgroup path isn't specified — with zero log output,
which is why it looked like a mysterious crash rather than an obvious config error.

Reverted live to `enforceNodeAllocatable: [pods]` (the kubelet default) to restore
the cluster. Full incident writeup, including a second gotcha discovered mid-recovery
(`talosctl patch machineconfig` appends list fields instead of replacing them —
required a full-document `talosctl apply-config` to actually fix) is in
`packages/docs/logs/2026-07-10_torvalds-kubelet-crashloop.md`.

This plan is the follow-up: re-add the _hard cgroup enforcement_ correctly, so the
original CI-freeze-hardening intent (protect kubelet/containerd/etcd/apid from being
starved by pod-side memory/CPU pressure — see
`packages/docs/logs/2026-07-08_torvalds-cluster-health-deep-check.md`) is actually
achieved, not just accounted for on paper.

## What `enforceNodeAllocatable` currently does vs. is supposed to do

- **Current state (`[pods]` only):** `systemReserved`/`kubeReserved` amounts are
  _accounting only_ — subtracted from `Node.status.allocatable` for scheduling
  purposes. Nothing stops a runaway host process, containerd, or the ZFS ARC from
  actually exceeding its "reserved" share; there's no real ceiling.
- **Target state (`[pods, system-reserved, kube-reserved]` + cgroup paths):** kubelet
  writes real cgroup limits onto the specified cgroups, so the OS kernel itself caps
  non-pod resource consumption. A runaway pod OOM-kills within `kubepods`, instead of
  starving kubelet/containerd/etcd/apid and wedging the whole node — the actual
  protection PR #1423 was trying to add.

## Root-caused cgroup paths (from Talos source, not guesswork)

Talos never auto-populates `systemReservedCgroup`/`kubeReservedCgroup` — confirmed via
`siderolabs/talos` source: Talos's own default kubelet `NodeConfig` ships with
`SystemReservedCgroupName`/`KubeReservedCgroupName` explicitly empty. They must be set
manually. Talos's actual cgroup hierarchy (`pkg/machinery/constants/constants.go`):

| Constant               | Value         | Contents                                                                                                                                                 |
| ---------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CgroupSystem`         | `/system`     | All non-Kubernetes Talos system daemons: udevd, apid, trustd, extensions, dashboard, the system-level containerd (`/system/runtime`)                     |
| `CgroupPodRuntimeRoot` | `/podruntime` | Kubernetes-scoped runtime components: containerd for k8s pods (`/podruntime/runtime`), etcd (`/podruntime/etcd`), kubelet itself (`/podruntime/kubelet`) |

A live default kubelet startup log (`internal/app/machined/pkg/system/runner/internal/lastlog/testdata/kubelet.log`
in the Talos repo) confirms Talos already sets kubelet's `SystemCgroupsName: "/system"`
and `KubeletCgroupsName: "/podruntime/kubelet"` by default — so `/system` and
`/podruntime` are the correct, Talos-native targets for the _reservation enforcement_
fields too:

```yaml
systemReservedCgroup: /system
kubeReservedCgroup: /podruntime
```

`kubeReservedCgroup: /podruntime` (the parent, not `/podruntime/kubelet`) matches
upstream Kubernetes guidance that `kube-reserved-cgroup` should cover **both** kubelet
and the container runtime, and `/podruntime` is the only cgroup covering both on Talos.

## Proposed change

`packages/homelab/src/talos/patches/kubelet.yaml`:

```yaml
extraConfig:
  systemReserved:
    cpu: "4"
    memory: "56Gi"
  systemReservedCgroup: /system
  kubeReserved:
    cpu: "1"
    memory: "2Gi"
  kubeReservedCgroup: /podruntime
  evictionHard: { ... unchanged ... }
  evictionSoft: { ... unchanged ... }
  evictionSoftGracePeriod: { ... unchanged ... }
  podPidsLimit: 4096
  enforceNodeAllocatable:
    - pods
    - system-reserved
    - kube-reserved
```

`packages/homelab/src/talos/README.md`: update the `enforceNodeAllocatable` bullet to
document the cgroup paths and point at this plan + the incident log instead of the
"revert" note.

## Rollout plan — learn from the incident

The prior rollout failed for two independent reasons: (1) missing cgroup fields, (2)
a manual live patch that was never verified against an actual kubelet restart. Do not
repeat either mistake.

1. **Apply via full-document `talosctl apply-config --mode=no-reboot`, not
   `talosctl patch machineconfig`.** The incident confirmed `patch machineconfig`
   appends list fields (`enforceNodeAllocatable`) instead of replacing them on this
   node — a second, independent gotcha. Always dump the current resolved config
   (`talosctl get machineconfig -o yaml`), edit the specific fields, and apply the
   full document back.
2. **Immediately verify before considering it done:**

   ```bash
   talosctl --nodes torvalds services kubelet   # must show Running/OK, not Waiting/Fail
   talosctl --nodes torvalds health --verbose   # all checks pass
   kubectl get nodes                            # torvalds Ready
   kubectl get pods -n kube-system              # all Running
   ```

3. **Have the rollback ready before applying:** the proven-good `[pods]`-only config
   (already committed) is the immediate rollback — re-apply it the same way
   (full-document `apply-config`) if kubelet doesn't come back `Running/OK` within
   ~30s.
4. **Verify memory/CPU headroom is actually enforced**, not just that kubelet starts:
   - `talosctl --nodes torvalds cgroups` (or read `/sys/fs/cgroup/podruntime/memory.max`
     and `/sys/fs/cgroup/system/memory.max` directly) to confirm the cgroup limits
     were actually written, matching `kubeReserved.memory`/`systemReserved.memory`.
   - Watch for `PIDPressure`/memory-pressure node conditions for a day or two after
     rollout (the `podPidsLimit: 4096` follow-up from the 07-08 investigation still
     needs live verification too, and is bundled into the same patch file).
5. **Update the repo files in the same commit as any live change** — the original
   incident happened partly because the live machine-config patch and the repo commit
   drifted (manual `talosctl patch machineconfig` per the file's own header, not
   GitOps). Keep live and repo in sync going forward for this file.

## Also worth doing in the same pass (lower priority, can be split out)

Found live but explicitly NOT touched during the incident recovery (see incident log
follow-ups #2 and #3) — separate, unrelated pre-existing duplication in the resolved
machine config:

- `machine.kernel.modules`: `i915` and `zfs` each listed twice (second copies missing
  `parameters:` — worth confirming ZFS ARC settings are actually taking effect as
  intended, not being silently overridden by the bare duplicate).
- `ExtensionServiceConfig` (tailscale): two different `TS_AUTHKEY` values present
  simultaneously. Needs figuring out which is actually active before removing the
  other (removing the wrong one could cut off the only remote access path to this
  node).
- These are very likely caused by the same `talosctl patch machineconfig`
  append-not-replace behavior identified in this incident, applied repeatedly over
  time to add different unrelated config over the node's history. Consider whether
  `talosctl patch machineconfig` should be avoided going forward in favor of always
  doing full-document `apply-config` for this cluster.

## Open questions

- Confirm whether `talosctl patch machineconfig`'s append behavior is documented/
  expected Talos behavior (opaque `extraConfig` map merge semantics) or a bug worth
  reporting upstream — affects whether it's safe to use at all on this cluster going
  forward.
- Confirm current live `zfs_arc_max` value actually in effect given the duplicate
  `kernel.modules` entries (cross-reference against `packages/homelab/src/talos/patches/zfs.yaml`).
  **Resolved** — see Session Log below.

## Session Log — 2026-07-10 (execution)

### Done

- Applied the cgroup enforcement fields live via full-document `talosctl apply-config
--mode=no-reboot`: `systemReservedCgroup: /system`, `kubeReservedCgroup: /podruntime`,
  `enforceNodeAllocatable: [pods, system-reserved, kube-reserved]`. Kubelet came up
  `Running/OK` immediately, no crash loop. Verified the cgroup limits are real, not
  just accounted: `/sys/fs/cgroup/system/memory.max` = 60129542144 (exactly 56Gi),
  `/sys/fs/cgroup/podruntime/memory.max` = 2147483648 (exactly 2Gi). Full
  `talosctl health` clean, all `kube-system` pods Running.
- Applied the still-pending watchdog rollout (`watchdog.yaml`, from PR #1423) in a
  separate full-document apply, after the kubelet fix was verified good: added
  `iTCO_wdt`/`iTCO_vendor_support` kernel modules and the `WatchdogTimerConfig`
  document. Verified `owner: runtime.WatchdogTimerController` (Talos's own `machined`
  is petting it) with `feedInterval: 1m0s` against `timeout: 3m0s`. Node observed
  stable through the full 3-minute timeout window post-apply — no unexpected reboot.
- Bundled in a dedupe of the pre-existing `machine.kernel.modules` duplication
  (`i915`/`zfs` each listed twice, second copies bare) while already reconstructing
  that list for the watchdog modules.
- **New finding during the same pass**: the live `zfs` kernel module parameters
  (`zfs_arc_max=67108864000` = 62.5 GiB, plus an undocumented
  `zfs_arc_average_blocksize=4096`) were stale, traced via `git log -S` +
  `git merge-base --is-ancestor` to an orphaned, never-merged commit (`8a1c331b5`,
  "Codex worktree snapshot: archive-cleanup", 2026-06-05) that had been applied
  directly to the live node and never touched by the 2026-07-05 revert back to 48
  GiB. Runtime was actually correct (48 GiB, confirmed via
  `talosctl -n torvalds read /sys/module/zfs/parameters/zfs_arc_max`) only because
  `image.yaml`'s sysfs override re-asserts it — the module-load parameter itself was
  a latent landmine. Confirmed with user (48 GiB intended, drop the undocumented
  blocksize param) and corrected live via a third full-document apply-config to
  exactly match `zfs.yaml`.
- Investigated (read-only) the Tailscale duplicate-`TS_AUTHKEY` finding — see
  `packages/docs/todos/torvalds-tailscale-authkey-duplication.md`. Neither key is
  actively used for reconnection (the node resumes from persisted Tailscale identity,
  confirmed via `ext-tailscale` logs showing `machineAuthorized=true` with no fresh
  auth handshake). No fix applied — recommended regenerating a single fresh key later.
- Updated `packages/homelab/src/talos/README.md` (`kubelet.yaml`, `zfs.yaml`,
  `watchdog.yaml`, `sysctls.yaml` sections) and
  `packages/homelab/src/talos/patches/kubelet.yaml` comments to reflect the verified
  live state and cite Talos's own source for the cgroup path provenance.

### Remaining

- None for this plan — all live changes applied and verified, repo docs updated.
- Watch for `PIDPressure` node conditions and `PolicyReport` Kyverno violations over
  the next 1-2 weeks per the original PR #1423 plan's observation window (unchanged
  by this session).

### Caveats

- Did not re-investigate whether other Talos patch files (beyond `kubelet.yaml`,
  `watchdog.yaml`, `zfs.yaml`) have similar live-vs-repo drift from past manual
  `talosctl patch machineconfig` rollouts — only the fields directly touched by this
  plan were audited. A full drift audit across every patch file would need a separate
  pass.
