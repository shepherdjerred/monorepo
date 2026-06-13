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

- `zfs_arc_max: 67108864000` (62.5 GB) - Maximum ARC size, set to 50% of total RAM
- `zfs_arc_min: 8589934592` (8 GB) - Minimum ARC size

**Background**: The ZFS ARC was originally limited to 48 GB despite the node having 125 GB total memory. This caused the cache to run at 98% capacity, triggering recurring PagerDuty alerts for hash collisions. Increasing to 62.5 GB (industry standard 50% of RAM) provides headroom for I/O spikes.

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
