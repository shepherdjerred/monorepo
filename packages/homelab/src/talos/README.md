# Talos Configuration

This directory contains Talos machine configuration patches and tooling for the homelab cluster.

## Directory Structure

- `patches/` - Machine configuration patches
- `pods/` - Static pod definitions
- `image.yaml` - Talos image configuration
- `update-image-id.ts` - Script to update Talos image versions

## Patches

Patches are applied to the base Talos machine configuration to customize the cluster nodes.

### kubelet.yaml

**Purpose**: Configure kubelet settings

**Current settings**:

- `max-pods: 300` - Maximum number of pods per node (increased from 250)
- `systemReserved.memory: 40Gi` - Non-pod memory reserved for ZFS ARC (16 GiB) plus host kernel/OS burst (~24 GiB — kernel slab from ZFS dnode/dbuf metadata alone peaked at 30.3Gi under a full CI storm). Right-sized from 56Gi to 24Gi on 2026-07-10 when pod requests hit 99.99% of allocatable and CI pods went unschedulable, then corrected to 40Gi on 2026-07-11 after a global-OOM freeze proved the "8Gi OS overhead" estimate only holds when idle; see `packages/docs/archive/completed/2026-07-10_torvalds-memory-rightsize.md`.
- `systemReserved.cpu: 4` - Non-pod CPU reserved for the host and control-plane services
- `kubeReserved.memory: 8Gi` - Memory reserved for Kubernetes system daemons (raised 2Gi → 8Gi 2026-07-11 after the /podruntime memcg-OOM outage; see `packages/docs/logs/2026-07-10_torvalds-podruntime-oom-outage.md`)
- `kubeReserved.cpu: 1` - CPU reserved for Kubernetes system daemons
- Eviction thresholds - Hard floor at `memory.available: 4Gi`, soft floor at `memory.available: 8Gi` for 2 minutes (raised from 2/4Gi 2026-07-11 so kubelet evicts before the kernel enters ZFS direct-reclaim thrash)
- `podPidsLimit: 4096` - Cluster-wide (node-wide) cgroup pids.max cap per pod. Prevents an unbounded fork/thread explosion in any one pod from exhausting the node's process table. 2026-07 CI-freeze hardening — **needs live PID-headroom verification under real heavy-concurrency load**; watch for `PIDPressure` node conditions.
- `enforceNodeAllocatable: [pods, system-reserved, kube-reserved]` plus `systemReservedCgroup: /system` / `kubeReservedCgroup: /podruntime` - Real cgroup ceilings, not just accounting. **2026-07-09 first attempted this without the `*ReservedCgroup` fields and it crash-looped kubelet on every boot** (see `packages/docs/logs/2026-07-10_torvalds-kubelet-crashloop.md`); fixed 2026-07-10 by adding the cgroup paths (sourced from `siderolabs/talos`'s own `pkg/machinery/constants/constants.go`, not guessed — `/system` is Talos's `CgroupSystem`, `/podruntime` is `CgroupPodRuntimeRoot` covering kubelet + the k8s containerd runtime + etcd). Live-verified 2026-07-10/11: `/sys/fs/cgroup/system/memory.max` and `/sys/fs/cgroup/podruntime/memory.max` exactly match the reservations above (originally 56Gi/2Gi, now 24Gi/8Gi after the 2026-07-10/11 re-sizings).

**Applied**: live on torvalds 2026-07-10 via full-document `talosctl apply-config --mode=no-reboot` (NOT `talosctl patch machineconfig` — confirmed on this node that `patch` appends list fields like `enforceNodeAllocatable` instead of replacing them, see the crash-loop log). Confirmed with `talosctl -n torvalds get kubeletconfig`, `talosctl -n torvalds services kubelet` (Running/OK), and `talosctl -n torvalds health`.

### zfs.yaml

**Purpose**: Configure ZFS kernel module parameters

**Current settings**:

- `zfs_arc_max: 17179869184` (16 GiB) - Maximum ARC size, kept below the kubelet `systemReserved.memory: 24Gi`
- `zfs_arc_min: 8589934592` (8 GB) - Minimum ARC size

**Background**: The cap has oscillated 48 → 62.5 → 48 → 16 GiB. It was raised to 62.5 GiB (≈50% of RAM) to quell recurring PagerDuty **hash-collision / ARC-eviction** alerts caused by the cache running at ~98%. However, 62.5 GiB exceeds what the kubelet reserves as non-pod memory, so under CI build storms ARC + pod-allocatable + OS could oversubscribe the 128 GiB of physical RAM and hard-freeze the node (kube-apiserver, apid, and even `talosctl processes` timing out; recovered only by manual reboot). Investigation: `packages/docs/logs/2026-07-05_torvalds-ci-freeze-investigation.md`. Lowered back to 48 GiB (2026-07-05) so ARC can never exceed the reservation. **Right-sized to 16 GiB (2026-07-10)** after 30d of Prometheus evidence showed 48 GiB was habit, not demand: ARC hit rate p50 99.95% (worst hour 89.6%), miss rate p50 3 reads/s, ghost hits (misses a bigger ARC would have caught) p95 ~580/s — trivially served by the NVMe pool. The hash-collision remediation via ARC size demonstrably failed (collisions still p50 36/s, p95 5.1k/s at 48 GiB), so that justification is dead; the alert thresholds were retuned instead (`src/cdk8s/src/resources/monitoring/monitoring/rules/zfs.ts`). The freed 32 GiB went to pod allocatable (59.4 → ~91.4 GiB) to unblock CI scheduling. `ZfsArcHitRateLow` (<85%) is the canary that 16 GiB is too small; if it fires sustained, raise `zfs_arc_max` and `systemReserved.memory` in lockstep — never let ARC exceed the reservation. See `packages/docs/plans/2026-07-10_torvalds-memory-rightsize.md`.

