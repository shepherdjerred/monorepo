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

### zfs.yaml

**Purpose**: Configure ZFS kernel module parameters

**Current settings**:

- `zfs_arc_max: 51539607552` (48 GiB) - Maximum ARC size, kept below the kubelet `system-reserved memory=52Gi`
- `zfs_arc_min: 8589934592` (8 GB) - Minimum ARC size

**Background**: The cap has oscillated 48 → 62.5 → 48 GiB. It was raised to 62.5 GiB (≈50% of RAM) to quell recurring PagerDuty **hash-collision / ARC-eviction** alerts caused by the cache running at ~98%. However, 62.5 GiB exceeds the kubelet `system-reserved memory=52Gi` reservation (kubelet.yaml), so under CI build storms ARC + pod-allocatable + OS could oversubscribe the 128 GiB of physical RAM and hard-freeze the node (kube-apiserver, apid, and even `talosctl processes` timing out; recovered only by manual reboot). Investigation: `packages/docs/logs/2026-07-05_torvalds-ci-freeze-investigation.md`. Lowered back to 48 GiB (2026-07-05) so ARC can never exceed what kubelet accounts for as non-pod memory — trading a node freeze (severe) for the possibility of hash-collision alerts returning (recoverable). If those alerts recur, prefer raising `system-reserved` in lockstep over raising `zfs_arc_max` past it.

### sysctls.yaml

**Purpose**: Kernel sysctls

**Current settings**:

- `kernel.kptr_restrict: 1` - Talos defaults to 2 (KSPP), which hides /proc/kallsyms addresses from all readers, including privileged containers. Value 1 exposes them to CAP_SYSLOG holders only, which the alloy eBPF profiler needs for kernel stack symbolization.

**Applied**: 2026-06-12 (`talosctl patch machineconfig --patch @patches/sysctls.yaml`, no reboot needed).

**Known limitation**: this alone does NOT make the alloy eBPF profiler work. The SecureBoot image boots with kernel lockdown in `confidentiality` mode, which disables the `bpf_probe_read*()` helpers entirely ("program of this type cannot use helper bpf_probe_read"). Fixing that requires regenerating the factory image schematic with `extraKernelArgs: [-lockdown, lockdown=integrity]` and a node upgrade. See <https://github.com/falcosecurity/libs/issues/2736> and <https://github.com/siderolabs/talos/pull/8535>.

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