**2026-07-10 drift found and fixed**: the live `kernel.modules` zfs parameters were still at the stale 62.5 GiB value (plus an undocumented `zfs_arc_average_blocksize=4096`) from an orphaned, never-merged branch (commit `8a1c331b5`, "Codex worktree snapshot: archive-cleanup", 2026-06-05 — confirmed via `git merge-base --is-ancestor 8a1c331b5 HEAD` returning false) applied directly to the node and never touched by the 2026-07-05 revert. The actual runtime ARC size was correct (48 GiB, verified via `talosctl -n torvalds read /sys/module/zfs/parameters/zfs_arc_max`) only because the `image.yaml` sysfs override re-asserts it — the module-load parameter itself was a latent landmine. Corrected live via full-document `talosctl apply-config` to exactly match this file (`zfs_arc_max`/`zfs_arc_min` only, `average_blocksize` dropped as undocumented/unmerged).

### sysctls.yaml

**Purpose**: Kernel sysctls

**Current settings**:

- `kernel.kptr_restrict: 1` - Talos defaults to 2 (KSPP), which hides /proc/kallsyms addresses from all readers, including privileged containers. Value 1 exposes them to CAP_SYSLOG holders only, which the alloy eBPF profiler needs for kernel stack symbolization.
- `kernel.panic_on_rcu_stall: 1` - 2026-07 CI-freeze hardening bonus signal. **Not** the primary auto-recovery mechanism (see `watchdog.yaml` below) — live-verified that `kernel.hung_task_panic`/`kernel.hung_task_timeout_secs` do not exist on this kernel (`CONFIG_DETECT_HUNG_TASK` not compiled in), and even where present those only watch D-state (blocked) tasks, not the R-state runqueue-contention failure mode actually observed. RCU stalls are a closer, though not guaranteed, match. Costs nothing to enable.

**Applied**: 2026-06-12 (`kernel.kptr_restrict`, `talosctl patch machineconfig --patch @patches/sysctls.yaml`, no reboot needed). `kernel.panic_on_rcu_stall` — applied live on torvalds 2026-07-09, confirmed via `talosctl -n torvalds read /proc/sys/kernel/panic_on_rcu_stall` → `1`.

**Known limitation**: this alone does NOT make the alloy eBPF profiler work. The SecureBoot image boots with kernel lockdown in `confidentiality` mode, which disables the `bpf_probe_read*()` helpers entirely ("program of this type cannot use helper bpf_probe_read"). Fixing that requires regenerating the factory image schematic with `extraKernelArgs: [-lockdown, lockdown=integrity]` and a node upgrade. See <https://github.com/falcosecurity/libs/issues/2736> and <https://github.com/siderolabs/talos/pull/8535>.

### watchdog.yaml

**Purpose**: Hardware watchdog — the **primary** auto-recovery mechanism for the 2026-07 CI-freeze failure mode (a watchdog fires because its heartbeat is missed, not because the kernel self-diagnoses an error, which is why it fits a pure runqueue-contention freeze where the kernel never technically "hangs" or "panics").

**Current settings**:

- `machine.kernel.modules`: `iTCO_wdt` + `iTCO_vendor_support`, `heartbeat=60`/`nowayout=1`. Feasibility confirmed live 2026-07: the module is already auto-loaded by the kernel (Intel Z790-class chipset TCO controller) and `/sys/class/watchdog/watchdog0` already exists (`identity=iTCO_wdt`, `state=inactive`, default `timeout=30`). This pins the load explicitly for reproducibility.
- `WatchdogTimerConfig`: `device: /dev/watchdog0`, `timeout: 3m0s`.

**Applied**: live on torvalds 2026-07-10 via full-document `talosctl apply-config --mode=no-reboot` (also deduped a pre-existing, unrelated `i915`/`zfs` `kernel.modules` duplication found live in the same list — see `zfs.yaml` above). Verified: `talosctl -n torvalds get watchdogtimerstatus` shows `owner: runtime.WatchdogTimerController` (Talos's own controller, i.e. `machined`, is doing the petting — the desired behavior) with `feedInterval: 1m0s` against the `3m0s` timeout. Node observed stable (no reboot, `talosctl health` clean) for the full 3-minute timeout window post-apply and after.

See `packages/docs/logs/2026-07-08_torvalds-cluster-health-deep-check.md` for the full investigation and why hung-task-panic sysctls were considered and rejected in favor of this.

### Other Patches

- `interface.yaml` - Network interface configuration
- `scheduling.yaml` - Node scheduling settings
- `image.yaml` - Custom system extensions and image configuration
- `tailscale.example.yaml` - Example Tailscale configuration

## Applying Patches

Patches are typically applied during cluster initialization or updates. To apply patches to an existing node:

```bash
# Apply all patches
talosctl patch machineconfig \
  --patch @src/talos/patches/kubelet.yaml \
  --patch @src/talos/patches/zfs.yaml \
  --patch @src/talos/patches/interface.yaml \
  --patch @src/talos/patches/scheduling.yaml \
  --patch @src/talos/patches/tailscale.yaml

# Reboot to apply changes
talosctl reboot
```

`watchdog.yaml` contains a `WatchdogTimerConfig` document alongside the `machine.kernel.modules` patch (separated by `---`) — apply and verify it separately and carefully (see the watchdog.yaml section above) rather than folding it into a bulk `--patch` invocation, since an armed-but-unpetted watchdog reboots immediately.
